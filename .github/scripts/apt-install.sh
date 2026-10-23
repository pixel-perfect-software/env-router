#!/bin/sh
# Installs Ubuntu packages on a GitHub runner without letting a slow mirror stall the job.
# `apt-get update` refreshed every source the runner image lists, and a stalled mirror held
# the step until the job's timeout (the 0.7.0 release's CLI build sat in it for over 17
# minutes). So:
# - only Ubuntu's own archive is refreshed: the image's other sources (Microsoft's, Azure CLI's
#   and the like) hold nothing the workflows install;
# - each fetch gives up after 30 seconds and retries three times;
# - the update and the download are tried three times, each bounded by ATTEMPT_SECONDS, and
#   a later attempt keeps what an earlier one fetched;
# - only then does dpkg install, from the downloaded files, with no timeout of its own (the
#   step's bounds it): killing dpkg mid-configure leaves it interrupted, and every apt-get
#   after that fails with "dpkg was interrupted".
# Usage: apt-install.sh <package>...
set -eu

ATTEMPT_SECONDS=${ATTEMPT_SECONDS:-240}
SUDO=
[ "$(id -u)" -eq 0 ] || SUDO=sudo

# Ubuntu's archive is /etc/apt/sources.list (22.04) or sources.list.d/ubuntu.sources (24.04).
for source in /etc/apt/sources.list.d/*; do
  case "$source" in
    */ubuntu.sources | */\*) ;;
    *) $SUDO rm -f "$source" ;;
  esac
done

options='-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30'
install='env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends'
for attempt in 1 2 3; do
  # shellcheck disable=SC2086 # options and the package list split on purpose
  if $SUDO timeout "$ATTEMPT_SECONDS" apt-get $options update &&
    $SUDO timeout "$ATTEMPT_SECONDS" $install $options --download-only "$@"; then
    # shellcheck disable=SC2086
    exec $SUDO $install "$@"
  fi
  echo "apt-install: attempt $attempt didn't finish; trying again" >&2
done
echo "apt-install: couldn't download $* in three attempts" >&2
exit 1
