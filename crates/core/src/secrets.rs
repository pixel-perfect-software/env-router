//! MCP secret values, kept in one generic-password item in the login Keychain as a JSON map
//! from id to value. One item means one access prompt for the shim, not one per secret, after
//! each rebuild changes its ad hoc signature.
//!
//! The item's account is the canonical home folder, so a run under a scratch `HOME` (every
//! test, and the safe way to try the app) never reads or writes the real secrets.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use security_framework::passwords;

use crate::error::{Error, Result};

const SERVICE: &str = "EnvRouter MCP secrets";
/// `errSecItemNotFound`.
const NOT_FOUND: i32 = -25300;

fn account(home: &Path) -> String {
    fs::canonicalize(home)
        .unwrap_or_else(|_| home.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// Every secret, or an empty map if none were ever saved.
pub fn read(home: &Path) -> Result<HashMap<String, String>> {
    match passwords::get_generic_password(SERVICE, &account(home)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|err| Error::Keychain(format!("the saved secrets are unreadable: {err}"))),
        Err(err) if err.code() == NOT_FOUND => Ok(HashMap::new()),
        Err(err) => Err(Error::Keychain(err.to_string())),
    }
}

/// Replaces every secret. An empty map deletes the item.
pub fn write(home: &Path, secrets: &HashMap<String, String>) -> Result<()> {
    let account = account(home);
    if secrets.is_empty() {
        return match passwords::delete_generic_password(SERVICE, &account) {
            Err(err) if err.code() != NOT_FOUND => Err(Error::Keychain(err.to_string())),
            _ => Ok(()),
        };
    }
    let json = serde_json::to_vec(secrets).expect("a string map always serializes");
    passwords::set_generic_password(SERVICE, &account, &json)
        .map_err(|err| Error::Keychain(err.to_string()))
}
