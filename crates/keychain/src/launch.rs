//! `envrouter-keychain exec <spec>`: starts one stdio MCP server that needs a secret, in the
//! agent's place. The spec (`mcp::StdioSpec`, rendered under `~/.envrouter/mcp`) holds the
//! server's command with its secrets as references; this reads them from the store and `exec`s
//! the command, so a secret is in that server's environment or arguments and nowhere else.
//!
//! Until the `exec`, stdin and stdout are the agent's MCP transport and stay untouched: this
//! prints nothing but the one stderr line of a failure, and reads nothing. The store is read by
//! a child `read` of the installed helper, not here, so nothing the store's library opens (a
//! Keychain handle, a D-Bus socket) is inherited by the server, and a store that never answers
//! costs a child process rather than a stuck thread.

use std::collections::HashMap;
use std::convert::Infallible;
use std::env;
use std::io::{self, ErrorKind, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, ExitCode};

use envrouter_core::mcp::{self, StdioSpec, Unresolved, SECRET_VAR_PREFIX};
use envrouter_core::platform::Platform;
use envrouter_core::{paths, secrets, Error};

/// Starts the server `spec_path` describes. It returns only for a server that didn't start, with
/// the status to exit with.
pub fn run(spec_path: &Path) -> ExitCode {
    let failure = match launch(spec_path) {
        Ok(started) => match started {},
        Err(failure) => failure,
    };
    // Nothing to do if even stderr is gone, and `eprintln!` would panic.
    let _ = writeln!(io::stderr(), "envrouter: {}", failure.message);
    ExitCode::from(failure.status)
}

/// One server that didn't start: the line to say why, and how to exit.
struct Failure {
    message: String,
    status: u8,
}

impl Failure {
    /// Exit 1, the status for a server that never got as far as its command.
    fn new(message: String) -> Self {
        Self { message, status: 1 }
    }
}

fn launch(spec_path: &Path) -> Result<Infallible, Failure> {
    let spec = mcp::load_stdio_spec(spec_path).map_err(|err| unreadable(spec_path, &err))?;
    let command = spec_command(&spec)?;

    let mut process = Command::new(&command.program);
    process.args(&command.args);
    // The agent's secrets for its remote servers are in this environment; the server isn't theirs.
    for (name, _) in env::vars_os() {
        if name
            .as_encoded_bytes()
            .starts_with(SECRET_VAR_PREFIX.as_bytes())
        {
            process.env_remove(name);
        }
    }
    process.envs(command.env);
    let err = process.exec(); // Only returns on failure.
    Err(Failure {
        message: format!(
            "couldn't start the MCP server {} ({}): {err}.",
            spec.server, command.program
        ),
        // The statuses a shell gives a command it couldn't find, and one it couldn't run.
        status: if err.kind() == ErrorKind::NotFound {
            127
        } else {
            126
        },
    })
}

/// The spec's command with every secret filled in, read from the store only if it names any.
fn spec_command(spec: &StdioSpec) -> Result<mcp::StdioCommand, Failure> {
    let ids: Vec<&str> = spec.secret_ids().into_iter().collect();
    let secrets = if ids.is_empty() {
        HashMap::new()
    } else {
        let home = Path::new(&spec.home);
        secrets::read_through(
            &paths::keychain_helper(home),
            home,
            &ids,
            secrets::READ_TIMEOUT,
        )
        .map_err(|err| {
            Failure::new(format!(
                "couldn't read the secrets the MCP server {} needs ({}), so it didn't start.",
                spec.server,
                one_line(&err)
            ))
        })?
    };
    spec.resolve(&secrets, |name| env::var(name).ok())
        .map_err(|unresolved| match unresolved {
            Unresolved::Secret(id) => Failure::new(format!(
                "the MCP server {} needs a secret that isn't in the {} ({id}), so it didn't start. Enter it again in EnvRouter, or run `envrouter secret set {id}`.",
                spec.server,
                Platform::current().secret_store_name()
            )),
            Unresolved::Variable(name) => Failure::new(format!(
                "the MCP server {} names ${{{name}}}, which isn't set where the agent started, so it didn't start. Set {name} there, or give it a default: ${{{name}:-…}}.",
                spec.server
            )),
        })
}

/// Why the spec couldn't be had. A missing one is a server the profile no longer has, which a
/// session that began before the save only finds out when the agent reconnects to it.
fn unreadable(path: &Path, err: &Error) -> Failure {
    if let Error::Io { source, .. } = err {
        if source.kind() == ErrorKind::NotFound {
            let server = path.file_stem().unwrap_or_default().to_string_lossy();
            return Failure::new(format!(
                "{} is gone, so EnvRouter no longer starts the MCP server {server} here. Restart the agent to load the profile's current servers.",
                path.display()
            ));
        }
    }
    let why = match err {
        Error::Io { source, .. } => source.to_string(),
        Error::Json { source, .. } => source.to_string(),
        other => other.to_string(),
    };
    Failure::new(format!(
        "couldn't read {} ({}). Save in EnvRouter, or run `envrouter apply`, to write it again.",
        path.display(),
        one_line(&why)
    ))
}

/// The helper's own words on one line: a failure is a single line on stderr.
fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}
