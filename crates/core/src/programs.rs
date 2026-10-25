//! Finding the program behind a command name the way the shim does, so what the window says
//! about an agent (installed or not) can't disagree with what the shim then runs. Unix only, like
//! the shim.

use std::cell::OnceCell;
use std::ffi::OsStr;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

use crate::paths;

/// A regular file that someone may execute (one `stat`).
pub fn is_executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

/// Whether `candidate` runs the shim `me` or another installed copy of it, say one under a
/// scratch HOME. Two copies on PATH would otherwise exec each other back and forth.
pub fn is_shim(candidate: &Path, me: Option<&Path>) -> bool {
    let Ok(target) = fs::canonicalize(candidate) else {
        return false;
    };
    me == Some(target.as_path())
        || target
            .file_name()
            .is_some_and(|name| name == paths::SHIM_NAME)
}

fn dir_id(dir: &Path) -> Option<(u64, u64)> {
    fs::metadata(dir).ok().map(|meta| (meta.dev(), meta.ino()))
}

/// The first `tool` on `path` that isn't a shim. It skips the shims directory and anything
/// that resolves to the running shim (`current_exe`, asked only if something needs it) or another
/// copy of it, so a duplicated PATH entry, a stray link or a second install can't make shims
/// exec themselves or each other in a loop.
pub fn find_real(
    path: &OsStr,
    tool: &str,
    shims: Option<&Path>,
    current_exe: impl Fn() -> Option<PathBuf>,
) -> Option<PathBuf> {
    let shims_id = OnceCell::new();
    let me = OnceCell::new();
    std::env::split_paths(path)
        // An empty entry means the current directory. Never run a tool from there.
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| (dir.join(tool), dir))
        // Most entries don't have the tool, and one stat says so. Only a hit is then checked for
        // being the shims folder, by text or else by identity (a symlinked or differently cased
        // spelling of it), and for being a copy of the shim.
        .find(|(candidate, dir)| {
            is_executable(candidate)
                && shims.is_none_or(|shims| {
                    dir != shims
                        && shims_id
                            .get_or_init(|| dir_id(shims))
                            .is_none_or(|id| dir_id(dir) != Some(id))
                })
                && !is_shim(candidate, me.get_or_init(&current_exe).as_deref())
        })
        .map(|(candidate, _)| candidate)
}
