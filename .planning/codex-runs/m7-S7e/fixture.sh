#!/usr/bin/env bash
# Builds a layout-3 fixture team (refactor spec §3.1) under a scratch HOME so the built CLI can be driven
# over --frames offline. Usage: fixture.sh <scratch-root>. The CLI is resolved by record.sh beside this
# file (through ../record-lib.sh); the seed itself never runs it.
set -euo pipefail
FX=${1:?fixture root}
# ---- this set's knobs: the only lines that differ between the sets' fixture.sh files ----
REMOTE=local
MIRA_META=0
REAL_FINGERPRINT=0
SEED_DATE=2026-09-08T18:00:00-07:00
# REMOTE=github: origin is spelled https://github.com/acme/team.git and config names github.com/acme/team
#   (never fetched offline; read verbs only). REMOTE=local: the fixture's own bare repo is origin on both
#   sides, so write verbs (profile, login) push offline.
# MIRA_META=1: mira carries role "Platform" and projects ["terum"]. REAL_FINGERPRINT=1: the ledger
#   placement carries the placed folder's real fingerprint instead of the "fixture" placeholder.
# SEED_DATE: the seed commit's author/committer instant. `ls` reports each skill's `updated` and `status` each
#   member's `joined` from git dates, so an unpinned seed would change every recording on every re-record day;
#   sets whose committed frames carry an instant pin that one, the rest share a fixed one.
# ------------------------------------------------------------------------------------------
rm -rf "$FX"; mkdir -p "$FX/home/.terum/skills/teams" "$FX/home/.claude/skills" "$FX/repo"
export HOME="$FX/home"
SEED="$FX/repo/seed"
git init -q --bare "$FX/repo/team.git"; git -C "$FX/repo/team.git" symbolic-ref HEAD refs/heads/main
git clone -q "$FX/repo/team.git" "$SEED" 2>/dev/null; git -C "$SEED" checkout -q -b main
git -C "$SEED" config user.name Seed; git -C "$SEED" config user.email seed@example.com
mkdir -p "$SEED/people" "$SEED/skills" "$SEED/evals"
ID_DEPLOY=11111111-1111-4111-8111-111111111111; ID_TDD=22222222-2222-4222-8222-222222222222; ID_DIAG=33333333-3333-4333-8333-333333333333
# Layout 3: published bytes live at skills/<name>/v<N>/** (§3.1); every fixture skill has one version, v1.
skill() { # name id author category description
  mkdir -p "$SEED/skills/$1/v1"; cat > "$SEED/skills/$1/v1/SKILL.md" <<MD
---
name: $1
description: $5
license: UNLICENSED
metadata:
  id: $2
  author: $3
  terum-category: $4
---
# $1

Use this skill when $5

1. Step one.
2. Step two.
MD
}
skill deploy-check $ID_DEPLOY "Mira Chen <mira@example.com>" ops "a deploy needs a pre-flight checklist."
skill tdd $ID_TDD "Seed <seed@example.com>" engineering "writing code that needs a failing test first."
skill diagnose $ID_DIAG "Ravi Patel <ravi@example.com>" debugging "something is broken and the cause is unknown."
# People files are unchanged in substance from the layout-2 fixture: a seeded installed[].version of null stays null.
person() { # handle display email installedJson [extraFieldsJson]
  cat > "$SEED/people/$1.json" <<J
{"handle":"$1","display_name":"$2","email":"$3","github":"$1","bio":"","installed":$4,"declined":[]${5:-}}
J
}
MIRA_EXTRA=''
if [ "$MIRA_META" = 1 ]; then MIRA_EXTRA=',"role":"Platform","projects":["terum"]'; fi
person seed "Seed" seed@example.com "[{\"id\":\"$ID_DEPLOY\",\"version\":null,\"scope\":{\"kind\":\"global\"},\"since\":\"2026-08-20T00:00:00Z\"}]"
person mira "Mira Chen" mira@example.com "[{\"id\":\"$ID_DEPLOY\",\"version\":null,\"scope\":{\"kind\":\"global\"},\"since\":\"2026-08-25T00:00:00Z\"},{\"id\":\"$ID_TDD\",\"version\":null,\"scope\":{\"kind\":\"project\",\"project\":\"terum\"},\"since\":\"2026-08-26T00:00:00Z\"}]" "$MIRA_EXTRA"
person ravi "Ravi Patel" ravi@example.com "[]"
# team.json at layout 3 (§3.1): the old top-level "global" list is the reserved Global project's skills;
# policy.publish is gone. Categories, projects and ids are the layout-2 fixture's.
cat > "$SEED/team.json" <<J
{"layout_version":3,"name":"team","categories":["ops","engineering","debugging"],"projects":{"Global":{"remotes":[],"skills":["$ID_DEPLOY"]},"terum":{"remotes":["github.com/acme/terum"],"skills":["$ID_TDD"]}},"archived":[],"policy":{"skill_license":"UNLICENSED"}}
J
# The generated README a `team create` bootstrap writes (src/commands/team.ts), so a write verb's README regeneration has its markers.
printf '# team skills\n\n<!-- terum-skills:begin -->\n<!-- terum-skills:end -->\n' > "$SEED/README.md"
touch "$SEED/evals/.gitkeep"
git -C "$SEED" add --all; GIT_AUTHOR_DATE="$SEED_DATE" GIT_COMMITTER_DATE="$SEED_DATE" git -C "$SEED" commit -q -m seed; git -C "$SEED" push -q origin HEAD:main
# The machine's clone of the team, with origin spelled the way this set expects.
CLONE="$HOME/.terum/skills/teams/acme"
git clone -q --branch main "$FX/repo/team.git" "$CLONE"
if [ "$REMOTE" = local ]; then ORIGIN="$FX/repo/team.git"; CONFIG_REMOTE="$FX/repo/team.git"; else ORIGIN=https://github.com/acme/team.git; CONFIG_REMOTE=github.com/acme/team; fi
git -C "$CLONE" remote set-url origin "$ORIGIN"
git -C "$CLONE" config user.name Me; git -C "$CLONE" config user.email seed@example.com
# One placed skill in the global Claude Code root, recorded in the ledger.
mkdir -p "$HOME/.claude/skills/deploy-check"; cp "$SEED/skills/deploy-check/v1/SKILL.md" "$HOME/.claude/skills/deploy-check/SKILL.md"
# The ledger keeps the 40-hex tree hash the layout-2 fixtures seeded: today's CLI reads it as null,
# "placed before versioning" (§3.4), which is what `team migrate` leaves too (D70). No v1 placement is
# invented. `shared` is retained passthrough bytes (§12 deleted its reader) so a byte-preserving write
# still has something to preserve.
VER=$(git -C "$CLONE" rev-parse HEAD:skills/deploy-check)
cat > "$HOME/.terum/skills/config.json" <<J
{"default_handle":"seed","email":"seed@example.com","display_name":"Seed","github":"seed","teams":{"acme":{"remote":"$CONFIG_REMOTE","handle":"seed"}},"shared":{"$ID_TDD":{"source":"$SEED/skills/tdd","team":"acme"}},"approvals":{},"pending":[],"placements":{"$HOME/.claude/skills/deploy-check":{"id":"$ID_DEPLOY","team":"acme","version":"$VER","scope":{"kind":"global"},"placed_at":"2026-09-01T00:00:00Z","fingerprint":"fixture"}}}
J
chmod 600 "$HOME/.terum/skills/config.json"
if [ "$REAL_FINGERPRINT" = 1 ]; then
# The health probe needs a real ledger fingerprint, not the placeholder.
node --input-type=module - "$FX" <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const fx = process.argv[2];
const configPath = `${fx}/home/.terum/skills/config.json`;
const config = JSON.parse(await readFile(configPath, 'utf8'));
const path = `${fx}/home/.claude/skills/deploy-check`;
const hash = createHash('sha256').update(await readFile(`${path}/SKILL.md`)).digest('hex');
config.placements[path].fingerprint = `sha256:${createHash('sha256').update(`SKILL.md:${hash}\n`).digest('hex')}`;
await writeFile(configPath, JSON.stringify(config) + '\n');
if (JSON.parse(await readFile(configPath, 'utf8')).placements[path].fingerprint !== config.placements[path].fingerprint) throw new Error('Fixture write failed');
JS
fi
echo "fixture ready at $FX (HOME=$HOME)"
