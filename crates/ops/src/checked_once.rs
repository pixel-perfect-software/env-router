//! Whether first-run's last step, checking a folder, has been done. A check that comes back routed
//! leaves a file in `~/.envrouter` (`paths::checked_once`), as `last_folder` does for the menu
//! bar, rather than the window keeping it in its own storage: that storage belongs to one bundle
//! identifier, and goes when the identifier changes.

use std::path::Path;

use envrouter_core::{config, paths, Result};

pub fn is_recorded(home: &Path) -> bool {
    paths::checked_once(home).exists()
}

/// Notes that a check was done, writing only the first time.
pub fn record(home: &Path) -> Result<()> {
    if is_recorded(home) {
        return Ok(());
    }
    config::write_atomic(&paths::checked_once(home), "")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_recorded_once_and_only_after_a_record() {
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path();
        assert!(!is_recorded(home));
        record(home).unwrap();
        assert!(is_recorded(home));
        record(home).unwrap();
    }
}
