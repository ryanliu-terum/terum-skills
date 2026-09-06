# V8 — is an async SessionStart hook's `reloadSkills` honored, and on which turn? (2026-09-06)

Spec item: `.planning/specs/2026-09-02-phase-1-build.md` §10 V8 (rev 4). Measured against Claude Code **2.1.263** on macOS, model `haiku`, in print mode.

## Procedure (reproducible, no team repo needed)

1. A probe hook — `scratchpad/v8/probe-hook.sh` — that (a) writes a project-level skill `.claude/skills/v8-probe/SKILL.md` under `$CLAUDE_PROJECT_DIR`, (b) appends a timestamp to `probe-ran.log`, and (c) prints exactly `{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}` on stdout — the same shape §8 has `sync --hook` emit.
2. A settings file registering it as `SessionStart` / matcher `startup` / `async: true` / `timeout: 60`, passed with `--settings <file>` so the user's own `~/.claude/settings.json` and skills are untouched (a throwaway HOME cannot be used: the login lives there).
3. Turn 1, from an empty scratch cwd: `claude -p "Is a skill named v8-probe available to you right now? Reply PROBE-VISIBLE or PROBE-ABSENT." --model haiku --output-format json --max-turns 1 --settings <file>`.
4. Turn 2: the same question with `--resume <session id from turn 1>`.

## Result

| Turn | Hook fired | Answer |
|---|---|---|
| 1 (the session start that fired the hook) | yes — `probe-ran.log` has one entry, `.claude/skills/v8-probe/` exists | **PROBE-ABSENT** |
| 2 (resumed session; matcher `startup` did not fire again) | no (one entry in the log) | **PROBE-VISIBLE** |

## What this settles, and what it does not

- SessionStart hooks run in print mode, and an `async: true` hook's side effects (the placed skill folder) land while the first turn is already underway: **a skill placed by the async hook is not available in the turn that triggered it.** §8's "not guaranteed to be usable in the turn that triggered it" is confirmed, and its stderr line ("run `terum-skills sync`") stays the honest guidance.
- The skill is available on the **next turn of a resumed session** — but a `-p --resume` is a new process that scans skill folders at startup, so this row shows "no later than the next session/process", not that the `reloadSkills` directive itself reloaded a live session's skill index.
- **Still open (needs a live interactive session, one process, two turns):** whether a later turn of the SAME process sees the skill because of the directive. That is the measurement the directive's fate hangs on. Until it is made, §8 keeps emitting the directive best-effort (it costs one line of stdout and can only help); dropping it is the §10 rule only if the live-session run shows it is never honored.

## How to make the remaining measurement

In an interactive `claude` session started in a scratch cwd with the same `--settings` file: turn 1 asks the probe question (expect ABSENT), turn 2 asks again without leaving the session. If turn 2 is VISIBLE, the directive is honored on the turn after the hook completes; if ABSENT, run `/reload` (or whatever the runtime offers) to distinguish "never" from "only on explicit reload". Record the Claude Code version.
