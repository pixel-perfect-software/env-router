//! MCP secret values, kept in one item in the platform's secret store as a JSON map from id to
//! value. One item means one access prompt for the helper, not one per secret, after each
//! rebuild changes its ad hoc signature.
//!
//! The app links this crate to write secrets. The shim doesn't: it runs the
//! `envrouter-keychain` binary only when a server needs a secret, so launches that don't pay
//! nothing to load the store's framework.
//!
//! The item's account is the canonical home folder, so a run under a scratch `HOME` (every
//! test, and the safe way to try the app) never reads or writes the real secrets.
//!
//! Each platform's store is a module in `store/` with the same three functions on one item:
//! `get`, `set` and `delete`: the macOS Keychain, and the Secret Service (GNOME Keyring, KWallet)
//! on Linux. Where there's no store, every call says so, and a server that needs a secret is
//! left out.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::Path;

use envrouter_core::{Error, Result};

#[cfg_attr(target_os = "macos", path = "store/macos.rs")]
#[cfg_attr(all(unix, not(target_os = "macos")), path = "store/secret_service.rs")]
#[cfg_attr(not(unix), path = "store/unavailable.rs")]
mod store;

const SERVICE: &str = "EnvRouter MCP secrets";

fn account(home: &Path) -> String {
    fs::canonicalize(home)
        .unwrap_or_else(|_| home.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// Every secret, or an empty map if none were ever saved.
pub fn read(home: &Path) -> Result<HashMap<String, String>> {
    match store::get(SERVICE, &account(home))? {
        Some(bytes) => serde_json::from_slice(&bytes)
            .map_err(|err| Error::SecretStore(format!("the saved secrets are unreadable: {err}"))),
        None => Ok(HashMap::new()),
    }
}

/// Replaces every secret. An empty map deletes the item.
pub fn write(home: &Path, secrets: &HashMap<String, String>) -> Result<()> {
    let account = account(home);
    if secrets.is_empty() {
        return store::delete(SERVICE, &account);
    }
    let json = serde_json::to_vec(secrets).expect("a string map always serializes");
    store::set(SERVICE, &account, &json)
}

/// Adds `new` and drops every secret not in `keep`, in one read and one write. A save calls it
/// before writing `config.json`, so the config never names a secret that isn't stored yet.
pub fn update(home: &Path, new: &HashMap<String, String>, keep: &BTreeSet<&str>) -> Result<()> {
    let mut secrets = read(home)?;
    let before = secrets.clone();
    secrets.retain(|id, _| keep.contains(id.as_str()));
    secrets.extend(new.iter().map(|(id, value)| (id.clone(), value.clone())));
    if secrets == before {
        return Ok(());
    }
    write(home, &secrets)
}
