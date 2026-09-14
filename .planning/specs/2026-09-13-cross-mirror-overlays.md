# SPEC — cross-mirror overlays (team evals in the Library, reconcile on join, a version on every card)

Baseline: `ryanliu-terum/terum-skills` @ **cc3a691** (`Merge pull request #192 … docs/readme-faq-tidy`), CLI `0.15.0`.
Every line number and quoted identifier below was read out of that commit unless a section says otherwise.
Where this spec disagrees with the code at its baseline, **the code wins** and the implementer reports the
disagreement.

**Revision 2, 2026-09-14** — applies the review decision walk
`.planning/decisions/2026-09-13-cross-mirror-overlays-review-decision-walk.md` (commit `d5bf0cc`, ratified by
Ryan 2026-09-13): D1 bytes win on both mirrors; D2 Publish only on "your copy differs"; D2b the `(edited)`
label; D3 `mine` on both receipts; D4 the check joins the version words; D4b cards abbreviate to `vN`; D5 adopt
writes the machine's record last; D6 the reconcile root is an in-process argument; D7 the `install --adopt`
grammar; D8 M1.1 ships before M2; plus that ledger's eleven wording corrections. **M1 landed on `main` as
`753efa4` (PR #199, 2026-09-14).** The M1 sections below describe the state **after M1.1** — the small inline
follow-up PR that carries D1–D4b — and name what M1 already built and what M1.1 changes. M2 is unbuilt; its
implementer reads `main` at build time, and the code-wins rule applies against that tree.

Governing decisions: `.planning/decisions/2026-09-13-cross-mirror-overlays-decision-walk.md` (commit `1c06efc`),
amended by the review walk above (§2 records the two superseded lines).
North Star: *each screen tells the truth about your copy versus the team's (installed, which version, how it
scored), proven by identical bytes, never a name; nothing moves between the two unless you ask, except eval
results, which reach the Library automatically through the background sync.*

Parent spec: `.planning/specs/2026-09-11-library-marketplace-refactor.md` (**rev 10**, on `origin/main`). §2 of
this document **supersedes** the named sections of the parent. The parent is not otherwise revised; its decision
ledger and milestones stand. Rev 10's override of parent D2/D9 (eval assets travel with a skill but no longer
identify it; `skillContentDigest` skips `evals/`, PR #197) is already what the digest join here relies on.

**Status: M1 shipped, M1.1 in build (this revision), M2 ready for the §11 human gates — NOT yet locked for
`/codex-implement`.** §11 gate 3 (card height) was closed by D4b; gates 1 (copy) and 2 (adopt consent) remain and
are walked with Ryan after M1.1 merges. No further `/codex-spec` run is planned on M2 (Ryan, 2026-09-13). The
team-record check (`check_decision`) has not run: the `terum` MCP refused auth in every session this spec descends
from.

---

## 0. Summary

1. Two pure mirrors can both be wrong about one folder. A skill copied by hand, or pulled in with a project
   repo, whose bytes equal a published version shows "not installed" on the Marketplace and "not evaluated"
   in the Library, even when a teammate scored those exact bytes last night.
2. The join that fixes both already exists: the **content digest**. Receipts carry `content_digest`; the
   Library already digests every folder; version folders in the clone can be digested the same way. The
   digest is one implementation — `canonicalDigest(root)` reads a folder and delegates to
   `skillContentDigest(files)` (`src/lib/skills.ts:134-162`) — so the two sides cannot drift. Since PR #197
   neither side counts `evals/` (parent D2/D9 as overridden in rev 10): eval assets travel with a skill but do
   not identify it.
3. **M1 (display).** `ls --local` gains read-only keys per row: `teamEval` (the newest committed receipt for
   these exact bytes), `matchedVersion` (the `v<K>` whose committed bytes equal the folder), `matchedName`,
   `matchedTeam`, and `knownToTeam` (the folder's uuid belongs to a team skill); both receipts a row can carry
   say whether this machine ran them (`mine`). The Library card shows the team's score with the runner named;
   every card in both screens carries one version line, abbreviated to `vN` on cards only; the
   "Installed · on this machine" chip's words become that line and its check mark joins the version words.
   **The bytes decide the version on both mirrors** (D1): a folder whose bytes equal a published version is
   that version, whatever the placement ledger recorded, and is never "edited".
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

**What M1 (`753efa4`) added on top of this**, so M1.1 and M2 read the right tree: `src/lib/version-digests.ts`
(`versionDigests`); `src/commands/ls.ts` `teamIndex` and the five row keys, `TeamEval` with `mine`, the
ambiguity `problems[]` line; `desktop/src/backend/tauri/index.ts` `libraryEval`, `libraryVersion`,
`libraryMatch`, `byteMatched`, and `inventoryCard`'s `installedVersion` fallback and `localMatch`;
`presentation.ts` `marketplaceVersionLabel` (four states) and `libraryVersionLabel`; `SkillCard.tsx` the version
line, Publish button and check; `SkillCard.css` `min-height:148px` and the wrap rule; `types.ts`
`localMatch: 'identical' | 'differs' | 'none' | null` and `knownToTeam`; `docs/frame-protocol.md` the row keys.

---

## 2. Amendments to the parent spec

Each block below replaces the named text in `2026-09-11-library-marketplace-refactor.md` (rev 10). Add a
one-line pointer at each amended location: *"Superseded by `2026-09-13-cross-mirror-overlays.md` §2."* Rev 10
moved D2, D9, §4.2, §6.3 and §3.4 (eval assets); none of those is an amendment target here, and the L-DECL,
D1, D4, §7.3, §7.4, §8.3 and §9 text this section replaces is unchanged between rev 3 and rev 10.

**D1 (amended).** "Version N" remains the only form a version number takes in **prose**: terminal questions,
dialogs, README, `docs/frame-protocol.md`, detail screens. **Card surfaces** — the version slot and the eval
line of a `SkillCard` — abbreviate it to **`vN`** (review walk D4b), so the longest card string is short enough
that wrapping is rare. The card's version slot may additionally hold exactly four non-number states, verbatim:
`vM (edited)`, `Edited`, `Unpublished`, and `your copy differs`. No other words may occupy the slot.

**D4 (amended).** A stale local copy is disclosed on the Marketplace card (`vN · you have vM`). The Library card
shows what is on disk **and**, when the bytes on disk equal a published version, that version and the team's
newest receipt for those bytes, attributed to its runner. The Library never shows a team fact about bytes that
are not on disk. **The bytes decide the number on both mirrors** (review walk D1): when a folder's bytes equal a
published version, that version is the number shown even if the placement ledger records another, and such a
folder is never "edited". The parent ledger's D4 Technical line "`installedVersion = placement.version ??
matchedVersion`" and its "Version N" card copy are superseded by review-walk D1 and D4b; the parent ledger file
is not edited.

**L-DECL (replaced).** *Symmetric overlays.* The Marketplace catalogue (what skills exist, their versions,
evals, who is on them) is read only from the clone. The Library catalogue (what folders exist, their names,
health, local runs) is read only from disk. Each catalogue may carry **overlays**: annotations sourced from a
provable identity — the skill uuid for install state, the content digest for a version match and for evals.
An overlay is a separately named field on the type, set after the catalogue is built, and never consulted by
any filter or sort. Counts follow the card: a Library count of "evaluated" includes cards whose score is an
overlay (ledger D2). The permitted overlays are: Marketplace `installed`, `installedVersion`, `localMatch`;
Library `installedVersion` (from the byte match, else the placement ledger), `localEval` (own run or team
receipt for these bytes), `knownToTeam`.

**§7.3 (amended).** A Library card's eval comes from the newest receipt for the digest of the folder as it is
on disk right now, taken from **both** `~/.terum/skills/evals/local/<digest>/` and every configured clone's
`evals/<uuid>/v<K>/`. Editing a skill changes its digest, so its card blanks; the "evaluated before your last
edit" line fires when an older digest has runs in either store. D11 seeding stays (it also serves
`eval-report`'s local-run list), but the card no longer depends on it. Parent §7.4's sentence "`runnerHandle`
null means the run was this machine's" stays literally true because both receipts carry `mine` (§3.3, §4.1).

**§7.4 (amended).** `SkillCard` stays one type. The Library builder sets `installs:'—'`, `installsN:0`,
`teamState:'unknown'`, `latestVersion:null`, `evalVersion:null`, `evalStale:false`, `latestEvalState:null`,
`profileVersion:null` as before, and now sets `installedVersion` from the byte match, else the placement
ledger, and `localEval` from the newer of the own-run receipt and the team receipt for these bytes (§3.3).
`SkillCard` gains `localMatch` and `knownToTeam` (§4.3). `healthOf` is unchanged (local-vs-local).

**§8.3 (amended).** States on the Marketplace card, first match wins: not installed → `vN`; present with an
installed copy whose bytes match no version → `vN · you have vM (edited)` with **Reinstall** when M < N;
installed at latest → `vN · installed`; installed behind → `vN · you have vM` with **Reinstall**. Plus one
overlay-only state: present on disk, never installed, bytes matching no version → `vN · your copy differs` with
**Publish**. The full table with conditions is §3.2.

**§7.6 (new).** The `reconcile` verb and `install --adopt` — §5 M2 of this document.

**§9 (amended).** Setup gains the step `existing` between `projects` and `evals` — §5 M2.3.

---

## 3. Behaviour contract

### 3.1 Library card states (one version line, read top to bottom, first match wins)

| # | Condition on the `ls --local` row | Version slot (card form) | Eval line |
| --- | --- | --- | --- |
| 1 | `matchedVersion !== null` (bytes equal a committed `v<K>`) | `vK` — K is the matched version **even when the placement records another**; the bytes decide (D1) | the shown receipt of §3.3 |
| 2 | `placement !== null` and `placement.version` parses | `vM (edited)` | own runs for current bytes only; else "Not evaluated · evaluated before your last edit" when any store has a run for this uuid at another digest |
| 3 | `placement !== null`, version null (legacy tree hash) | `Edited` | as row 2 |
| 4 | `placement === null`, `knownToTeam === true` | `Edited` | as row 2 |
| 5 | otherwise | `Unpublished` | own runs only |
| — | row lacks the `matchedVersion` key (CLI older than this spec) | *(empty, as today)* | own runs only |

**`localMatch` derivation** (§4.3, correction 2): row 1 → `'identical'`; rows 2–4 → `'differs'`; row 5 →
`'none'`; the key-absent row → `null`. The label builder keys on `localMatch` plus `installedVersion`, so the
table and the field cannot disagree.

**`edited` and the byte match measure different things** (D1). `edited` (the Edited chip) compares the folder's
fingerprint with the fingerprint the placement ledger recorded at install time; `matchedVersion` compares the
folder's digest with **every** committed version. A folder installed as `v2` whose bytes later became exactly
`v1` is therefore `edited === true` **and** `matchedVersion === 'v1'`. That row is state 1: the card says `v1`,
shows no Edited chip, and adds no `problems[]` entry. The chip renders only when `edited === true` and
`localMatch !== 'identical'`. (Rev 1 claimed matched-and-edited could not occur; `ls-local-overlay.test.ts`
proves it does, on purpose.)

### 3.2 Marketplace card states (a row's right side renders only in that row's state)

| # | Condition on the card | Version slot (card form) | Right side |
| --- | --- | --- | --- |
| 1 | `installed === 'absent'` (and not `recorded`) | `vN` | Install |
| 2 | `installedVersion === latestVersion`, `localMatch !== 'differs'` | `vN · installed ✓` | the enable switch when `disablePerMachine` |
| 3 | `installedVersion < latestVersion`, `localMatch !== 'differs'` | `vN · you have vM ✓` | **Reinstall** |
| 3b | present on disk, `installedVersion !== null`, `localMatch === 'differs'` (an installed copy that was edited) | `vN · you have vM (edited) ✓` — also when M = N; "installed" is reserved for exact bytes (D2b) | **Reinstall** when M < N |
| 4 | present on disk (`placed`/`onDiskOnly`), `installedVersion === null`, `localMatch === 'differs'` | `vN · your copy differs ✓` | **Publish** |
| 5 | present on disk, `installedVersion === null`, `localMatch === null` (old CLI, no `matchedVersion` key) | `vN ✓` *(today's chip words are gone; the check is the installed signal)* | — |
| 6 | `installed === 'recorded'` (people file only) | `vN` | Reinstall (unchanged, FIDELITY.md:104) |

**The check ✓ is part of the version slot** (D4): one `.card-version` element holds the label text and the check
icon and wraps as a whole; the right side keeps actions and the enable switch. In states 2–5 the check renders
inside that element whenever `teamed && installed === 'placed'`; the switch, when `disablePerMachine` grants it,
stays on the right.

**`installedVersion` for a Marketplace card** (D1, correction 3), in order: (a) when any on-disk row resolving to
this card (`skillId`/placement uuid, or `matchedTeam`+`matchedName`) byte-matches a version, the one
`matchedVersion` they all share — two copies at different matched versions have no single truthful version and
the slot stays `null`; (b) else the ledger version when **every** `config.placements` entry for this uuid+team
records the same parseable version (not "exactly one entry"); (c) else `null`.
**`localMatch`** = `'identical'` when (a) found a match; `'differs'` when rows are present, scanned (carry the
`matchedVersion` key) and none matched, ledger entry or not; `null` when no row resolves to the card or the CLI
predates the key. The Marketplace builder never emits `'none'` — a row that resolves to a team card is by
construction known to the team.

**Publish predicate, stated once:** Publish renders iff the card is present on disk, `installedVersion === null`,
`localMatch === 'differs'`, and `path !== null` (D2). An edited install (state 3b) offers no Publish; its edits
are published from the Library, where the folder reads `vM (edited)`.

### 3.3 Which eval a Library card shows

Let `own` = newest receipt in `evals/local/<digest>/`, `team` = newest receipt across clones whose
`content_digest === digest`. The card shows the one with the greater `run_id` (run ids are UTC timestamps,
lexically ordered); **on equal `run_id` the team receipt wins** (D3) — the everyday case, because install seeds
the own store with a copy of the committed receipt, so the same run exists twice. Both receipts carry `mine`
(§4.1). **A runner is named iff the shown receipt's `mine === false`**; otherwise the line reads without
attribution — the card can never say "run by <your own handle>". Score, W/L/T and provenance come from that one
receipt, never combined (eval-engine spec §12). **Evaluable predicate:** a Library card counts as evaluated
(`overview.evaluated`) iff the shown receipt exists, whichever store it came from (ledger D2).

### 3.4 Reconcile (M2) — what the person sees

Terminal, interactive (prose keeps "Version N" — D4b):

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

### 4.1 `ls --local` row (CLI `LocalSection.rows[]`, `src/commands/ls.ts:66` on main)

```ts
localEval: (Receipt & { path: string; mine: boolean }) | null;          // newest own-store receipt for the folder's digest (existing key; `mine` is new in M1.1)
teamEval: (Receipt & { path: string; team: string; mine: boolean }) | null;   // newest committed receipt with content_digest === folder digest
matchedVersion: string | null;                                  // 'v<K>' whose committed bytes equal the folder, else null
matchedName: string | null;                                     // the team skill name that owns matchedVersion (may differ from the folder name)
matchedTeam: string | null;
knownToTeam: boolean;                                           // skillId !== null and some configured clone has a skill with that uuid
```

The five overlay keys are present on every row (never `undefined`) once this CLI ships; the desktop declares
them `.optional()` (invariant 2: *a new `ls --local` key is declared optional in the app before or with the CLI
that emits it*). `teamEval.path` is `<clone>/evals/<uuid>/<v>/<run_id>.json`.

**`mine`, defined once (D3):** `provenance.runner_handle` equals this machine's handle for the receipt's team.
For `teamEval` that team is the clone the receipt came from; for the own-store `localEval`, which names no team,
`mine` is true when the handle equals **any** configured team binding's handle. Computed CLI-side in
`src/commands/ls.ts`, never in the desktop. A CLI that predates M1.1 omits `localEval.mine`; the desktop declares
it optional and treats an absent flag as "not mine" only for the tie rule's attribution (a seeded copy then
still names its runner, as D11 did).

Ambiguity rule: if more than one configured team holds a byte-identical version, `matchedVersion` is the
placement's team when there is a placement, else `null`, and `problems[]` gets
`{ path, reason: 'identical bytes exist in more than one team; no version is shown' }`.

### 4.2 Version digests of a clone (`src/lib/version-digests.ts`, landed in M1)

```ts
export interface VersionDigest { name: string; folder: string; n: number; digest: string; }
export async function versionDigests(clone: string, names: readonly string[]): Promise<Map<string, VersionDigest>>
// key `${name}/${folder}`; digest = canonicalDigest(join(clone,'skills',name,folder)); mapWithConcurrency(…, 8)
```

Its own leaf, not `teamRepo.ts`: `skills.ts` already imports `teamRepo.ts`, and the reverse import closed a
cycle (correction 5). The digest is the same `canonicalDigest` publish and eval use; it skips the three
Terum-managed YAML fields and the `evals/` directory (PR #197), so a folder that gained eval assets after install
still matches its version.

Uncached in this spec. **GATE:** if `ls --local` on the reference machine (88 folders, 17 team skills) exceeds
**500 ms** wall-clock after M1, add a cache at `~/.terum/skills/run/<team>.digests.json` keyed on the
`run/<team>.stamp` head (fs-only; read verbs stay git-free). Do not build the cache first.

### 4.3 `SkillCard` (`desktop/src/backend/types.ts:36`), required-nullable, both builders set them

```ts
localMatch: 'identical' | 'differs' | 'none' | null;
knownToTeam: boolean;                          // Library rows; Marketplace builder sets true.
```

`localMatch`, per mirror: **Library** — `'identical'` the bytes equal a published version (§3.1 row 1);
`'differs'` they equal none but the ledger placed the folder or the team knows its uuid (rows 2–4); `'none'`
nothing ties the folder to a team (row 5); `null` the CLI predates the key. **Marketplace** — `'identical'` an
on-disk copy byte-matched a version; `'differs'` copies are present and none matched; `null` no copy or old CLI;
never `'none'` (§3.2).

`installedVersion` is no longer fixed to `null` by `localCard` (§2 §7.4); it is the byte match, else the
placement ledger (D1).

**Desktop `InstallArgs`** (`types.ts:116`, D7): `ref` becomes optional and `adopt?: string` joins it —
`{ team?: string; ref?: string; adopt?: string; scope?: Scope; … }`. Exactly one of `ref` / `adopt` is given;
the rule is stated once, here, and enforced by the CLI (§4.5). Every existing caller passes `ref`, so no churn.

### 4.4 `reconcile` result DTO and arguments (`src/commands/reconcile.ts`)

```ts
export interface ReconcileArgs { list?: boolean; team?: string; root?: string }
export interface ReconcileRow { path: string; name: string; team: string; skillId: string | null }
export interface ReconcileResult {
  identical: (ReconcileRow & { version: string })[];                      // adopt candidates: bytes === skills/<name>/<version>, basename === name
  differing: (ReconcileRow & { teamVersion: string; nextVersion: string; sameId: boolean; teamAuthor: string })[];
  renamed:   (ReconcileRow & { version: string; teamName: string })[];    // bytes match under another name; reported only
  adopted: string[]; published: string[];                                 // paths acted on (empty under --list)
}
```

**`root` (D6, GATED):** in-process only — not registered as a flag in `src/cli.ts`, not in `FRAME_VERBS` args;
its one caller is `project add` (§5 M2.4). It is canonicalised with the same rule the Library roots use and
**refused** (`failure`) unless it equals a configured project root after canonicalisation. A scan with `root` set
returns rows under that root only — global and other-project rows are excluded. Tripwire: the first request to
reconcile one project from the terminal promotes `root` to a documented `--root <path>` flag.

**`teamAuthor`** (correction 10) comes from the byline lookup that already exists in `src/commands/ls.ts`
(`bylines`: people `display_name <email>` → handle, `normalizeAuthor` on both sides) applied to the team skill's
`metadata.author`; when no person matches, the `metadata.author` string verbatim.

### 4.5 `install --adopt <path>`

**Grammar (D7):** terminal `install [ref] [value] --adopt <path>` — exactly one of a skill reference or an adopt
path. Refusals, each its own error line (§7): both given; neither given; `--into` or any destination flag with
`--adopt` (adopt copies nothing, so it has no destination); a path outside every Library root (the existing
`{path} is not a folder in your Library.`). Team from `--team` or the single configured team, as today. Scope is
derived from the folder: `global` under the global Library, that project under a registered project root.
`run()` routes `--adopt` before `parseRef`.

**Preconditions**, each its own error line: the path is a directory directly under a Library root (global or a
registered project; `resolveLibrarySkill`); its `canonicalDigest` equals exactly one `versionDigests` entry
of the selected team; the folder basename equals that entry's `name` (else
`"<path> holds the bytes of <name> Version K under a different folder name; rename it to <name> first."`);
the path is not already in `config.placements`.

**Effects, in this order (D5):** `ensureConsent` for the skill's `allowed-tools`; `pending` entry
`{ op:'install', destination, version:'v<K>' }`; `safeWrite` of `people/<handle>.json` `installed[]` (and
`local_skills`), filter-then-push exactly as `install.ts:174-183`; ledger
`placements[path] = { id, team, version:'v<K>', scope, placed_at, fingerprint: snapshotSkillDirectory(path).fingerprint }`;
pending cleared. **Adopt departs from `installOne`'s order on purpose:** `install` writes the ledger first because
it has a `place()` step whose freshly copied directory the ledger row must cover before anything else can fail;
adopt has no `place()` step, so writing the machine's record **last** means an interrupted adopt leaves at most a
pending row and a people-file entry, never an untracked placement — the folder stays visible to the reconcile
scan, the cards still read true from the bytes (D1), and re-running adopt finishes the job through the existing
pending self-drain (`install.ts:121`), the people-file write being idempotent. Do not "fix" the order back.
D11 receipt seeding is skipped (the overlay shows the score). Result: `InstalledResult & { adopted: true }`.

### 4.6 Setup step

CLI `Step` (`setup.ts:74`) and desktop `SETUP_STEP_KEYS` (`types.ts:144`) gain `'existing'` between
`'projects'` and `'evals'`. Outcomes: `done` (asked, acted or declined), `skipped` (`--no-existing`, `quiet`,
non-interactive, no team, or nothing to reconcile), `printed` (frame channel: summary printed, the shell owns
the choice). `SETUP_STEP_TO_BOARD.existing = 'Your skills'` (new tour board, §6 desktop).

### 4.7 Frames

`FRAME_VERBS` gains `'reconcile'`. `FRAME_FEATURES` gains `reconcile: true`; `FEATURE_KEYS` gains
`'reconcile'`; its **one** consumer is the Library's *Check against the team* action (§6). No new ask kind,
no protocol bump. `docs/frame-protocol.md` documents the `ls --local` row keys (M1 did; M1.1 adds
`localEval.mine`), `reconcile --list`, and `install --adopt`. `root` is not a frame argument (§4.4). Not added to
`SERVE_READ_VERBS` (`reconcile` without `--list` writes).

---

## 5. Milestones

### M1 — overlays and the version line (ledger D1, D2, D4, D5) — **landed `753efa4`; M1.1 amends it**

**Done means:** a hand-copied folder whose bytes equal a published version shows that version and the team's
newest score in the Library, shows `vN · installed ✓` on the Marketplace, and every card in both screens has a
filled version slot that never clips. After M1.1: the bytes decide the number on both mirrors, an edited install
says so and offers no Publish, the check wraps with the words, and card strings read `vN`.

1. `src/lib/version-digests.ts` — `versionDigests` (§4.2). *Landed.*
2. `src/commands/ls.ts` `showLocal` — once per load, for each configured team: `skillRecords`, `versionDigests`,
   and a receipt index `Map<content_digest, TeamEval[]>` built from `receiptFiles` over `evals/<uuid>/<v>/`
   (unreadable receipts skipped and reported once per file, the `localReceiptsFor` rule). Per candidate row,
   using the digest `evalOf` already computes: set `teamEval` (with `mine`), `matchedVersion`, `matchedName`,
   `matchedTeam`, `knownToTeam`. `localEvalStale` also considers team receipts for the same uuid at another
   digest. Rows that are not candidates get nulls and `knownToTeam` from frontmatter uuid alone. *Landed.*
   **M1.1:** stamp `mine` on the own-store `localEval` too, by the §4.1 definition.
3. `desktop/src/backend/tauri/index.ts` — `cliLocalRow` declares the five keys optional. *Landed.* **M1.1:**
   `cliLocalRow.localEval` gains optional `mine`; `libraryVersion` returns `matchedVersion ?? placement.version`
   (bytes first, D1); `libraryEval` breaks a `run_id` tie toward the team receipt and sets `runnerHandle` iff the
   shown receipt's `mine === false` (an absent flag on an own-store receipt keeps D11's "seeded copy names its
   runner" reading, §4.1); `inventoryCard` derives `installedVersion` in §3.2's order (byte match first). `library()`
   `overview.evaluated` unchanged in code (counts `localEval !== null`, which includes overlay evals — ledger D2).
4. `desktop/src/components/domain/presentation.ts` — **M1.1:** the card form lives in the vocabulary leaf as
   `cardVersionLabel(n)` (`src/lib/versions.ts`, beside `versionLabel`; it imports nothing, so the cross-tree
   import rule holds), used by `marketplaceVersionLabel`, `libraryVersionLabel`, `evalVersionLabel`,
   `profileVersionLabel` and the eval line's version (`cardRecordedVersion` for a recorded folder; a legacy tree
   hash keeps the prose rendering); `versionLabel`/`recordedVersionLabel` stay for prose callers
   (`SkillScreen.tsx`, the adapter's detail and dialog strings) — split, do not rename. One predicate
   `editedInstall(card)` (`installedVersion !== null && localMatch === 'differs'`) drives both the state-3b
   label and the Publish button's exclusion. `marketplaceVersionLabel` gains state 3b **before**
   the installed-equals-latest check: `installed !== null && localMatch === 'differs'` →
   `${cardVersion(latest)} · you have ${cardVersion(installed)} (edited)`. `libraryVersionLabel`'s state-2 string
   becomes `${cardVersion(version)} (edited)`; states 3–5 unchanged.
5. `desktop/src/components/domain/SkillCard.tsx` — the version label is the only text in the slot; **M1.1:** the
   Publish condition adds `installedVersion === null` (§3.2 predicate); the Edited chip renders only when
   `edited && localMatch !== 'identical'` (D1); the check leaves the switch's `else` branch and moves into the
   `.card-version` wrapper (item 6). **Publish** navigates to `detailPath(skill)+'?dialog=publish&root=marketplace'`.
6. `desktop/src/components/domain/SkillCard.css` — **wrap rule (ledger D4/D5 constraint, review D4):** one
   `.card-version` element in the **first** bottom-row group holds the label span and the check icon
   (`display:inline-flex; align-items:center; gap:4px; white-space:nowrap; flex-shrink:0`); the second group keeps
   Reinstall/Publish, flags and the enable switch. The bottom row stays `flex-wrap:wrap; row-gap:4px;
   min-height:20px`; `.skill-card` stays `min-height:148px` (variable height, D4b). Longest string to verify:
   `v10 · you have v2 (edited)` + check + Reinstall, at the narrowest card width the grid produces
   (`repeat(3–5, minmax(0,1fr))` has no floor), both themes. Nothing may clip or ellipsize inside the version
   words; the whole unit moves to the next row instead.
7. `desktop/src/backend/mock/{scenario,index}.ts` — **M1.1 (correction 4):** one new scenario, `?__mock=overlays`,
   produces every overlay state on both mirrors, on rows named here by position so a board and a test can point at
   them; the existing `stale-eval` and `on-disk-only` scenarios are unchanged. Marketplace under `overlays`: every
   placed card is state 3 (`latestVersion:'v5'`, `installedVersion:'v2'`, `localMatch:'identical'`), except the
   first placed card in fixture order, which is state 3b (`localMatch:'differs'`), and the second, which is state 2
   (`installedVersion:'v5'`); unplaced cards are state 1. `?__mock=on-disk-only`: the Marketplace's `deploy-check`
   gains `latestVersion:'v5'`, `localMatch:'differs'` and its `path`, so it is state 4 (`installedVersion:null`,
   `onDiskOnly:true`, `v5 · your copy differs` + Publish) rather than a bare card; the Library side is unchanged. `default` (unchanged): states 1
   and 6 (`installed:'recorded'`, one card) as today; state 5 needs no fixture (old CLI). Library under `overlays`:
   the first five Library cards in fixture order become §3.1 states 1–5 in order — `{installedVersion:'v3',localMatch:'identical',placed:true}`,
   `{installedVersion:'v3',localMatch:'differs',placed:true,edited:true}`,
   `{installedVersion:null,localMatch:'differs',placed:true,edited:true}`,
   `{installedVersion:null,localMatch:'differs',placed:false,knownToTeam:true}`,
   `{installedVersion:null,localMatch:'none',placed:false,knownToTeam:false}`; the first also carries a
   `localEval` with `runnerHandle:'ajayw36'` and `version:'v3'` (the eval line `run by ajayw36 · v3`). Other
   scenarios keep `localProjection`'s current rule (`'none'` for local-flagged rows, else `null`).
8. `docs/frame-protocol.md` (`localEval.mine`), `README.md` (Library/Marketplace paragraphs at lines 72–80 on
   main) if any card copy is quoted, and `src/lib/__tests__/invocation-catalog.ts` patterns for any reworded
   README row (correction 8). `desktop/FIDELITY.md` gains an OWED entry for the boards that draw a version line,
   an installed check or an edited card (the oracle renders only on the maintainer's Mac).

### M2 — reconcile (ledger D3)

**Done means:** joining a team, or adding a project, with matching skills already on disk ends with the team's
records reflecting what is on the machine — for every folder the person said yes to — and nothing else.

1. `src/commands/reconcile.ts` — scan via `createLibraryScan(home, config.projects, stateRoot)` over global +
   registered roots (or the one `root`, §4.4); candidate rows only; digest each; classify per §4.4 against every
   configured team (`skillRecords` + `versionDigests`); skip ledgered paths. Interactive: the §3.4 dialogue, then
   `installOne({ adopt })` and `publish.run({ ref: path })` per yes. `--list`: no asks, no writes. `--team`
   honoured. Registered in `src/cli.ts` as `reconcile` with `--list`, `--team` (no `--root`); in `FRAME_VERBS`.
2. `src/commands/install.ts` — `--adopt <path>` (§4.5); `run()` routes it before `parseRef`. `src/cli.ts`
   install command grammar becomes `install [ref] [value]` with `--adopt <path>`; the "exactly one" rule and the
   four refusals of §4.5.
3. `src/commands/setup.ts` — step `existing` after `projects` (`:338`) and before `evals` (`:341`):
   `if (args.quiet || args.existing === false || !io.interactive || teamName === '') steps.existing = 'skipped'`;
   else `section('existing')`, print the start line, run reconcile in interactive mode when
   `io.channel !== 'frames'`, else `--list` mode and `steps.existing = 'printed'`. `SetupArgs.existing?: boolean`;
   CLI flag `--no-existing`. Errors are non-fatal, as the projects step's are.
4. `src/commands/project.ts` `add` — after `addLibraryProject` returns `added: true`, run reconcile with
   `root` = the root just registered (§4.4; `added: false` runs no scan), interactive when
   `io.channel !== 'frames'`, else emit the `--list` result on the verb's result as `reconcile?: ReconcileResult`.
   `cliProjectAdded` in the desktop declares it optional. **Desktop coordinator (D6):** the add-project handler
   that already receives `cliProjectAdded` is the one place that opens `ReconcileDialog`, when `reconcile` is
   present and non-empty.
5. Desktop — seam `backend.reconcile.list(): Promise<Result<ReconcileResult>>` (one-shot `reconcile --list`);
   `backend.install` accepts `{ adopt: path }` (§4.3 `InstallArgs`). A `ReconcileDialog` (new component) renders
   the two groups as checkboxes — identical rows checked, differing rows checked only when `sameId`, each
   unchecked differing row carrying the rename note — and on confirm drives `install({adopt})` and
   `publish({ref})` per checked row, reporting per-row outcomes. Consumers: the onboarding board `Your skills`
   (fed by `steps.existing === 'printed'` → `reconcile.list()`), the `project add` handler above, and the
   Library's *Check against the team* action (the `reconcile` feature flag's one consumer).
6. `desktop/src/backend/setup-session.ts` — `SETUP_STEP_TO_BOARD.existing`, `printedSetupStep` prefixes
   `Checking your library against the team`, `of your skills match`, `Recorded `, `Published `, `Nothing to
   reconcile`; `askedSetupStep` prefixes `Record ` and `Publish your version of `.
7. `README.md` verb table: `reconcile [--list]`, `install --adopt <path>`, setup `--no-existing`.

---

## 6. Changes per file (index)

CLI: `src/lib/version-digests.ts` (landed), `src/commands/ls.ts`, `src/commands/reconcile.ts` (new),
`src/commands/install.ts`, `src/commands/setup.ts`, `src/commands/project.ts`, `src/cli.ts`,
`src/lib/frames.ts` (`FRAME_VERBS`, `FRAME_FEATURES`), `src/lib/__tests__/invocation-catalog.ts`,
`docs/frame-protocol.md`, `README.md`. Version bump for M2 to the next minor (`0.17.0`; `0.16.0` shipped with
M1 — new verb, new feature key).

Desktop: `src/backend/types.ts` (`SkillCard`, `SETUP_STEP_KEYS`, `FEATURE_KEYS`, `Backend.reconcile`,
`InstallArgs.ref?` + `adopt?`), `src/backend/tauri/index.ts`, `src/backend/setup-session.ts`,
`src/backend/mock/{data,index,scenario}.ts`, `src/components/domain/{presentation.ts,SkillCard.tsx,SkillCard.css}`,
`src/components/domain/ReconcileDialog.tsx` (new), the onboarding `Your skills` board, the Library action.
Implementing agents do not edit `GAPS.md`, `FIDELITY.md`, `AGENTS.md`, `README.md` (desktop) or
`package.json`; report the owed oracle for the new board and any re-recorded boards in the run report. (M1.1 is
built inline by the orchestrator, who does append the FIDELITY.md OWED entry.)

---

## 7. Copy (exact strings; the desktop matches some by prefix)

**Card versus prose (D4b).** Rows marked *card* are `SkillCard` strings and abbreviate a version to `v{N}`. Every
other row is prose — terminal output, dialogs, README, `docs/frame-protocol.md`, detail screens — and keeps
`Version {N}`. The two are never mixed on one line.

| Where | String |
| --- | --- |
| Library version slot *(card)* | `v{K}` · `v{M} (edited)` · `Edited` · `Unpublished` |
| Marketplace version slot *(card)* | `v{N}` · `v{N} · installed` · `v{N} · you have v{M}` · `v{N} · you have v{M} (edited)` · `v{N} · your copy differs` |
| Library eval line, teammate's run *(card)* | `run by {handle} · v{K}` |
| Library eval empty state *(card)* | `Not evaluated` · `Not evaluated · evaluated before your last edit` |
| Marketplace stale-eval line *(card)* | `from v{E} · latest v{N}` · `from v{E} · v{N} unreadable` |
| Profile line *(card)* | `On profile · v{P}` |
| Reconcile start | `Checking your library against the team…` |
| Reconcile summary | `{a} of your skills match the team's exactly; {b} share a name with a team skill but differ.` · `Nothing to reconcile: none of your skills match a team skill by bytes or by name.` |
| Adopt question | `Record {name} as installed (Version {K})?` |
| Publish question, same id | `Publish your version of {name} as Version {K+1} of the team's {name}? Your folder carries the team's id for {name}.` |
| Publish question, name only | `Publish your version of {name} as Version {K+1} of the team's {name}? Your folder carries no team id for this name, and the team's copy was published by {author}; publishing makes your content the next version of their skill. To keep them separate, rename yours first: {invocation} skill rename {path} --to <new-name>.` |
| Renamed group line | `{path} holds the bytes of {teamName} Version {K} under a different folder name; nothing is offered for it.` |
| Reconcile close | `Recorded {a} install(s). Published {b} skill(s).` |
| Adopt refusals (preconditions) | `{path} is not a folder in your Library.` · `{path} does not match any published version of a team skill byte for byte; publish it instead.` · `{path} holds the bytes of {name} Version {K} under a different folder name; rename it to {name} first.` · `{path} is already recorded as installed.` |
| Adopt refusals (grammar, D7) | `Give a skill to install or --adopt <path>, not both.` · `Nothing to install: give a skill, or --adopt <path> for a folder you already have.` · `--adopt records a folder where it is; it takes no destination.` |
| Reconcile `root` refusal (D6) | `{root} is not one of your registered projects.` |
| Library action | `Check against the team` |
| Onboarding board title | `Your skills` |

---

## 8. Tests

CLI (`src/commands/__tests__/`, `src/lib/__tests__/`):

- `ls-local-overlay.test.ts` — a fixture clone with `skills/a/v1`, `skills/a/v2`, receipts at `evals/<id>/v2/`
  with `content_digest` of v2; local folders: copy of v2 (→ `matchedVersion:'v2'`, `teamEval` set, own store
  empty), copy of v2 edited (→ null match, `knownToTeam:true`, `localEvalStale:true`), unrelated folder (→
  `knownToTeam:false`). Asserts `canonicalDigest(folder) === skillContentDigest(files)` on the v2 fixture with
  managed fields present **and an `evals/` directory present, which neither side counts** (the parity proof).
  *Landed; M1.1 retitles the placed-at-v2-bytes-are-v1 case to say the match is reachable and shows `v1`.*
- `ls-local-overlay.test.ts` — newest-wins between an own receipt and a team receipt for the same digest.
  **M1.1:** `localEval.mine` is true for a run by this machine's handle and false for a seeded teammate's run.
- `version-digests.test.ts` — numeric ordering, missing folder → absent key, concurrency bound. *Landed.*
- `reconcile.test.ts` — classification of identical / differing (`sameId` true and false) / renamed /
  ledgered-skip; `--list` writes nothing (config and clone byte-identical before and after); interactive
  yes → one `installOne` adopt and one `publish` call; no → nothing written. **D6:** under `root`, global and
  other-project rows are excluded; a non-registered `root` is refused; `added:false` runs no scan.
- `install-adopt.test.ts` — each §4.5 precondition refusal and each D7 grammar refusal (both, neither, `--into`
  with adopt); scope derivation for a global-Library folder and for a project-root folder; success writes ledger
  + people file and does **not** copy or move files (folder mtime and bytes unchanged, no `old-skills`).
  **D5, five interruption tests:** the process is killed after the pending write, after the people-file write,
  after the ledger write, and after pending clear; each re-run ends with exactly one placement, exactly one
  `installed[]` row for the skill, and zero pending rows; and the people file never gains a second row on replay.
- `setup.test.ts` — step order `projects → existing → evals`; `--no-existing` and `quiet` skip;
  frames channel → `printed`; a failing reconcile never fails setup.
- `project.test.ts` — `add` on a root holding a matching skill returns `reconcile.identical.length === 1`, and
  the result carries no rows from other roots.

Desktop (`desktop/src/**`):

- `skill-card-versions.test.tsx` — every row of §3.1 and §3.2 renders the exact card string in `vN` form;
  old-CLI rows (keys absent) render nothing in the slot and no `Unpublished`. **M1.1 rows:** placed at `v2` with
  `matchedVersion:'v1'` → `v1`, no Edited chip (D1), and its Marketplace twin → `v3 · you have v1`; edited install
  behind → `v10 · you have v2 (edited)` + Reinstall; edited install on latest → `v10 · you have v10 (edited)`,
  no Reinstall; Library edited install → `v2 (edited)`; the check renders inside `.card-version` for states 2–5
  and nowhere in the right-hand group; an edited install (state 3b) offers no Publish button, state 4 does; a
  byte-matched placed folder with `edited:true` shows no Edited chip. (`skill-card-actions.test.ts` covers the
  `⋯` menu, whose Publish row is gated on the local folder alone per parent §11.4 and is unchanged.)
- `desktop/src/backend/tauri/__tests__/index.test.ts` — `overview.evaluated` counts an overlay-eval card
  (correction 9); **M1.1:** a seeded twin (same `run_id` in both stores, team `mine:false`) names the runner; the
  same twin with team `mine:true` names nobody; `libraryVersion` prefers the byte match over the placement.
- `installed-state.test.tsx` — any assertion on the old Library words moves to `v{M} (edited)` / `vN`.
- `desktop/src/backend/__tests__/mock.test.ts` — **M1.1:** `?__mock=overlays` yields §3.1 states 1–5 on the first
  five Library cards and §3.2 states 3b/2/3 on the first three placed Marketplace cards; `?__mock=on-disk-only`
  yields state 4 on `deploy-check`.
- `e2e/routes/chip-icon.spec.ts` — **M1.1 retires it:** it asserted the `Installed · on this machine` card chip M1
  removed; `Chip.test.tsx` keeps the icon-in-label layout check.
- `SkillCard.test.tsx` (new) — `Installed · on this machine` text is gone; the check renders for states 2–5;
  Publish renders only for state 4; the bottom row wraps as a unit at 260 px card width (jsdom layout assertion
  on class presence plus an e2e screenshot gate below).
- `descriptions.test.ts` / `features.test.ts` — `reconcile` feature key has exactly one consumer.
- `setup-driver`/`setup-session` tests — `SETUP_STEP_KEYS` includes `existing`, `printedSetupStep` and
  `askedSetupStep` map the §7 prefixes.
- `ReconcileDialog.test.tsx` — default checks (identical on, `sameId` on, name-only off with note), confirm
  drives adopt/publish per checked row; the `project add` handler opens the dialog only when
  `cliProjectAdded.reconcile` is non-empty.
- e2e `routes/card-versions.spec.ts` — Marketplace and Library cards at the narrowest grid column show the
  full version string with no ellipsis and no overflow, light and dark.

---

## 9. Gates

- `npm run lint`, `npm run typecheck`, `npm test` at the repo root (with `TMPDIR` realpath export on macOS).
- `npm run --prefix desktop lint|typecheck|test`, then the e2e suites serially (port 1420 is single).
- Fidelity: boards that draw the old chip, a version line, an installed check or an edited card re-record; the
  `Your skills` onboarding board has **no oracle yet** and is filed as owed in the run report for the
  maintainers to add to `FIDELITY.md`. M1.1's re-record is owed the same way (the oracle renders on one Mac).
- Frames: `capture-frames` re-recorded for `ls --local` (M1.1: `localEval.mine`), `setup`, `project add`,
  `install`, `reconcile`.
- Reference-machine timing for the §4.2 GATE, reported as a number in the run report.

---

## 10. Out of scope and deferred

- Renamed-folder handling (bytes match under another name): reported only. Ledger D3 deferral.
- A `multiselect` ask kind: not needed — the terminal asks per row, the desktop uses `--list` plus its own
  dialog. Ledger D3 deferral stays open for a later UX upgrade.
- Version-digest cache: GATE in §4.2.
- A terminal `--root <path>` for `reconcile`: GATED behind the first request (review walk D6).
- Resumable adopt (a three-case precondition with a resume path): rejected in favour of write-last (review
  walk D5). Do not reintroduce.
- The team-record check (`check_decision`) over every LOCK in both ledgers: owed when the MCP accepts auth.
- Sync-time materialization of receipts into the local store (ledger D1 option B): rejected.
- Auto-publish of differing skills (ledger D3 option R3): rejected.

---

## 11. Human gates before this spec can be locked

1. **Ryan — copy.** §7 strings as revised: the `vN` card rows, `you have v{M} (edited)`, the D7 grammar
   refusals, the D6 root refusal, the name-only publish warning and `your copy differs`.
2. **Ryan — `install --adopt` consent.** Adopt runs `ensureConsent` for the folder's `allowed-tools`, so a batch
   of identical skills with grants asks one extra question each. Alternative: adopt records the approval
   silently because the skill is already on disk. This spec keeps the question; confirm or flip.
3. ~~**Ryan — layout.**~~ **Closed by review walk D4b (2026-09-13):** `.skill-card` keeps `min-height:148px` and
   grows when a label wraps, and card strings abbreviate to `vN` so wrapping is rare.
4. **Maintainers — fidelity oracle** for the `Your skills` board.
