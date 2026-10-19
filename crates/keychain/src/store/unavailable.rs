//! Platforms without a store backend yet. Nothing is ever saved, so reading finds nothing to
//! lose, but saving a secret fails with a reason the window can show, and the shim leaves out a
//! server that needs one.

use envrouter_core::{Error, Result};

fn unavailable() -> Error {
    Error::Keychain("there's no secret store EnvRouter can use on this system".into())
}

pub fn get(_service: &str, _account: &str) -> Result<Option<Vec<u8>>> {
    Err(unavailable())
}

pub fn set(_service: &str, _account: &str, _value: &[u8]) -> Result<()> {
    Err(unavailable())
}

/// Nothing was ever stored, so there's nothing to delete.
pub fn delete(_service: &str, _account: &str) -> Result<()> {
    Ok(())
}
