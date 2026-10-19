//! Installed as `~/.envrouter/shims/<tool>`, a symlink to this binary, with that directory
//! first on PATH. Each run routes one invocation: it finds the profile for the current
//! directory, sets that profile's variable for the tool, and execs the real tool found
//! further along PATH.
//!
//! It must never stop someone from running their tool. A missing or broken config only
//! produces a warning, and the tool runs unrouted.

use std::collections::HashMap;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use envrouter_core::mcp::{self, Launch};
use envrouter_core::{config, paths, resolve, secrets, EXIT_TOOL_NOT_FOUND};

/// When set to `1`, print how this invocation would be routed, as one line of JSON, and exit
/// without running the tool. The app uses it to check a folder. Any other value is ignored, so
/// a stray `ENVROUTER_EXPLAIN=0` can't quietly stop every tool from running.
const EXPLAIN_VAR: &str = "ENVROUTER_EXPLAIN";
/// `0` turns MCP injection off for a run: the tool gets only the servers it configures itself.
const MCP_VAR: &str = "ENVROUTER_MCP";
/// When set to `1`, read the Keychain secrets once and exit. The app runs this after installing
/// a new shim, so macOS asks to let the shim in while the app is in front, not in the middle of
/// someone's `claude`.
const KEYCHAIN_PROBE_VAR: &str = "ENVROUTER_KEYCHAIN_PROBE";
/// An unanswered Keychain prompt mustn't hold the tool forever.
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(20);

fn main() -> ExitCode {
    let mut args = env::args_os();
    let argv0 = args.next().unwrap_or_default();
    let user_args: Vec<OsString> = args.collect();
    let home = env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from);
    if env::var_os(KEYCHAIN_PROBE_VAR).is_some_and(|value| value == "1") {
        return probe_keychain(home.as_deref());
    }
    let Some(tool) = Path::new(&argv0)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
    else {
        eprintln!("envrouter: can't tell which tool to run from {argv0:?}");
        return ExitCode::from(2);
    };
    if tool == paths::SHIM_NAME {
        eprintln!("envrouter: run this through a link named after a tool, such as ~/.envrouter/shims/claude");
        return ExitCode::from(2);
    }

    let Some(real) = find_real(&tool, home.as_deref()) else {
        eprintln!(
            "envrouter: can't find `{tool}` on PATH outside ~/.envrouter/shims. Is it installed?"
        );
        return ExitCode::from(EXIT_TOOL_NOT_FOUND);
    };
    let route = route(&tool, home.as_deref());
    let launch = route
        .launch
        .filter(|launch| launch.applies_to(&user_args))
        .filter(|_| env::var_os(MCP_VAR).is_none_or(|value| value != "0"));

    if env::var_os(EXPLAIN_VAR).is_some_and(|value| value == "1") {
        let (var, value) = route.env.unzip();
        // The servers the run would get with every secret readable. Explaining never asks the
        // Keychain, so a check can't raise a prompt.
        let servers: Vec<&str> = launch
            .iter()
            .flat_map(|launch| &launch.servers)
            .map(|server| server.name.as_str())
            .collect();
        let explanation = serde_json::json!({
            "tool": tool,
            "profile": route.profile,
            "envVar": var,
            "value": value,
            "mcp": servers,
            "real": real,
        });
        println!("{explanation}");
        return ExitCode::SUCCESS;
    }

    let mut command = Command::new(&real);
    if let (Some(launch), Some(home)) = (launch, home.as_deref()) {
        let injection = inject(&launch, home, &tool);
        // Ahead of the user's arguments, so none can land after a `--` they typed.
        command.args(&injection.args).envs(injection.env);
    }
    command.args(&user_args);
    if let Some((var, value)) = route.env {
        command.env(var, value);
    }
    let err = command.exec(); // Only returns on failure.
    eprintln!("envrouter: couldn't run {}: {err}", real.display());
    ExitCode::from(126)
}

struct Route {
    /// The active profile's name.
    profile: Option<String>,
    /// The variable to set, if any.
    env: Option<(String, String)>,
    /// The MCP servers the profile hands this tool, if any.
    launch: Option<Launch>,
}

fn route(tool: &str, home: Option<&Path>) -> Route {
    let none = Route {
        profile: None,
        env: None,
        launch: None,
    };
    let Some(home) = home else {
        return none;
    };
    let config = match config::load(&paths::root(home)) {
        Ok(Some(config)) => config,
        Ok(None) => return none,
        Err(err) => {
            warn(&err, &format!("Running {tool} without a profile"));
            return none;
        }
    };
    // A deleted working directory has no profile.
    let Ok(cwd) = env::current_dir() else {
        return none;
    };
    let resolution = resolve::resolve(&config, home, &cwd, tool);
    let launch = resolution.profile.and_then(|profile| {
        mcp::load_launch(home, &profile.id, tool)
            .inspect_err(|err| warn(err, &format!("Running {tool} without MCP servers")))
            .ok()
            .flatten()
    });
    Route {
        profile: resolution.profile.map(|p| p.name.clone()),
        env: resolution.env,
        launch,
    }
}

/// What to add to the run, reading the Keychain only if a server needs a secret. A server
/// whose secret can't be read is left out, with a warning, rather than started without it.
fn inject(launch: &Launch, home: &Path, tool: &str) -> mcp::Injection {
    if launch.secret_ids().is_empty() {
        return launch.inject(&HashMap::new());
    }
    match read_secrets(home) {
        Ok(secrets) => {
            let injection = launch.inject(&secrets);
            for name in &injection.dropped {
                eprintln!("envrouter: the MCP server {name} needs a secret that isn't in the Keychain. Running {tool} without it.");
            }
            injection
        }
        Err(err) => {
            let injection = launch.inject(&HashMap::new());
            eprintln!(
                "envrouter: couldn't read MCP secrets ({err}). Running {tool} without {}.",
                injection.dropped.join(", ")
            );
            injection
        }
    }
}

/// The Keychain's answer, on a thread so an unanswered prompt times out.
fn read_secrets(home: &Path) -> Result<HashMap<String, String>, String> {
    let (sender, receiver) = mpsc::channel();
    let home = home.to_path_buf();
    thread::spawn(move || {
        let _ = sender.send(secrets::read(&home).map_err(|err| err.to_string()));
    });
    receiver
        .recv_timeout(KEYCHAIN_TIMEOUT)
        .unwrap_or_else(|_| Err("the Keychain didn't answer within 20 seconds".into()))
}

fn probe_keychain(home: Option<&Path>) -> ExitCode {
    let Some(home) = home else {
        eprintln!("envrouter: HOME isn't set");
        return ExitCode::from(2);
    };
    match read_secrets(home) {
        Ok(_) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("envrouter: {err}");
            ExitCode::FAILURE
        }
    }
}

/// One line on stderr: what went wrong, then what the shim does about it.
fn warn(err: &impl std::fmt::Display, then: &str) {
    // Some messages already end in a full stop.
    let err = err.to_string();
    eprintln!("envrouter: {}. {then}.", err.trim_end_matches('.'));
}
/// The first `tool` on PATH that isn't a shim. It skips the shims directory and anything
/// that resolves to this binary or another copy of it, so a duplicated PATH entry, a stray
/// link or a second install can't make shims exec themselves or each other in a loop.
fn find_real(tool: &str, home: Option<&Path>) -> Option<PathBuf> {
    let me = env::current_exe().and_then(fs::canonicalize).ok();
    let shims = home.and_then(|home| fs::canonicalize(paths::shims(home)).ok());
    env::split_paths(&env::var_os("PATH")?)
        // An empty entry means the current directory. Never run a tool from there.
        .filter(|dir| !dir.as_os_str().is_empty())
        .filter(|dir| shims.is_none() || fs::canonicalize(dir).ok() != shims)
        .map(|dir| dir.join(tool))
        .find(|candidate| is_executable(candidate) && !is_shim(candidate, me.as_deref()))
}

/// Whether `candidate` runs this binary or another installed copy of it, say one under a
/// scratch HOME. Two copies on PATH would otherwise exec each other back and forth.
fn is_shim(candidate: &Path, me: Option<&Path>) -> bool {
    let Ok(target) = fs::canonicalize(candidate) else {
        return false;
    };
    me == Some(target.as_path())
        || target
            .file_name()
            .is_some_and(|name| name == paths::SHIM_NAME)
}

fn is_executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}
