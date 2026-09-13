#!/usr/bin/env bash
# Builds the teamless Library fixture the personal-library captures show, under a scratch HOME, so the built CLI
# can be driven over --frames offline. No team is configured (every frame's roster and skills are empty): the
# global root holds `alpha` (connectable) and `beta` (SKILL.md name not-beta, a name mismatch); the project
# checkout at <root>/repo/app holds `delta` and `gamma`. The project is NOT registered here — record.sh registers
# it with the CLI's own `project add`, which is one of the four frames.
# The desktop test (library-replay.test.ts) derives the fixture HOME from the recorded project path as
# `<path before /repo/app>/home`, so the two folders must keep these positions under the scratch root.
# Usage: fixture.sh <scratch-root>   (CLI env var: path to dist/index.js, unused here but honoured by record.sh)
set -euo pipefail
FX=${1:?fixture root}; CLI=${CLI:-/Users/ryanliu/Documents/Terum/terum-codex/refactor-frames/dist/index.js}
rm -rf "$FX"; mkdir -p "$FX/home/.terum/skills" "$FX/home/.claude/skills" "$FX/repo/app/.claude/skills"
export HOME="$FX/home"
DESCRIPTION='A fixture skill used by the desktop replay captures.'
local_skill() { # dir folder frontmatter-name — frontmatter only, no body, exactly the bytes the captures count
  mkdir -p "$1/$2"; printf -- '---\nname: %s\ndescription: %s\n---\n' "$3" "$DESCRIPTION" > "$1/$2/SKILL.md"
}
local_skill "$HOME/.claude/skills" alpha alpha
local_skill "$HOME/.claude/skills" beta not-beta
local_skill "$FX/repo/app/.claude/skills" delta delta
local_skill "$FX/repo/app/.claude/skills" gamma gamma
# A machine that has never joined a team: the empty config the CLI itself starts from.
cat > "$HOME/.terum/skills/config.json" <<J
{"teams":{},"approvals":{},"pending":[],"placements":{}}
J
chmod 600 "$HOME/.terum/skills/config.json"
echo "fixture ready at $FX (HOME=$HOME)"
