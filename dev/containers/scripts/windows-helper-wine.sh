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
echo "== delete takes every part of a value larger than one credential, and none is fine"
printf '{"A1":"%s"}' "$big" | wine "$exe" store-set "$service" "$account"
wine "$exe" store-delete "$service" "$account"
wine "$exe" store-get "$service" "$account" && exit 1 || [ $? -eq 3 ]
wine "$exe" store-delete "$service" "$account"
echo "== delete also finds the parts past a missing #0 (an old failed cleanup), and leaves a longer account name alone"
# Wine keeps each credential as a registry key named for its target, and the bridge can't remove
# one part, so #0 goes the way a failed cleanup would have taken it.
key() { printf 'HKCU\\Software\\Wine\\Credential Manager\\Generic: %s:%s#%s' "$service" "$account" "$1"; }
other="$account#1"
printf '{"A1":"%s"}' "$big" | wine "$exe" store-set "$service" "$account"
printf '{"K":"keep"}' | wine "$exe" store-set "$service" "$other"
wine reg delete "$(key 0)" /f >/dev/null
wine reg query "$(key 1)" >/dev/null
wine reg query "$(key 2)" >/dev/null
wine "$exe" store-delete "$service" "$account"
if wine reg query "$(key 1)" >/dev/null 2>&1 || wine reg query "$(key 2)" >/dev/null 2>&1; then
  echo "a part past the gap survived the delete"
  exit 1
fi
[ "$(wine "$exe" store-get "$service" "$other")" = '{"K":"keep"}' ]
wine "$exe" store-delete "$service" "$other"
echo "Windows helper OK"
