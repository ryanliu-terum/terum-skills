Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. This branch is main 14ccc45 after S7af, S7ag, S7f, S7q, S7k, S7ad and S7d (adapter plumbing and Backend.surfaces(); the Rust child lifecycle; Library and Skill detail served from ls/search; hello-features wiring with Backend.features() and every flag gated; status() and settings() served from the real status read model with launchTarget() reading run/app.json; typed declines with Result.cancelled and the verb, flags, --, positionals argv order): build on them, do not redo them. This batch is app-only: no CLI change. Line numbers in the spec were verified on this tree; where a number and the code disagree, the code wins.

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


=================== SPEC: .planning/specs/m7-S7r.md ===================
# m7-S7r: the app-only batch (chrome, the preference store, the adapter rules the mock already carries, onboarding routing, driving `setup`, the RM-17 consumer)

**Status:** LOCKED for implementation (M7 queue, batch 12 of tranche 1). Rows AC-01, AC-02, AC-03, AC-05, AC-10, AC-12, AC-13, AC-14, AC-15, AC-16, MC-02, MC-03, MC-08, IB-01, IB-04, IB-09, CP-21, CP-25, CP-41, RM-12, RM-17, RM-33, RM-34, RM-35, RM-06, **RM-24** (paired in by the launch handoff so a joiner's first run works in tranche 1). Approver: none (no CLI change). Depends on S7af and S7k (stack while unmerged). Size L.
**Anchors re-verified on main 14ccc45 (2026-09-09):** `@tauri-apps/plugin-store` ^2.4.0 and `tauri-plugin-store = "2"` are dependencies, `store:default` and `window-state:default` are granted in `desktop/src-tauri/capabilities/default.json`, `tauri-plugin-window-state = "2"` is in `Cargo.toml`; `Backend.launchTarget()` (`desktop/src/backend/Backend.ts:9`, tauri adapter `index.ts:196`); the query client sets `refetchOnWindowFocus` in `desktop/src/app/providers.tsx:13`; the route table is `desktop/src/app/routes.tsx` (`/onboarding/:step` at :33); the tauri adapter's `PrefStore` is `localStorage` today (`index.ts:295-304`); `tauri.conf.json` window `minWidth: 960, minHeight: 600` (:18-19). Main already serves `status()` and `settings()` (S7k; `StatusResult.machine.name` is `''`, `hostname` `''`), `launchTarget()` (S7ad), typed declines (`Result.cancelled`, S7d) and `Settings ▸ Updates` (S7e, in flight).
**Sources:** the takeover ledger (D9: refresh on own actions and on window focus plus a Sync now action; NO timer, NO native file check, NEVER a polling sync; D10: window minimum stays 960x600, the sideways-scroll CSS is S7x's; D2: favorites/follow hidden; D4/S7ad: `app.json`'s `target` and `writtenAt`); the M7 document §4 S7r and S7w (RM-24's four pieces), §10.8 (Onboarding and Inbox return only when served from real data); Teddy's rule (the Inbox stays hidden until IB-01's feed is real); the costing §3.1 app-side rows. `desktop/AGENTS.md` invariants bind; nothing here moves a pixel on the 88 locked boards or edits the generated fixture.

## 0. What this batch is

Everything the app must do on its own to be honest and usable: one preference store that owns only per-machine chrome, the theme and window rules, a real first-run route that drives `setup` through the Prompter so a joiner lands in a working onboarding, the progress-frame consumer for the boot card, the refresh policy (own actions + focus + Sync now), and the rule that the Inbox and Onboarding surfaces appear only when their read models are real. Most rows are already shipped as drawn on the mock; this batch writes the boundary down as code and tests, and adds the two mechanisms that do not exist (the setup driver and the progress consumer).

## 1. Preferences and chrome (MC-08, AC-01, AC-02, AC-03, MC-02, MC-03, AC-13, AC-14, AC-15)

- **MC-08 (the spine):** one app-owned preferences record. In the shell it lives in Tauri's app config dir through `@tauri-apps/plugin-store` (already a dependency; permission `store:default` granted), never under `~/.terum`; in the browser it stays `localStorage` with the same keys. It holds only per-machine chrome: theme, overview/rail/startup-page/sidebar-counts/footer-machine-name toggles, the bell badge state, the seven Inbox kind toggles, a per-machine seen set, the consumed `app.json` `writtenAt`, the window state (`tauri-plugin-window-state` for geometry). Nothing that is team-wide truth (D20). An unreadable store yields the DRAWN defaults. `PrefStore` on the seam stays the API; the tauri adapter's implementation moves from `localStorage` to the store plugin with a one-time migration of existing keys.
- **AC-01 theme:** exactly System / Light / Dark; System follows `prefers-color-scheme` live; a synchronous root-attribute stamp before first paint (exists) PLUS a `tauri.conf.json` window background colour matching the dark chrome token and a runtime `setBackgroundColor` on theme change so a transparent body never borrows the host's theme. FigmaDark is generator-only.
- **AC-02, AC-13, AC-14, AC-15:** the drawn toggles persist in the store; startup page defaults to the Library; keyboard shortcuts as drawn (the `SHORTCUTS` fixture) with no new ones; focus rings and the drawn hover states unchanged.
- **AC-03 + MC-02:** the bell badge and the seven Inbox kind toggles are per-machine; `acted` is DERIVED from the data, never stored (it asserts a repo action).
- **MC-03:** the footer machine label reads host name and OS from the platform at launch (`host_platform()` for the OS; the hostname needs no sixth command: leave it `—` until a CLI payload carries it, and record that) and persists nothing.

## 2. Copy rules and derivations (AC-05, AC-16, CP-25, CP-41, RM-12, RM-33, RM-34, RM-35, IB-04, IB-09, RM-06)

- **AC-05 / AC-16:** `<html lang="en">`; one relative-time module over `Intl.RelativeTimeFormat` with an injectable clock (frozen at 2026-09-06 in fixtures, tests and gates); relative strings are formatted from ISO instants and never stored; no user-facing string is assembled from fragments (no `strings.ts` extraction).
- **RM-06:** Settings ▸ This machine's approvals half renders from `status.ledger` (S7k) once real; `PLACEMENTS_N` and the footer counts derive from the ledger by `scope.kind`; `version === null` renders "tracking".
- **CP-25, CP-41, RM-12, RM-33, RM-34, RM-35, IB-04, IB-09:** the app-side reading rules the costing §3.1 records for each (empty-state copy never claims a fact the read model does not carry; a pending destructive action renders as pending, never as quiet success; relative times from real instants only). Each row lands as a one-line rule in `desktop/src/backend/README.md`'s "reading rules" section (a file the implementing agent MAY edit; not `AGENTS.md`) and a test where the rule is testable.

## 3. Navigation and the served-surfaces rule (AC-10, AC-12, IB-01, CP-21)

- **AC-10:** publish the six navigation decisions (back/forward history, sidebar selection, the `Global`/project scopes, the Settings section default, the Marketplace crumb root, the Onboarding step order) as the route table's comments plus route smokes.
- **AC-12:** deep links (`#/skill/<ref>` from Marketplace) keep the crumb root.
- **IB-01 (the Inbox feed):** the real adapter has no feed today and this batch adds no CLI row, so on the real adapter `inbox()` stays the typed gap and `surfaces.inbox` stays `false`: the Inbox nav group and screens stay HIDDEN (Teddy's rule; the PR body says so). The mock keeps every Inbox board. Do not stub an empty feed as `ok:true, []`.
- **CP-21, the first-run route:** the app's root route decides on launch: if `launchTarget()` (S7ad; `Backend.launchTarget()` returns `{ target, writtenAt } | null`) returns a `target` whose `writtenAt` is not the consumed one in the store, route to `#/onboarding/boot` and run §4; otherwise the Library. A zero-team machine that did not come from `setup` has no join target and no wizard to run: it lands on the Library, whose real-adapter error board is honest (never route it to `#/onboarding/welcome`). Record the consumed `writtenAt` only after the driven `setup` settles (ok or declined).

## 4. RM-24: driving `setup` from the onboarding screen, and RM-17's consumer

- The onboarding Boot step calls `backend.setup({ target, offerConnect: true })` and renders the run: `print` frames become the boot card's rows (the hand-written mapping from `SetupResult.steps`' keys to the drawn six steps; print-only steps become screen copy), `ask` frames open the drawn dialog through the Prompter (never pre-answered: §6.1 makes `setup` a sequencer that cannot skip a delegated verb's consent), the `gh auth login` offer never arrives over frames (the CLI prints the logged-out line instead: render that line), and the result settles the card (`ok:false` with `declined` → the CLI's own line, no error styling; a failure → the drawn error board with the CLI's error line). The join target is never typed or chosen in the app (D-BM-3 rider).
- **RM-17 consumer:** the boot card renders arriving `progress` frames as its rows (`done/total` → the bar; `label` → the current row). Today no verb emits progress (`features.progress` is false, S7ae ships the producer): when none arrives the card shows the four honest rows PR #61 drew, driven by the result, with no fabricated counter.
- Tests: a scripted-Prompter test that every printed step maps to a drawn step, that an `ask` opens the dialog and is answered by the user (never auto-answered), that the gh-offer print line renders, that a progress frame moves the bar, and that `writtenAt` is consumed exactly once.

## 5. Refresh policy (D9; RM-23's consumer half stays S7w's)

Refresh after the app's own actions (S7af's subscribe consumer), on window focus (the query client's `refetchOnWindowFocus`, S7af), and through an explicit **Sync now** action on the Marketplace, Share and Settings ▸ Sync surfaces that runs `backend.sync({team})` through the workflow popup. NO timer, NO polling read, NEVER an automatic sync (an app-initiated sync writes the stamp and suppresses the SessionStart hook for an hour). Test: no `setInterval`/timer-driven refetch exists (a grep test over `desktop/src` excluding tests), and no code path calls `sync` without a user action.

## 6. Tests
`theme.test.ts` (five cases incl. the background colour call), `prefs` round trip with an unreadable store yielding drawn defaults and the localStorage→store migration, the ported contrast gate over the app's tokens, an Inbox test proving the surface stays hidden on the real adapter, the first-run routing test (target consumed once), the RM-24 driver tests (§4), the no-timer test (§5), route smokes for the onboarding routes.

## 7. Acceptance
Desktop: `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test`. No Playwright, no git, no network, no installs. The orchestrator runs routes and the 88-board fidelity gate (nothing may move) and the real-data proof: the fixture's `app.json` with a `target` routes the shell to the boot step, `--frames setup <target>` frames recorded from the fixture (declined at the first ask) replay through the driver and settle the card without an error style.

## 8. Out of scope
Any CLI change; a sixth Tauri command or file watch (D9); the sideways-scroll CSS (S7x); `GAPS.md`/`AGENTS.md`/`README.md` at `desktop/` root (maintainer files; `desktop/src/backend/README.md` is allowed).


=================== STANDING CONSTRAINTS ===================
- Read the per-directory README for every subtree you touch before your first edit there (desktop/src/backend/tauri/README.md in particular).
- Gates: from desktop/, `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` (baseline on this branch: 53 files / 751 tests). This batch changes no CLI code; if you find you must, stop and record it in openQuestions instead. Report REAL counts.
- Recorded fixture frames from the CLI at main (status, ls, ls --local, ls member mira, ls project terum, search '') are in .planning/codex-runs/<batch>/frames/*.jsonl for your replay test. The frames were recorded from the CLI at this tree (S7g's typed `ls --local` rows included; that batch lands before yours). For the RM-24 proof you need a `setup` recording: build the CLI (`npm run build` at the root), copy /Users/ryanliu/Documents/Terum/review-2026-09-08-desktop-blank-map/fixture.sh into your run record dir, set its CLI= line to <this worktree>/dist/index.js, run it with a fixture root INSIDE your run record dir (e.g. .planning/codex-runs/<batch>/fx; the git commands it runs act on that scratch fixture, not on this repository, and are allowed), then `printf '' | HOME=<fx>/home node <this worktree>/dist/index.js --frames <verb> [args] > frames/<verb>.jsonl` for each verb your surfaces read (run from inside <fx>/repo/seed; HOME on the node process); S7r needs `--frames setup <target>` recorded against the fixture (the join target is the fixture bare repo path `<fx>/repo/team.git`; answer the first ask with a decline by piping `printf n` or by letting stdin close) so the onboarding driver replays a real run, plus `status`. Commit nothing.
- No git on THIS repository (not even `git status`), no npm install, no network, no Playwright (`npx playwright …` will not launch here; say so, never fake a pixel result). node_modules and the generated fixture (design.json, tokens.css) are in place and must not be edited.
- Never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md at desktop/ root, package.json, design.json, tokens.css, e2e/**, tools/**; put what those files would need into openQuestions. The root README.md is editable only when the spec says so.
- Never delete or weaken a test to make a suite pass; change an assertion only to the new truth and declare it in testsModified. No eslint-disable without a same-line reason. No test-only branches in components; screens never branch on the mock scenario.
- Every new field the real adapter maps is `?? null`, never undefined; every new key on a zod object is declared, never left to passthrough; the real adapter never renders a design constant, a sample value or a fabricated caption; a surface flips to served only when its read model is real.
- If the spec is ambiguous, record the question in openQuestions and implement the most conservative reading. Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged. Verify each write by reading the file back.
- Your final message must be the JSON report the output schema demands: status complete only if every spec item was implemented and the gates ran.
