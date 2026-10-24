#!/bin/sh
# Builds the Linux release bundles the way release.yml does, and lists the binaries in each.
set -e
/scripts/copy-source.sh
cd /work
rustup target add x86_64-pc-windows-gnu >/dev/null
cargo build --locked --profile helpers -p envrouter-keychain --target x86_64-pc-windows-gnu
exe=/target/x86_64-pc-windows-gnu/helpers/envrouter-keychain.exe
pnpm install --frozen-lockfile >/dev/null
# AppImage tooling is itself an AppImage, and containers have no FUSE.
export APPIMAGE_EXTRACT_AND_RUN=1
# Compiled, then bundled, as release.yml does, so only the bundle step gets the extra config.
pnpm tauri build --no-bundle
files="{\"files\":{\"/usr/bin/envrouter-keychain.exe\":\"$exe\"}}"
pnpm tauri bundle --config "{\"bundle\":{\"linux\":{\"deb\":$files,\"appimage\":$files}}}"
# The output volume outlives each run; only this build's bundles go in it, so the checks below see one of each.
rm -f /out/*.deb /out/*.AppImage
cp /target/release/bundle/deb/*.deb /target/release/bundle/appimage/*.AppImage /out/ 2>/dev/null || true
echo "== bundles"; ls -la /out
echo "== the .deb's binaries"; dpkg-deb -c /out/*.deb | grep -E "usr/bin/"
set -- /out/*.AppImage
echo "== the AppImage's binaries"; (cd /tmp && rm -rf squashfs-root && "$1" --appimage-extract 'usr/bin/*' >/dev/null && ls -la squashfs-root/usr/bin)
