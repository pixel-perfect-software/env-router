#!/bin/sh
# Exercises the Credential Manager through the Windows secrets helper, under Wine: the bridge a
# WSL distro uses (store-get, store-set, store-delete).
set -e
exe=/out/envrouter-keychain.exe
[ -f "$exe" ] || { echo "Run windows-helper-build first."; exit 1; }
export WINEDEBUG=-all WINEPREFIX=/tmp/wine
wineboot --init >/dev/null 2>&1 || true

service="EnvRouter MCP secrets"
account="wsl:test:/home/sam"
echo "== nothing stored yet (exit 3)"
wine "$exe" store-get "$service" "$account" && exit 1 || [ $? -eq 3 ]
echo "== a value larger than one credential (2,560 bytes) round-trips"
big=$(head -c 6000 /dev/zero | tr '\0' 'x')
printf '{"A1":"%s"}' "$big" | wine "$exe" store-set "$service" "$account"
got=$(wine "$exe" store-get "$service" "$account")
[ "$got" = "$(printf '{"A1":"%s"}' "$big")" ]
echo "== a shorter value replaces it and leaves no stale parts"
printf '{"B2":"two"}' | wine "$exe" store-set "$service" "$account"
[ "$(wine "$exe" store-get "$service" "$account")" = '{"B2":"two"}' ]
echo "== delete"
wine "$exe" store-delete "$service" "$account"
wine "$exe" store-get "$service" "$account" && exit 1 || [ $? -eq 3 ]
echo "Windows helper OK"
