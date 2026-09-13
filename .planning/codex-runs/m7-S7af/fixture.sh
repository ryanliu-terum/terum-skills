#!/usr/bin/env bash
# Builds a layout-3 fixture team under a scratch HOME so the built CLI can be driven over --frames offline.
# Same team as the m7-S7ad fixture these frames were recorded from (acme: mira/ravi/seed; deploy-check, tdd,
# diagnose), seeded directly in layout 3 (skills/<name>/v1/, team.json layout_version 3, projects.Global).
# Usage: fixture.sh <scratch-root>   (CLI env var: path to dist/index.js, unused here but honoured by record.sh)
set -euo pipefail
FX=${1:?fixture root}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
rm -rf "$FX"; mkdir -p "$FX/home/.terum/skills/teams" "$FX/home/.claude/skills" "$FX/repo"
export HOME="$FX/home"
# `ls` reports each skill's `updated` from `git log -1 --format=%cI -- skills/<name>`; a pinned commit date keeps
# every recording byte-identical run to run. This set's frames carry no `updated`; the stamp is the sibling m7-S7b
# recording's, made from this same fixture generation on 2026-09-08.
export GIT_AUTHOR_DATE='2026-09-08T18:56:03-07:00' GIT_COMMITTER_DATE='2026-09-08T18:56:03-07:00'
git init -q --bare "$FX/repo/team.git"; git -C "$FX/repo/team.git" symbolic-ref HEAD refs/heads/main
git clone -q "$FX/repo/team.git" "$FX/repo/seed" 2>/dev/null; git -C "$FX/repo/seed" checkout -q -b main
git -C "$FX/repo/seed" config user.name Seed; git -C "$FX/repo/seed" config user.email seed@example.com
mkdir -p "$FX/repo/seed/people" "$FX/repo/seed/skills" "$FX/repo/seed/evals"
ID_DEPLOY=11111111-1111-4111-8111-111111111111; ID_TDD=22222222-2222-4222-8222-222222222222; ID_DIAG=33333333-3333-4333-8333-333333333333
skill() { # name id author category description — layout 3: the bytes live under skills/<name>/v1/
  mkdir -p "$FX/repo/seed/skills/$1/v1"; cat > "$FX/repo/seed/skills/$1/v1/SKILL.md" <<MD
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
person() { # handle display email installedJson — a seeded installed[].version of null stays null under layout 3
  cat > "$FX/repo/seed/people/$1.json" <<J
{"handle":"$1","display_name":"$2","email":"$3","github":"$1","bio":"","installed":$4,"declined":[]}
J
}
person seed "Seed" seed@example.com "[{\"id\":\"$ID_DEPLOY\",\"version\":null,\"scope\":{\"kind\":\"global\"},\"since\":\"2026-08-20T00:00:00Z\"}]"
person mira "Mira Chen" mira@example.com "[{\"id\":\"$ID_DEPLOY\",\"version\":null,\"scope\":{\"kind\":\"global\"},\"since\":\"2026-08-25T00:00:00Z\"},{\"id\":\"$ID_TDD\",\"version\":null,\"scope\":{\"kind\":\"project\",\"project\":\"terum\"},\"since\":\"2026-08-26T00:00:00Z\"}]"
person ravi "Ravi Patel" ravi@example.com "[]"
# Layout 3 (spec §3.1): the old top-level `global` list is projects.Global.skills; no `policy.publish`.
cat > "$FX/repo/seed/team.json" <<J
{"layout_version":3,"name":"team","categories":["ops","engineering","debugging"],"projects":{"Global":{"remotes":[],"skills":["$ID_DEPLOY"]},"terum":{"remotes":["github.com/acme/terum"],"skills":["$ID_TDD"]}},"archived":[],"policy":{"skill_license":"UNLICENSED"}}
J
touch "$FX/repo/seed/evals/.gitkeep"
git -C "$FX/repo/seed" add --all; git -C "$FX/repo/seed" commit -q -m seed; git -C "$FX/repo/seed" push -q origin HEAD:main
# The machine's clone of the team, with origin spelled the way the CLI expects (never fetched offline).
git clone -q --branch main "$FX/repo/team.git" "$HOME/.terum/skills/teams/acme"
git -C "$HOME/.terum/skills/teams/acme" remote set-url origin https://github.com/acme/team.git
git -C "$HOME/.terum/skills/teams/acme" config user.name Me; git -C "$HOME/.terum/skills/teams/acme" config user.email seed@example.com
# One placed skill in the global Claude Code root, recorded in the ledger. The placement's version is the 40-hex
# tree hash the pre-versioning CLI wrote (exactly as the old fixtures seeded it): the layout-3 CLI reads it as
# null, "placed before versioning" (spec §3.4; decision D70) — the same value `team migrate` would leave.
mkdir -p "$HOME/.claude/skills/deploy-check"; cp "$FX/repo/seed/skills/deploy-check/v1/SKILL.md" "$HOME/.claude/skills/deploy-check/SKILL.md"
VER=$(git -C "$HOME/.terum/skills/teams/acme" rev-parse HEAD:skills/deploy-check)
cat > "$HOME/.terum/skills/config.json" <<J
{"default_handle":"seed","email":"seed@example.com","display_name":"Seed","github":"seed","teams":{"acme":{"remote":"github.com/acme/team","handle":"seed"}},"approvals":{},"pending":[],"placements":{"$HOME/.claude/skills/deploy-check":{"id":"$ID_DEPLOY","team":"acme","version":"$VER","scope":{"kind":"global"},"placed_at":"2026-09-01T00:00:00Z","fingerprint":"fixture"}}}
J
chmod 600 "$HOME/.terum/skills/config.json"
echo "fixture ready at $FX (HOME=$HOME)"
