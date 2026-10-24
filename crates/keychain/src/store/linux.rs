//! Linux: the Secret Service on a desktop, or the Windows Credential Manager inside WSL.

use std::time::Duration;

use envrouter_core::platform::Platform;
use envrouter_core::{Error, Result};

use crate::checker::Checker;

#[path = "secret_service.rs"]
mod secret_service;
#[path = "wsl.rs"]
pub mod wsl;

fn in_wsl() -> bool {
    Platform::current() == Platform::Wsl
}

/// Longest the first ask waits for a store to answer: D-Bus starts the Secret Service on demand,
/// interop starts a process, and `setup_status` holds up the window.
const USABLE_TIMEOUT: Duration = Duration::from_secs(3);

static CHECKER: Checker = Checker::new();

/// Whether the store can be used: `Err` only when it has said it can't. A store that is slow to
/// answer is not known to be missing, so the window keeps offering the lock (see [`Checker`]).
pub fn usable(account: &str) -> Result<()> {
    CHECKER
        .ask(account, USABLE_TIMEOUT, |account| {
            let found = if in_wsl() {
                wsl::usable(account)
            } else {
                secret_service::usable()
            };
            found.map_err(|err| err.to_string())
        })
        .map_err(Error::SecretStore)
}

pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    if in_wsl() {
        wsl::get(service, account)
    } else {
        secret_service::get(service, account)
    }
}

pub fn set(service: &str, account: &str, value: &[u8]) -> Result<()> {
    if in_wsl() {
        wsl::set(service, account, value)
    } else {
        secret_service::set(service, account, value)
    }
}

pub fn delete(service: &str, account: &str) -> Result<()> {
    if in_wsl() {
        wsl::delete(service, account)
    } else {
        secret_service::delete(service, account)
    }
}
