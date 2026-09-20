# Library and Marketplace

Two different lists. The Library is what is on this machine. The Marketplace is what your team has published. They are joined by bytes, and by nothing else.

## Library: the skills on this machine

The Library reads local files and nothing else. It never fetches, never prompts, and never writes.

It scans exactly two kinds of root:

- **Global**: `~/.claude/skills` (`%USERPROFILE%\.claude\skills` on Windows).
- **A project you registered**: `<project>/.claude/skills`, for every folder you added with `project add`. A folder registered inside another registered folder is that project's sub-project, named by its path inside it; the tree is the folder structure.

```sh
npx -y terum-skills@latest project add <path>
npx -y terum-skills@latest ls --local
```

The folder you happen to be standing in is never scanned. A project root is in the Library because you added it, and for no other reason. A placement recorded under a folder you never added is not evidence that you want that folder in the list.

Only direct children of a root are considered, and only real directories. A symlinked skill folder is refused and never followed, and so is a folder containing a symlink. A plain file sitting in a skills root is not a skill: it draws no row and is not counted.

### What `ls --local` reports per folder

Per root, you get a heading naming the path and scope, a `GitHub:` line carrying the checkout's origin slug when the root is a project, one row per skill folder, a list of folders it could not read as skills, and a count: `N skill folders (M connectable)`.

The printed row gives the name, the state and the path. A program or the app reads the same row as fields:

| Field | What it means |
| --- | --- |
| State | `untracked locally`, or `placement recorded from <team> (Version N)` when this machine has a ledger row for the folder. |
| Matched team version | The committed version whose bytes are identical to this folder's, found by content digest across every configured team clone, with the team and the skill name it is filed under. Null when no version matches. |
| Team eval | The newest committed receipt whose `content_digest` equals this folder's digest. It is the team's score for these exact bytes, not for this skill in general. |
| Local eval | The newest receipt in this machine's own store for these exact bytes. |
| Stale | Set when nothing scored these bytes but something has scored this skill at a different digest. In other words, you edited it after it was evaluated. |
| Enabled | False only when Claude Code's own `skillOverrides` setting says `off` for that name. |
| Health | `local-changed` when the folder's live fingerprint differs from the one the ledger recorded at install; `unknown` otherwise. |
| Description, category, characters, updated | Read from the folder's `SKILL.md`. |

When identical bytes exist in more than one team and no placement decides which, no version is shown and the row is reported as ambiguous rather than guessed.

### The states a folder can be in

These are independent of each other. A folder can be placed, edited and disabled at once.

| State | What it means |
| --- | --- |
| Placed | `install` copied a team version here and recorded a ledger row for the path: the skill's uuid, its team, its version, its scope, the date, and a fingerprint of what it wrote. The ledger is the only authority for a path this tool may delete. |
| Adopted | The folder was already here and you told `install --adopt <path>` to record it. The ledger row is written, but not one byte is copied. |
| Unpublished, or local-only | A folder in a Library root with no ledger row and no matching team version. Yours, on this machine, and nowhere else. |
| Modified since install | Placed, but its live fingerprint no longer matches the ledger's. Reported as `local-changed` and `edited`. Any later removal moves the folder to `~/.terum/skills/quarantine/<timestamp>/<name>` instead of deleting it. |
| Disabled | Claude Code's `skillOverrides` says `off` for that skill name. The folder is untouched and still on disk; Claude does not load it. |

"Disabled" is deliberately not a Terum concept. `skill disable` and `skill enable` write Claude Code's own setting, the same key its `/skills` menu writes, so the app's switch and Claude's menu can never disagree. A global folder is governed by `~/.claude/settings.json`; a folder in a project is read from the user file, then the checkout's `.claude/settings.json`, then its `.claude/settings.local.json`, and written to the last of those. Only `off` belongs to this tool: `name-only` and `user-invocable-only` read as enabled, and `enable` never removes them.

## Marketplace: what the team has published

```sh
npx -y terum-skills@latest ls
```

This reads the team clone as it stands. It does not fetch; run `sync` first if you want today's version of the repository.

Per skill you get one line:

```
  deploy-check — Ada Lovelace <ada@example.com>; infra; 4 installs; Version 3; project: platform; 2026-09-12T14:03:22+01:00
```

The last field is the committer date of the most recent commit that touched `skills/<name>`, read from the clone's own history.

A program or the app gets the same facts as fields:

| Field | Source |
| --- | --- |
| Newest version | The highest `v<N>` folder under `skills/<name>/`, sorted numerically. `v10` is newer than `v2`. |
| Author | `metadata.author` in the newest version's `SKILL.md`, written as `Name <email>`, never a handle. |
| Category | `metadata.terum-category` in the newest version's `SKILL.md`. |
| Install count | How many teammates have the skill in their `installed[]`, counted once per person even when they installed it twice, and including archived members. |
| Projects that list it | The team projects whose `skills` list names its uuid, or `—` for the marketplace alone. |
| Verdict | From the newest usable committed receipt, walking versions newest-first. When the latest version's own receipt is missing or unreadable, an older version's score is shown and marked as not current. |

`—` under projects means the marketplace alone. It does not mean unshared: the version folder is the shared copy, and a project list is an optional second place the team also names the skill.

The app's Marketplace opens on a shelf titled `Top rated`, subtitled `by installs, from people files`. It sorts by that install count. Nothing in the app ranks a skill by its eval result, so read the shelf as the most-installed skills and the row's verdict as the score.

### How a Library folder and a Marketplace version are linked

By identical bytes. Both sides run the same content digest, and the Library row joins to whichever committed version folder digests the same. The name is not consulted, so a folder you renamed still matches, and two folders with the same name but different content do not.

Which is why a local edit detaches the score. Change one character in a placed skill and its digest changes; no committed version has those bytes, so the matched version and the team's receipt both drop off the row, and the row is marked stale instead. Nothing is lost. The team's version and its receipt are exactly where they were, and publishing your edit mints the next version and gives it its own score.

## Team projects and library projects

Two different things that share a word.

| | Team project | Library project |
| --- | --- | --- |
| Where it lives | `team.json`, in the shared repository | `config.json`, on this machine |
| What it is | A named list of skill uuids, plus the git remotes its skills belong in | A folder on disk whose `.claude/skills` the Library scans |
| Who sees it | Everyone on the team | This machine only |
| Created by | `team project create`, or the app's Create project button | `project add <path>` |
| Used for | Grouping published skills, and `install project <name>` | Finding your local skills, and choosing an install destination |

They interact in exactly one place: `install project <name>` reads that team project's declared remotes and defaults the `Install to` question to the registered library project whose `origin` matches one of them, if precisely one does. Every other install offers `Global (~/.claude/skills)` as the default.

## Your profile and your installs

Your people file carries both lists, and they answer different questions.

| | `installed[]` | `profile[]` |
| --- | --- | --- |
| Means | A copy is on a machine | I stand behind this |
| Written by | `install`, automatically | `publish`, with no question; `install`, after asking once with a default of No |
| Removed by | `uninstall-skill`, when the last local copy at that scope goes | `profile --remove <skill>` |
| Carries | The skill uuid, the version, the scope, the date | The skill uuid, its name, the version, the date, and whether it arrived via publish or install |

Publishing and installing both add the entry without asking: typing `publish` or `install <name>` chose the skill by hand, and that is the endorsement. It is one entry per skill, updated in place, and `profile --remove` takes it off.

`install member <handle>` installs that person's `profile[]`, not their `installed[]`. You get what they endorse, not everything they happen to have.

## Categories

A team's category list lives in `team.json` as `categories`, and a new team starts with `debugging`, `testing`, `docs`, `workflow`, `research`, `infra`, `misc`.

The list is advice, not an enum. Nothing refuses a category that is not on it. Publishing a skill whose category is off-list prints a warning and continues:

```
warning HYG7 SKILL.md:6: terum-category `ops` is not one of your team's categories (debugging, testing, docs, workflow, research, infra, misc). Browse will give it a bucket of its own; add it to team.json or change this line.
```

A skill's own category lives in its `SKILL.md`, at `metadata.terum-category`, and it is part of the content digest: change it, and the next publish mints a new version.

Publish picks one in this order:

1. **The file wins.** If the `SKILL.md` already declares `metadata.terum-category`, that is the category, and nothing else runs.
2. **Otherwise `--category <name>`**, if you passed it. A value that matches a team category case-insensitively is stored in the team's own spelling, so `--category Ops` lands in the single `ops` bucket. A value that is on no list is kept as you typed it, trimmed.
3. **Otherwise the model is asked.** The first 2,000 characters of your `SKILL.md` go to `claude --model haiku` with the team's category list, and it must answer with one of them. An answer that is not on the list is not invented into a bucket.
4. **Otherwise `misc`**, which is what you get when the model could not be reached, the team's list is empty, or the answer was unusable.

Whichever way it went, publish says so on one line, for example:

```
metadata.terum-category: infra (suggested from your SKILL.md; edit any time)
```

and writes the value into your local `SKILL.md`. After that it is ordinary content, and step 1 covers every later publish.
