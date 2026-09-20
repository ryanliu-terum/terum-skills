# The team repository

A team is one git repository. This page is the exact contents of that repository under layout 3: every path, every field, every rule that decides whether a write is allowed.

You do not have to edit any of it by hand. Every file here is written by a verb, and the write guard refuses most hand edits pushed from a clone. Read this when you want to know what a verb did, review a diff, or audit what your team is storing.

## Where your clone lives

The CLI keeps one full clone per team at `~/.terum/skills/teams/<team>` (`%USERPROFILE%\.terum\skills\teams\<team>` on Windows). It is created with `git clone -q --branch main`, so a bare remote whose `HEAD` points elsewhere still yields a working tree, and it is never shallow.

The clone is disposable state. Every write fetches and hard-resets it to `origin/main` first, so a local `main` that drifted heals rather than wedging later commands. Nothing reads your uncommitted edits to it.

Do not edit the clone. Author skills in your Library and publish them. A clone that holds uncommitted or unpushed work when you run `team leave` or `uninstall` is moved to `~/.terum/skills/quarantine/<stamp>/teams-<team>` instead of being deleted, so work is never lost, but it is also never published from there.

Everything else your machine keeps is in [machine-local state](local-state.md).

## The tree

### At creation

`team create` scaffolds and pushes this, in one commit whose message is `<handle>: create team <name>`:

```
team.json
README.md
people/
  <handle>.json          the creator's file, and only that one
skills/
  .gitkeep
evals/
  .gitkeep
.github/
  workflows/
    terum-skills.yml
```

This is the one write that does not go through the normal write path. An empty remote has no `origin/main` to fetch and reset against, so the scaffold is committed in a staging repository, pushed with `-u`, and that staging repository becomes your clone.

### As it grows

| Path | Rule |
| --- | --- |
| `skills/<name>/v<N>/**` | A published version. Immutable: files are added once, never modified, never removed. |
| `skills/<name>/evals/**` | The skill's eval assets. Mutable: add and modify only, never remove. |
| `evals/<skill-uuid>/v<N>/<runId>.json` | One eval receipt, written once. |
| `evals/<skill-uuid>/archive/<40-hex>/<runId>.json` | A receipt carried over by `team migrate` that describes bytes no current version holds. |
| `people/<handle>.json` | One file per member, active or archived. |

The segments:

- `<name>` is the skill's folder name: 1 to 64 lowercase alphanumerics joined by single hyphens. A Library folder whose name breaks that rule is rejected at discovery with `illegal-name` and can never be published.
- `<N>` matches `v[1-9][0-9]*`. There is no `v0`, no `v03`, no `V3`. One ordinal has exactly one spelling, so two folder names can never mean the same version.
- `<skill-uuid>` is the version's `metadata.id`. It is matched case-insensitively.
- `<runId>` is a UTC stamp, `YYYYMMDDTHHMMSSZ`. Sorting run ids as text sorts them by time.

Version numbers are `max + 1`, never `count + 1`, and the maximum is computed numerically rather than by sorting the folder names as text. A gap left by an unpublish never causes a collision, and a skill past its tenth version does not regress to `v9`.

Every JSON file in the repository is written as `JSON.stringify(value, null, 2)` plus a trailing newline.

## team.json

| Field | Type | Meaning |
| --- | --- | --- |
| `layout_version` | must be `3` | See [layout_version](#layout_version) below. |
| `name` | string, at least 1 character | The team's display name, typed at `team create`. The key your machine stores the team under is chosen separately: the creator's is this name, a joiner's is the repository name taken from the remote unless `team join --as <name>` says otherwise. |
| `categories` | array of strings | The team's category vocabulary. Publish matches a category against this list case-insensitively. |
| `projects` | object keyed by project name | Each value is `{ "remotes": [], "skills": [] }`. `remotes` holds git remote URLs, stored normalised, and `team project create` writes at most one because the guard admits no more. It preselects a destination and nothing else: when you install a skill this project lists, a registered library project whose `origin` matches one of them becomes the default answer to `Install to`. `skills` are the skill uuids the project lists. |
| `archived` | array of handles | Handles whose membership `team remove` archived. |
| `policy` | object | Holds one key, `skill_license`: the license string publish injects into every `SKILL.md`. |

Unknown keys survive a round trip, at the top level and inside each project record, so a repository written by a newer CLI is not damaged by an older one.

The scaffolded value:

```json
{
  "layout_version": 3,
  "name": "<team>",
  "categories": ["debugging", "testing", "docs", "workflow", "research", "infra", "misc"],
  "projects": {},
  "archived": [],
  "policy": { "skill_license": "UNLICENSED" }
}
```

A team is born with no projects. A skill reaches the team by being published, which writes `skills/<name>/v<N>/`; a project is an optional membership list a team creates when it wants one. Repositories created under an older layout may carry a `Global` project; `team project delete` retires it.

A project name is 1 to 64 characters of letters, digits, spaces, dots, underscores and hyphens, and cannot start with a dot or a space. It is stored exactly as typed, but `team project create` compares names case-insensitively, so `Payments` and `payments` cannot become two cards nobody can tell apart.

Active membership is two conditions, both required: `people/<handle>.json` exists and parses as that handle, and the handle is not in `archived`. A departure archives the handle and leaves the file, so the authorship and install history stay readable.

## people/&lt;handle&gt;.json

| Field | Type | Meaning |
| --- | --- | --- |
| `handle` | 1 to 39 characters, lowercase letters and digits with single internal hyphens | Your identity in this team. It must equal the filename stem or readers reject the file. |
| `display_name` | string, at least 1 character | Shown on the roster and in the generated README. |
| `email` | email address | Half of the evidence that lets you reclaim an archived handle. |
| `github` | a GitHub login, or `""` | Your GitHub login. Empty is allowed for a member on a non-GitHub remote. An empty value is never identity evidence, and this value becomes a REST path segment when an admin runs `team remove`. |
| `bio` | string | Free text, written by `profile --bio`. |
| `role` | string up to 32 characters, optional | A self-described job label written by `profile --role`. It is not an authorization role. No code reads it to decide what you may do. |
| `installed` | array | Automatic install records. See the shape below. |
| `profile` | array, optional | Your curated endorsements: the skills you stand behind. See the shape below. |
| `projects` | array of strings, optional | Which team projects you are on, written by `profile --project`. |
| `local_skills` | non-negative integer, optional | How many skill folders your machine held across your Global root and your registered projects, the last time install or profile counted them. |
| `declined` | array of uuids, optional | A dead field. It is retained so older files still parse and is never written. |

An `installed[]` entry is `{ "id": <skill uuid>, "version": "v3", "scope": <scope>, "since": "YYYY-MM-DD" }`. `scope` is either `{ "kind": "global" }` or `{ "kind": "project", "project": "<team project name>" }`. There is one entry per (id, scope) per person: install filters the matching entry out and pushes a fresh one, so re-running it is a no-op rather than a duplicate. `version` may also be a 40-character tree hash written by a pre-layout-3 CLI, or `null`; both are read-only history.

A `profile[]` entry is `{ "id": <skill uuid>, "name": "<skill name>", "version": "v2", "added": "YYYY-MM-DD", "via": "publish" | "install" }`. There is one entry per id: re-adding updates it in place. Publish and install both add one without asking.

`installed[]` and `profile[]` mean different things and are used differently. `installed[]` is automatic and says a copy is on a machine; `install member <handle>` reads the other one, `profile[]`, because that is the curated list.

`local_skills` is a self-report, not an audit. Nothing in the repository can verify it, a person who has not installed anything since it shipped has no value at all (absent, never zero), and a person who uses two machines against one team records whichever wrote last. It carries no timestamp on purpose: the commit that wrote the file already dates it. Note that it is a count of every skill folder on that machine, including ones that have nothing to do with the team.

The creator's file at scaffold time:

```json
{
  "handle": "ryan",
  "display_name": "Ryan Liu",
  "email": "ryan@example.com",
  "github": "ryanliu-terum",
  "bio": "",
  "installed": []
}
```

The same file after one publish and one install:

```json
{
  "handle": "ryan",
  "display_name": "Ryan Liu",
  "email": "ryan@example.com",
  "github": "ryanliu-terum",
  "bio": "",
  "installed": [
    { "id": "3f2c8a10-9b4d-4d1e-8a77-5c0f2f9a6b21", "version": "v2", "scope": { "kind": "global" }, "since": "2026-09-16" }
  ],
  "profile": [
    { "id": "3f2c8a10-9b4d-4d1e-8a77-5c0f2f9a6b21", "name": "deploy-check", "version": "v2", "added": "2026-09-16", "via": "publish" }
  ],
  "local_skills": 41
}
```

## Skills and versions

### SKILL.md frontmatter

`skills/<name>/v<N>/SKILL.md` is parsed strictly. Exactly these top-level keys are allowed, and an unknown one is an error:

| Key | Who writes it |
| --- | --- |
| `name` | You. It must equal the folder name, or every reader of the repository throws. |
| `description` | You. This is the description the Marketplace and the generated README show. |
| `license` | Publish, from `team.json`'s `policy.skill_license`. |
| `metadata.id` | Publish. This uuid is the skill's identity; receipts, project lists, install records and endorsements all key by it. |
| `metadata.author` | Publish, from the publishing machine's identity: the display name, a space, then the email in angle brackets, as in `Ryan Liu <ryan@example.com>`. |
| `metadata.terum-category` | Publish, but only when the file declares none. A declared category is never overwritten. |
| `allowed-tools` | You, optionally. The tools a teammate is asked to approve at install. |

The four managed fields are injected into the YAML document rather than regenerated from it, so comments, quoting and key order in your file survive. Publish writes the injected bytes back to your own folder too, which is why your local `SKILL.md` gains a `license` and a `metadata` block the first time you publish it.

`allowed-tools` accepts a list of strings or one comma-separated string. It is normalised (trimmed, de-duplicated, sorted) and hashed; an absent or empty value normalises to the literal `none`. Install shows you the normalised list, remembers your approval against that hash, and does not ask again while the hash is unchanged. Anything that is neither a string nor a list of strings is malformed, and install asks whether to proceed anyway.

Three of the managed fields are deliberately excluded from the bytes that decide a version's identity: `license`, `metadata.id` and `metadata.author`. `metadata.terum-category` is included, so changing a published skill's category does mint a new version.

### Eval assets

`skills/<name>/evals/**` sits beside the version folders, never inside one. That is what makes those bytes mutable while a version stays immutable: editing or adding a case has to be able to reach the team without minting a version, which a write into `skills/<name>/v<N>/` structurally cannot do.

Publish writes them on every run, including a run that mints nothing. That is how an eval-only change reaches the team. The write is add-or-modify, and only where the bytes differ. Removal is refused, so a teammate whose folder happens to be missing a case cannot delete the team's copy. A case is retired by editing it, or by a human removing it from the repository directly.

Eval assets are excluded from the content digest that decides which version your bytes are, so attaching or editing cases never changes a skill's version number.

A `v<N>/evals/**` path committed before this rule existed is ordinary immutable version content and stays where it is.

## Receipts

An eval receipt lands at `evals/<skill-uuid>/v<N>/<runId>.json`. It is added, never modified and never removed, and the uuid must name a skill that exists in the same commit.

Publish attaches receipts. For each local receipt taken of exactly the bytes being published, it writes a copy stamped with the skill's uuid and the target version. The copy is stamped rather than copied verbatim, which is what makes a misfiled receipt detectable: a reader that finds a receipt whose `skill_id` or `version` does not match its path ignores it.

`team migrate` carries receipts across from layout 2. A receipt whose recorded tree matches the bytes that became `v1` is re-keyed to `evals/<uuid>/v1/<runId>.json`. One that describes other bytes goes to `evals/<uuid>/archive/<40-hex>/<runId>.json`, keyed by the old tree hash. Nothing reads the archive for a verdict; it exists so no historical receipt is destroyed.

## layout_version

`team.json` must say `layout_version: 3`. Every reader parses it through the same strict schema, so an older repository fails loudly and with a remedy rather than being half-read. The message is:

```
this team repository uses an older layout; an admin should run `team migrate` to upgrade it
```

You see it from any verb that reads the team, from the write guard, and from the workflow's README job.

Exactly two callers may read a layout-2 `team.json`: `team migrate` itself, and the precondition check that decides whether a migration is needed. They use a lenient schema that also admits the layout-2 `global` list and the retired `policy.publish` key. Everything else reads the strict one.

The opposite direction is enforced too: a CLI old enough to predate layout 3 rejects `layout_version: 3`, so it cannot write into a migrated repository. See [the layout 3 migration](../migration-layout-3.md) for what the upgrade does.

## README.md

### The generated block

The CLI owns exactly the region between two markers and leaves everything outside them byte for byte:

```
<!-- terum-skills:begin -->
<!-- terum-skills:end -->
```

At creation the file is a heading plus an empty region. If the markers are absent entirely the block is appended. If they are malformed, meaning anything other than exactly one BEGIN before one END, the write fails rather than guessing.

The block is:

```
<!-- terum-skills:begin -->
## <team> skills

### Roster

- @handle — Display Name

### <author>

| Skill | Category | Description | Installs | Endorsed | Latest | Eval | Install |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| deploy-check | infra | Checks a deploy before it ships | 3 | project: Payments | Version 4 | PASS | `npx -y terum-skills@latest install acme/team-skills/deploy-check` |

<!-- terum-skills:end -->
```

The roster lists active members only, sorted by handle. With no members it reads `- No members yet.` There is one table per author, keyed on `metadata.author` and sorted by author name, with skills sorted by name inside it. With no skills at all, the block carries a `### Skills` heading and the line `No shared skills yet.`

The columns:

| Column | What it holds |
| --- | --- |
| Skill | The folder name. |
| Category | `metadata.terum-category` of the newest version. |
| Description | `description` of the newest version. |
| Installs | How many teammates hold the skill. One person who installed it globally and again into a project counts once. Archived members are counted, because their installs happened. |
| Endorsed | The project lists that name the skill, as `project: A, B`. A dash means the marketplace alone, never "unshared". |
| Latest | `Version 4`, in prose form. |
| Eval | The verdict of the newest usable receipt, walking versions newest first. Annotated `PASS (Version 3)` when that receipt is not for the latest version. |
| Install | The install command, on a GitHub remote. A dash on any other host, because the short `<org>/<repo>/<skill>` form is GitHub-only. |

A partial receipt is never promoted to a plain verdict. It renders as `FAIL — partial (4/7 scored; 2 dropped (setup); 1 skipped (environment))`. A receipt that fails its schema, or whose `skill_id` or `version` does not match its path, is ignored for that version only and the walk continues to the next one, so one corrupt file does not blank a skill that has three good older evals. A receipt with a null `skill_id` is a local run that was never attached and is never treated as the skill's testimony.

Every string that comes from the repository is sanitised before it reaches the block. Line breaks collapse to a space, `<!--` becomes `&lt;!--` so no skill description can forge a marker, pipes and backslashes are escaped inside table cells, and square brackets are escaped last so no cell can render as a Markdown link with a lying label. Skill names additionally get `<` and `>` escaped, and the install command is emitted only for a name the CLI would accept.

On a GitHub remote the workflow regenerates this block after every push to `main`. On any other remote the regeneration happens inside the commit itself. See [non-GitHub remotes](#non-github-remotes).

### When regeneration refuses

Regeneration is a derived artifact writing over the team's own catalogue, and the job that commits it is the only one with write permission. So it refuses rather than shrinking the block, in three cases:

1. Some `skills/<name>/` in the commit has no `v<N>/SKILL.md`. That is what a half-finished migration looks like, and the regenerated catalogue would silently omit it. The refusal reads: `README.md left unchanged: skills/<name> has no v<N>/SKILL.md, so the regenerated catalogue would omit it. Every skill in a layout-3 repository lives under a version folder; finish the migration and the next write regenerates the README.`
2. The regenerated block would say `No shared skills yet.` where the current one does not.
3. The regenerated block has fewer skill rows than the current one. Rows are counted structurally, as table body lines, rather than by matching names.

A refusal returns the existing README unchanged. It never throws, because a throw would fire identically when a team legitimately removes its last skill and would then wedge regeneration permanently. A stale catalogue is recoverable; a blanked and pushed one is not.

## The committed workflow

`team create` commits `.github/workflows/terum-skills.yml`. It has four jobs.

| Job | Fires on | Permissions | What it runs |
| --- | --- | --- | --- |
| `hygiene` | A pull request against `main` (opened, synchronize, reopened) | `contents: read` | Diffs `skills/` against the base, reduces the paths to skill names, and runs `npx -y terum-skills@latest validate "<name>" --cwd .` for each name whose folder still exists. It passes a name rather than a path, because under layout 3 `validate` resolves the newest version folder itself. |
| `receipt-check` | A pull request whose head branch starts with `publish/` | `contents: read` | `npx -y terum-skills@latest receipt-check --base origin/main`. |
| `readme` | A push to `main` | `contents: write` | `npx -y terum-skills@latest readme`, then commits and pushes `README.md` as `github-actions[bot]` with the message `chore: regenerate skills README` when it changed. |
| `publish-comment` | A pull request whose head branch starts with `publish/` | `contents: read`, `pull-requests: write` | `readme --pr-comment origin/main`, then creates or updates the PR comment it finds by the `<!-- terum-skills:pr-comment -->` anchor. |

Three things to know about it.

`readme` is the only job with `contents: write`. That is why the never-blank refusals above exist: this is the one place a derived artifact is committed over the team's catalogue without a human reading it first.

`receipt-check` and `publish-comment` cannot fire today. Both gate on a head branch named `publish/…`, and the CLI pushes only to `main`; nothing in the product creates such a branch. `receipt-check` also invokes a verb that is now a no-op shim, printing `receipt-check is retired; publish records receipts when it mints a version.`

The workflow is migration debt. It invokes the latest published CLI, so between a layout-3 release and a team's own migration the README job refuses layout 2 and exits non-zero. That red interval is expected and ends when an admin runs `team migrate`.

Nothing in the CLI can write `.github/workflows/**`. The write guard has no row for that path, so any attempt is refused, and the same is true of a raw push from your clone. Updating the workflow is a human action:

```sh
npx -y terum-skills@latest team workflow-update --print
```

Without `--print` the command fails with `` `npx -y terum-skills@latest team workflow-update` is print-only; pass --print. `` With `--print` it emits the workflow verbatim followed by `Commit this to .github/workflows/terum-skills.yml in an ordinary PR by someone with push access.`

## How a write happens

### safeWrite, step by step

Every write to the team repository except the creation scaffold goes through one function. It is a re-apply model, not a rebase: on a lost race it throws its commit away and redoes the work against the new tip.

1. **Check the origin.** `git remote get-url origin` must match the configured remote after normalisation. If it does not, the write stops with `Clone at <path> points at <other>, not <configured>; refusing to write to the wrong repository`.
2. **Take the per-clone writer lock.** The lock is a sibling of the clone directory, at `~/.terum/skills/teams/.<team>.safewrite.lock`. One writer per clone per machine.
3. **Start the 30-second push budget**, now, with the lock held. Waiting for the lock has its own separate bound, so a long wait can never eat the budget of the write that wait won.
4. **Fetch and hard-reset** the clone to `origin/main`.
5. **Read the index** to learn the tracked paths and which of them are executable.
6. **Run the verb's change**, as a pure function over that freshly reset tree. It may read the post-image and set, remove and re-mode paths in it. It performs no I/O and no git calls of its own, which is what makes replaying it on a lost race safe.
7. **Stop if nothing changed.** A change that touched no path returns without a commit.
8. **Run the write guard** on the resulting tree, before anything is derived from it. See [the guard table](#the-guard-table).
9. **Write and stage exactly the changed paths.** Every written file gets an explicit mode rather than whatever the umask leaves.
10. **Regenerate README.md**, on a non-GitHub remote only, from the in-memory post-image, and stage it too. A refusal leaves `README.md` out of the commit and prints the reason; the rest of the write proceeds.
11. **Prove the staged diff.** `git diff --cached --name-only --no-renames -z` must equal the change's own path list exactly, or the write fails.
12. **Commit.** The message defaults to `<handle>: <action>`. Verbs that have something better to say pass their own: `<handle>: publish <name>`, `<handle>: install <name>`, `<handle>: join`, `<handle>: remove <handle>`, `<handle>: create project <name>`, `<handle>: delete project <name>`, `<handle>: create team <name>`.
13. **Push.** `git push -q --no-verify origin HEAD:refs/heads/main`. Always `main`, never a branch. `--no-verify` is deliberate: the guard has already run on the exact tree being committed, and your clone's own pre-push hook would only repeat that check through an npx round trip.
14. **Retry or stop.** A push rejected with git's non-fast-forward vocabulary (`fetch first`, `non-fast-forward`, `cannot lock ref`, `failed to lock`, `stale info`, `incorrect old value`, `remote ref updated since checkout`) goes back to step 4 after a full-jitter backoff capped at one second. Any other rejection is terminal.
15. **Clean up, always.** Unless the push landed on `main` or the lock was lost, the clone is fetched, hard-reset to `origin/main`, and every untracked path the attempt created is removed along with the directories that are now empty. A lost lock resets nothing, because another writer owns the clone and a reset would rewind their commit.

Two path rules run throughout. A path must be repo-relative POSIX with no leading slash, no `.`, no `..`, no empty segment, no backslash, and no `.git` segment in any case or NTFS short form. And a write whose parent directory resolves outside the clone, or that would write through a symlink, is refused.

### Waiting for the lock

How long a second process waits depends on who is watching. With a terminal or an app on the other end, it waits 75 seconds, which outlasts a full 30-second write plus the 60-second window after which an abandoned lock goes stale. It prints a line after the first second and then at most one every five: `Waiting for another terum-skills operation on <team> to finish… (12 s)`. With nobody watching, a session hook or a piped script, it waits 4 seconds in silence and then fails, because a script wants to fail fast.

A lock whose timestamp is more than a minute in this machine's future is refused immediately rather than waited on, because it can never go stale: `The write lock on <team> is stamped 420 s in this machine's future (<path>), so waiting cannot clear it; remove that directory if no terum-skills command is running.`

### Failures

| Class | When | What it says |
| --- | --- | --- |
| Clone busy | Another process held the writer lock for the whole wait | `Another terum-skills operation holds the write lock on <team>; retry when it finishes.` |
| Push refused | The remote rejected the push for a reason a retry cannot fix, such as permissions or branch protection | `The remote refused the push: <git's message>`, followed by access advice when the CLI recognises the cause |
| Budget exhausted, no push | The budget ran out before any push was attempted | `safeWrite ran out of its 30000 ms budget before it could attempt a push; nothing was committed or pushed.` |
| Budget exhausted, races lost | The remote kept moving ahead | `safeWrite deadline exhausted after 4 attempt(s); the remote kept moving ahead: <git's message>` |
| Guard refused | The change touched a path the action may not write | `Write guard refused <path> for <action> by <handle>` |
| Staged diff mismatch | What was staged is not what the change said it touched | `Staged diff [...] does not match the mutation [...]` |

The two budget messages are deliberately different. A budget that ran out before a single push attempt saw no remote movement, so it must not claim any.

### The guard table

The guard authorises a change by (action, path). Rows are evaluated in this order; a path admitted by no row is refused.

| Row | Action | Path | Rule |
| --- | --- | --- | --- |
| j | `migrate` | Structural, by direction | Adds: `skills/*/v1/**`, `evals/<uuid>/v1/<runId>.json`, `evals/<uuid>/archive/<40-hex>/<runId>.json`. Removes: any `skills/*/` path that is not under a `v<N>/` folder, and `evals/<uuid>/<40-hex>/<runId>.json`. Modifies: `team.json`, `README.md`, and every member's `people/*.json`. Removing anything under `skills/<name>/v<N>/` stays refused even here. This row runs first, and it never parses `team.json`, because the pre-image is layout 2. |
| a′ | `publish` | `skills/<name>/v<N>/**` | Add only. The unit of immutability is the version prefix, not the path: files are admitted only when no sibling under `skills/<name>/v<N>/` already exists. Adding one file to a committed version is refused, because it would change that version's bytes. Fails closed if the tree cannot list its own paths. |
| a″ | `publish` | `skills/<name>/evals/**` | Add and modify. Removal refused. Ownership is not consulted: the last publisher's assets win. |
| g | `publish` | `evals/<uuid>/v<N>/<runId>.json` | Add only, and the uuid must equal the `metadata.id` of some version's `SKILL.md` in the same commit. Judged per path, not per commit, because one publish legitimately writes a version, a project list, a people file and several receipts at once. |
| k | `unpublish` | `skills/<targetSkill>/**`, `evals/<targetSkillId>/**`, `people/*.json` | The only row that may remove a version folder. Removal only, except people files, which are modify-only and only to drop this skill's `profile[]` entries. That is verified by rebuilding the expected file and comparing it, so no other edit can ride along. Fails closed unless the caller names both the skill and its uuid. |
| f | any | `README.md` | Always allowed. It is generated, not hand-edited. |
| b | `join`, `install`, `uninstall`, `profile`, `publish` | `people/<your own handle>.json` | Your own file only. |
| c | `publish` | `team.json` | Only `projects[*].skills` may move. Project keys, remotes and every other field must be byte-identical. |
| c′ | `unpublish` | `team.json` | The same predicate as row c. |
| d | `team-remove` | `team.json` | `archived` becomes exactly the old list plus the target handle. The target may not be the actor, and an already-archived handle cannot be appended again. |
| e | `join` | `team.json` | `archived` becomes exactly the old list minus your own handle. A set difference, not a length check. |
| i | `project` | `team.json` | Exactly one new project key, born `{ "remotes": [] or [one], "skills": [] }`, with that exact key set. Every pre-existing project and every other field byte-identical. |
| i′ | `project-delete` | `team.json` | Exactly one project key removed, everything else byte-identical. The skills that key listed are not touched. |

Two consequences worth stating plainly.

Any member may publish and any member may unpublish. There is no ownership check on either. Publish checks lineage instead: the newest version's `metadata.id` must equal the id it is appending to, or you get `<name> is no longer in the repository as <id8>; run sync and retry.` That is what stops two people whose Library both holds a folder called `deploy` from silently merging into one lineage.

`unpublish` removes bytes from the working tree; it does not rewrite history and it does not reach anyone's machine. Installed copies keep working, and the next `sync` reports them as removed from the team. Republishing the same name starts again at `v1`, and the receipts that were keyed to the old ordinals are gone with the rest of the skill.

The help text adds `Republishing starts again at Version 1 under a new id.` Read the id half as a possibility, not a promise: publish reuses the uuid your folder's `SKILL.md` declares whenever no published skill in the team carries it, and after an unpublish none does. A fresh uuid is minted only when the declared one already belongs to another published skill, or when your folder declares none.

## The clone-local push guard

`git push` from your clone runs the same rules, through a hook.

`team create` and `team join` both write `.git/hooks/pre-push` mode `0700` and set `core.hooksPath` to `.git/hooks`, so a machine-wide hooks path cannot hide it. Arming is idempotent and happens on every join, so an interrupted arming is repaired by the command the failure advice names. `team migrate` re-arms it too.

The hook checks that its launcher still exists before running it. If the CLI it was armed with is gone, it exits 0 with one line on stderr saying the push was not checked and telling you to re-run `team join` to re-arm it. It turns git's stdin ref lines into arguments, because the CLI reads stdin nowhere except when asking you a question.

What the guard refuses:

- **Deletions.** A deletion carries no new content and destroys content that cannot be shown to be yours. Delete the ref on the host instead.
- **Anything that is not a branch.** A tag or a note carries no team content to check ownership against.
- **A new branch with no resolvable base.** A new branch is judged from its fork point off the remote's `main`, never from `main`'s tip, which would charge you with reversing every commit that landed since you branched. If `main` cannot be resolved, the push is refused and you are told to fetch first.
- **Anything under `skills/`.** A version is minted, not written. Only `publish` digests a folder, compares it against every existing version and picks the next ordinal; a hand push that lands bytes in `skills/<name>/v<N>/` produces a version whose number means nothing.
- **Anything under `evals/`.** Receipts are written by publish when it attaches a run to a version.
- **A `team.json` change of any other shape.** Only three shapes pass: the skill-list change publish makes, an archive of somebody else, and removing your own handle from `archived`.
- **A top-level path it does not recognise.** This almost always means the hook predates the repository, so it says so: ``this clone's push guard predates the repository's layout; re-run `npx -y terum-skills@latest team join '<remote>'` to re-arm it``. It does not advise `--no-verify`, because that would teach you to disable the guard permanently.

What it allows: `README.md`, `people/<your own handle>.json`, and the three `team.json` shapes above.

A refusal is one line on stderr and a non-zero exit, which makes git abort the whole push. Every non-zero exit from the verb is re-voiced as the guard speaking, so an unreadable config or an unexpected error reads as the guard declining to permit what it could not evaluate rather than as an anonymous crash.

`git push --no-verify` bypasses the hook, and every refusal message says so. This guard exists for accidents, not for abuse: the bypass is attributed to whoever takes it, because the commit carries their name.

## Non-GitHub remotes

Any git remote works for storing and syncing a team. Create one with:

```sh
npx -y terum-skills@latest team create <name> --remote <url>
```

The remote must be empty, meaning `git ls-remote --heads` returns nothing. This path needs no `gh` at all and uses your ambient git credentials.

Accepted URL forms: `http://`, `https://`, `ssh://` and `git://` URLs; the scp form `[user@]host:path`; an absolute local path or `file:<absolute path>`; and the bare canonical form `host.tld/path`, which becomes an HTTPS URL. Transport helpers such as `ext::` or `<helper>::` are refused outright, as is anything that looks like a command-line option. Credentials embedded in a URL are stripped before the remote reaches git, your config or any message, and the stripping is announced once. Remotes are compared after normalisation, which drops the protocol, credentials, port, a trailing `.git` and trailing slashes, and lowercases the host.

What differs on a non-GitHub remote:

| Behaviour | On GitHub | Elsewhere |
| --- | --- | --- |
| README regeneration | The committed workflow's `readme` job, after every push to `main` | Inside every write's own commit, from the in-memory tree |
| `invite` | Adds a repository collaborator through the GitHub API | Refused: `Access is managed on the host for <remote>; this operation is GitHub-only in phase 1.` Setup prints host-managed access guidance instead of asking for logins |
| `team remove` | Archives the membership and revokes host access | Refused for the same reason. `team remove <handle> --archive-only` still works and archives the membership |
| The README's Install column | `npx -y terum-skills@latest install <org>/<repo>/<skill>` | A dash |
| Successor lookup when a repository has gone | Searched through the GitHub API | Not attempted. The reason given is `The team repository is not on github.com, so no replacement can be looked up.` |

Everything else is identical: publishing, installing, versioning, receipts, the guard, the push hook, and `sync`.
