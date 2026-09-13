#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}
# rec/drive, the CLI default (this checkout's dist/) and the stage-verify-move rule live in ../record-lib.sh (review r1 CRITICAL): a
# frame is written over the committed one only after its fresh recording is checked; a failed verb exits 1 and leaves it untouched.
. "$HERE/../record-lib.sh"
# Captured before HOME moves to the fixture: two recordings below need a LOGGED-IN gh (their recorded lines say
# "GitHub: gh is logged in."), so they borrow this machine's gh config and token; every other frame runs gh logged out.
REAL_GH_CONFIG_DIR=${GH_CONFIG_DIR:-$HOME/.config/gh}; REAL_GH_TOKEN=${GH_TOKEN:-}; REAL_GITHUB_TOKEN=${GITHUB_TOKEN:-}
logged_in_gh() { export GH_CONFIG_DIR="$REAL_GH_CONFIG_DIR"; if [ -n "$REAL_GH_TOKEN" ]; then export GH_TOKEN="$REAL_GH_TOKEN"; fi; if [ -n "$REAL_GITHUB_TOKEN" ]; then export GITHUB_TOKEN="$REAL_GITHUB_TOKEN"; fi; }
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
# gh reads its config under the fixture HOME, so it is installed-but-logged-out for every frame (the state the recordings were made in); no ambient token reaches the CLI.
unset GH_TOKEN GITHUB_TOKEN; export GH_CONFIG_DIR="$HOME/.config/gh"
# A machine that has never run setup: no config.json at all (status-zero reports teams [] and identity null).
ZERO_HOME="$FX/home-zero"; rm -rf "$ZERO_HOME"; mkdir -p "$ZERO_HOME"
HOME="$ZERO_HOME" GH_CONFIG_DIR="$ZERO_HOME/.config/gh" rec status-zero.jsonl status
# Guard (stage 2): the two creator-path frames below need a LOGGED-IN gh. When gh is logged out the CLI refuses at
# its GitHub check, and that refusal is a well-formed recording (a result frame, exit 1) — which is exactly what
# record-lib.sh's rule cannot tell from the real thing — so an unguarded run would overwrite both committed
# recordings with it. Each is therefore driven into a pending file (drive_to: no check, no mv) and handed to
# record_accept only when the fresh recording carries the print "GitHub: gh is logged in."; otherwise the
# committed frame is left untouched and a SKIPPED line says so. Logging gh in is never attempted here.
drive_logged_in() {
  local out=$1 pending status=0; shift
  pending=$(record_pending "$out")
  drive_to "$pending" "$@" || status=$?
  if grep -qF '"line":"GitHub: gh is logged in."' "$pending"; then
    record_accept "$out" "$pending" "$status" "$*"
  else
    echo "SKIPPED $out: gh is not logged in under the borrowed config (no \"GitHub: gh is logged in.\" print); the committed frame is kept as-is" >&2
    rm -f "$pending"
  fi
}
# The create fork: "Create a new team" chosen, gh logged in, then stdin closed at "Team name" — a recorded failure (result ok:false, exit 1), hence the allow.
( logged_in_gh; HOME="$ZERO_HOME" ANSWERS='["Create a new team"]' ALLOW_FAIL=1 drive_logged_in setup-create-fork.jsonl setup )
# The join hand-off: "Join an existing team" chosen; setup prints the owner-command hint and writes nothing (gh is never probed on this path).
HOME="$ZERO_HOME" GH_CONFIG_DIR="$ZERO_HOME/.config/gh" ANSWERS='["Join an existing team"]' drive setup-join-handoff.jsonl setup
# Resume on the configured machine (team acme, gh logged in): the recorded answers were q1 "" (invite), q2 false (hook),
# q3 false (Claude skill); today's setup also asks the project-folder and eval offers, answered here with their skip choices.
( logged_in_gh; ANSWERS='["", false, "Skip", false, false]' drive_logged_in setup-resume.jsonl setup )
