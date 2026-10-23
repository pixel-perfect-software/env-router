//! Keeps the installed shim binary current and `~/.envrouter/shims` holding one link per
//! routed tool.

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState};
use envrouter_core::{paths, Error, Result};

/// The shim shipped with the app or the CLI, next to the running executable. That's where Tauri
/// puts `bundle.externalBin` (`Contents/MacOS` in the bundle, `/usr/bin` from a `.deb`,
/// `target/<profile>` in development) and where a release archive puts it beside `envrouter`.
/// Links are followed, so a CLI linked into Homebrew's `bin` finds the files in its keg.
pub fn bundled() -> Result<PathBuf> {
    let exe = std::env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|source| Error::Io {
            path: PathBuf::from("current executable"),
            source,
        })?;
    Ok(exe.with_file_name(paths::SHIM_NAME))
}

/// The Keychain helper shipped with the app, beside the shim.
pub fn bundled_keychain() -> Result<PathBuf> {
    Ok(bundled()?.with_file_name(paths::KEYCHAIN_NAME))
}

/// Installs the shim and the Keychain helper the app ships with, if either is missing or
/// different, e.g. after an app update. Says whether either changed.
pub fn install_bundled(home: &Path) -> Result<bool> {
    let changed = install_binaries(home, &bundled()?, &bundled_keychain()?)?;
    // Linux builds ship the Windows helper too, for WSL. Elsewhere it isn't there.
    let windows = bundled()?.with_file_name(format!("{}.exe", paths::KEYCHAIN_NAME));
    let windows_changed =
        windows.is_file() && install_file(&paths::windows_keychain_helper(home), &windows)?;
    Ok(changed || windows_changed)
}

pub fn install_binaries(home: &Path, shim: &Path, keychain: &Path) -> Result<bool> {
    let shim = install_binary(home, shim)?;
    let helper = install_file(&paths::keychain_helper(home), keychain)?;
    Ok(shim || helper)
}

/// Copies `source` to the installed location if it's missing or different, and says whether
/// it did. The rename is atomic, so a shim that's running keeps its old inode.
pub fn install_binary(home: &Path, source: &Path) -> Result<bool> {
    install_file(&paths::shim_binary(home), source)
}

/// Installs the CLI at [`paths::cli_binary`], the same way.
pub fn install_cli(home: &Path, source: &Path) -> Result<bool> {
    install_file(&paths::cli_binary(home), source)
}

fn install_file(dest: &Path, source: &Path) -> Result<bool> {
    let dest = dest.to_path_buf();
    let bytes = fs::read(source).map_err(|source_err| Error::Io {
        path: source.to_path_buf(),
        source: source_err,
    })?;
    if fs::read(&dest).is_ok_and(|current| current == bytes) {
        return Ok(false);
    }
    config::write_atomic(&dest, &bytes)?;
    fs::set_permissions(&dest, fs::Permissions::from_mode(0o755)).map_err(|source| Error::Io {
        path: dest.clone(),
        source,
    })?;
    Ok(true)
}

/// Runs the installed Keychain helper once, in the background. A new build has a new ad hoc
/// signature, so macOS asks again before letting it read the secrets: better now, with the app
/// in front, than in the middle of someone's `claude`.
pub fn ask_keychain_access(home: &Path) {
    let helper = paths::keychain_helper(home);
    let home = home.to_path_buf();
    std::thread::spawn(move || {
        let _ = std::process::Command::new(helper)
            .arg("read")
            .env("HOME", home)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    });
}

/// Whether the installed shim and Keychain helper match these copies.
pub fn is_installed(home: &Path, shim: &Path, keychain: &Path) -> bool {
    let same = |installed: PathBuf, bundled: &Path| match (fs::read(installed), fs::read(bundled)) {
        (Ok(installed), Ok(bundled)) => installed == bundled,
        _ => false,
    };
    same(paths::shim_binary(home), shim) && same(paths::keychain_helper(home), keychain)
}

/// The newest config version the installed shim reads, as it answers itself. `None` without a
/// shim, or with one from 0.7.0 or earlier, which doesn't know the question (it exits 2): those
/// may read an older version than this build writes.
pub fn installed_config_version(home: &Path) -> Option<u32> {
    let output = std::process::Command::new(paths::shim_binary(home))
        .arg(paths::SHIM_CONFIG_VERSION_ARG)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()?.trim().parse().ok()
}

/// Refuses a config whose shims couldn't all be made: a file that isn't a link has a routed
/// tool's name. A save checks this before writing anything, so it can't leave a config whose
/// tools have no shim.
pub fn check(home: &Path, config: &ConfigState) -> Result<()> {
    let dir = paths::shims(home);
    for tool in config::tool_names(config) {
        let link = dir.join(tool);
        if fs::read_link(&link).is_err() && link.exists() {
            return Err(Error::Invalid(format!(
                "{} already exists and wasn't made by EnvRouter. Move it, then save again.",
                link.display()
            )));
        }
    }
    Ok(())
}

/// Makes the shims directory hold exactly one link per tool the config routes. Links to the
/// shim for tools no longer routed are removed, and a link named after a routed tool is
/// pointed at the shim. Anything that isn't a link is left alone, and reported if it's in
/// the way.
pub fn sync(home: &Path, config: &ConfigState) -> Result<()> {
    let dir = paths::shims(home);
    let target = paths::shim_binary(home);
    let io_err = |path: &Path| {
        let path = path.to_path_buf();
        move |source| Error::Io { path, source }
    };
    fs::create_dir_all(&dir).map_err(io_err(&dir))?;
    check(home, config)?;
    let wanted = config::tool_names(config);

    for entry in fs::read_dir(&dir).map_err(io_err(&dir))? {
        let path = entry.map_err(io_err(&dir))?.path();
        let ours = fs::read_link(&path).is_ok_and(|link| link == target);
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if ours && !wanted.contains(name) {
            fs::remove_file(&path).map_err(io_err(&path))?;
        }
    }

    for tool in wanted {
        let link = dir.join(tool);
        match fs::read_link(&link) {
            Ok(existing) if existing == target => continue,
            Ok(_) => fs::remove_file(&link).map_err(io_err(&link))?,
            // `check` refused anything else that's in the way.
            Err(_) => {}
        }
        symlink(&target, &link).map_err(io_err(&link))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use envrouter_core::config::{Profile, ToolConfig};

    fn config_with(tools: &[&str]) -> ConfigState {
        ConfigState {
            profiles: vec![Profile {
                id: "1".into(),
                name: "P".into(),
                trigger_paths: vec![],
                tools: tools
                    .iter()
                    .map(|tool| {
                        (
                            tool.to_string(),
                            ToolConfig {
                                env_var: "X".into(),
                                path: "~/x".into(),
                            },
                        )
                    })
                    .collect(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn install_binaries_copies_once_and_makes_them_executable() {
        let home = tempfile::tempdir().unwrap();
        let shim = Path::new(env!("ENVROUTER_STAGED_SHIM"));
        let keychain = Path::new(env!("ENVROUTER_STAGED_KEYCHAIN"));
        assert!(!is_installed(home.path(), shim, keychain));
        assert!(install_binaries(home.path(), shim, keychain).unwrap());
        assert!(is_installed(home.path(), shim, keychain));
        assert!(!install_binaries(home.path(), shim, keychain).unwrap());
        for dest in [
            paths::shim_binary(home.path()),
            paths::keychain_helper(home.path()),
        ] {
            assert_eq!(
                fs::metadata(&dest).unwrap().permissions().mode() & 0o111,
                0o111
            );
        }
    }

    #[test]
    fn sync_adds_and_removes_only_its_own_links() {
        let home = tempfile::tempdir().unwrap();
        let dir = paths::shims(home.path());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("keep-me"), "user file").unwrap();

        sync(home.path(), &config_with(&["claude", "aider"])).unwrap();
        assert_eq!(
            fs::read_link(dir.join("claude")).unwrap(),
            paths::shim_binary(home.path())
        );
        assert!(fs::symlink_metadata(dir.join("aider")).is_ok());

        sync(home.path(), &config_with(&["claude"])).unwrap();
        assert!(fs::symlink_metadata(dir.join("aider")).is_err());
        assert!(dir.join("keep-me").exists());
    }

    #[test]
    fn sync_refuses_to_replace_a_file_it_did_not_make() {
        let home = tempfile::tempdir().unwrap();
        let dir = paths::shims(home.path());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("claude"), "user file").unwrap();
        assert!(matches!(
            sync(home.path(), &config_with(&["claude"])),
            Err(Error::Invalid(_))
        ));
        assert_eq!(fs::read_to_string(dir.join("claude")).unwrap(), "user file");
    }
}
