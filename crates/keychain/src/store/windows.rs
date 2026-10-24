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
    CredDeleteW, CredEnumerateW, CredFree, CredReadW, CredWriteW, CREDENTIALW,
    CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

fn target(service: &str, account: &str, part: usize) -> Vec<u16> {
    format!("{}{part}", target_prefix(service, account))
        .encode_utf16()
        .chain(Some(0))
        .collect()
}

/// What every part's target name starts with: `<service>:<account>#`.
fn target_prefix(service: &str, account: &str) -> String {
    format!("{service}:{account}#")
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

/// The Credential Manager is part of Windows and takes no unlocking, so there is nothing to ask.
pub fn usable(_account: &str) -> Result<()> {
    Ok(())
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

/// The numbers of the item's parts that exist, found by name with the Credential Manager's own
/// prefix filter, so no blob is read and a part past a missing one (an old failed cleanup) is
/// found too.
fn parts_present(service: &str, account: &str) -> Result<Vec<usize>> {
    let prefix = target_prefix(service, account);
    let filter: Vec<u16> = format!("{prefix}*").encode_utf16().chain(Some(0)).collect();
    let mut count: u32 = 0;
    let mut credentials: *mut *mut CREDENTIALW = ptr::null_mut();
    // SAFETY: `filter` is a NUL-terminated UTF-16 string that outlives the call, and `count`
    // and `credentials` are valid out pointers.
    let ok = unsafe { CredEnumerateW(filter.as_ptr(), 0, &raw mut count, &raw mut credentials) };
    if ok == 0 {
        // SAFETY: as in `last_error`.
        return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
            Ok(Vec::new())
        } else {
            Err(last_error("list"))
        };
    }
    let mut names = Vec::new();
    // SAFETY: on success `credentials` points to `count` valid credential pointers, each with a
    // NUL-terminated `TargetName` (the one we filtered on, so never null); all of it stays valid
    // until `CredFree`, after the names are copied out.
    unsafe {
        for &credential in std::slice::from_raw_parts(credentials, count as usize) {
            let credential = &*credential;
            if credential.Type != CRED_TYPE_GENERIC || credential.TargetName.is_null() {
                continue;
            }
            let mut len = 0;
            while *credential.TargetName.add(len) != 0 {
                len += 1;
            }
            names.push(String::from_utf16_lossy(std::slice::from_raw_parts(
                credential.TargetName,
                len,
            )));
        }
        CredFree(credentials.cast());
    }
    Ok(part_numbers(&prefix, &names))
}

/// The part numbers among `names`, which are target names that matched `prefix*`. Another
/// account that merely begins with this one's (`…/sam#1` against `…/sam`) leaves something
/// other than a number after the prefix, and is not ours. Names compare without regard to case,
/// as the Credential Manager's do.
fn part_numbers(prefix: &str, names: &[String]) -> Vec<usize> {
    let mut parts: Vec<usize> = names
        .iter()
        .filter_map(|name| {
            let head = name.get(..prefix.len())?;
            let tail = name.get(prefix.len()..)?;
            if !head.eq_ignore_ascii_case(prefix) || !tail.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            tail.parse().ok()
        })
        .collect();
    parts.sort_unstable();
    parts.dedup();
    parts
}

/// Deleting an item that isn't there is fine. Every part present goes, from the last down to
/// `#0`, so a failure part-way leaves parts from `#0` up, which `get` still reads, rather than
/// stranding some behind a gap.
pub fn delete(service: &str, account: &str) -> Result<()> {
    for part in parts_present(service, account)?.into_iter().rev() {
        delete_part(&target(service, account, part))?;
    }
    Ok(())
}
