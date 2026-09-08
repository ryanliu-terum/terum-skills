Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. The spec's line numbers were verified against main at f8557c4 and re-checked after PR #61; where a number and the code disagree, the code wins: find the quoted code.

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
2. **Capability flags only for the four hard gaps.** `capabilities()` carries `disablePerMachine`,
   `inboxEventLog`, `offtargetKind`, `machineRegistry`, `perCaseEvalTables`; the mock answers `true` to all of
   them and the UI renders every board as drawn. Everything else drawn is built as if real (no flag, no
   greyed control). Gaps are recorded by the maintainers in `GAPS.md`; an implementing agent never edits `GAPS.md`,
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

=================== THE SPEC: .planning/specs/m7-S7af.md ===================
# m7-S7af: adapter plumbing and the real-data rule (app-only)

**Status:** LOCKED for implementation (M7 queue, batch 1 of tranche 1). Rows AD-01 to AD-10. Approver named for information: Ryan (desktop/AGENTS.md invariants; he wrote M5/M6). Depends on: nothing. Every later batch with an app half stacks on this one.
**Sources (binding, in this order):** `.planning/decisions/2026-09-08-m7-takeover-decision-walk.md` (13 rulings), M7 document `.planning/research/2026-09-08-m7-close-the-canvas-gaps.md` §4 S7af, §8, §10.7, §10.8; the blank-map review's bugs 3, 4, 9, 11, 12, 15 and steps 2 and 7. Anchors below were re-verified against the current tree on the day this spec was written; quote the code, not the number, when in doubt.
**Governing rules:** `desktop/AGENTS.md` (all eight invariants; you are an implementing agent: never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md, package.json, design.json, tokens.css). The North Star: a teammate who opens the app sees only their team's real data on every visible surface, and nothing drawn promises something the CLI cannot do yet. When honesty and completeness conflict, hide the control.

## 0. What this batch is

No CLI change. The real adapter (`desktop/src/backend/tauri/`) gets the plumbing every later batch needs, and the shell learns the real-data rule: a surface whose read model is still a gap is hidden, a count comes only from `status` or is omitted, and nothing on the real adapter renders a design constant. Pixel-neutral on the mock: every locked fidelity board is unchanged (the mock declares every surface and keeps every count).

## 1. The seam change (`desktop/src/backend/types.ts`)

1. `Capabilities` (line 8) gains a sibling: `export interface Surfaces { status: boolean; settings: boolean; onboarding: boolean; library: boolean; skill: boolean; receipts: boolean; inbox: boolean; catalog: boolean; roster: boolean; update: boolean }` and `Backend` (`desktop/src/backend/Backend.ts`) gains `surfaces(): Promise<Surfaces>`. The mock answers `true` for every key. The real adapter answers `true` only for a read model it actually implements from CLI data: today that is none of the ten (all ten stay `gap()` in this batch), so every key is `false`. Later batches flip keys as they serve the model (S7k: status, settings; S7f: library, skill; S7b: roster, catalog; S7n: receipts; S7e: update; S7r: inbox, onboarding).
2. `Result<T>` (line 2) already carries an optional `value` on the failing arm; keep it and USE it (AD-01).
3. `SearchHit` (line 30) widens: `{kind; ref; name; description; team: string|null; category: string|null; author: string|null; installs: number|null; latest: string|null; endorsed: string|null; unresolved: boolean|null}`. Every new field is `?? null`, never undefined. `description` stays a string and is `''` on the real adapter until RM-30 lands (no fabricated caption, and never the author's email).
4. `ValidateArgs`, `InviteArgs`, `EvalArgs` gain `team?: string` (AD-06).
5. `PublishResult` gains `changed: boolean` (AD-08); `version` becomes `string | null` (the PR URL or the branch when the CLI returns one, else null: never `'main'`).

## 2. The adapter (`desktop/src/backend/tauri/run.ts`, `index.ts`, `bridge.ts`)

- **AD-01, value beside error.** In `run.ts`, the `result` frame's failing branch (`if (frame.ok) {…} else { const error = frame.error ?? '…'; finish({ ok: false, error }, …) }`) drops `frame.value`. Change it so a failing frame that carries a `value` is still mapped: `let value: TOut | undefined; if (frame.value !== undefined) { try { value = options.map(frame.value as TIn); } catch { value = undefined; } } finish({ ok: false, error, ...(value === undefined ? {} : { value }) }, { t: 'result', ok: false, error })`. Both parse sites in `index.ts` (`run()` and `read()`, which both call `map: (value) => map(schema.parse(value))`) therefore pass a partial value through unchanged. Why: `status` fails-with-value when any team clone is unreadable (`src/commands/status.ts`, the two `failure(…, {version, teams})` returns), so without this every status row would light only on healthy clones.
- **AD-04, print frames on a failing read.** `read()` in `index.ts` collects every `print` frame's line while iterating `job.frames`; when `job.done` resolves `ok:false`, append the collected lines to `error` (newline-joined, after the CLI's one-line message), the way `run.ts` already appends stderr on an unexpected exit. The success path is unchanged.
- **AD-05, the change notifier gets a consumer.** In `desktop/src/app/providers.tsx`, one `useEffect` (with the backend and query client in scope) does `const off = backend.subscribe(source => { void client.invalidateQueries({ predicate: q => affects(source, q.queryKey) }); }); return off;` where `affects` maps `ChangeSource` to query-key prefixes: `config` → status, settings, onboarding; `clone` → library, skill, catalog, roster, inbox, receipts, status; `placed` → library, skill, settings, status, catalog; `stamp` → status, settings, inbox. Keep it a pure function in `desktop/src/app/invalidation.ts` with a unit test.
- **AD-02, the query lifecycle.** `providers.tsx` creates the `QueryClient` with `staleTime: 0`; change the default options to `{ retry: false, staleTime: 30_000, refetchOnWindowFocus: true, refetchOnReconnect: false, refetchOnMount: 'always' }` so a minimise/restore does not re-run every mounted read model (the review measured +1 fetch per key per cycle; Settings ▸ Teams = 10 node processes and 15 git children at N=3), while a focus return still revalidates (Ledger D9: refresh on own actions and on focus; no timer, never a polling sync). Every `queryFn` in `desktop/src` that calls a backend read passes React Query's `signal` through to the backend where the seam accepts one: add an optional `{ signal?: AbortSignal }` second parameter to the ten read-model methods on `Backend` and to `read()` in `index.ts`, which cancels the run (`job.cancel()`) when the signal aborts. The mock ignores the signal. A stale board is a previously true board and must not be presented as current: never show a spinner over stale data (React Query's default keeps the old data while refetching; keep that).
- **AD-06, `--team` on every verb.** In `index.ts` every argv builder appends `['--team', team]` when the args carry a team: install (`args.team`? add `team?: string` to `InstallArgs` too if missing), uninstallSkill, connect (already), publish, sync, invite, eval, validate, team remove (already). A search hit's `ref` becomes `<team>/<name>` when the CLI returns `team` (see AD-10), so a bare ref from search resolves on a two-team machine. No CLI change.
- **AD-07.** `cliConnect` becomes `.optional()` (bare `connect` legitimately succeeds with no value: `connect.ts` returns `success(undefined)` and the frame omits `value`); the mapped `ConnectOutcome | undefined` stays.
- **AD-08.** publish: `version: value.prUrl ?? value.branch ?? null`, `changed: value.changed ?? true` (declare `changed: z.boolean().optional()` on `cliPublish`; when the CLI does not send it, the safe reading of a successful publish is "changed", so `true`, and the PR body says so). Never invent `'main'`.
- **AD-09.** validate: `read(['validate', args.ref || args.cwd || '', …])` and refuse (as today) when both are empty; today `{ref:'', cwd}` sends `['validate','']`, which the CLI resolves as the process cwd and scans `.git/**`.
- **AD-10.** `cliSearch` keeps its fields and gains `team: z.string().optional()`, `endorsed: z.string().optional()`; the mapping fills every `SearchHit` field from the hit (`?? null`), sets `ref` to `${hit.team}/${hit.name}` when `team` is present else `hit.name`, and `description: ''`. Delete the composed `"<category> · by <author> · N installs"` string (it leaks the author's email).
- **Argv order (AD-17 belongs to S7d, not here):** do not reorder builders in this batch.

## 3. The shell (`desktop/src/components/domain/Sidebar.tsx`, `Shell.tsx`, the four screens)

- `Shell.tsx` already queries `capabilities`; add `const surfaces = useQuery({ queryKey: ['surfaces'], queryFn: () => backend.surfaces() })` and pass `surfaces.data` to `Sidebar`.
- `Sidebar.tsx` omits the Inbox nav group (Inbox, Pushes, Updates, Alerts) when `surfaces?.inbox === false`, and the Share row when `roster === false`, the Marketplace row when `catalog === false`, the Projects rows when `library === false`; while `surfaces` is undefined (loading) render as today. The mock declares every surface, so the 88 locked boards do not move; on the real adapter today the sidebar shows Library ▸ Global only. Settings is reached from the top bar and its screen renders the drawn error board (that is honest); do not hide the gear.
- **Delete the four hard-coded sidebar `COUNTS` literals** so a count comes only from `status` or is omitted (`Sidebar` draws the count span only when the value is present): `InboxScreen.tsx` (the `{ Global: '30', Terum: '22', … }` object passed when `!items.length`), `ShareScreen.tsx` (the design `COUNTS` copy keyed on a team of one), `LibraryScreen.tsx` (the `{Global:'0',Terum:'22',…}` object on the empty state), `MarketplaceScreen.tsx` (the `state.mock === 'empty'` literal). Each screen passes `counts={undefined}` (let the Shell's `status` decide) or `null` while loading, exactly as the other branches already do. The mock's `status()` already returns `COUNTS` (with `Global:'0'` in the `empty` scenario), so LibraryEmpty's "sidebar Global count 0" board still renders 0 from `status`, not from a literal. Run the fidelity gate mentally against `FIDELITY.md`'s notes for LibraryEmpty, LibraryLoading, LibraryError, ShareEmpty, InboxEmpty: counts hidden while loading/error; the empty boards read their counts from the mock's status.

## 4. GAPS.md (maintainer file: describe in `openQuestions`, do not edit)

The orchestrator re-anchors `desktop/GAPS.md` to f8557c4 and adds the PF-08 line (opt out of publishing install records: HARD, ships as drawn). Put any gap you discover in the report's `openQuestions`.

## 5. Tests (existing layouts; `*.test.ts(x)` beside the code)

- `backend/tauri/__tests__/run.test.ts`: a failing result frame with a `value` settles `{ ok:false, error, value: <mapped> }`; a failing frame without a value settles without `value`; a mapping error on a failing frame's value keeps the error and drops the value.
- `backend/tauri/__tests__/index.test.ts` (new): with a fake Bridge that replays recorded frames: `read()` appends print lines to a failing error; `--team` appears on every argv when given; `cliConnect.optional()` accepts a bare `connect` result without `value`; publish carries `changed` and `version: null` on the push-policy path; validate refuses `{ref:'', cwd:''}` and sends `['validate','/checkout']` for `{ref:'', cwd:'/checkout'}`; a search hit maps every field and never contains the author's email in `description`.
- `backend/__tests__/mock.test.ts`: the strict capability `toEqual` gains `surfaces()` (all true).
- `Sidebar` test: with `surfaces.inbox === false` the Inbox group is absent; with the mock's surfaces every group renders; counts come only from the `status` result.
- `app/invalidation.test.ts`: the `ChangeSource` → query-key map; a settled run invalidates the mapped queries (spy on `invalidateQueries`).
- **The real-data proof (orchestrator-run, but write the test):** `backend/tauri/__tests__/replay.test.ts` replays `.planning/codex-runs/m7-S7af/frames/status.jsonl` (recorded by the orchestrator from the fixture team over `--frames status`) through `read()` with a fake Bridge and asserts the served result for `status` is the typed gap in this batch (`ok:false`, the GAPS.md sentence) and that a failing `status` frame with `value` yields `value.teams.length === 1`. Replay `search.jsonl` and assert the three hits carry `team: 'acme'`, `category`, `installs`, `latest`, `endorsed`, `unresolved` from the frame and `description === ''`.

## 6. Acceptance (your gates; report real counts)

`npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` in `desktop/` (baseline: typecheck 0, lint 0, 37 files / 492 tests before the strings PR; expect the new counts). No Playwright, no git, no npm install, no network. Verify each write by reading the file back. Ambiguity → conservative reading + `openQuestions`.

## 7. Out of scope

Any CLI change; the ten read models' implementations (they stay `gap()`); argv reordering (S7d); the Rust shell (S7ag); `app.json` fields (S7ad); the Inbox feed (S7r); the BootError rows; the `TZ` avatar and the project literals in the sidebar (design walk).


=================== STANDING CONSTRAINTS ===================
- Work only where the spec names files (desktop/ and, for S7ag, desktop/src-tauri/). Read the per-directory README for every subtree you touch before your first edit there (desktop/src/backend/tauri/README.md in particular).
- Gates: from desktop/, run `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` and report REAL counts (baseline at main 099d486: typecheck 0, lint 0, 40 files / 514 tests). For a Rust change also run `CARGO_TARGET_DIR=/Users/ryanliu/Documents/Terum/.m7-cargo-target cargo check --manifest-path desktop/src-tauri/Cargo.toml` (warm; ~30 s) and report warnings.
- No git (not even `git status`), no npm install, no network, no Playwright (`npx playwright …` will not launch here; say so, never fake a pixel or lifecycle result). node_modules and the generated fixture (design.json, tokens.css) are in place and must not be edited.
- Never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md, package.json, design.json, tokens.css, e2e/**, tools/**; put what those files would need into openQuestions.
- Never delete or weaken a test to make a suite pass; change an assertion only to the new truth and declare it in testsModified. No eslint-disable without a same-line reason. No test-only branches in components.
- Every new field the real adapter maps is `?? null`, never undefined; every new key on a zod object is declared, never left to passthrough; the real adapter never renders a design constant, a sample value or a fabricated caption.
- If the spec is ambiguous, record the question in openQuestions and implement the most conservative reading. Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged. Verify each write by reading the file back.
- Your final message must be the JSON report the output schema demands: status complete only if every spec item was implemented and the gates ran.
