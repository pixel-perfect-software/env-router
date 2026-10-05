//! EnvRouter's profile model, validation and folder resolution, shared by the app and the shim.

pub mod config;
mod error;
pub mod paths;
pub mod resolve;

pub use error::{Error, Result};
