#!/bin/sh
set -e
/scripts/copy-source.sh
cd /work
# The app embeds the built frontend; an empty one is enough to compile.
[ -d dist ] || mkdir -p dist
cargo clippy --locked -p envrouter --all-targets -- -D warnings
