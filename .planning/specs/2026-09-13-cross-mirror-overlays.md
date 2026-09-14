# SPEC — cross-mirror overlays (team evals in the Library, reconcile on join, a version on every card)

Baseline: `ryanliu-terum/terum-skills` @ **cc3a691** (`Merge pull request #192 … docs/readme-faq-tidy`), CLI `0.15.0`.
Every line number and quoted identifier below was read out of that commit. Where this spec disagrees with
the code at cc3a691, **the code wins** and the implementer reports the disagreement.

Governing decisions: `.planning/decisions/2026-09-13-cross-mirror-overlays-decision-walk.md` (commit `1c06efc`).
North Star: *each screen tells the truth about your copy versus the team's (installed, which version, how it
scored), proven by identical bytes, never a name; nothing moves between the two unless you ask, except eval
results, which reach the Library automatically through the background sync.*

Parent spec: `.planning/specs/2026-09-11-library-marketplace-refactor.md` (rev 3). §2 of this document
**supersedes** the named sections of the parent. The parent is not otherwise revised; its decision ledger and
milestones stand.

**Status: ready for review, NOT yet locked for `/codex-implement`.** Human gates in §11. The team-record check
(`check_decision`) has not run: the `terum` MCP refused auth in every session this spec descends from.

---

## 0. Summary

1. Two pure mirrors can both be wrong about one folder. A skill copied by hand, or pulled in with a project
   repo, whose bytes equal a published version shows "not installed" on the Marketplace and "not evaluated"
   in the Library, even when a teammate scored those exact bytes last night.
2. The join that fixes both already exists: the **content digest**. Receipts carry `content_digest`; the
   Library already digests every folder; version folders in the clone can be digested the same way. The
   digest is one implementation — `canonicalDigest(root)` reads a folder and delegates to
   `skillContentDigest(files)` (`src/lib/skills.ts:134-162`) — so the two sides cannot drift.
3. **M1 (display).** `ls --local` gains three read-only keys per row: `teamEval` (the newest committed
   receipt for these exact bytes), `matchedVersion` (the `v<K>` whose committed bytes equal the folder), and
   `knownToTeam` (the folder's uuid belongs to a team skill). The Library card shows the team's score with
   the runner named; every card in both screens carries one version line; the "Installed · on this machine"
   chip's words become that line and its check mark stays.
4. **M2 (reconcile).** A new `reconcile` verb compares the Library to the team once, on join and whenever a
   project is added: identical folders can be **adopted** (recorded as installed, nothing copied) and
   differing same-name folders can be **published** per row. Adopt is a mode of `install`; publish is
   `publish`. Nothing is written without a yes.
5. L-DECL becomes symmetric. Each mirror's catalogue still comes from its own source only. Each may carry
   overlays sourced from a provable identity (uuid for install state, content digest for evals and version
   match), named as overlays on the type, set after the catalogue is built, never a filter or sort input.
   The Library's "evaluated" count includes overlay evals (ledger D2).

---

## 1. Current behaviour at cc3a691

| Fact | Where |
| --- | --- |
| The Library scan digests every candidate folder and looks up `~/.terum/skills/evals/local/<digest>/` for the card's `localEval`; nothing reads the clone | `src/commands/ls.ts:261-330` `showLocal`, `evalOf` |
| `install` copies `<clone>/evals/<uuid>/<v>/` receipts into the local store keyed by `content_digest` at placement time (D11). A receipt committed **after** the install never reaches the local store | `src/commands/install.ts:157-171` |
| A schema-2 receipt requires `content_digest` (`sha256:<64 hex>`); schema-1 history has none | `src/lib/evals/receipt.ts:53-113` |
| The Marketplace card overlays `installed` (`placed`/`recorded`/`absent`) from `ls --local` rows by placement uuid or frontmatter uuid, then the status ledger, then the people file; `installedVersion` comes from the ledger only | `desktop/src/backend/tauri/index.ts:180-220` `onDisk`, `inventoryCard` |
| `marketplaceVersionLabel` returns "Version N · installed" or "Version N · you have Version M", and **null** for a skill the viewer has not installed (§8.3 named two states) | `desktop/src/components/domain/presentation.ts:35-42` |
| The Library builder fixes every team-derived field to a neutral value: `installedVersion:null, latestVersion:null, evalVersion:null, …` | `desktop/src/backend/tauri/index.ts:145-150` `localCard`; parent §7.4 |
| The chip `Installed · on this machine` renders only when `skill.onDiskOnly` — present on disk, not in the ledger — i.e. exactly the folders whose version is unknown today | `desktop/src/components/domain/SkillCard.tsx:17` (bottom row) |
| `.card-version-label` is `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`; the bottom row is `height:20px` with `overflow:hidden` on each side | `desktop/src/components/domain/SkillCard.css:1,4` |
| `publish` finds the team skill **by folder name**; the repository's uuid for that name wins over the local file; a declared uuid belonging to a different name mints a fresh uuid at v1; byte-identical to any version → attach receipts only (`identicalTo`), else `v<N+1>` | `src/commands/publish.ts:128-142, 196-221` |
| `setup` steps, in order: `welcome, app, role, github, team, invite, projects, evals, community, hook, wrapper, done`. The `projects` step is one folder picker (D13) at `:318-338`; `evals` follows at `:341` | `src/commands/setup.ts:74, 318-345`; desktop `SETUP_STEP_KEYS` `desktop/src/backend/types.ts:144`; `SETUP_STEP_TO_BOARD` `desktop/src/backend/setup-session.ts:7-10` |
| `project add` calls `addLibraryProject` and returns `{ path, label, added }` | `src/commands/project.ts:22-25` |
| Ask kinds over frames: `confirm`, `text`, `select`, `path`. `confirm` carries no default | `src/lib/frames.ts:16-21`; `src/lib/prompt.ts:30-44` |
| `SERVE_READ_VERBS = ['status','ls','eval-report','search','validate','update']`; `serve` gates on `argv[0]` | `src/lib/serve-verbs.ts` |
| `sync` writes `run/<team>.stamp` with the fetched head after every successful refresh | `src/commands/refresh.ts`; `src/lib/hook.ts:157-181` |
| Version vocabulary: `VERSION_FOLDER = /^v[1-9][0-9]*$/`, `versionLabel(n) = "Version N"`, numeric sort | `src/lib/versions.ts` |

---

## 2. Amendments to the parent spec

Each block below replaces the named text in `2026-09-11-library-marketplace-refactor.md`. Add a one-line
pointer at each amended location: *"Superseded by `2026-09-13-cross-mirror-overlays.md` §2."*

**D1 (amended).** "Version N" remains the only form a version number takes in user-facing text. The card's
version slot may additionally hold exactly four non-number states, verbatim: `Edited from Version N`,
`Edited`, `Unpublished`, and `your copy differs`. No other words may occupy the slot.

**D4 (amended).** A stale local copy is disclosed on the Marketplace card ("Version N · you have Version M").
The Library card shows what is on disk **and**, when the bytes on disk equal a published version, that
version and the team's newest receipt for those bytes, attributed to its runner. The Library never shows a
team fact about bytes that are not on disk.

**L-DECL (replaced).** *Symmetric overlays.* The Marketplace catalogue (what skills exist, their versions,
evals, who is on them) is read only from the clone. The Library catalogue (what folders exist, their names,
health, local runs) is read only from disk. Each catalogue may carry **overlays**: annotations sourced from a
provable identity — the skill uuid for install state, the content digest for a version match and for evals.
An overlay is a separately named field on the type, set after the catalogue is built, and never consulted by
any filter or sort. Counts follow the card: a Library count of "evaluated" includes cards whose score is an
overlay (ledger D2). The permitted overlays are: Marketplace `installed`, `installedVersion`, `localMatch`;
Library `installedVersion` (from ledger or byte match), `localEval` (own run or team receipt for these bytes),
`knownToTeam`.

**§7.3 (amended).** A Library card's eval comes from the newest receipt for the digest of the folder as it is
on disk right now, taken from **both** `~/.terum/skills/evals/local/<digest>/` and every configured clone's
`evals/<uuid>/v<K>/`. Editing a skill changes its digest, so its card blanks; the "evaluated before your last
edit" line fires when an older digest has runs in either store. D11 seeding stays (it also serves
`eval-report`'s local-run list), but the card no longer depends on it.

**§7.4 (amended).** `SkillCard` stays one type. The Library builder sets `installs:0`, `teamState:'unknown'`,
`latestVersion:null`, `evalVersion:null`, `evalStale:false`, `latestEvalState:null`, `profileVersion:null` as
before, and now sets `installedVersion` from the placement ledger or the byte match, and `localEval` from the
newer of the own-run receipt and the team receipt for these bytes. `SkillCard` gains `localMatch` and
`knownToTeam` (§4.3). `healthOf` is unchanged (local-vs-local).

**§8.3 (amended).** Three states on the Marketplace card: not installed → "Version N"; installed at latest →
"Version N · installed"; installed behind → "Version N · you have Version M" with **Reinstall**. Plus one
overlay-only state: present on disk with bytes matching no version → "Version N · your copy differs" with
**Publish**.

**§7.6 (new).** The `reconcile` verb and `install --adopt` — §5 M2 of this document.

**§9 (amended).** Setup gains the step `existing` between `projects` and `evals` — §5 M2.3.

---

## 3. Behaviour contract

### 3.1 Library card states (one version line, read top to bottom, first match wins)

| # | Condition on the `ls --local` row | Version slot | Eval line |
| --- | --- | --- | --- |
| 1 | `matchedVersion !== null` (bytes equal a committed `v<K>`) | `Version K` | newest of `localEval`, `teamEval` (§3.3) |
| 2 | `placement !== null` and `placement.version` parses | `Edited from Version M` | own runs for current bytes only; else "Not evaluated · evaluated before your last edit" when any store has a run for this uuid at another digest |
| 3 | `placement !== null`, version null (legacy tree hash) | `Edited` | as row 2 |
| 4 | `placement === null`, `knownToTeam === true` | `Edited` | as row 2 |
| 5 | otherwise | `Unpublished` | own runs only |
| — | row lacks the `matchedVersion` key (CLI older than this spec) | *(empty, as today)* | own runs only |

`edited` (the Edited chip) is unchanged: fingerprint differs from the ledger's. A row in state 1 with
`edited === true` cannot occur (identical bytes ⇒ identical fingerprint); if it does, the row is a `problems[]`
entry and the card shows state 2.

### 3.2 Marketplace card states

| # | Condition on the card | Version slot | Right side |
| --- | --- | --- | --- |
| 1 | `installed === 'absent'` (and not `recorded`) | `Version N` | Install |
| 2 | `installedVersion === latestVersion` | `Version N · installed` | check ✓ (and the enable switch when `disablePerMachine`) |
| 3 | `installedVersion < latestVersion` | `Version N · you have Version M` | check ✓ · **Reinstall** |
| 4 | present on disk (`placed`/`onDiskOnly`), `installedVersion === null`, `localMatch === 'differs'` | `Version N · your copy differs` | check ✓ · **Publish** |
| 5 | present on disk, `installedVersion === null`, `localMatch === null` (old CLI, no `matchedVersion` key) | `Version N` | check ✓ *(today's chip words are gone; the check is the installed signal)* |
| 6 | `installed === 'recorded'` (people file only) | `Version N` | Reinstall (unchanged, FIDELITY.md:104) |

`installedVersion` for a Marketplace card = ledger version when exactly one ledger entry for this uuid+team
exists (today's rule) **else** the `matchedVersion` of the single on-disk row whose `skillId` or
`matchedName` resolves to this card (new). `localMatch` = `'identical'` when that row exists and matched,
`'differs'` when a row is present with `matchedVersion === null`, `null` otherwise.

### 3.3 Which eval a Library card shows

Let `own` = newest receipt in `evals/local/<digest>/`, `team` = newest receipt across clones whose
`content_digest === digest`. The card shows the one with the greater `run_id` (run ids are UTC timestamps,
lexically ordered). `runnerHandle` renders whenever the receipt's `provenance.runner_handle` differs from
this machine's handle for that team; otherwise the line reads without attribution. Score, W/L/T and
provenance come from that one receipt, never combined (eval-engine spec §12).

### 3.4 Reconcile (M2) — what the person sees

Terminal, interactive:

```
Checking your library against the team…
3 of your skills match the team's exactly; 2 share a name with a team skill but differ.
Record decision-walk as installed (Version 4)? [y/N]
Record handoff as installed (Version 2)? [y/N]
Record state as installed (Version 1)? [y/N]
Publish your version of tdd as Version 3 of the team's tdd? Your folder carries the team's id for tdd. [y/N]
Publish your version of deploy-check as Version 6 of the team's deploy-check? Your folder carries no team id
for this name, and the team's copy was published by ajayw36; publishing makes your content the next version
of their skill. To keep them separate, rename yours first: terum-skills skill rename <path> --to <new-name>. [y/N]
Recorded 2 installs. Published 1 skill.
```

`--list` prints the same summary and writes the two groups as the verb's result (§4.4); it asks nothing and
writes nothing. In frame mode `setup` uses `--list` behaviour (§5 M2.3). Folders that are already in the
placements ledger are never listed. A folder whose bytes equal a team version under a **different name** is
reported in a third group, `renamed`, and offered nothing (deferred, ledger D3).

---

## 4. Data model and contracts

### 4.1 `ls --local` row (CLI `LocalSection.rows[]`, `src/commands/ls.ts:64`)

```ts
teamEval: (Receipt & { path: string; team: string }) | null;   // newest committed receipt with content_digest === folder digest
matchedVersion: string | null;                                  // 'v<K>' whose committed bytes equal the folder, else null
matchedName: string | null;                                     // the team skill name that owns matchedVersion (may differ from the folder name)
matchedTeam: string | null;
knownToTeam: boolean;                                           // skillId !== null and some configured clone has a skill with that uuid
```

All five are present on every row (never `undefined`) once this CLI ships; the desktop declares them
`.optional()` (invariant 2: *a new `ls --local` key is declared optional in the app before or with the CLI
that emits it*). `teamEval.path` is `<clone>/evals/<uuid>/<v>/<run_id>.json`.

Ambiguity rule: if more than one configured team holds a byte-identical version, `matchedVersion` is the
placement's team when there is a placement, else `null`, and `problems[]` gets
`{ path, reason: 'identical bytes exist in more than one team' }`.

### 4.2 Version digests of a clone (new helper, `src/lib/teamRepo.ts` beside `skillVersions`)

```ts
export async function versionDigests(clone: string, names: readonly string[]): Promise<Map<string, { name: string; folder: string; digest: string }>>
// key `${name}/${folder}`; digest = canonicalDigest(join(clone,'skills',name,folder)); mapWithConcurrency(…, 8)
```

Uncached in this spec. **GATE:** if `ls --local` on the reference machine (88 folders, 17 team skills) exceeds
**500 ms** wall-clock after M1, add a cache at `~/.terum/skills/run/<team>.digests.json` keyed on the
`run/<team>.stamp` head (fs-only; read verbs stay git-free). Do not build the cache first.

### 4.3 `SkillCard` (`desktop/src/backend/types.ts:36`), required-nullable, both builders set them

```ts
localMatch: 'identical' | 'differs' | null;   // Marketplace: on-disk row byte-matched a version / matched none / no row or old CLI. Library: same, from its own row.
knownToTeam: boolean;                          // Library rows; Marketplace builder sets true.
```

`installedVersion` is no longer fixed to `null` by `localCard` (§2 §7.4).

### 4.4 `reconcile` result DTO (`src/commands/reconcile.ts`)

```ts
export interface ReconcileRow { path: string; name: string; team: string; skillId: string | null }
export interface ReconcileResult {
  identical: (ReconcileRow & { version: string })[];                      // adopt candidates: bytes === skills/<name>/<version>, basename === name
  differing: (ReconcileRow & { teamVersion: string; nextVersion: string; sameId: boolean; teamAuthor: string })[];
  renamed:   (ReconcileRow & { version: string; teamName: string })[];    // bytes match under another name; reported only
  adopted: string[]; published: string[];                                 // paths acted on (empty under --list)
}
```

### 4.5 `install --adopt <path>` (`InstallArgs.adopt?: string`)

Preconditions, each its own error line: the path is a directory directly under a Library root (global or a
registered project; `resolveLibrarySkill`); its `canonicalDigest` equals exactly one `versionDigests` entry
of the selected team; the folder basename equals that entry's `name` (else
`"<path> holds the bytes of <name> Version K under a different folder name; rename it to <name> first."`);
the path is not already in `config.placements`.

Effects, in `installOne`'s order, **skipping** `place()` and the old-skills move: `ensureConsent` for the
skill's `allowed-tools`; `pending` entry `{ op:'install', destination, version:'v<K>' }`; ledger
`placements[path] = { id, team, version:'v<K>', scope, placed_at, fingerprint: snapshotSkillDirectory(path).fingerprint }`;
`safeWrite` of `people/<handle>.json` `installed[]` (and `local_skills`) exactly as `install.ts:174-183`;
pending cleared. D11 receipt seeding is skipped (the overlay shows the score). Result:
`InstalledResult & { adopted: true }`.

### 4.6 Setup step

CLI `Step` (`setup.ts:74`) and desktop `SETUP_STEP_KEYS` (`types.ts:144`) gain `'existing'` between
`'projects'` and `'evals'`. Outcomes: `done` (asked, acted or declined), `skipped` (`--no-existing`, `quiet`,
non-interactive, no team, or nothing to reconcile), `printed` (frame channel: summary printed, the shell owns
the choice). `SETUP_STEP_TO_BOARD.existing = 'Your skills'` (new tour board, §6 desktop).

### 4.7 Frames

`FRAME_VERBS` gains `'reconcile'`. `FRAME_FEATURES` gains `reconcile: true`; `FEATURE_KEYS` gains
`'reconcile'`; its **one** consumer is the Library's *Check against the team* action (§6). No new ask kind,
no protocol bump. `docs/frame-protocol.md` documents the five new `ls --local` row keys, `reconcile --list`,
and `install --adopt`. Not added to `SERVE_READ_VERBS` (`reconcile` without `--list` writes).

---

## 5. Milestones

### M1 — overlays and the version line (ledger D1, D2, D4, D5)

**Done means:** a hand-copied folder whose bytes equal a published version shows that version and the team's
newest score in the Library, shows "Version N · installed" with the check on the Marketplace, and every card in
both screens has a filled version slot that never clips.

1. `src/lib/teamRepo.ts` — `versionDigests` (§4.2).
2. `src/commands/ls.ts` `showLocal` — once per load, for each configured team: `skillRecords` (already
   available via `readTeam`/`skillRecords`), `versionDigests`, and a receipt index
   `Map<content_digest, (Receipt & {path; team})[]>` built from `receiptFiles` over `evals/<uuid>/<v>/`
   (unreadable receipts skipped and reported once per file, the `localReceiptsFor` rule). Per candidate row,
   using the digest `evalOf` already computes: set `teamEval`, `matchedVersion`, `matchedName`,
   `matchedTeam`, `knownToTeam`. `localEvalStale` also considers team receipts for the same uuid at another
   digest. Rows that are not candidates get nulls and `knownToTeam` from frontmatter uuid alone.
3. `desktop/src/backend/tauri/index.ts` — `cliLocalRow` gains the five keys, optional. `localCard`: version
   slot per §3.1; `localEval` per §3.3; `localMatch`; `knownToTeam`. `inventoryCard`: `installedVersion`
   fallback and `localMatch` per §3.2. `library()` `overview.evaluated` unchanged in code (counts
   `localEval !== null`, which now includes overlay evals — ledger D2).
4. `desktop/src/components/domain/presentation.ts` — `marketplaceVersionLabel` gains states 1 and 4 of §3.2;
   new `libraryVersionLabel(card)` for §3.1. Both return `null` only when `latestVersion`/row keys are absent
   (old CLI).
5. `desktop/src/components/domain/SkillCard.tsx` — the `onDiskOnly` branch renders the check icon and no
   words; the version label (whichever builder) is the only text. **Publish** button for §3.2 state 4 navigates
   to `detailPath(skill)+'?dialog=publish&root=marketplace'` (reuse the existing publish dialog route; if none
   exists on the Marketplace detail, open the Library detail of the on-disk path).
6. `desktop/src/components/domain/SkillCard.css` — **wrap rule (ledger D4/D5 constraint):** the version label
   and its check form one flex item (`.card-version`) with `white-space:nowrap` on the text and `flex-shrink:0`;
   the bottom row becomes `flex-wrap:wrap; row-gap:4px; min-height:20px; height:auto`; `.skill-card` drops
   its fixed `height:148px` in favour of `min-height:148px`. Longest string to verify:
   `Version 10 · you have Version 2` + Reinstall, at the narrowest card width the grid produces, both themes.
   Nothing may clip or ellipsize inside the version words; the whole unit moves to the next row instead.
7. `desktop/src/backend/mock/data.ts` `cardOf`, `mock/index.ts` `localProjection`, `withInstall`, and the
   `on-disk-only` / `stale-eval` scenarios set `localMatch`/`knownToTeam` and exercise §3.1 states 1–5 and
   §3.2 states 1–5.
8. `docs/frame-protocol.md`, `README.md` (Library/Marketplace paragraphs at lines 72–80 on main), and
   `src/lib/invocation-catalog.ts` patterns for any reworded README row.

### M2 — reconcile (ledger D3)

**Done means:** joining a team, or adding a project, with matching skills already on disk ends with the team's
records reflecting what is on the machine — for every folder the person said yes to — and nothing else.

1. `src/commands/reconcile.ts` — scan via `createLibraryScan(home, config.projects, stateRoot)` over global +
   registered roots; candidate rows only; digest each; classify per §4.4 against every configured team
   (`skillRecords` + `versionDigests`); skip ledgered paths. Interactive: the §3.4 dialogue, then
   `installOne({ adopt })` and `publish.run({ ref: path })` per yes. `--list`: no asks, no writes. `--team`
   honoured. Registered in `src/cli.ts` as `reconcile` with `--list`, `--team`; in `FRAME_VERBS`.
2. `src/commands/install.ts` — `--adopt <path>` (§4.5); `run()` routes it before `parseRef`.
3. `src/commands/setup.ts` — step `existing` after `projects` (`:338`) and before `evals` (`:341`):
   `if (args.quiet || args.existing === false || !io.interactive || teamName === '') steps.existing = 'skipped'`;
   else `section('existing')`, print the start line, run reconcile in interactive mode when
   `io.channel !== 'frames'`, else `--list` mode and `steps.existing = 'printed'`. `SetupArgs.existing?: boolean`;
   CLI flag `--no-existing`. Errors are non-fatal, as the projects step's are.
4. `src/commands/project.ts` `add` — after `addLibraryProject` returns `added: true`, run reconcile scoped to
   that root (`--root <path>`), interactive when `io.channel !== 'frames'`, else emit the `--list` result on
   the verb's result as `reconcile?: ReconcileResult`. `cliProjectAdded` in the desktop declares it optional.
5. Desktop — seam `backend.reconcile.list(): Promise<Result<ReconcileResult>>` (one-shot `reconcile --list`);
   `backend.install` accepts `{ adopt: path }`. A `ReconcileDialog` (new component) renders the two groups as
   checkboxes — identical rows checked, differing rows checked only when `sameId`, each unchecked differing
   row carrying the rename note — and on confirm drives `install({adopt})` and `publish({ref})` per checked
   row, reporting per-row outcomes. Consumers: the onboarding board `Your skills` (fed by
   `steps.existing === 'printed'` → `reconcile.list()`), the `project add` flow when `cliProjectAdded.reconcile`
   is non-empty, and the Library's *Check against the team* action (the `reconcile` feature flag's one consumer).
6. `desktop/src/backend/setup-session.ts` — `SETUP_STEP_TO_BOARD.existing`, `printedSetupStep` prefixes
   `Checking your library against the team`, `of your skills match`, `Recorded `, `Published `, `Nothing to
   reconcile`; `askedSetupStep` prefixes `Record ` and `Publish your version of `.
7. `README.md` verb table: `reconcile [--list]`, `install --adopt <path>`, setup `--no-existing`.

---

## 6. Changes per file (index)

CLI: `src/lib/teamRepo.ts` (+`versionDigests`), `src/commands/ls.ts`, `src/commands/reconcile.ts` (new),
`src/commands/install.ts`, `src/commands/setup.ts`, `src/commands/project.ts`, `src/cli.ts`,
`src/lib/frames.ts` (`FRAME_VERBS`, `FRAME_FEATURES`), `src/lib/invocation-catalog.ts`, `docs/frame-protocol.md`,
`README.md`. Version bump to `0.16.0` (new verb, new feature key).

Desktop: `src/backend/types.ts` (`SkillCard`, `SETUP_STEP_KEYS`, `FEATURE_KEYS`, `Backend.reconcile`,
`InstallArgs.adopt`), `src/backend/tauri/index.ts`, `src/backend/setup-session.ts`,
`src/backend/mock/{data,index}.ts`, `src/components/domain/{presentation.ts,SkillCard.tsx,SkillCard.css}`,
`src/components/domain/ReconcileDialog.tsx` (new), the onboarding `Your skills` board, the Library action.
Implementing agents do not edit `GAPS.md`, `FIDELITY.md`, `AGENTS.md`, `README.md` (desktop) or
`package.json`; report the owed oracle for the new board and any re-recorded boards in the run report.

---

## 7. Copy (exact strings; the desktop matches some by prefix)

| Where | String |
| --- | --- |
| Library version slot | `Version {K}` · `Edited from Version {M}` · `Edited` · `Unpublished` |
| Marketplace version slot | `Version {N}` · `Version {N} · installed` · `Version {N} · you have Version {M}` · `Version {N} · your copy differs` |
| Library eval line, teammate's run | `run by {handle} · Version {K}` (existing shape) |
| Library eval empty state | `Not evaluated` · `Not evaluated · evaluated before your last edit` |
| Reconcile start | `Checking your library against the team…` |
| Reconcile summary | `{a} of your skills match the team's exactly; {b} share a name with a team skill but differ.` · `Nothing to reconcile: none of your skills match a team skill by bytes or by name.` |
| Adopt question | `Record {name} as installed (Version {K})?` |
| Publish question, same id | `Publish your version of {name} as Version {K+1} of the team's {name}? Your folder carries the team's id for {name}.` |
| Publish question, name only | `Publish your version of {name} as Version {K+1} of the team's {name}? Your folder carries no team id for this name, and the team's copy was published by {author}; publishing makes your content the next version of their skill. To keep them separate, rename yours first: {invocation} skill rename {path} --to <new-name>.` |
| Renamed group line | `{path} holds the bytes of {teamName} Version {K} under a different folder name; nothing is offered for it.` |
| Reconcile close | `Recorded {a} install(s). Published {b} skill(s).` |
| Adopt refusals | `{path} is not a folder in your Library.` · `{path} does not match any published version of a team skill byte for byte; publish it instead.` · `{path} holds the bytes of {name} Version {K} under a different folder name; rename it to {name} first.` · `{path} is already recorded as installed.` |
| Library action | `Check against the team` |
| Onboarding board title | `Your skills` |

---

## 8. Tests

CLI (`src/commands/__tests__/`, `src/lib/__tests__/`):

- `ls-local-overlay.test.ts` — a fixture clone with `skills/a/v1`, `skills/a/v2`, receipts at `evals/<id>/v2/`
  with `content_digest` of v2; local folders: copy of v2 (→ `matchedVersion:'v2'`, `teamEval` set, own store
  empty), copy of v2 edited (→ null match, `knownToTeam:true`, `localEvalStale:true`), unrelated folder (→
  `knownToTeam:false`). Asserts `canonicalDigest(folder) === skillContentDigest(files)` on the v2 fixture with
  managed fields present (the parity proof).
- `ls-local-overlay.test.ts` — newest-wins between an own receipt and a team receipt for the same digest.
- `teamRepo-version-digests.test.ts` — numeric ordering, missing folder → absent key, concurrency bound.
- `reconcile.test.ts` — classification of identical / differing (`sameId` true and false) / renamed /
  ledgered-skip; `--list` writes nothing (config and clone byte-identical before and after); interactive
  yes → one `installOne` adopt and one `publish` call; no → nothing written.
- `install-adopt.test.ts` — each §4.5 refusal; success writes ledger + people file and does **not** copy or
  move files (folder mtime and bytes unchanged, no `old-skills`).
- `setup.test.ts` — step order `projects → existing → evals`; `--no-existing` and `quiet` skip;
  frames channel → `printed`; a failing reconcile never fails setup.
- `project.test.ts` — `add` on a root holding a matching skill returns `reconcile.identical.length === 1`.

Desktop (`desktop/src/**`):

- `skill-card-versions.test.tsx` — every row of §3.1 and §3.2 renders the exact string; old-CLI rows (keys
  absent) render nothing in the slot and no `Unpublished`.
- `SkillCard.test.tsx` (new) — `Installed · on this machine` text is gone; the check renders for states 2–5;
  Publish renders only for state 4; the bottom row wraps as a unit at 260 px card width (jsdom layout assertion
  on class presence plus an e2e screenshot gate below).
- `library-replay.test.ts` — `overview.evaluated` counts an overlay-eval card.
- `descriptions.test.ts` / `features.test.ts` — `reconcile` feature key has exactly one consumer.
- `setup-driver`/`setup-session` tests — `SETUP_STEP_KEYS` includes `existing`, `printedSetupStep` and
  `askedSetupStep` map the §7 prefixes.
- `ReconcileDialog.test.tsx` — default checks (identical on, `sameId` on, name-only off with note), confirm
  drives adopt/publish per checked row.
- e2e `routes/card-versions.spec.ts` — Marketplace and Library cards at the narrowest grid column show the
  full version string with no ellipsis and no overflow, light and dark.

---

## 9. Gates

- `npm run lint`, `npm run typecheck`, `npm test` at the repo root (with `TMPDIR` realpath export on macOS).
- `npm run --prefix desktop lint|typecheck|test`, then the e2e suites serially (port 1420 is single).
- Fidelity: boards that draw the old chip re-record; the `Your skills` onboarding board has **no oracle yet** and
  is filed as owed in the run report for the maintainers to add to `FIDELITY.md`.
- Frames: `capture-frames` re-recorded for `ls --local`, `setup`, `project add`, `install`, `reconcile`.
- Reference-machine timing for the §4.2 GATE, reported as a number in the run report.

---

## 10. Out of scope and deferred

- Renamed-folder handling (bytes match under another name): reported only. Ledger D3 deferral.
- A `multiselect` ask kind: not needed — the terminal asks per row, the desktop uses `--list` plus its own
  dialog. Ledger D3 deferral stays open for a later UX upgrade.
- Version-digest cache: GATE in §4.2.
- The team-record check (`check_decision`) over the five LOCKs: owed when the MCP accepts auth.
- Sync-time materialization of receipts into the local store (ledger D1 option B): rejected.
- Auto-publish of differing skills (ledger D3 option R3): rejected.

---

## 11. Human gates before this spec can be locked

1. **Ryan — copy.** §7 strings, especially the name-only publish warning and `your copy differs`.
2. **Ryan — `install --adopt` consent.** Adopt runs `ensureConsent` for the folder's `allowed-tools`, so a batch
   of identical skills with grants asks one extra question each. Alternative: adopt records the approval
   silently because the skill is already on disk. This spec keeps the question; confirm or flip.
3. **Ryan — layout.** The wrap rule in M1.6 changes `.skill-card` from fixed to minimum height. Confirm the grid
   may grow a row when a long version string wraps, or specify a truncation rule instead (which the ledger
   currently forbids).
4. **Maintainers — fidelity oracle** for the `Your skills` board.
