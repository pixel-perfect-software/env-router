#!/bin/sh
# Renders the Homebrew cask and formula from packaging/homebrew as a release would, with
# placeholder checksums, and runs `brew style` and `brew audit --strict` on them, so a broken
# template fails a pull request instead of `brew install` for everyone after a release.
# The audit needs the files in a tap Homebrew trusts: a scratch one, removed at the end.
# Offline: the placeholder version's downloads don't exist.
# Usage: lint-homebrew.sh   (from the repository root, with brew on PATH)
set -eu

version=$(node -p "require('./package.json').version")
work=$(mktemp -d)
tap=envrouter-ci/scratch
cleanup() {
  brew untap "$tap" >/dev/null 2>&1 || true
  brew untrust "$tap" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

sum=0000000000000000000000000000000000000000000000000000000000000000
for file in "EnvRouter-$version-arm64.zip" \
  "envrouter-cli-$version-aarch64-apple-darwin.tar.gz" \
  "envrouter-cli-$version-x86_64-unknown-linux-gnu.tar.gz" \
  "envrouter-cli-$version-aarch64-unknown-linux-gnu.tar.gz"; do
  echo "$sum  $file"
done > "$work/SHA256SUMS"
sh packaging/homebrew/render.sh "$version" "$work/SHA256SUMS" "$work/out"

brew style "$work/out/Formula/envrouter-cli.rb" "$work/out/Casks/envrouter.rb"

brew tap-new --no-git "$tap" >/dev/null
brew trust "$tap" >/dev/null
dir=$(brew --repo "$tap")
mkdir -p "$dir/Casks"
cp "$work/out/Formula/envrouter-cli.rb" "$dir/Formula/"
cp "$work/out/Casks/envrouter.rb" "$dir/Casks/"
brew audit --strict --formula "$tap/envrouter-cli"
brew audit --strict --cask "$tap/envrouter"
echo "lint-homebrew: the formula and cask for $version pass brew style and brew audit --strict"
