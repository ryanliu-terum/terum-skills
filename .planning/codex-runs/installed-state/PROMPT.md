# Implement the locked spec below: installed = present-or-placed by id; project root; People install fix

Read `AGENTS.md` at the repo root FIRST, then `CLAUDE.md`, then `desktop/AGENTS.md` (the desktop app's
eight invariants) and `desktop/FIDELITY.md`, and follow them exactly. This repo's conventions are NOT in your
context unless you read those files; Codex does not auto-load them.

## Project context (from .claude/codex/preamble.md — filled for skill-management-software / terum-skills)

You are implementing inside **terum-skills** (npm `terum-skills`, Apache-2.0): a CLI (`src/`) that lets a
team share private Claude Code skills through one private git repo with no server, plus a Tauri + Vite +
React 19 desktop app (`desktop/`) that drives the CLI over its frame protocol (`docs/frame-protocol.md`,
`src/lib/frames.ts`, `desktop/src/backend/tauri/`). The build spec `.planning/specs/2026-09-02-phase-1-build.md`
is authoritative over the decision ledger; `desktop/AGENTS.md` is authoritative for the app.

Deliberate exceptions here, not defects: `safeWrite` hard-resets the clone to `origin/main`; `publish` under
the `"pr"` policy pushes a branch and exits when `gh` is missing; hand-edited placed copies are overwritten on
`sync` and quarantined; provenance comes only from the `placements` ledger, never from scanning disk (THIS spec
adds a second, separate fact — PRESENCE by `metadata.id` — and keeps every deletable path ledger-only);
`src/lib/placer/vendor/skillhub/` carries attribution headers on purpose.

Verify claims of absence: before asserting that a function, field or test does not exist, grep for it and
quote the result. Before writing a new function, grep for one that already does the job and extend or replace
it in the same change; never leave two active paths doing the same thing (root CLAUDE.md "Before implementing").

## Standing constraints for this run

- Sandbox: `workspace-write`, no network, **no git commands at all** (not even `git status`); `node_modules` is
  already in place at the repo root and under `desktop/` (symlinks; do not `npm install`). If a step cannot run
  in the sandbox, say so in the report; never fake a result. The sandbox may EPERM on `desktop/node_modules/.vite-temp`
  when running the desktop vitest suite; if that happens, report it as "could not run in sandbox" — the
  orchestrator's own gate run is authoritative.
- Do not commit, stage, or push. Leave every change in the working tree.
- Gates you run and report with REAL counts: root `npm run lint && npm run typecheck && npm test && npm run build`;
  desktop `npm --prefix desktop run typecheck && npm --prefix desktop run lint && NODE_OPTIONS=--no-experimental-webstorage npm --prefix desktop test`
  (Node 25 needs `NODE_OPTIONS=--no-experimental-webstorage` for the desktop suite). Never run Playwright. Never
  run `playwright install`. Never read or write `$TERUM_DESIGN_DIR`.
- Never delete or weaken an existing test to make a suite pass; declare every existing-test change in
  `testsModified`. Every new test must be one that FAILS on the tree before your change and PASSES after (the
  orchestrator proves this on a scratch worktree of origin/main for at least three of them).
- Absolute paths in shell commands; do not `cd`. Use `npm --prefix desktop …` for the desktop package.
- If the spec is ambiguous, implement the most conservative reading and record the fork in `openQuestions`.
  The "Pre-resolved decisions" section below closes the forks the orchestrator already saw; do not reopen them.
- **Documentation edits that this spec names are explicitly authorized** and override desktop/AGENTS.md
  invariant 2's "an implementing agent never edits GAPS.md / AGENTS.md" for exactly these files and exactly the
  edits in §3 (the desktop/AGENTS.md rule sentence) and §7 (phase-1 spec, m7-S7g.md, desktop/GAPS.md,
  docs/frame-protocol.md). Do not touch FIDELITY.md, README.md or any package.json.
- Final answer: the JSON object matching the output schema you were given (status, summary, filesChanged,
  gates, openQuestions, deviations, invariantsTouched, testsModified, bugLogsCreated, leastConfidentClaim).

---

# THE SPEC (locked; investigator + Codex converged; Ryan ruled the label: "Installed · on this machine" for unplaced copies, actions only for ledger placements)

Line numbers refer to origin/main 279830d, which is exactly the tree you are in. Implement §1–§7 in the order
given in §8. One working tree, no commits.

## §1 Definitions and the label/affordance rule

Two facts kept separate:

- **PRESENT** = a folder under a scanned skills root whose `SKILL.md` `metadata.id` equals the team skill's id.
  Presence grants the WORD "Installed" and Edit-in-place.
- **PLACED** = a `config.placements` entry for that folder (id + team). Placement grants Remove, sync-managed
  updates, and the enable switch when `disablePerMachine` lights.
- Name-only matches are ABSENT (build spec §6: "never folder name"). Folder names are never a join key.

State table (card = SkillCard on Library/Marketplace; rail = SkillDetail's right rail; Library "Installed"
scope; counts):

| state | card | rail (status line / sub-line) | actions | Library "Installed" scope | counts |
|---|---|---|---|---|---|
| placed, no problem | no Install button, switch slot as drawn | "Installed" / "Loaded in every session" · version from placement | Edit (row.path) · Remove | included | installed |
| placed with `problem`, or health `gone-from-repo` / `unknown` | `broken` flag with the problem text, no Install | "Installed · needs attention" / problem text | Edit · Remove | included | installed |
| present, not placed (connected true or false) | green check chip "Installed · on this machine", no Install button, no switch | "Installed · on this machine" / "This copy is yours, not placed by Terum. Connected: yes/no · <path>" | Edit (row.path) · "Manage with Terum…" (§4); NO Remove | included | count text "N on this machine · M placed" |
| present in a project root only | same as above plus scope tag "in <repoRoot>" | same | same | included | same |
| absent | "Install" | "Not installed" | Install | excluded | — |

Coverage note (always, on the real adapter): Library/Marketplace subtitle gains "Scanned: ~/.claude/skills[, <project root>]"
with an "Add a project checkout" link (to `#/settings/machine`) when no project root is set.

A row that is placed AND connected: placed wins for actions; the rail adds "Connected source: <source path>".

## §2 CLI `ls --local` row schema

- `src/lib/skill-source.ts`: `inspectSkillSource` returns `{ ok: true, description, id: string | null }` where
  `id = parsed.metadata.id` when it is a string matching the UUID rule the schema already uses
  (`skillIdSchema = z.uuid()` in `src/lib/schema.ts:21`), else `null`. (`SourceInspection` at :10; `inspect()` at
  :39–:67 returns `{ ok: true, description: parsed.description }` at :66 — add `id` there.)
- `src/lib/local-skills.ts`: `LocalEntry` (:14) gains `skillId: string | null` (`null` for rejected/failed
  inspections; the candidate branch at :128 carries `inspection.id`).
- `src/commands/ls.ts`: `LocalSection.rows[]` (:23, built at :177) gains on every row: `skillId: string | null`,
  `placed: boolean` (`placement !== null`), `connected: boolean` (`shared.length > 0`). `placement`, `shared`,
  `health`, `problem`, `path`, `tracked` unchanged; the section keeps `root`/`scope`/`repoRoot`; every occurrence
  stays its own row. `notOffered[]` entries (:178) also gain `skillId`. Printed sentences are byte-identical.
- Hello: `FRAME_FEATURES.localIdentity: true` (`src/lib/frames.ts:39`).
- `docs/frame-protocol.md`: note the additive keys and the feature (in the Versioning section: additive, protocol
  stays 1).
- Tests (`src/commands/__tests__/ls.test.ts`, fail-before/pass-after): untracked folder with a UUID id →
  `skillId` equals it, `placed:false`, `connected:false`; placed folder → `placed:true`, `skillId` equals the
  ledger id; connected-and-placed → both true, `state` still starts "conflicting tracking"; rejected inspection →
  `skillId` null; non-UUID id → null; printed output unchanged (the existing snapshot/line assertions).

## §3 App schema relaxation + derivation

- `desktop/src/backend/tauri/index.ts:48` `cliLocalRow` stays `.strict()` and declares
  `skillId: z.string().nullable().optional()`, `placed: z.boolean().optional()`, `connected: z.boolean().optional()`.
  (`cliLocal` at :101 reuses `cliLocalRow`, so status/settings reads relax with it.)
- `FEATURE_KEYS` (`desktop/src/backend/types.ts:9`) gains `localIdentity`.
- Derivation replaces `placement()` (:59–:61): `onDisk(local, team, id, features)` → rows (each carrying its
  section's `scope`/`root`/`repoRoot`) where `row.placement?.id === id && row.placement.team === team` (placed)
  `|| (features.localIdentity && row.skillId === id)` (present). Then `card.installed = rows.length > 0`;
  `card.placed = rows.some(r => r.placement && r.placement.id === id && r.placement.team === team)`;
  `card.onDiskOnly = installed && !placed`; `card.paths = rows.map(r => [r.path, r.scope])`. With an older CLI
  (no keys, no feature) present never fires → today's two states, no read failure.
- Record the rule in `desktop/AGENTS.md` (one sentence, in invariant 2 or a new short paragraph after the
  invariants): a new `ls --local` key is declared optional in the app before or with the CLI that emits it,
  never after.
- `SkillCard` type (`types.ts:19`): `installed` = present-or-placed; new `placed: boolean`, `onDiskOnly: boolean`,
  `paths: [string, string][]` (every producer — mock derive, fixtures, tests — fills them; the mock's default
  scenario sets `placed = installed`, `onDiskOnly = false`, `paths = []` so nothing drawn changes).
- `inventoryDetail` (:66–:73) uses the placed row's `path`, else the first present row's `path`, else the clone
  fallback (`skills/<name>`); `version` stays placement-based.
- `library({scope:'installed'})` (:257–:266) filters on `installed`. `catalogModel`'s project `installed` (:152)
  uses `placed`.
- Tests (`desktop/src/backend/tauri/__tests__/index.test.ts`, replay fixtures under
  `.planning/codex-runs/installed-state/frames/*.jsonl`): placements `[]` + global row
  `{name:'decision-walk', skillId:<team id>, placed:false, connected:false}` → card `installed:true, placed:false,
  onDiskOnly:true`; same row without `skillId` → `installed:false`; placed row → `installed:true, placed:true`;
  placed row with `problem` → `flags:['broken']`, still `placed`; row in a project section → `paths[0][1] === 'project'`;
  a frame with an unknown extra key on a local row still fails to parse (strictness preserved).
- Screen tests (vitest + Testing Library, next to the existing screen tests): a card with `onDiskOnly` renders
  "Installed · on this machine" and no Install button; the rail renders the path and "Manage with Terum…", not
  Remove.
- Mock backend: add an additive `__mock` scenario `on-disk-only` (`desktop/src/backend/mock/scenario.ts`) that
  serves `deploy-check` as present-not-placed; no locked board changes (FIDELITY.md).

## §4 Consented recovery "Manage with Terum…"

- CLI: `connect <path>` when the folder's `metadata.id` already exists in the selected team AND the name matches
  that record → instead of refusing at `src/commands/connect.ts:160` (`Skill name ${name} already exists in team
  …`; the in-tree re-check at :185 is unchanged), print
  "This folder already carries the id of <name> in team <team>. Record it as your connected source on this machine? (y/N)"
  (ask it through `io.confirm`); on yes write `shared[id] = { source, team, baseline: canonicalDigest(source) }`
  (no mint, no push, no source edit), and return `{ id, name, reconciled: false, adopted: true }`; later
  `sync`/`publish` use the existing three-way reconciler (`reconcileShared`, :205). On no: the typed decline
  (`CancelledError('Connect was declined.')`, as :176). Refusal remains for a name match with a different or
  missing id. Read the folder's id from the raw frontmatter (`FRONTMATTER` + `YAML.parse`, as `inspect()` does;
  reuse `inspectSkillSource` or a shared helper — one path, not two parsers).
- `ConnectResult` (`src/commands/connect.ts` type; `desktop/src/backend/types.ts:62`; `cliConnectResult` at
  `index.ts:32`) gains optional `adopted?: boolean`.
- App: the "Manage with Terum…" button on the rail opens a dialog that explains the two outcomes (the folder
  already carries the team skill's id → it is recorded as your connected source, nothing is edited or pushed; a
  folder without the id → connect asks to add license/id/author) and runs `backend.connect({ path })` with the
  row's path (its `ask` frames go through `PromptContext` / `driveRun` like install's "Approve these tools"
  dialogs do — follow the existing `onRun`/`driveRun` pattern in `SkillScreen.tsx`); declining yields the
  CLI's `declined:true` result and closes the dialog.
- Tests (`src/commands/__tests__/connect.test.ts`): matching id+name asks and writes `shared`; declined writes
  nothing; id match with a different name refuses; no id refuses as today.

## §5 Project root: pref, writer, invalidation, cwd split

- Pref key `machine:projectRoot` (absolute path string) added to `isChromePreference`
  (`desktop/src/backend/prefs.ts:6–8`); the mock uses the same allowlist through `browserPrefs`, so nothing else
  is needed there beyond any explicit key list a test pins.
- Writer: Settings ▸ This machine (`desktop/src/screens/settings/SettingsContent.tsx:67–71`, `case 'machine'`)
  gains a "Project checkout" row with a path text field (`WorkflowField`, like the identity fields) and a Clear
  button; the description echoes `ls --local`'s `repoRoot` ("Scanning <repoRoot>") or the CLI's noRepository
  message when the path is not inside a git repository (the adapter surfaces this from the `ls --local` print
  line "Project skills: none (<cwd> is not inside a git repository)." or from the absence of a project section —
  keep it honest: a settings field `projectRoot: { pref: string | null; repoRoot: string | null; note: string | null }`
  on `Settings` is the conservative shape). Put the row at the END of the "This machine" section (after
  Quarantine) so existing pixels do not move; render it only when the real adapter is active — gate it on a new
  `Surfaces` flag `projectRoot: boolean` (`types.ts:12`; the mock returns `false`, the real adapter `true`) so
  the mock boards are unchanged.
- Invalidation: the adapter subscribes to its own pref store (`backend.prefs.subscribe`) and, when the value of
  `machine:projectRoot` changes, calls `notify('placed')` (`desktop/src/app/invalidation.ts` maps `placed` to
  library, skill, settings, status, catalog).
- cwd split in `run()` (`index.ts:185–:188`): drop the `workspace` pref read at :185; `run(argv, schema, map,
  touches, { cwd })`. Read verbs that scan (`ls --local`, wherever it is spawned: :209, :263, :284, :303) pass
  `cwd = prefs 'machine:projectRoot' || home`. EVERY write verb (`install`, `uninstall-skill`, `sync`, `connect`
  without a path, `publish`, `eval`, and the rest of the long verbs) passes `cwd = home` explicitly, never the
  scan root, never inherited, so `matchingProject` (`src/commands/install.ts:234–:240`) cannot turn a scan root
  into a project-scope placement. `home` is `bridge.homeDirectory()`; if it resolves to `''` (unknown) pass
  `undefined` (inherit) and nothing else.
- Tests (fake bridge spawn args: `__tests__/fake-bridge.ts` records `cwd` per spawn): `catalog()` spawns
  `ls --local` with the pref cwd; `install()` spawns with `cwd === home` even when the pref is set;
  `run.test.ts`: no verb spawns with `cwd` undefined when the fake bridge's home is known.

## §6 Clear fixes

- (a) People bulk install: the `ls member` result gains `member.installed: {id, scope, since}[]`
  (`src/commands/ls.ts:95`, `showMember` already prints it at :94). `cliLs.member` (`index.ts:50`) declares it
  optional. `catalog()` (:305–:312) computes `person.installable` = the installed ids mapped to team skill names
  (ids the team no longer has are dropped) and `onDisk` over that set; the page button
  (`desktop/src/screens/marketplace/MarketplaceScreen.tsx:41`) reads "Install N skills" with
  `N = installable.length`, hidden when 0 with the line "<handle> has no recorded installs to copy"; authored
  skills stay the Authored bucket with their own on-this-machine counts. `Person` (`types.ts:27`) gains
  `installable: string[]`; the mock derives `installable` so the drawn count on MarketplacePerson /
  MarketplacePersonNotInstalled does not change (use the same names the page counts today). Test: replay with
  `installed []` → no button and the line; two installed ids → "Install 2 skills" and `install` member called once.
- (b) 0/0 contradiction: rail (`market-components.tsx:56`) and page (`MarketplaceScreen.tsx:35`) share one helper
  `personStatus(p)` → `['Nothing to install', …]` when the total is 0; test both places show the same words.
- (c) Problem rows: `inventoryCard` sets `flags: ['broken']` and `flagText.broken = row.problem ?? 'placed copy
  could not be inspected'` when a placed row has `problem` or health `unknown`/`gone-from-repo`; `installed`
  unchanged; test.

## §7 Spec amendments (paste verbatim)

- `.planning/specs/2026-09-02-phase-1-build.md` §6, immediately after the S7g paragraph (the paragraph starting
  `**S7g (RM-39/RM-40/RM-44 subset).**` at :368), add:

  "§6 amendment — installed state (Ryan, 2026-09-09). Every ls --local row and notOffered entry carries skillId (the folder's metadata.id when it is a UUID, else null), and rows carry placed and connected (independent booleans: a folder may be both). A skill is present on a machine when a scanned row's skillId equals its id; it is placed when a row's placement names its id and team. Presence grants the word Installed and the Edit-in-place path; placement alone grants Remove, sync replacement and the enable switch. Folder names are never a join key. connect <path> on a folder whose id and name already exist in the team asks once and records it as the connected source without minting, editing or pushing. Hello advertises features.localIdentity."

- `.planning/specs/m7-S7g.md` §0 and §2, one note each (same sentence):

  "Superseded in part by the §6 installed-state amendment: installed = present-or-placed by id join over ls --local rows; version and every action remain placement-based; the app's cliLocalRow stays closed but declares the three keys optional."

- `desktop/GAPS.md`: replace the "workspace" absence (there is no line naming a `workspace` pref today — add the
  entry under "Other drawn affordances without a CLI counterpart" where checkout paths are discussed, i.e. the
  MarketplaceProject/Projects/People line that says "checkout paths are machine-local and come from cwd") with
  the `machine:projectRoot` pref and the read/write cwd rule (reads scan `machine:projectRoot || home`; every
  write verb runs at home); add the notOffered-with-id limitation (a rejected folder that carries a team id is
  listed in `notOffered` with its `skillId` but is never counted as present).

## §8 Order

(1) CLI keys + `localIdentity` + tests; (2) app schema/feature/derivation + card/rail states + tests;
(3) project-root pref, writer, invalidation, cwd split; (4) People / 0-0 / problem-row fixes;
(5) connect adopt + "Manage with Terum…".

---

## Pre-resolved decisions (do not reopen; cite in the report if you deviate)

1. Folder picker: `@tauri-apps/plugin-dialog` is NOT bundled (desktop/package.json, src-tauri/Cargo.toml) → a
   plain text field + Clear. Do not add a dependency.
2. New drawn strings on locked boards (the coverage note, the on-disk-only chip, "Manage with Terum…", the
   Project checkout row, "Nothing to install", the no-installs line): they render only from real-adapter data or
   the new `__mock=on-disk-only` scenario. The mock's default/other scenarios keep every existing string and box
   so the 88 locked boards are pixel-identical. Concretely: `Library` gains `scanned: string[] | null` (mock
   `null` → note not rendered); `Surfaces.projectRoot` gates the Settings row; the mock's `installable` matches
   today's drawn count.
3. Replay fixtures under `.planning/codex-runs/installed-state/frames/`: hand-author the `.jsonl` files (one
   frame per line: `hello`, optional `print`s, then `result`) from the CLI's real result shapes; the orchestrator
   re-records them against the built CLI afterwards. Name them `ls-local-on-disk-only.jsonl`,
   `ls-local-placed.jsonl`, `ls-local-placed-problem.jsonl`, `ls-local-project.jsonl`, `ls-member-installed.jsonl`,
   `ls-member-none.jsonl` (or similar; list them in `filesChanged`).
4. The `hello.features` for the derivation come from the cached hello frame (`hello?.features.localIdentity`
   after the `ls --local` run has completed; `features()` already reads it).
5. `ConnectResult.adopted` is additive; frame protocol stays 1.
6. Keep every printed CLI sentence byte-identical (§2 and §6a print nothing new except the §4 question).
7. The `Settings` DTO change for the project root is additive; the mock fills `projectRoot: null`.

## Anchors verified on this tree (so you do not re-derive them)

- `src/lib/skill-source.ts`: `SourceInspection` :10; `inspectSkillSource` :26; `inspect()` :39–:67.
- `src/lib/local-skills.ts`: `LocalEntry` :14; the candidate branch :128; `candidatesOf` :139.
- `src/commands/ls.ts`: `LocalSection` :23; `showMember` :85–:96 (`member.installed` printed at :94, result at :95);
  `showLocal` :110–:194 (rows pushed :177, `notOffered` :178, printed line :181).
- `src/lib/frames.ts`: `FRAME_FEATURES` :39–:43.
- `src/commands/connect.ts`: `connectOne` :133–:196; name refusal :160; mint :162; consent :172–:177;
  `shared` write :190; `reconcileShared` :205.
- `desktop/src/backend/tauri/index.ts`: `cliConnectResult` :32; `cliLocalRow` :48; `cliLs` :49–:52;
  `placement()` :59; `inventoryCard` :62; `inventoryDetail` :66; `cliLocal` :101; `settingsModel` :123;
  `catalogModel` :145 (project `installed` :152); `cwd()` :185; `run()` :187–:204; `readModels` :206 (`ls --local` :209);
  `library` :257; `skill` :272; `catalog` :298 (`ls member` :307, `onDisk` :311); `install` :321; `connect` :324.
- `desktop/src/backend/types.ts`: `FEATURE_KEYS` :9; `Surfaces` :12; `SkillCard` :19; `Person` :27; `Library` :32;
  `ConnectResult` :62; `PrefStore`/`Subscription` :82–:83; `Settings` :86.
- `desktop/src/backend/prefs.ts`: `isChromePreference` :6–:8. `desktop/src/backend/tauri/prefs.ts`: `nativePrefs`
  with `subscribe` :44.
- `desktop/src/app/invalidation.ts`: the `placed` prefix list :7.
- `desktop/src/screens/settings/SettingsContent.tsx`: `case 'machine'` :67 (Identity :68, Placed here :69,
  Tool approvals :70, Quarantine :71).
- `desktop/src/screens/skill/SkillScreen.tsx`: `DetailRail` :25 (status words, `Loaded in every session`,
  the Edit/Remove buttons at :42).
- `desktop/src/components/domain/SkillCard.tsx`: the switch / Install button branch :15.
- `desktop/src/screens/marketplace/market-components.tsx`: `MarketRail` :52 (status :56).
  `desktop/src/screens/marketplace/MarketplaceScreen.tsx`: `DetailPage` :31 (`total`/`installed` :34–:35, the
  Install button :41).
- `desktop/src/backend/tauri/__tests__/fake-bridge.ts` records `{ id, args, cwd }` per spawn; `homeDirectory()`
  returns `/Users/teddy`. `index.test.ts` has a `replay(value, ok, prints)` helper; `run.test.ts` covers `cliRun`.
- `desktop/src/backend/mock/scenario.ts`: `MockScenario` union + `readScenario`.
- Existing fixture convention: `.planning/codex-runs/m7-S7g/frames/ls-local.jsonl` (one JSON frame per line).
