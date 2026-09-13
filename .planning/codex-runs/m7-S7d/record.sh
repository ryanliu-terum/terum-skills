#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
# gh reads its config under the fixture HOME, so it is installed-but-logged-out for every frame (the state the recordings were made in); no ambient token reaches the CLI.
unset GH_TOKEN GITHUB_TOKEN; export GH_CONFIG_DIR="$HOME/.config/gh"
rec() { local out=$1; shift; printf '%s' "${STDIN:-}" | node "$CLI" --frames "$@" > "$OUT/$out" || true; }
rec usage-error.jsonl install -x
# decline.jsonl (`connect <path>/cancel-example` answered no): connect is deleted (spec §12) and the recorded
# metadata.id was a fresh uuid — not re-recordable; the file is left untouched.
