//! The Windows Credential Manager: generic credentials. One credential holds at most
//! `CRED_MAX_CREDENTIAL_BLOB_SIZE` (2,560) bytes, so the item is split across numbered parts,
//! `<service>:<account>#0`, `#1` and so on, read until one is missing.
//!
//! WSL distros keep their secrets here too, through this build of the helper run over interop
//! (see `store/wsl.rs`), since a distro usually has no Secret Service of its own.

// The Credential Manager is a C API. Each call below is a single FFI call on buffers this
// module owns, and every credential the API returns is freed with `CredFree`.
#![allow(unsafe_code)]

use std::ptr;

use envrouter_core::{Error, Result};
use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE,
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

fn target(service: &str, account: &str, part: usize) -> Vec<u16> {
    format!("{service}:{account}#{part}")
        .encode_utf16()
        .chain(Some(0))
        .collect()
}

fn last_error(action: &str) -> Error {
    // SAFETY: reads the calling thread's last-error code; no arguments.
    let code = unsafe { GetLastError() };
    Error::SecretStore(format!(
        "the Credential Manager couldn't {action} the secrets (error {code})"
    ))
}

/// One part, or `None` when it doesn't exist.
fn read_part(target: &[u16]) -> Result<Option<Vec<u8>>> {
    let mut credential: *mut CREDENTIALW = ptr::null_mut();
    // SAFETY: `target` is a NUL-terminated UTF-16 string that outlives the call, and
    // `credential` is a valid out pointer.
    let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &raw mut credential) };
    if ok == 0 {
        // SAFETY: as in `last_error`.
        return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
            Ok(None)
        } else {
            Err(last_error("read"))
        };
    }
    // SAFETY: on success the API returns a valid credential whose blob holds
    // `CredentialBlobSize` bytes; both stay valid until `CredFree`, after the copy.
    let bytes = unsafe {
        let blob = &*credential;
        let bytes =
            std::slice::from_raw_parts(blob.CredentialBlob, blob.CredentialBlobSize as usize)
                .to_vec();
        CredFree(credential.cast());
        bytes
    };
    Ok(Some(bytes))
}

fn write_part(target: &mut [u16], bytes: &[u8]) -> Result<()> {
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        CredentialBlobSize: u32::try_from(bytes.len()).expect("parts are under 2,560 bytes"),
        // The API takes a mutable pointer but only reads the blob.
        CredentialBlob: bytes.as_ptr().cast_mut(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    // SAFETY: every pointer in `credential` points into `target` or `bytes`, which outlive
    // the call.
    if unsafe { CredWriteW(&raw const credential, 0) } == 0 {
        return Err(last_error("save"));
    }
    Ok(())
}

/// Deletes one part, and says whether it existed.
fn delete_part(target: &[u16]) -> Result<bool> {
    // SAFETY: `target` is a NUL-terminated UTF-16 string that outlives the call.
    if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
        return Ok(true);
    }
    // SAFETY: as in `last_error`.
    if unsafe { GetLastError() } == ERROR_NOT_FOUND {
        Ok(false)
    } else {
        Err(last_error("delete"))
    }
}

pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>> {
    let mut value = Vec::new();
    for part in 0.. {
        match read_part(&target(service, account, part))? {
            Some(bytes) => value.extend(bytes),
            None if part == 0 => return Ok(None),
            None => break,
        }
    }
    Ok(Some(value))
}

pub fn set(service: &str, account: &str, value: &[u8]) -> Result<()> {
    let chunks: Vec<&[u8]> = value
        .chunks(CRED_MAX_CREDENTIAL_BLOB_SIZE as usize)
        .collect();
    for (part, chunk) in chunks.iter().enumerate() {
        write_part(&mut target(service, account, part), chunk)?;
    }
    // A shorter value leaves the old item's later parts behind; take them out.
    let mut part = chunks.len();
    while delete_part(&target(service, account, part))? {
        part += 1;
    }
    Ok(())
}

/// Deleting an item that isn't there is fine.
pub fn delete(service: &str, account: &str) -> Result<()> {
    let mut part = 0;
    while delete_part(&target(service, account, part))? {
        part += 1;
    }
    Ok(())
}
