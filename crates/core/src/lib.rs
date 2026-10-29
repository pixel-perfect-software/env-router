//! EnvRouter's profile model, validation and folder resolution, shared by the app and the shim.

pub mod agents;
pub mod config;
mod error;
pub mod mcp;
pub mod paths;
pub mod platform;
#[cfg(unix)]
pub mod programs;
pub mod resolve;
pub mod secrets;
pub mod watcher;

pub use error::{Error, ErrorKind, Result};

/// The shim's exit status when the real tool isn't anywhere on PATH, the same status a
/// shell gives a missing command. The app's folder check reads it.
pub const EXIT_TOOL_NOT_FOUND: u8 = 127;

/// `0` turns the shim's MCP injection off for a run: the tool gets only the servers it
/// configures itself.
pub const MCP_VAR: &str = "ENVROUTER_MCP";

/// The variables someone sets in a terminal that change what the shim does. The app's folder
/// check hands each to the shim's explain step as the checked shell exports it, so a new one
/// belongs here too.
pub const SHIM_VARS: [&str; 1] = [MCP_VAR];
