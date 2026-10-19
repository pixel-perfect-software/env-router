//! EnvRouter's backend: everything the app does to the machine, with no UI. The desktop app
//! wraps these in Tauri commands; keeping them here lets them run headless and be tested
//! without a window.

pub mod editors;
pub mod mcp_import;
pub mod mcp_probe;
pub mod shell;
pub mod shims;
