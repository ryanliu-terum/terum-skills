#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
# gh reads its config under the fixture HOME, so it is installed-but-logged-out for every frame (the state the recordings were made in); no ambient token reaches the CLI.
unset GH_TOKEN GITHUB_TOKEN; export GH_CONFIG_DIR="$HOME/.config/gh"
rec() { local out=$1; shift; printf '%s' "${STDIN:-}" | node "$CLI" --frames "$@" > "$OUT/$out" || true; }
# config-before/after.json live beside fixture.sh (identity-replay.test.ts reads them from the set directory).
SIDE=${SIDE:-$(dirname "$OUT")}
rec status-before.jsonl status
cp "$HOME/.terum/skills/config.json" "$SIDE/config-before.json"
rec login-set-name.jsonl login --set name=Seed2
cp "$HOME/.terum/skills/config.json" "$SIDE/config-after.json"
rec status-after.jsonl status
rec ls-local.jsonl ls --local
