#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
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
rec ls.jsonl ls
rec ls-member-mira.jsonl ls member mira
rec ls-project-terum.jsonl ls project terum
rec ls-local.jsonl ls --local
rec search.jsonl search ''
rec status.jsonl status
rec validate-deploy-check.jsonl validate deploy-check
# The two setup recordings were made on a machine that had NOT joined yet (their results name the seed repo's team
# "team" and its file: remote, and the first ask is join's "Use this identity?"): a copy of the fixture HOME with the
# team entry and clone removed, joining the fixture's bare repo offline with gh logged out.
JOIN_HOME="$FX/home-join"; rm -rf "$JOIN_HOME"; cp -R "$FX/home" "$JOIN_HOME"; rm -rf "$JOIN_HOME/.terum/skills/teams/acme"
node -e 'const fs=require("node:fs");const f=process.argv[1];const c=JSON.parse(fs.readFileSync(f,"utf8"));c.teams={};fs.writeFileSync(f,JSON.stringify(c)+"\n");' "$JOIN_HOME/.terum/skills/config.json"
# setup.jsonl: stdin closed at the first ask (the recorded ordinary failure).
HOME="$JOIN_HOME" GH_CONFIG_DIR="$JOIN_HOME/.config/gh" drive setup.jsonl setup "$FX/repo/team.git"
# setup-join.jsonl: the recorded answers were q1 true (identity), q2 false (hook), q3 false (Claude skill); today's
# setup also asks the project-folder and eval offers, answered here with their skip choices.
HOME="$JOIN_HOME" GH_CONFIG_DIR="$JOIN_HOME/.config/gh" ANSWERS='[true, false, "Skip", false, false]' drive setup-join.jsonl setup "$FX/repo/team.git"
