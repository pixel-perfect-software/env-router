//! `envrouter-keychain read [ID...]`: prints the named secrets as one JSON object on stdout,
//! for the shim to pass to an agent. With no ids it prints `{}`, which still reads the item: the
//! app runs it that way after an install, so macOS asks to let this build in while the app is in
//! front. Values only ever travel through the pipe, never on a command line.

use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    if args.next().as_deref() != Some("read") {
        eprintln!("usage: envrouter-keychain read [ID...]");
        return ExitCode::from(2);
    }
    let Some(home) = env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
    else {
        eprintln!("HOME isn't set");
        return ExitCode::from(2);
    };
    let mut secrets = match envrouter_keychain::read(&home) {
        Ok(secrets) => secrets,
        Err(err) => {
            eprintln!("{err}");
            return ExitCode::FAILURE;
        }
    };
    let wanted: Vec<String> = args.collect();
    secrets.retain(|id, _| wanted.contains(id));
    let json: HashMap<_, _> = secrets.into_iter().collect();
    println!(
        "{}",
        serde_json::to_string(&json).expect("a string map always serializes")
    );
    ExitCode::SUCCESS
}
