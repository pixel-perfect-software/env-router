//! The login Keychain: one generic-password item.

use envrouter_core::{Error, Result};
use security_framework::passwords;

/// `errSecItemNotFound`.
const NOT_FOUND: i32 = -25300;

pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    match passwords::get_generic_password(service, account) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.code() == NOT_FOUND => Ok(None),
        Err(err) => Err(Error::Keychain(err.to_string())),
    }
}

pub fn set(service: &str, account: &str, value: &[u8]) -> Result<()> {
    passwords::set_generic_password(service, account, value)
        .map_err(|err| Error::Keychain(err.to_string()))
}

/// Deleting an item that isn't there is fine.
pub fn delete(service: &str, account: &str) -> Result<()> {
    match passwords::delete_generic_password(service, account) {
        Err(err) if err.code() != NOT_FOUND => Err(Error::Keychain(err.to_string())),
        _ => Ok(()),
    }
}
