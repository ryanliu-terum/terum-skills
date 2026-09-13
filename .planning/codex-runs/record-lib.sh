#!/usr/bin/env bash
# Sourced (never run) by every .planning/codex-runs/<set>/record.sh: the CLI resolution and the
# stage-verify-move recorder the fifteen drivers used to carry as a copy-pasted one-liner.
#
# Why (hybrid review r1 of refactor/frames-rerecord, CRITICAL): the old
#   rec() { … | node "$CLI" --frames "$@" > "$OUT/$out" || true; }
# opened `> "$OUT/$out"` — the COMMITTED golden frame, since OUT defaults to the set's frames/ — in
# truncate mode before node ran, and `|| true` forced the pipeline to 0 under `set -euo pipefail`. A
# missing dist/, a thrown error, a failed push against the fixture's bare remote: each left the
# previously-good frame empty or partial, and the driver marched on and exited 0. `drive()` was worse —
# its drive.cjs zeroed the committed file as its first statement, before the child was even spawned.
# The oracle (capture-frames.test.ts) then `continue`d past the zero-row file, so nothing went red.
#
# Now every frame is recorded to a scratch file under $FX, checked, and only then moved over the
# committed one. A frame is accepted only when
#   1. the CLI exited 0 — or the call itself said `ALLOW_FAIL=1` AND the recorded result says ok:false
#      (the recorded failures: m7-S7d's `install -x`, mock-vs-real's four `*-nope` reads, and the two
#      setup drives that close stdin at an ask);
#   2. it is non-empty and every line parses as JSON;
#   3. its LAST line is a `{"t":"result",…}` frame whose `ok` agrees with the exit status.
# Anything else stops the run with exit 1 naming the verb, and the committed frame is left byte-for-byte
# as it was. The helper never touches $OUT except by that final mv.
#
# Contract for a driver (see any record.sh):
#   HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}
#   . "$HERE/../record-lib.sh"
#   rec   <out.jsonl> <verb> [args…]   printf "$STDIN" | node "$CLI" --frames <verb> … → $OUT/<out.jsonl>
#   drive <out.jsonl> <verb> [args…]   the same through drive.cjs, answering asks from $ANSWERS (a JSON array)
#   drive_to <file> <verb> [args…]     drive.cjs into an explicit file with no check and no mv, for a driver
#                                      that has its own acceptance rule (first-run-in-app's logged-in gh
#                                      frames) — it then calls record_accept itself.
# CLI: taken from the environment when set, otherwise the CONTAINING checkout's dist/index.js. Never one
# developer's absolute worktree path (review r1, MEDIUM): that default pointed at a gitignored artifact in
# a scratch worktree, so any other checkout either died with Cannot find module or — worse — recorded
# against whatever stale build still sat there and produced a plausible, wrong fixture.

RECORD_LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLI=${CLI:-$RECORD_LIB_DIR/../../dist/index.js}
if [ ! -f "$CLI" ]; then
  echo "record.sh: no CLI build at $CLI — run \`npm run build\` in that checkout, or export CLI=<path to dist/index.js>" >&2
  exit 1
fi
# Absolute, because the drivers `cd` into the fixture before the first recording.
CLI=$(cd "$(dirname "$CLI")" && pwd)/$(basename "$CLI")
echo "record.sh: recording with $CLI" >&2

# The scratch file a recording is staged in; created lazily because fixture.sh rebuilds $FX after this
# file is sourced.
record_pending() { mkdir -p "$FX/pending"; printf '%s' "$FX/pending/$1"; }

# record_accept <out.jsonl> <pending file> <exit status> <argv as one string>: the acceptance rule above,
# then the mv. Exits the driver (1) on refusal; the pending file is removed, $OUT/<out> is untouched.
record_accept() {
  local out=$1 pending=$2 status=$3 argv=$4 verdict
  if ! verdict=$(node -e '
    const fs = require("node:fs");
    const [file, status, allow] = process.argv.slice(1);
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "");
    const refuse = (why) => { console.log(why); process.exit(1); };
    if (lines.length === 0) refuse("the CLI wrote nothing");
    let last;
    for (const [index, line] of lines.entries()) { try { last = JSON.parse(line); } catch { refuse(`line ${index + 1} is not JSON: ${line.slice(0, 80)}`); } }
    if (typeof last !== "object" || last === null || last.t !== "result") refuse(`the last line is not a result frame: ${lines[lines.length - 1].slice(0, 80)}`);
    if (status === "0" && last.ok !== true) refuse("exited 0 but the result frame is not ok:true");
    if (status !== "0" && allow !== "1") refuse(`exited ${status} (a recorded failure must say ALLOW_FAIL=1 on its own call)`);
    if (status !== "0" && last.ok !== false) refuse(`exited ${status} but the result frame is not ok:false`);
  ' "$pending" "$status" "${ALLOW_FAIL:-0}"); then
    echo "record.sh: \`$argv\` refused — $verdict; $OUT/$out left untouched" >&2
    rm -f "$pending"
    exit 1
  fi
  mv -f "$pending" "$OUT/$out"
}

# rec <out.jsonl> <verb> [args…]
rec() {
  local out=$1 pending status=0; shift
  pending=$(record_pending "$out")
  printf '%s' "${STDIN:-}" | node "$CLI" --frames "$@" > "$pending" || status=$?
  record_accept "$out" "$pending" "$status" "$*"
}

# drive.cjs answers the CLI's ask frames from a JSON array, in order, and closes stdin at the first ask it
# has no answer for. It writes only the file it is given (a pending file, never the committed frame) and
# exits with the child's status so the recorder can judge it.
record_drive_script() {
  [ -f "$FX/drive.cjs" ] && return 0
  cat > "$FX/drive.cjs" <<'JS'
const { spawn } = require("node:child_process"); const fs = require("node:fs");
const [cli, out, answersJson, ...argv] = process.argv.slice(2);
const answers = JSON.parse(answersJson); let next = 0; let buffer = "";
fs.writeFileSync(out, "");
const child = spawn(process.execPath, [cli, "--frames", ...argv], { stdio: ["pipe", "pipe", "inherit"] });
child.stdin.on("error", () => {});
// Without this a spawn failure (unreadable cli path, no node) threw after the file was zeroed and nothing said why.
child.on("error", (error) => { console.error(`drive.cjs: ${error.message}`); process.exitCode = 1; });
// StringDecoder semantics: `buffer += chunk` on a raw Buffer decoded each chunk alone, so a multi-byte
// character split across two reads (the em dash in "@mira — Mira Chen") came out as U+FFFD (review r1, MEDIUM).
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk; let i;
  while ((i = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (!line.trim()) continue;
    fs.appendFileSync(out, line + "\n");
    let frame; try { frame = JSON.parse(line); } catch { continue; }
    if (frame.t !== "ask") continue;
    if (next >= answers.length) { child.stdin.end(); continue; }
    child.stdin.write(JSON.stringify({ t: "answer", id: frame.id, value: answers[next++] }) + "\n");
  }
});
// "close", not "exit": stdout can still hold the result frame when "exit" fires.
child.on("close", (code) => { if (buffer.trim()) fs.appendFileSync(out, buffer + "\n"); child.stdin.destroy(); process.exitCode = code ?? 1; });
JS
}

# drive_to <file> <verb> [args…]: record through drive.cjs into <file>; returns the child's exit status.
drive_to() { local file=$1; shift; record_drive_script; node "$FX/drive.cjs" "$CLI" "$file" "${ANSWERS:-[]}" "$@"; }

# drive <out.jsonl> <verb> [args…]; ANSWERS is a JSON array of answers in ask order (default: none — close at the first ask).
drive() {
  local out=$1 pending status=0; shift
  pending=$(record_pending "$out")
  drive_to "$pending" "$@" || status=$?
  record_accept "$out" "$pending" "$status" "$*"
}
