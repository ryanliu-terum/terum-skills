Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. This branch is main 14ccc45 after S7af, S7ag, S7f, S7q, S7k, S7ad and S7d (adapter plumbing and Backend.surfaces(); the Rust child lifecycle; Library and Skill detail served from ls/search; hello-features wiring with Backend.features() and every flag gated; status() and settings() served from the real status read model; typed declines with Result.cancelled, one failed result frame on a usage error, FRAME_FEATURES as a frozen snapshot, and the verb, flags, --, positionals argv order): build on them, do not redo them. Line numbers in the spec were verified on this tree; where a number and the code disagree, the code wins.

=================== AGENTS.md (repo root) ===================
# AGENTS.md — loader for non-Claude agents (Codex)

You do not run this repo's Claude hooks and nothing auto-loads `CLAUDE.md` for you. Read this
file first, then `./CLAUDE.md`, then the document that owns what you are touching.

## What this repo is

The planning and harness repo for **terum-skills**, an open-source CLI (npm `terum-skills`,
Apache-2.0) that lets a team share private Claude Code skills through one private git repo, with
no server. **There is no product source yet.** When implementation starts, code lands under
`src/` in the layout the build spec §3 defines. Until then, "the code" means the spec.

## Which document wins

1. `.planning/specs/2026-09-02-phase-1-build.md` — the **build spec**. Authoritative. Rev and
   date are in its status line; every rev is a full replacement, not a delta.
2. `.planning/specs/2026-09-01-team-skill-sharing.md` — the **decision ledger** (D1…D39).
   Background and rationale. Where it and the build spec disagree, the build spec wins.
3. `.planning/decisions/2026-09-01-team-skill-sharing-decision-walk.md` — the decision walk.
   History of how forks were closed. Decision 3 was reopened 2026-09-03; its reopen note wins
   over the original text below it.
4. `.planning/specs/reviews/*.codex-spec.r*.review.md` — prior audit rounds. Evidence, not rules.

Status tags in the ledger mean what they say: DECIDED is settled; PROPOSED is a recommendation;
OPEN is blank on purpose. In the build spec, **`[default — veto cheap]`** marks a default the
author chose to close a gap — implement it as written, do not treat it as undecided.

## Invariants you must hold when you write code here

- **Nothing runs anywhere but laptops and the git host.** No HTTP client, no server, no daemon,
  no third-party CLI on the install path. Shell out only to `git` and `gh`. One exception, recorded
  in `.planning/decisions/2026-09-08-desktop-app-cli-decision-walk.md` (D7, D8): `terum-skills app`
  also runs the platform's own tools to unpack and open the desktop app (`tar`, `open`, the NSIS
  installer it downloaded through `gh`), through the `Exec` seam in `src/lib/runner.ts`.
- **Every write to the team repo goes through `safeWrite()`** (build spec §6.0): fetch, hard-reset
  the clone to `origin/main`, re-run a *pure* mutation, commit, push, retry to a 30-second deadline.
  A mutation that does I/O, mints an ID, or prompts is a bug.
- **The guard is the authorization model** (§6.0 table): a diff may touch only the paths the
  caller owns. Do not add a write path that bypasses it.
- **Consent is a predicate on the normalized `allowed-tools` set** (§5.4 `approvals`). A changed
  grant hash is no approval. `sync --hook` never places an unapproved grant; it announces on
  stderr and prints nothing else but the reload directive on stdout.
- **Provenance is the `placements` ledger** (§5.4). It is the only source of deletable paths.
  Never infer ownership from what happens to be on disk; never write a marker inside a placed
  folder; never delete outside `~/.terum/skills/quarantine/`.
- **Placement is native and explicit** (§7): copy into a temp sibling, rename into place, under
  the per-target lock, into the directory the agent path table names for the agent the caller
  passed. Never auto-detect agents, never prompt for scope, never write `.agents/skills` in
  phase 1.
- **Vendored code keeps its provenance.** `src/lib/placer/vendor/skillhub/` holds two files copied
  from iflytek/skillhub `cli/src/services/` (Apache-2.0): `skill-fingerprint.ts` and
  `skill-target-lock.ts`. Upstream carries no per-file copyright header, so each copy gets an
  attribution header naming the source path, the pinned commit, the license, and whether it was
  modified, plus a NOTICE entry (build spec §3). The Claude Code path row is *derived* from
  skillhub's profile (both paths are `.claude/skills`), not copied — its profile factory bundles
  auto-detect, which is not vendored. Do not vendor its auto-detect, prompt, or in-folder
  metadata code.
- **Frontmatter is Agent-Skills-legal** (§5.3): top-level `name`/`description`/`license` only;
  everything custom nests under `metadata`. Skill folder name equals frontmatter `name`.
- **One active path per behavior.** Before writing a function, grep for one that already does the
  job and extend or replace it in the same change. Never leave two paths doing the same thing.

## Gates and sandbox

- Run with `--sandbox workspace-write`. `--dangerously-bypass-approvals-and-sandbox` is banned.
- Never `git push --no-verify`. Never push at all unless the task says so.
- Once `src/` exists: `npm run lint`, `npm run typecheck`, `npm test` (vitest, collocated under
  `src/**/__tests__/`, bare-repo fixtures, no network). Report their real output; a self-reported
  green gate is a hypothesis the reviewer re-runs.
- Use absolute paths in shell commands; do not `cd`.

## Things that look wrong and are not

- `safeWrite` hard-resets the clone. Deliberate: no local commit is ever carried forward, so there
  is nothing to rebase or conflict.
- `publish` under the `"pr"` policy pushes a branch and exits when `gh` is missing. Deliberate: a
  missing tool never downgrades a review gate to a direct push.
- A hand-edited placed copy is overwritten on `sync` and moved to quarantine. Deliberate: placed
  copies are generated output, not an authoring surface; the source is what you edit.
- The session hook is async and promises no same-session reload. Deliberate: a network pull must
  never sit in front of session start.
- Handles are per team, not global. Deliberate: it is the only shape in which a second-team
  collision is recoverable.
- `metadata.author` is `Name <email>`, never the handle. Deliberate: SkillEvaluator's schema.
- The hidden `readme` verb writes `README.md` in the current clone directly, not through `safeWrite`.
  Deliberate: it is the GitHub Action's entry point on the host's compute, where there is no
  `~/.terum` config and the Action itself commits; on a laptop, README regeneration for
  non-GitHub remotes still happens inside `safeWrite` (§9).
- `guard.ts` accepts a `previousAuthor` for `sync` only, and only for a write that touches
  `SKILL.md` alone with canonical content unchanged. Deliberate: it is the §5.3 managed-field
  refresh after a config email or license change; it can never carry a content change.


=================== desktop/AGENTS.md ===================
# AGENTS.md — terum-skills-app (read this first, follow it exactly)

This repo is the terum-skills desktop frontend: a Vite + React 19 + TypeScript (strict) app that runs in a
browser on a mock backend and is held pixel-faithful to the boards of a private design canvas that is not part of this repository. When that
canvas is on the machine, `TERUM_DESIGN_DIR` names its folder (`build.py` there generates `<Board>.dc.html`;
`.shots/<Board>.png` are the read-only renders that the fidelity gate diffs against); when it is not, every
design-dependent gate skips or fails with a one-line message. Implementing agents write the app code from written
specs; the maintainers write the specs, run every gate themselves, and do all git.

## The eight invariants (report each one you touch in `invariantsTouched`)

1. **The seam.** `src/backend/` owns every non-mock capability. Nothing outside `src/backend/` imports
   `@tauri-apps/*`, reads `location`-independent I/O, touches the filesystem, or opens a socket. No component
   ever branches on `isTauri()` or any platform probe: platform-shaped behaviour (window chrome mode, editor
   opening, clipboard) comes from `Backend.capabilities()` and the backend methods. Screens import only
   `src/backend/types` + `src/backend/index` (`useBackend()`), never `src/backend/mock/**`,
   `src/backend/tauri/**` or `src/fixtures/**`. An ESLint `no-restricted-imports` rule and a vitest test that
   greps the tree enforce this. Seam names follow the CLI pinned at `b5c0507`: the verb is `connect`
   (`Backend.connect(args: ConnectArgs): Run<ConnectOutcome | undefined>`, `ConnectResult`, `ConnectBatch`),
   `Backend.uninstallMachine`, `Backend.setup({ target?, offerConnect? })`, `ValidateResult { name, findings,
   warnings }`. The Prompter has exactly five members: `interactive`, `confirm`, `text`, `select`, `print`
   (there is no `secret()`).
2. **Flags come from the CLI, and every flag has exactly one consumer.** `capabilities()` carries
   `disablePerMachine`, `inboxEventLog`, `offtargetKind`, `machineRegistry`, `perCaseEvalTables` (plus the
   platform-shaped `windowChrome`, `openInEditor`, `clipboard`); `features()` carries the CLI's twelve
   `hello.features` switches plus `memberRole`. The real adapter fills both from the `hello` frame it caches
   from any run (`disablePerMachine` straight across, `perCaseEvalTables` from `perCase`, a missing key
   `false`; `inboxEventLog`, `offtargetKind`, `machineRegistry` stay hard `false` until a mechanism exists).
   The mock answers `true` to all of them and the UI renders every board as drawn. A control whose switch is
   `false` is hidden (or degraded exactly as the S7q spec table says), never disabled or stubbed; a screen
   reads a switch through `useFeatures()` / `useCapabilities()`, never by probing the platform, and never
   invents a flag. Gaps are recorded by the maintainers in `GAPS.md`; an implementing agent never edits `GAPS.md`,
   `FIDELITY.md`, `AGENTS.md`, `README.md` or `package.json` — describe what you found in the report's
   `openQuestions` / `deviations` instead.
3. **Generated files.** `src/styles/tokens.css` and `src/fixtures/design.json` are written only by
   `python3 tools/export-design.py` (which imports the design canvas's `build.py` from `TERUM_DESIGN_DIR` or
   `--design`, and exits 2 with one line when neither is given; `--check` exits 1 when either file is stale). Never hand-edit them; regenerate them. Fixture strings are `build.py`'s values
   verbatim (some carry HTML entities such as `&lt;` or `&#39;`, or inline `<b>` tags): decode entities for
   text rendering; render `<b>` as the design does.
4. **The fidelity oracle.** `$TERUM_DESIGN_DIR/.shots/<Board>.png` is read-only:
   never write, update, or "re-baseline" there, and never point Playwright's snapshot directory at it. The
   per-class tolerance map lives in `e2e/fidelity/tolerance.ts` and is authoritative: `screen: 0.0030`,
   `dialog: 0.0035`, `state: 0.0020` (empty / loading / error / no-results), `full: 0.0025` (full-page and
   stretched boards); Main and Light are exact (0 differing pixels). Those four numbers never change. No
   mask without a written reason in `FIDELITY.md` (today: none), and a test never reads a tolerance or a mask
   from `FIDELITY.md` — it reads only each row's status. Printed command strings are the boards' verbatim
   (`npx -y terum-skills@latest <verb>`, and `share` where the boards print `share`), never re-derived
   from the CLI's current verbs.
5. **Pixels come from the boards.** Every screen reproduces the geometry of its `<Board>.dc.html` exactly:
   same box model, same px values, same font sizes and weights (400 / 500 / 510 / 590), same colours via the
   tokens. Inter is `@fontsource-variable/inter/standard.css` (family `"Inter Variable"`; the default import
   is the wrong, wght-only binary); the mono face is `@fontsource-variable/jetbrains-mono` (family
   `"JetBrains Mono Variable"`). `body` carries `font-feature-settings: "cv01", "ss03"` and
   `-webkit-font-smoothing: antialiased`. Icons are the design's inlined `ICON_PATHS` (24-viewBox, stroke
   1.5, `currentColor`), never Lucide. Theme is `data-theme="dark" | "light"` on `<html>`, stamped before
   React mounts (default dark).
6. **The eval report is components over the receipt JSON.** The UI never runs evals and never derives a
   statistic: no list is sorted or ranked by a receipt number, no lift-style decimal at card level beyond
   what the board draws, `—` when there is no receipt, a greyed verdict when the run is partial, and numbers
   from different `model` / `cc_version` never share one comparison surface.
7. **No shortcuts in tests or lint.** Never delete or weaken a test to make a suite pass (declare any test
   change in `testsModified`). No `eslint-disable` without a reason on the same line. No test-only branches
   in components: every board state is reachable from the URL (`?tab=`, `?dialog=`, `?rail=closed`,
   `?theme=`, `?menu=`, `?filters=open`, `?q=`, `?overview=0`) and the mock scenario switch `?__mock=`
   (`error | empty | loading | slow | disabled | not-installed`). Handle failure modes explicitly (a
   `Result.ok === false` renders the board's error state; an unexpected prompter question opens a new
   dialog; a stale fixture parse throws at boot with the field path).
8. **The gates and the sandbox.** An implementing agent runs `npm run typecheck && npm run lint && npm test` and reports
   real counts. The maintainers run those three plus `npm run export:check`, `npx playwright test e2e/routes
   --workers=2` and `npx playwright test e2e/fidelity --workers=2` outside the sandbox (never run `playwright install` on a
   maintainer's machine; CI installs its own Chromium). Inside the sandbox: no git
   (not even `git status`), no network, no `npm install` (node_modules and the generated files are already
   in place), no commits; verify every write by reading the file back; if a step cannot run in the sandbox
   (a browser will not launch), say so in the report and do not fake a result. Ambiguity → implement the
   most conservative reading and record the fork in `openQuestions`; never resolve a design fork yourself.

## Stack pins (do not add, remove or bump without a spec saying so)

vite 8.2.2 · react / react-dom 19.2.8 · typescript 5.9.3 (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`) · tailwindcss 4.3.3 via `@tailwindcss/vite` (the theme
is reset with `--*: initial` and rebuilt from the design's scale; `tokens.css` is generated) · @base-ui/react
1.8.0 · react-router 8.3.1 with `HashRouter` (never `react-router-dom`) · @tanstack/react-query 5.102.8 ·
zustand 5.0.15 with `persist` (localStorage in the mock) · react-markdown 10.1.0 + remark-gfm 4.0.1 ·
zod 4.5.4 at the fixture boundary · @fontsource-variable/inter 5.3.0 (`standard.css`) ·
@fontsource-variable/jetbrains-mono 5.3.0 · vitest 4.1.11 + Testing Library + jsdom 30.0.1 ·
@playwright/test 1.63.0 · pixelmatch 7.2.0 + pngjs 7.0.0 for the fidelity diff · eslint 10.10.0 flat config +
typescript-eslint 8.70.0 + eslint-plugin-react-hooks + eslint-plugin-react-refresh. No Storybook, no Lucide,
no shadcn, no msw. Native: `src-tauri/` (tauri 2.11, plugins opener · store · clipboard-manager · window-state · log) and `@tauri-apps/api` 2.11 + the matching plugin JS packages, imported only under `src/backend/tauri/` (M5/M6, 2026-09-08).

## Layout

```
index.html                  theme boot script (stamps data-theme from localStorage before React mounts), #root
vite.config.ts              port 1420 strictPort; host from TAURI_DEV_HOST; watch.ignored src-tauri; envPrefix VITE_ + TAURI_ENV_*
tools/export-design.py      build.py constants -> src/styles/tokens.css + src/fixtures/design.json (--check)
src/main.tsx                createRoot; providers (backend, QueryClient, theme); ErrorBoundary
src/app/                    App.tsx (HashRouter), routes.tsx (the one route table), store.ts (useUiStore), providers.tsx
src/backend/                types.ts · Backend.ts · prompter.ts · index.ts (pickBackend, useBackend) · mock/ · tauri/ (the real adapter; README there)
src-tauri/                  the Tauri shell: tauri.conf.json (macOS Overlay chrome, ad-hoc signing), src/lib.rs (the CLI bridge), capabilities/
src/components/ui/          Base UI wrappers + Icon, Kbd, Button, Skeleton, Chip, Tooltip, Menu, Popover, Dialog, Select, Switch, RadioGroup, Checkbox, Slider, Tabs
src/components/domain/      TopBar, Sidebar, Footer (the shell), ViewHeader, StatTile, SkillCard, ... (design components)
src/screens/<family>/       one folder per board family (frame, library, skill, inbox, marketplace, share, settings, onboarding, search)
src/fixtures/               design.json (GENERATED) + schema.ts (zod)
src/styles/                 tokens.css (GENERATED) + app.css (@import tailwindcss; @import tokens.css; @theme; fonts)
e2e/routes/                 one Playwright smoke test per route + state (*.spec.ts)
e2e/fidelity/               boards.ts (name -> route, class, viewport, hover), tolerance.ts, fidelity.spec.ts, fidelity.md-parser
e2e/out/                    gitignored: actual / diff PNGs and report.json
FIDELITY.md · GAPS.md       maintainer-owned status files (never edited by an implementing agent)
```

Conventions: `.spec.ts` under `e2e/` is Playwright; `*.test.ts(x)` anywhere is vitest. PascalCase components,
`use*.ts` hooks, kebab-case lib modules. Every screen renders inside `<ScreenFrame>` which marks
`document.documentElement.dataset.appReady = "true"` once its content has committed (the gates wait on it).
The clock the mock reports is the design's `TODAY` (2026-09-06); relative times derive from it. Commit
messages, branches and merges are the maintainers' job; an implementing agent leaves changes in the working tree, unstaged.


=================== SPEC: .planning/specs/m7-S7b.md ===================
# m7-S7b: the people-file metadata (`role`, `projects`, `profile`, `decline`), the hello inventory gate, and the Share and Marketplace surfaces (CLI + app)

**Status:** LOCKED for implementation (M7 queue, batch 10 of tranche 1). Rows PF-03, PF-04, PF-07, PF-09, AD-25, AD-26, CP-19. Approver named for information: Ryan. Depends on S7af, S7c, S7d and S7q (stack on the unmerged ones in that order: S7d for `frames.ts`, S7q for the features mapping). **Ledger D13:** this batch changes exactly ONE line of `FRAME_FEATURES` after S7d's snapshot rewrite: it ADDS `memberRole: true` (additive; protocol stays 1) and updates the snapshot test accordingly. **Ledger D1:** `roles` keeps meaning the Admin/Member permission chip and stays `false`; the roster job label is `memberRole`. **Ledger D2:** no favorites/follow fields.
**Sources:** the takeover ledger (D1, D2, D3, D13); the M7 document §4 S7b with both lenses (binding: register the two new verbs in `FRAME_VERBS` (there is no `lib-entry.ts`); give them seam methods and adapter mappings or state the control stays read-only; the D20 pref deletion must NOT remove the Admin/Member `role:<handle>` pref (that is TJ-02/S7h's chip), only separate the job label from it; the `team join` revert hazard); the costing §2 PF-03, PF-04, PF-07, PF-09 paragraphs; §10.8 AD-25/AD-26. Anchors re-verified on main 14ccc45 (2026-09-09): `personSchema` (`src/lib/schema.ts:54-64`, `.passthrough()`, `bio` at :61, `declined` at :63), `GuardAction` (`guard.ts:10`), `PEOPLE_ACTIONS` (`guard.ts:36`), row (b) at `guard.ts:49`, `team join`'s people-file rewrite (`team.ts:406-417`: `display_name` at :410, `bio: existing?.bio ?? ''` at :414), `FRAME_VERBS` (`src/lib/frames.ts:32`), `FRAME_FEATURES` (`frames.ts:39-42`, twelve keys after S7d's rewrite; `COMMANDER_NON_ERRORS` follows it), `RosterEntry { handle; displayName }` (`src/lib/skills.ts:67`, read by `status`'s `members[]` at `status.ts:22`), the `ls` roster at `ls.ts:39`, the app's `FEATURE_KEYS` (`desktop/src/backend/types.ts:9`; add `memberRole` there, to `Features`, and to the adapter's `features()` mapping so S7q's one-consumer rule holds), `surfaces()` at `desktop/src/backend/tauri/index.ts:210` (`roster` and `catalog` are `false` today). S7c (`login --set`, also touching `src/cli.ts`) is in flight and unmerged: do not depend on it; the orchestrator folds the `cli.ts` registration conflict.
**Governing rules:** root `AGENTS.md` (safeWrite-only writes; the guard authorises the PATH, not the field set; the pre-image is read INSIDE the mutation); `desktop/AGENTS.md`; the North Star.

## 0. What this batch is

The Share roster and the Marketplace people cards draw a job label, a Teams column and a decline list that no committed file carries. Each person's own file gains `role` and `projects`; two owner-written verbs set them (`profile`) and record a decline (`decline`); the guard admits one more action on the person's own path; sync needs no code because the file is passthrough and every writer re-serialises the parsed document. The app implements `roster()` and `catalog()` from `status`, `ls`, `ls member <handle>` and `ls --local`, flips Share and Marketplace on, and reads `memberRole` from the hello frame.

## 1. CLI half

- **Schema (`src/lib/schema.ts`):** `personSchema` gains `role: z.string().max(32).optional()` after `bio` and `projects: z.array(z.string().min(1)).optional()` after `declined`. OPTIONAL, never `.default(...)`: a default materialises the key into every people file on the next unrelated write (the one additive config field that shipped, `app`, is `.optional()` for the same reason). Readers treat absence as `''` / `[]`.
- **Guard (`src/lib/guard.ts`):** `GuardAction` gains `'profile'` and `'decline'`; `PEOPLE_ACTIONS` gains both; row (b) (`path === people/${context.handle}.json && PEOPLE_ACTIONS.includes(context.action)`) admits them unchanged. No team.json row, nothing else.
- **`profile` verb (new `src/commands/profile.ts`, `src/cli.ts` registration, `FRAME_VERBS` entry):** `profile [--name <display>] [--bio <text>] [--role <role>] [--project <name>]...` writes ONLY self-describing fields of the caller's own people file through `safeWrite` with action `profile`; `email`, `github` and `handle` are refused (reclaim evidence and binding identity). `--project` validates each name against `team.json`'s project registry read from the PRE-IMAGE tree inside the mutation (a concurrent `publish` may change `projects[].skills`). `--name` ALSO writes `config.display_name` through `ConfigStore.update`, or the next `team join` from another laptop reverts the committed name. Prints what it changed; result value `{ handle, changed: string[] }`.
- **`decline` verb (new `src/commands/decline.ts`, registration, `FRAME_VERBS`):** `decline <ref>` appends the skill id to the caller's `declined` list (id-keyed, append-only, idempotent) through `safeWrite` with action `decline`, refusing an id already installed by the caller (say `uninstall-skill` first). Result `{ handle, id, declined: true }`. (PF-09: the app's "Decline" on a share row.)
- **`team join` (`team.ts:407-418`):** the reclaim rewrite preserves `role` and `projects` exactly as it preserves `bio` (`existing?.role`, `existing?.projects`); test it.
- **Readers:** `ls`'s roster entries gain `role: string | null` and `projects: readonly string[]`; `status`'s `members[]` (`RosterEntry`) gain the same; `ls member <handle>`'s `member` block (BM-04, S7f) gains them too. Every field `?? null` / `[]` on the wire.
- **CP-19 (the inventory gate, A8):** `src/lib/__tests__/frames.test.ts` gains the gate: every registered public verb (walk `buildProgram(...).commands`, skipping hidden ones) appears in `FRAME_VERBS` and vice versa (so `profile` and `decline` cannot be forgotten), and every `FRAME_FEATURES` key is documented in `docs/frame-protocol.md`'s features sentence. The three refused command strings were fixed on the boards by PR #61; nothing to do there.
- **`FRAME_FEATURES` (`src/lib/frames.ts`):** add `memberRole: true` (one line; `roles` stays `false`; update S7d's snapshot test). `docs/frame-protocol.md` names `memberRole`.
- Spec: §5.2 people-file fields (`role`, `projects`, both optional, owner-written, never refreshed by sync), §6 `profile` and `decline` paragraphs, the §6.0 permitted-writes table's row (b) note (two more actions on the same path) in `.planning/specs/2026-09-02-phase-1-build.md`.
- Tests: `schema.test.ts` (optional fields; absence stays absent after a parse/serialise round trip), `guard.test.ts` (row b admits `profile`/`decline` on the caller's path and refuses another handle's), `profile.test.ts` (each flag; refused fields; `--project` validated against the pre-image; `--name` updates config), `decline.test.ts` (append, idempotent, refuses an installed id), `join.test.ts` (reclaim preserves role/projects), `sync.test.ts` propagation regression (a people file with `role` and `projects` survives an install, an orphan adopt and an orphan decline byte-identical in those two fields), the R1 concurrency test (a writer capturing the document outside the mutation fails when two `profile` writes land: one `--role`, one `--project`; `safeWrite` re-applies on conflict), `frames.test.ts` (CP-19 gate; the snapshot with `memberRole: true`).

## 2. App half (`desktop/src/backend/tauri/index.ts`, `types.ts`, `mock/`, Share and Marketplace screens)

- Seam: `Backend.profile(args: { name?; bio?; role?; projects? }): Run<{ handle: string; changed: string[] }>` and `Backend.decline(args: { ref: string }): Run<{ id: string }>`; adapter `run()` mappings with `touches: ['clone']`; mock equivalents.
- **AD-25 `roster()`:** from `status` members (`handle`, `displayName`, `role ?? ''`, `projects`) and `ls` (`active`); `status`'s permission chip stays hidden on the real adapter (`features.roles === false`, S7q) and its `role:<handle>` localStorage pref is NOT deleted here (it backs TJ-02's chip; S7h replaces it with host truth; note it in the PR body); the job label reads the people-file `role` and shows only when `features.memberRole` is true; `joined`/`lastSeen` `—` (no field). The D20 obligation of THIS batch is the separation: the label never reads a pref. Flip `surfaces.roster = true`.
- **AD-26 `catalog()`:** `ls` (skills, Top rated sorted by installs, categories from the skills' categories with counts), `ls member <handle>` per person for their authored skills and `declined`, `ls --local` for `installed`, `status` for the roster; `projects` from S7f's `LsResult.projects` (present after S7f; `[]` when absent), `bulkInstall: {}`; `followers`/Follow hidden (D2). Flip `surfaces.catalog = true`.
- Share screen: the job label column and the Teams column render from the roster fields (hidden when `memberRole` is false); the "Remove from team" action stays; Marketplace people cards likewise. Pixel-neutral on the mock (the fixture's ROSTER carries `role` and the MEMBER map carries projects).
- Tests: `index.test.ts` for both read models and the two verbs' argv; the real-data proof replays `status.jsonl`, `ls.jsonl`, `ls-member-*.jsonl`, `ls-local.jsonl` recorded from THIS branch's rebuilt CLI against the fixture (whose people files gain a `role` for one member in the fixture script, the orchestrator adds it) and asserts the served roster and catalog carry real handles, the real role, real installs and no design constant.

## 3. Acceptance
Root: `npm run lint && npm run typecheck && npm test && npm run build`. Desktop: `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test`. No Playwright, no git, no network, no installs.

## 4. Out of scope
Favorites/follow fields (D2); the Admin/Member chip and `ls --host` (S7h, D3); `lastSeen`/`joined` derivations (PF-05/PF-06, later); any team.json field; `GAPS.md`.


=================== STANDING CONSTRAINTS ===================
- Read the per-directory README for every subtree you touch before your first edit there (desktop/src/backend/tauri/README.md in particular).
- Gates: from desktop/, `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` (baseline on this branch: 53 files / 751 tests); for a CLI change also, from the repo root, `npm run lint && npm run typecheck && npm test && npm run build` (baseline 73 files / 1203 tests; `src/lib/__tests__/runner.test.ts` "kills a sleeping git alias and its child" is a known load flake on this machine and inside the sandbox, re-run it alone before reporting it red). Report REAL counts.
- Recorded fixture frames from the CLI at main (status, ls, ls --local, ls member mira, ls project terum, search '') are in .planning/codex-runs/<batch>/frames/*.jsonl for your replay test. If your batch changes the CLI payload (S7b does: the `ls`/`status`/`ls member` roster entries gain `role` and `projects`; two new verbs), rebuild the CLI (`npm run build` at the root) and re-record: copy /Users/ryanliu/Documents/Terum/review-2026-09-08-desktop-blank-map/fixture.sh into your run record dir, set its CLI= line to <this worktree>/dist/index.js, run it with a fixture root INSIDE your run record dir (e.g. .planning/codex-runs/<batch>/fx; the git commands it runs act on that scratch fixture, not on this repository, and are allowed), then `printf '' | HOME=<fx>/home node <this worktree>/dist/index.js --frames <verb> [args] > frames/<verb>.jsonl` for each verb your surfaces read (run from inside <fx>/repo/seed; HOME on the node process); S7b reads `status`, `ls`, `ls member mira` (the fixture gives mira `role: Platform` and `projects: [terum]`), `ls member seed`, `ls member ravi`, `ls --local`, and records `profile --role Platform` and `decline <id>` result frames against the fixture for the two write verbs. Commit nothing.
- No git on THIS repository (not even `git status`), no npm install, no network, no Playwright (`npx playwright …` will not launch here; say so, never fake a pixel result). node_modules and the generated fixture (design.json, tokens.css) are in place and must not be edited.
- Never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md at desktop/ root, package.json, design.json, tokens.css, e2e/**, tools/**; put what those files would need into openQuestions. The root README.md is editable only when the spec says so.
- Never delete or weaken a test to make a suite pass; change an assertion only to the new truth and declare it in testsModified. No eslint-disable without a same-line reason. No test-only branches in components; screens never branch on the mock scenario.
- Every new field the real adapter maps is `?? null`, never undefined; every new key on a zod object is declared, never left to passthrough; the real adapter never renders a design constant, a sample value or a fabricated caption; a surface flips to served only when its read model is real.
- If the spec is ambiguous, record the question in openQuestions and implement the most conservative reading. Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged. Verify each write by reading the file back.
- Your final message must be the JSON report the output schema demands: status complete only if every spec item was implemented and the gates ran.
