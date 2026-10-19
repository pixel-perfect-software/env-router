//! `envrouter-keychain read [ID...]`: prints the named secrets as one JSON object on stdout,
//! for the shim to pass to an agent. With no ids it prints `{}`, which still reads the item: the
//! app runs it that way after an install, so macOS asks to let this build in while the app is in
//! front. Values only ever travel through the pipe, never on a command line.
//!
//! The Windows build also answers the WSL bridge (`store/wsl.rs`), on the item itself:
//! `store-get <service> <account>` prints it (exit 3 when there's none), `store-set <service>
//! <account>` reads it from stdin, and `store-delete <service> <account>` removes it.

use std::collections::HashMap;
use std::env;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;

/// `store-get`'s exit status for an item that isn't there, which the bridge reads as "none".
const NOT_FOUND: u8 = 3;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["read", ids @ ..] => read(ids),
        ["store-get", service, account] => match envrouter_keychain::raw::get(service, account) {
            Ok(Some(bytes)) => {
                let mut stdout = std::io::stdout().lock();
                if stdout
                    .write_all(&bytes)
                    .and_then(|()| stdout.flush())
                    .is_err()
                {
                    return ExitCode::FAILURE;
                }
                ExitCode::SUCCESS
            }
            Ok(None) => ExitCode::from(NOT_FOUND),
            Err(err) => fail(&err),
        },
        ["store-set", service, account] => {
            let mut value = Vec::new();
            if let Err(err) = std::io::stdin().read_to_end(&mut value) {
                eprintln!("{err}");
                return ExitCode::FAILURE;
            }
            envrouter_keychain::raw::set(service, account, &value)
                .map_or_else(|err| fail(&err), |()| ExitCode::SUCCESS)
        }
        ["store-delete", service, account] => envrouter_keychain::raw::delete(service, account)
            .map_or_else(|err| fail(&err), |()| ExitCode::SUCCESS),
        _ => {
            eprintln!("usage: envrouter-keychain read [ID...]");
            ExitCode::from(2)
        }
    }
}

fn fail(err: &envrouter_core::Error) -> ExitCode {
    eprintln!("{err}");
    ExitCode::FAILURE
}

fn read(ids: &[&str]) -> ExitCode {
    let Some(home) = env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
    else {
        eprintln!("HOME isn't set");
        return ExitCode::from(2);
    };
    let mut secrets = match envrouter_keychain::read(&home) {
        Ok(secrets) => secrets,
        Err(err) => return fail(&err),
    };
    secrets.retain(|id, _| ids.contains(&id.as_str()));
    let json: HashMap<_, _> = secrets.into_iter().collect();
    println!(
        "{}",
        serde_json::to_string(&json).expect("a string map always serializes")
    );
    ExitCode::SUCCESS
}
