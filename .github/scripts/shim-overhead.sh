#!/bin/sh
# Measures what the shim adds to an agent launch: the median time of a tool run through the shim
# in a scratch home with TRIGGERS trigger folders, minus the median of the same tool run through
# a program that only execs it. Prints the overhead in milliseconds; with a limit, fails over it.
# Usage: shim-overhead.sh <envrouter-shim> [limit-ms]   (needs cc, node and hyperfine 2; TRIGGERS=60)
set -eu

shim=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
limit=${2:-}
triggers=${TRIGGERS:-60}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
home="$work/home"
mkdir -p "$home/.envrouter/shims" "$work/bin"

# The baseline execs the tool and nothing else; the tool exits at once, so the launch is all
# that's timed.
printf '#include <unistd.h>\nint main(int c, char **v) { (void)c; execv(v[1], v + 1); return 127; }\n' > "$work/exec.c"
printf 'int main(void) { return 0; }\n' > "$work/tool.c"
command -v hyperfine >/dev/null || { echo "shim-overhead: needs hyperfine" >&2; exit 1; }
cc -O2 -o "$work/exec-only" "$work/exec.c"
cc -O2 -o "$work/bin/claude" "$work/tool.c"
ln -s "$shim" "$home/.envrouter/shims/claude"

# Profiles of five triggers each; the folder sits under the last one, so every trigger is looked at.
profiles=$(((triggers + 4) / 5))
{
  printf '{ "version": 5, "profiles": ['
  n=0 p=0
  while [ "$p" -lt "$profiles" ]; do
    [ "$p" -gt 0 ] && printf ','
    printf '{ "id": "p%s", "name": "P%s", "triggerPaths": [' "$p" "$p"
    t=0
    while [ "$t" -lt 5 ] && [ "$n" -lt "$triggers" ]; do
      [ "$t" -gt 0 ] && printf ','
      printf '"~/dev/p%s/t%s"' "$p" "$t"
      mkdir -p "$home/dev/p$p/t$t"
      t=$((t + 1)) n=$((n + 1))
    done
    printf '], "tools": { "claude": { "envVar": "CLAUDE_CONFIG_DIR", "path": "~/.claude-p%s" } } }' "$p"
    p=$((p + 1))
  done
  printf '] }\n'
} > "$home/.envrouter/config.json"
folder="$home/dev/p$((profiles - 1))/t$(((triggers - 1) % 5))/src/app"
mkdir -p "$folder"

cd "$folder"
HOME=$home PATH="$home/.envrouter/shims:$work/bin:/usr/bin:/bin" ENVROUTER_EXPLAIN=1 "$home/.envrouter/shims/claude" > "$work/route.json"
grep -q "\"profile\":\"P$((profiles - 1))\"" "$work/route.json" || {
  echo "shim-overhead: the shim didn't route the folder to P$((profiles - 1)): $(cat "$work/route.json")" >&2
  exit 1
}
hyperfine=$(command -v hyperfine)
HOME=$home PATH="$home/.envrouter/shims:$work/bin:/usr/bin:/bin" "$hyperfine" -N --warmup 50 --runs 1000 \
  --export-json "$work/times.json" \
  "$home/.envrouter/shims/claude" "$work/exec-only $work/bin/claude" > /dev/null

# hyperfine 2's layout: results[].summary.<metric>.median. Instructions, where the CPU's counters
# can be read, are far steadier than wall time, so they're shown beside it.
read -r overhead instructions <<EOF
$(node -e '
  const [shim, bare] = require(process.argv[1]).results.map((r) => r.summary)
  const ms = ((shim.time_wall_clock.median - bare.time_wall_clock.median) * 1000).toFixed(3)
  const ins = shim.instructions && bare.instructions ? Math.round(shim.instructions.median - bare.instructions.median) : "n/a"
  console.log(ms, ins)
' "$work/times.json")
EOF
echo "shim-overhead: ${overhead} ms median over a bare exec, ${triggers} triggers (${instructions} instructions)"
if [ -n "$limit" ] && node -e 'process.exit(+process.argv[1] > +process.argv[2] ? 0 : 1)' "$overhead" "$limit"; then
  echo "shim-overhead: over the ${limit} ms limit" >&2
  exit 1
fi
