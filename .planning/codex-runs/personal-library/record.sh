#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX"; mkdir -p "$OUT"
rec() { local out=$1; shift; printf '%s' "${STDIN:-}" | node "$CLI" --frames "$@" > "$OUT/$out" || true; }
# The four frames are one story in this order: the project is added (the argv the app sends, `--` and the
# absolute path), the Library is read with its two folders present, read again with the folder tree absent,
# and the project is removed.
rec project-add.jsonl project add -- "$FX/repo/app"
rec ls-local.jsonl ls --local
mv "$FX/repo/app/.claude/skills" "$FX/repo/app/.claude/skills.away"
rec ls-local-missing.jsonl ls --local
mv "$FX/repo/app/.claude/skills.away" "$FX/repo/app/.claude/skills"
rec project-remove.jsonl project remove -- "$FX/repo/app"
