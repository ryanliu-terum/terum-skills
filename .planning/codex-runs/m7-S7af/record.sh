#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}
# rec/drive, the CLI default (this checkout's dist/) and the stage-verify-move rule live in ../record-lib.sh (review r1 CRITICAL): a
# frame is written over the committed one only after its fresh recording is checked; a failed verb exits 1 and leaves it untouched.
. "$HERE/../record-lib.sh"
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
# The six reads the S7af real-data proof replayed (verify.log): recorded with `search ''`, the term every
# m7-S7* codex-prompt names.
rec status.jsonl status
rec ls.jsonl ls
rec ls--local.jsonl ls --local
rec ls-member-mira.jsonl ls member mira
rec ls-project-terum.jsonl ls project terum
rec search.jsonl search ''
