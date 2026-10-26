//! Reading MCP secrets through the Keychain helper, for the programs that must not link a secret
//! store. The shim and the launcher run `envrouter-keychain read` instead, so a store's library
//! (the Security framework, D-Bus) is loaded only by a run that needs a secret, and none of what
//! it opens can leak into a server through `exec`.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::platform::Platform;

/// How long a read waits for the store. An unanswered Keychain prompt mustn't hold the tool or
/// the server forever, and 20 seconds is under Claude Code's 30 second `MCP_TIMEOUT`.
pub const READ_TIMEOUT: Duration = Duration::from_secs(20);

/// The named secrets, from `helper` (`envrouter-keychain`, installed under `home`). Ids go on its
/// command line; values come back through the pipe. `HOME` is set to `home` for the read, since
/// the secret store's item is keyed by it and some agents start a server without `HOME`. An
/// answer not in by `timeout` kills the helper.
pub fn read_through(
    helper: &Path,
    home: &Path,
    ids: &[&str],
    timeout: Duration,
) -> Result<HashMap<String, String>, String> {
    let mut child = Command::new(helper)
        .arg("read")
        .args(ids)
        .env("HOME", home)
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
    let Ok(stdout) = answer.recv_timeout(timeout) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
            "the {} didn't answer within {} seconds",
            Platform::current().secret_store_name(),
            timeout.as_secs()
        ));
    };
    let status = child.wait().map_err(|err| err.to_string())?;
    if !status.success() {
        let errors = errors.join().unwrap_or_default();
        let errors = String::from_utf8_lossy(&errors);
        // A helper the system killed says nothing, and a reason that is empty reads as none.
        return Err(match errors.trim() {
            "" => format!("the secrets helper failed ({status})"),
            errors => errors.to_string(),
        });
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

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Instant;

    use super::*;

    #[test]
    fn a_helper_that_never_answers_is_cut_off_at_the_deadline() {
        let dir = tempfile::tempdir().unwrap();
        let helper = dir.path().join("envrouter-keychain");
        // Copied by a child `cp`, never written by this process: a test thread that forks while
        // this one holds the file open for writing hands the handle on, and running the file
        // then fails with "Text file busy" until that fork execs.
        let source = dir.path().join("helper.src");
        fs::write(&source, "#!/bin/sh\nexec sleep 10\n").unwrap();
        assert!(Command::new("cp")
            .arg(&source)
            .arg(&helper)
            .status()
            .unwrap()
            .success());
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o755)).unwrap();

        let started = Instant::now();
        let answer = read_through(&helper, dir.path(), &["7F3A"], Duration::from_millis(300));
        assert!(answer.is_err(), "{answer:?}");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "waited {:?} for a helper that sleeps 10 seconds",
            started.elapsed()
        );
    }
}
