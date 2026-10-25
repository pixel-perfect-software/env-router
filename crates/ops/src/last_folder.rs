//! The folder the window last checked, so the menu bar can offer to check it again. The menu
//! bar is Rust and the window's `localStorage` isn't readable from it, so the window's checks
//! leave the folder here, in `~/.envrouter/last-folder.json` (which an uninstall removes with
//! the rest).

use std::fs;
use std::path::{Path, PathBuf};

use envrouter_core::{config, paths, Result};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Saved {
    folder: PathBuf,
}

/// Keeps `folder` as the last one checked, writing only when that changes what is kept (a check
/// of the same folder again, as an automatic re-check does, writes nothing). Says whether it
/// turned the menu bar's item on: there was no folder to check before, or it had gone.
pub fn remember(home: &Path, folder: &Path) -> Result<bool> {
    let stored = kept(home);
    let offered_before = stored.as_deref().is_some_and(Path::is_dir);
    if stored.as_deref() != Some(folder) {
        let saved = Saved {
            folder: folder.to_path_buf(),
        };
        let json = serde_json::to_vec(&saved).expect("a path always serializes");
        config::write_atomic(&paths::last_folder(home), json)?;
    }
    Ok(!offered_before)
}

/// What the file says, whether or not that folder is still there.
fn kept(home: &Path) -> Option<PathBuf> {
    let bytes = fs::read(paths::last_folder(home)).ok()?;
    serde_json::from_slice::<Saved>(&bytes)
        .ok()
        .map(|saved| saved.folder)
}

/// The last folder checked, if it's still a folder. A file that is missing or unreadable says
/// none; the menu bar reads it whenever the pointer reaches the icon, so it never complains.
pub fn recall(home: &Path) -> Option<PathBuf> {
    kept(home).filter(|folder| folder.is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The newest check replaces the one before, and a folder that has since gone is no folder to
    /// check again.
    #[test]
    fn the_last_folder_is_the_latest_one_that_still_exists() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().join("home");
        let (first, second) = (scratch.path().join("a"), scratch.path().join("b"));
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        assert_eq!(recall(&home), None);

        remember(&home, &first).unwrap();
        remember(&home, &second).unwrap();
        assert_eq!(recall(&home), Some(second.clone()));

        fs::remove_dir(&second).unwrap();
        assert_eq!(recall(&home), None);
    }

    /// Every check calls it, automatic re-checks included, so the same folder again writes
    /// nothing, and only the check that gives the menu bar something to offer says so.
    #[test]
    fn a_repeat_writes_nothing_and_only_the_first_turns_the_item_on() {
        use std::os::unix::fs::MetadataExt;
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().join("home");
        let (first, second) = (scratch.path().join("a"), scratch.path().join("b"));
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        // A write goes through a new file and a rename, so it shows as a new inode.
        let file_id = || fs::metadata(paths::last_folder(&home)).unwrap().ino();

        assert!(remember(&home, &first).unwrap());
        let written = file_id();
        assert!(!remember(&home, &first).unwrap());
        assert_eq!(file_id(), written);

        assert!(!remember(&home, &second).unwrap());
        assert_ne!(file_id(), written);

        fs::remove_dir(&second).unwrap();
        assert!(remember(&home, &first).unwrap());
    }
}
