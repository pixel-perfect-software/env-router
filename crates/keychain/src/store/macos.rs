//! The login Keychain: one generic-password item.

use envrouter_core::{Error, Result};
use security_framework::passwords;

/// `errSecItemNotFound`.
const NOT_FOUND: i32 = -25300;

pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    match passwords::get_generic_password(service, account) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.code() == NOT_FOUND => Ok(None),
        Err(err) => Err(keychain_error(&err)),
    }
}

/// The login Keychain is part of every Mac user account, so there is nothing to ask. A locked
/// or unreadable one shows when a value is saved, which is when macOS may prompt; asking here
/// would prompt on every window focus.
pub fn usable(_account: &str) -> Result<()> {
    Ok(())
}

pub fn set(service: &str, account: &str, value: &[u8]) -> Result<()> {
    passwords::set_generic_password(service, account, value).map_err(|err| keychain_error(&err))
}

/// Deleting an item that isn't there is fine.
pub fn delete(service: &str, account: &str) -> Result<()> {
    match passwords::delete_generic_password(service, account) {
        Err(err) if err.code() != NOT_FOUND => Err(keychain_error(&err)),
        _ => Ok(()),
    }
}

/// macOS's own message, attributed.
fn keychain_error(err: &security_framework::base::Error) -> Error {
    Error::SecretStore(format!("the Keychain said: {err}"))
}
