//! Keeps the installed shim binary current and `~/.envrouter/shims` holding one link per
//! routed tool.

use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};

use envrouter_core::config::{self, ConfigState};
use envrouter_core::{paths, Error, Result};

/// The running executable, or the error every caller words the same way.
pub fn current_exe() -> Result<PathBuf> {
    std::env::current_exe().map_err(exe_error)
}

fn exe_error(source: std::io::Error) -> Error {
    Error::Io {
        path: PathBuf::from("current executable"),
        source,
    }
}

/// The shim shipped with the app or the CLI, next to the running executable. That's where Tauri
/// puts `bundle.externalBin` (`Contents/MacOS` in the bundle, `/usr/bin` from a `.deb`,
/// `target/<profile>` in development) and where a release archive puts it beside `envrouter`.
/// Links are followed, so a CLI linked into Homebrew's `bin` finds the files in its keg.
pub fn bundled() -> Result<PathBuf> {
    let exe = fs::canonicalize(current_exe()?).map_err(exe_error)?;
    Ok(exe.with_file_name(paths::SHIM_NAME))
}

/// The Keychain helper shipped with the app, beside the shim.
pub fn bundled_keychain() -> Result<PathBuf> {
    Ok(bundled()?.with_file_name(paths::KEYCHAIN_NAME))
}

/// The Windows build of the Keychain helper, beside the shim. Linux builds ship it, for WSL;
/// elsewhere the file isn't there.
pub fn bundled_windows_keychain() -> Result<PathBuf> {
    Ok(bundled()?.with_file_name(format!("{}.exe", paths::KEYCHAIN_NAME)))
}

/// Installs the shim and the Keychain helper the app ships with, if either is missing or
/// different, e.g. after an app update. Says whether either changed.
pub fn install_bundled(home: &Path) -> Result<bool> {
    let changed = install_binaries(home, &bundled()?, &bundled_keychain()?)?;
    let windows = bundled_windows_keychain()?;
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
/// it did. A temp file and a rename put it in place, so a shim that's running keeps its old
/// inode; a child `dd` writes the temp file (see `copy_to_new_file`).
pub fn install_binary(home: &Path, source: &Path) -> Result<bool> {
    install_file(&paths::shim_binary(home), source)
}

/// Installs the CLI at [`paths::cli_binary`], the same way.
pub fn install_cli(home: &Path, source: &Path) -> Result<bool> {
    install_file(&paths::cli_binary(home), source)
}

/// Everything that installs an executable lives in this unix-only module (it links shims with
/// `symlink` and sets modes), so none of it runs on native Windows yet. That platform is M7
/// work and will need its own copy step, since it has no `dd`.
pub(crate) fn install_file(dest: &Path, source: &Path) -> Result<bool> {
    install_file_with(dest, source, true)
}

/// [`install_file`], optionally without flushing the copy to disk before the rename. Tests skip
/// the flush: it's slow (macOS flushes the drive's cache too) and a crash can't matter there.
pub(crate) fn install_file_with(dest: &Path, source: &Path, sync: bool) -> Result<bool> {
    let io_err = |path: &Path| {
        let path = path.to_path_buf();
        move |source| Error::Io { path, source }
    };
    let wanted = fs::File::open(source).map_err(io_err(source))?;
    if has_contents_of(&wanted, dest) {
        return Ok(false);
    }
    drop(wanted);
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(io_err(dir))?;
    }
    let tmp = config::unused_temp_name(dest);
    let staged = copy_to_new_file(source, &tmp, sync).and_then(|()| {
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
            .and_then(|()| fs::rename(&tmp, dest))
            .map_err(io_err(dest))
    });
    if staged.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    staged.map(|()| true)
}

/// Whether the file at `path` holds exactly what `wanted` does. Any error says no.
fn has_contents_of(wanted: &fs::File, path: &Path) -> bool {
    use std::io::Read;
    let compare = || -> std::io::Result<bool> {
        let (mut wanted, mut have) = (wanted, fs::File::open(path)?);
        if wanted.metadata()?.len() != have.metadata()?.len() {
            return Ok(false);
        }
        let (mut a, mut b) = ([0_u8; 64 * 1024], [0_u8; 64 * 1024]);
        loop {
            let n = wanted.read(&mut a)?;
            if n == 0 {
                return Ok(true);
            }
            have.read_exact(&mut b[..n])?;
            if a[..n] != b[..n] {
                return Ok(false);
            }
        }
    };
    compare().unwrap_or(false)
}

/// Where a `dd` is looked for before PATH: an app started from Finder or a `.desktop` file has
/// a bare PATH, and another `dd` ahead of the system's shouldn't decide what runs here.
const DD_LOCATIONS: [&str; 4] = [
    "/bin/dd",
    "/usr/bin/dd",
    // NixOS has neither of the above.
    "/run/current-system/sw/bin/dd",
    "/nix/var/nix/profiles/default/bin/dd",
];

/// Copies `from` to `to`, a name nothing exists at, and flushes it to disk if `sync`, as
/// `config::write_atomic` does before its rename. A child `dd` does it, never this process. An
/// executable that's written here can't be run safely on Linux: this app forks all the time
/// (shell probes, server checks, npm, editors), and a child forked while the file is open for
/// writing holds that handle until it execs, however soon this process closes its own. Running
/// the file meanwhile fails with ETXTBSY ("Text file busy"): an agent started right after an
/// update, or the Keychain helper that `ask_keychain_access` runs just after its install. The
/// `dd` is the only process that ever holds the handle, and it's gone before the rename puts
/// the file where anything can run it. (A lock around this process's spawns wouldn't do: the
/// libraries it uses spawn on their own.)
///
/// `dd` rather than `cp`, which on macOS hands the source's `com.apple.quarantine` to the copy
/// (verified: `cp -X` and `ditto --noextattr` too, since copyfile carries it over itself). The
/// bundled shim has it from the download, and Gatekeeper would block an unnotarized one the
/// first time a terminal runs it. `dd` just writes bytes.
fn copy_to_new_file(from: &Path, to: &Path, sync: bool) -> Result<()> {
    let dd = DD_LOCATIONS
        .into_iter()
        .find(|dd| Path::new(dd).is_file())
        .unwrap_or("dd");
    let output = std::process::Command::new(dd)
        .arg(format!("if={}", from.display()))
        .arg(format!("of={}", to.display()))
        .arg("bs=65536")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|err| {
            Error::Command(format!(
                "could not run `dd` to install {}: {err}. EnvRouter needs it; put one on your PATH.",
                to.display()
            ))
        })?;
    if !output.status.success() {
        return Err(Error::Command(format!(
            "`dd` failed to copy {} ({}): {}",
            from.display(),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    if sync {
        // A read-only handle is enough for fsync and can't make the file busy.
        fs::File::open(to)
            .and_then(|file| file.sync_all())
            .map_err(|source| Error::Io {
                path: to.to_path_buf(),
                source,
            })?;
    }
    Ok(())
}

/// Writes a script for a test to run straight away, the way the app installs one: through a
/// side file and a child `dd`, so this process never holds the script open for writing (a test
/// thread that forks meanwhile would make running it fail on Linux, as `copy_to_new_file` says).
#[cfg(test)]
pub(crate) fn write_executable(path: &Path, contents: &str) {
    let source = path.with_extension("src");
    fs::write(&source, contents).unwrap();
    install_file_with(path, &source, false).unwrap();
}

/// Runs the installed Keychain helper once, in the background. A new build has a new ad hoc
/// signature, so macOS asks again before letting it read the secrets: better now, with the app
/// in front, than in the middle of someone's `claude`. It matters more since the helper started
/// MCP servers: it reads the store at every start of a server that needs a secret, several at
/// once as an agent connects, so the grant is asked for here, once, rather than by each of them.
/// The thread ends when the helper does, which waits for the answer to the prompt; the CLI joins
/// it, so its process doesn't end with the question unanswered.
pub fn ask_keychain_access(home: &Path) -> std::thread::JoinHandle<()> {
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
    })
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
    version_asked(&paths::shim_binary(home), paths::SHIM_CONFIG_VERSION_ARG)
}

/// The newest spec version the installed Keychain helper's `exec` reads, as it answers itself.
/// `None` without a helper, or with one from before the launcher, which prints its usage and
/// exits 2: a server rendered through it would fail with that usage when the agent starts it.
pub fn installed_launcher_version(home: &Path) -> Option<u32> {
    version_asked(
        &paths::keychain_helper(home),
        paths::KEYCHAIN_LAUNCHER_VERSION_ARG,
    )
}

/// What `binary` prints for `flag`, as a version number. Neither binary asked touches the secret
/// store or reads a config for this.
fn version_asked(binary: &Path, flag: &str) -> Option<u32> {
    let output = std::process::Command::new(binary)
        .arg(flag)
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

    /// On Linux, running a file fails with "Text file busy" while any process holds it open for
    /// writing, and a fork of this process holds this process's handles until it execs. So the
    /// install must never write the file here; the threads spawn all the while to catch it.
    /// Only Linux refuses (macOS would spend seconds in `fsync` proving nothing).
    #[cfg(target_os = "linux")]
    #[test]
    fn an_installed_executable_runs_while_other_threads_spawn() {
        use std::process::{Command, Stdio};
        use std::sync::atomic::{AtomicBool, Ordering};

        /// Stops the spawning threads however the test ends: `thread::scope` waits for them, so
        /// a panic that left them looping would hang the run instead of failing it.
        struct StopOnDrop<'a>(&'a AtomicBool);
        impl Drop for StopOnDrop<'_> {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Relaxed);
            }
        }

        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let source = root.path().join("source");
        let installed = paths::shim_binary(&home);
        let stop = AtomicBool::new(false);
        std::thread::scope(|scope| {
            let _stop_when_done = StopOnDrop(&stop);
            for _ in 0..4 {
                scope.spawn(|| {
                    while !stop.load(Ordering::Relaxed) {
                        let _ = Command::new("/bin/sh")
                            .args(["-c", ":"])
                            .stdout(Stdio::null())
                            .status();
                    }
                });
            }
            for round in 0..150 {
                fs::write(&source, format!("#!/bin/sh\n# {round}\nexit 0\n")).unwrap();
                assert!(install_binary(&home, &source).unwrap());
                let ran = Command::new(&installed).status();
                assert!(
                    ran.as_ref().is_ok_and(std::process::ExitStatus::success),
                    "round {round}: running the installed file gave {ran:?}"
                );
            }
        });
    }

    /// A download leaves `com.apple.quarantine` on the bundle, and macOS's `cp` hands it
    /// on even with `-X`; Gatekeeper blocks a quarantined, unnotarized shim at its first run.
    #[cfg(target_os = "macos")]
    #[test]
    fn an_installed_executable_does_not_inherit_the_quarantine_flag() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let dest = root.path().join("bin/installed");
        fs::write(&source, "#!/bin/sh\n").unwrap();
        let xattr = |args: &[&str], file: &Path| {
            std::process::Command::new("/usr/bin/xattr")
                .args(args)
                .arg(file)
                .output()
                .unwrap()
        };
        let flag = "com.apple.quarantine";
        assert!(xattr(&["-w", flag, "0081;00000000;Safari;"], &source)
            .status
            .success());
        assert!(xattr(&["-p", flag], &source).status.success());

        assert!(install_file(&dest, &source).unwrap());
        assert!(!xattr(&["-p", flag], &dest).status.success());
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
