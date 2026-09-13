#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
# Captured before HOME moves to the fixture: two recordings below need a LOGGED-IN gh (their recorded lines say
# "GitHub: gh is logged in."), so they borrow this machine's gh config and token; every other frame runs gh logged out.
REAL_GH_CONFIG_DIR=${GH_CONFIG_DIR:-$HOME/.config/gh}; REAL_GH_TOKEN=${GH_TOKEN:-}; REAL_GITHUB_TOKEN=${GITHUB_TOKEN:-}
logged_in_gh() { export GH_CONFIG_DIR="$REAL_GH_CONFIG_DIR"; if [ -n "$REAL_GH_TOKEN" ]; then export GH_TOKEN="$REAL_GH_TOKEN"; fi; if [ -n "$REAL_GITHUB_TOKEN" ]; then export GITHUB_TOKEN="$REAL_GITHUB_TOKEN"; fi; }
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
# gh reads its config under the fixture HOME, so it is installed-but-logged-out for every frame (the state the recordings were made in); no ambient token reaches the CLI.
unset GH_TOKEN GITHUB_TOKEN; export GH_CONFIG_DIR="$HOME/.config/gh"
rec() { local out=$1; shift; printf '%s' "${STDIN:-}" | node "$CLI" --frames "$@" > "$OUT/$out" || true; }
cat > "$FX/drive.cjs" <<'JS'
const { spawn } = require("node:child_process"); const fs = require("node:fs");
const [cli, out, answersJson, ...argv] = process.argv.slice(2);
const answers = JSON.parse(answersJson); let next = 0; let buffer = "";
fs.writeFileSync(out, "");
const child = spawn(process.execPath, [cli, "--frames", ...argv], { stdio: ["pipe", "pipe", "inherit"] });
child.stdin.on("error", () => {});
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
child.on("exit", () => { if (buffer.trim()) fs.appendFileSync(out, buffer + "\n"); child.stdin.destroy(); });
JS
# drive <out.jsonl> <verb> [args…]; ANSWERS is a JSON array of answers in ask order (default: none — close at the first ask).
drive() { local out=$1; shift; node "$FX/drive.cjs" "$CLI" "$OUT/$out" "${ANSWERS:-[]}" "$@" || true; }
# A machine that has never run setup: no config.json at all (status-zero reports teams [] and identity null).
ZERO_HOME="$FX/home-zero"; rm -rf "$ZERO_HOME"; mkdir -p "$ZERO_HOME"
HOME="$ZERO_HOME" GH_CONFIG_DIR="$ZERO_HOME/.config/gh" rec status-zero.jsonl status
# The create fork: "Create a new team" chosen, gh logged in, then stdin closed at "Team name".
( logged_in_gh; HOME="$ZERO_HOME" ANSWERS='["Create a new team"]' drive setup-create-fork.jsonl setup )
# The join hand-off: "Join an existing team" chosen; setup prints the owner-command hint and writes nothing (gh is never probed on this path).
HOME="$ZERO_HOME" GH_CONFIG_DIR="$ZERO_HOME/.config/gh" ANSWERS='["Join an existing team"]' drive setup-join-handoff.jsonl setup
# Resume on the configured machine (team acme, gh logged in): the recorded answers were q1 "" (invite), q2 false (hook),
# q3 false (Claude skill); today's setup also asks the project-folder and eval offers, answered here with their skip choices.
( logged_in_gh; ANSWERS='["", false, "Skip", false, false]' drive setup-resume.jsonl setup )
