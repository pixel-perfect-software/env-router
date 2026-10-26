//! A round trip through the real secret store, under a scratch home so it never sees the user's
//! own secrets. Ignored by default because it uses the machine's store (and, on macOS, the login
//! Keychain). CI runs it on Linux against a GNOME Keyring started for the test:
//! `cargo test -p envrouter-keychain -- --ignored`.

use std::collections::{BTreeSet, HashMap};

#[test]
#[ignore = "uses the machine's secret store"]
fn saves_reads_updates_and_deletes_the_secrets() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    assert!(envrouter_keychain::read(home).unwrap().is_empty());

    let first = HashMap::from([("A1".to_string(), "one".to_string())]);
    envrouter_keychain::write(home, &first).unwrap();
    assert_eq!(envrouter_keychain::read(home).unwrap(), first);

    // Adds B2 and drops A1, which nothing uses any more.
    let added = HashMap::from([("B2".to_string(), "two".to_string())]);
    envrouter_keychain::update(home, &added, &BTreeSet::from(["B2"])).unwrap();
    assert_eq!(envrouter_keychain::read(home).unwrap(), added);

    envrouter_keychain::write(home, &HashMap::new()).unwrap();
    assert!(envrouter_keychain::read(home).unwrap().is_empty());
}

/// Over 5,120 bytes, so the Credential Manager keeps it in three parts.
#[test]
#[ignore = "uses the machine's secret store"]
fn deletes_the_whole_item_and_is_fine_with_none() {
    let home = tempfile::tempdir().unwrap();
    let home = home.path();
    envrouter_keychain::delete(home).unwrap();

    let big = HashMap::from([("A1".to_string(), "x".repeat(6000))]);
    envrouter_keychain::write(home, &big).unwrap();
    envrouter_keychain::delete(home).unwrap();
    assert!(envrouter_keychain::read(home).unwrap().is_empty());
}

#[test]
#[ignore = "uses the machine's secret store"]
fn finds_no_problem_with_a_store_it_can_use() {
    let home = tempfile::tempdir().unwrap();
    assert_eq!(envrouter_keychain::problem(home.path()), None);
}

/// The launcher reads the item through the installed helper (here a link to the built one) and
/// starts a server with the value, from an environment with no `HOME`, as Copilot starts one.
#[cfg(unix)]
#[test]
#[ignore = "uses the machine's secret store"]
fn the_launcher_starts_a_server_with_its_stored_secret() {
    use std::os::unix::fs::symlink;
    use std::process::Command;

    const HELPER: &str = env!("CARGO_BIN_EXE_envrouter-keychain");

    let home = tempfile::tempdir().unwrap();
    let home = std::fs::canonicalize(home.path()).unwrap();
    let bin = home.join(".envrouter/bin");
    std::fs::create_dir_all(&bin).unwrap();
    symlink(HELPER, bin.join("envrouter-keychain")).unwrap();
    let stored = HashMap::from([("7F3A".to_string(), "ghp_x".to_string())]);
    envrouter_keychain::write(&home, &stored).unwrap();

    let spec = home.join("github.json");
    let server = serde_json::json!({
        "server": "github",
        "home": home.display().to_string(),
        "command": "/bin/sh",
        "args": ["-c", r#"echo "$TOKEN""#],
        "env": { "TOKEN": { "secret": "7F3A" } },
    });
    std::fs::write(&spec, server.to_string()).unwrap();
    // The session bus address and the like stay: the store needs them. HOME doesn't.
    let output = Command::new(HELPER)
        .arg("exec")
        .arg(&spec)
        .env_remove("HOME")
        .output()
        .unwrap();

    // Before the asserts, so a failure leaves nothing in the store.
    envrouter_keychain::write(&home, &HashMap::new()).unwrap();
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "ghp_x\n",
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
