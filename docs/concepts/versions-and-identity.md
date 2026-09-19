# Versions and identity

## A version is a folder, and it never changes

A published version is the folder `skills/<name>/v<N>/` in the team repository. Publishing appends a new one. Nothing edits a committed one, and the write guard enforces that rather than trusting it: a path inside a version folder that already holds files is refused, whichever verb asked.

Version folder names are `v1`, `v2`, `v10`. Not `v0`, not `v03`, not `V3`, not `v1.0`. One ordinal has exactly one spelling, so two folder names can never mean the same version. In prose the tool writes `Version 3`; on a card, where the slot is narrow, it writes `v3`. In a path it is always `v3`.

New versions are minted as the highest existing ordinal plus one, never as the count plus one. A skill with `v1` and `v4` publishes next as `v5`, so the number of versions a skill has and its newest ordinal are two different facts.

## Identical bytes reuse the version

Publish digests the folder it is about to publish and compares it against every existing version of that name. If one matches, nothing is minted and nothing is written under `skills/<name>/v<N>/`:

```
Nothing to publish: deploy-check is identical to Version 3 and already in the acme marketplace.
```

This is why a publish is safe to run twice, and why an eval-only change does not inflate the version number. Eval assets are written on every publish, minted version or not, so a run that mints nothing can still be the thing that carries an edited case and a fresh receipt to the team:

```
deploy-check is identical to Version 3, so no new version was minted; attached 1 eval run(s) and updated 2 eval asset file(s).
```

## Which bytes count

One digest function serves the publish comparison, the eval receipt, and the Library's join to the Marketplace, so those three can never disagree about what a skill's bytes are.

It covers every file in the skill folder, with these exceptions:

| Excluded | Rule |
| --- | --- |
| `evals/` | The whole directory, at the top level of the skill folder. Eval cases and triggers travel with the skill but do not identify it, so adding a case does not mint a version. |
| `.git`, `.skillhub` | Matched on the first path segment only. A `.git` directory nested deeper inside the skill's own content is content. |
| `.DS_Store`, `Thumbs.db` | Matched as a basename, anywhere in the folder. |

`SKILL.md` is canonicalised before it is hashed, and exactly three frontmatter fields are dropped: `license`, `metadata.id` and `metadata.author`. Those are the fields publish manages, so a skill's identity does not change the first time it is published, and two people's copies of the same skill are the same bytes even though their `metadata.author` differ.

Everything else in the frontmatter counts, including `metadata.terum-category`. Change the category and the next publish mints a version.

File modes do not count. The executable bit is carried into the repository with the bytes, so a published `scripts/*.sh` still runs, but changing a mode alone does not make a new version.

## Lineage

A skill's identity is a uuid in `metadata.id`. References survive renames: the folder name can change, the uuid cannot, and receipts, install records and profile entries are all keyed to it.

When you publish, the uuid is resolved from the repository, not from your file. The rules, in order:

1. If the team already publishes a skill by that name, its uuid is the one you append to. The repository is the authority on which uuid a published name carries.
2. Otherwise, if your `SKILL.md` declares a `metadata.id` that no other published skill is using, that one is kept.
3. Otherwise a fresh uuid is minted. This is the case for a first publish, and also for a folder copied from another skill: the copy would otherwise graft its receipts onto the original's history.

Inside the write, publish checks once more that the newest version of that name still carries the uuid it resolved. If it does not, the name changed hands between the read and the write, and it refuses rather than appending to someone else's lineage:

```
deploy-check is no longer in the repository as 8f2c1a04; run sync and retry.
```

## What publish injects, and writes back

Publish resolves four managed frontmatter fields into the `SKILL.md` before it hygiene-checks or digests anything:

| Field | Value |
| --- | --- |
| `license` | The team's `policy.skill_license` from `team.json`. |
| `metadata.id` | The uuid resolved above. |
| `metadata.author` | Your display name and email as `Name <email>`. Never a handle, so per-team handles do not fragment authorship. |
| `metadata.terum-category` | Only when the file declares none. A declared category is never overwritten. |

The edited file is then written back to your own folder, after the last question publish can refuse on and before the push. A publish you cancel at any prompt leaves your folder byte-identical. A publish that fails after that point leaves the injected `SKILL.md` on disk with nothing published, which is the safe side: every injected field is derived identically on the next attempt.

## Unpublish

```sh
npx -y terum-skills@latest unpublish <skill>
```

Anyone on the team may run it, and the brake is a typed confirmation of the skill's name. It removes, in one commit:

- every version folder of that skill
- the mutable `skills/<name>/evals/` assets beside them
- every receipt under `evals/<uuid>/`
- the uuid, from every team project's skill list
- the uuid, from every member's `profile[]`

What it does not do:

- **It does not rewrite history.** The bytes stay reachable in the team repository's git history. This removes them from the working tree, which is what the catalogue, `ls`, the README and `install` actually read.
- **It does not touch anyone's machine.** Installed copies stay where they are and keep working. Each machine learns when it next syncs, which reports the skill as removed from the team. `installed[]` is deliberately left alone: it records that a copy is on a machine, and that stays true.

Republishing the same folder starts again at `v1`. It is a new lineage in the sense that matters: the ordinals restart, and the receipts and profile entries the retraction removed do not come back.

The identity does not restart with them, and `unpublish --help` says otherwise:

```
Republishing starts again at Version 1 under a new id.
```

The ordinals do. The id does not: publish reuses your folder's declared `metadata.id` whenever no published skill is using it, and the retraction has freed the only one that was. A fresh uuid is minted only when some other published skill has claimed yours.

## Install always installs the latest

There is no way to pin. A ref carrying `@<version>` is refused:

```
Installing a previous version is not supported yet; install installs the latest version.
```

Install copies `skills/<name>/v<max>/` as it stands in your clone, so the version you get is the newest one your last `sync` brought down.

## The incumbent, for evals

An eval runs the folder on your machine as the candidate. It has no ordinal: it is bytes, identified by its digest, and it may never have been published at all.

The incumbent is the other arm, and it is chosen by receipt recency: among the committed versions of that skill, the one whose newest receipt has the most recent run id. Ordinal order is deliberately not the tie-breaker, because a `v2` re-evaluated today is a more current comparison than a `v4` evaluated last month.

Any version whose bytes equal the candidate's is excluded first. Comparing a folder against a published copy of itself measures nothing.

When there is no clone, no team, no receipted version, or nothing left after that exclusion, there is no incumbent and the run is single-arm. A brand new version that nobody has evaluated is never the incumbent.

## Receipts follow the bytes

A receipt records the `content_digest` of the exact folder it evaluated, computed with the same function publish uses. That is what makes attaching a run provable rather than trusted, and it is why the local store is keyed by digest rather than by name:

```
~/.terum/skills/evals/local/<64 hex>/<runId>/receipt.json
```

Three things move receipts around, all of them on that key:

- **`install` seeds them.** After copying a version it copies that version's committed receipts into your local store, filed under the digest each one names. Pre-digest receipts and unreadable ones are skipped with a notice. So a skill you have installed already shows its team score locally, offline.
- **`eval` publishes its own,** when the bytes it evaluated are already a published version of that skill. It writes exactly one path, `evals/<uuid>/v<N>/<runId>.json`, and it never mints a version or moves skill bytes. Pass `--no-commit` to keep the run on this machine. When the bytes are not a published version there is nothing to attach it to, and the run says so.
- **`publish` attaches them.** Every local receipt taken of exactly the bytes being published is copied into the repository, stamped with the skill's uuid and the version it landed at. Local runs of earlier bytes are left behind, and a publish that minted a version says how many:

  ```
  2 local eval run(s) were not attached — they evaluated this folder before its first publish.
  ```

Because the key is the digest and not the name, a receipt follows the bytes through a rename, through a move to another project, and through a copy onto another machine.
