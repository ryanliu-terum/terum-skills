#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}
# rec/drive, the CLI default (this checkout's dist/) and the stage-verify-move rule live in ../record-lib.sh (review r1 CRITICAL): a
# frame is written over the committed one only after its fresh recording is checked; a failed verb exits 1 and leaves it untouched.
. "$HERE/../record-lib.sh"
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
# gh reads its config under the fixture HOME, so it is installed-but-logged-out for every frame (the state the recordings were made in); no ambient token reaches the CLI.
unset GH_TOKEN GITHUB_TOKEN; export GH_CONFIG_DIR="$HOME/.config/gh"
rec ls.jsonl ls
rec ls-project-terum.jsonl ls project terum
rec ls-local.jsonl ls --local
rec search.jsonl search ''
rec status.jsonl status
rec validate-deploy-check.jsonl validate deploy-check
# The write the original session ran for real against the fixture's bare remote, then the member views that show it persisted.
rec profile.jsonl profile --role Platform
# decline.jsonl (`decline diagnose`): the verb is deleted (spec §12) — no current CLI can re-record it; the file is left untouched.
rec ls-member-mira.jsonl ls member mira
rec ls-member-ravi.jsonl ls member ravi
rec ls-member-seed.jsonl ls member seed
