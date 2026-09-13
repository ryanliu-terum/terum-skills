#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}
# rec/drive, the CLI default (this checkout's dist/) and the stage-verify-move rule live in ../record-lib.sh (review r1 CRITICAL): a
# frame is written over the committed one only after its fresh recording is checked; a failed verb exits 1 and leaves it untouched.
. "$HERE/../record-lib.sh"
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX"; mkdir -p "$OUT"
# The four frames are one story in this order: the project is added (the argv the app sends, `--` and the
# absolute path), the Library is read with its two folders present, read again with the folder tree absent,
# and the project is removed.
rec project-add.jsonl project add -- "$FX/repo/app"
rec ls-local.jsonl ls --local
mv "$FX/repo/app/.claude/skills" "$FX/repo/app/.claude/skills.away"
rec ls-local-missing.jsonl ls --local
mv "$FX/repo/app/.claude/skills.away" "$FX/repo/app/.claude/skills"
rec project-remove.jsonl project remove -- "$FX/repo/app"
