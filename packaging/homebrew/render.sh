#!/bin/sh
# Renders the Homebrew cask and formula for a release from its SHA256SUMS:
#   packaging/homebrew/render.sh <version> <SHA256SUMS> <out dir>
# Writes <out>/Casks/envrouter.rb and <out>/Formula/envrouter-cli.rb, as homebrew-tap keeps them.
set -eu
version=$1 sums=$2 out=$3
here=$(dirname "$0")
sha() {
  value=$(awk -v f="$1" '$2 == f || $2 == "*" f { print $1 }' "$sums")
  [ -n "$value" ] || { echo "no checksum for $1 in $sums" >&2; exit 1; }
  echo "$value"
}
mkdir -p "$out/Casks" "$out/Formula"
sed -e "s/@VERSION@/$version/g" \
    -e "s/@SHA_APP_MACOS@/$(sha "EnvRouter-$version-arm64.zip")/" \
    "$here/envrouter.rb.in" > "$out/Casks/envrouter.rb"
sed -e "s/@VERSION@/$version/g" \
    -e "s/@SHA_CLI_AARCH64_APPLE_DARWIN@/$(sha "envrouter-cli-$version-aarch64-apple-darwin.tar.gz")/" \
    -e "s/@SHA_CLI_X86_64_UNKNOWN_LINUX_GNU@/$(sha "envrouter-cli-$version-x86_64-unknown-linux-gnu.tar.gz")/" \
    -e "s/@SHA_CLI_AARCH64_UNKNOWN_LINUX_GNU@/$(sha "envrouter-cli-$version-aarch64-unknown-linux-gnu.tar.gz")/" \
    "$here/envrouter-cli.rb.in" > "$out/Formula/envrouter-cli.rb"
