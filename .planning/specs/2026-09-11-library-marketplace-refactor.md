# terum-skills — Library/Marketplace split and immutable skill versions (spec)

**Status:** DRAFT rev 4 (2026-09-11). §2 records eighteen rulings. §15 is empty — every open question was walked to a resolution.
Rev 2 applied 27 findings that survived an adversarial verification pass (6 lenses, 49 findings adjudicated). **Rev 3 applies the six decisions of `.planning/decisions/2026-09-11-library-marketplace-refactor-decision-walk.md`**, three of which change sections rev 2 had locked — read §2 D9–D14 before anything else. **Rev 4 triages the 53 medium/low findings the rev-2 pass never adjudicated** (`.planning/reviews/2026-09-11-refactor-spec-unadjudicated.md`): 30 applied here, 15 were already present in rev 3, 4 were stale under D9/D13, and 4 were forks walked to D15–D18.
**Base:** line numbers were taken at `origin/main` @ `faa402c`. The v0.14.0 serve work (`d09d278`) shifts every `src/commands/sync.ts` citation by **+5** and `desktop/src/backend/tauri/index.ts` by **up to +33**; `src/commands/serve.ts` and `src/lib/serve-verbs.ts` (§1.5) exist only at `d09d278`. Every other file cited here is byte-identical at both. The primary checkout is on `feat/frame-mode`, which is 357 commits behind and carries no `desktop/`; implementation belongs in a worktree off `origin/main`.
**Trigger:** Ryan, 2026-09-10 — `~/Downloads/Refactor Prompt/RefactorPrompt.html` plus the whiteboard photo (`images/image1.jpg`).
**Evidence:** a 29-agent survey of `origin/main` (15 subsystem maps, 10 requirement traces, 4 adversarial critics), plus direct inspection of the live clone at `~/.terum/skills/teams/terum-shared-skills` and the live config at `~/.terum/skills/config.json`.

---

## 0. Ground rules

1. Read `AGENTS.md` then `CLAUDE.md` at the repo root first; every invariant there applies. Every team-repo write goes through `safeWrite()`; the guard is the authorization model; shell out only to `git`/`gh` through `src/lib/runner.ts`; a verb is `run(args, io): Promise<Result<…>>` over the `Prompter` and returns `failure(message)` rather than throwing.
2. **One active path per behaviour.** This refactor deletes more than it adds. Where §12 names something for deletion, it is deleted in the same change that introduces its replacement — never left behind "until the new path settles".
3. The desktop app is a shell over CLI verbs (`desktop/src/backend/Backend.ts`). No behaviour is implemented in the app that the CLI cannot do headlessly, and no app screen writes the team repo directly.
4. **Reviews flag data loss, crashes and spec non-conformance for a well-meaning user.** There is no attacker model (root `CLAUDE.md`, Ryan 2026-09-06). Hostile-caller findings are out of scope for this spec.
5. **Every line number here is a pointer, not an anchor.** Grep for the named symbol; a miss of a few lines is the base drift in the header, not a wrong claim. Where a file path and a symbol name disagree, the symbol wins.
6. Gates: §14.

---

## 1. What exists today — and why this is smaller than it looks

### 1.1 Versioning already exists. It is just invisible and unnamed.

The single most important fact about this refactor: **the codebase already treats the git tree hash of `skills/<name>/` as a skill version.** It is not a metaphor — it is the literal vocabulary:

- `src/lib/version.ts:9-27` — `resolveVersion()` resolves `HEAD:skills/<name>` to a tree and refuses a commit, a tag or a blob. The vocabulary is explicit in the receipt schema's own error text: *"a version is the 40-char lowercase tree hash"* (`src/lib/evals/receipt.ts:54`).
- `src/lib/version.ts:34` — `materializeVersion()` already checks **any** tree out to `~/.terum/skills/cache/<team>/<tree>/<name>` through a disposable index. Installing an arbitrary historical version is already mechanically possible today.
- `src/lib/teamRepo.ts:347` — `skillVersions()` resolves every skill's current version in one `git ls-tree HEAD:skills`.
- `src/lib/evals/receipt.ts:54` — the eval receipt's field is literally named `version` and is regex-pinned to that tree hash. `receiptPath()` is `evals/<skillId>/<version>/<runId>.json`.

Verified on the live clone: `evals/2365dd19-…/cb797acd8e7e7637741f860bf3ebb21d6fc447ff/20260910T060851Z.json` — two receipts already sit under one content identity.

**So this refactor does not invent versioning. It makes the existing content-identity version ordinal, explicit, and materialized as a directory.** Every consumer that today reads a tree hash reads an ordinal instead; the content identity survives underneath as the thing that decides whether a new ordinal is minted at all.

### 1.2 The byte-for-byte comparison already exists too.

`src/lib/skills.ts:126` — `canonicalDigest(root)` walks the whole folder, sha256s every file keyed by a prefix-free escaped relative path, and normalizes exactly the three Terum-managed YAML fields in `SKILL.md`. It is already persisted on every machine as `config.shared[<id>].baseline`.

This matters for a second reason. `injectManagedFields()` (`src/lib/skills.ts:178`) **rewrites `SKILL.md` frontmatter on the way out** — inserting `license`, `metadata.id`, `metadata.author` and, when absent, `metadata.terum-category`. Local bytes therefore never equal remote bytes. A naive byte comparison would mint a new version on every single publish, forever. `canonicalDigest` is the right primitive precisely because it compares *post-normalization*.

### 1.3 What the remote repo actually looks like right now

Verified against `~/.terum/skills/teams/terum-shared-skills`:

```
team.json          { layout_version: 2, name, categories[], global: uuid[],
                     projects: { <name>: { remotes[], skills: uuid[] } },
                     archived[], policy: { publish: "pr", skill_license } }
README.md          generated; regenerated, never hand-edited
skills/<name>/SKILL.md            <- FLAT. one live copy. overwritten in place.
skills/<name>/scripts/…
skills/<name>/evals/triggers.yaml
skills/<name>/evals/cases/*.yaml  <- authored eval CASES ship inside the skill
people/<handle>.json              { handle, display_name, email, github, bio,
                                    role?, installed[], declined[], local_skills? }
                                  installed[] = { id, version: 40-hex|null, scope, since }
evals/<skill-uuid>/<40-hex tree hash>/<YYYYMMDDTHHMMSSZ>.json
.github/workflows/terum-skills.yml   <- committed CI, pins terum-skills@latest
```

Skills are keyed by **UUID** in every join (`team.json.projects[].skills`, `people[].installed[].id`, `evals/<uuid>/`, `config.placements[].id`). The directory name is the *name*; `metadata.id` is the *identity*. The refactor's prose speaks in names ("if the skill shares a name"); §3.1 rules on how the two relate.

### 1.4 The four things that contradict the refactor hardest

| Refactor requirement | Today | Where |
| --- | --- | --- |
| "Nothing local is published unless you explicitly do so" | `sync` runs an unattended **auto-share** pass that connects every eligible local skill with an unknown id, mints a UUID, and **rewrites the user's own `SKILL.md`** | `src/commands/connect.ts:514 autoShareRoots`, gated at `src/commands/sync.ts:304` by `config.auto_share !== false` — on by default |
| "Publish is the only way anything enters the shared repo" | `publish` writes **no skill bytes at all**. It only appends a UUID to `team.json`. Bytes enter via `connect` and via sync's auto-share. `SKILL_ACTIONS = ['connect','sync']` — publish is not even permitted to touch `skills/` | `src/commands/publish.ts:174 endorse`, `src/lib/guard.ts:37` |
| "All commits are direct commits, no PRs" | `team.json.policy.publish: "pr"`. Publish pushes `publish/<name>-<handle>-<id8>` and shells out to `gh pr create` | `src/commands/publish.ts:75, :134-142` |
| "Library is a pure reflection of local files" | `library()` joins local inventory against team/clone data; the marketplace additionally reads `ls --local` | `desktop/src/backend/tauri/index.ts:193 inventoryCard`, `:763` |

### 1.5 What is already in place and must be reused, not rebuilt

- `config.checkouts` already tracks explicitly-added project roots. Ryan's machine: `["…/skill-management-software", "…/conflict-detection"]`. **"Add a project" is this list**, renamed.
- `revealPath()` and `openInEditor()` already exist on the seam via the Tauri `opener` plugin (`desktop/src/backend/tauri/index.ts:836, :838`).
- `moveDirectory()` (`src/lib/placer.ts:184`) already handles the cross-volume case with copy-then-remove.
- `moveToQuarantine()` (`src/lib/placer.ts:170`) is the codebase's existing "moved, never deleted" primitive.
- `src/commands/serve.ts` (new in v0.14.0) answers desktop **reads** from one long-lived CLI process. `SERVE_READ_VERBS = ['status','ls','eval-report','search','validate','update']` (`src/lib/serve-verbs.ts`). **Any new read verb must be added there; no write verb may ever be.** That file must import nothing — it is a leaf shared with the browser bundle.

---

## 2. Decisions taken (Ryan, 2026-09-11)

**D1 — Path shape: lowercase, `v<N>`.** `skills/<name>/v<N>/`, `people/<handle>.json`, `evals/<uuid>/v<N>/<runId>.json`. Rendered as **"Version 3"** in every user-facing string. *Reason:* a case-only rename of `skills/` → `Skills/` cannot run through `safeWrite` on a case-insensitive volume — reproduced on this Mac: the add sorts before the remove, the new file lands *inside* the old lowercase directory, `git add` stages only the deletion, and safeWrite's staged-diff proof throws. Lowercase removes the hazard entirely and removes a two-step `git mv` from the migration. It also keeps the GitHub tree URL (`SkillScreen.tsx:28`, a raw template literal with no `encodeURIComponent`) free of an unencoded space.

**D2 — Byte identity: content and path only.** Compared: every file under the skill folder, **eval cases included** (D9). Ignored: `.DS_Store`, `Thumbs.db`, `.git/**`, `.skillhub/**`. Normalized: file mode and mtime — identity is **content + relative path** only. `SKILL.md` is compared post-`injectManagedFields`.

**D3 — Existing team repos migrate in place, once.** One migration, one target shape, one version number: `layout_version: 3`. An older CLI reading a layout-3 repo refuses by name with an upgrade sentence — from this release on; CLIs already shipped refuse with a zod error on `layout_version` (`schema.ts:54`, `z.literal(2)`), which is the fail-closed behaviour §13.1(b) relies on.

**D4 — A stale local copy is disclosed on the Marketplace card only.** The marketplace card reads `Version 4 · you have Version 2 → Reinstall`. The Library card shows only what is on disk. *Consequence:* the marketplace renders exactly one machine-local overlay field; see L-DECL in §3.6.

**D5 — `people/<handle>.json` carries both lists.** `installed[]` stays automatic (it is the sole source of install counts, Top-rated ordering and the member facepiles — `src/lib/readme.ts:40 installCounts`). `profile[]` is the new curated list, written only on an explicit yes.

**D6 — The Library can delete, rename and move.** For any skill in the Library, including folders Terum never placed. Creating a new skill stays in the user's editor.

**D7 — Eval receipts at tree hashes that never become a version are archived, never deleted.** `evals/<uuid>/archive/<40-hex>/<runId>.json`, preserved verbatim, read by nothing today.

**D8 — Race conditions between two simultaneous publishes are out of scope** (Ryan, verbatim). This is **not** permission to drop `safeWrite`. `safeWrite`'s fetch-reset-mutate-verify-push loop is what makes a publish atomic against an unrelated concurrent write; D8 only says that two people minting `v4` at the same instant need no coordination beyond it. Any implementer who reads D8 as "skip the lock" has misread it.

### Rev 3 — the decision walk (ledger: `.planning/decisions/2026-09-11-library-marketplace-refactor-decision-walk.md`)

**North Star, ratified:** *Nothing moves between your machine and the team unless you ask — and you can always see exactly what's on each.* This is the yardstick, and it is deliberately **not** the two-mirror mechanism: purity is a means to visibility, so where a mirror's purity would make the user less able to see what is true, purity loses (see D11).

**D9 — Eval cases are part of the skill.** They are generated into the user's **local** folder, digested as content identity, published inside `v<N>/`, and copied on install. *Grounding:* 88 local skill folders on the author's machine contain **zero** `evals/` directories, while the team repo's `decision-walk` carries four eval asset files — cases are generated straight into the repo today and have never been on disk, and this refactor deletes both routes that put them there. **Accepted cost:** regenerating cases mints a new skill version. This reverses rev 2's §3.1 derived decision.

**D10 — The executable bit is fixed, in M1.** Not warned about — fixed. Publish becomes the only way bytes travel, so bytes must arrive intact. See §4.5 for the five touch points, one of which is `safeWrite`'s staged-diff invariant.

**D11 — Install seeds the local eval store, naming the runner.** The receipt's digest provably describes the bytes just placed, so the score is shown; `provenance.runner_handle` is rendered so the user knows it was not their run. This is the L-DECL principle applied a second time.

**D12 — One replace rule on install; quarantine leaves the install path.** Something already at the destination → keep it at `<root>/.claude/old-skills/<name>`, install the new copy, say so. No `--force`, no `owned`/`foreign` distinction, no `quarantineDrift`. *Grounding:* `config.placements` is `{}` on a real machine, so all 88 skills are "foreign" — the distinction is about Terum's bookkeeping, not the user's files. The Library keeps only the **local** leg of the drift check.

**D13 — Onboarding asks for one project with a folder picker.** No new ask-frame kind. `src/lib/discover.ts` is deleted outright — this reverses rev 2's §7.1 decision to keep it as a read-only lister.

**D14 — PR #173 closed, PR #167 closed with its picker lifted.** Both done 2026-09-11; branches left intact. See §16.

### Rev 4 — the four forks the unadjudicated findings raised (ledger: same file, Decisions 7–10; resolved on Ryan's standing "best call" authorization, not by Ryan in person)

**D15 — A raw `git push` of skill bytes is refused, naming `publish`.** With row a gone, `guardRawPush` has no ownership rule left to apply to `skills/**`, and `ownsSkill` reads a path (`skills/<name>/SKILL.md`) that no longer exists under layout 3. Rather than re-derive author ownership for one caller, the hook refuses every `skills/**` path: *"Push guard refused `<path>`: skill versions are minted by `terum-skills publish`; a hand push cannot mint one."* `safeWrite` pushes `--no-verify` (`teamRepo.ts:285`), so the hook only ever sees hand pushes — exactly the accident it exists to catch. `ownsSkill`, `authorOf`, `GuardContext.author`/`previousAuthor` and `canonicalSkillDigest` are deleted with it (§4.2). *Why not admit the add-only `v<N>` shape instead:* a hand-minted folder skips the identical-digest refusal, the project list and the receipt attach, so the marketplace would show a version the product's own rules say cannot exist — visibility loses.

**D16 — Every direct child folder of a Library root is a card.** A 1:1 mirror hides nothing: `candidate` folders render normally; `rejected` and `failed` inspections render with the name, the path and the inspection reason as the body and are excluded only from eval and publish; the sidebar count counts direct child directories. D6 lets the user delete, rename and move folders Terum never placed, and cannot act on a folder it hides. (§7.4)

**D17 — `sync --hook` refreshes Terum's own `/terum-skills` manual, and says so.** The rewritten bundled skill (§11.1) otherwise reaches an existing machine only when the user re-runs `setup`, and until then every Claude Code session is told to run deleted verbs. The refresh is marker-gated (`wrapperState() === 'outdated'` on a `managed` copy; a `foreign` copy is never touched) and prints one line. This is the single carve-out from §10's *"nothing on this machine is changed"*: the manual is Terum's file, shipped in the package the hook already upgrades, never team content.

**D18 — `skill move` is the only Move, and it lives in the Library.** The detail page's install-then-uninstall re-place (`SkillScreen.tsx:85-87`, Ryan 2026-09-09) and the marketplace card's Move are deleted; that ruling's "placed twice rather than nowhere" guard is superseded, because a filesystem move cannot leave a skill placed twice or nowhere, and it never fetches the clone, so a local edit is never silently replaced by the team's copy. (§7.5, §11.4)

---

## 3. The data model (locked)

Everything below is locked here and nowhere else. No area section may re-decide a shape.

### 3.1 Remote repository, `layout_version: 3`

```
team.json
  { layout_version: 3,
    name, categories: string[],
    projects: { "Global": { remotes: [], skills: uuid[] }, <name>: {…} },
    archived: handle[],
    policy: { skill_license } }                    <- `publish` removed; `global[]` removed
README.md                                          generated
skills/<name>/v<N>/**                              immutable. never modified after commit.
                                                   (incl. evals/triggers.yaml and
                                                    evals/cases/*.yaml — D9)
people/<handle>.json
evals/<skill-uuid>/v<N>/<YYYYMMDDTHHMMSSZ>.json    receipts. append-only.
evals/<skill-uuid>/archive/<40-hex>/<runId>.json   D7. preserved, read by nothing.
.github/workflows/terum-skills.yml
```

- `<name>` keeps `isSkillName` (`src/lib/schema.ts:29`), `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, ≤64, and must equal the `name` frontmatter of the **latest** version.
- `Global` is a reserved project name, auto-created at team creation, present in every layout-3 repo.
- **Eval cases live INSIDE the version folder (D9).** `v<N>/evals/triggers.yaml` and `v<N>/evals/cases/*.yaml` are ordinary version bytes: digested, immutable, copied on install. There is no unversioned `skills/<name>/evals/` path and **guard row h (`EVAL_ASSET_PATH`) is deleted, not re-pointed** — publish writes cases the same way it writes `SKILL.md`. Consequence, accepted: regenerating cases changes the content digest and so mints a new version. That is the honest reading — the test suite changed, so the artifact changed — and it is bounded, because generating and publishing are both deliberate acts. *Rev 2 said the opposite; see D9 for why.*
- **Receipts are never co-located inside a version folder.** Attaching an eval to an already-frozen version must not change that version's bytes — doing so would destroy immutability *and* make the publish-time comparison meaningless.
- **There is no per-version manifest file.** A manifest would be bytes the local candidate folder does not have, so it would break byte-identity on every republish.

### 3.2 The version vocabulary — one module

New file `src/lib/versions.ts`. Nothing else parses or formats a version segment. **It imports nothing** — the desktop bundle imports it by relative path exactly as `desktop/src/backend/tauri/session.ts` imports `src/lib/serve-verbs.js` today (§1.5), so `VERSION_FOLDER` and `versionLabel` exist once on both sides of the process boundary; `cliLocalRow.placement.version` (§3.4) and `evalVersionLabel` (§8.2) import the leaf, and no desktop file re-declares the regex or the `Version N` string. The fs-using `listVersions` therefore lives in `src/lib/teamRepo.ts` beside `skillVersions`, not here.

```ts
export const VERSION_FOLDER = /^v[1-9][0-9]*$/;
export interface SkillVersion { folder: string; n: number }   // { folder: 'v3', n: 3 }

export function parseVersionFolder(name: string): number | null;
  // null unless VERSION_FOLDER matches AND Number.isSafeInteger(n) AND n >= 1.
  // 'v0', 'v03', 'V3', 'version 3', 'v1.0', 'v-1' all return null.
export function versionFolderName(n: number): string;          // `v${n}`
export function versionLabel(n: number): string;               // `Version ${n}`  <- the ONLY UI form
export function versionsInTree(tree: { paths(prefix?: string): string[] }, skillName: string): SkillVersion[];
  // the same parser and the same descending numeric sort, over tree.paths(`skills/${skillName}/`),
  // for callers inside a safeWrite mutation that may only see the post-image (§5.1 step 7).
  // Structural parameter type on purpose: this leaf imports nothing, not even a type.

// in src/lib/teamRepo.ts — the leaf above must stay free of node: imports
export async function listVersions(clone: string, skillName: string): Promise<SkillVersion[]>;
  // readdir(join(clone,'skills',skillName)); ENOENT -> []; directories whose name parses;
  // SORTED DESCENDING BY THE PARSED INTEGER, never lexicographically.
```

**Ordering is always numeric on `n`.** `['v10','v2'].sort()` puts `v10` first; a lexicographic sort silently pins every skill past its tenth publish to the wrong version — for the card, the eval, the README and install — and only starts failing after a team's tenth publish. `listVersions` and `versionsInTree` share the one parser and the one sorter, and the test must include a two-digit case for both.

Ordinals may have gaps (a version folder deleted by hand). **Next = (highest existing, or 0 when there is none) + 1, never count + 1** — a first publish mints `v1`.

`listVersions` uses `readdir`, not git: the clone is always a full non-bare checkout that `refreshClone()` hard-resets, so the working tree is authoritative and a readdir is cheaper than a process spawn.

### 3.3 Content identity — one function, extended from the one that exists

`canonicalDigest(root)` in `src/lib/skills.ts:126` **is** this function. It is not replaced, duplicated or re-implemented. Two changes:

1. Add the D2 ignore list to `walk()` (`src/lib/skills.ts:216`), which today has none: skip any path whose first segment is `.git` or `.skillhub`, and any basename `.DS_Store` or `Thumbs.db`. **`evals/` is NOT skipped** (D9) — cases are part of the skill's identity.
2. Export a second entry point `skillContentDigest(files: Map<string,Buffer>): string` computing the identical record stream from an in-memory file map, so the same digest can be taken of a tree inside `safeWrite`'s pure mutation without touching the filesystem.

The record stream is unchanged and stays frozen: `` `${digestKey(relative)}:${sha256hex(content)}\n` ``, ascending by unescaped path, `SKILL.md` passed through `canonicalSkillMd` first, result prefixed `sha256:`. `digestKey` is the existing prefix-free escape (`src/lib/skills.ts:147`) — do not invent a second one. Mode and mtime are **not** in the stream (D2).

**Pin the wire format with a literal-hex test**, exactly as `src/lib/__tests__/skills.test.ts:74` already pins `canonicalDigest`. The value is persisted in receipts; it is frozen the day it ships.

> **Not a two-active-paths violation:** `snapshotSkillDirectory` (`src/lib/placer/vendor/skillhub/skill-fingerprint.ts`) stays exactly as it is and keeps feeding `config.placements[].fingerprint`. It answers a different question — *has this placed folder drifted since we placed it* — and it is the sole authority permitting `placer.remove()` to delete anything. Re-pointing it at `canonicalDigest` would mismatch every existing placement on every machine and mass-quarantine every installed skill in one pass. A reviewer will flag the two digests; this paragraph is the answer.

### 3.4 `version` as a persisted value — one type everywhere

**The string `"v3"`, or `null`.** Applied identically in all five declarations, in one change:

| Declaration | Today | Becomes |
| --- | --- | --- |
| `receiptSchema.version` (`src/lib/evals/receipt.ts:54`) | `/^[0-9a-f]{40}$/` | `z.union([z.string().regex(VERSION_FOLDER), z.string().regex(/^[0-9a-f]{40}$/), z.null()])` — null = a local run not yet attached. **The 40-hex arm is retained read-only** for `schema_version: 1`: nothing new ever writes it, and a reader renders it as *"a version recorded before versioning"*. Without that arm, §6.1's "no historical receipt becomes unparseable" is false — the retype would reject every receipt ever written |
| `installedSchema.version` (`src/lib/schema.ts:48`) | `z.string().length(40).nullable()` | same union |
| `configSchema.placements[].version` (`src/lib/schema.ts:135`) | `z.string().length(40).nullable()` | same union |
| `profileEntrySchema.version` (new) | — | `z.string().regex(VERSION_FOLDER)` — never null |
| `cliLocalRow.placement.version` (`desktop/src/backend/tauri/index.ts`) | `z.string().length(40).nullable()` | same union |

*Reason for a string over an integer:* it round-trips unchanged through JSON, a git path segment, a CLI ref and a URL with no formatting decision at any boundary.

**A read-time preprocess is mandatory, not optional.** `configSchema` is parsed on the first read of *every* verb and `ConfigStore.read()` re-throws anything that is not ENOENT (`src/lib/config.ts:39-44`). A bare retype bricks every machine that has ever installed a skill — including `sync --hook`, which Claude Code runs at session start as `npx -y terum-skills@latest sync --hook`, i.e. it auto-upgrades the user into the breaking CLI with no action by them, and `patchConfig` cannot delete a field to repair it (`src/lib/config.ts:125`).

Model the preprocess on the existing `teamsSchema` one (`src/lib/schema.ts:104-112`), whose comment already documents this exact failure class. Object-level `z.preprocess`: map any 40-hex `version` in `placements`, in `pending`, and in `personSchema.installed[]` to `null` ("placed before versioning"). Test that an untouched pre-upgrade `config.json` parses, that a `preserveUnchanged` update afterwards does not trip `patchConfig`'s throw, and that the stale bytes are dropped by the next plain `update()`.

### 3.5 `people/<handle>.json` (D5)

```jsonc
{
  "handle": "ryan", "display_name": "Ryan Liu", "email": "…", "github": "…",
  "bio": "", "role": "Platform", "projects": ["Payments"],
  "installed": [ { "id": "<uuid>", "version": "v3",
                   "scope": {"kind":"global"}, "since": "2026-09-11" } ],
  "profile":   [ { "id": "<uuid>", "name": "deploy-check", "version": "v3",
                   "added": "2026-09-11", "via": "publish" } ],
  "declined": [], "local_skills": 101
}
```

- `installed[]` — automatic, written by `install`, one entry per id. **`scope` is kept.** It is already there, `uninstall`'s per-scope bookkeeping reads it (`src/commands/uninstall.ts:197-210`), and removing it is a change to the install/uninstall area rather than a field deletion.
- `profile[]` — curated. Written only on an explicit yes at publish or install, and by `profile --add/--remove`. One entry per id; a re-add updates `version` and `added` in place. Removing from a profile never touches disk.
- `declined[]` — retained in the schema so existing files parse, but **no longer written**: its only job was suppressing the endorsement-driven auto-install that §12 deletes. The `decline` verb goes.
- `local_skills` — retained. Today it is written by sync's library-size pass, which §12 deletes; it is now written opportunistically on any people-file write (publish, install, profile), using the Library scan the verb already performed.

### 3.6 Local state, `~/.terum/skills/config.json`

```jsonc
{
  "projects": [ { "root": "/Users/you/code/web", "label": "web", "added_at": "2026-09-11" } ],
  "teams": { … }, "approvals": {}, "pending": [], "placements": { … },
  "email": "…", "default_handle": "…", "display_name": "…", "github": "…"
}
```

- **`checkouts: string[]` becomes `projects: LibraryProject[]`** — L-PROJ below. A `label` is needed because the Library renders these as first-class named things and a bare path cannot carry a name the user chose; default `basename(root)`, disambiguated as `` `${basename(root)} (${basename(dirname(root))})` `` when two roots share a basename.
- Migration is a read-time object-level `z.preprocess` on `configSchema`: when `projects` is absent and `checkouts` is a string array, emit `projects` from it and drop `checkouts`. Because the preprocess strips `checkouts` before `read()` returns, `before` never carries it and `patchConfig`'s delete-throw does not fire. The stale bytes stay inert.
- `config.shared` and `config.auto_share` are **deleted** (§12) — but see the `leave.ts` protection rule in §11.3 before deleting them.

**L-DECL — the one permitted cross-mirror annotation.** D4 requires the Marketplace card to say *"you have Version 2"*. That is a machine-local fact on a screen this refactor calls a pure mirror. It is permitted, exactly once, under these terms: the marketplace **catalogue** (what skills exist, their versions, their evals, who is on them) is read only from the clone; the viewer's **own** annotation — `installedVersion: string | null`, sourced from `config.placements` — is a separate overlay field, named as such on the type, set by the adapter after the catalogue is built, and never consulted by any filter, sort or count. Purity constrains the read model, not the viewer's annotation of it. The Library carries **no** team-derived field at all.

---

## 4. Milestone M1 — the version vocabulary and the write path

**Done means:** the repo can hold `skills/<name>/v<N>/`, the guard admits it and refuses everything else, and nothing writes a skill except `publish`.

### 4.1 New and changed modules

- `[new] src/lib/versions.ts` — §3.2, verbatim.
- `[modify] src/lib/skills.ts` — `walk()` gains the D2 ignore list; export `skillContentDigest`; `skillRecords()` (`:25`) reads `skills/<name>/v<max>/SKILL.md` — readdir `skills/`, then `listVersions` per name; when the array is empty, `options.onProblem({ name, message: 'skills/<name> holds no v<N> folder.' })` and **skip the skill** (same shape as today's invalid-frontmatter path). `SkillRecord` gains `latestVersion: number` and `versionCount: number`. The `parsed.data.name !== name` check (`:37`) now applies to the latest version only. **`endorsedCandidates()` is deleted, not rewritten** — see §12; it is the sole source of `team join`'s post-join auto-install offer, which this refactor removes.
- `[rewrite] src/lib/version.ts` — delete `resolveVersion` entirely, and with it the whole tree-hash contract. **`materializeVersion` goes too.** Its only remaining consumer was the eval's incumbent arm, and §6.6 re-points that at `<clone>/skills/<name>/v<K>/` — a version folder is already an immutable checkout inside the clone, so there is nothing left to materialize. Delete the file once `versions.ts` holds everything; do not leave `version.ts` and `versions.ts` side by side.
- `[modify] src/lib/readme.ts` — **this file runs inside `safeWrite` and is the migration's biggest unguarded hazard** (§13.1a). (a) `readReadmeData` (`:150`) and `regenerateReadmeInTree` (`:178`) select `/^skills\/[^/]+\/v[1-9][0-9]*\/SKILL\.md$/` and keep only the highest `n` per name via `parseVersionFolder`; (b) `ReadmeSkill.latest` becomes the `v<N>` string and the table's `Latest` column becomes `versionLabel(n)` in place of `shortHash(skill.latest)`; (c) `ReadmeData.team` drops `global`, and `skillEndorsement` (`:60`) is **simplified in place, not deleted** — it drops its `team.global` branch and returns the `projects` list, `Global` among them; (d) `latestTree` (`:133-137`) is deleted and `teamRepo.ts:210`'s `skillTrees(git, writtenTree)` is replaced by a name→highest-`v<N>` map derived from `tree.paths('skills/')`, so the generator still reads only the in-memory post-image and no git call is added inside the loop; (e) `latestReceiptVerdict`/`latestReceiptVerdictInTree` take a `v<N>` and apply §8.1's fallback, appending `(Version 3)` when stale.
  **Invariant, and it is load-bearing:** `generateReadme` must never replace a non-empty catalogue block with `No shared skills yet.` A derived artifact may not silently delete a repo's catalogue. `generateReadme` (`:74`) does not receive the existing README — only `applyReadme` (`:116`) holds both sides — so the guard belongs in `applyReadme`, which must refuse the substitution and leave the block untouched.
- `[modify] src/commands/search.ts` — `SearchHit.latest` becomes the `versionLabel` of the highest `listVersions` entry; drop `unresolved` (a skill with no version folder no longer reaches search — `skillRecords` drops it) and `endorsed`; the `latestTree`/`latestChange` fan-out at `:52-54` becomes one `listVersions` per hit; `readdir(join(clone,'people'))` is unchanged (§3.1 keeps lowercase).
- `[modify] src/commands/validate.ts` — a ref that is not a local directory resolves to `<clone>/skills/<name>/v<max>/` via `listVersions`, not `<clone>/skills/<name>`; a name with no version folder fails with the same `skills/<name> holds no v<N> folder.` message.
- `[modify] src/lib/teamRepo.ts` — delete `skillTrees()` (`:361-370`); rewrite `skillVersions(clone, names): Promise<Map<string, SkillVersion[]>>` over `listVersions` through `mapWithConcurrency(names, 8, …)`. It no longer takes a `Runner` or a `ref`. Collapse `push()` (`:283-294`) to the main-only body — `git push -q --no-verify origin HEAD:refs/heads/main` — and delete `SafeWriteOptions.branch`, `STALE_LEASE` and `REF_LOCK`.
- `[modify] src/lib/schema.ts` — `teamSchema`: `layout_version` becomes a **refinement carrying a readable upgrade sentence**, not `z.literal(3)` (a bare literal produces an unreadable zod dump on the very file that would tell the user what to do); delete the top-level `global`; `policy` drops `publish` and keeps `{ skill_license }`. Add `GLOBAL_PROJECT = 'Global'`. Apply §3.4 and §3.6.
  **Also export a lenient sibling, `anyLayoutTeamSchema`** — identical but with `layout_version: z.union([z.literal(2), z.literal(3)])`, `global` optional and `policy.publish` optional. The migration verb and the guard's migrate row read a **layout-2** `team.json`; the strict layout-3 schema rejects its own input, so without this the migration cannot parse the file it is there to rewrite. Exactly two callers: `team migrate`, and the layout precondition in §13.1.

### 4.2 The write guard

`src/lib/guard.ts` is the authorization model and changes more than any other file.

- `GuardAction`: delete `'connect'`, `'sync'`, `'eval'`, `'eval-assets'`, `'decline'`. Add `'migrate'`. `'sync'`'s only callers are `connect.ts` and `sync.ts`, both deleted in §12. With row a gone, delete `ownsSkill`, `authorOf`, `GuardContext.author`/`previousAuthor`, and `canonicalSkillDigest` (`src/lib/skills.ts:152`, whose sole caller is `ownsSkill`) — D15.
- Delete `SKILL_ACTIONS` (`:37`) and the `skills/` regex at `:52-53`.
- **New row a′ — publish writes a version folder.** A changed path is permitted under action `'publish'` only if it matches `/^skills\/([^/]+)\/v[1-9][0-9]*\/.+$/`, `tree.before(path) === undefined` and `tree.after(path) !== undefined`. **Add-only: never modify, never remove.** This is what makes a version immutable at the authorization layer rather than by convention.
- **Row h (`EVAL_ASSET_PATH`, `permitsEvalAsset`) is deleted outright, with no replacement (D9).** Eval cases are ordinary version bytes now, admitted by row a′ like every other file in `v<N>/`. There is no add-or-replace row anywhere: a version folder is add-only, full stop.
- **Row g moves under `'publish'`.** `RECEIPT_PATH` becomes `/^evals\/([0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})\/(v[1-9][0-9]*)\/(\d{8}T\d{6}Z)\.json$/`. **Drop `permitsReceipt`'s `tree.changedPaths.length !== 1` clause** — a publish commit legitimately writes a version folder, the `team.json` list, a people file and N receipts at once, so append-only must become a per-path predicate, not a whole-commit one. Keep the uuid→`metadata.id` resolution, re-pointed at `tree.paths('skills/')` filtered by `/^skills\/[^/]+\/v[1-9][0-9]*\/SKILL\.md$/`.
- `PEOPLE_ACTIONS` becomes `['join','install','uninstall','profile','publish']`. **Edit this list in exactly one place and re-list every verb that writes the file in the same change** — a mismatch here throws `Write guard refused people/<handle>.json for install` on every install.
- Row c (`guardTeam`): `publish` may append to `projects[].skills`; the `global` branch is deleted.
- **New row j — migrate.** It must be the **first** clause of the loop, before the `team.json` branch at `:51`: `if (context.action === 'migrate' && permitsMigration(tree, path)) continue;`. Placed after the `team.json` branch it is unreachable, because `guardTeam` claims `team.json` first and refuses a migrate diff. `permitsMigration` **must not call `parseTeam`** — the pre-image is layout 2 and the layout-3 `teamSchema` rejects it (use `anyLayoutTeamSchema`, §4.1, or validate structurally). It admits: `team.json`, `README.md`, and paths matching `/^skills\/[^/]+\/(v1\/.+|evals\/.+)$/` or `/^evals\/[0-9a-fA-F-]{36}\/(v1|archive\/[0-9a-f]{40})\/\d{8}T\d{6}Z\.json$/`. **The `archive/` arm is not optional** — D7's archive path is in the locked layout (§3.1) and is admitted by no other row, so without it the migration's own push is refused by the guard it just passed.
- `guardRawPush` (`:101`) keeps its README, own-people-file and `team.json` rows, and **refuses every `skills/**` path** (D15) with *"Push guard refused `<path>`: skill versions are minted by `terum-skills publish`; a hand push cannot mint one"* — its `{ action: 'connect', … }` call to `ownsSkill`, the row-h `permitsEvalAsset` branch and the "this machine has no name and email" branch (`:116`) all go. `evals/**` stays refused on a raw push, as today. **Plus**: on an unrecognised top-level path shape it must say *"this clone's push guard predates the repository's layout; re-run `terum-skills team join <remote>` to re-arm it"* rather than falling through to *"not yours as `<handle>`"*. Today it names the wrong cause and its only advice is `git push --no-verify`, i.e. it teaches the user to disable the guard permanently.

### 4.3 Re-arming the frozen push guard

`installPushGuard` writes `.git/hooks/pre-push` and is called from exactly three places — `cloneTeam`, `team join`'s `ensureClone`, and `bootstrap`. It is **not** called by sync, install, publish, or an npm upgrade, and the hook body launches the CLI version that armed it, never `@latest` (deliberately, `src/lib/teamRepo.ts:468`). So every existing clone's guard is frozen at a version that refuses every layout-3 path.

Re-arm from the migration verb **and** from the first successful `safeWrite` after an upgrade. Arming is already documented as idempotent.

### 4.4 `applyTree` ordering (hardening, not a blocker under D1)

`applyTree` (`src/lib/teamRepo.ts:399-405`) processes `changedPaths` in sorted order, so an add can precede its own remove. Under D1 there is no case-only rename in the migration, so this is not on the critical path — but the same hazard fires on any ordinary case-only *skill* rename. Fix it here: process removals before writes, and `rmdir` emptied parents in between (lift the loop from `removeCreated`, `:415-419`). Add a test that runs on a case-insensitive filesystem; a Linux-only CI run cannot see it.

### 4.5 File modes survive a publish (D10)

Today a `0755` script published to the team arrives `0644` and will not run, with nothing saying why. Under this refactor publish becomes the only way bytes travel, so this stops being a latent curiosity and becomes the single path every script takes. **Five touch points, and the fifth is the one that makes this bigger than it looks:**

1. `MutableTree.setExecutable(path: string, executable: boolean): void` on the interface (`teamRepo.ts:24-31`).
2. A `modes = new Map<string, boolean>()` overlay in `makeTree` (`:305`).
3. `treePaths` (`:333`) must **stop requiring `tracked.has(path)` for overlay entries** — a path created by `tree.set()` is never in the committed index, so today it can never be reported executable, which is the root of the bug.
4. A `chmod` after `writeFile` in `applyTree` (`:399-405`).
5. **`changedPaths` (`:321`) must learn about modes.** It compares **content only** (`sameContent`), but `git diff --cached --name-only` reports a mode-only change — so a chmod of a file whose bytes are unchanged stages a path `changedPaths` does not list, and `safeWrite`'s staged-diff equality proof (`:220-223`) throws `Staged diff [...] does not match the mutation [...]`. This cannot fire for publish itself (a version folder is add-only, so every path is already in `changedPaths`) but `applyTree` is shared by every write path, so it must be handled or an ordinary mode-only write breaks.

Detection on the read side already exists: `src/lib/skill-source.ts:86` does `lstat(next).mode & 0o111`.

Mode is **not** part of content identity (D2 normalizes it), so nothing here touches version identity — an executable and a non-executable copy of the same bytes are the same version.

**Test:** publish a skill containing a `0755` file, re-read from a fresh clone, assert `git ls-tree` reports `100755`; plus a mode-only-change case asserting the staged-diff proof does not throw.

**Grounding, so nobody is surprised by the scope:** there are currently **zero** `100755` files in the team repo and **zero** executable files across 88 local skill folders. This fixes a real mechanism with no live instances — a deliberate call (D10) taken over the cheaper warn-and-gate, on the grounds that a warning announces a loss where the fix means nothing is lost.

---

## 5. Milestone M2 — publish

**Done means:** `publish <ref>` copies one local skill folder into the team repo as its next immutable version, refuses a byte-identical republish, attaches every local eval run against those exact bytes, offers a project, offers the profile — and nothing else can write a skill.

### 5.1 The verb

`[rewrite] src/commands/publish.ts`. Outside `safeWrite`, in order:

1. Resolve `ref` to a **local folder** from the Library roots (global + `config.projects`). Not from the clone: you publish what is on your machine.
2. `assertNotInsideStateRoot` + `assertSkillDirectory` (both already used in `connect.ts:181,184`) so a nested symlink or a non-directory is refused before anything is read.
3. Read the folder into **one** map, `files: Map<relPath, Buffer>` (plus its `executable` set), keyed relative to the skill root: every file except the D2 ignore list. `evals/triggers.yaml` and `evals/cases/*.yaml` are **in** this map (D9) — they are skill bytes like any other, digested and written into `v<N>/`. *Rev 2 split this into two maps; D9 collapsed it back.*
4. `injectManagedFields` into the in-memory `SKILL.md` — `license` from `team.json.policy.skill_license`, `metadata.id` (existing, or minted at v1), `metadata.author`, and `metadata.terum-category` when absent. **This is the only surviving caller of `injectManagedFields`**, migrated out of `connect.ts` before that file is deleted.
5. Hygiene checks on the **injected** map — `assessHygiene(name, { files, executable }, policy.skill_license)` (`src/lib/evals/hygiene.ts:120`) already takes exactly this shape — including the privileged-grants confirmation. **Never before step 4:** `skillFrontmatterSchema` is strict and requires the managed fields (`schema.ts:142-148`), so a folder that has never been published fails HYG1 on fields publish is about to write. `connect.ts:225→:228` already runs in this order; publish keeps it.
6. `candidate = skillContentDigest(files)` — after step 4, so the comparison is post-normalization (§1.2).

Then inside `safeWrite` with `action: 'publish'`, a pure mutation:

7. Enumerate the name's existing versions **from the tree**, not with `listVersions` — `listVersions` is a `readdir` of the working copy and a pure mutation may only see the post-image. Derive them with `versionsInTree(tree, name)` (§3.2) — the same parser and sorter as `listVersions`, over `tree.paths('skills/<name>/')`; do not re-derive them inline. For each version `v<K>`, digest its bytes with `skillContentDigest` after **stripping the `skills/<name>/v<K>/` prefix from every key** — `tree.paths(prefix)` returns full repo-relative paths and does not strip (`teamRepo.ts:325-329`), while §3.3's record stream is keyed skill-folder-relative. Feed it unstripped and no version can ever compare equal, so every publish mints a new version forever and the step-8 refusal is unreachable. §14.1's republish test is the gate that catches this. Walk the versions in descending `n` and stop at the first digest equal to `candidate`; only this skill's own history is read, so the cost is O(bytes under `skills/<name>/`) per attempt — and `safeWrite` re-runs the mutation on every retry (`teamRepo.ts:181-194`; `before()` re-reads through a per-attempt cache), so the scan repeats per attempt. If that ever bites, the fix is a digest index outside the version folders, never a manifest inside one (§3.1).
8. **If a version's digest equals `candidate`:** do not mint. `identicalTo = versionFolderName(K)` (the string `'v2'`, matching §5.3). Still attach any local receipts whose `content_digest` equals `candidate` and that are not already committed under `v<K>` (D from the refactor's republish rule). If there are none either, the mutation is empty and `safeWrite` returns `changed: false`.
9. **Otherwise:** `N = highest + 1` (never `count + 1`; on a first publish the highest is 0, so `N = 1`). Write every entry of `files` under `skills/<name>/v<N>/`, eval cases included. Append the uuid to `team.json.projects[<project>].skills` if absent. Attach matching receipts under `evals/<uuid>/v<N>/`.
10. Append/refresh `installed[]`? **No.** Publishing is not installing — D5 splits the two lists, and `installed[]` means *a copy is on a machine*. The prompt's sentence *"The person who published it has their .json changed to include that skill"* is satisfied by the profile prompt writing `profile[] {via:'publish'}`. Only that prompt writes the people file here.

### 5.2 Messages

- Identical: **`The skill you tried to publish is identical to version X of the skill already in the team repository.`** Verbatim from the refactor prompt, with `X` rendered by `versionLabel` (D1) and the prompt's lowercase `version` absorbed into it — the shipped string is `…is identical to Version 2 of the skill already in the team repository.`, and §14.1's verbatim test pins that exact form. It is an `ok` result with `created: false, identicalTo: X`, not a failure — a republish that only attaches an eval is a success.
- Created: `Published <name> as Version N in <project>. Attached <n> eval run(s).`
- Profile prompt, after the write, carrying the version the skill now sits at — `version` when minted, `identicalTo` when identical, never null (an identical publish still points the profile entry at the existing version): `Add <name> to your profile?` — default no. `--yes-profile` pre-answers for the desktop and for tests.
- Project prompt when the team has more than one project and `--project` is absent: a choice list defaulting to `Global`.

### 5.3 Result DTO

```ts
PublishResult = { team; id; name; project: string;
                  version: string | null;      // 'v4', or null when identical
                  created: boolean;
                  identicalTo: string | null;  // 'v2'
                  attachedEvals: number;
                  profileAdded: boolean }
```

`prUrl`, `compareUrl`, `branch` and `policy` are deleted from the DTO and from every reader — named: `cliPublish` (`desktop/src/backend/tauri/index.ts:51`) becomes `{ name, project, version: z.string().nullable(), created: z.boolean(), identicalTo: z.string().nullable(), attachedEvals: z.number(), profileAdded: z.boolean() }`; the mapping at `:853` maps `version` straight through (today it reads `value.prUrl ?? value.branch`, so the rename is **not** a no-op); `PublishResult` (`types.ts:113`) drops `prUrl` and gains `created`/`identicalTo`; the mock at `mock/index.ts:193` stops minting a PR URL.

### 5.4 `Global` at team creation

`[modify] src/commands/team.ts` — `bootstrap()`'s seeded team literal (`:527`) becomes `{ layout_version: 3, name, categories: CATEGORIES, projects: { Global: { remotes: [], skills: [] } }, archived: [], policy: { skill_license: 'UNLICENSED' } }`. No `global` array, no `policy.publish`.
`[modify] src/commands/project.ts` — `project create` refuses the name `Global` case-insensitively: *"Global is created with every team and cannot be created again."* The migration (§13) creates `Global` in every existing team.

---

## 6. Milestone M3 — evals bound to content, resolved to a version at publish

**Done means:** every eval runs locally against a folder on this machine, records exactly which bytes it evaluated, and publish resolves that to a version number.

### 6.1 The ordering problem, and its answer

A local eval runs **before** the skill has a remote version number. Binding a receipt to `v4` at run time is impossible. So:

- **Identity at run time is the content digest.** `receiptSchema` gains `content_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/)`, required at `schema_version: 2`, computed by the *same* `skillContentDigest` as the publish comparison (§3.3). If these two ever diverge, publish silently attaches nothing.
- **`version` is `null` for a local run** and is filled in by publish when it resolves the digest to a version folder. A *committed* receipt's `version` is never null.
- `schema_version` becomes `z.union([z.literal(1), z.literal(2)])` so no historical receipt becomes unparseable.

### 6.2 The local eval store — content-keyed

```
~/.terum/skills/evals/local/<64-hex content digest>/<YYYYMMDDTHHMMSSZ>/
    receipt.json  run.jsonl  transcripts/  sandboxes/
```

Re-keyed from today's `evals/<team>/<skill-id>/<runId>/` so a skill belonging to **no team** can be evaluated — which is now the common case, since the Library is a local mirror. Content-keying is what makes publish's attach step provable rather than trusted: publish matches on the digest it just computed, not on a name or a timestamp.

`<runId>` keeps `RUN_ID_PATTERN` (`YYYYMMDDTHHMMSSZ`), so lexicographic order stays chronological and `newestReceiptAt` still applies.

**Existing run trees under `evals/<team>/<uuid>/` are not migrated.** They are read for display and never written again. They are paid runs; silently losing them would be a decision, not an omission — this sentence is the decision.

### 6.3 Eval targets a local folder

`[modify] src/commands/eval.ts`:
- Resolve `ref` to a **local folder**, not a team skill. Miss message: *"No local skill folder named `<ref>` in your library; install it from the marketplace first, or pass `--path`."*
- Add `content_digest` where the receipt is built (`:295-324`), from the exact candidate files the run used, after the same ignore list.
- **Delete `--commit` end to end**: the receipt `safeWrite` (`:330-343`), `commitEligibility` (`:358-370`) and both call sites, `generationCommitNotice`, and the generated-asset confirm-commit branch (`:194-237`) including its `reconcileShared` call. Publish is the only writer.
- **`--generate` writes cases to the LOCAL folder, always (D9).** Today it has two routes and neither survives: with a connected source it calls `saveGeneratedAssets(shared.source, …)` then mirrors up through `reconcileShared`; without one it commits straight into the team repo under the `eval-assets` guard row. Both go. The new behaviour is the first half of the old one and nothing else — `saveGeneratedAssets(<the local skill folder>, generated)`, full stop. The cases then reach the team the same way every other byte does: the user publishes.
  **This is why D9 matters operationally, not just architecturally.** Rev 2 deleted both routes and added none, so nothing would have produced eval cases anywhere. Verified: 88 local skill folders on the author's machine carry zero `evals/` directories today, because the generated cases went straight to the repo.
  **Consequence to state in the UI:** generating cases changes the skill's content digest, so the next publish mints a new version *and* the existing local eval score blanks (§7.3). The generate flow should say so before it writes.
- After a run completes, the result carries `shareHint: true` so the caller can show: *"To share these results, publish the skill again."*
- `[modify] desktop/src/screens/skill/RunEvalDialog.tsx` — `versionLine` (`:29-30`) becomes *Evaluates the copy on this machine at `<path>`.* with the `teamCurrent`/`placed` comparison deleted; the "committed to the team repo" sentence (`:27`) goes; the `commit` and `team` arguments to `evalRun.start` (`:24`) go, along with `commit` on `EvalRunState`/`start` in `desktop/src/app/eval-run-context.ts` and the `--commit` suffix on the shown command. `run-eval.test.tsx` follows.

### 6.4 `receiptPath` and the readers

`receiptPath(skillId, version, runId)` returns `` `evals/${skillId}/${version}/${runId}.json` `` where `version` is `v<N>`.

**Receipts stay uuid-keyed, not name-keyed.** The uuid is already the join key for `installed[]`, `placements[].id`, `approvals`, `installCounts` and the desktop's `joinedSkill`; name-keying silently re-scopes all of them and loses a renamed skill's history. Consequence: a local eval on a folder with no `metadata.id` cannot be committed until publish mints one at v1 — which is exactly when it gets attached, so this costs nothing.

`[modify] src/commands/evalReport.ts` — four changes, not one:
1. `:33` drops `resolveVersion` (deleted in §4.1). `versions.teamCurrent` becomes `(await listVersions(clone, record.name))[0]?.folder ?? null`, and the verb reports *"no published version"* when null instead of throwing.
2. `:55`'s history filter changes from `/^[0-9a-f]{40}$/i` to `parseVersionFolder(d) !== null`. `:34`'s `root` is already `join(clone,'evals',record.id)` and does **not** change — §3.1 keeps `evals/` lowercase.
3. **The local-run reader is re-pointed.** `localRoot` today resolves `~/.terum/skills/evals/<team>/<skill-id>/`; after §6.2 new runs land at `~/.terum/skills/evals/local/<digest>/`. Resolve the skill to a local folder, digest it, and read that directory. **Read the legacy `evals/<team>/<uuid>/` tree too and merge, display-only** — §6.2 says those runs are not migrated, so a report that reads only the new store makes every pre-upgrade run vanish from the Evals tab.
4. Sort by `(version DESC, run_id DESC)` so the rail groups by version, and add `fallbackFrom: string | null` so the detail page's headline uses the same receipt the card did.

### 6.5 The eval's incumbent arm

`eval` compares a candidate against an incumbent, and today that incumbent is a materialized git tree. With `resolveVersion` and `materializeVersion` both gone (§4.1) it has no resolver, so it must move to ordinals:

- `materializeIncumbent` (`src/commands/eval.ts:466`) becomes `incumbentDir(clone, name, versions)`: the incumbent is the highest `v<K>` **below** the candidate's version that has a receipt, read directly from `join(clone,'skills',name,'v<K>')`. No `materializeVersion`, no cache, no `git rev-parse origin/main^:…` — a version folder is already an immutable checkout inside the clone. This is why §4.1 can delete `materializeVersion` outright.
- `latestReceiptedTree` (`:479`) becomes `latestReceiptedVersion`, filtering directory names with `parseVersionFolder(d) !== null` and returning the `v<N>` whose newest run-id wins.
- `skillsWithoutReceipt` (`:514-530`) takes the new `skillVersions(clone, names)` shape and reads `evals/<id>/<highest v>`.
- Delete the `resolveVersion` calls at `eval.ts:105` and `:229`.

### 6.6 The desktop eval queue

Named by no trace and it will break silently. `desktop/src/backend/eval-queue.ts:4` and `desktop/src/backend/tauri/eval-queue.ts:5` both declare `{ team, skill, version }` **required**, and parse `eval --queue-list` output with zod. After §6.1 the parse fails on every item, `evalQueueFor(backend).list()` returns `ok:false`, and `EvalQueueDrainer` silently schedules nothing.

`[modify]` both files: `EvalQueueItem` becomes `{ skill; path; contentHash; requestedAt; window; team?; lastError? }`; the zod `item` follows; the drain argv drops any deleted flag. `src/lib/evals/queue.ts`'s `itemSchema` changes to match, and three things go with it: `queueKey` (`:18`) becomes `JSON.stringify([item.skill, item.contentHash])` — it is the dedupe identity in `updateEvalQueue` and in every `eval.ts` queue call, and with `team` optional and `version` gone the old key collapses every item onto `undefined`; `queueSchema.schema` becomes `z.union([z.literal(1), z.literal(2)])` and `readEvalQueue` (`:21-26`) drops any item that fails the v2 item schema instead of rethrowing — a stale queue is discardable state, not data loss, and today's rethrow takes the whole drainer down on the first read after upgrade; the next `updateEvalQueue` writes `schema: 2`. `--queue-list` (`eval.ts:581`) emits `contentHash` where it emitted `version`. Test: a `run/eval-queue.json` full of 40-hex items reads back empty and the next enqueue writes schema 2.

---

## 7. Milestone M4 — the Library as a local mirror

**Done means:** the Library screen reads local files and nothing else, project roots are only ever added by an explicit act, and a library card shows only locally-run evals.

### 7.1 L-PROJ — the local project registry (one naming, locked)

Two traces proposed two incompatible registries; this is the single answer.

| Thing | Locked |
| --- | --- |
| Config field | `config.projects: LibraryProject[]` |
| Module | `src/lib/projects.ts` (renamed from `src/lib/checkouts.ts`) |
| Writer | `addLibraryProject(store, root, io)` |
| CLI, local | `project add [path]` · `project remove <path>` · `project list` |
| CLI, team | `team project create` (moved from `project create`) |
| Feature keys | `libraryProjects` (local — **renamed from the existing `checkouts`**) · `projects` (shared — **already taken** by the marketplace Teams/Projects screen, `MarketplaceScreen.tsx:44`, and it does not move) |
| Seam | `backend.projects.{add,remove}` · `backend.teamProjects.create` (no `discover` — D13) |

The rename is worth its cost precisely because the sidebar's existing **Add project** button runs `checkout add` — the user-facing word is already "project". `desktop/AGENTS.md` invariant 2 requires exactly one consumer per feature flag, which is why the local key is `libraryProjects` and not `projects`: `projects` is live today for the marketplace's team-projects screen, and giving the same boolean two meanings in one app is the thing that invariant forbids. Renaming `checkouts` → `libraryProjects` is a `FEATURE_KEYS` edit (`desktop/src/backend/types.ts:12`) **and the same key in the CLI's `FRAME_FEATURES` (`src/lib/frames.ts:50`)** — the desktop builds `features` as `hello.features[key]` per `FEATURE_KEYS` (`tauri/index.ts:647`), so a key renamed on one side only reads `false` forever and the Add-project button vanishes — plus its consumers at `Sidebar.tsx:39,48`, `SettingsContent.tsx:83` and `LibraryScreen.tsx:34`. In the same commit: `Surfaces.checkouts` → `Surfaces.libraryProjects` with its two producers (`tauri/index.ts:654`, `mock/index.ts:115`); `FRAME_VERBS` (`frames.ts:36`) `checkout add|remove|list` → `project add|remove|list`, `checkout discover` dropped, `project create` → `team project create`; `Backend.checkouts` → `Backend.projects` and the existing `Backend.projects` → `Backend.teamProjects` (`Backend.ts:22,:24`) in both adapters (`tauri/index.ts:727`, `mock/index.ts:121`), with the seam call sites `Sidebar.tsx:20,28` and `LibraryScreen.tsx:41`; `CheckoutAdded`/`CheckoutRemoved` (`types.ts:75,:78`) → `ProjectAdded`/`ProjectRemoved` with their zod mirrors. The sidebar's `Projects` row (`Sidebar.tsx:31`) links to `#/marketplace/projects` while its children are local roots; re-point it at the Library.

**`src/commands/checkout.ts` and the `checkout` commander group are renamed here, not deleted in §12.** The verb surface `checkout add|remove|list|discover` becomes `project add|remove|list` (no `discover` — D13), `CliVerbs.checkout` becomes `CliVerbs.project`'s local half, and `src/commands/project.ts`'s team-project creator moves to `team project create`. §12 lists the checkout behaviours that genuinely die — `writableCheckout`, and the whole of `discover`.

**`discover` is deleted outright (D13).** Rev 2 kept it as a read-only lister purely to feed the onboarding step's candidate list; D13 makes that step a single folder picker, so nothing consumes it. Delete `src/lib/discover.ts` entirely — `discoverSkillRoots`, `DiscoverCandidate`, `DiscoverResult`, `DEFAULT_MAX_DEPTH`, `DEFAULT_BUDGET_MS`, `SKIPPED_DIRECTORIES` — plus the `kind: 'discover'` verb arm, the `discover` CLI subcommand, and `backend.projects.discover` on the seam.

### 7.2 The app never adds a project by itself

Delete every implicit registration:

- `writableCheckout()` (`src/lib/checkouts.ts:14-23`) — its whole purpose is inferring a project from a working directory.
- `publish`'s silent `register` closure (`src/commands/publish.ts:42-45`) and its three call sites.
- `install --into <path>` auto-registration (`src/commands/install.ts:251`). **An untracked `--into` path now refuses**, naming `project add`. This is the only reading compatible with "the app won't explicitly add any projects unless you add them yourself".
- `connect`'s repo-root registration (`:216`, `:256`) — moot, the file is deleted.
- The cwd-detected Library root (`src/lib/local-skills.ts:77-83`).
- The ledger-inferred `extraRoots` computation (`src/commands/ls.ts:187-190`).

`localSkillRoots(home, projects)` loses both its `cwd` and its `extraRoots` parameters (`src/lib/local-skills.ts:52`) — the only `extraRoots` producer is the `ls.ts` computation deleted above.

### 7.3 The local eval store, read by the card

A Library card's eval comes from `~/.terum/skills/evals/local/<digest>/` for the digest of the folder **as it is on disk right now**. Consequences to state plainly in the spec so nobody treats them as bugs:

- Editing a skill changes its digest, so its card's score **blanks**. That is correct: the score described the old bytes. The card shows "Not evaluated" plus, when an older digest has runs, a quiet line *"evaluated before your last edit"*.
- **A freshly installed skill shows the team's score, attributed (D11).** Install seeds the local store with the committed receipt for the version it placed (§9.1), so the card reads e.g. `+18% PASS · run by ajayw36 · Version 4` rather than blanking. This is sound because the receipt's `content_digest` provably describes the exact bytes now on disk — the same digest the card looks the score up by. The runner attribution is **mandatory**, not optional: without it the Library claims the user ran something they did not.
- Combining the two: editing an installed skill blanks a **teammate's** score. Correct, and the empty state must say so — *"evaluated before your last edit"* — rather than reading as a bug.

### 7.4 The card and the screen

- `[modify] desktop/src/backend/tauri/index.ts` — **`inventoryCard` (`:193`) is the MARKETPLACE's builder and is not touched here**; it stays with `catalog()` (`:332`). The Library's builder is `localCard` (`:137`). Change `library()` (`:645`): delete the `joinedSkill` + `inventoryCard` branch at `:658` and the `libraryTeam(team, options)` half of the `Promise.all` at `:647`, so `library()` spawns only `ls --local` and every row is built by `localCard`. Delete `joinedSkill`, and `notOfferedCard`'s team path, if they lose their last caller. Replace `Library.team` (`LibraryTeam`) with nothing — the Library has no team limb — delete its two readers on `desktop/src/screens/library/LibraryScreen.tsx:43` (the `Team unreadable` banner and the `data.team.kind==='none'` arm of the no-team empty state, which this section's empty state replaces), drop the never-populated `provenance` from the `Library` DTO (`types.ts:79`), and re-word the `No such checkout: … Settings ▸ This machine ▸ Checkouts` message at `:650` for the L-PROJ rename.
- **`SkillCard` stays ONE shared type** (`desktop/src/backend/types.ts:33`); the Library and the Marketplace are two *builders* over it, not two types — splitting it would fork every card component, the `⋯` menu and the router. The type gains `localEval: ReceiptSummary|null`, `localEvalStale: boolean`, `installedVersion: string|null`, `latestVersion: string|null`, `evalVersion: number|null`, `evalStale: boolean`, `latestEvalState: 'ok'|'none'|'invalid'|null`, `profileVersion: string|null` — all **required-nullable**, so neither builder can forget one.
  The Library builder sets every team-derived field to a fixed neutral value, named here once: `installs: 0`, `teamState: 'unknown'`, `latestVersion: null`, `installedVersion: null`, `evalVersion: null`, `evalStale: false`, `latestEvalState: null`, `profileVersion: null`. It sets `localEval`/`localEvalStale`; the Marketplace builder leaves those null/false. `teamed` stays on the type and is set by both — `detailPath()` (`skill-card-actions.ts:11`) routes on it.
  `localEval` carries `runnerHandle: string | null` so D11's attribution can render. Null means the run was this machine's.
- **`edited: boolean` on the Library card (D12).** True when the folder's current fingerprint differs from `config.placements[<path>].fingerprint`. Local-vs-local — **no clone read** — so it survives the pure-mirror rule. `healthOf` (`src/commands/ls.ts:212-225`) narrows from five states to this one plus `unknown`: the `snapshots` map and the `update-available`, `both` and `gone-from-repo` branches are deleted, because all three need the clone and §8.3 already puts the version comparison on the Marketplace card. This is a **deletion, not new work** — the local leg exists and already runs. Cost is one `snapshotSkillDirectory` per **placed** skill per library load, already paid today and proportional to installed skills rather than to the whole library.
- **Every direct child folder of a Library root is a card (D16).** `candidate` renders normally; `rejected` — which `ls --local` already emits as `notOffered` rows (`src/commands/ls.ts:266`) rendered by `notOfferedCard` (`tauri/index.ts:145`) — and `failed` (`local-skills.ts:17`, dropped today) render with the name, the path and the inspection reason as the body, excluded only from eval and publish; route `failed` through the same `notOffered` path. `localSkillCounts`' predicate (`local-skills.ts:194`) becomes a plain count of direct child directories, so the sidebar count and the grid agree.
- The empty state: *"Skills in `~/.claude/skills` and in the projects you add show up here."*

### 7.5 D6 — delete, rename, move

One CLI verb with three modes, one seam method each, three dialogs.

```
terum-skills skill move   <path> --to <global|project-root>
terum-skills skill rename <path> --to <new-name>
terum-skills skill delete <path>
```

**The safety rail** (replacing the ledger-fingerprint check, which does not exist for a folder Terum never placed): the target's parent must satisfy `isSkillsRoot()`, the target must sit **directly** under it, the parent must be one of the Library's own roots (`~/.claude/skills` or a `config.projects` entry's skills root), and the user must confirm by typing the skill's name. Symlinks are refused.

- **delete** routes through `moveToQuarantine()` — the existing "moved, never deleted" primitive (`src/lib/placer.ts:170`). It is undoable, and `prune` is the only thing that ever hard-deletes.
- **move** reuses `moveDirectory()` (`:184`), which already handles the cross-volume copy-then-remove.
- **rename** is one `rename()`, plus: rewrite `SKILL.md`'s `name` frontmatter to match, and **warn in the dialog** that the folder name is the invocation name, and that if the skill is published, the remote is keyed by the old name — so the next publish mints a *new* skill at `v1` rather than the next version of the old one.
- If the target is in `config.placements`, all three modes update or remove the ledger entry in the same operation. A stale ledger key makes the placement undeletable by the tool: nothing in `config.placements` names it, so `removePlacements` (`src/commands/uninstall.ts:226-229`, the documented sole authority for local removals) never targets it — `placer.remove()` itself checks only shape and fingerprint (`src/lib/placer.ts:134-147`).
- **`skill delete` is the file operation only for a folder that is NOT a placement.** When the target *is* in `config.placements`, it delegates to `uninstall`'s existing `uninstallMany` primitive, so the quarantine move, the ledger entry and the `people[].installed[]` record go together. Otherwise the Library grows a delete that leaves a stale install record behind, and the skill keeps counting toward every marketplace card's install count after the user deleted it. The dialog says which path it is taking: *"This skill was installed from the team — deleting it also removes it from your installs."*
- **`skill move` is the only Move (D18).** The detail page's `moveTo()` — install into the destination, then uninstall from the old scope (`SkillScreen.tsx:85-87`, Ryan 2026-09-09) — and its `dialog=move` are deleted, and the marketplace card offers no Move (§11.4). A filesystem move cannot leave the skill placed twice or nowhere, which is what that ruling guarded against, and it never fetches the clone, so a local edit is never silently replaced by the team's copy. The 2026-09-09 ruling is superseded.

Register the three modes in `SERVE_READ_VERBS`? **No** — they are writes; §1.5. Note `serve` gates on `argv[0]`, so `project` cannot be added there either: `project add|remove` are writes even though `project list` is a read.

---

## 8. Milestone M5 — the Marketplace as a repo mirror

**Done means:** the marketplace reads the clone and one declared local overlay, and a card that shows an older version's eval says so on its face.

### 8.1 The eval fallback — exact algorithm

```
selectCardEval(clone, skillId, versions /* DESC by n, non-empty */) ->
    { eval: {receipt, version, stale} | null, latestEvalState: 'ok'|'none'|'invalid' }

  latestN := versions[0].n
  present := directory names under evals/<skillId>/            // ENOENT -> return {null,'none'}
  latestEvalState := 'none'
  for v in versions:                                            // descending
      if v.folder not in present: continue
      newest := newestReceiptAt(evals/<skillId>/<v.folder>)      // lexicographically last *.json
        on schema error: report it; if v.n == latestN then latestEvalState := 'invalid'; continue
      if newest is undefined: continue
      if newest.skill_id != skillId or newest.version != v.folder:
          report 'misfiled receipt'; if v.n == latestN then latestEvalState := 'invalid'; continue
      if v.n == latestN: latestEvalState := 'ok'
      return { eval: {receipt: newest, version: v.n, stale: v.n != latestN}, latestEvalState }
  return { eval: null, latestEvalState }
```

A schema-invalid newest receipt fails closed **for that version only** and the walk continues — one corrupt file must not blank a skill that has three good older evals.

**Where it lives.** `[new] src/lib/evals/receipt-store.ts` holds `selectCardEval`, beside the `receiptFiles`/`newestReceiptAt` §12 moves there. `[modify] src/commands/ls.ts` — `listSkills` (`:81`) and `cardReceipt` (`:125`) call it and emit `receipt`, `evalVersion: number | null`, `latestVersion: string | null` and `latestEvalState` on each `LsSkill`; §14.1's `ls-receipt.test.ts` rewrite is this function's test. `[modify] desktop/src/backend/tauri/index.ts` — the `cliLs` skill object mirrors the three new fields and `inventoryCard` maps them onto the card. `evalVersionLabel` (§8.2) is `[new]` in `desktop/src/components/domain/presentation.ts`, rendered by `SkillCard.tsx` in the `.skill-card-bottom` left group.

### 8.2 The version chip is mandatory

**The card must disclose that the eval is from an older version, on the card face.** Not hover-only.

This is not a nicety. Install hands the user the **latest** version; a card showing v3's score next to a v5 install button is a claim about bytes the user will not receive. The ratified display rule (`.planning/decisions/2026-09-08-eval-engine-s12-display-rule-draft.md` §12) is *"render nothing when there is no receipt; never a synthesized number"* — this requirement deliberately reverses it, and the version label is the only thing that keeps the reversal honest. Hover fails in a screenshot, in a scan of the grid, and on touch.

`evalVersionLabel(card)` returns `null` at parity, `` `from Version 3 · latest Version 5` `` when stale, `` `from Version 3 · Version 5 unreadable` `` when `latestEvalState === 'invalid'`. It renders as a real text node in the card's bottom-left group, whose width already varies — so no card geometry moves and the fixed 148px height is untouched. That group is `min-width:0; overflow:hidden` with `flex-shrink:0` chips (`SkillCard.css`), so give the label `white-space:nowrap; text-overflow:ellipsis` — it is clipped on a narrow card, never wrapped.

### 8.3 The stale-copy line (D4)

`installedVersion: string | null` on the marketplace card (L-DECL, §3.6). When non-null and behind `latestVersion`, the card reads `Version 4 · you have Version 2` with a **Reinstall** action. When equal, `Version 4 · installed`. The Library carries none of this.

### 8.4 Read cost

Deleting the local join also deletes the marketplace's per-member fan-out. `catalog()` today spawns `status` + `ls --local` + N × `ls member`; after this it is `status` + `ls --team <team>`, two processes regardless of team size. **That rests on a `people[]` limb `LsResult` does not have today** — `src/commands/ls.ts:49` declares `{ local?, roster, skills, problems, projects?, member? }`, and `roster` carries only `{handle, active, role, projects}`. It must be built:

- `[modify] src/commands/ls.ts` — `LsSkill.latest` becomes the `v<N>` folder of the highest `skillVersions` entry (never `shortHash`), `LsSkill` gains `versionCount: number`, and `unresolved` is deleted from the row, from `format` (`:157`) and from `cliLsSkill` (`desktop/src/backend/tauri/index.ts:65`), whose `inventoryCard` today reads it for the `broken` flag (`:207`) — a name with no version folder no longer reaches `ls` at all (§4.1). `endorsement` stays (§12 keeps `skillEndorsement`). `LsResult` gains `people: { handle; display_name; role; projects; installed: {id,version,scope,since}[]; profile: {id,name,version,added,via}[]; local_skills }[]`, emitted on the `kind:'all'` team read and built from the `people` array `listSkills` already reads at `:65`. `member?` stays for the single-member view. This is what replaces the fan-out; without it §14.1's two-children gate is unreachable and `profile[]` is a write-only field.
- `[modify] desktop/src/backend/tauri/index.ts` — extend the `cliLs` zod object with the matching `people` array (`.passthrough()`, per convention); delete `readMember` and the `mapWithConcurrency` fan-out at `:766-796`; rebuild `rosterModel`, `installedBy` and `adoption` from the new limb.

`ls --team` throughout this section is the repo's shorthand for `['ls','--team',<team>]`, not a bare `ls`: `selectTeam` (`src/lib/config.ts:25-29`) throws when `--team` is absent and more than one team is configured, so the adapter names the team deliberately.

`listVersions` + `selectCardEval` are two readdirs per skill in place of one `git ls-tree` spawn. On local disk that is a win; the skill fan-out goes through `mapWithConcurrency(…, 8, …)` and the read stays behind the adapter's 60s `READ_CACHE_TTL_MS`. (The adapter's own catalog fan-out uses concurrency 4, deliberately; it is being deleted here either way.)

### 8.5 The reader for `profile[]`

The marketplace person page (`#/marketplace/people/<handle>`, `MarketplaceScreen.tsx:95`) renders two buckets, and the copy must distinguish them: **On their profile** (`profile[]` — what they chose to stand behind, with the version) and **Installed** (`installed[]` — what is on their machines). Without this, §9.3 builds a curated list nothing ever shows.

### 8.6 The skill detail page

- `[modify] desktop/src/screens/skill/SkillScreen.tsx:28` — the GitHub link becomes `${repoUrl}/tree/main/skills/${name}/${versionFolder}`: a version is now a **path segment**, never a ref, and `main` is the only branch after §4.1's push collapse. It no longer interpolates a tree hash.
- `[modify] desktop/src/backend/tauri/index.ts` — `detailVersionFields` drops the `@<version>` suffix from `shareCommand`, since §9.1 refuses a versioned ref.
- `[modify]` the three remaining `backend.connect` call sites on this screen (§12 deletes the verb) and the `dialogCopy` for `publish`, which still describes a pull request.

---

## 9. Milestone M6 — install, onboarding, and the profile prompts

### 9.1 Install

`[rewrite] src/commands/install.ts` — source becomes `<clone>/skills/<name>/v<max>/`, copied whole. No `resolveVersion`, no `materializeVersion`, no cache: the version folder is already an immutable checkout inside the clone.

- **Always ask where.** The destination picker offers Global (`~/.claude/skills`) and every `config.projects` entry. Move `if (!roots.length) return { kind: 'global' }` (`:255`) below the interactivity guard — `if (!interactive) { if (!roots.length) return { kind: 'global' }; throw new Error('Pass --into global or --into <project root>'); }` — so an interactive install always asks (with no projects registered the picker offers Global alone), while a headless install with no `--into` and no registered projects still lands in Global: that line is also the headless default, and deleting it would make every `terum-skills install <ref>` from a hook or CI throw right after `setup`.
- `@version` in a ref is **refused**: *"Installing a previous version is not supported yet; install installs the latest version."* (The refactor defers previous versions.)
- `--into <untracked path>` refuses and names `project add` (§7.2).
- Writes `config.placements[<path>] = { id, team, version: 'v4', scope, placed_at, fingerprint }` where `fingerprint` is still `snapshotSkillDirectory` (§3.3).
- Writes `installed[]` automatically (D5). Then **offers the profile**: `Add <name> to your profile?`, default no.
- **`uninstall` is the inverse of the automatic half only.** It removes the `installed[]` entry for the last scope removed, exactly as today (`uninstall.ts:140-141`), and **leaves `profile[]` untouched** — a profile entry is a curated statement about a skill, not a claim that a copy is on this machine (D5); only `profile --remove` empties it, and the uninstall notice says so. Its `declining` computation (`uninstall.ts:143`) is deleted with `declined[]` (§3.5).
- **Seeds the local eval store (D11).** Copy every committed receipt for the version being placed — `evals/<uuid>/v<N>/*.json` in the clone — to `~/.terum/skills/evals/local/<digest>/<runId>/receipt.json`, where `<digest>` is that version's `content_digest`. No transformation: the receipt already carries `version: 'v<N>'` and `provenance.runner_handle`. This is a file copy of data already in the clone; it moves no bytes between machine and team.
- `InstalledResult` gains `path`, `version`, `profiled`.

#### 9.1.1 The replace rule (D12) — one behaviour, not three

Today install branches three ways on what is already at the destination: `foreign` refuses unless `--force`; `ours` + drifted quarantines your edits; `absent` places cleanly. That split is about **Terum's bookkeeping, not the user's files** — `config.placements` is `{}` on a real machine, so every one of its 88 skills is "foreign." Under a Finder-mirror Library the distinction means nothing.

**One rule replaces all three.** Something is already at the destination → move it to `<root>/.claude/old-skills/<name>`, place the new copy, say so:

```
You already have a skill named deploy-check.
Your copy is kept at ~/.claude/old-skills/deploy-check.
Replace it with Version 4?  [y/N]
```

- **`old-skills` is a sibling of the `skills/` root that was targeted** — never the home directory for a project install. A project install's kept copy is `<project>/.claude/old-skills/<name>`.
- **It is hidden from both scanners by construction, not by a filter.** Claude Code scans `.claude/skills/*`, so a sibling directory is never a skill; `localSkillRoots` resolves only `<x>/.claude/skills` (`AGENT_PATHS`), so the Library never sees it. **No hiding code exists that could forget to run.** This is why it beats a `deploy-check.old` sibling, which would leave two folders declaring `name: deploy-check` inside a skills root.
- **For a project root, add `.claude/old-skills/` to `.git/info/exclude`** via the existing `appendExclude()` (`placer.ts:194`), which already does exactly this for `.claude/skills/<name>`. Local-only, never committed — otherwise a replaced skill shows up as untracked in a repo that has nothing to do with Terum.
- **Deleted from `install.ts:131-141`:** the `collision.kind === 'foreign'` refusal, the `--force` flag, the `collision.kind === 'ours' && entry` branch and its `quarantineDrift` call. `inspect()` (`placer.ts:29`) loses its `owned` parameter. `place()`'s `replace` option is always false now — the destination is always empty by the time it runs.
- `quarantineDrift` and `moveToQuarantine` **survive** in `placer.ts` for `placer.remove()` and `uninstall`; only install stops calling them, and `prune` still owns the quarantine directory.
- **Two sub-forks deliberately left open** (declared in the ledger's `deferred:`): replacing the same skill twice overwrites the previous kept copy — a timestamp suffix was raised, not decided; and nothing ever empties `old-skills/`, with the Library deliberately not showing it, so Finder is the only cleanup route.

**The destination picker is lifted from closed PR #167**, not rewritten — `install-destinations.ts` and its test are exactly this builder. They stay retrievable from the intact branch:

```
git show origin/feat/bulk-install-destination:desktop/src/screens/marketplace/install-destinations.ts
git show origin/feat/bulk-install-destination:desktop/src/screens/marketplace/install-destinations.test.ts
```

### 9.2 Onboarding gains an "Add your projects" step

`[modify] src/commands/setup.ts` — **rename the `discover` step to `projects` in its existing ordinal slot; every other step keeps its position.** The full list is thirteen steps, not eleven: `welcome, app, role, github, team, actions, invite, projects, evals, community, hook, wrapper, done`. **`hook` and `wrapper` are untouched** — `setup.ts:436` (`section('hook'); verbs.offerHook(…)`) and `:445` (`section('wrapper'); verbs.offerWrapper(…)`) are both live, `wrapper` is what places the bundled `/terum-skills` skill §11.1 rewrites, and §12 keeps `--hook` alive as a shim. Truncating either declaration is a loud typecheck failure (`SETUP_STEP_TO_BOARD` closes `satisfies Record<SetupStep, string>`); the hazard is repairing it by deleting the two sections instead of restoring the two entries.

**The step asks for one project with a folder picker (D13)** — not a scan-and-checklist. It is skippable, and adds nothing unless the user chooses a folder:

```
Add a project?
  Terum will track the skills in that project's .claude folder.
  [ Choose folder… ]   [ Skip ]
```

Rev 2 assumed a candidate checklist, which needs a multi-select the `Prompter` does not have — every question it can ask is a confirm, a text answer or a single choice. Adding a `kind: 'multi'` ask frame plus its terminal renderer, its desktop renderer and a protocol doc, for one first-run screen, would also build a **second** way to add a project alongside the Library's own affordance — which root `CLAUDE.md` forbids. The second and third project are added from the Library.

`src/lib/prompt.ts` `AskOptions` gains `path?: boolean` — "the answer is a filesystem path; a shell may offer a folder chooser, a terminal ignores it". `src/lib/frames.ts` `AskKind` gains `'path'`; `docs/frame-protocol.md` documents it; `desktop/src/components/domain/WorkflowControls.tsx` renders the text input plus a **Choose folder…** button that calls `backend.pickFolder()`. **No other ask kind is added** — D13 makes `'path'` sufficient, which is the point of choosing a folder picker over a candidate checklist.

**Every test and fixture pinning the current step order must move in the same commit**: `desktop/src/backend/setup-session.ts` (`SETUP_STEP_TO_BOARD` — a key **rename** `discover:'Done'` → `projects:'Done'`, not a rewrite), `desktop/src/screens/onboarding/SetupBoot.tsx`, `desktop/src/backend/types.ts` (`SETUP_STEP_KEYS`, all thirteen entries), `src/commands/__tests__/setup.test.ts`. `desktop/src/fixtures/design.json` is generated by `desktop/tools/export-design.py` and byte-checked by `npm run export:check` — it cannot be hand-edited; record the deviation in `desktop/FIDELITY.md` instead.

### 9.3 Adding to a profile

`[new] src/lib/profile-entry.ts` — the one mutation path for `profile[]`. `offerProfileEntry(io, {id,name,version,via})` prompts and writes; `addProfileEntry` / `removeProfileEntry` are the mechanics. Called from publish (§5.2), install (§9.1), and `profile --add/--remove`. The file also exports `writePersonFile(tree, handle, mutate)` — the one read-parse-`personSchema`-validate-`tree.set` helper for `people/<handle>.json`, lifted from `profile.ts:19-34`; `install.ts:152-159` and `uninstall.ts:197-210` switch to it in the same change, so no hand-rolled copy survives.

`profile --add <ref>` resolves the ref through `findSkill` **before** the safeWrite and refuses an unknown ref — a profile may only contain marketplace skills.

---

## 10. Milestone M7 — sync collapses

**Done means:** `sync` fetches and resets each team clone. It touches nothing on the machine.

`[modify] src/commands/refresh.ts` becomes the whole of sync. `[delete] src/commands/sync.ts` — all 802 lines.

New `sync` description: *"Fetch each team clone and reset it to origin/main. Nothing on this machine is changed: no placement, no upload, no edit to your skills."* The one exception is Terum's own `/terum-skills` manual, refreshed by `sync --hook` with a printed line (§11.1, D17).

### 10.1 Everything sync does today that goes

| Behaviour | Disposition |
| --- | --- |
| Auto-share pass (`:294-320`), `autoShareRoots`, the `auto_share` gate | **Delete.** This is the single biggest violation of "never published unless you explicitly do so". |
| `reconcileShared` (`:364`) and the `config.shared` ledger | **Delete** — but read §11.3 first. |
| Automatic placement of endorsed skills | **Delete.** Install is the only thing that places bytes. |
| Placement drift scan + `quarantineDrift` loop (`:463`) | **Delete from sync.** The signal survives as the Library card's `edited` flag (§7.4, D12); the automatic move does not survive anywhere — install's replace rule (§9.1.1) supersedes it. |
| Library-size pass (`:321-362`) writing `local_skills` | **Delete from sync**; written opportunistically instead (§3.5). |
| Orphan adopt/decline people writes (`:653-677`) | **Delete.** |
| `prune` / `underQuarantine` (`:783-802`) | **Move** to a new `src/commands/prune.ts` verb, verbatim. |
| `approved()` (`:626-628`, plus its two call sites at `:281` and `:425`) | **Move** to `install.ts` — it is only about tool-grant consent. |

`~/.terum/skills/run/<team>.stamp` changes meaning from *"this team is fully synced"* to *"this clone was last fetched at `at`, leaving it at `head`"*, and is written unconditionally on every successful pull.

### 10.2 The desktop side

`[modify] desktop/src/backend/tauri/index.ts` — **the `sync` seam is rewritten under the app and must be named.** `sync` becomes `run(['sync', ...(args.team ? ['--team', args.team] : [])], cliSync, …)`. `SyncArgs` loses `auto`, `freshMs` and `prune`; `SyncResult` loses `placed` and `deferred` and keeps `{ changed, teams[], notices }`. `--prune` moves to a new `backend.prune()` seam, and the Prune button and its hint in Settings move with it. `features.autoSync` retires from `FEATURE_KEYS` (`desktop/src/backend/types.ts:12`) and every `hello.features.autoSync` branch collapses to the `refresh` path.
`desktop/src/screens/share/ShareScreen.tsx:45`'s **Sync now** recovery (via `useSyncAction`) keeps working — a fetch is exactly what a stale roster needs — but its copy must describe a fetch, never placement. No other screen directory changes under this section.
`[delete] desktop/src/backend/tauri/auto-sync.ts` — move `createWorkflowGate` (`:57-68`) verbatim into `refresh.ts` first; it is not auto-sync machinery.
`[rewrite] desktop/src/app/invalidation.ts` — add a `'marketplace'` `ChangeSource`. A refresh invalidates `['catalog','skill']` and **nothing library-side**. Both the sync and library areas independently proposed a new `ChangeSource` while removing `library` from `clone`; there must be exactly one answer, and this is it. Note `ChangeSource` is declared in `desktop/src/backend/types.ts`, not in `invalidation.ts` — add the member there, and re-point the emit sites that today emit `'clone'` for a refresh.

---

## 11. Surfaces the requirement traces missed

Each of these is named by no trace and will break silently.

### 11.1 The bundled `/terum-skills` Claude Code skill

`.claude/skills/terum-skills/SKILL.md` is copied by `scripts/bundle-skill.mjs` into `dist/claude/skills/`, ships in the npm package, and is placed into **every user's `~/.claude/skills/`** by `setup`. It is an operator manual instructing a Claude Code session how to drive the CLI, and it documents `connect`, `checkout add|remove|list`, `sync --prune`, and *"publish — confirm with the user: this opens a pull request (policy `pr`)"*.

`[rewrite]` it end to end: no `connect`; `project …` not `checkout …`; `prune` not `sync --prune`; sync described as a fetch; publish described as version-minting with no PR. **Its frontmatter `description` is the match key Claude Code selects on, so it must change too.** Add it to the `invocation-catalog.ts` tripwire coverage.

**Reaching machines that already hold the old copy (D17).** `setup`'s `wrapper` step is the only refresh path today, and `src/lib/wrapper.ts:82-108` already reports a `managed` copy as `outdated` and replaces it in place — the primitive exists, only the trigger is missing. `sync --hook` (the session-start entry) refreshes the managed copy when `wrapperState()` is `outdated`, never touches a `foreign` copy, and prints one line: *Updated your /terum-skills manual for this CLI.* This is the one carve-out from §10's "nothing on this machine is changed": the manual is Terum's own file, shipped in the package the hook already upgrades, never team content.

### 11.2 Settings ▸ Sharing

`desktop/src/screens/settings/SettingsContent.tsx` case `'sharing'` is an entire section built on `connect` + `config.shared`: the connected-source table with `In sync` / `Local edit` / `Diverged` states and `Keep mine` / `Keep the team's` buttons, four "Rules" rows, a `connect` TerminalHint, and — live — **a one-click `backend.connect` Share button that uploads a local skill to the team**.

`[delete]` the whole case. Replace with a Publishing group describing version-minting publish. Update `SettingsDialogs.tsx:27` (drop "connected skill records") and the Local-state paragraph at `SettingsContent.tsx:104` (drop "every connected skill's baseline is lost"). The nav row lives in a third file: `desktop/src/screens/settings/settings-data.ts:5` — `['sharing','Sharing','upload']` becomes `['publishing','Publishing','upload']` (route `#/settings/publishing`, `case 'publishing'`), and `settings.test.tsx:21`'s `it.each` section list moves in the same commit. The `'sync'` pane's copy is re-described as fetch-only per §10.

### 11.3 `leave.ts` and `uninstallMachine.ts` read `config.shared`

Both read the field §10.1 deletes, and `leave.ts` uses it as a **protection list**: `teardownTeam` (`:60-83`) skips deleting any placement whose path is, contains, or is inside a connected authoring source (`src/commands/leave.ts:77-80`) — so the user's own authoring folders survive a team teardown. The containing case needs no replacement: a placement that has grown a folder inside it no longer matches its recorded fingerprint (`snapshotSkillDirectory` walks the whole tree), so the rule below quarantines it rather than deleting it.

Deleting `config.shared` deletes that guard. **Replacement rule, locked:** `teardownTeam` deletes only paths present in `config.placements`, **and only after `placer.remove()` confirms the recorded `fingerprint` still matches** — `placer.remove()` checks `isSkillsRoot(root)` and `dirname(destination) === root`, and the *fingerprint* comparison happens inside `quarantineDrift`, which moves a drifted folder to quarantine rather than deleting it. Saying "only paths in `config.placements`" on its own turns `team leave` into a hard delete of a folder the old `config.shared` list protected: a skill the user authored, connected, and then had placed back at the same path would be removed outright. The rule is placement-membership **plus** the existing never-delete-a-drifted-folder behaviour, and a folder that drifted is quarantined, never removed. Under a Finder-mirror Library every local folder is potentially an authoring source, which is why the drift half cannot be dropped.

`uninstallMachine.ts` drops `shared` from its inventory text, its `protectedSources` computation, and the `store.remove` predicate at `:135`. `config.shared` has readers beyond these two — `canonicalLedger` (`src/lib/local-skills.ts`), `ls --local`'s state column, `emptyConfig`, and the `status` DTO the desktop renders. **Grep `config.shared` and `\.shared` across `src/` and `desktop/src/` and clear every hit in the same change**; the deletion list in §12 names the field, not its readers.

### 11.4 The card ⋯ menu

`cardActions` (`desktop/src/components/domain/skill-card-actions.ts:20-25`) unconditionally pushes `moveAction`, `placeAction`, `publishAction`, and offers **Run eval** gated on the `runEvalInApp` feature flag only — not on whether the skill is on this machine. Keep the flag gate; add the path gate below as a disabled row with a reason, not a hidden one (the file's fixed-menu-shape convention).

- **Uninstall and Move** must not fall out of both surfaces. Locked: the marketplace card carries `installedVersion` (L-DECL), so `placeAction` renders `Uninstall…` there; the Library card carries the D6 file actions instead.
- **Move** (D18): `moveAction` is offered on Library cards only and routes to `skill move` (§7.5); it is removed from marketplace cards, together with the detail page's `moveTo()` and `dialog=move`.
- **Run eval** gates on `skill.path`: `reason = skill.path ? null : 'Install it first — evals run against the copy on your machine.'` Same gate on the detail page's Evals-tab button and the `EvalsEmpty` primary (`SkillScreen.tsx:135`).
- `publishAction` loses all three `teamState` branches: enabled for any card with a local folder, otherwise *"This skill is not on this machine, so there is nothing to publish."*
- Update `skill-card-actions.test.ts`'s menu-shape assertions in the same change.

### 11.5 Five more

- **`src/commands/status.ts:26, :113`** types and populates `policy.publish`, which §4.1 deletes from the schema — a type error and a verb advertising a policy the product no longer has. `status` also feeds the desktop's Settings.
- **`cliSearch` / `SearchHit`** (`desktop/src/backend/tauri/index.ts:57`, `types.ts:99`) require `latest` and `unresolved`, both changed or deleted. Mitigating: `backend.search` has no production caller and `#/search` is a 3-line "Search is coming" placeholder — so update the two declarations and `run.test.ts:316`, and **budget no search-screen rewrite**.
- **The Inbox's `update` and `review` item kinds** encode exactly the two mechanisms this refactor deletes (update-available, PR review). `desktop/src/screens/inbox/` needs a ruling: with `surfaces.inbox` false the route already redirects, so the cheapest correct answer is to delete both kinds and let the surface stay dark.
- **`policy.publish` is deleted on the CLI side only.** The desktop mirrors it in a **non-passthrough** zod object, so a CLI that stops emitting it fails the whole `status` parse and the app loses Settings, not just one row. Delete it from `status.ts:26`/`:113`, from `teamSchema`, **and** from the desktop's `status` zod mirror and its three projections in `tauri/index.ts`, in one change.
- **`decline` is deleted on the CLI side only** in §12's list. Six desktop declarations survive it — `Backend.decline` (`Backend.ts:36`), `cliDecline` and its adapter (`tauri/index.ts:43, :851`), the mock service (`mock/index.ts:192`), the Inbox's Decline branch (`InboxScreen.tsx:66`, resolved by the Inbox ruling above) and the fixtures/mock data — and two CLI-side ones §12's `CliVerbs.decline` does not cover: the `'decline'` entry in `FRAME_VERBS` (`src/lib/frames.ts:36`) and the commander registration (`src/cli.ts:193`). Delete all of them with the verb.

### 11.6 The marketplace Add-skills dialog

`desktop/src/screens/marketplace/AddSkillsDialog.tsx` is the **second** one-click upload path: it calls `backend.connect` at `:72`, and its whole row model (`endorse`/`share`) and copy (`:83`, `:105`) describe endorsement, pull-request policy and sync-time placement — three mechanisms this refactor removes. `[delete]` the dialog, its `add-skills` route, and the button at `MarketplaceScreen.tsx:95`. Adding a skill to a project is now `publish --project`, from the Library. (PR #173 rewrites this exact file; §16.)

---

## 12. Deleted in full

`connect` (the whole verb and `src/commands/connect.ts`, 597 lines — moving `injectManagedFields`'s use into publish first) · `autoShareRoots` · `reconcileShared` · `config.shared` **and every reader of it** (§11.3) · `config.auto_share` · `decline` (verb + `src/commands/decline.ts` + `CliVerbs.decline` + its six desktop declarations) · `eval --commit` and the `eval`/`eval-assets` guard actions · the `evalCommitChoice` capability and the "Commit the receipt to the team" checkbox · `policy.publish` **and its desktop zod mirror** (§11.5) · `team.json.global` · PR creation in publish (`gh pr create`, the `publish/*` branch, `openEndorsements`, `SafeWriteOptions.branch`, the non-main `push()` body) · `receiptCheck.ts` (moving `receiptFiles`/`newestReceiptAt` into `src/lib/evals/receipt-store.ts` first) · `src/commands/sync.ts` · `desktop/src/backend/tauri/auto-sync.ts` · `writableCheckout` · `src/lib/discover.ts` in full and every consumer (§7.1, D13) · `librarySize`'s sync call site · the marketplace's `ls --local` read and per-member fan-out · Settings ▸ Sharing · `AddSkillsDialog.tsx` (§11.6) · `resolveVersion` and `materializeVersion` (§4.1, §6.5).

**Three entries need their callers named, or the build breaks:**

- **`endorsedCandidates`** (`src/lib/skills.ts:60`) — deleted, **and with it `team join`'s post-join endorsement offer** (`src/commands/team.ts:362-372`), whose only source of candidates it is. A join no longer installs anything; the member browses the Marketplace. This is the flow §10.1's "install is the only thing that places bytes" was written about, but §10.1 is scoped to sync and never named it.
- **`skillEndorsement`** (`src/lib/readme.ts:60`) — **not deleted. Simplified in place** (§4.1): it drops the `team.global` branch and returns the project list. Its three callers (`readme.ts`, `ls.ts:14/:203`, `search.ts:10`) keep working.
- **`skillTrees` and `latestTree`** — deleted, **replaced by `listVersions`**, with their three non-`skillVersions` call sites moved in the same change: `teamRepo.ts:210` (the `latestBySkill` map for `regenerateReadmeInTree`, now name → `v<N>` derived from `tree.paths('skills/')`), `readme.ts:157`/`:185`, and `search.ts:52`.

**`--hook` and `receipt-check` cannot simply vanish.** They are invoked via `npx …@latest` from machines and committed team-repo workflows this release does not control. Keep the verb names registered as no-op-with-notice shims for one major, even though their bodies go.

---

## 13. Migration (D3)

One verb, one target shape, one version number. `terum-skills team migrate`, guard action `'migrate'`.

**Steps, in one commit per team repo:**

1. For each `skills/<name>/`: move **all** of its current contents to `skills/<name>/v1/`, `evals/**` included (D9) — a repo migrated before this ruling would strand its cases outside every version.
2. Fold `team.json.global[]` into `projects.Global.skills[]`; create `projects.Global` if absent; delete `global`; delete `policy.publish`; set `layout_version: 3`. Parse the pre-image with `anyLayoutTeamSchema` (§4.1) — the strict layout-3 schema rejects its own input. **Check for an existing project whose name case-insensitively equals `Global`** before creating one: `projectNameSchema` does not reserve the name today, so a team may already have `global` or `GLOBAL`, and blind creation either collides or silently orphans that project's skills. If one exists, adopt it and normalize the key to `Global`.
3. Re-key eval receipts: the receipts under the tree hash that `HEAD:skills/<name>` resolved to at migration time move to `evals/<uuid>/v1/`, with their `version` field rewritten to `'v1'` and a new `version_tree: '<40-hex>'` field preserving the original so a re-keyed receipt still provably describes specific bytes. **Every other receipt moves verbatim to `evals/<uuid>/archive/<40-hex>/<runId>.json`** (D7).
4. Re-arm the clone's pre-push guard (§4.3).
5. Rewrite each `people/<handle>.json`'s `installed[].version`: a 40-hex value becomes `'v1'` when it equals the tree hash step 3 re-keyed, and `null` otherwise ("installed before versioning"). §3.4's read-time preprocess protects *local* config; **the people files are committed team state and no preprocess touches them**, so without this step the first layout-3 CLI to read the repo fails `personSchema` on every member.

**No case rename is needed** (D1), so this runs cleanly through `safeWrite`.

**`config.pending` is stranded by §10.** Today sync replays and clears it; §10.1 deletes sync's replay. `install` and `uninstall` must self-drain their own matching rows (filter out a pre-existing row before writing a new one), or a crashed install leaves a row nothing can ever clear and `status` keeps advising a sync that no longer does anything. A row for a skill that is never retried still has no clearer, so `uninstall --machine` must drop each team's `pending` rows as it tears that team down — today its `store.remove` predicate at `uninstallMachine.ts:135` requires `pending.length === 0` and otherwise answers `Kept … pending: N. Re-run uninstall`, which with sync's replay gone is a loop the user cannot leave.

### 13.1 The two migration hazards that must be closed first

**(a) The committed GitHub Action is un-updatable.** Every team repo runs `.github/workflows/terum-skills.yml`, which pins `npx -y terum-skills@latest` four times across four jobs; only the `readme` job runs with `contents: write` (`src/commands/team.ts:594-595`) and it is the one that commits and pushes — the other three run `contents: read`. No guard row admits `.github/**`, so the product can never update it through `safeWrite`. The moment a layout-3 CLI hits npm, every un-migrated team's next push runs `readme` from the new CLI against a layout-2 repo — and if `readReadmeData` is rewritten over `skillRecords` (whose ENOENT handler returns `[]`), the job emits *"No shared skills yet"*, commits it, and pushes, deleting the repo's whole catalogue from its README.

Before publishing any layout-3 CLI: make the layout-3 `readme` verb **refuse loudly and exit non-zero on a layout-2 repo**, and add the never-blank invariant. **Put that invariant in `applyReadme` (`readme.ts:116`), not `generateReadme` (`:74`)** — `generateReadme` never receives the existing README, so it cannot tell a first generation from a catalogue wipe; `applyReadme` is the only function holding both sides. It refuses to replace a non-empty catalogue block with `No shared skills yet.` and leaves the block untouched.

**The same hazard fires locally, not only through the Action.** `safeWrite` regenerates the README in-process for every **non-GitHub** remote (`teamRepo.ts:206`, `if (!isGitHubRemote(remote) && options.action !== 'eval')`), and `'migrate'` is not excluded — so on a GitLab, Bitbucket or self-hosted team the migration commit itself would carry the blanked catalogue. §4.1's `readme.ts` rewrite and this invariant are both prerequisites of §13, not follow-ups. Treat the committed Action as migration debt and say so in the release notes.

**(b) An un-upgraded teammate fails closed on a migrated repo — keep it that way.** Traced at `d09d278`: the session-start hook fires sync → auto-share → `autoShareRoots` calls `skillRecords`, which finds `skills/` present but no `skills/<name>/SKILL.md` (it is under `v1/`), so every skill lands in the per-skill catch (`src/lib/skills.ts:39-41`) and the known-id set is empty → every local skill looks unknown → `connectOne` mints an id (`connect.ts:222`) and then parses the clone's `team.json` with `teamSchema` (`:223`), whose `layout_version: z.literal(2)` rejects a layout-3 file — twenty lines **before** the local `SKILL.md` write at `:243`. The candidate is reported as skipped; nothing local is rewritten and no skill bytes are pushed. The other sync passes fail closed the same way: the placement loop hits `Blocked …: its skill is no longer in the repository` (`sync.ts:421`) and never quarantines, `reconcileShared` defers on a missing repository copy, and every non-GitHub write regenerates the README through the same `teamSchema` parse. The one old-CLI write that can still land is a people-file row-b write (library-size count, orphan adopt) on a GitHub remote, and only for a member whose migrated `installed[]` holds no `'v1'` (the old `installedSchema` rejects it); its 40-hex `version` is exactly what §3.4's preprocess reads as null. No skill bytes, no `team.json`.

**The ordering constraint stands as prudence, not as the fix for an open hole:** the auto-share removal ships and propagates before any repo is migrated, so the fail-closed path above is never exercised at scale and no teammate's session start turns into a wall of skipped-auto-share notices. **The invariant that protects the old CLI is the literal:** `layout_version` must stay a value an older CLI cannot parse — a layout-3 `team.json` must never be readable as a layout-2 one. Do **not** build a "skills root absent vs. empty team" distinction in `skillRecords` as the mitigation — on a migrated repo the root is present, so that branch never runs; §4.1's `skills/<name> holds no v<N> folder.` `onProblem` is the useful signal and already lets a caller tell "every skill unreadable" from "no skills". Keep the layout precondition that refuses every write verb by name when the CLI's expected layout does not match `team.json.layout_version` — it guards the opposite direction, a layout-3 CLI on an un-migrated repo.

---

## 14. Gates

Run all of these; do not trust a self-report (root `CLAUDE.md`).

```
npm --prefix <wt> run lint
npm --prefix <wt> run typecheck
npm --prefix <wt> run test
npm --prefix <wt>/desktop run lint && typecheck && test        # needs a REAL node_modules
npm --prefix <wt>/desktop run test:e2e                          # Playwright + fidelity boards
```

- **`desktop/` needs its own `npm ci`.** A borrowed or symlinked `desktop/node_modules` breaks the e2e fonts *and* the real-adapter vitest suites, in a way that mimics a genuine regression.
- On Node 25, vitest needs `--no-experimental-webstorage` or ~731 desktop tests fail spuriously.
- **`desktop-ci` is path-filtered to `desktop/**`**, so a CLI-only change that breaks the app passes CI green. Run the desktop suite locally for any change to a shape the desktop mirrors — which is most of §3.
- **`desktop/e2e/fidelity/__tests__/boards.test.ts` hard-codes `expect(BOARDS).toHaveLength(91)`** and asserts set-equality with `desktop/FIDELITY.md`, and it runs in ordinary CI without the design canvas. Any board added (the stale-eval marketplace board, the projects onboarding step) must land in both files in one commit, marked `in-progress` until the canvas is re-rendered on Ryan's Mac — the fidelity oracle is a macOS raster and Linux shots fail by ~3,700 anti-aliasing pixels.

### 14.1 Tests that must exist

- `src/lib/__tests__/versions.test.ts` — `['v2','v10','v9']` → `[10,9,2]`; rejects `v0`, `v03`, `V3`, `v1.0`, and a *file* named `v4`; `[]` for a missing directory. **The two-digit case is the point**, and it runs against both `listVersions` and `versionsInTree`.
- `src/lib/__tests__/skills.test.ts` — a literal-hex pin on `skillContentDigest` for a fixed fixture (§3.3); `.DS_Store` does not change the digest; **editing `evals/cases/*.yaml` DOES** (D9); a managed-field-only frontmatter change does not change it.
- `src/commands/__tests__/publish.test.ts` — republish of an unchanged folder returns `created:false, identicalTo:'v2'` with the verbatim message; republish after an eval attaches the receipt under `v2` and mints nothing; a changed byte mints `v3`; a repo whose highest version is `v5` with `v3` deleted mints `v6`, not `v5`; **an edit to `evals/cases/*.yaml` alone mints a new version** (D9 — cases are content identity), and a republish with byte-identical cases does not; a first publish of a folder whose `SKILL.md` carries only `name` and `description` succeeds (hygiene runs on the injected map, §5.1 step 5). **The first of these is the gate on §5.1 step 7's prefix stripping** — get that wrong and it is the only test that fails, so it must exist before publish does.
- `src/lib/__tests__/guard.test.ts` — `skills/x/v3/SKILL.md` admitted as an add under `publish`; a *modification* of `skills/x/v3/SKILL.md` refused; `evals/<uuid>/v3/<run>.json` admitted; the old 40-hex receipt path refused; `v03` refused; a multi-path publish commit (version folder + team.json + receipt) admitted; `skills/x/v3/evals/cases/a.yaml` admitted under `publish` as an ordinary version byte, and `skills/x/evals/cases/a.yaml` (no version segment) **refused** — row h is gone; **row j** — a migrate diff carrying `team.json`, `skills/x/v1/SKILL.md` and `evals/<uuid>/archive/<40-hex>/<run>.json` is admitted, and the same paths under `publish` are refused; `guardRawPush` refuses `skills/x/v3/SKILL.md` with the publish-naming message (D15).
- `src/commands/__tests__/install.test.ts` — a destination holding an unrelated folder is moved to `<root>/.claude/old-skills/<name>` and the new version placed, with **no** `--force` and no quarantine call (D12); a project install's kept copy lands in `<project>/.claude/old-skills/`, not `$HOME`; `.claude/old-skills/` is added to `.git/info/exclude` for a project root; install seeds `~/.terum/skills/evals/local/<digest>/` from the clone's receipts for the placed version, preserving `runner_handle` (D11).
- `src/lib/__tests__/teamRepo.test.ts` — publish a skill containing a `0755` file, re-read from a fresh clone, assert `git ls-tree` reports `100755`; a mode-only change does not trip the staged-diff proof (D10, §4.5).
- `src/lib/__tests__/readme.test.ts` — `applyReadme` refuses to replace a non-empty catalogue block with `No shared skills yet.` and leaves the block untouched; the generated table's version column reads `Version 3`.
- `src/lib/__tests__/schema.test.ts` — an untouched pre-upgrade `config.json` with 40-hex versions parses and yields `null`s; a `preserveUnchanged` update afterwards does not throw.
- `src/commands/__tests__/ls-receipt.test.ts` (rewrite) — every branch of §8.1 including the invalid-newest-receipt descent.
- `desktop/src/backend/tauri/__tests__/index.test.ts` — `catalog()` spawns exactly **two** CLI children for a five-member team.
- A migration test on a seeded layout-2 repo asserting the exact layout-3 output, the archived receipts, and that an un-migrated repo read by a layout-3 CLI produces the upgrade sentence rather than a zod dump.

---

## 15. What still needs a human

**Nothing blocking.** All six open questions of rev 2 were walked to LOCK resolutions on 2026-09-11 — ledger: `.planning/decisions/2026-09-11-library-marketplace-refactor-decision-walk.md`. Q1→D9, Q2→D11, Q3→D12, Q4→D10, Q6→D13, and the §16 call→D14. Q5 (the unreachable team record) is unresolved but is a condition, not a fork.

Four things are consciously deferred rather than decided. They are declared in the ledger's `deferred:` frontmatter, which is what feeds `.planning/DEFERRED-INDEX.md`:

| Deferred | Revisit when |
| --- | --- |
| **Nothing in this spec was checked against the team's shared record.** The `terum` MCP refused auth for the whole session (HTTP 401, `No authorization provided`), so `check_decision` and `get_standing_decisions` never ran. Treat every ruling as unchecked, not as cleared — the 2026-09-10 auto-share walk recorded the same condition. | the endpoint accepts the configured header again; re-run `check_decision` over every LOCK |
| Replacing the same skill twice in one root overwrites the previous kept copy in `.claude/old-skills/` (D12). A timestamp suffix was raised and not decided. | anyone loses a backup by replacing the same skill twice |
| Nothing ever empties `.claude/old-skills/`, and the Library deliberately does not show it, so Finder is the only cleanup route (D12). Whether `prune` should cover it was not decided. | an `old-skills` folder is reported as large or confusing, or `prune` is next touched |
| `eval --generate` now writes cases into the user's local folder, which mints a new version on the next publish (D9). The churn was accepted but not measured. | anyone reports unexpected version churn after regenerating cases |

**From verification, closed in rev 4:** the 53 medium/low findings of the rev-2 adversarial pass were triaged against rev 3 on 2026-09-11 (`.planning/reviews/2026-09-11-refactor-spec-unadjudicated.md`) — 30 applied, 15 already present, 4 stale under D9/D13, 4 walked to D15–D18.

---

## 16. In-flight work this collides with

| | State | Collision |
| --- | --- | --- |
| **PR #173** `codex/batched-endorsement` (+450/−258) | **CLOSED 2026-09-11** (D14); branch intact | Built the endorsement subsystem §12 deletes. Every file it touched is rewritten or deleted by M2 / M5 / §11.6 — salvage: none. Closed rather than merged-then-reverted so `main` never carries a subsystem scheduled for deletion. |
| **PR #167** `feat/bulk-install-destination` (+250/−24) | **CLOSED 2026-09-11** (D14); branch intact, **picker lifted** | `install-destinations.ts` + its test are lifted into M6 (§9.1). Its blocking gate was a known-false dialog string owned by Teddy — moot, because D12 made that copy *more* wrong (the destination now also decides where a replaced copy is kept) and §9.1 rewrites the dialog anyway. Everything else it touched is rewritten by M5/M6. |
| `.planning/specs/2026-09-10-auto-share-batching.md` | locked | Obsoleted — auto-share is deleted. |
| `.planning/specs/2026-09-10-add-skills-batched-endorsement.md` | locked | Obsoleted — endorsement is replaced by publish. |
| `.planning/specs/2026-09-10-auto-category.md` | locked | Survives: `injectManagedFields` still injects `terum-category`, now from publish. |
| `.planning/decisions/2026-09-08-eval-engine-s12-display-rule-draft.md` | ratified | **Deliberately reversed** by §8.1's fallback. §8.2's mandatory chip is the mitigation. Record an override. |
| v0.14.0 | merged on main, **not tagged** | A release is mid-flight. Do not branch across the tag. |

### 16.1 Build order

M1 (§4) is the keystone — every other milestone reads or writes a version folder. Then, in order of dependency:

```
M1 versions + guard + write path + readme.ts
 ├─ L-PROJ config half ........ config.projects + its preprocess; land early, M2 and M4 both need it
 ├─ M2 publish ................ needs M1 (guard row a′), §3.3, and L-PROJ (it resolves a local ref)
 │   └─ M3 evals .............. needs M2 (publish resolves the digest to a version)
 ├─ M7 sync collapse .......... SAME COMMIT AS M2, or before it
 ├─ M5 marketplace ............ needs M1 (listVersions) + the ls.ts people[] limb — parallel with M2
 ├─ M4 library ................ needs L-PROJ and M1's SkillCard fields
 │   └─ M6 install/onboarding . needs M4 (project registry) and M5 (source path)
 └─ §13 migration ............. LAST, and only after the release containing M7 has PROPAGATED
```

**Two corrections to the obvious reading.** (1) **The auto-share deletion is M7's, not M2's** — §10.1 lists it. But `src/commands/sync.ts:23` imports `autoShareRoots` from the file M2 deletes, so **M2 and M7 must land in one commit, or M7 first**; M2 alone does not typecheck. (2) §13.1(b) requires the auto-share removal to *ship and propagate* before any repo is migrated. Shipping is not propagating: an un-upgraded teammate's auto-share fails closed on a layout-3 repo (`teamSchema`'s `z.literal(2)` refuses it before any local write), but until they upgrade every session start reports a skipped auto-share for every local skill. §13 waits on the **released** M7, not on a merged branch.

M1 also deletes four `GuardAction` members with five live call sites (`connect.ts:197`, `:251`, `eval.ts:220`, `:335`, `decline.ts:30`) whose own cleanups live in M2, M3 and §12 — so M1's guard edit and those deletions land together or the tree does not compile between milestones.
