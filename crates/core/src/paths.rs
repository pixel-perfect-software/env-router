//! Where EnvRouter keeps its files, all under `~/.envrouter`.

use std::path::{Path, PathBuf};

pub const SHIM_NAME: &str = "envrouter-shim";
pub const KEYCHAIN_NAME: &str = "envrouter-keychain";
pub const CLI_NAME: &str = "envrouter";
/// `envrouter-shim --config-version` prints the newest config version the shim reads. A CLI
/// asks before saving, so it never leaves an older shim than its own facing a config it refuses.
pub const SHIM_CONFIG_VERSION_ARG: &str = "--config-version";

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

/// The installed CLI, at a fixed place so another machine's window can run it there, e.g.
/// `wsl.exe -d <distro> -- ~/.envrouter/bin/envrouter rpc`.
pub fn cli_binary(home: &Path) -> PathBuf {
    root(home).join("bin").join(CLI_NAME)
}

/// The Windows build of the secrets helper, which a WSL distro runs over interop to keep its
/// secrets in the Windows Credential Manager.
pub fn windows_keychain_helper(home: &Path) -> PathBuf {
    root(home).join("bin").join(format!("{KEYCHAIN_NAME}.exe"))
}

/// The file the desktop app holds a lock on for as long as it runs, so `envrouter uninstall`
/// can tell the window is open: a window refocusing after the folder is gone would make it again.
pub fn app_lock(home: &Path) -> PathBuf {
    root(home).join("app.lock")
}

/// Rendered MCP files: `<profile id>/<command>/`, holding one config file per server and the
/// launch manifest the shim reads. The app rewrites the whole folder on every save.
pub fn mcp(home: &Path) -> PathBuf {
    root(home).join("mcp")
}

pub const MCP_LAUNCH_FILE: &str = "launch.json";

pub fn mcp_launch(home: &Path, profile_id: &str, command: &str) -> PathBuf {
    mcp(home)
        .join(profile_id)
        .join(command)
        .join(MCP_LAUNCH_FILE)
}

/// When each rendered MCP file a save stopped naming went stale, so a later save can remove it
/// once no agent can still be opening it. Beside [`mcp`], not in it, so no profile id meets it.
pub fn mcp_retired(home: &Path) -> PathBuf {
    root(home).join("mcp-retired.json")
}
