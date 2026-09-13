#!/usr/bin/env bash
# Re-records every frame of this set from the built CLI against fixture.sh. Usage: record.sh <scratch-root> [out-dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); FX=${1:?scratch root}; OUT=${2:-$HERE/frames}
# rec/drive, the CLI default (this checkout's dist/) and the stage-verify-move rule live in ../record-lib.sh (review r1 CRITICAL): a
# frame is written over the committed one only after its fresh recording is checked; a failed verb exits 1 and leaves it untouched.
. "$HERE/../record-lib.sh"
bash "$HERE/fixture.sh" "$FX"; export HOME="$FX/home"; cd "$FX/repo/seed"; mkdir -p "$OUT"
# The same pinned commit date as fixture.sh, so the one commit made below dates like the seed.
export GIT_AUTHOR_DATE='2026-09-08T18:56:03-07:00' GIT_COMMITTER_DATE='2026-09-08T18:56:03-07:00'
DEPLOY="$HOME/.claude/skills/deploy-check"; CLONE="$HOME/.terum/skills/teams/acme"; CONFIG="$HOME/.terum/skills/config.json"

# 1. The fixture's own state: deploy-check placed in the global root and recorded in the ledger; mira's
#    people file holds the two installs the "installed" member frame shows.
rec ls-member-installed.jsonl ls member mira
rec ls-local-placed.jsonl ls --local

# 2. The placed folder loses its SKILL.md (the ledger still records the placement).
rm "$DEPLOY/SKILL.md"
rec ls-local-placed-problem.jsonl ls --local
cp "$CLONE/skills/deploy-check/v1/SKILL.md" "$DEPLOY/SKILL.md"

# 3. The folder is on disk, identified by its metadata.id, but the ledger records nothing.
node - "$CONFIG" <<'JS'
const fs = require('node:fs');
const [file] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
config.placements = {};
fs.writeFileSync(file, JSON.stringify(config));
JS
rec ls-local-on-disk-only.jsonl ls --local

# 4. The same folder lives in a registered project checkout instead of the global root. The project is
#    registered the way the app registers one — through the CLI's own `project add` — so the config carries
#    exactly what the CLI writes.
mkdir -p "$FX/work/project/.claude/skills"; mv "$DEPLOY" "$FX/work/project/.claude/skills/deploy-check"
node "$CLI" project add -- "$FX/work/project" > /dev/null
rec ls-local-project.jsonl ls --local

# 5. mira has installed nothing: her people file is rewritten in the seed, pushed to the bare remote, and the
#    machine's clone is brought to that commit (fetched by path — its origin URL stays the GitHub spelling).
node - "$FX/repo/seed/people/mira.json" <<'JS'
const fs = require('node:fs');
const [file] = process.argv.slice(2);
const person = JSON.parse(fs.readFileSync(file, 'utf8'));
person.installed = [];
fs.writeFileSync(file, JSON.stringify(person) + '\n');
JS
git -C "$FX/repo/seed" commit -q -am 'mira: no installs'; git -C "$FX/repo/seed" push -q origin HEAD:main
git -C "$CLONE" fetch -q "$FX/repo/team.git" main; git -C "$CLONE" reset -q --hard FETCH_HEAD
rec ls-member-none.jsonl ls member mira

# Not re-recorded: real-data-check-ls.jsonl and real-data-check-ls-local.jsonl are genuine captures of Ryan's own
# machine (his real team with ajayw36 and ryanliu-terum, the real decision-walk/handoff/spec-readable/state skills,
# and the eighty-odd third-party gsd-* folders under his ~/.claude/skills). No fixture reproduces them; they are
# evidence, not a replay input (no desktop test reads them).
