---
name: terum-skills
description: "Run a terum-skills CLI verb from inside the session (ls, ls --local, status, search, validate, update, sync, publish, install, uninstall-skill, invite, eval) and hand the verbs that ask a terminal question (connect, setup, team create/join/leave/remove, uninstall, sync --prune, login) to the user as a ready-to-run command, because the Bash tool has no TTY. Use when the user wants to see team or local skill state, check a skill's hygiene, sync, publish, install, invite, or evaluate a shared skill without leaving Claude Code."
---

Run one `terum-skills` verb on the user's behalf, or prepare it for them when the CLI would
ask a question the session cannot answer. This is a thin wrapper: the CLI is the product, the
skill only decides *whether* to run it here and *how* to show the result.

Feasibility, per-verb evidence, and the design this file follows:
`.planning/reviews/2026-09-07-cli-skill-wrappers-feasibility.md`.

## The one rule that shapes everything

Claude Code's Bash tool has no TTY. `terum-skills` asks every question through one channel
(`src/lib/prompt.ts`), and that channel refuses to ask when stdin is not a TTY: the verb prints
`Cannot ask "…": this command needs an interactive terminal (stdin is not a TTY).` on stderr and
exits 1 **before writing anything**. So:

- Verbs that never ask run here.
- Verbs that always ask are prepared and handed to the user to run in a terminal.
- Verbs that ask only sometimes run here; if the failure line above appears, hand off.

Never try to get around this: do not pipe `y` on stdin (the check is `isTTY`, not readability),
do not invent `--yes` flags (none exist), do not drive the CLI through `expect` or `script`.
The user's terminal answers the CLI's questions; the skill answers none of them.

## Invocation

- Always `npx -y terum-skills@latest <verb> …` (the supported form for every printed command).
  Never a bare `terum-skills`, never a checkout path, never `node dist/index.js`.
- Run through the Bash tool from the current working directory. Do not `cd`: `ls --local`,
  `connect`, and `publish` find the project root from the cwd by a filesystem walk, and the Bash
  tool's cwd is already the repo root. Absolute paths for every argument that is a path.
- Do not use the skill-file `` !`command` `` injection: a non-zero exit aborts the whole skill,
  and `validate` exits 1 whenever it has findings, which is a result, not a failure.
- `$ARGUMENTS`: first token is the verb (`team <sub>` is two tokens); the rest passes through
  unchanged. With no arguments, ask which verb, defaulting to `status`, and list the two tables
  below in one line each. Prompts over flags: ask a question with a default; never demand a flag.

## Table A: verbs that run here

| Verb | Before running | After running |
|---|---|---|
| `status [--team <t>]` | nothing | show stdout; the `may be stale; run … sync` line is advice, offer `/terum-skills sync` |
| `ls [--team <t>]`, `ls member <h>`, `ls project <n>` | nothing | show stdout |
| `ls --local` | nothing | show the **project** section in full; summarise the global section and the `Cannot be connected` list by count and reason unless the user asked for them (on a machine with many third-party skills that list runs to dozens of lines) |
| `search <term> [--category] [--author] [--project]` | nothing | show stdout; `No skills found.` is a result |
| `validate <abs-path or name> [--team <t>]` | nothing | rc=1 with `HYG…` lines means findings, not a crash; show them verbatim. A local folder that has never been connected fails HYG1 on the missing `license` field, which `connect` injects; say so instead of calling the skill broken |
| `update` | nothing | show stdout; it prints the update command and never runs it |
| `sync` | say it will pull every configured team, place approved skills, and defer any skill whose `allowed-tools` grant needs consent | show stdout; a `N skills need review` line means the user must run `npx -y terum-skills@latest sync` in a terminal to answer the consent questions. Long on a cold clone: use `run_in_background` |
| `sync --hook` | do not run by hand; the SessionStart hook already runs it hourly | n/a |
| `publish <ref> [--project <p>] [--team <t>]` | **confirm with the user**: this opens a pull request on the team repository (policy `pr`) in their name. State the skill and scope | show the PR URL. If stderr says `needs an interactive terminal`, the team is on `push` policy or an endorsement is already open; hand off (Table B) |
| `install <ref>[@<version>]`, `install member <h>`, `install project <n>` | **confirm with the user**: places files under `.claude/skills` and records the install in the team repo. Never add `--force` unless the user asked for it by name | show what was placed. If stderr says `needs an interactive terminal`, the skill requests `allowed-tools` and a human must approve in a terminal; hand off. That consent question is deliberate (Ajay, 2026-09-03) |
| `uninstall-skill <ref>` | **confirm with the user** | show stdout |
| `invite <github-login…> [--team <t>]` | **confirm with the user**: sends GitHub collaborator invitations | show stdout, including the Slack block the CLI prints for the teammate |
| `eval <skill> [--k <n>] [--triggers-only] [--execution-only] [--case <stem>] [--model <m>] [--judge-model <m>] [--working] [--team <t>]` | see the eval section | see the eval section |

Output handling for every verb in Table A:

- stdout is the result. Show it in a fenced code block, verbatim, subject only to the
  `ls --local` summarising rule above.
- stderr carries at most one failure line (exit 1); for `sync` it also carries notices and the
  review count. Quote the failure line and say what it means in one sentence.
- Exit code 1 with a failure line is the verb declining, not the wrapper failing. Do not retry.
- No update-notice tail appears (the CLI only prints it when stderr is a TTY).

## Table B: verbs that are handed to the user

The CLI asks at least one question on every path, so the skill prepares the exact command,
runs the free dry run where one exists, and hands the command over. Say plainly: *run this in a
terminal; the CLI will ask you a question the session cannot answer.*

| Verb | Free dry run first | Command to hand over |
|---|---|---|
| `connect` (no path) | run it: the CLI lists every shareable folder under both roots and prints the exact command | `npx -y terum-skills@latest connect --team <team>` |
| `connect <abs-path>` | run it: it refreshes the clone, runs hygiene, prints the `Will add:` card, then fails at `Connect <name>?`; nothing is written. Show the findings and the card | `npx -y terum-skills@latest connect <abs-path>` |
| `connect --forget <id>`, `--keep-source <id>`, `--keep-repo <id>` | none | the same command |
| `sync --prune` | none (`sync prune needs an interactive terminal.`) | `npx -y terum-skills@latest sync --prune` |
| `uninstall` | run it: it prints exactly what would be removed and fails at the y/N | `npx -y terum-skills@latest uninstall` |
| `team leave <name>`, `team remove <handle>` | none | the same command |
| `setup [target]`, `team create`, `team join <target>`, `login` | **none; do not run these here at all.** `setup` on a configured machine re-clones a missing team clone before it fails, and `team join` creates the clone before its first question | `npx -y terum-skills@latest setup` / `setup <org>/<repo>` / `team create` / `team join <target>` / `login` |

Whether `! <command>` in Claude Code's shell mode has a TTY is unverified; do not promise it.
"A terminal" means a real terminal.

## eval

`eval` never asks a question and, without `--commit`, never writes the team repository (spec §6.0), so
it runs here.
What it does, so the user knows what they are buying:

1. Refreshes the team clone and reads the skill by name or id; `--working` evaluates the user's
   local connected source instead of the clone copy.
2. Runs the hygiene tier; findings abort before any agent call.
3. Preflight: `claude --version` plus one 1-turn smoke task; fails fast if `claude` is absent,
   logged out, or the model is unavailable. Nested `claude -p` works from inside a session.
4. Trigger evals from `evals/triggers.yaml` (skip with `--execution-only`), then execution cases
   from `evals/cases/*.yaml` (skip with `--triggers-only`, narrow with `--case <stem>`), each case
   `k` times (default 3) per arm, candidate versus incumbent when a prior tree exists.
5. Writes the run tree under `~/.terum/skills/evals/<team>/<id>/<run-id>/` and prints the report.

Rules:

- **Confirm with the user first** and state the size: cases × k × arms agent runs, each a
  `claude` invocation billed to their account. Suggest `--triggers-only` or `--case <stem>` for
  a first look.
- Run it with `run_in_background`; a full matrix takes minutes.
- A skill with no `evals/` folder produces an empty matrix; say so before running.
- `--commit` (0.1.3+) is the one eval path that writes the team repository: after the run it adds
  exactly one immutable receipt, `evals/<id>/<tree>/<run-id>.json`, straight to team `main` through
  `safeWrite`, in the user's name. **Confirm with the user before passing it**, never add it on your
  own, and never combine it with `--working` (the CLI refuses: receipts pin committed trees only).
- Model flags pass through unchanged (`--model`, `--judge-model`; default `sonnet`).

## What this skill never does

- Answer a CLI question by any means.
- Run `setup`, `team create`, `team join`, or `login` in the session.
- Add `--force`, `--allow-privileged`, or `--commit` unless the user asked for that flag by name.
- Call `git rev-parse` or otherwise "help" the CLI find the project root.
- Retry a verb that exited 1 with a failure line.
