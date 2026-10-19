//! Linux: the Secret Service on a desktop, or the Windows Credential Manager inside WSL.

use envrouter_core::platform::Platform;
use envrouter_core::Result;

#[path = "secret_service.rs"]
mod secret_service;
#[path = "wsl.rs"]
pub mod wsl;

fn in_wsl() -> bool {
    Platform::current() == Platform::Wsl
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
