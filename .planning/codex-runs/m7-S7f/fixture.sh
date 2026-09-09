#!/usr/bin/env bash
# Builds a fixture team under a scratch HOME so the built CLI can be driven over --frames offline.
set -euo pipefail
FX=${1:?fixture root}; CLI=/Users/ryanliu/Documents/Terum/terum-codex/m7-S7f/dist/index.js
rm -rf "$FX"; mkdir -p "$FX/home/.terum/skills/teams" "$FX/home/.claude/skills" "$FX/repo"
export HOME="$FX/home"
git init -q --bare "$FX/repo/team.git"; git -C "$FX/repo/team.git" symbolic-ref HEAD refs/heads/main
git clone -q "$FX/repo/team.git" "$FX/repo/seed" 2>/dev/null; cd "$FX/repo/seed"; git checkout -q -b main
git config user.name Seed; git config user.email seed@example.com
mkdir -p people skills evals
ID_DEPLOY=11111111-1111-4111-8111-111111111111; ID_TDD=22222222-2222-4222-8222-222222222222; ID_DIAG=33333333-3333-4333-8333-333333333333
skill() { # name id author category description
  mkdir -p "skills/$1"; cat > "skills/$1/SKILL.md" <<MD
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
person() { # handle display email installedJson
  cat > "people/$1.json" <<J
{"handle":"$1","display_name":"$2","email":"$3","github":"$1","bio":"","installed":$4,"declined":[]}
J
}
person seed "Seed" seed@example.com "[{\"id\":\"$ID_DEPLOY\",\"version\":null,\"scope\":{\"kind\":\"global\"},\"since\":\"2026-08-20T00:00:00Z\"}]"
person mira "Mira Chen" mira@example.com "[{\"id\":\"$ID_DEPLOY\",\"version\":null,\"scope\":{\"kind\":\"global\"},\"since\":\"2026-08-25T00:00:00Z\"},{\"id\":\"$ID_TDD\",\"version\":null,\"scope\":{\"kind\":\"project\",\"project\":\"terum\"},\"since\":\"2026-08-26T00:00:00Z\"}]"
person ravi "Ravi Patel" ravi@example.com "[]"
cat > team.json <<J
{"layout_version":2,"name":"team","categories":["ops","engineering","debugging"],"global":["$ID_DEPLOY"],"projects":{"terum":{"remotes":["github.com/acme/terum"],"skills":["$ID_TDD"]}},"archived":[],"policy":{"publish":"pr","skill_license":"UNLICENSED"}}
J
touch evals/.gitkeep
git add --all; git commit -q -m seed; git push -q origin HEAD:main
# The machine's clone of the team, with origin spelled the way the CLI expects (never fetched offline).
git clone -q --branch main "$FX/repo/team.git" "$HOME/.terum/skills/teams/acme"
git -C "$HOME/.terum/skills/teams/acme" remote set-url origin https://github.com/acme/team.git
git -C "$HOME/.terum/skills/teams/acme" config user.name Me; git -C "$HOME/.terum/skills/teams/acme" config user.email seed@example.com
# One placed skill in the global Claude Code root, recorded in the ledger.
mkdir -p "$HOME/.claude/skills/deploy-check"; cp "skills/deploy-check/SKILL.md" "$HOME/.claude/skills/deploy-check/SKILL.md"
VER=$(git -C "$HOME/.terum/skills/teams/acme" rev-parse HEAD:skills/deploy-check)
cat > "$HOME/.terum/skills/config.json" <<J
{"default_handle":"seed","email":"seed@example.com","display_name":"Seed","github":"seed","teams":{"acme":{"remote":"github.com/acme/team","handle":"seed"}},"shared":{"$ID_TDD":{"source":"$FX/repo/seed/skills/tdd","team":"acme"}},"approvals":{},"pending":[],"placements":{"$HOME/.claude/skills/deploy-check":{"id":"$ID_DEPLOY","team":"acme","version":"$VER","scope":{"kind":"global"},"placed_at":"2026-09-01T00:00:00Z","fingerprint":"fixture"}}}
J
chmod 600 "$HOME/.terum/skills/config.json"
echo "fixture ready at $FX (HOME=$HOME)"
