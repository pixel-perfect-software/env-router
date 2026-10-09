//! Keeps the installed shim binary current and `~/.envrouter/shims` holding one link per
//! routed tool.

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState};
use envrouter_core::{paths, Error, Result};

/// The shim shipped with the app, next to the app's own executable. That's where Tauri puts
/// `bundle.externalBin`: `Contents/MacOS` in the bundle, `target/<profile>` in development.
pub fn bundled() -> Result<PathBuf> {
    let exe = std::env::current_exe().map_err(|source| Error::Io {
        path: PathBuf::from("current executable"),
        source,
    })?;
    Ok(exe.with_file_name(paths::SHIM_NAME))
}

/// Copies `source` to the installed location if it's missing or different, e.g. after an
/// app update. The rename is atomic, so a shim that's running keeps its old inode.
pub fn install_binary(home: &Path, source: &Path) -> Result<()> {
    let dest = paths::shim_binary(home);
    let bytes = fs::read(source).map_err(|source_err| Error::Io {
        path: source.to_path_buf(),
        source: source_err,
    })?;
    if fs::read(&dest).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    config::write_atomic(&dest, &bytes)?;
    fs::set_permissions(&dest, fs::Permissions::from_mode(0o755)).map_err(|source| Error::Io {
        path: dest.clone(),
        source,
    })
}

pub fn is_installed(home: &Path, source: &Path) -> bool {
    match (fs::read(paths::shim_binary(home)), fs::read(source)) {
        (Ok(installed), Ok(bundled)) => installed == bundled,
        _ => false,
    }
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
            Err(_) if link.exists() => {
                return Err(Error::Invalid(format!(
                    "{} already exists and wasn't made by EnvRouter. Move it, then save again.",
                    link.display()
                )))
            }
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
            }],
            ..Default::default()
        }
    }

    #[test]
    fn install_binary_copies_once_and_makes_it_executable() {
        let home = tempfile::tempdir().unwrap();
        let source = Path::new(env!("ENVROUTER_STAGED_SHIM"));
        install_binary(home.path(), source).unwrap();
        let dest = paths::shim_binary(home.path());
        assert!(is_installed(home.path(), source));
        assert_eq!(
            fs::metadata(&dest).unwrap().permissions().mode() & 0o111,
            0o111
        );
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
