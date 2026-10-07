//! EnvRouter's profile model, validation and folder resolution, shared by the app and the shim.

pub mod config;
mod error;
pub mod paths;
pub mod resolve;

pub use error::{Error, Result};

/// The shim's exit status when the real tool isn't anywhere on PATH, the same status a
/// shell gives a missing command. The app's folder check reads it.
pub const EXIT_TOOL_NOT_FOUND: u8 = 127;
