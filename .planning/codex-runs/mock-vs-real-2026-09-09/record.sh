#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
rec() { local out=$1; shift; printf '%s' "${STDIN:-}" | node "$CLI" --frames "$@" > "$OUT/$out" || true; }
# Team reads (the inventory-, skill-detail- and share-settings replays spawn exactly these argv shapes).
rec status.jsonl status
# `status` has no --json flag and never had one over frames: the committed status-json.jsonl is byte-identical
# to status.jsonl and no desktop replay maps to it, so it is the same plain `status` run.
rec status-json.jsonl status
rec status-team.jsonl status --team acme
rec ls.jsonl ls
rec ls-local.jsonl ls --local
rec ls-member-mira.jsonl ls member mira
rec ls-member-ravi.jsonl ls member ravi
rec ls-member-seed.jsonl ls member seed
rec ls-member-nope.jsonl ls member nope
rec ls-project-terum.jsonl ls project terum
rec ls-project-nope.jsonl ls project nope
rec search.jsonl search ''
rec validate-deploy-check.jsonl validate deploy-check
rec validate-diagnose.jsonl validate diagnose
rec validate-tdd.jsonl validate tdd
rec validate-nope.jsonl validate nope
rec eval-report-deploy-check.jsonl eval-report deploy-check
rec eval-report-diagnose.jsonl eval-report diagnose
rec eval-report-tdd.jsonl eval-report tdd
rec eval-report-nope.jsonl eval-report nope
# `update` last, offline: the committed frame was taken on a machine that had observed a release advertisement.
# A GitHub-hosted team would make the CLI probe the network here, so — as m7-S7e's fixture does — the team's
# remote is re-pointed at the local bare repo first; under the github-teams policy that disables release
# probing, and the recording says so instead of carrying whatever the network answered on the day.
git -C "$HOME/.terum/skills/teams/acme" remote set-url origin "$FX/repo/team.git"
node - "$HOME/.terum/skills/config.json" "$FX/repo/team.git" <<'JS'
const fs = require('node:fs');
const [file, remote] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
config.teams.acme.remote = remote;
fs.writeFileSync(file, JSON.stringify(config));
JS
rec update.jsonl update
