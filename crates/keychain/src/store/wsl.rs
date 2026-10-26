//! Inside WSL: the Windows Credential Manager, through the Windows build of the helper,
//! `~/.envrouter/bin/envrouter-keychain.exe`, run over WSL's interop. A distro usually has no
//! Secret Service, and keeping secrets on the Windows side means the Windows app can manage
//! them later too. The item is keyed by the distro as well as the home folder, so two distros'
//! secrets never meet.

use std::ffi::OsString;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use envrouter_core::{config, paths, Error, Result};

/// The bridge's answer for an item that isn't there.
pub const NOT_FOUND: i32 = 3;

/// The distro's name: `from_env` (`WSL_DISTRO_NAME`), or the note an earlier run left in
/// `~/.envrouter/wsl-distro`. WSL sets the variable in its terminals, but a process they don't
/// start (a systemd user unit, cron, an agent that passes a bare environment) lacks it, and an
/// empty name would look up another item than the one a terminal saved.
fn distro(from_env: Option<OsString>, home: &Path) -> Result<String> {
    let note = paths::wsl_distro(home);
    let noted = std::fs::read_to_string(&note)
        .map(|text| text.trim().to_owned())
        .unwrap_or_default();
    if let Some(name) = from_env
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
    {
        // Only inside an `~/.envrouter` that's there, so an uninstall that has removed it is not
        // undone by the store being asked for the last time. Best effort: the note only helps a
        // later run without the variable.
        if name != noted && paths::root(home).is_dir() {
            let _ = config::write_private(&note, &name);
        }
        return Ok(name);
    }
    if noted.is_empty() {
        return Err(Error::SecretStore(
            "couldn't tell which WSL distro this is: WSL_DISTRO_NAME isn't set, and EnvRouter hasn't noted it yet. Run `envrouter secret list` once in a WSL terminal".into(),
        ));
    }
    Ok(noted)
}

/// `account` is the canonical home folder.
fn key(account: &str) -> Result<String> {
    let distro = distro(std::env::var_os("WSL_DISTRO_NAME"), Path::new(account))?;
    Ok(format!("wsl:{distro}:{account}"))
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

/// Whether the Windows helper can be run from here, for the window to ask whenever it gains
/// focus. It runs the helper with no arguments, which prints its usage and exits without
/// touching the store, so only a missing helper or a WSL without interop fails.
pub fn usable(account: &str) -> Result<()> {
    run(account, &[], None).map(drop)
}

pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    let output = run(account, &["store-get", service, &key(account)?], None)?;
    match output.status.code() {
        Some(0) => Ok(Some(output.stdout)),
        Some(NOT_FOUND) => Ok(None),
        _ => Err(failed(&output)),
    }
}

pub fn set(service: &str, account: &str, value: &[u8]) -> Result<()> {
    let output = run(
        account,
        &["store-set", service, &key(account)?],
        Some(value),
    )?;
    if output.status.success() {
        Ok(())
    } else {
        Err(failed(&output))
    }
}

pub fn delete(service: &str, account: &str) -> Result<()> {
    let output = run(account, &["store-delete", service, &key(account)?], None)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(failed(&output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_distro_comes_from_wsl_and_is_noted_for_processes_started_without_it() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let note = paths::wsl_distro(home);
        std::fs::create_dir(paths::root(home)).unwrap();

        assert_eq!(distro(Some("Ubuntu".into()), home).unwrap(), "Ubuntu");
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "Ubuntu");
        // A process without the variable, or with it empty, gets the noted name.
        assert_eq!(distro(None, home).unwrap(), "Ubuntu");
        assert_eq!(distro(Some("".into()), home).unwrap(), "Ubuntu");
        // A renamed distro replaces the note.
        assert_eq!(distro(Some("Debian".into()), home).unwrap(), "Debian");
        assert_eq!(distro(None, home).unwrap(), "Debian");

        // Without `~/.envrouter` (uninstalled) nothing is written, and nothing is noted yet.
        let bare = tempfile::tempdir().unwrap();
        assert_eq!(
            distro(Some("Ubuntu".into()), bare.path()).unwrap(),
            "Ubuntu"
        );
        assert!(!paths::root(bare.path()).exists());
        let err = distro(None, bare.path()).unwrap_err();
        assert!(matches!(err, Error::SecretStore(_)), "{err:?}");
    }
}
