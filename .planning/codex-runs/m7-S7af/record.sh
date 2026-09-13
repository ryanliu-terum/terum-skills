#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
rec() { local out=$1; shift; printf '%s' "${STDIN:-}" | node "$CLI" --frames "$@" > "$OUT/$out" || true; }
# The six reads the S7af real-data proof replayed (verify.log): recorded with `search ''`, the term every
# m7-S7* codex-prompt names.
rec status.jsonl status
rec ls.jsonl ls
rec ls--local.jsonl ls --local
rec ls-member-mira.jsonl ls member mira
rec ls-project-terum.jsonl ls project terum
rec search.jsonl search ''
