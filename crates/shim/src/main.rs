//! Installed as `~/.envrouter/shims/<tool>`, a symlink to this binary, with that directory
//! first on PATH. Each run routes one invocation: it finds the profile for the current
//! directory, sets that profile's variable for the tool, and execs the real tool found
//! further along PATH.
//!
//! It must never stop someone from running their tool. A missing or broken config only
//! produces a warning, and the tool runs unrouted.

use std::env;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use envrouter_core::{config, paths, resolve, EXIT_TOOL_NOT_FOUND};

/// When set, print how this invocation would be routed, as one line of JSON, and exit
/// without running the tool. The app uses it to check a folder.
const EXPLAIN_VAR: &str = "ENVROUTER_EXPLAIN";

fn main() -> ExitCode {
    let mut args = env::args_os();
    let argv0 = args.next().unwrap_or_default();
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

    let home = env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from);
    let Some(real) = find_real(&tool, home.as_deref()) else {
        eprintln!(
            "envrouter: can't find `{tool}` on PATH outside ~/.envrouter/shims. Is it installed?"
        );
        return ExitCode::from(EXIT_TOOL_NOT_FOUND);
    };
    let (profile, env_var) = route(&tool, home.as_deref());

    if env::var_os(EXPLAIN_VAR).is_some() {
        let (var, value) = env_var.unzip();
        let explanation = serde_json::json!({
            "tool": tool,
            "profile": profile,
            "envVar": var,
            "value": value,
            "real": real,
        });
        println!("{explanation}");
        return ExitCode::SUCCESS;
    }

    let mut command = Command::new(&real);
    command.args(args);
    if let Some((var, value)) = env_var {
        command.env(var, value);
    }
    let err = command.exec(); // Only returns on failure.
    eprintln!("envrouter: couldn't run {}: {err}", real.display());
    ExitCode::from(126)
}

/// The active profile's name and the variable to set, if any.
fn route(tool: &str, home: Option<&Path>) -> (Option<String>, Option<(String, String)>) {
    let Some(home) = home else {
        return (None, None);
    };
    let config = match config::load(&paths::root(home)) {
        Ok(Some(config)) => config,
        Ok(None) => return (None, None),
        Err(err) => {
            eprintln!("envrouter: {err}. Running {tool} without a profile.");
            return (None, None);
        }
    };
    // A deleted working directory has no profile.
    let Ok(cwd) = env::current_dir() else {
        return (None, None);
    };
    let resolution = resolve::resolve(&config, home, &cwd, tool);
    (resolution.profile.map(|p| p.name.clone()), resolution.env)
}

/// The first `tool` on PATH that isn't this shim. It skips the shims directory and anything
/// that resolves to this binary, so a duplicated PATH entry or a stray link can't make the
/// shim exec itself in a loop.
fn find_real(tool: &str, home: Option<&Path>) -> Option<PathBuf> {
    let me = env::current_exe().and_then(fs::canonicalize).ok();
    let shims = home.and_then(|home| fs::canonicalize(paths::shims(home)).ok());
    env::split_paths(&env::var_os("PATH")?)
        // An empty entry means the current directory. Never run a tool from there.
        .filter(|dir| !dir.as_os_str().is_empty())
        .filter(|dir| shims.is_none() || fs::canonicalize(dir).ok() != shims)
        .map(|dir| dir.join(tool))
        .find(|candidate| {
            is_executable(candidate) && (me.is_none() || fs::canonicalize(candidate).ok() != me)
        })
}

fn is_executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}
