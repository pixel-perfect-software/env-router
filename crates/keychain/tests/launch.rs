//! Runs the built helper's `exec` the way an agent does: a spec under a scratch home, a fake
//! `envrouter-keychain` in that home's `.envrouter/bin` for the launcher to read the store
//! through, and a server that is `/bin/sh -c …`. An agent starts the launcher with whatever
//! environment it likes, so each run begins from an empty one with only a PATH.

#![cfg(unix)]

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use envrouter_core::mcp::LAUNCHER_VERSION;
use serde_json::json;

const LAUNCHER: &str = env!("CARGO_BIN_EXE_envrouter-keychain");

/// A helper whose store holds `7F3A`, as the real `read` answers: one JSON line on stdout.
const HAS_THE_TOKEN: &str =
    "#!/bin/sh\n[ \"$1\" = read ] && [ \"$2\" = 7F3A ] && echo '{\"7F3A\":\"ghp_x\"}'\n";

struct Fixture {
    _root: tempfile::TempDir,
    home: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap().join("home");
        fs::create_dir_all(home.join(".envrouter/bin")).unwrap();
        Self { _root: root, home }
    }

    /// Installs `script` as the helper the launcher reads the store through.
    fn install_helper(&self, script: &str) {
        write_executable(&self.home.join(".envrouter/bin/envrouter-keychain"), script);
    }

    fn spec_path(&self) -> PathBuf {
        self.home
            .join(".envrouter/mcp/work/claude/stdio/github.json")
    }

    /// Writes the spec for a `github` server that runs `script` with the token in `TOKEN`.
    fn write_spec(&self, script: &str) {
        let spec = json!({
            "server": "github",
            "home": self.home.display().to_string(),
            "command": "/bin/sh",
            "args": ["-c", script],
            "env": { "TOKEN": { "secret": "7F3A" } },
        });
        let path = self.spec_path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, spec.to_string()).unwrap();
    }

    /// The launcher as an agent starts it: nothing in its environment but a PATH.
    fn launcher(&self, spec: &Path) -> Command {
        let mut command = Command::new(LAUNCHER);
        command
            .arg("exec")
            .arg(spec)
            .current_dir(&self.home)
            .env_clear()
            .env("PATH", "/usr/bin:/bin");
        command
    }
}

/// Writes a script that's run straight away. The bytes go to a side file and `cp` copies them into
/// place (see `copy_executable`).
fn write_executable(path: &Path, contents: &str) {
    let source = path.with_extension("src");
    fs::write(&source, contents).unwrap();
    copy_executable(&source, path);
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

/// Copies an executable that's run straight away with a child `cp`, never `fs::copy`, so this
/// process never holds it open for writing: on Linux, a test thread that forks meanwhile would
/// inherit that handle, and running the file would fail with "Text file busy" until the fork
/// execs.
fn copy_executable(from: &Path, to: &Path) {
    let copied = Command::new("cp").arg(from).arg(to).status().unwrap();
    assert!(copied.success());
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// A launcher that failed leaves one `envrouter: …` line on stderr and nothing on stdout, which is
/// the agent's transport.
fn assert_one_line_on_stderr_only(output: &Output) {
    assert_eq!(stdout(output), "");
    let message = stderr(output);
    assert!(
        message.starts_with("envrouter: ") && message.trim_end().lines().count() == 1,
        "{message:?}"
    );
}

#[test]
fn a_server_gets_its_own_secrets_and_none_of_the_agents() {
    let f = Fixture::new();
    f.install_helper(HAS_THE_TOKEN);
    f.write_spec(r#"echo "$TOKEN ${ENVROUTER_SECRET_OTHER-unset}""#);
    let output = f
        .launcher(&f.spec_path())
        // A remote server's secret, which the shim set on the agent.
        .env("ENVROUTER_SECRET_OTHER", "x")
        .output()
        .unwrap();
    assert_eq!(stdout(&output), "ghp_x unset\n", "{}", stderr(&output));
    assert_eq!(stderr(&output), "");
}

/// Copilot passes a server only `PATH`, and the store's item is keyed by home.
#[test]
fn the_secrets_are_read_for_the_specs_home_and_the_server_never_gets_it() {
    let f = Fixture::new();
    f.install_helper(&format!(
        "#!/bin/sh\n[ \"$HOME\" = '{}' ] && echo '{{\"7F3A\":\"ghp_x\"}}'\n",
        f.home.display()
    ));
    f.write_spec(r#"echo "$TOKEN ${HOME-unset}""#);
    let output = f.launcher(&f.spec_path()).output().unwrap();
    assert_eq!(stdout(&output), "ghp_x unset\n", "{}", stderr(&output));
}

#[test]
fn the_server_takes_over_stdin_stdout_and_the_exit_status() {
    // A helper that read its stdin would take the transport's first bytes with it.
    let f = Fixture::new();
    f.install_helper("#!/bin/sh\ncat >/dev/null\necho '{\"7F3A\":\"ghp_x\"}'\n");
    f.write_spec(r#"read l; echo "got $l"; pwd; echo $$; exit 7"#);
    let mut child = f
        .launcher(&f.spec_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let pid = child.id();
    child.stdin.take().unwrap().write_all(b"hello\n").unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(
        stdout(&output),
        format!("got hello\n{}\n{pid}\n", f.home.display()),
        "{}",
        stderr(&output)
    );
    assert_eq!(output.status.code(), Some(7));
}

#[test]
fn a_secret_the_store_lacks_fails_the_server_before_it_runs() {
    let f = Fixture::new();
    f.install_helper("#!/bin/sh\necho '{}'\n");
    let ran = f.home.join("ran");
    f.write_spec(&format!("touch {}", ran.display()));
    let output = f.launcher(&f.spec_path()).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_one_line_on_stderr_only(&output);
    let message = stderr(&output);
    assert!(
        message.contains("github") && message.contains("7F3A"),
        "{message}"
    );
    assert!(!ran.exists(), "the server ran without its secret");
}

#[test]
fn a_spec_that_is_gone_fails_with_a_message_and_nothing_on_stdout() {
    let f = Fixture::new();
    let output = f.launcher(&f.spec_path()).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_one_line_on_stderr_only(&output);
    let message = stderr(&output);
    assert!(
        message.contains("github") && message.contains("Restart the agent"),
        "{message}"
    );
}

#[test]
fn a_command_that_cannot_be_found_exits_127_with_a_message() {
    let f = Fixture::new();
    let spec = f.home.join("github.json");
    let missing = json!({
        "server": "github",
        "home": f.home.display().to_string(),
        "command": "/no/such/server",
    });
    fs::write(&spec, missing.to_string()).unwrap();
    let output = f.launcher(&spec).output().unwrap();
    assert_eq!(output.status.code(), Some(127));
    assert_one_line_on_stderr_only(&output);
    assert!(
        stderr(&output).contains("/no/such/server"),
        "{}",
        stderr(&output)
    );
}

/// What a save asks before it renders a server through the launcher.
#[test]
fn answers_the_launcher_version_it_reads() {
    let output = Command::new(LAUNCHER)
        .arg("--launcher-version")
        .output()
        .unwrap();
    assert_eq!(stdout(&output), format!("{LAUNCHER_VERSION}\n"));
}

/// A plain value beside a locked one used to reach the server as the text `${GITHUB_HOST}`: before
/// the launcher, the agent filled it in, so the launcher does it now, from the environment the
/// agent started it with.
#[test]
fn plain_values_get_the_variables_they_name() {
    let f = Fixture::new();
    f.install_helper(HAS_THE_TOKEN);
    let spec = json!({
        "server": "github",
        "home": f.home.display().to_string(),
        "command": "/bin/sh",
        "args": ["-c", r#"echo "$TOKEN $HOST $LEVEL $ARG $1""#, "sh", "--host=${GITHUB_HOST}"],
        "env": {
            "TOKEN": { "secret": "7F3A" },
            "HOST": "${GITHUB_HOST}",
            "LEVEL": "${LOG_LEVEL:-info}",
            // Shell syntax that isn't a reference stays as typed.
            "ARG": "$GITHUB_HOST${GITHUB_HOST-x}",
        },
    });
    let path = f.spec_path();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, spec.to_string()).unwrap();
    let output = f
        .launcher(&path)
        .env("GITHUB_HOST", "gh.example")
        .output()
        .unwrap();
    assert_eq!(
        stdout(&output),
        "ghp_x gh.example info $GITHUB_HOST${GITHUB_HOST-x} --host=gh.example\n",
        "{}",
        stderr(&output)
    );
    // Copilot, told to pass `"LOG_LEVEL": "${LOG_LEVEL}"` on, may hand it over as typed when it
    // isn't set: that's unset, so the default applies.
    let output = f
        .launcher(&path)
        .env("GITHUB_HOST", "gh.example")
        .env("LOG_LEVEL", "${LOG_LEVEL}")
        .output()
        .unwrap();
    assert!(stdout(&output).contains(" info "), "{}", stderr(&output));

    // Unset with no default: that server fails, as with a missing secret. A remote server's
    // secret, set on the agent, is never one a plain value can name.
    for name in ["GITHUB_HOST", "ENVROUTER_SECRET_9B2C"] {
        let spec = json!({
            "server": "github",
            "home": f.home.display().to_string(),
            "command": "/bin/echo",
            "args": [format!("${{{name}}}")],
            "env": { "TOKEN": { "secret": "7F3A" } },
        });
        fs::write(&path, spec.to_string()).unwrap();
        let output = f
            .launcher(&path)
            .env("ENVROUTER_SECRET_9B2C", "remote")
            .output()
            .unwrap();
        assert_one_line_on_stderr_only(&output);
        assert!(stderr(&output).contains(name), "{}", stderr(&output));
    }
}
