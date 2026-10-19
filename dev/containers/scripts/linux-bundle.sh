#!/bin/sh
# Builds the Linux release bundles the way release.yml does, and checks what's inside the .deb.
set -e
/scripts/copy-source.sh
cd /work
rustup target add x86_64-pc-windows-gnu >/dev/null
cargo build --locked --release -p envrouter-keychain --target x86_64-pc-windows-gnu
exe=/target/x86_64-pc-windows-gnu/release/envrouter-keychain.exe
pnpm install --frozen-lockfile >/dev/null
# AppImage tooling is itself an AppImage, and containers have no FUSE.
export APPIMAGE_EXTRACT_AND_RUN=1
pnpm tauri build --config "{\"bundle\":{\"linux\":{\"deb\":{\"files\":{\"/usr/bin/envrouter-keychain.exe\":\"$exe\"}}}}}"
cp /target/release/bundle/deb/*.deb /target/release/bundle/appimage/*.AppImage /out/ 2>/dev/null || true
echo "== bundles"; ls -la /out
echo "== the .deb's binaries"; dpkg-deb -c /out/*.deb | grep -E "usr/bin/" 
