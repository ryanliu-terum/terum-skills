# Claude Code integration

terum-skills puts four things inside your Claude Code setup. Three of them are separate offers during setup, each with its own question, and every question defaults to No, so nothing below is on your machine unless you answered yes. The fourth, the per-machine switch, is a verb you run.

| Integration | Where it lives | What it does |
|---|---|---|
| The `/terum-skills` skill | `~/.claude/skills/terum-skills/` | Teaches Claude Code which verbs it may run for you and which to hand to your terminal |
| The session-start hook | `~/.claude/settings.json` | Fetches your team clones at the start of a session, at most once an hour |
| The edit hook | `~/.terum/skills/hooks/terum-skills-edit.mjs` and `~/.claude/settings.json` | Reminds Claude to publish a skill after it edits one |
| The per-machine switch | `skillOverrides` in Claude Code's own settings | Turns a skill off for this machine without moving the folder |

Two more places where the two tools meet are covered at the end: evals drive your own logged-in Claude Code, and `usage` and `misses` read Claude Code's session transcripts.

## The /terum-skills skill

This is the operator manual for Claude Code. It ships inside the npm package and setup copies it to `~/.claude/skills/terum-skills/SKILL.md`. With it installed, asking Claude to "list my team's skills" or "evaluate this skill" gets a correct invocation instead of a guess.

The copy that lands on your machine is not the bundled copy byte for byte. Every `npx -y terum-skills@latest` in it is rewritten to the spelling this machine uses: `terum-skills` where the [bare invocation form](../reference/cli.md#invocation) is available, and `npx -y terum-skills@<the version that placed it>` everywhere else, including every Windows machine. A session therefore runs the copy you installed, never whatever the registry has published since.

Setup asks:

```
Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ~/.claude/skills/terum-skills) [y/N]
```

Answering no prints `Skipped the /terum-skills skill; re-run setup to install it later.` and writes nothing.

### How it is recognised and refreshed

Terum's copy is marked in the SKILL.md frontmatter: `name: terum-skills` plus `metadata.managed-by: terum-skills`. That marker is the whole idempotency key.

An outdated copy carrying that marker is refreshed in place without a second question, because the consent was given when it was installed and a stale manual teaches Claude the wrong verbs. Setup does it, and `sync --hook` does it too, printing `Updated your /terum-skills manual for this CLI.` on its notice channel. Outdated means byte-different from the bundled copy rendered in this machine's spelling, so a manual placed by a different copy of the CLI is outdated by that definition and is rewritten on the next setup or hook run.

Anything else at that path is foreign and is never written to or removed: a symlink, a plain file, a folder with no SKILL.md, or a different skill. The CLI names it and leaves it alone. A folder you declined is absent, and the hook never installs what you said no to.

### What Claude may run, and what it hands you

The skill divides the CLI in two, and the dividing line is a question. Claude Code's Bash tool has no TTY, so a verb that needs an answer fails with:

```
Cannot ask "…": this command needs an interactive terminal (stdin is not a TTY).
```

A refusal does not prove nothing happened. A verb can clone, record intent or finish a write before it reaches its first question, so the skill tells Claude to read all the output before reporting an outcome.

Verbs Claude runs in the session, because they never ask, or ask only sometimes:

`status`, `ls`, `ls member`, `ls project`, `ls --local`, `project add <path>`, `project remove`, `project list`, `search`, `skill fix`, `skill category`, `validate`, `update`, `app`, `app-update`, `sync`, `install`, `invite`, `profile`, `login --set`, `team workflow-update --print`, the whole `eval` family, `eval-report` and `serve`.

Verbs it prepares and hands to your terminal, because they need an answer or can write before their first question:

`publish`, `project add` with no path, `skill move`, `skill copy`, `skill rename`, `skill delete`, `skill enable`, `skill disable`, `prune`, `uninstall-skill`, `uninstall`, `team leave`, `team remove`, `team move`, `team project create`, `team project delete`, `team migrate`, and the wizards: `setup`, `team create`, `team join`, bare `login`.

`unpublish` and `reconcile` are in neither list, so the skill gives Claude no rule for them.

The skill's own rules keep that line honest: never pipe `y` on stdin, never invent flags, never drive the CLI through `expect` or `script`, and never use `--frames` to get around the TTY rule. It also tells Claude to confirm with you before anything that spends money (every `eval`) or changes the team (`install`, `invite`, `profile`).

### Removing it

There is no separate remove verb. `npx -y terum-skills@latest uninstall` removes the managed copy as part of the machine teardown and prints `Removed the /terum-skills Claude Code skill from <path>.` Otherwise delete `~/.claude/skills/terum-skills/` yourself; setup offers it again next time.

## The session-start hook

Setup asks:

```
Install the Claude Code session-start hook so team skills sync automatically? (edits ~/.claude/settings.json) [y/N]
```

Yes writes one entry into `hooks.SessionStart` in `~/.claude/settings.json`:

```json
{
  "matcher": "startup",
  "hooks": [
    { "type": "command", "command": "npx -y terum-skills@0.20.1 sync --hook", "async": true, "timeout": 60 }
  ]
}
```

The command is this copy of the CLI, pinned, and never `@latest`. Where the [bare invocation form](../reference/cli.md#invocation) is available, which means a global install this CLI found first on `PATH` on macOS or Linux, the entry reads `terum-skills sync --hook` instead; everywhere else, including every Windows machine, it is the npx form carrying this copy's version. Nothing fetches a newer CLI at the start of a session, and a newer release reaches the entry only when you update the package and re-run `setup`.

Before the first write it takes one verbatim backup of your settings file to `~/.terum/skills/backups/settings.<timestamp>.json`, and only if no settings backup exists yet. Writes are atomic and keep the file's mode. A settings file that is not valid JSON, or whose `hooks`, `hooks.SessionStart` or `hooks.PostToolUse` is the wrong shape, is refused outright: `Cannot edit <path>: it is not valid JSON. Fix it by hand or move it aside, then re-run.` Reinstalling strips every terum-skills command already under `SessionStart` first, so there is never a duplicate, and a group that holds other people's commands keeps them.

### What sync --hook does

For each configured team it fetches the clone and resets it to `origin/main`, under the per-clone lock, with a 20-second deadline and a git environment that cannot open a credential dialog. A team fetched within the last hour is left alone. A successful fetch writes `~/.terum/skills/run/<team>.stamp`.

It places nothing, uploads nothing and edits none of your skill folders. The exceptions are Terum's own artefacts described on this page: its own `SessionStart` entry, an outdated `/terum-skills` manual and an outdated edit-hook script.

Re-pointing its own entry is a one-time migration. Releases before the pinning change wrote `npx -y terum-skills@latest sync --hook`, so a hook run compares the command in the entry against the one this copy would write and rewrites the entry when the two differ. It never installs an entry where none of ours exists, because an hourly hook must not install what somebody declined. When it does rewrite one, stderr carries:

```
Pinned your session hook to this copy of terum-skills (npx -y terum-skills@0.20.1 sync --hook); it no longer fetches the newest release at session start. Re-run `npx -y terum-skills@latest setup` after an update to move it.
```

A settings file it cannot read or edit costs one more stderr line, `Could not pin the session hook in <path>: <reason>`, and nothing else. The fetch has already happened by then, so the run is not failed over it.

Its stdout is exactly one line, the reload directive:

```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","reloadSkills":true}}
```

Everything else, including per-team failures and the two refresh notices, goes to stderr so that line stays parseable. Concurrent runs on one clone are serialised by that clone's own writer lock, and a run that finds it held reports `<team>: not refreshed (busy)` on stderr and still exits 0. `sync --hook` is refused under `--frames`.

The entry is marked `async` with a 60-second timeout, so the fetch runs beside your session rather than holding it up. The edit hook below carries no `async`, for the opposite reason: its reminder has to reach the model's next turn.

### Removing it

The hook goes when your last team goes. `team leave <name>` removes it with the last team and prints `Removed the session hook from <path>.`, and `uninstall` removes it during machine teardown. There is no separate switch, and the app's Settings ▸ Sync row says so: it is read-only and reads `Managed by setup`. You can also delete the entry from `~/.claude/settings.json` by hand.

## The edit hook

A skill edited in a session is a skill only your machine has. Nothing in the CLI is watching, so the change sits in your Library until somebody remembers to publish it. This hook speaks at that moment.

It is a separate offer with its own question, because the session hook fetches on a schedule and this one reads what the agent is editing:

```
Remind Claude Code to publish a skill after it edits one? (installs ~/.terum/skills/hooks/terum-skills-edit.mjs and a Write/Edit hook in ~/.claude/settings.json) [y/N]
```

Yes writes the script to `~/.terum/skills/hooks/terum-skills-edit.mjs` and this entry into `hooks.PostToolUse`:

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    { "type": "command", "command": "node \"<home>/.terum/skills/hooks/terum-skills-edit.mjs\"", "timeout": 10 }
  ]
}
```

It is a placed script run through `node`, not an `npx` invocation, because it runs on every Write and Edit the agent makes anywhere. It imports nothing from the package, reads no network, and does no work at all unless the edited path is inside a `.claude/skills/<skill>/` folder. It is not `async`, because the reminder has to reach the model's next turn.

When the edit is inside a skill folder, terum-skills is set up and a team is configured, the hook writes a note that begins:

```
You edited <name>, a skill in this machine's terum-skills Library (<folder>).
```

The rest of the note says whether that folder is an installed copy of a team version, that the edit is local until it is published, and gives the `publish` and `eval` commands, with the warning that `publish` asks questions and so needs a real terminal. It appears once per skill per session, recorded under `~/.terum/skills/run/edit-hints/`, swept after seven days. Any failure is silence: the script always exits 0, because a reminder is never worth interrupting an edit.

### Removing it

`uninstall` removes both halves, the settings entry first so that no entry ever names a deleted script, and prints `Removed the terum-skills edit hook from <path> and <settings>.` By hand, delete the `Write|Edit` entry from `~/.claude/settings.json` and the script under `~/.terum/skills/hooks/`. A file at that path that is not Terum's own keeps its settings entry too: the CLI removes only what it wrote.

## The per-machine switch

Claude Code loads whatever sits in a skills directory, so terum-skills cannot switch a placed copy off without moving the folder. It does not have to. Claude Code has its own `skillOverrides` setting, and `off` hides a skill from the model and from the `/` menu. This is the same key the `/skills` menu writes.

```sh
npx -y terum-skills@latest skill disable ~/.claude/skills/deploy-check
npx -y terum-skills@latest skill enable ~/.claude/skills/deploy-check
```

Nothing moves and no ledger row changes. Where the entry is written depends on the root the folder sits in:

| Folder | File written | Files read |
|---|---|---|
| Global (`~/.claude/skills/<name>`) | `~/.claude/settings.json` | the same |
| A project (`<repo>/.claude/skills/<name>`) | `<repo>/.claude/settings.local.json` | `~/.claude/settings.json`, then `<repo>/.claude/settings.json`, then `<repo>/.claude/settings.local.json` |

Those are Claude Code's own precedence rules, and its `/skills` menu saves to the same project-local file. When the CLI creates `settings.local.json` in a checkout it appends that path to `.git/info/exclude`, the way it keeps placed folders out of git. A checkout without git keeps the setting and hears why the exclude was skipped.

Only `off` belongs to terum-skills. `name-only` and `user-invocable-only` still let Claude or you reach the skill, so they read as enabled, and `enable` never removes them. Names are matched the way Claude Code matches them, ignoring case and spacing, so a hand-written entry is honoured.

The verb prints what it did and where:

```
Enabled deploy-check: Claude Code loads it again on this machine (skillOverrides in /home/you/.claude/settings.json).
Disabled deploy-check: Claude Code no longer loads it on this machine (skillOverrides in /home/you/.claude/settings.json).
```

A folder already in the state you asked for prints `<name> is already enabled; nothing changed.` A path that is not a folder directly under a `.claude/skills` directory is refused.

The switch on a Library card in [the app](desktop-app.md) calls exactly this verb, and the next Library read brings `enabled` back from the same settings files, so the app's switch and Claude's menu can never disagree. Every row `ls --local` returns carries the same `enabled` field. A skill moved or renamed with `skill move` or `skill rename` carries its `off` to the destination's settings file, and removing a skill clears the `off` so a reinstall is not born disabled.

## How evals use your Claude Code login

Evals run on your own machine, on your own Claude Code subscription. There is no Terum account and no API key: the eval engine spawns the `claude` binary on your `PATH` (or whatever `TERUM_SKILLS_AGENT_CMD` names), one headless session per arm, with `--setting-sources project` so your user-level settings and hooks stay out of the sandbox. The arms, the sandbox, the preflight and its failure lines are in [Running evals](../evaluating/running-evals.md); the Windows `claude.cmd` shim resolution is in [Platforms](../reference/platforms.md).

## How usage and misses read your transcripts

`usage` reads Claude Code's own transcripts under `~/.claude/projects` and counts each placed skill's firings, then archives what it scanned to `~/.terum/skills/run/usage-events.jsonl` so the count survives Claude Code's roughly 30-day transcript retention. It makes no model call at all, which is what lets the app run it on every skill page. Its `--since` bound is validated and canonicalised before the scan, and `--all` folds the names that fired with no placement here into the one table.

`misses` reads the same transcripts for the question `usage` cannot answer: which prompts a placed skill should have been chosen for and was not. It harvests the prompts themselves rather than firing records, and it does spend Claude Code sessions, one `claude -p` call per ten prompts, so it is a verb you run rather than something a page opens. It writes nothing.

The detectors, the row model, the sample output and the archive rules are in [Usage](../evaluating/usage.md); both verbs' flags and refusals are in [the CLI reference](../reference/cli.md#usage).
