//! Cleans up after the bundle identifier earlier releases used (`platform::LEGACY_APP_IDENTIFIERS`).
//! The webview keys its storage by identifier, so what the old one left is useless to the
//! current one: the app deletes it, in the first launch that finds no older copy of the app
//! running, and an uninstall deletes it too (`platform::app_data_dirs`). Only the window's size and
//! position are worth carrying over, and the one answer in the old storage that first-run needs.

use std::fs;
use std::io;
use std::path::Path;

use envrouter_core::platform::{self, Platform, XdgHomes};
use envrouter_core::{config, paths};

use crate::uninstall::{remove_legacy_with, Keychain, Store};
use crate::{checked_once, shell};

/// In the current identifier's config folder: `done` once the cleanup has removed everything, or
/// the number of launches that left something behind. A launch that left something tries again,
/// up to [`TRIES`] times in all, so a folder that stays stuck doesn't make every launch run it.
const MARKER: &str = ".legacy-cleaned";
const DONE: &str = "done";
const TRIES: u32 = 3;

/// Copies the window-state file `file` from an older identifier's config folder into
/// `config_dir`, the current identifier's (Tauri's `app_config_dir`, whose parent holds the
/// others), unless the current one already has its own. The window-state plugin reads it when it
/// starts, so this has to run before the plugin is set up. It only reads the old folder, so it
/// is safe while an older copy of the app is running. Whether a file was copied.
pub fn carry_window_state(config_dir: &Path, file: &str) -> io::Result<bool> {
    let target = config_dir.join(file);
    let Some(parent) = config_dir.parent() else {
        return Ok(false);
    };
    if target.exists() {
        return Ok(false);
    }
    for id in platform::LEGACY_APP_IDENTIFIERS {
        let source = parent.join(id).join(file);
        if source.is_file() {
            fs::create_dir_all(config_dir)?;
            fs::copy(&source, &target)?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// First-run's last step (a folder check) was kept in the old identifier's webview storage,
/// which the new identifier doesn't see. Notes it as done for an install that was plainly set up
/// before: the old app ran here, the config has a profile, and a shell block is installed. Not a
/// record of a check, which nothing kept, but the same situation: setting up was finished.
/// Only file reads, so it runs before the window loads and the window's first status already
/// has it. Whether it noted anything.
pub fn carry_checked_once(home: &Path) -> envrouter_core::Result<bool> {
    carry_checked_once_on(Platform::current(), home)
}

fn carry_checked_once_on(platform: Platform, home: &Path) -> envrouter_core::Result<bool> {
    let old_app_ran_here = || any_legacy_folder(platform, home);
    let has_a_profile = || {
        config::load(&paths::root(home))
            .ok()
            .flatten()
            .is_some_and(|config| !config.profiles.is_empty())
    };
    if checked_once::is_recorded(home)
        || !old_app_ran_here()
        || !has_a_profile()
        || !shell::block_in_home_files(home)
    {
        return Ok(false);
    }
    checked_once::record(home)?;
    Ok(true)
}

fn any_legacy_folder(platform: Platform, home: &Path) -> bool {
    platform::app_data_dirs(platform, home, &platform::LEGACY_APP_IDENTIFIERS)
        .iter()
        .any(|folder| fs::symlink_metadata(folder).is_ok())
}

/// What the first launches do about the old identifier's folders: delete them and have the system
/// forget the old preferences (see [`remove_legacy_with`]). Returns a sentence for everything
/// worth logging: what it left (a folder it couldn't delete, one outside the home folder, a
/// link's target) and why it couldn't tell whether an older app runs. An uninstall names the
/// folders left again.
///
/// - Nothing old on disk (a fresh install): notes it as done and asks nothing of the system.
/// - An older copy of the app running (0.7.2 and before don't hold `app.lock`; an AppImage, a
///   `.deb` or a copied app isn't quit by the cask): waits, noting nothing, since deleting would
///   pull the folders from under its webview. A process list that can't be had counts as
///   not running, once, so a broken `ps` doesn't hold it up for good.
/// - Everything removed: notes it as done. Something left: counts the launch, up to [`TRIES`].
pub fn clean_up_old_identifier(home: &Path, config_dir: &Path, xdg: &XdgHomes) -> Vec<String> {
    let uid = nix::unistd::getuid().as_raw();
    clean_up(
        Platform::current(),
        home,
        config_dir,
        xdg,
        &Keychain,
        || another_app_running(Platform::current(), uid, std::process::id()),
    )
}

fn clean_up(
    platform: Platform,
    home: &Path,
    config_dir: &Path,
    xdg: &XdgHomes,
    store: &dyn Store,
    another_app_running: impl FnOnce() -> Result<bool, String>,
) -> Vec<String> {
    let marker = config_dir.join(MARKER);
    let tried = match fs::read_to_string(&marker) {
        Ok(text) if text.trim() == DONE => return Vec::new(),
        Ok(text) => text.trim().parse::<u32>().unwrap_or(0),
        Err(_) => 0,
    };
    if tried >= TRIES {
        return Vec::new();
    }
    let note = |text: &str| fs::create_dir_all(config_dir).and_then(|()| fs::write(&marker, text));
    if !any_legacy_folder(platform, home) {
        return note(DONE)
            .err()
            .map(|err| format!("Couldn't note that there is nothing old to clear: {err}."))
            .into_iter()
            .collect();
    }
    let mut told = Vec::new();
    match another_app_running() {
        Ok(true) => return told,
        Ok(false) => {}
        Err(why) => told.push(format!(
            "Couldn't tell whether an older EnvRouter is running: {why}."
        )),
    }
    let left = remove_legacy_with(platform, home, xdg, store);
    let outcome = if left.is_empty() {
        DONE.to_string()
    } else {
        (tried + 1).to_string()
    };
    if let Err(err) = note(&outcome) {
        told.push(format!(
            "Couldn't note that the old identifier's folders were cleared: {err}."
        ));
    }
    told.extend(left);
    told
}

/// Whether this user's processes include one running the app's binary other than `own`. A second
/// copy of the current app counts too: waiting costs nothing.
fn another_app_running(platform: Platform, uid: u32, own: u32) -> Result<bool, String> {
    platform::user_processes(platform, uid).map(|processes| any_other_app(platform, own, processes))
}

fn any_other_app(
    platform: Platform,
    own: u32,
    processes: impl IntoIterator<Item = (u32, String)>,
) -> bool {
    processes
        .into_iter()
        .any(|(pid, exe)| pid != own && platform::is_app_binary(platform, &exe))
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;

    use super::*;
    use crate::uninstall::fake::FakeStore;

    const FILE: &str = ".window-state.json";

    fn legacy_dirs(platform: Platform, home: &Path) -> Vec<PathBuf> {
        platform::app_data_dirs(platform, home, &platform::LEGACY_APP_IDENTIFIERS)
    }

    /// A scratch home with a folder, holding a file, for each identifier in every place macOS
    /// keeps one. Returns the legacy folders, the current ones, and the current config folder.
    fn both_ids_on_macos(home: &Path) -> (Vec<PathBuf>, Vec<PathBuf>, PathBuf) {
        let legacy = legacy_dirs(Platform::MacOs, home);
        let current = platform::app_data_dirs(Platform::MacOs, home, &[platform::APP_IDENTIFIER]);
        for folder in legacy.iter().chain(&current) {
            fs::create_dir_all(folder).unwrap();
            fs::write(folder.join("data"), "x").unwrap();
        }
        let config = current.last().unwrap().clone();
        (legacy, current, config)
    }

    fn clean(home: &Path, config: &Path, store: &FakeStore, running: bool) -> Vec<String> {
        clean_up(
            Platform::MacOs,
            home,
            config,
            &XdgHomes::default(),
            store,
            || Ok(running),
        )
    }

    fn marker(config: &Path) -> Option<String> {
        fs::read_to_string(config.join(MARKER)).ok()
    }

    #[test]
    fn clears_the_legacy_folders_once_and_leaves_the_current_ones() {
        let home = tempfile::tempdir().unwrap();
        let (legacy, current, config) = both_ids_on_macos(home.path());
        let store = FakeStore::default();

        let told = clean(home.path(), &config, &store, false);

        assert!(told.is_empty(), "{told:?}");
        assert!(legacy.iter().all(|folder| !folder.exists()));
        assert!(current.iter().all(|folder| folder.join("data").is_file()));
        assert_eq!(
            *store.forgotten.borrow(),
            [platform::LEGACY_APP_IDENTIFIERS[0]]
        );
        assert_eq!(marker(&config).as_deref(), Some(DONE));

        // Once: a folder that turns up later isn't touched.
        fs::create_dir_all(&legacy[0]).unwrap();
        clean(home.path(), &config, &store, false);
        assert!(legacy[0].is_dir());
        assert_eq!(store.forgotten.borrow().len(), 1);
    }

    #[test]
    fn waits_for_a_running_app_and_tries_again_at_the_next_launch() {
        let home = tempfile::tempdir().unwrap();
        let (legacy, _, config) = both_ids_on_macos(home.path());
        let store = FakeStore::default();

        assert!(clean(home.path(), &config, &store, true).is_empty());
        assert!(legacy.iter().all(|folder| folder.is_dir()));
        assert!(store.forgotten.borrow().is_empty());
        assert_eq!(marker(&config), None);

        clean(home.path(), &config, &store, false);
        assert!(legacy.iter().all(|folder| !folder.exists()));
    }

    /// A machine that never had the old app asks nothing of the system: no process list, no
    /// `defaults`.
    #[test]
    fn a_fresh_install_is_noted_done_without_asking_anything() {
        let home = tempfile::tempdir().unwrap();
        let config = home.path().join("config");
        let store = FakeStore::default();

        let told = clean_up(
            Platform::MacOs,
            home.path(),
            &config,
            &XdgHomes::default(),
            &store,
            || panic!("no process list is needed"),
        );

        assert!(told.is_empty());
        assert!(store.forgotten.borrow().is_empty());
        assert_eq!(marker(&config).as_deref(), Some(DONE));
    }

    #[test]
    fn a_process_list_that_cant_be_had_is_told_once_and_doesnt_hold_it_up() {
        let home = tempfile::tempdir().unwrap();
        let (legacy, _, config) = both_ids_on_macos(home.path());

        let told = clean_up(
            Platform::MacOs,
            home.path(),
            &config,
            &XdgHomes::default(),
            &FakeStore::default(),
            || Err("couldn't run ps".into()),
        );

        assert_eq!(told.len(), 1, "{told:?}");
        assert!(told[0].contains("couldn't run ps"));
        assert!(legacy.iter().all(|folder| !folder.exists()));
    }

    #[test]
    fn tells_what_it_leaves() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().join("home");
        let (outside, target) = (scratch.path().join("xdg"), scratch.path().join("moved"));
        let legacy = platform::LEGACY_APP_IDENTIFIERS[0];
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&home).unwrap();
        // A legacy folder that is a link, and one under an XDG folder outside the home folder.
        let linked = legacy_dirs(Platform::Linux, &home)[0].clone();
        fs::create_dir_all(linked.parent().unwrap()).unwrap();
        symlink(&target, &linked).unwrap();
        fs::create_dir_all(outside.join(legacy)).unwrap();
        let xdg = XdgHomes {
            data: None,
            config: Some(outside.clone()),
        };
        let config = home.join("config");
        let launch = || {
            clean_up(
                Platform::Linux,
                &home,
                &config,
                &xdg,
                &FakeStore::default(),
                || Ok(false),
            )
        };

        let told = launch();

        assert!(!linked.exists() && target.is_dir());
        assert_eq!(told.len(), 2, "{told:?}");
        assert!(told
            .iter()
            .any(|line| line.contains(&target.display().to_string())));
        assert!(told
            .iter()
            .any(|line| line.contains(&outside.join(legacy).display().to_string())));
        assert!(outside.join(legacy).is_dir());
        // A folder outside home can't be retried away, and nothing is left in it: not tried again.
        assert_eq!(marker(&config).as_deref(), Some("1"));
        assert!(launch().is_empty());
        assert_eq!(marker(&config).as_deref(), Some(DONE));
    }

    /// A folder that won't go is tried at three launches, then left to the uninstall.
    #[test]
    fn gives_up_after_a_few_launches_on_a_folder_that_wont_go() {
        use std::os::unix::fs::PermissionsExt;

        if nix::unistd::geteuid().is_root() {
            return; // Root deletes from a folder it can't write to.
        }
        let home = tempfile::tempdir().unwrap();
        let (legacy, _, config) = both_ids_on_macos(home.path());
        let webkit = legacy[0].parent().unwrap().to_path_buf();
        fs::set_permissions(&webkit, fs::Permissions::from_mode(0o555)).unwrap();
        let store = FakeStore::default();

        for tried in 1..=TRIES {
            let told = clean(home.path(), &config, &store, false);
            assert_eq!(told.len(), 1, "{told:?}");
            assert_eq!(marker(&config), Some(tried.to_string()));
        }
        let forgotten = store.forgotten.borrow().len();
        assert!(clean(home.path(), &config, &store, false).is_empty());
        assert_eq!(store.forgotten.borrow().len(), forgotten);

        fs::set_permissions(&webkit, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn another_copy_of_the_app_is_one_that_runs_its_binary_under_another_pid() {
        let processes = |list: &[(u32, &str)]| -> Vec<(u32, String)> {
            list.iter()
                .map(|&(pid, exe)| (pid, exe.to_string()))
                .collect()
        };
        let linux = "/tmp/.mount_EnvRouAbc/usr/bin/envrouter-app";
        assert!(any_other_app(
            Platform::Linux,
            1,
            processes(&[(2, "/bin/ls"), (3, linux)])
        ));
        // Itself, and the CLI, are not another copy.
        assert!(!any_other_app(Platform::Linux, 3, processes(&[(3, linux)])));
        assert!(!any_other_app(
            Platform::Linux,
            1,
            processes(&[(2, "/opt/homebrew/bin/envrouter")])
        ));
    }

    /// A Mac that was set up with the old app has no answer to first-run's last step in the new
    /// storage; one that wasn't, or isn't set up, gets none made up.
    #[test]
    fn carries_first_runs_last_step_over_for_a_set_up_install_only() {
        let carries = |old_app: bool, profile: bool, shell: bool| {
            let home = tempfile::tempdir().unwrap();
            let h = home.path();
            if old_app {
                fs::create_dir_all(&legacy_dirs(Platform::MacOs, h)[0]).unwrap();
            }
            if profile {
                fs::create_dir_all(paths::root(h)).unwrap();
                fs::write(
                    paths::root(h).join("config.json"),
                    format!(
                        r#"{{"version":{},"profiles":[{{"id":"a","name":"A"}}]}}"#,
                        config::CONFIG_VERSION
                    ),
                )
                .unwrap();
            }
            if shell {
                fs::write(
                    h.join(".zshrc"),
                    "# >>> envrouter >>>\nx\n# <<< envrouter <<<\n",
                )
                .unwrap();
            }
            let carried = carry_checked_once_on(Platform::MacOs, h).unwrap();
            assert_eq!(carried, checked_once::is_recorded(h));
            carried
        };
        assert!(carries(true, true, true));
        assert!(!carries(false, true, true));
        assert!(!carries(true, false, true));
        assert!(!carries(true, true, false));
    }

    #[test]
    fn carries_the_window_state_over_once() {
        let home = tempfile::tempdir().unwrap();
        let config = platform::app_config_dir(Platform::MacOs, home.path());
        let new = config.join(platform::APP_IDENTIFIER);
        let old = config.join(platform::LEGACY_APP_IDENTIFIERS[0]);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join(FILE), "old frame").unwrap();

        assert!(carry_window_state(&new, FILE).unwrap());
        assert_eq!(fs::read_to_string(new.join(FILE)).unwrap(), "old frame");

        // A frame the current identifier saved since is not overwritten.
        fs::write(new.join(FILE), "new frame").unwrap();
        assert!(!carry_window_state(&new, FILE).unwrap());
        assert_eq!(fs::read_to_string(new.join(FILE)).unwrap(), "new frame");
    }

    #[test]
    fn carries_nothing_without_a_legacy_window_state() {
        let home = tempfile::tempdir().unwrap();
        let new =
            platform::app_config_dir(Platform::MacOs, home.path()).join(platform::APP_IDENTIFIER);

        assert!(!carry_window_state(&new, FILE).unwrap());
        assert!(!new.exists());
    }
}
