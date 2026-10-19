//! The freedesktop Secret Service, which GNOME Keyring and KWallet provide, over D-Bus: one item
//! in the default collection, found by its `service` and `account` attributes. A locked keyring
//! asks the user to unlock it, as the Keychain does on macOS.

use std::collections::HashMap;

use envrouter_core::{Error, Result};
use secret_service::blocking::{Collection, Item, SecretService};
use secret_service::{EncryptionType, Error as StoreError};

fn connect() -> Result<SecretService<'static>> {
    SecretService::connect(EncryptionType::Dh).map_err(store_error)
}

fn attributes<'a>(service: &'a str, account: &'a str) -> HashMap<&'a str, &'a str> {
    HashMap::from([("service", service), ("account", account)])
}

/// The item, unlocking it first if its collection is locked.
fn find<'a>(store: &'a SecretService<'a>, service: &str, account: &str) -> Result<Vec<Item<'a>>> {
    let found = store
        .search_items(attributes(service, account))
        .map_err(store_error)?;
    if !found.locked.is_empty() {
        store
            .unlock_all(&found.locked.iter().collect::<Vec<_>>())
            .map_err(store_error)?;
    }
    Ok(found.unlocked.into_iter().chain(found.locked).collect())
}

pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    let store = connect()?;
    let items = find(&store, service, account)?;
    match items.first() {
        Some(item) => item.get_secret().map(Some).map_err(store_error),
        None => Ok(None),
    }
}

pub fn set(service: &str, account: &str, value: &[u8]) -> Result<()> {
    let store = connect()?;
    let collection = default_collection(&store)?;
    collection.ensure_unlocked().map_err(store_error)?;
    // `replace` swaps out an item with the same attributes rather than adding a second one.
    collection
        .create_item(
            service,
            attributes(service, account),
            value,
            true,
            "application/json",
        )
        .map(drop)
        .map_err(store_error)
}

/// Deleting an item that isn't there is fine.
pub fn delete(service: &str, account: &str) -> Result<()> {
    let store = connect()?;
    for item in find(&store, service, account)? {
        item.delete().map_err(store_error)?;
    }
    Ok(())
}

/// The collection secrets go to by default (the login keyring), or any there is.
fn default_collection<'a>(store: &'a SecretService<'a>) -> Result<Collection<'a>> {
    store
        .get_default_collection()
        .or_else(|_| store.get_any_collection())
        .map_err(store_error)
}

fn store_error(err: StoreError) -> Error {
    Error::SecretStore(match err {
        StoreError::Unavailable | StoreError::Zbus(_) => {
            "there's no Secret Service to keep secrets in (GNOME Keyring or KWallet). Install or start one, then try again".into()
        }
        StoreError::Prompt => "the keyring prompt was dismissed".into(),
        StoreError::PromptDisconnected => "the keyring went away while asking to unlock".into(),
        StoreError::Locked => "the keyring is locked".into(),
        StoreError::NoResult => "the keyring has no collection to keep secrets in".into(),
        other => other.to_string(),
    })
}
