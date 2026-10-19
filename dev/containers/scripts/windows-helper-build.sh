#!/bin/sh
# Cross-compiles the Windows secrets helper with mingw, lints it, and leaves it in /out.
set -e
/scripts/copy-source.sh
cd /work
rustup target add x86_64-pc-windows-gnu >/dev/null
cargo clippy --locked -p envrouter-keychain --target x86_64-pc-windows-gnu --all-targets -- -D warnings
cargo build --locked --release -p envrouter-keychain --target x86_64-pc-windows-gnu
cp /target/x86_64-pc-windows-gnu/release/envrouter-keychain.exe /out/
echo "Built /out/envrouter-keychain.exe"
