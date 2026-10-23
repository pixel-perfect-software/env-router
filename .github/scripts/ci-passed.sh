#!/bin/sh
# Succeeds once CI passed on a commit: its latest CI run (ci.yml) concluded `success`, and so did
# each check named here. A run still going is waited for, up to WAIT_SECONDS, since a tag is
# often pushed right after its merge. A commit with no run, or whose run was cancelled or failed,
# fails at once. The release runs this so it can only ship a commit CI finished testing (v0.6.0
# shipped from one whose run on main was cancelled).
# Usage: ci-passed.sh <sha> <check>...   (needs GH_TOKEN and GITHUB_REPOSITORY)
set -eu

sha=$1
shift
wait_seconds=${WAIT_SECONDS:-2400}
deadline=$(($(date +%s) + wait_seconds))
api="repos/$GITHUB_REPOSITORY"

while :; do
  # The latest run, since a rerun or a later push of the same commit adds another.
  run=$(gh api "$api/actions/workflows/ci.yml/runs?head_sha=$sha&per_page=100" \
    --jq '.workflow_runs | sort_by(.run_started_at) | last | if . == null then "none" else "\(.status) \(.conclusion // "") \(.html_url)" end')
  case "$run" in
    none) echo "ci-passed: CI never ran on $sha" >&2; exit 1 ;;
    'completed success '*) break ;;
    completed*) echo "ci-passed: CI didn't pass on $sha (${run#completed }); rerun it, then the release" >&2; exit 1 ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "ci-passed: CI is still running on $sha after ${wait_seconds}s ($run)" >&2
    exit 1
  fi
  echo "ci-passed: waiting for CI on $sha ($run)"
  sleep 30
done

# A run passes when every job it ran passed; these are the checks branch protection requires,
# so they must have run, not been left out.
for check in "$@"; do
  state=$(gh api "$api/commits/$sha/check-runs?check_name=$check&filter=latest" \
    --jq '.check_runs | sort_by(.started_at) | last | if . == null then "missing" else .conclusion end')
  if [ "$state" != success ]; then
    echo "ci-passed: CI passed on $sha, but its $check check is $state" >&2
    exit 1
  fi
done
echo "ci-passed: CI passed on $sha (${run#completed success }), $* included"
