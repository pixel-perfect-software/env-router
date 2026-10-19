//! Where EnvRouter keeps its files, all under `~/.envrouter`.

use std::path::{Path, PathBuf};

pub const SHIM_NAME: &str = "envrouter-shim";
pub const KEYCHAIN_NAME: &str = "envrouter-keychain";

pub fn root(home: &Path) -> PathBuf {
    home.join(".envrouter")
}

/// Put first on PATH by the shell integration. Holds one symlink per routed tool, each
/// pointing at [`shim_binary`].
pub fn shims(home: &Path) -> PathBuf {
    root(home).join("shims")
}

/// The installed copy of the shim. It's a copy rather than a link into the app bundle, so
/// moving, renaming or updating the app can't break routing in open terminals.
pub fn shim_binary(home: &Path) -> PathBuf {
    root(home).join("bin").join(SHIM_NAME)
}

/// The Keychain helper, installed next to the shim. The shim starts it only when an MCP server
/// needs a secret, so the shim itself never links the Security framework.
pub fn keychain_helper(home: &Path) -> PathBuf {
    root(home).join("bin").join(KEYCHAIN_NAME)
}

/// Rendered MCP files: `<profile id>/<command>/`, holding one config file per server and the
/// launch manifest the shim reads. The app rewrites the whole folder on every save.
pub fn mcp(home: &Path) -> PathBuf {
    root(home).join("mcp")
}

pub fn mcp_launch(home: &Path, profile_id: &str, command: &str) -> PathBuf {
    mcp(home).join(profile_id).join(command).join("launch.json")
}
