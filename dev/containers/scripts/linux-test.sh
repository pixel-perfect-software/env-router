#!/bin/sh
set -e
/scripts/copy-source.sh
cd /work
crates="-p envrouter-core -p envrouter-shim -p envrouter-keychain -p envrouter-ops -p envrouter-cli"
cargo clippy --locked $crates --all-targets -- -D warnings
cargo test --locked $crates
dbus-run-session -- sh -c 'printf test | gnome-keyring-daemon --unlock --components=secrets >/dev/null && cargo test --locked -p envrouter-keychain -- --ignored'
