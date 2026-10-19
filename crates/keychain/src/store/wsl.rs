//! Inside WSL: the Windows Credential Manager, through the Windows build of the helper,
//! `~/.envrouter/bin/envrouter-keychain.exe`, run over WSL's interop. A distro usually has no
//! Secret Service, and keeping secrets on the Windows side means the Windows app can manage
//! them later too. The item is keyed by the distro as well as the home folder, so two distros'
//! secrets never meet.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use envrouter_core::{Error, Result};

/// The bridge's answer for an item that isn't there.
pub const NOT_FOUND: i32 = 3;

fn key(account: &str) -> String {
    let distro = std::env::var("WSL_DISTRO_NAME").unwrap_or_default();
    format!("wsl:{distro}:{account}")
}

/// `account` is the canonical home folder, which is where the helper is installed.
fn helper(account: &str) -> Command {
    Command::new(Path::new(account).join(".envrouter/bin/envrouter-keychain.exe"))
}

fn run(account: &str, args: &[&str], input: Option<&[u8]>) -> Result<std::process::Output> {
    let mut child = helper(account)
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            Error::SecretStore(format!(
                "couldn't reach the Windows Credential Manager ({err}). Install EnvRouter's Windows helper, or turn on WSL interop"
            ))
        })?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin
            .write_all(input)
            .map_err(|err| Error::SecretStore(err.to_string()))?;
    }
    child
        .wait_with_output()
        .map_err(|err| Error::SecretStore(err.to_string()))
}

fn failed(output: &std::process::Output) -> Error {
    Error::SecretStore(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    let output = run(account, &["store-get", service, &key(account)], None)?;
    match output.status.code() {
        Some(0) => Ok(Some(output.stdout)),
        Some(NOT_FOUND) => Ok(None),
        _ => Err(failed(&output)),
    }
}

pub fn set(service: &str, account: &str, value: &[u8]) -> Result<()> {
    let output = run(account, &["store-set", service, &key(account)], Some(value))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(failed(&output))
    }
}

pub fn delete(service: &str, account: &str) -> Result<()> {
    let output = run(account, &["store-delete", service, &key(account)], None)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(failed(&output))
    }
}
