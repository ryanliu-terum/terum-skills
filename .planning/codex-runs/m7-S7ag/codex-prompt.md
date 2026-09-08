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

=================== THE SPEC: .planning/specs/m7-S7ag.md ===================
# m7-S7ag: the Rust child lifecycle (app-only, src-tauri)

**Status:** LOCKED for implementation (M7 queue, batch 2 of tranche 1). Rows AD-11, AD-12, AD-13. Approver named for information: Ryan (src-tauri is his). Depends on: nothing; S7ad stacks on this branch (both edit lib.rs).
**Sources:** M7 document §4 S7ag and §10.8 AD-11..13; the blank-map review bugs 5, 6, 7 (`.planning/research/2026-09-08-m7-close-the-canvas-gaps.md`; the review's REPORT.md section 4). Ledger D9: `lib.rs` stays at FIVE commands (`cli_spawn`, `cli_write`, `cli_kill`, `read_app_state`, `host_platform`); no sixth command, no file watching, no timer.
**Governing rules:** `desktop/AGENTS.md` invariants 1 and 8 (the seam: only `src/backend/tauri/**` imports `@tauri-apps/*`; no git, no network, no installs, no Playwright in the sandbox). Rust: `cargo check` is the gate you can run (`CARGO_TARGET_DIR=/Users/ryanliu/Documents/Terum/.m7-cargo-target cargo check --manifest-path desktop/src-tauri/Cargo.toml`; the target dir is warm); `cargo test` too if you add unit tests. You cannot launch the app; say so in the report, never fake a lifecycle observation.

## 0. What this batch is

No CLI change, no seam DTO change. Three defects in `desktop/src-tauri/src/lib.rs` (the CLI bridge) and their TypeScript halves in `desktop/src/backend/tauri/run.ts` and `bridge.ts`: a successful run can be reported as "exited before reporting a result" because `Exit` can be emitted before the last stdout lines are delivered; cancel kills only node and orphans its `git clone`; and there is no cap on concurrent children.

## 1. AD-11: join the readers before `Exit` (lib.rs `cli_spawn`, run.ts, bridge.ts)

Today `cli_spawn` spawns three threads: a stdout reader (`for line in BufReader::new(stdout).lines()`), a stderr reader, and a waiter that polls `try_wait()` every 25 ms and emits `LineEvent::Exit` the moment the process is gone, discarding both reader `JoinHandle`s. The last `result` frame can therefore arrive after `Exit`.

- Keep the two reader `JoinHandle`s (`let out = std::thread::spawn(...)`, `let err = ...`) and move them into the waiter thread; after `try_wait()` returns `Some(status)`, `let _ = out.join(); let _ = err.join();` and only then emit `Exit { code }` and remove the child from the map. Readers end when the pipes close, which happens when the process exits, so the join is bounded.
- `run.ts`: the `onEvent` handler starts with `if (finished) return;`, which drops every event after the first settle. Keep that guard for `stdout`/`stderr` (a settled run needs no more frames) but the `result` frame itself must settle before `exit`: with the Rust fix the order is guaranteed, so the TypeScript change is to make the `exit` handler's "exited before reporting a result" message the only path that fires when NO result frame arrived, and to record in `stderr[]` any stdout line that arrives after settle instead of silently dropping it (a diagnostic, not a frame). Add a test: stdout `result` then `exit` settles ok; `exit` then a late stdout `result` (the old race, kept as a regression test of the TS side) still settles once and does not throw.
- `bridge.ts` `spawn`: stop calling `unlisten()` inside the event callback on `exit`. Instead unlisten when the adapter is done with the run: return the `unlisten` function from `spawn` (extend the `Bridge` interface: `spawn(...): Promise<() => void>`), and have `run.ts` call it after `finish()` on the exit event (or on `cancel()`). The fake Bridge in the tests returns a no-op.

## 2. AD-12: a real cancel path (lib.rs `cli_kill`)

Today `cli_kill` drops stdin and immediately calls `try_wait()`, so the documented "closing stdin is cancel" path never gets a chance and `kill()` always fires, killing only the `node` process and leaving a `git clone` child running while the app says "Cancelled."

- After `guard.stdin.take()`, release the handle lock and poll `try_wait()` every 25 ms for up to 1,500 ms (the CLI's cancel handling ends the run with a `result` frame on stdin close); if the process is still alive, kill the whole process group: on Unix send `SIGTERM` to `-pid` via `libc::kill(-(pid as i32), libc::SIGTERM)` (add `libc` as a Unix-only dependency in `Cargo.toml` under `[target.'cfg(unix)'.dependencies]`; and make the child a group leader with `std::os::unix::process::CommandExt::process_group(0)` at spawn) then after another 500 ms `SIGKILL`; on Windows call `child.kill()` (no process groups; document it). Never take the handle lock across a sleep (the waiter thread needs it).
- Emit nothing new: the waiter thread still emits `Exit` when the process is gone; the TypeScript side already settles `Cancelled.`.
- Test (TS): `cancel()` writes the cancel frame, calls `kill`, settles `Cancelled.`, and a later `exit` event is ignored (already covered; keep).

## 3. AD-13: a child cap (lib.rs `Bridge`)

- `Bridge` gains `const MAX_CHILDREN: usize = 8;`. `cli_spawn` refuses with `Err("too many pending terum-skills processes (8); wait for one to finish")` when the map already holds 8 live children. The TypeScript `cliRun` turns a rejected `spawn` into `{ ok:false, error: 'Could not start terum-skills: …' }` today; keep that, and make `read()` in `index.ts` surface it unchanged (no retry loop in this batch).
- The map entry is removed by the waiter thread after `Exit`, so a finished child frees its slot; a child that never exits holds its slot (that is the cap's purpose). Pairs with BM-08 (one git child per listing) in S7f.
- Rust unit test if the crate has a test target (it has none today: add `#[cfg(test)] mod tests` with a test of the cap predicate on a `HashMap` of the right length; do not spawn processes in a unit test).

## 4. Tests

- `desktop/src/backend/tauri/__tests__/run.test.ts`: the two AD-11 cases above; the fake Bridge's `spawn` returns an unlisten spy and the test asserts it is called exactly once after exit.
- `desktop/src/backend/tauri/__tests__/index.test.ts` (exists after S7af; if S7af is unmerged when you start, stack on `origin/codex/m7-S7af` as the orchestrator instructs): a spawn rejection surfaces as `ok:false` with the bridge's message.
- Rust: `cargo check` green; `cargo test` green if you added the unit test.

## 5. Acceptance

`npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` in `desktop/` (report real counts); `cargo check --manifest-path desktop/src-tauri/Cargo.toml` (report the warning count). No git, no network, no installs, no Playwright. Report the lifecycle itself as NOT reproduced (no packaged app in the sandbox); the orchestrator verifies what it can in Step 4 of the launch runbook.

## 6. Out of scope

`app.json` fields and `command.env("PATH", …)` (S7ad, which stacks on this branch); any new `#[tauri::command]` (Ledger D9); `capabilities/default.json`; the adapter's read models.


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
