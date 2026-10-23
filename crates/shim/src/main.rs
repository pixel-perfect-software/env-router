//! Installed as `~/.envrouter/shims/<tool>`, a symlink to this binary, with that directory
//! first on PATH. Each run routes one invocation: it finds the profile for the current
//! directory, sets that profile's variable for the tool, and execs the real tool found
//! further along PATH.
//!
//! Editors that start an agent from their own copy of it, like the Claude Code extension for
//! VS Code, run `~/.envrouter/bin/envrouter-shim <their binary> <args>` instead, through a
//! process-wrapper setting. The shim then routes that binary rather than searching PATH. An
//! extension that ships a script rather than a binary passes `<interpreter> <script> <args>`,
//! and the agent is the one whose extension folder holds the script.
//!
//! It must never stop someone from running their tool. A missing or broken config only
//! produces a warning, and the tool runs unrouted.

use std::collections::HashMap;
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use envrouter_core::config::ConfigState;
use envrouter_core::mcp::{self, Launch};
use envrouter_core::platform::Platform;
use envrouter_core::{config, paths, resolve, EXIT_TOOL_NOT_FOUND};

/// When set to `1`, print how this invocation would be routed, as one line of JSON, and exit
/// without running the tool. The app uses it to check a folder. Any other value is ignored, so
/// a stray `ENVROUTER_EXPLAIN=0` can't quietly stop every tool from running.
const EXPLAIN_VAR: &str = "ENVROUTER_EXPLAIN";
/// `0` turns MCP injection off for a run: the tool gets only the servers it configures itself.
const MCP_VAR: &str = "ENVROUTER_MCP";
/// An unanswered Keychain prompt mustn't hold the tool forever.
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(20);

fn main() -> ExitCode {
    let mut args = env::args_os();
    let argv0 = args.next().unwrap_or_default();
    let mut user_args: Vec<OsString> = args.collect();
    let home = env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from);
    let Some(name) = Path::new(&argv0)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
    else {
        eprintln!("envrouter: can't tell which tool to run from {argv0:?}");
        return ExitCode::from(2);
    };
    // Loaded before the tool is known: an editor's script names its agent only through it.
    let config = home
        .as_deref()
        .map_or(Ok(None), |home| config::load(&paths::root(home)));

    // `None` runs the program unrouted.
    let tool: Option<String>;
    let real;
    // Stays ahead of anything injected: the script an interpreter runs.
    let mut script = None;
    if name == paths::SHIM_NAME {
        let Some(found) = wrapped(&user_args, config.as_ref().ok().and_then(Option::as_ref)) else {
            eprintln!("envrouter: run this through a link named after a tool, such as ~/.envrouter/shims/claude, or as an editor's process wrapper, followed by the tool's full path");
            return ExitCode::from(2);
        };
        user_args.remove(0);
        if found.runs_script {
            script = Some(user_args.remove(0));
        }
        if found.tool.is_none() {
            eprintln!(
                "envrouter: can't tell which tool {} is. Running it without a profile.",
                found.program.display()
            );
        }
        tool = found.tool;
        real = found.program;
    } else {
        let Some(found) = find_real(&name, home.as_deref()) else {
            eprintln!(
                "envrouter: can't find `{name}` on PATH outside ~/.envrouter/shims. Is it installed?"
            );
            return ExitCode::from(EXIT_TOOL_NOT_FOUND);
        };
        tool = Some(name);
        real = found;
    }
    let route = tool
        .as_deref()
        .map_or_else(Route::none, |tool| route(&config, tool, home.as_deref()));
    let launch = route
        .launch
        .filter(|launch| launch.applies_to(&user_args))
        .filter(|_| env::var_os(MCP_VAR).is_none_or(|value| value != "0"));
    // Claude Code exits at startup when given servers on a machine whose admin manages them.
    let managed_by = launch
        .as_ref()
        .and_then(Launch::managed_by)
        .map(str::to_owned);
    let launch = launch.filter(|_| managed_by.is_none());

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
            "mcpManagedBy": managed_by,
            // A path that isn't UTF-8 can't go in JSON as is, and failing here would abort.
            "real": real.to_string_lossy(),
        });
        println!("{explanation}");
        return ExitCode::SUCCESS;
    }

    if let (Some(path), Some(tool)) = (&managed_by, &tool) {
        eprintln!(
            "envrouter: {path} manages this machine's MCP servers, so {tool} runs without the profile's."
        );
    }
    let mut command = Command::new(&real);
    command.args(&script);
    if let (Some(launch), Some(home), Some(tool)) = (launch, home.as_deref(), tool.as_deref()) {
        let injection = inject(&launch, home, tool);
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

impl Route {
    fn none() -> Self {
        Self {
            profile: None,
            env: None,
            launch: None,
        }
    }
}

fn route(
    config: &envrouter_core::Result<Option<ConfigState>>,
    tool: &str,
    home: Option<&Path>,
) -> Route {
    let Some(home) = home else {
        return Route::none();
    };
    let config = match config {
        Ok(Some(config)) => config,
        Ok(None) => return Route::none(),
        Err(err) => {
            warn(err, &format!("Running {tool} without a profile"));
            return Route::none();
        }
    };
    // A deleted working directory has no profile.
    let Ok(cwd) = env::current_dir() else {
        return Route::none();
    };
    let resolution = resolve::resolve(config, home, &cwd, tool);
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
    let ids: Vec<&str> = launch.secret_ids().into_iter().collect();
    match read_secrets(home, &ids) {
        Ok(secrets) => {
            let injection = launch.inject(&secrets);
            for name in &injection.dropped {
                eprintln!("envrouter: the MCP server {name} needs a secret that isn't in the {}. Running {tool} without it.", Platform::current().secret_store_name());
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

/// The named secrets, from the Keychain helper installed next to the shim. It's a separate
/// binary so that only runs needing a secret load the Security framework. Ids go on its
/// command line; values come back through the pipe. An unanswered Keychain prompt times out.
fn read_secrets(home: &Path, ids: &[&str]) -> Result<HashMap<String, String>, String> {
    let helper = paths::keychain_helper(home);
    let mut child = Command::new(&helper)
        .arg("read")
        .args(ids)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("couldn't start {}: {err}", helper.display()))?;
    // Both pipes are read while the helper runs: an answer bigger than a pipe's buffer would
    // otherwise block the helper on its write until the deadline.
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let errors = thread::spawn(move || read_all(stderr));
    let (sender, answer) = mpsc::channel();
    thread::spawn(move || sender.send(read_all(stdout)));
    // The pipe closes when the helper exits.
    let Ok(stdout) = answer.recv_timeout(KEYCHAIN_TIMEOUT) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
            "the {} didn't answer within 20 seconds",
            Platform::current().secret_store_name()
        ));
    };
    let status = child.wait().map_err(|err| err.to_string())?;
    if !status.success() {
        let errors = errors.join().unwrap_or_default();
        return Err(String::from_utf8_lossy(&errors).trim().to_string());
    }
    serde_json::from_slice(&stdout)
        .map_err(|err| format!("the secrets helper's answer was unreadable: {err}"))
}

/// Everything until the pipe closes. A failed read keeps what came before it.
fn read_all(mut pipe: impl Read) -> Vec<u8> {
    let mut bytes = Vec::new();
    let _ = pipe.read_to_end(&mut bytes);
    bytes
}

/// One line on stderr: what went wrong, then what the shim does about it.
fn warn(err: &impl std::fmt::Display, then: &str) {
    // Some messages already end in a full stop.
    let err = err.to_string();
    eprintln!("envrouter: {}. {then}.", err.trim_end_matches('.'));
}
/// What an editor asks the shim to run.
struct Wrapped {
    /// The tool to route it as. `None`: it runs unrouted rather than not at all.
    tool: Option<String>,
    program: PathBuf,
    /// The argument after the program is a script inside the agent's extension.
    runs_script: bool,
}

/// What an editor asks the shim to run, named by its first argument: an absolute path to an
/// executable that isn't a shim. That's either the agent's binary, named after its command,
/// like the `.../native-binary/claude` the Claude Code extension passes, or an interpreter
/// followed by a script inside an installed copy of the agent's extension, like the
/// `<VS Code's own Node> .../resources/claude-code/cli.js` its builds without a native binary
/// pass. Anything else runs unrouted.
fn wrapped(args: &[OsString], config: Option<&ConfigState>) -> Option<Wrapped> {
    let program = Path::new(args.first()?);
    let me = env::current_exe().and_then(fs::canonicalize).ok();
    if !(program.is_absolute() && is_executable(program) && !is_shim(program, me.as_deref())) {
        return None;
    }
    let script_agent = config
        .zip(args.get(1))
        .and_then(|(config, script)| extension_agent(config, Path::new(script)));
    let runs_script = script_agent.is_some();
    let tool = script_agent.or_else(|| {
        program
            .file_name()
            .and_then(OsStr::to_str)
            .filter(|name| config::is_command_name(name))
            .map(str::to_owned)
    });
    Some(Wrapped {
        tool,
        program: program.to_path_buf(),
        runs_script,
    })
}

/// The agent whose editor extension holds `script`, a file somewhere inside an installed copy.
fn extension_agent(config: &ConfigState, script: &Path) -> Option<String> {
    if !(script.is_absolute() && script.is_file()) {
        return None;
    }
    let folders: Vec<&str> = script
        .ancestors()
        .skip(1)
        .filter_map(|dir| dir.file_name()?.to_str())
        .collect();
    config
        .agents
        .iter()
        .find(|(command, agent)| {
            config::is_command_name(command)
                && agent
                    .ide
                    .as_ref()
                    .is_some_and(|ide| folders.iter().any(|folder| ide.is_installed_copy(folder)))
        })
        .map(|(command, _)| command.clone())
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
