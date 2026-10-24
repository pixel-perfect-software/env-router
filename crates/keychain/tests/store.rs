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

#[test]
#[ignore = "uses the machine's secret store"]
fn finds_no_problem_with_a_store_it_can_use() {
    let home = tempfile::tempdir().unwrap();
    assert_eq!(envrouter_keychain::problem(home.path()), None);
}
