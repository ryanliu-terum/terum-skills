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
# The recorded usage error: the CLI exits 1 by design, so this call — and only this one — accepts it (record-lib.sh rule 1).
ALLOW_FAIL=1 rec usage-error.jsonl install -x
# decline.jsonl (`connect <path>/cancel-example` answered no): connect is deleted (spec §12) and the recorded
# metadata.id was a fresh uuid — not re-recordable; the file is left untouched.
