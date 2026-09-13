#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
# gh reads its config under the fixture HOME, so it is installed-but-logged-out for every frame (the state the recordings were made in); no ambient token reaches the CLI.
unset GH_TOKEN GITHUB_TOKEN; export GH_CONFIG_DIR="$HOME/.config/gh"
rec() { local out=$1; shift; printf '%s' "${STDIN:-}" | node "$CLI" --frames "$@" > "$OUT/$out" || true; }
rec ls.jsonl ls
rec ls-member-mira.jsonl ls member mira
rec ls-project-terum.jsonl ls project terum
rec ls-local.jsonl ls --local
rec search.jsonl search ''
rec validate-deploy-check.jsonl validate deploy-check
# status.jsonl is deliberately NOT re-recorded: desktop/src/backend/tauri/__tests__/replay.test.ts:18-20 keeps it as the
# older status schema (no ledger, identity or tools) the served surface must refuse.
