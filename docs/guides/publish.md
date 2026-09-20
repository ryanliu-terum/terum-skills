# Publish a skill

Publishing copies one folder from your Library into the team repository as its next immutable
version. It is the only thing that can write a skill to the team, and it only ever runs because you
typed it.

```sh
npx -y terum-skills@latest publish <skill-or-path>
```

The ref is a skill name, or a path to the folder. A name is matched against your Library roots:
Global (`~/.claude/skills`, or `%USERPROFILE%\.claude\skills` on Windows) plus every project you
registered with `project add`. A path that resolves outside those roots is not found, so publish can
never be pointed at an arbitrary folder on disk.

## Before you publish

| You need | How to get it |
| --- | --- |
| The folder in your Library | It is under Global already, or its project is registered. See [Installing and managing skills](install-and-manage.md#registering-projects). |
| A configured team with a joined handle | `npx -y terum-skills@latest setup <org>/<repo>`. Publish refuses with `Team <team> has no joined handle.` when the machine has a team entry but never completed a join. |
| A folder that passes hygiene | `npx -y terum-skills@latest validate <path>` reports every finding. `npx -y terum-skills@latest skill fix <path>` repairs the mechanical ones. |

`validate` runs the same deterministic checks publish runs, offline and with no model call. `skill
fix` writes only the repairs whose right answer is fixed by something outside your typing: YAML
quoting, the `name:` field that must equal the folder name, the team's licence, invisible
characters, and an executable bit on a file that is not a script. Everything that needs a judgement
is reported instead:

```
Still needs you (1):
  HYG6 SKILL.md:3: description must not be empty.
```

`validate` needs a configured team, because the licence check reads the team's policy.

## The publish flow in order

1. **Fetch.** The team clone is fetched and hard reset to `origin/main` under the clone's writer
   lock. If another terum-skills command holds that lock, publish waits (about 75 seconds at a
   terminal, about 4 seconds when nothing can be asked) and prints `Waiting for another terum-skills
   operation on <team> to finish… (3 s)` while it does.

2. **Read the folder.** Every file is read, eval assets included. A folder that is a symlink,
   contains a symlink, sits inside `~/.terum/skills`, or has no `SKILL.md` is refused here.

3. **Resolve the category.** In this order:

   | Source | Condition | Printed line |
   | --- | --- | --- |
   | `metadata.terum-category` in your `SKILL.md` | The file declares one | none |
   | `--category <name>` | You passed the flag | `metadata.terum-category: ops (from --category; edit SKILL.md any time)` |
   | A model suggestion | Neither of the above, and the team has categories | `metadata.terum-category: docs (suggested from your SKILL.md; edit any time)` |
   | `misc` | The team has no categories, or the model could not be reached, answered nothing usable, or named a category the team does not have | `metadata.terum-category: misc (couldn't reach the model; edit SKILL.md any time)` |

   The suggestion is one call to `claude --model haiku` with a 20 second timeout, carrying the first
   2,000 characters of your `SKILL.md` and the team's category list. The model cannot introduce a
   category: its answer is matched case-insensitively against the team's list and takes the team's
   own spelling, and anything off the list becomes `misc`. Publish never blocks on the model. The
   fallback is always disclosed, because a classifier that has silently stopped working looks exactly
   like one that ran and chose `misc`.

   `--category` takes the team's spelling too when it matches case-insensitively, so `--category Ops`
   lands in the one `ops` bucket. An off-list value is written as you typed it and warned about.

4. **Inject the managed fields.** Four fields are written into an in-memory copy of your `SKILL.md`
   before anything else looks at it:

   | Field | Value |
   | --- | --- |
   | `license` | The team's `policy.skill_license`. Always overwritten. |
   | `metadata.id` | The uuid the team repository already carries for this skill name. A name with no lineage, or a folder whose declared id belongs to a different name, gets a fresh uuid. |
   | `metadata.author` | `Name <email>` from your identity. Change it with `login --set`. |
   | `metadata.terum-category` | The category resolved above, and only when the file declares none. A declared category is never overwritten. |

   The id comes from the repository, not from your file. A published folder whose `license:` line you
   deleted still keeps its uuid, and a folder you copied from another skill does not graft onto that
   skill's identity.

5. **Hygiene.** The checks run on the injected `SKILL.md` and every other file in the folder, never
   on the pre-injection bytes. Errors refuse the publish and are printed as
   `HYG1 SKILL.md: <message>`; warnings are printed and gate nothing.

   | Code | What it refuses or warns about at publish |
   | --- | --- |
   | HYG1 | Frontmatter that is not valid against the strict schema, a `name:` that is not the folder name, malformed `allowed-tools`. Refuses. |
   | HYG2 | A bidi control or zero-width character, or a whitespace-delimited token mixing Unicode scripts. Refuses. |
   | HYG3 | A credential-shaped value, or an email address that is not the skill author's and not on a reserved domain. Refuses. |
   | HYG4 | A file extension that is not on the allowlist. Refuses. Publish waives the executable-mode and shebang findings; `validate` does not. |
   | HYG5 | A `license:`, a team policy and a bundled `LICENSE` file that disagree. Refuses. |
   | HYG6 | An empty `description`. Refuses. A `SKILL.md` over 20,000 characters is a warning. |
   | HYG7 | A category that is not on the team's list. Warns. Only publish passes the list, so this check fires nowhere else. |
   | HYG8 | Repository paths the skill references outside its own folder. Warns. |

   Full detail is in [Hygiene checks](../evaluating/hygiene.md).

6. **The regression gate.** Publish takes the content digest of the injected folder and looks for
   local eval receipts of exactly those bytes. When the newest one is a `FAIL`, it asks:

   ```
   Your latest eval of these exact bytes failed against the previous version. Publish anyway?
   ```

   A local receipt never records a version (only the copy attached to the team does), so the question always reads this way. Answering
   no cancels with `Publish was cancelled.` and changes nothing, locally or in the team. Having no
   receipt at all never blocks a publish, and this step reads only your machine.

   If a local receipt cannot be read, publish says so rather than failing open in silence:
   `2 local eval run(s) of these exact bytes could not be read (…), so they were not considered.`

7. **`--project`.** A project name the team does not have is refused here with `Unknown project
   <name>.`, before anything is written. There is no project question and no default project.
   Publishing targets the marketplace; a project is a second list you ask for by name.

8. **Write the injected `SKILL.md` back into your folder.** This is the only write publish makes
   outside the team clone, and it happens after the last refusal, so a publish you cancelled at any
   question leaves your folder byte-identical. After it, the category and the managed fields are
   ordinary content that later publishes keep.

9. **Write to the team.** One commit, straight to `main`:

   | Write | Rule |
   | --- | --- |
   | `skills/<name>/v<N>/**` | A fresh version folder, unless an existing version already holds these exact bytes. `N` is the highest existing ordinal plus one, never the count plus one, so a first publish mints `v1`. File modes travel with the bytes. |
   | `skills/<name>/evals/**` | Written on every publish, including one that mints nothing. Add or modify only. A folder missing a case cannot delete the team's. |
   | `evals/<id>/<version>/<runId>.json` | A copy of every local receipt taken of these exact bytes, stamped with the skill's uuid and this version. Your local run is not rewritten. |
   | `team.json` | Only with `--project`, and only to append the uuid to that project's skill list. |

   Before appending to an existing lineage, publish proves the name is this skill's: if the newest
   version's `metadata.id` is not the id it resolved, it refuses with `<name> is no longer in the
   repository as 4f3a19c2; run sync and retry.`

10. **Your profile entry.** Publish adds the skill to your `profile[]` with no question, and prints
    `Your profile now lists deploy-check at Version 4.` Typing `publish` is the endorsement, so
    asking again would be asking for consent you already gave. This is a second, separate write, so
    a failure here is reported without failing the publish:
    `Published deploy-check, but could not add it to your profile: <reason>`

    Take it off again with:

    ```sh
    npx -y terum-skills@latest profile --remove deploy-check
    ```

    `profile --remove` matches the skill name or the uuid on the entry itself, so it works for a
    skill whose folder is long gone from this machine. Removing a profile entry changes nothing in
    your Library and never unpublishes anything.

## The four outcome lines

| What happened | Printed |
| --- | --- |
| A version was minted | `Published deploy-check as Version 4 to the acme marketplace. Attached 2 eval run(s).` |
| The bytes were identical and `--project` added the skill to a list | `Added deploy-check to docs-site. It is identical to Version 2 of the skill already in the team repository.` |
| The bytes were identical and nothing else moved | `Nothing to publish: deploy-check is identical to Version 2 and already in the acme marketplace.` |
| The bytes were identical but eval assets or receipts moved | `deploy-check is identical to Version 2, so no new version was minted; attached 1 eval run(s).` |

With `--project`, the first line reads `to the acme marketplace and docs-site`.

A publish that minted a version and also wrote eval assets adds a second line, `Updated 3 eval asset
file(s) for deploy-check.` When no version was minted, the same facts ride in the clause of the line
above, either as the fourth row's `; attached 1 eval run(s) and updated 3 eval asset file(s).` or,
after the second row, as `Also attached 1 eval run(s).`

A publish that minted a version while holding older receipts of other bytes adds:

```
2 local eval run(s) were not attached — they evaluated this folder before its first publish.
```

That is expected for a folder that declared no category before its first publish: the category is
part of the content digest, so those earlier runs describe different bytes.

## What publish never does

- **It opens no pull request.** Every write is a direct commit to `main`. The CLI's own help text for
  `publish` still reads `opens a pull request under policy "pr", commits directly under policy
  "push"`. There is no such policy field on a team any more, and the push is always to `main`.
- **It checks no ownership.** Anyone in the team can publish any name, which is why it proves the
  lineage id instead. The push guard refuses a hand `git push` of skill bytes, so a version can only
  be minted by this verb.
- **It does not install.** Publishing writes your `profile[]` entry and nothing in `installed[]`.
  Nobody's machine gains a copy because you published.
- **It sends nothing to Terum.** The category suggestion goes to Anthropic through `claude`; the
  bytes go to your git host.

## Republishing

**After an edit.** Change any file and the content digest changes, so the next publish mints the
next version. The team's older versions stay exactly as they were: a version folder is immutable, so
nothing you do later can change what `Version 3` is.

**After an eval-only change.** Running an eval or editing a case changes `evals/**`, which is
excluded from the content digest. The next publish mints no version, writes the eval assets, attaches
any matching receipts, and reports itself as one of the identical-bytes lines above. That is a
success, not an error: it is how an eval reaches the team without moving a skill byte.

After it writes generated assets, `eval` prints `That changes the skill's content: the next publish
mints a new version and the current local eval score blanks.` That is not what happens. `evals/` is
left out of the content digest, so generated eval assets do not change a skill's version.

## Changing a category

`publish --category` fills a category in; it never replaces a declared one. The editor is a separate
verb:

```sh
npx -y terum-skills@latest skill category ~/.claude/skills/deploy-check --to ops
```

It rewrites `metadata.terum-category` in that one folder and stops. No publish, no network, no write
to the team. The value is free text: your team's list is advice, so an off-list name is written and
given HYG7's sentence beside it. A value the team already spells differently takes the team's
spelling.

It then tells you what the team still shows, because a published category lives inside an immutable
version folder:

```
Changed deploy-check from misc to ops.
The team still shows misc: a published category lives inside Version 3's files, which never change.
Publish to mint Version 4 with the new category:
  npx -y terum-skills@latest publish deploy-check
```

When the team's newest version already declares the same category, the last three lines are replaced
by `The team already shows ops: Version 3 declares it too, so there is nothing to publish.`

## Unpublishing

```sh
npx -y terum-skills@latest unpublish <skill>
```

The argument is the skill's name in the marketplace, never a local path. Anyone in the team may run
it on any skill: there is no ownership check and no approval, because the team is small and a wrong
publish has to be retractable by whoever notices it. The typed-name confirmation is the whole brake.

```
This removes ALL 4 versions of deploy-check from the acme marketplace, for everyone.
Installed copies keep working until each machine syncs, and the git history is not rewritten.
Type the skill name to confirm:
```

Typing anything else cancels with `deploy-check was not unpublished.` `--yes` skips the question,
and a non-interactive run without it refuses: `Refusing to unpublish deploy-check without
confirmation; pass --yes.`

**What is removed**, in one commit:

| Path | What goes |
| --- | --- |
| `skills/<name>/v1..vN/**` | Every version folder the skill has |
| `skills/<name>/evals/**` | Every eval asset beside them |
| `evals/<id>/**` | Every receipt publish attached, keyed by uuid |
| `team.json` | The uuid, dropped from every project list that named it |
| `people/*.json` | The uuid, dropped from every member's `profile[]`, not only yours |

**What stays.** Installed copies on other machines keep working until each machine runs `sync`, which
then reports the skill as removed from the team. The git history is not rewritten, so the bytes stay
reachable in the repository's commits. `installed[]` records are left alone: they are claims about a
machine, not about the repository.

The report names what it did:

```
Unpublished deploy-check from the acme marketplace: removed 4 versions.
Also removed 3 eval asset file(s) and 5 eval receipt(s).
Removed it from docs-site.
Removed it from 2 member profile(s).
Machines that installed deploy-check keep their copy until they sync, which reports it as removed from the team.
```

**Republishing starts the versions again.** Unpublishing does not reserve the name. A later publish of
the same folder mints `v1`, and the receipts it attaches are only the ones taken of those exact bytes,
so nothing keyed to the old ordinals comes back.

The `unpublish` help text adds `Republishing starts again at Version 1 under a new id.` The uuid half
of that is not what happens. Publish reads the id from the repository, and with the lineage gone it
keeps the `metadata.id` your `SKILL.md` already carries. A fresh uuid is minted only when some other
published skill holds that id.

## Troubleshooting

| Line | Cause |
| --- | --- |
| `No local skill folder named deploy-check in your library. Inspect it with …` | No Library root holds an entry by that name. Add the project holding it with `project add`. |
| `No skill folder at ./skills/deploy-check in your library. …` | A path ref that resolved outside every Library root. |
| `~/.claude/skills/deploy-check is not a usable skill folder: <detail>` | The folder is there but the scan rejected it. The detail is the scan's own reason. |
| `~/.claude/skills/deploy-check has no SKILL.md.` | The folder holds no `SKILL.md` at its top level. |
| `HYG1 SKILL.md: SKILL.md field metadata.id is invalid …` | A hygiene error. Run `validate`, then `skill fix` for the mechanical ones. |
| `deploy-check is no longer in the repository as 4f3a19c2; run sync and retry.` | The team's newest version of that name carries a different uuid. Someone republished the name, or two people have a folder with the same name. Run `sync` and look at `ls` before retrying. |
| `Another terum-skills operation holds the write lock on acme; retry when it finishes.` | Another command is writing the clone. Wait and retry. |
| `The write lock on acme is stamped 41 s in this machine's future …` | A clock problem, not a running command. The line names the directory to remove. |
| `Unknown project docs-site.` | `--project` named a project the team does not have. Create it with `team project create`. |
| `Team acme has no joined handle.` | The machine has a team entry but no completed join. Re-run setup for that repository. |

Related: [Installing and managing skills](install-and-manage.md) ·
[Versions and identity](../concepts/versions-and-identity.md) ·
[How the team repo is laid out](../reference/team-repo.md) ·
[CLI reference](../reference/cli.md)
