//! EnvRouter's backend: everything the app does to the machine, with no UI. The desktop app
//! wraps these in Tauri commands; keeping them here lets them run headless and be tested
//! without a window.

pub mod checked_once;
pub mod commands;
pub mod editors;
pub mod installed;
pub mod last_folder;
pub mod legacy_identifier;
pub mod mcp_import;
pub mod mcp_probe;
pub mod npm;
pub mod rpc;
pub mod shell;
pub mod shims;
pub mod uninstall;
