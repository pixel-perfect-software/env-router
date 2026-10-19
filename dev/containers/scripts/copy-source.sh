#!/bin/sh
# Copies the read-only checkout to /work, without build output or node_modules.
set -e
mkdir -p /work
cd /src && tar --exclude=./target --exclude=./node_modules --exclude=./src-tauri/binaries -cf - . | tar -xf - -C /work
