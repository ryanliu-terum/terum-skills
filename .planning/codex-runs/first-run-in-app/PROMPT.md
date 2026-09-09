Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. Both files are reproduced below so they are in your context, but read the on-disk copies too. This branch is origin/main 279830d (release 0.1.7 merged; S7r's launch route, SetupBoot and setup-session, S7ad's launchTarget()/AD-18 memo, D9's five-command lib.rs are all in): build on them, do not redo them. Every file:line anchor in the spec was verified on this exact tree by the orchestrator; where a number and the code disagree, the code wins.

You are the implementer, not the reviewer. Claude wrote the spec; you write the code; the orchestrator re-runs every gate outside the sandbox. Do not resolve a design fork on your own: implement the most conservative reading and record the question in `openQuestions`.

## Repo conventions that reach you only through this prompt (from the root CLAUDE.md)

- Before implementing: grep for existing code that already does the same thing before writing a new function, component, or route. Extend or replace it in the same change; never leave two active paths doing the same thing.
- Correctness is spec + North Star, not cheapness. A fix is right when it produces the behaviour the governing spec describes. Implementation time is never a reason to prefer a less correct reading.
- No attacker model: flag data loss, crashes and spec non-conformance for a well-meaning user; hostile-caller concerns are out of scope.
- Cross-agent rules: `--sandbox workspace-write` only; never `git push --no-verify`; never `git add -A`; in fact run NO git command at all in this sandbox (not even `git status` or `git diff`) — the worktree's git metadata lives outside your writable root and every git write fails in a way that looks like an unwritable workspace. Verify your writes by reading the files back. The orchestrator owns all version control.

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

=================== THE SPEC (locked) ===================

Converged implementation spec — "First run in the app" (B with A-fallback). Ryan decided Option B with the honest zero-team fallback, footer = GitHub login, one team per machine; Teddy's D-BM-3 rider: a joiner never types a target in the app.

Invariants: desktop/AGENTS.md (native imports only under src/backend/tauri/; the 88 locked fidelity boards do not move; fixtures never hand-edited); no timer, no polling (.planning/specs/m7-S7r.md:40); lib.rs command count stays five (D9) — the Reopen handler is an event, not a command. Line numbers refer to origin/main 279830d.

SCOPE FOR THIS RUN. Implement sections 1 (except 1.5), 2.1, 2.3 (text only, for the report), 3, 4, 5, 6, 7, 8, 9 and 11 fully; write the §10 amendment texts into the named spec files and the ledger; write the §12 replay tests over the recordings that ALREADY EXIST (see §12 below — do not try to record anything; the CLI's `gh` and `git` need a network the sandbox does not have).
EXCLUDED from your remit (the orchestrator handles them; do NOT implement, do not stub):
- §1.5 (frames.ts cancel → CancelledError protocol change). Leave src/lib/frames.ts cancel handling exactly as it is.
- §2.2 `cargo check` — you may not be able to run it in the sandbox; do not try to install anything. The orchestrator runs it.
- The 88-board Playwright fidelity run and every e2e/** file (maintainer-owned; never edit).
- The native Reopen check in a running app (Ryan does it by hand).

1. CLI half (src/)
1.1 src/commands/app.ts:61 AppState gains `intent?: 'setup'`; AppArgs gains `intent?: 'setup'`; :137 spreads `...(args.intent === undefined ? {} : { intent: args.intent })` beside target. Plain `app` never passes it, so a plain launch clears it (same rule as target, src/commands/__tests__/app.test.ts:106-114).
1.2 src/commands/setup.ts:111 passes `intent: 'setup'` to verbs.app(...). Nothing else in the handoff changes.
1.3 setup.ts:158 and :172: propagate a delegated verb's typed decline — `if (!result.ok) return result.cancelled ? { ...failed(result.error, …), cancelled: true } : failed(…)`; failed() (:81-83) gains an optional cancelled argument. src/lib/execute.ts:33 already forwards cancelled → declined.
1.4 src/cli.ts:59-61: register `.option('--app', 'open the desktop app without asking')` and `.option('--no-app', 'never ask about the desktop app')` on setup and forward `app: options.app` — registering both leaves app undefined when neither is given (Commander), preserving D4's remembered-choice behaviour.
1.6 .planning/specs/2026-09-02-phase-1-build.md:121 paragraph amended per §10.

2. Shell half (desktop/src-tauri/src/lib.rs)
2.1 Replace `.run(tauri::generate_context!()).expect(...)` (:212-213) with `.build(tauri::generate_context!()).expect("error while building tauri application").run(|app, event| { #[cfg(target_os = "macos")] if let tauri::RunEvent::Reopen { .. } = event { let _ = app.emit("launch:reopen", ()); } let _ = (app, &event); });` Do NOT gate on has_visible_windows. No new #[tauri::command]. The `Emitter` trait is already imported at lib.rs:14 (`use tauri::{AppHandle, Emitter, Manager, State};`). Keep the invoke_handler at exactly five commands.
2.2 (orchestrator) Gate: `cargo check` in desktop/src-tauri.
2.3 Windows: app.ts:142 executes the exe directly; no Reopen equivalent. Recorded as a separate requirement ("second-launch delivery on Windows") — mention it in your report's deviations; the Library "Start setup" fallback (§7) is the Windows path meanwhile.

3. Seam (desktop/src/backend/)
3.1 tauri/bridge.ts:14 appStateSchema gains `intent: z.literal('setup').optional()`. Bridge (:19-26) gains `onLaunchRequest(listener: () => void): Promise<() => void>`; tauriBridge implements it with `listen('launch:reopen', listener)` (from @tauri-apps/api/event, already imported there). The fake bridge (tauri/__tests__/fake-bridge.ts) gains the same method plus a way for a test to fire the event.
3.2 Backend.ts:10: replace launchTarget() with `launchContext(): Promise<LaunchContext | null>` where `LaunchContext = { writtenAt: string; target?: string; intent?: 'setup' }` (declare in types.ts), plus `refreshLaunch(): Promise<LaunchContext | null>` and `onLaunchRequest(listener: () => void): Subscription`. Mock (backend/mock/index.ts:58): launchContext() → null, refreshLaunch() → null, onLaunchRequest → no-op unsubscribe (backend/__tests__/mock.test.ts:115 updates to launchContext). Remove launchTarget everywhere (grep the tree: backend/index.ts:36 useLaunchTarget, app/routes.tsx LaunchRoute, screens/onboarding/OnboardingScreen.tsx, setup-session.ts's LaunchTarget type, and every test that spies on it).
3.3 tauri/index.ts:162-168: keep stateOnce for CLI runs, add a generation counter: refreshLaunch() sets stateOnce = undefined, increments generation, re-reads, and only publishes the read whose generation is current (an older in-flight read never replaces a newer snapshot; a request arriving during a read schedules one more read). launchContext() (replacing :237-241) returns `{ writtenAt, ...(target && {target}), ...(intent && {intent}) }` for any valid state — a target-less legacy file is NOT null. A missing file (bridge returns null) is still null.
3.4 tauri/index.ts:218-224 inventoryTeam: teams.length === 0 → fail(NO_TEAM) where the seam's Result failure gains `reason?: 'no-team' | 'ambiguous-team'` (types.ts:2 `Result<T>`), NO_TEAM = 'No team is configured on this machine.'; >1 keeps the existing text 'Select a team explicitly to read its skills.' with reason:'ambiguous-team'. Classification uses the structured, successful status value only; a failed status stays a plain read failure (no reason).
3.5 tauri/index.ts:188 onSettled: for setup and team, notify config, clone, placed on EVERY settle (ok, failed, cancelled). Other verbs keep notifying only on ok.
3.6 backend/index.ts:36: useLaunchContext() = useQuery({ queryKey:['launch-context'], queryFn: async () => { await backend.prefs.ready; return backend.launchContext(); }, staleTime: Infinity }); the coordinator (§4) is the only writer via queryClient.setQueryData(['launch-context'], await backend.refreshLaunch()).
3.7 setup-session.ts: key sessions by request (writtenAt) and give each session an attempt counter; start() runs the current attempt (running ??= per attempt); add retry() (settled → new attempt; unsettled → no-op) and stop() (calls the run's cancel(); the settle is typed cancelled); backend.setup({ ...(launch.target ? {target: launch.target} : {}), offerConnect: true }); consume (prefs.set('launch:consumedWrittenAt', writtenAt)) on ok OR cancelled — including the Join hand-off, which is ok — never on plain failure; a synthetic manual request (§7, writtenAt starting with `manual:`) is never written to prefs; expose snapshot().outcome: 'running'|'finished'|'handoff'|'cancelled'|'failed' where handoff = ok && role==='joiner' && team===''.

4. Routing coordinator (desktop/src/app/)
4.1 New LaunchCoordinator mounted in App.tsx:24 beside <Shortcuts/> (all routes). It owns the single decision decide(ctx, consumed, status):
  if ctx === null → none
  if ctx.writtenAt === consumed → none
  if ctx.target → boot(ctx)
  if ctx.intent === 'setup' → boot(ctx)
  if status.ok && status.value.teams.length === 0 → boot(ctx)
  else → none
status is the existing ['status'] query (queryKey ['status', mock] where the screens use it — reuse the same key so one read is shared); a failed or pending status never yields boot. The same function is exported (put it in a plain module, e.g. desktop/src/app/launch-decision.ts, so both the coordinator and screens import it) and used by OnboardingScreen.tsx:32 for Boot eligibility (replacing the target-only test) and by LaunchRoute (routes.tsx:23-27, which navigates to /onboarding/boot or /library/global from the same decision). LaunchRoute waits (ScreenFrame ready={false}) while launch-context is pending, and while status is pending ONLY when the decision needs status (ctx non-null, unconsumed, no target, no intent).
4.2 Startup: evaluate once when launch-context, prefs and (only if needed) status are ready. Subsequent: subscribe backend.onLaunchRequest BEFORE the first refreshLaunch(); on each event call refreshLaunch(), dedupe by writtenAt string equality against the last seen request, re-run decide, and navigate to /onboarding/boot when the decision is boot. SHOULD: also call refreshLaunch() on the native window 'focus' event (window.addEventListener('focus', …), not TanStack's visibility/refetchOnWindowFocus) through the same path. Never a timer, never polling.
4.3 Queueing: if a setup session for another request is unsettled, hold the new request; when it settles (any outcome), hand over — SetupBoot is remounted with key={writtenAt} so the captured useState session (SetupBoot.tsx:14) is replaced deliberately. A newer request never consumes or is consumed by an older attempt.

5. Dialog and driver (desktop/src/app/providers.tsx, desktop/src/backend/drive.ts, desktop/src/backend/prompter.ts)
5.1 providers.tsx:33: useState(question.default ?? '') — a select with no default renders a disabled placeholder option ("Choose…") selected, and submit is disabled until value is a real choice. Confirm/text unchanged (the text input's default stays question.default ?? '').
5.2 providers.tsx:28: Cancel on select/text rejects new PromptCancelledError('Cancelled.') (new class in backend/types.ts, with `readonly cancelled = true as const`); the unmount path (:26) keeps Error('Cancelled.'). Confirm's Cancel still resolves false.
5.3 drive.ts:16: catch (error) { await run.cancel(); return error instanceof PromptCancelledError ? { ok:false, error:'Setup was cancelled.', cancelled:true } : { ok:false, error:… }; }. scriptedPrompter (prompter.ts) must propagate the thrown instance untouched (no wrapping).

6. desktop/src/screens/onboarding/SetupBoot.tsx — title/tile by outcome: running → "Setting up your workspace"; finished → "Setup finished" + one action "Open the Library"; handoff → title "Ask your team owner to invite you", body = the five printed hand-off lines captured in state.lines, one action "Back to the Library", no target input; cancelled → "Setup cancelled" without failure styling (no role="alert", no data-failed), actions Retry (session.retry()) and Back; failed → "Couldn't finish setup", the CLI error line (role="alert"), actions Retry and Back. While running, a Stop action (session.stop()). The launch.target line (SetupBoot.tsx:21) renders only when a target exists. Result-driven rows and progress consumer unchanged. Keep the existing "Setup output" and progressbar semantics the current tests assert.

7. Library fallback (desktop/src/screens/library/LibraryScreen.tsx:16-19) — branch on query.data.reason: 'no-team' → CenteredState title "No team on this machine", body "Create a team or join the one you were invited to. Setup runs here in the app.", primary "Start setup" (navigates to /onboarding/boot?start=1, which OnboardingScreen accepts as an explicit start: it mints a session for the current launchContext, or a synthetic request `manual:<Date.now()>` when app.json is absent — never consumed via prefs — regardless of consumption), secondary "Copy terminal command" (copies `npx -y terum-skills@latest setup` through backend.copyToClipboard), footer = the CLI's lines (a TerminalHint with that command). 'ambiguous-team' → existing "Select a team explicitly" error board text unchanged. Any other failure → the existing filesystem board verbatim (LibraryError stays pixel-identical on the mock, library-skill.test.tsx:30). The mock gains an additive `__mock=no-team` scenario (see backend/mock for how `error|empty|loading|slow|disabled|not-installed` are wired; add `no-team` beside them so `#/library/global?__mock=no-team` renders the new board); no locked board changes.

8. Footer and Settings (adapter-only, pixel-neutral)
8.1 tauri/index.ts:116: footerLabel: [value.identity?.github, handle, value.identity?.default_handle].find(v => v) ?? ''. me.handle stays the team handle. (Check the CLI status schema in tauri/ carries identity.github; if the zod object lacks it, declare it there — closed objects, never passthrough.)
8.2 Settings (types.ts:86) gains AGENT_CLI_AUTH: 'signed-in' | 'unknown'; mock sets 'signed-in'; adapter (index.ts:133) sets 'unknown'; SettingsContent.tsx:84 renders {d.AGENT_CLI}{d.AGENT_CLI_AUTH === 'signed-in' ? ' · signed in' : ''}. SettingsEvals (FIDELITY.md:72) unchanged on the mock.

9. Surfaces: surfaces().onboarding stays false on the real adapter; Boot eligibility no longer depends on it. No sidebar change.

10. Governing-contract amendments (paste-ready; write them into the files)
CP-21 (.planning/specs/m7-S7r.md:30, the bullet beginning "- **CP-21, the first-run route:**") — replace that whole bullet's text with:
"- **CP-21, the first-run route (amended 2026-09-09, Ryan: B with A-fallback; one team per machine).** The app's root route and the Boot step share one decision, evaluated once at startup and again whenever the shell reports a new launch request (macOS RunEvent::Reopen → launch:reopen; a native focus is an optional extra trigger; never a timer). Given launchContext() = { writtenAt, target?, intent? } | null and the consumed writtenAt in the preference store: a request whose writtenAt equals the consumed one does nothing; a pending target routes to #/onboarding/boot and drives setup -- <target>; otherwise a pending intent:'setup' routes to Boot and drives target-less setup (the CLI's own create-or-join question, or its configured-machine resume); otherwise an unconsumed launch on a machine whose successful status reports teams: [] routes to Boot and drives target-less setup — never inferred from print lines or from a failed status's partial value. Anything else lands on the Library. A zero-team Library renders the no-team board with Start setup, which opens Boot regardless of consumption. Requests are compared by identity, never ordered by timestamp; a request arriving during an active wizard waits for it to settle. The exact request is consumed only when its driven setup settles ok (including the joiner's owner hand-off) or as a typed cancellation; an ordinary failure leaves it unconsumed and Boot offers Retry. The create-or-join select has no default in the app either (§6.1). The joiner never types a target in the app (D-BM-3 rider)."
S7ad §1 AD-19 (.planning/specs/m7-S7ad.md — find the AD-19 bullet near line 24-26) and the §4.2 launch-state paragraph (.planning/specs/2026-09-02-phase-1-build.md:121, "**Desktop launch state.**") — replace "{ schema: 1, node, entry, path, version, writtenAt, target? }" with "{ schema: 1, node, entry, path, version, writtenAt, target?, intent? }" and append to each:
"intent: 'setup' is written only when setup hands off to the app (creator or resume); a plain app launch omits and therefore clears both target and intent. The shell exposes the whole context as Backend.launchContext() (a valid file without target is a context, not null) and re-reads the file when the running app is reopened by a second open, replacing its cached node/entry/PATH as well; the successful-read memo (AD-18) is per launch request, not per process lifetime. Consumption stays once per writtenAt, recorded by S7r's routing only from the driven setup's outcome."
Also add a one-paragraph entry at the end of the M7 ledger (.planning/decisions/2026-09-08-m7-takeover-decision-walk.md) recording Ryan's 2026-09-09 rulings: B with A-fallback (the app drives target-less setup for an intent:'setup' hand-off or a zero-team machine, with the honest no-team Library board as fallback), footer = GitHub login, one team per machine (a model to follow in its own batch), joiner never types a target in the app (D-BM-3 rider).

11. Tests — each new/changed assertion must FAIL on origin/main and PASS after (the orchestrator checks this by running your test files on a pristine copy of origin/main; write them so they compile against the new API and fail on the old tree, never so they pass on both):
- desktop/src/backend/tauri/__tests__/run.test.ts:201-203: legacy STATE → launchContext() equals {writtenAt: STATE.writtenAt}; null state stays null. New: A→B via refreshLaunch() returns B; request during in-flight read yields the latest; onLaunchRequest listener fires from a fake bridge event; stateOnce memo test (:178-190) keeps passing. :191-200 ("shares concurrent state reads and exposes the target without consuming it") re-anchored to launchContext.
- desktop/src/backend/tauri/__tests__/index.test.ts: new inventoryBridge({teams:[]}) → library fails with reason:'no-team' and the CLI text; :258-262 (two teams) unchanged but gains reason:'ambiguous-team'; statusModel footerLabel: github:'octo'→'octo'; github:'', handle 'mira'→'mira'; setup settle with ok:false still notifies config/clone/placed.
- desktop/src/screens/onboarding/setup-driver.test.tsx:48-51 ("lands a zero-team machine without a target on Library, with no wizard"): replace with status ok teams:[] + launchContext {writtenAt} unconsumed → #/onboarding/boot, setup called once with {offerConnect:true} (no target). Keep a separate case: status failed → Library, setup not called. Add: configured (1 team) + unconsumed + no intent → Library; same with intent:'setup' → Boot. Add: select dialog without default has no selection and Continue is disabled; Join outcome renders the hand-off, no "Setup finished", request consumed; Cancel on a select → cancelled:true, no failure styling, Retry visible, request consumed; failure → Retry spawns a second setup; Stop → cancel() called and the card settles cancelled. :12/:33/:42/:46 re-anchored from launchTarget to launchContext.
- new desktop/src/app/launch-coordinator.test.tsx: from Library, a reopen event with new request B (target) → Boot for B once; duplicate events → one session; event with the consumed writtenAt → nothing; B arriving during an active wizard → queued, handed over after settle.
- desktop/src/backend/tauri/__tests__/setup-replay.test.tsx:28,52 unchanged; add the §12 replays (below).
- desktop/src/screens/library/library-skill.test.tsx:30: keep the error board; add __mock=no-team → "No team on this machine" / "Start setup".
- desktop/src/screens/settings/settings.test.tsx: AGENT_CLI_AUTH:'unknown' renders no "· signed in".
- desktop/src/backend/__tests__/mock.test.ts:37,115: footerLabel unchanged; launchContext() null.
- src/commands/__tests__/setup.test.ts:689-701: handoff passes intent:'setup'; delegated cancelled survives (:158/:172).
- src/commands/__tests__/app.test.ts:97,114: plain launch has no intent; intent:'setup' round-trips.
- src/__tests__/cli.test.ts (or the existing program test): setup --app → app:true, --no-app → false, neither → undefined.

12. Real-data proof (S7r style) — ALREADY RECORDED by the orchestrator from the built CLI (dist/index.js at 279830d) against a scratch HOME (empty ~/.terum), stored at .planning/codex-runs/first-run-in-app/frames/:
- status-zero.jsonl: `--frames status` on an empty HOME → result ok, value.teams: [], identity: null.
- setup-create-fork.jsonl: `--frames setup` (no target): welcome prints, the select ask `{"t":"ask","id":"q1","kind":"select","question":"Create a team or join one?","choices":[...]}` carries NO default field; answered "Create a new team"; gh authenticated; the first team-create ask is `{"t":"ask","id":"q2","kind":"text","question":"Team name"}`; then a `{"t":"cancel"}` frame was sent — the CURRENT CLI answers it with an ordinary failure result `Input ended before "Team name" was answered.` (ok:false, no declined flag). That is the excluded §1.5 gap; your replay must assert what was recorded (an ordinary failure → the card shows "Couldn't finish setup" with Retry, request NOT consumed), never a typed cancel.
- setup-join-handoff.jsonl: same, answered "Join an existing team" → five hand-off prints → result ok, value {role:'joiner', team:'', remote:'', steps:{welcome:'printed',app:'skipped',role:'done',team:'printed'}}.
- setup-resume.jsonl: recorded against the S7r fixture team (fixture.sh copied to .planning/codex-runs/first-run-in-app/fixture.sh): "Resuming setup for team acme…", invite text ask answered blank, hook and skill confirms answered false → result ok, role:'creator', team:'acme'.
Write replay tests (extend desktop/src/backend/tauri/__tests__/setup-replay.test.tsx or add a sibling file under the same directory, following its fakeBridge + segment idiom exactly) that:
  (a) replay status-zero + setup-create-fork with app.json = {...STATE} (no target, no intent; STATE from fake-bridge.ts) → the root route lands on #/onboarding/boot from the zero-team decision, the select dialog shows "Create a team or join one?" with Continue disabled until a choice is picked, the human picks Create, then the "Team name" text dialog appears; the test then feeds the recorded tail (the failure result) and asserts the card shows the failure with Retry and the request is not consumed; assert the setup spawn argv is exactly ['setup'] (no `--`, no target).
  (b) replay status-zero + setup-join-handoff the same way with app.json = {...STATE, intent:'setup'} → Boot, pick Join → the five hand-off lines render under the title "Ask your team owner to invite you", no "Setup finished", the request IS consumed (prefs launch:consumedWrittenAt === STATE.writtenAt).
  (c) replay setup-resume with app.json = {...STATE, intent:'setup'} and the S7r status recording (../.planning/codex-runs/m7-S7r/frames/status.jsonl, one configured team) → Boot (intent wins over the configured team), the three asks answered as recorded, the card settles "Setup finished".
  (d) the EXISTING S7r setup-join replay with app.json carrying target (setup-replay.test.tsx:28-52) already proves pending-target still wins; keep it passing unchanged.
Feed asks the way setup-replay.test.tsx does (segments split at each ask; the fake bridge's write emits the next segment). Read the recordings with the same `resolve('../.planning/codex-runs/first-run-in-app/frames')` idiom (vitest runs from desktop/).

=================== STANDING CONSTRAINTS ===================

- Run NO git command. Do not `npm install`/`npm ci` (node_modules is a symlink already in place at the worktree root and under desktop/). Do not touch node_modules.
- Do not edit: desktop/AGENTS.md, desktop/FIDELITY.md, desktop/GAPS.md, desktop/README.md, desktop/package.json, desktop/e2e/**, desktop/src/styles/tokens.css, desktop/src/fixtures/design.json, any .jsonl recording, package.json, package-lock.json, src/lib/frames.ts.
- Native (@tauri-apps/*) imports only under desktop/src/backend/tauri/. Screens import only src/backend/types and src/backend/index.
- Every new key on a zod object in desktop/src/backend/tauri is declared on the closed object (never passthrough); every new DTO field maps with `?? null`, never undefined.
- Gates you run and report with REAL counts:
  Root: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (from the worktree root).
  Desktop: `npm run typecheck --prefix desktop`, `npm run lint --prefix desktop`, `NODE_OPTIONS=--no-experimental-webstorage npm test --prefix desktop`.
  Known sandbox issue: vitest under desktop/ may fail with EPERM on node_modules/.vite-temp because node_modules is a symlink to a path outside your writable root. If that happens, report it verbatim in gates.test.output as a sandbox failure — do not work around it by editing configs or node_modules. The orchestrator's own run outside the sandbox is the authoritative gate. If typecheck and lint pass and only vitest is blocked that way, say so plainly.
- Never delete or weaken an existing test to make a suite pass; declare every existing-test change in testsModified with the spec section that requires it (the launchTarget → launchContext re-anchoring is expected and should be listed).
- No `eslint-disable` without a reason on the same line. No test-only branches in components.
- Where the spec is ambiguous, implement the most conservative reading and record the fork in openQuestions. Never resolve a design fork yourself.
- Do not commit, stage, or push. Leave every change in the working tree.
- Finish with the structured report the output schema requires. In `summary`, list which spec sections (1.1-1.4, 1.6, 2.1, 3.1-3.7, 4.1-4.3, 5.1-5.3, 6, 7, 8.1-8.2, 9, 10, 11, 12) you completed; anything not completed goes in deviations with the reason.
