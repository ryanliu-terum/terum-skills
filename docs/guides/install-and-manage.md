# Install and manage skills

Installing copies one published version out of the team clone into a folder Claude Code reads. After
that the copy is yours: the verbs on this page move it, rename it, switch it off, take it away, or
bring your clone up to date.

## Installing

```sh
npx -y terum-skills@latest install <ref>
```

Install always installs the latest version. A ref carrying `@<version>` is refused with `Installing a
previous version is not supported yet; install installs the latest version.`

### Ref forms

| Form | Meaning |
| --- | --- |
| `deploy-check` | A skill in the team this machine is configured for. An id prefix works too, and an ambiguous prefix is refused by name. |
| `acme/deploy-check` | The same, naming the configured team explicitly. |
| `ryanliu-terum/shared-skills/deploy-check` | A skill in a GitHub repository, named `<owner>/<repo>/<skill>`. |

The three-part form does the bootstrap on a machine that has joined nothing: it runs the setup flow
for that repository with its print-only steps suppressed, then installs, in one command. A machine
that is already bound to a different repository is refused instead, because one machine holds one
team. A machine bound to that same repository resolves the ref to the team it already has.

### Installing a person or a project

```sh
npx -y terum-skills@latest install member ajayw36
npx -y terum-skills@latest install project docs-site
```

`install member` installs what that person stands behind, which is their `profile[]` list, not
`installed[]`. `installed[]` is an automatic record of what happens to sit on their machines;
`profile[]` is curated. A person with an empty profile is refused by name rather than installing
nothing:

```
ajayw36 has nothing on their profile yet, so there is nothing to install. A teammate adds a skill to their profile when they publish it or when install asks.
```

`install project` installs every skill the team project lists, at that project's scope. An unknown
name is refused with `Unknown project docs-site.`

Both ask the destination question once and then install each skill into it.

### Where the copy goes

An interactive install asks:

```
Install to [Global (~/.claude/skills)]
1. Global (~/.claude/skills)
2. web · /home/me/dev/web
>
```

The list is Global plus every project you registered, and nothing else. With no projects registered
it offers Global alone. Global is `~/.claude/skills`, or `%USERPROFILE%\.claude\skills` on Windows;
this tool's own state lives in `~/.terum/skills`, or `%USERPROFILE%\.terum\skills`.

For `install project`, the preselected row is the registered root whose `origin` matches one of the
team project's remotes. With no match the default is Global. With more than one match nothing is
preselected, because choosing one over the other would be a guess.

Skip the question with a flag:

| Flag | Effect |
| --- | --- |
| `--into global` | Install to `~/.claude/skills`. |
| `--into /home/me/dev/web` | Install to that registered project's `.claude/skills`. |

Install never adds a project. An `--into` path you have not registered is refused:

```
/home/me/dev/web is not a project in your library. Add it with `npx -y terum-skills@latest project add /home/me/dev/web`, or pass --into global.
```

A non-interactive run with no `--into` lands in Global when no projects are registered, and refuses
with `Pass --into global or --into <project root>` when some are.

### Registering projects

```sh
npx -y terum-skills@latest project add [path]
npx -y terum-skills@latest project remove <path>
npx -y terum-skills@latest project list
```

Registering a folder means its `.claude/skills` becomes a Library root. Everything that reads your
Library reads it from then on: `ls --local`, `publish`, `eval`, and the install destination list.

`project add` with no argument asks `Which folder?`, offering the nearest enclosing git repository
root, or the current folder when there is none. It prints `Added /home/me/dev/web to your library.`
or `/home/me/dev/web is already in your library.` When a team is configured it then runs `reconcile`
over that one root. A folder that does not exist, is not a folder, or is your home directory is
refused.

The current folder is never registered automatically, by any verb. A project root appearing because a
command happened to run inside it is exactly the thing that made it impossible to say what this
machine tracks.

`project remove` forgets the registration and touches no files:

```
Removed /home/me/dev/web from your library.
2 placements recorded under /home/me/dev/web stay in the ledger; uninstall-skill removes them.
```

`project list` prints one line per project with its label, path, scan state, and skill-folder count,
or `none`.

### The questions install asks

**Tools.** A skill that requests `allowed-tools` asks once:

```
deploy-check requests allowed-tools:
Bash(git status)
Read
Approve these tools for deploy-check? [y/N]
```

The detail lines come first, then the question. The answer is remembered per skill id, keyed by a hash of the normalised grants, so the same skill
with the same grants never asks again and a skill whose grants changed asks afresh. A skill
requesting nothing is not asked. A skill whose `allowed-tools` cannot be parsed asks a different
question, `Install deploy-check despite malformed allowed-tools?`, and that answer is not remembered.

**A folder already at the destination.**

```
You already have a skill named deploy-check.
Your copy is kept at /home/me/.claude/old-skills/deploy-check.
Replace it with Version 4? [y/N]
```

Your copy is moved to `old-skills`, a sibling of the `skills/` root that was targeted, so a project
install keeps it at `<project>/.claude/old-skills/<name>`. Nothing scans that folder: Claude Code
reads `.claude/skills/*` and the Library resolves `<root>/.claude/skills`, so a sibling directory is
never a skill. For a project root, `.claude/old-skills/` is added to `.git/info/exclude`. Nothing
ever empties it, so clean it up by hand.

If a kept copy is already there, install refuses rather than overwriting it: `<path> already exists;
move the kept copy elsewhere before retrying.`

**Your profile.** After the install lands:

```
Add deploy-check to your profile?
```

The default is no, and a non-interactive run declines rather than failing. `--yes-profile`
pre-answers it yes. Installing someone else's skill is a copy onto a machine, not a statement about
the skill, which is why this is asked here and not at publish.

### Adopting a folder you already have

```sh
npx -y terum-skills@latest install --adopt ~/.claude/skills/deploy-check
```

Adopt records an existing Library folder as installed without copying a byte. It takes no
destination, and it cannot be combined with a ref. The folder must match a published version of a
team skill byte for byte:

| Line | Cause |
| --- | --- |
| `<path> is not a folder in your Library.` | The path is outside every Library root, or is not a folder the scan accepts. |
| `<path> does not match any published version of a team skill byte for byte; publish it instead.` | Your copy has been edited, or was never the team's. |
| `<path> holds the bytes of deploy-check Version 3 under a different folder name; rename it to deploy-check first.` | Right bytes, wrong folder name. |
| `<path> is already recorded as installed.` | There is already a placement for that folder. |

Adopt still asks the tools question. It records the placement at Global scope and does not offer the
profile.

### What an install writes

On your machine:

| Where | What |
| --- | --- |
| `<root>/.claude/skills/<name>` | The version folder, copied whole through a staging directory, so a partial folder is never visible at the destination. |
| `~/.terum/skills/config.json` | A placements ledger row: the skill id, the team, the version, the scope, the date, and a fingerprint of the bytes as placed. |
| `~/.terum/skills/evals/local/<digest>/<runId>/receipt.json` | Every committed receipt for the version you installed, so the copy shows the team's real score for exactly your bytes. A receipt with no content digest is not seeded and prints `Skipped 20260908T131500Z: no content digest (pre-migration receipt).` An unreadable one prints `Skipped 20260908T131500Z: invalid receipt.` |

In the team repository, one commit to your own people file:

- an `installed[]` row of `{ id, version, scope, since }`, one per skill and scope,
- `local_skills`, a count of how many skill folders this machine holds across Global and your
  registered projects. It is a self-report, and it is left alone rather than set to zero when a root
  cannot be read.

The placements ledger is the only authority for a path this tool may later remove.

## Removing a skill

```sh
npx -y terum-skills@latest uninstall-skill deploy-check
npx -y terum-skills@latest uninstall-skill member ajayw36
npx -y terum-skills@latest uninstall-skill project docs-site
```

`uninstall-skill member` is the exact inverse of `install member`: it targets that person's current
`profile[]` list, and every scope comes from this machine's own ledger. `uninstall-skill project`
takes back exactly what `install project` placed, at project scope, so a Global copy you installed
separately survives.

Before asking, the preview says exactly what goes:

```
Folders removed (1):
  /home/me/.claude/skills/deploy-check  ·  Global
Local changes are moved to /home/me/.terum/skills/quarantine, never deleted.
Install records dropped from your people file (1): deploy-check
Your profile is unchanged.
Remove deploy-check? [y/N]
```

When a copy at that scope stays, the fourth line reads `Install records dropped from your people file
(0): another copy stays, so your records are kept`. The bulk questions carry one extra line each:
`Targets are ajayw36's current profile list, not what you installed from them.` for a member, and
`Copies installed to Global stay.` for a project.

`--from global` or `--from <checkout root>` picks which copy goes. With several copies at one scope
and no flag, an interactive run asks `Remove which copy?`; a non-interactive one refuses with `Pass
--from global or --from <checkout root>`. A ref that resolves to nothing placed here says so and
exits without asking: `4f3a19c2 is not placed on this machine.`

A copy whose bytes no longer match the fingerprint recorded at install is moved, never deleted:

```
Local changes at /home/me/.claude/skills/deploy-check moved to /home/me/.terum/skills/quarantine/2026-09-16T09-12-04-881Z/deploy-check.
```

An unchanged copy is removed outright, because the team repository still holds those exact bytes.
Uninstall also drops this tool's `off` from Claude Code's `skillOverrides`, so a skill you switched
off and removed is not born disabled the next time you install it. Your `profile[]` is untouched: an
entry there is a statement about a skill, not a claim that a copy is on this machine.

## Keeping the clone current

```sh
npx -y terum-skills@latest sync
```

Sync fetches each configured team clone and hard resets it to `origin/main`, under that clone's
writer lock, and records `~/.terum/skills/run/<team>.stamp`. It exists because every read verb is
fetch-free, so a teammate's commit reaches this machine only when something fetches.

The verb's help text says `Nothing on this machine is changed: no placement, no upload, no edit to
your skills.` The fetch itself uploads nothing and writes only the clone and the stamp. The run as a
whole goes further in two places on this page: hook mode rewrites this tool's own managed files, and
accepting the successor offer runs `team move`, which removes and re-places every placed skill. The
stamp means the clone was fetched at that time and left at that commit. It makes no claim about your
folders.

A team that cannot be refreshed is reported, not fatal:

```
acme: not refreshed (unreachable) — remote: Repository not found.
```

The states are `refreshed`, `fresh`, `busy`, `unreachable`, `no-clone` and `error`.

### Hook mode

`sync --hook` is what a Claude Code session-start hook runs. It differs in three ways:

- a clone fetched within the last hour is reported as `fresh` and left alone,
- an outdated managed copy of the bundled `/terum-skills` skill is refreshed, printing `Updated your
  /terum-skills manual for this CLI.`, and so is the edit hook's script, printing `Updated your
  terum-skills edit hook for this CLI.` A copy you declined, or never saw offered, is never installed
  by the hook, and a file that is not this tool's own is never touched,
- stdout carries only Claude Code's reload directive, so diagnostics travel as notices.

### When a repository is gone

If the remote answers "repository not found" for a GitHub team, sync looks for where the team went
and prints a summary. At a terminal it then offers the move:

```
Move this machine from acme to the replacement? [ryanliu-terum/shared-skills]
1. ryanliu-terum/shared-skills
2. Not now
>
```

Taking it runs `team move` for you. A hook, a pipe or a non-interactive run prints the command
instead: ``To follow it, run `npx -y terum-skills@latest team move ryanliu-terum/shared-skills`.``
The lookup is cached per team for ten minutes, except at a terminal, where it is always asked fresh.

## Reconciling your Library against the team

```sh
npx -y terum-skills@latest reconcile
npx -y terum-skills@latest reconcile --list
```

Reconcile scans your Library roots, digests every folder that has no placement, and sorts the matches
into three groups:

| Group | Meaning | What is offered |
| --- | --- | --- |
| identical | The folder's bytes are a published version, under the same name | `Record deploy-check as installed (Version 3)?` |
| differing | The name matches a team skill, the bytes do not | A publish question naming the next version |
| renamed | The bytes are a published version under a different folder name | Nothing. It prints the fact and moves on. |

```
Checking your library against the team…
2 of your skills match the team's exactly; 1 share a name with a team skill but differ.
```

The publish question has two forms. When your folder already carries the team's id for that name it
is short. When it does not, it says whose skill you would be publishing over and how to keep them
separate:

```
Publish your version of deploy-check as Version 4 of the team's deploy-check? Your folder carries no team id for this name, and the team's copy was published by ajayw36; publishing makes your content the next version of their skill. To keep them separate, rename yours first: npx -y terum-skills@latest skill rename /home/me/.claude/skills/deploy-check --to <new-name>.
```

Rows are independent: declining one, or a refusal on one, still offers the next. The run ends with
`Recorded 1 install. Published 0 skills.`

`--list` prints both groups with their versions and paths and asks nothing. Reconcile also runs by
itself after `project add`, over the project that was added.

## Managing the folders themselves

| Command | What it does |
| --- | --- |
| `skill move <path> --to global\|<project root>` | Moves the folder to another Library root. The original is gone. |
| `skill copy <path> --to global\|<project root>` | Copies it into another root. The original stays. |
| `skill rename <path> --to <new-name>` | Renames the folder and rewrites `name:` in its `SKILL.md`. |
| `skill delete <path>` | Removes the folder after you type its name. |
| `skill fix <path>` | Applies every mechanical repair and reports what still needs you. |
| `skill category <path> --to <name>` | Rewrites `metadata.terum-category`. See [Publishing](publish.md#changing-a-category). |
| `skill enable <path>` / `skill disable <path>` | Switches the folder on or off for Claude Code on this machine. |

The rails are the same for all of them. The folder must sit **directly** under a `.claude/skills`
directory, and that directory must be one of your Library roots:

```
Refusing /home/me/skills/deploy-check: it must sit directly under a Library skills root.
Refusing /home/me/dev/other/.claude/skills/deploy-check: its parent is not a registered Library root.
```

Symlinks are refused, both as the folder and inside it. `--to` is required on move, copy, rename and
category, and a rename must be 1 to 64 lowercase alphanumerics or single hyphens.

**Collisions.** A move or a copy onto an occupied name keeps the existing folder at
`<root>/.claude/old-skills/<name>` and says so: `Your previous copy is kept at <path>.` A rename onto
an occupied name is refused instead: `<dest> already exists; choose another name.`

**The typed name is delete's alone.** Move, copy and rename are each undone by running the verb the
other way and never overwrite anything, so the extra friction bought nothing. Delete asks:

```
Type deploy-check to delete this folder:
```

Anything else cancels with `The name did not match; nothing changed.`

**What delete does with the folder** depends on what it is:

- a folder with no placement goes to quarantine: `Moved <path> to <quarantine>. Undo by moving it
  back before prune.`
- a placement goes through uninstall, which says so first: `This skill was installed from the team —
  deleting it also removes it from your installs.` An unmodified copy is removed outright, because
  the team repository holds those bytes. A copy you edited is quarantined.

**The on/off switch** writes Claude Code's own `skillOverrides` setting and keeps no state of its
own, so this tool's switch and Claude Code's `/skills` menu always agree. A Global folder is governed
by `~/.claude/settings.json`; a project folder by that checkout's `.claude/settings.local.json`,
which is added to `.git/info/exclude` when it is created.

```
Disabled deploy-check: Claude Code no longer loads it on this machine (skillOverrides in /home/me/.claude/settings.json).
Enabled deploy-check: Claude Code loads it again on this machine (skillOverrides in /home/me/.claude/settings.json).
deploy-check is already disabled; nothing changed.
```

Only `off` belongs to this tool. `name-only` and `user-invocable-only` still let Claude Code or you
reach the skill, so they read as enabled and `enable` leaves them alone. A renamed or moved folder
carries its `off` with it, and says so; a copy is a second, enabled folder; delete and uninstall clear
it.

**Quarantine and prune.** Quarantine is `~/.terum/skills/quarantine`. Anything this tool declines to
delete goes there: a drifted copy on uninstall, a deleted non-placement, a displaced folder it could
not remove, and a team clone with unpushed work on `team leave`.

```sh
npx -y terum-skills@latest prune
```

Prune lists every quarantined item, asks `Delete 3 quarantined item(s)?`, and deletes them on yes. It
is the only thing that permanently removes quarantine. It does not touch `old-skills`.

## Finding things

| Command | What it shows |
| --- | --- |
| `ls` | The team: members, then one line per shared skill with its author, category, install count, latest version, project listing and last change date. |
| `ls --local` | Your Library: one section per root, each row's name, placement state and path, then the folders that could not be inspected as skills, then the counts. |
| `ls member <handle>` | What that member authored and what they have installed. |
| `ls project <name>` | The skills a team project lists. |
| `search <term>` | Shared skills whose name, description or category contains the term. |
| `status` | This machine: CLI version, the configured team and your handle, its repository, clone state, the first five members and the roster size, the shared skill count, and whether the clone may be stale. |

`search` narrows with `--category`, `--author` and `--project`, each matched as a substring except
`--project`, which must name a team project that lists the skill. With no hits it prints `No skills
found.`

Every one of these reads local files and the clone. None of them fetches, so a listing can be behind
the team. When the clone has not been fetched within the hour they say so:

```
acme may be stale; run `npx -y terum-skills@latest sync`.
```

`ls --local` is the one that shows folders which are not shareable. A folder the scan could not
accept is still listed: an untracked one under `Could not inspect as skills:` with its reason, a
placed one as an ordinary row carrying `source problem: <detail>`. A folder you cannot see is a
folder you cannot fix, move or delete.

Related: [Publishing a skill](publish.md) · [Team administration](team-admin.md) ·
[Library and Marketplace](../concepts/library-and-marketplace.md) ·
[Local state on this machine](../reference/local-state.md) · [CLI reference](../reference/cli.md)
