# Feasibility: wrapping terum-skills verbs as Claude Code skills

Date: 2026-09-07. Baseline: `main` @ `8730d2e`, terum-skills 0.1.2 (npm `latest`). Claude Code 2.1.263.
Status: Ryan picked option A (§6) on 2026-09-07 and it is implemented, uncommitted, in the primary
checkout: `.claude/skills/terum-skills/SKILL.md`, `.claude/commands/terum-skills.md`, one allowlist line in
`.claude/settings.json`, one row in `.claude/skills/README.md`. Nothing in `src/` changed. `eval` was promoted
from "wrap after a trial" to "wrap now" after reading `eval.ts` in full (no prompt; `--commit` refused until IE3).

## 1. Verdict in one paragraph

Nine verbs can be wrapped today with no CLI change: `ls`, `ls --local`, `status`, `search`, `validate`,
`update`, `invite`, `uninstall-skill`, and `sync` (plain and `--hook`); `publish` and `install` join them
conditionally (no open endorsement under the team's `pr` policy; no unapproved `allowed-tools` grant).
Every other verb reaches a `confirm`/`text`/`select` question, and Claude Code's Bash tool has no TTY, so
the CLI fails closed with `PromptClosedError` before it writes anything (verified). Wrapping those
needs one of three things: a hand-off to the user's terminal, a CLI change that adds pre-answer flags
(cuts against the prompts-over-flags rule and one of Ajay's standing decisions), or a skill that drives
the CLI through a pseudo-terminal with `expect` (works today, verified, but couples the skill to prompt
text). That choice is Ryan's; section 6 lays it out. Recommended first slice: one skill wrapping the
prompt-free verbs plus a "prepare and hand off" mode for `share` and `setup`.

## 2. The one fact that decides feasibility

`terminalPrompter` (`src/lib/prompt.ts:61,70`) sets `interactive = Boolean(input.isTTY)` and every
question goes through `ask()`, which throws
`PromptClosedError(question, 'not-interactive')` when `interactive` is false. Piping answers on stdin
does not help: the check is `isTTY`, not readability. `execute.ts` turns the throw into one stderr line
and exit code 1. Nothing about this is a bug; §3 of the phase-1 spec makes the Prompter the only human
channel, and the SessionStart hook (`src/lib/hook.ts` `HOOK_COMMAND`) is the proof that the tool is
designed to run non-interactively when it can.

Evidence gathered from the Bash tool (scratch install of terum-skills@0.1.2, cwd = this repo):

| Check | Result |
|---|---|
| `node -e "console.log(process.stdin.isTTY)"` in the Bash tool | `undefined` (stdout too) |
| `share --forget <bogus-id>` | `Cannot ask "Forget local tracking for … [y/N]": this command needs an interactive terminal (stdin is not a TTY).` rc=1, nothing written |
| `sync --prune` | `sync prune needs an interactive terminal.` rc=1 (explicit guard, `sync.ts:84`) |
| `share` (no path) | prints both candidate roots, then `No skill selected. In an interactive terminal, run …` rc=1 (explicit non-TTY branch, `share.ts:56-62`) |
| `ls --local` | two sections (global + project), rc=0 |
| `status`, `ls`, `search state`, `update`, `sync`, `sync --hook` | rc=0, no prompt |
| `validate <local skill dir>` | HYG1 findings, rc=1 (see §7) |
| `script -q /dev/null node -e …` | `isTTY = true` (a pty is obtainable from the Bash tool) |
| `expect` driving `share --forget …` and sending `n` | prompt rendered, `Forget was declined.`, child rc=1 |
| `claude -p "…" --max-turns 1` from inside this session | `ok`, rc=0 (nested `claude` works, `CLAUDECODE=1` set) |
| `npx -y terum-skills@latest --version` from the repo cwd | `0.1.2`, 0.5-0.8 s warm; `--help` lists `eval` and `validate` |

The last row corrects the handoff's dead end: the stale-copy resolution came from the accidental
self-dependency in `package.json` that PR #30's session reverted. With no `node_modules/terum-skills`
in the repo, npx resolves the registry package from the repo cwd. The scratch-prefix install remains
the right way to verify a *specific* published version, but a wrapper can use the npx form directly.

## 3. Per-verb classification

Columns: where the verb asks a question (file:line), what happens without a TTY, and what has already
happened by the time it fails. "Safe fail" means the throw lands before any write to the source folder,
the team repository, or `~/.terum`.

| Verb | Question call sites | Non-TTY behaviour | Side effects before the throw | Verdict |
|---|---|---|---|---|
| `ls`, `ls member`, `ls project` | none | works | none (reads clone; one `git` call per skill for latest tree) | **wrap now** |
| `ls --local` | none | works, two sections | none (spec: no git, no network, no prompt, no write) | **wrap now** |
| `status` | none | works | none | **wrap now** |
| `search <term>` | none | works | none | **wrap now** |
| `validate <path\|name>` | none | works; rc=1 when findings exist | none | **wrap now** (rc=1 is a result, not a failure; see §7) |
| `update` | none | works | probes the upstream tag list (bounded 10 s) | **wrap now** |
| `invite <logins…>` | none | works | `gh api PUT …/collaborators` per login (outward, intended) | **wrap now**, gate on user confirmation inside the skill |
| `uninstall-skill <ref>` | none | works | removes a placement, records in the team repo | **wrap now**, confirm in the skill first |
| `sync` | `sync.ts:141,187,259,316,366` all guarded by `interactive` | works; consent-needing skills are deferred, not asked; notices print | pulls clones, places approved skills, stamps | **wrap now** (this is what the hook already does hourly) |
| `sync --hook` | none (typed `NonInteractivePrompter`) | works; silent within the hourly stamp | same as above | already integrated via SessionStart; no wrapper needed |
| `sync --prune` | guard at `sync.ts:84` | refuses immediately | none | **hand-off** |
| `publish <ref>` | `publish.ts:71` (only if an endorsement is already open, `pr` policy); `:80` (always, `push` policy) | `pr` policy, nothing open: works end to end (branch + PR via `gh`); otherwise safe fail | clone refresh before the check; nothing pushed on the failing path (`Nothing pushed` branch is never reached, the throw is) | **wrap now with a caveat**: both configured teams are `pr` policy today; the wrapper must read the failure line and hand off when it sees the `[y/N]` text |
| `install <ref>` | `install.ts:143,150` (`ensureConsent`), only when `allowed-tools` is present and not yet approved | works for grant-free or already-approved skills; safe fail otherwise | clone refresh; nothing placed on the failing path | **wrap now with a caveat**; the consent question is the one Ajay's 2026-09-03 decision requires a human for |
| `share <path>` | `share.ts:99` (`Share <name>?`) | safe fail after printing the `Will add:` card and running hygiene | preflight `safeWrite` (fetch + reset of the clone, no mutation) | **hand-off**, but the non-TTY run doubles as a useful dry run (hygiene + card) |
| `share` (no path) | `share.ts:64` `select`, guarded by `io.interactive` | explicit refusal with the exact command to run | none | **hand-off**; the CLI already prints the hand-off line |
| `share --forget <id>` | `share.ts:263` | safe fail | none | **hand-off** |
| `share --keep-source/--keep-repo/--relocate` | `--relocate` none; the keep-* path reaches hygiene and repo writes without a prompt (not exercised here) | likely works | repo write | **defer**: rare recovery verbs, not worth a wrapper |
| `setup [target]` | `setup.ts:96` `select` (fresh machine), `:173` `text` (creator invite step), plus everything `team create`/`join`/`share` ask | fresh machine: fails at the first question; configured machine: resumes, then fails at the invite question | on a configured machine with a missing clone it re-clones before failing | **do not wrap**: the wizard is the interactive UX by design (§6.1) |
| `team create` | name/repo questions, identity confirm (`auth.ts:83,122`), hook offer (`hook.ts:131`) | fails at the first question | none | **do not wrap** |
| `team join <target>` | identity confirm (`auth.ts:83`), `team.ts:345` endorsed install, `:470` invitation | fails at the identity question | **clone is created first** (`ensureClone` at `team.ts:302` precedes `identityForJoiner` at `:304`) | **do not wrap**; note the left-behind clone (§7) |
| `team leave <name>` | `leave.ts:36` | safe fail | none | **hand-off** |
| `team remove <handle>` | `team.ts:98` | safe fail | none | **hand-off** |
| `uninstall` (machine) | `uninstallMachine.ts:56` | safe fail after printing the plan | none | **hand-off**; the non-TTY run is a free dry run of what would be removed |
| `login` | `auth.ts:83,122` | fails at the identity confirm | none | **do not wrap** |
| `eval <skill>` | none | should work: spawns `claude` with `stdio: ['ignore','pipe','pipe']` (`agent.ts:112`) and nested `claude -p` runs here | refreshes clone; writes only locally | **wrap after a trial**: not exercised end to end (the team has no shared skills to evaluate yet) |
| `readme`, `guard-push` | hidden | n/a | n/a | not user verbs |

## 4. Design shape for the wrappable verbs

One skill, not nine. Recommended: `.claude/skills/terum-skills/SKILL.md` invoked as
`/terum-skills <verb> [args]`, with a thin `.claude/commands/terum-skills.md` that says
"Invoke the `terum-skills` skill … Pass through any arguments: $ARGUMENTS" (the shape every command in
this repo already uses). One skill keeps the non-TTY rules, the failure-line translation, and the
permissions entry in one place; per-verb skills would repeat all three.

What the skill body does:

1. **Invocation form**: always `npx -y terum-skills@latest <verb> …` (spec §3 line 25; Ajay's
   2026-09-06 decision). Never a bare binary, never a checkout path. Run it through the Bash tool, not
   the skill-file `` !`command` `` injection: injection aborts the whole skill on a non-zero exit
   (Claude Code docs, "A failed command aborts the entire skill invocation"), and `validate` returns
   rc=1 on findings, which is a result the user wants to see.
2. **Verb gate**: an allowlist of the §3 "wrap now" verbs. For `share`, `setup`, `team leave`,
   `team remove`, `uninstall`, `sync --prune`, the skill prepares the exact command and hands it to
   the user to run in a terminal; for `share <path>` it first runs the command non-interactively to
   show the hygiene findings and the `Will add:` card, then hands off. For `publish` and `install` it
   runs the verb and, if the stderr line contains `needs an interactive terminal`, hands off with the
   same command.
3. **Output handling**: stdout is the result and is shown verbatim in a code block. stderr holds at
   most one failure line (exit 1) and, for `sync`, the notices plus the `N skills need review` count.
   The update-notice tail never appears: `index.ts:34` only arms it when stderr is a TTY, so
   `TERUM_SKILLS_NO_UPDATE_NOTIFIER` is unnecessary (harmless to set).
4. **Confirmation inside the skill** for the outward verbs (`invite`, `uninstall-skill`, `publish`,
   `install`): the skill states what will happen and waits for the user before running. This is the
   skill's job, not the CLI's; the CLI's own y/N is unreachable here.
5. **Permissions**: `.claude/settings.json` allows `Bash(node *)`, `Bash(npx tsc:*)`, and
   `Bash(npx vitest *)` but not `npx -y terum-skills@latest …`. Add
   `"Bash(npx -y terum-skills@latest *)"` to the shareable allowlist, or put the same pattern in the
   skill's `allowed-tools` frontmatter (per-invocation grant). Note the recursion: a wrapper skill
   with an `allowed-tools` grant will itself trigger terum-skills' consent question when a teammate
   installs it, which is exactly the behaviour Ajay's decision asks for.
6. **Frontmatter hygiene**: the description must be a quoted scalar or block scalar. Five skills in
   this repo (`codex-implement`, `codex-spec`, `harden`, `hybrid-review`, `ultrareview`) already show
   under `Not offered for sharing` because their unquoted description contains `Args: <…>`; verified
   again today in `ls --local`. A wrapper that repeats the mistake cannot be shared through the tool it
   wraps.
7. **cwd**: `ls --local`, `share`, and `publish`'s not-in-team hint derive the project root from
   `process.cwd()` by a filesystem walk to the nearest `.git` (PR #28). The Bash tool's cwd is the
   repo root, so the project section appears without any `cd`. The skill must not "improve" the walk
   with `git rev-parse` (spec `ls --local` invariant: no git).

What the skill must not do: pipe `y` on stdin (does nothing), set `--yes` flags (none exist), or run
`setup`/`team create`/`team join`/`login` at all.

## 5. What the hand-off actually is

The handoff document assumed that the `! <command>` prefix runs in the user's terminal with a TTY.
The Claude Code docs describe shell mode as "Run a command directly, add its output to the session"
and say nothing about a pty; output is captured into the transcript, which is how the Bash tool
behaves too. **Unverified either way.** The one-line check, to be typed by a human in a session:

```
! node -e "console.log(process.stdin.isTTY)"
```

If it prints `true`, the hand-off can be "type this with a `!` prefix"; if `undefined`, the hand-off is
"run this in a separate terminal", and the wrapper's value for prompting verbs is preparation plus a
copy-pasteable command. The design in §4 works under both answers.

## 6. The fork for Ryan: how should prompting verbs be reached from a session?

### What it is

`share`, `publish` (push policy or an open endorsement), `install` (unapproved grants), `team leave`,
`team remove`, `uninstall`, `sync --prune`, and the wizard verbs all stop at a question. The CLI's
UX rule is that a verb asks a question with a default and flags are wizard overrides, not the UX
(Ryan; memory `terum-skills-prompts-over-flags`; spec §6 describes `team create` as "asks two
questions"). A Claude Code session cannot answer a terminal question. The question is which side moves:
the CLI grows a way to be pre-answered, the skill grows a way to answer, or neither and the user
finishes in a terminal.

### Why (the code path)

Every question funnels through `Prompter.confirm/text/select` and, on the bin, `terminalPrompter.ask`,
which refuses on `!interactive` before writing the question. `sync` already has a non-interactive
design (defer instead of ask, `sync.ts:141,187,259`). `share` has a non-interactive branch for the
chooser but not for the final `Share <name>?` (`share.ts:56` vs `:99`). Two of the questions are
consent questions that a standing decision reserves for a human: Ajay, 2026-09-03, "require prompts
before placing skills that grant `allowed-tools`, because automatic installation from a session hook
can expand Claude Code tool access on every teammate's machine"
(https://app.terum.ai/#/decisions/994f89c3-0cda-4bf9-9bc9-6378137c1822). Any option that answers
`install.ts:150` without a human in the loop conflicts with it.

### Options

Fit is against the phase-1 spec plus the ratified North Star of the 2026-09-06 rulings walk ("fastest
path to a shippable 0.1.0; a documented rough edge is acceptable unless it loses data, takes over
someone's identity, or leaks a token"). Depth is how much of the barrier the option removes.

**A. Hand-off only (no CLI change).** The skill wraps the prompt-free verbs; for prompting verbs it
prepares the exact command, runs the free dry-run where one exists (`share <path>`, `uninstall`), and
hands the command to the user.
Fit 4: every prompt stays a prompt; the spec's UX rule and Ajay's consent decision are untouched; the
spec already prints hand-off lines for this case (`share.ts:61`).
Depth 1: the user still leaves the session for every write that asks a question.
Wins if: the value of wrapping is mostly "see team state without leaving the session", which the
prompt-free verbs already cover.
Effort: one skill file, one command file, one allowlist line; nothing in `src/`.

**B. Pre-answer flags in the CLI** (`--yes` on confirms, `--skill <path>` for share's chooser, and so
on), or an equivalent environment variable.
Fit 2: the rule says flags are overrides, so a `--yes` is defensible for `confirm`, but the `select`
questions have no honest default (setup's role question deliberately has none, `setup.ts:96` and the comment above it), and a
`--yes` that answers `install.ts:150` conflicts with Ajay's decision unless install is excluded, which
leaves the wrapper unable to install granted skills anyway.
Depth 3: removes the barrier for every confirm-style question; leaves the selects.
Wins if: Ryan wants scripted use beyond Claude Code (CI, dotfiles) and is willing to revise the
prompts-over-flags rule and record an override on Ajay's decision for the install case.
Effort: touches `cli.ts` and five command files, plus tests and spec rev 13; the rule change is the
real cost, not the code.

**C. The skill answers the questions, through a pseudo-terminal.** The skill asks the user with
`AskUserQuestion`, then drives `npx -y terum-skills@latest …` under `expect` (`/usr/bin/expect`, ships
with macOS), matching the CLI's `[y/N]` and `[default]:` suffixes and sending the collected answers.
Verified today: `expect` reached the `share --forget` prompt and the CLI honoured the `n`.
Fit 3: the CLI stays exactly as specified and a human still answers every question, including the
consent one, so Ajay's decision is honoured; the loss is that the skill now depends on prompt wording,
which the spec treats as copy, not contract, so a copy change can silently break the wrapper.
Depth 3: removes the barrier for every question the skill knows how to ask; the selects work too
(`expect` can send a number).
Wins if: Ryan wants in-session `share`/`publish` without changing the CLI and accepts a wrapper that
must be re-checked whenever prompt copy changes. Linux teammates need `expect` installed.
Effort: the skill is larger (an expect script per verb) and needs a test that runs each script against
the scratch install; nothing in `src/`.

**D. A machine-readable prompt channel in the CLI** (for example `TERUM_SKILLS_PROMPT=json`, where the
CLI prints each question as a JSON line and reads the answer from stdin, isTTY or not).
Fit 3: keeps prompts as the UX and gives non-terminal callers a contract instead of copy-matching;
but it is a new protocol in a 0.1.x tool whose North Star is a shippable 0.1.0 with rough edges allowed.
Depth 4: removes the barrier for every question, for every caller, without touching any verb's copy.
Wins if: more than one non-terminal caller is coming (Claude Code skill, a Codex wrapper, the phase-2
local UI). Then D is the thing both B and C are approximating.
Effort: one new Prompter implementation and a selector in `index.ts`; every verb unchanged; spec rev.

### Recommendation

A now, and D if a second non-terminal caller appears. A costs nothing and honours every rule; it also
tells us which prompting verbs people actually reach for from a session, which is the evidence D
needs. C is the fallback if Ryan wants `share` in-session before phase 2: it works today and keeps the
CLI untouched, but it is the option most likely to break quietly. B is the one I would not take: it
trades the CLI's UX rule for a wrapper that still cannot install a granted skill.

Ryan picked A on 2026-09-07; shipped as described in §4. Still open: the `!` TTY check in §5, and D if a
second non-terminal caller appears.

## 7. Side findings (not deliverables; hedged where not fully reproduced)

- **`validate` on a never-shared local folder always fails HYG1** (`license` missing). Reproduced on
  `.claude/skills/state`. `license` is injected at share time (`injectManagedFields`), so a local
  skill that has not been shared cannot pass the "local skill folder" mode the verb's help text
  advertises. This looks like a spec question for the IE1 verb (PR #26, parallel session), not a
  wrapper concern. Worth a bug log if Ryan agrees it is unintended.
- **`team join` clones before it asks**: `ensureClone` (`team.ts:302`) runs before
  `identityForJoiner` (`:304`), so a non-TTY join leaves a clone under `~/.terum/skills/teams/` with no
  config entry. Not exercised here; from reading the code. A later interactive join should adopt the
  clone through `describeClone`, but that was not verified.
- **`share <path>` non-TTY still fetches**: the preflight `safeWrite` refreshes the clone before the
  card and the confirm. Harmless, but it means the "dry run" in §4 is not network-free.
- **`ls --local` reports 90 skipped folders** on Ryan's machine, all `gsd-*` skills whose SKILL.md
  name is `gsd:<x>` while the folder is `gsd-<x>`, plus the five unquoted descriptions in this repo.
  Expected under the strict parser; noted because a wrapper's first output will be that wall of text.
- **`search state` found nothing**: the configured team has zero shared skills, so `search`,
  `install`, and `eval` could not be exercised against real data. Their verdicts rest on the code.
- **`!` shell mode TTY status** is the only assumption in the handoff I could not confirm or refute
  (§5).

## 8. Files read

`src/cli.ts`, `src/index.ts`, `src/lib/prompt.ts`, `src/lib/execute.ts`, `src/lib/hook.ts`,
`src/lib/auth.ts`, `src/lib/evals/agent.ts`, `src/commands/{share,sync,publish,install,setup,team,leave,
uninstallMachine,status,search,validate,eval,update,login,invite,ls}.ts`,
`.planning/specs/2026-09-02-phase-1-build.md` (§2, §3, §6),
`.planning/decisions/2026-09-06-phase1-rulings-decision-walk.md` (north_star),
`.claude/skills/README.md`, `.claude/skills/state/SKILL.md`, `.claude/skills/handoff/SKILL.md`,
`.claude/commands/*.md`, `.claude/settings.json`, `~/.claude/settings.json` (hook entry only),
Claude Code docs: interactive-mode (shell mode), skills (frontmatter, `!` injection).
