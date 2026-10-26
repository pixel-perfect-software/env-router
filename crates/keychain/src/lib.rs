//! MCP secret values, kept in one item in the platform's secret store as a JSON map from id to
//! value. One item means one access prompt for the helper, not one per secret, after each
//! rebuild changes its ad hoc signature.
//!
//! The app links this crate to write secrets. The shim doesn't: it runs the
//! `envrouter-keychain` binary only when a server needs a secret, so launches that don't pay
//! nothing to load the store's framework. The binary's `exec` (Unix) starts a stdio server that
//! needs a secret, in the agent's place, with the values in that server's environment alone.
//!
//! The item's account is the canonical home folder, so a run under a scratch `HOME` (every
//! test, and the safe way to try the app) never reads or writes the real secrets.
//!
//! Each platform's store is a module in `store/` with the same functions on one item: `get`,
//! `set` and `delete`, and `usable`, which asks whether the store can be used without touching
//! the item. They are the macOS Keychain, the Secret Service (GNOME Keyring, KWallet) on
//! Linux, the Credential Manager on Windows, and inside WSL the Windows Credential Manager
//! through the Windows build of the helper. Where there's no store, every call says so, and a
//! server that needs a secret is left out.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::Path;

use envrouter_core::{Error, Result};

#[cfg_attr(target_os = "macos", path = "store/macos.rs")]
#[cfg_attr(all(unix, not(target_os = "macos")), path = "store/linux.rs")]
#[cfg_attr(windows, path = "store/windows.rs")]
#[cfg_attr(not(any(unix, windows)), path = "store/unavailable.rs")]
mod store;

/// The store's own item, for the helper's bridge commands: the Windows build answers them for
/// the Linux side of a WSL distro.
pub mod raw {
    pub use super::store::{delete, get, set};
    pub use super::SERVICE;
}

pub const SERVICE: &str = "EnvRouter MCP secrets";

fn account(home: &Path) -> String {
    fs::canonicalize(home)
        .unwrap_or_else(|_| home.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// Why the store can't keep secrets right now, or `None` when it can or when it hasn't said
/// (a store that is slow to answer isn't known to be missing). The window asks this whenever it
/// gains focus, so it touches no secret and never unlocks or prompts: see each store's `usable`.
pub fn problem(home: &Path) -> Option<String> {
    store::usable(&account(home))
        .err()
        .map(|err| err.to_string())
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

/// Deletes the item, every part of it, without reading it first (a read is a prompt on some
/// stores, and so is the delete: one is enough). An item that isn't there is fine. The failure
/// comes back as a sentence an uninstall can show as it is.
pub fn delete(home: &Path) -> Result<()> {
    store::delete(SERVICE, &account(home)).map_err(|err| {
        reworded(err, |why| {
            format!("Couldn't delete the stored MCP secrets: {why}.")
        })
    })
}

/// Adds `new` and drops every secret not in `keep`, in one read and one write. A save calls it
/// before writing `config.json`, so the config never names a secret that isn't stored yet. A
/// store's failure comes back as a sentence a save can show as it is.
pub fn update(home: &Path, new: &HashMap<String, String>, keep: &BTreeSet<&str>) -> Result<()> {
    rewrite(home, new, keep).map_err(|err| {
        reworded(err, |why| {
            format!("Couldn't save the secret: {why}. Nothing was saved.")
        })
    })
}

/// Drops every secret not in `keep`. A save calls it last, once the config it wrote names
/// none of them, so a failure leaves only a secret nothing uses. The save counts, and carries
/// the failure as its warning.
pub fn prune(home: &Path, keep: &BTreeSet<&str>) -> Result<()> {
    rewrite(home, &HashMap::new(), keep).map_err(|err| {
        reworded(err, |why| {
            format!("Couldn't remove a secret no server uses any more: {why}.")
        })
    })
}

fn rewrite(home: &Path, new: &HashMap<String, String>, keep: &BTreeSet<&str>) -> Result<()> {
    let mut secrets = read(home)?;
    let before = secrets.clone();
    secrets.retain(|id, _| keep.contains(id.as_str()));
    secrets.extend(new.iter().map(|(id, value)| (id.clone(), value.clone())));
    if secrets == before {
        return Ok(());
    }
    write(home, &secrets)
}

/// Each store words its own reason, naming itself, to go inside a sentence like these.
fn reworded(err: Error, sentence: impl Fn(&str) -> String) -> Error {
    match err {
        Error::SecretStore(why) => Error::SecretStore(sentence(why.trim_end_matches('.'))),
        other => other,
    }
}
