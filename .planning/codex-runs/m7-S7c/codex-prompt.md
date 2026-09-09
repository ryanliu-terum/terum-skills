Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. This branch is main after S7af, S7ag, S7f and S7q (adapter plumbing, the Rust lifecycle, the ls/search payload with Library and Skill detail served, the hello-features wiring with Backend.features() and every flag gated): build on them, do not redo them. Line numbers in the spec were verified earlier; where a number and the code disagree, the code wins.

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

=================== THE SPEC: .planning/specs/m7-S7c.md ===================
# m7-S7c: `login --set` (MC-11, the identity WRITE half); CP-D1 closed by merits (CLI + app)

**Status:** LOCKED for implementation (M7 queue, batch 11 of tranche 1). Rows CP-D1 (CLOSED by merits, recorded), MC-11. Approver named for information: Ryan. Depends on S7af (stack while unmerged). Serialise after S7b only if it is in flight (both touch `src/cli.ts`; no logical dependency).
**Sources:** the M7 document §4 S7c with both verifier lenses (binding corrections: CP-D1's `--label` is NOT built; `--cwd` is NOT built here (S7aa is OUT by ledger D8: `cli_spawn` already sets the child cwd); MC-07's `--team` on every verb shipped in S7af; RM-46 and CP-43's app halves need read payloads that S7k/S7f carry, so they are recorded here and consumed there), the costing §2 MC-11 paragraph, the ledger (D8, D12). Anchors re-verified on main: `login` registration in `src/cli.ts` (`login` at :51-53 after the `app` verb shift), `configSchema` keys `display_name`, `email`, `default_handle`, `github` (`src/lib/schema.ts:93-98`), `setIdentity` in `src/lib/auth.ts` as their only writer, `ConfigStore.update` as the only config writer.

## 0. What this batch is

Settings ▸ Account draws three editable identity fields that today write only `localStorage`. The CLI gains the one write path the app needs, `login --set <key>=<value>`, through the existing config writer, and the app's Account screen spawns it. The read half is BM-10 (`status.identity`, S7k). CP-D1 (a config-local team label) is closed on the merits: `team.json.name` already carries the team's display name and the README renders it; a third spelling nothing keeps in sync would disagree with what the whole team reads. The app renders the team KEY where a command, path or identifier appears and `team.json.name` (via `status`, S7k) where a display name appears.

## 1. CLI half (`src/cli.ts`, `src/commands/login.ts`, `src/lib/auth.ts`)

- `login` gains a repeatable `--set <key>=<value>` option. Accepted surface keys, mapped explicitly: `name` → `display_name`, `email` → `email`, `default-handle` → `default_handle`. Each value is validated with the schema `configSchema` already uses for that field (`handleSchema` for the handle, the email schema, non-empty string for the name); `github` and every other key are REFUSED with one line naming the accepted three. Writes go through `ConfigStore.update` (still the only writer); nothing else in `config.json` changes byte-for-byte. With `--set` the verb performs no `gh` probe and asks nothing (frame-safe: the app drives it through `run()`, and a question would become a dialog).
- The verb prints the true consequence BEFORE writing, as one line: "This changes the author line (`<display_name> <email>`) that the next sync writes into the skills you have connected on this machine; skills you authored elsewhere keep their recorded author." (the managed-field refresh runs only over `config.shared` on this machine, through `reconcileShared` under the narrow guard exception; verifier lens 2, point 12). Over frames that line is a `print` frame; the RESULT value also carries it: `LoginResult` gains `updated: { key, value }[]` and `notice: string | null` so the app can render it without depending on print frames.
- Spec: one §6 `login` paragraph in `.planning/specs/2026-09-02-phase-1-build.md` (the accepted keys, the mapping, the refusal of `github`, the consequence sentence). CP-D1: one sentence in the same section recording the closure by merits (team.json `name` is the team's display name; the config key is the identifier; no label field) and pointing the app at `status` for the name.
- Tests: `src/commands/__tests__/login.test.ts`: `--set name=<v>` writes only `display_name` and leaves every other field byte-identical; `--set email=` refuses an invalid address; `--set github=` and an unknown key are refused with the accepted-keys line; two `--set`s in one call; the notice line is printed before the write and returned on the value. `src/__tests__/cli.test.ts`: the option is registered once with no default (forwarded args asserted by exact equality).

## 2. App half (`desktop/src/backend/tauri/index.ts`, `types.ts`, `mock/`, Settings ▸ Account)

- Seam: `Backend.setIdentity(args: { name?: string; email?: string; defaultHandle?: string }): Run<IdentityWrite>` with `IdentityWrite = { updated: { key: string; value: string }[]; notice: string | null }`. Adapter: `run(['login', ...pairs.map(p => ['--set', p]).flat()], cliLogin, map)` with `touches: ['config']` so `status`/`settings` invalidate (S7af's subscribe consumer). Mock: writes its in-memory identity and returns the same shape.
- Settings ▸ Account: the three fields save through `setIdentity` (no more `localStorage` writes for identity); the notice renders in the workflow popup line; the values re-read from `status.identity` once S7k lands (until then the fields render what `settings()` supplies, which on the real adapter is the gap board: this batch does not flip a surface).
- Team display name (CP-D1 app half): wherever the app draws a team's NAME it reads `team.json.name` from `status` (S7k: `TeamStatus.name`, add it there if S7k has not) and where it draws an identifier (commands, paths, the sidebar key) it uses the config key; record that the two may differ and never invent a label.
- Tests: `index.test.ts` argv for `setIdentity` (`['login', '--set', 'name=Ryan Liu', '--team'…` no: `login` takes no `--team`); mock strict `toEqual`s; `settings.test.tsx` Account save path calls the seam.

## 3. Acceptance
Root: `npm run lint && npm run typecheck && npm test && npm run build`. Desktop: `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test`. No Playwright, no git, no network, no installs. Real-data proof (orchestrator): `--frames login --set name=Seed2` against the fixture team writes only `display_name` in the fixture's `config.json` and the result frame carries `updated` and `notice`.

## 4. Out of scope
`--label` on `team create`/`team join` (CP-D1 closed by merits); `--cwd` on any verb (S7aa OUT, ledger D8); RM-46/CP-43 (their read payloads arrive with S7k/S7f; the app rules are recorded in those specs); `GAPS.md`.


=================== STANDING CONSTRAINTS ===================
- Read the per-directory README for every subtree you touch before your first edit there (desktop/src/backend/tauri/README.md in particular).
- Gates: from desktop/, `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` (baseline on this branch: 51 files / 706 tests); for a CLI change also, from the repo root, `npm run lint && npm run typecheck && npm test && npm run build` (baseline 1147 tests). Report REAL counts.
- Recorded fixture frames from the CLI at main (status, ls, ls --local, ls member mira, ls project terum, search '') are in .planning/codex-runs/<batch>/frames/*.jsonl for your replay test. If your batch changes the CLI payload (S7c does: `login --set` writes identity; re-record `status` after a set), rebuild the CLI (`npm run build` at the root) and re-record: copy /Users/ryanliu/Documents/Terum/review-2026-09-08-desktop-blank-map/fixture.sh into your run record dir, set its CLI= line to <this worktree>/dist/index.js, run it with a fixture root INSIDE your run record dir (e.g. .planning/codex-runs/<batch>/fx; the git commands it runs act on that scratch fixture, not on this repository, and are allowed), then `printf '' | HOME=<fx>/home node <this worktree>/dist/index.js --frames <verb> [args] > frames/<verb>.jsonl` for each verb your surfaces read (run from inside <fx>/repo/seed; HOME on the node process); S7c reads `status` before and after `login --set`. Commit nothing.
- No git on THIS repository (not even `git status`), no npm install, no network, no Playwright (`npx playwright …` will not launch here; say so, never fake a pixel result). node_modules and the generated fixture (design.json, tokens.css) are in place and must not be edited.
- Never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md at desktop/ root, package.json, design.json, tokens.css, e2e/**, tools/**; put what those files would need into openQuestions. The root README.md is editable only when the spec says so.
- Never delete or weaken a test to make a suite pass; change an assertion only to the new truth and declare it in testsModified. No eslint-disable without a same-line reason. No test-only branches in components; screens never branch on the mock scenario.
- Every new field the real adapter maps is `?? null`, never undefined; every new key on a zod object is declared, never left to passthrough; the real adapter never renders a design constant, a sample value or a fabricated caption; a surface flips to served only when its read model is real.
- If the spec is ambiguous, record the question in openQuestions and implement the most conservative reading. Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged. Verify each write by reading the file back.
- Your final message must be the JSON report the output schema demands: status complete only if every spec item was implemented and the gates ran.
