Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. This branch already contains S7af (adapter plumbing: Backend.surfaces(), ReadOptions signal, read() as an exported consumer, invalidation.ts, --team on every verb, the widened SearchHit) and S7ag (the Rust lifecycle): build on them, do not redo them. Line numbers in the spec were verified on main before S7af; where a number and the code disagree, the code wins.

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

=================== THE SPEC: .planning/specs/m7-S7d.md ===================
# m7-S7d: frames-channel correctness (typed decline, a result frame on usage errors, `--`-safe argv) (CLI + app)

**Status:** LOCKED for implementation (M7 queue, batch 8 of tranche 1). Rows RM-09, CP-35, BM-06, BM-07, AD-17. Approver named for information: Ryan. Depends on S7af (stack on `origin/codex/m7-S7af` while unmerged). **Ledger D13:** this batch edits `src/lib/frames.ts` FIRST and rewrites the all-false invariant in `src/lib/__tests__/frames.test.ts` (`expect(Object.values(FRAME_FEATURES).every((value) => value === false)).toBe(true)`) into a snapshot of the whole `FRAME_FEATURES` map (`toEqual({ favorites:false, … progress:false })`); S7b, S7ae and S7l then stack on this branch and each change one line of that map.
**Sources:** the takeover ledger (D13; D1 `roles` stays false here); M7 document §4 S7d with both verifier lenses (the queue's rows are RM-09, CP-35, BM-06, BM-07, AD-17; RM-10 moved to S7f and RM-22 to S7k, so ignore those two in the section text), §10.2 BM-06 and BM-07 (paste-ready edits), §10.7 corrections for BM-06 and BM-07, §10.8 AD-17; the costing §2 paragraphs RM-09 and CP-35. `docs/frame-protocol.md` is the protocol's contract and gains the two sentences named below; `hello.protocol` stays 1 (additive changes only).
**Governing rules:** root `AGENTS.md`; `desktop/AGENTS.md`; the North Star. No behaviour change outside frame mode except where a row says so; every printed line outside frames is unchanged.

## 0. What this batch is

Four defects in how the CLI talks to a program: a decline is recognised by regex over the error prose and misses four of the nine decline sites ("cancelled"), so the app paints those as errors; a commander usage error under `--frames` emits no `result` frame at all, so the app reports "exited with code 1 before reporting a result"; the `--frames` and `--hook` scans read the whole argv, so an operand after `--` can flip the mode; and the adapter builds argv with positionals before flags, so a leading-dash ref is misparsed. Plus CP-35: the Remove dialog stops asserting "from Global".

## 1. RM-09: the typed decline

- `src/lib/result.ts`: add `export function cancelled(message: string): Result<never>` returning `{ ok: false, error: message, cancelled: true }`; the failing arm of `Result` gains `cancelled?: true` (the flag is named `cancelled` because `declined` is taken by `personSchema`; costing RM-09). `failure()` never sets it.
- Apply it at all NINE decline sites (verified byte-exact at f8557c4; re-grep before editing): `install.ts:148` ('Consent was declined for malformed allowed-tools on …'), `install.ts:155` ('Consent was declined for …'), `connect.ts:203` ('Connect was declined.'), `connect.ts:382` ('Forget was declined.'), `publish.ts:84` ('Publish was cancelled.'), `leave.ts:38` ('Leave was cancelled.'), `team.ts:121` ('Team removal was cancelled.'), `team.ts:493` ('Invitation acceptance was declined.') and `uninstallMachine.ts:67` (`return failure('Uninstall was cancelled.')` → `return cancelled(…)`). Eight of them `throw new Error(…)` today: introduce `export class CancelledError extends Error { readonly cancelled = true }` in `result.ts`, throw it at those eight sites, and make the per-verb `catch` that turns an error into `failure(message)` produce `cancelled(message)` when the error is a `CancelledError` (one helper, `fromError(error)`, used by every verb's catch; grep `catch (error) { return failure(error instanceof Error ? error.message : String(error)); }`). The messages do not change (spec conformance; tests pin them). `sync --prune`'s decline stays data on the success path (`{ deleted: 0, declined: true }`), not a failure; record that.
- `src/lib/execute.ts`: `ResultOutcome` carries `cancelled` through to the channel. `src/lib/frames.ts`: the result frame's `declined` is set from the TYPED field (`outcome.cancelled === true`), and `isDecline`'s regex is deleted (the field replaces it; `docs/frame-protocol.md`'s `result` row keeps the wire name `declined` and says it is set by the CLI's typed decline). Test: each of the nine messages yields `declined: true`; the four "cancelled" strings are the regression cases; a genuine error whose text merely contains "declined" (e.g. an unknown option named `--declined`) does NOT set it.
- App half: the seam `Result` failing arm gains `cancelled?: true` (`desktop/src/backend/types.ts`), the seam `Frame` result variant gains `declined?: boolean`; `run.ts` maps `frame.declined` onto both; `useWorkflow` (`desktop/src/components/domain/useWorkflow.ts`) distinguishes a cancelled result (close the popup quietly with the CLI's line, no error styling) from a failure (`setError`). The mock's declines (`fail('Connect was declined.')` etc.) become `cancelled(...)` so both backends agree. Tests: `run.test.ts` (declined propagates), `useWorkflow` test (cancelled closes, error paints), mock strict `toEqual`s updated to include `cancelled: true` where the mock declines.

## 2. BM-06: a result frame on every commander usage error (`src/index.ts`, `src/lib/frames.ts`)

Per §10.2 and §10.7: in `frames.ts` beside `isDecline`'s former place, `COMMANDER_NON_ERRORS = new Set(['commander.help', 'commander.helpDisplayed', 'commander.version'])` and `attemptedVerb(operands: readonly string[]): string` (the longest leading non-flag prefix naming a `FRAME_VERBS` entry, two words for the `team` forms, else the first operand, else `'terum-skills'`, never empty; it breaks at the first dash). In `src/index.ts`'s catch: when `channel` exists and the error is a `CommanderError` with `exitCode !== 0` and a code not in the set (§10.7: discriminate on the exit code; commander 15 raises `commander.help` with exitCode 1 for a bare `terum-skills` and a bare `team`, whose message is the literal `(outputHelp)`: substitute a written one-liner such as `Usage error: <the verb> needs an argument; run it without --frames for the full help.`), emit `channel.result({ verb: attemptedVerb(argv.slice(2)), ok: false, error, exitCode: 1 })`; also for every non-commander throw. Do not guard on `channel.closed`; use a `reported` flag so a result is emitted at most once per run. Never set `declined` for a commander error. `docs/frame-protocol.md`: the ordering sentence ("then exactly one `result`") gains "including on a usage error". Tests: `frames.test.ts` (`attemptedVerb` cases incl. `['--frames']`, `['--frames','team']`, `['install','-x']`), `src/__tests__/bin.test.ts` (an unknown option under `--frames` ends in exactly one result frame with `ok:false`, exit 1; `--frames --version` still prints plain text per rule 3).

## 3. BM-07: stop the `--frames` and `--hook` scans at the first `--` (`src/index.ts`)

`const separator = process.argv.indexOf('--')`; detect and filter `FRAMES_FLAG` only in the prefix before it (every pre-`--` occurrence is dropped); recompute the separator after the filter and slice `argv` to it before the `--hook` test. `docs/frame-protocol.md`'s position-independence paragraph gains "before the first `--`". Tests in `bin.test.ts` (an unconfigured HOME makes `search` return `success([])`): `--frames search -- --hook` ends in a `search` result; `search -- --frames` yields plain text and no frames; plain `sync --hook` outside frames is untouched (the `--hook` scan lives inside `if (channel)`). Coupled with BM-06 in one commit (alone, `sync -- --hook` would regress from a wrong-verb frame to none).

## 4. AD-17: the adapter orders argv verb, flags, `--`, positionals (`desktop/src/backend/tauri/index.ts`)

Every argv builder (`install`, `uninstallSkill`, `connect`, `publish`, `sync`, `invite`, `team`, `setup`, `eval`, `validate`, `search`, and S7af's `--team` additions) emits `[verb…, ...flags, '--', ...positionals]` when it has a positional, so a leading-dash ref can never be read as an option; flags before `--` (commander demotes a flag after `--` to an operand). Safe only with BM-06 and BM-07 in the same PR. Tests in `index.test.ts`: every builder's argv shape; `install -x` reaches the CLI as `['install', '--team', 'acme', '--', '-x']`.

## 5. CP-35: the Remove dialog stops asserting Global (`src/commands/uninstall.ts`, the Skill screen)

- CLI: add `export` to `async function ledgerScopes(store, team, id, peopleScopes)` (`uninstall.ts:141`; body unchanged). The union filters `entry.team === team && entry.id === id`, so another team's placements survive and a people-file scope with no local placement is still cleared (verified).
- App: the dialog's copy is Teddy's corrected string, already on the board and in the app since PR #61 ("Its files leave ~/.claude/skills on this machine and your people file stops listing it. Because the team endorses it, your people file also records that you declined it, so sync stops offering it back; installing it again clears that."); the title is `Remove <name>?` with no scope. Nothing in this batch adds a scope list to the dialog: the pre-run read model that would name every scope arrives with S7g (`ls --local` rows carry `placement {id, team}`) and S7k (`status.ledger.placements`); record in the PR body that until then the dialog names no scope rather than a wrong one. Delete nothing from GAPS.md yourself (maintainer file); note in `openQuestions` that GAPS.md's typed-decline clause is closed by this batch.

## 6. Tests summary
CLI: `src/lib/__tests__/result.test.ts` (NEW: `cancelled()` sets the flag, `failure()` never does, `CancelledError` round-trips through `fromError`), `src/lib/__tests__/frames.test.ts` (the D13 snapshot of `FRAME_FEATURES`; `declined` from the typed field for all nine messages; `attemptedVerb`), `src/__tests__/bin.test.ts` (BM-06, BM-07 cases), the nine verbs' existing decline tests still pass with unchanged messages, `uninstall.test.ts` (`ledgerScopes` exported, behaviour unchanged). Desktop: `run.test.ts` (declined propagates), `index.test.ts` (argv order for every builder), a `useWorkflow` test, mock tests.

## 7. Acceptance
Root: `npm run lint && npm run typecheck && npm test && npm run build`. Desktop: `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test`. No Playwright, no git, no network, no installs. The orchestrator's real-data proof for this batch: `--frames install -x` against the fixture team ends in one `result` frame (`ok:false`, exit 1, no `declined`), and `--frames connect` answered `false` ends in `declined:true` from the typed field.

## 8. Out of scope
Any `FRAME_FEATURES` value change (S7b, S7ae, S7l stack on this branch); `FRAME_VERBS` additions; the scope list in the Remove dialog (S7g/S7k data); `GAPS.md`.


=================== STANDING CONSTRAINTS ===================
- Read the per-directory README for every subtree you touch before your first edit there (desktop/src/backend/tauri/README.md in particular).
- Gates: from desktop/, `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` (baseline on this branch: 45 files / 625 tests); for a CLI change also, from the repo root, `npm run lint && npm run typecheck && npm test && npm run build` (baseline 1131 tests). Report REAL counts.
- Recorded fixture frames from the CLI at main (status, ls, ls --local, ls member mira, ls project terum, search '') are in .planning/codex-runs/<batch>/frames/*.jsonl for your replay test. If your batch changes the CLI payload (S7d does: frame-mode result frames and the hello map change shape), rebuild the CLI (`npm run build` at the root) and re-record: copy /Users/ryanliu/Documents/Terum/review-2026-09-08-desktop-blank-map/fixture.sh into your run record dir, set its CLI= line to <this worktree>/dist/index.js, run it with a fixture root INSIDE your run record dir (e.g. .planning/codex-runs/<batch>/fx; the git commands it runs act on that scratch fixture, not on this repository, and are allowed), then `printf '' | HOME=<fx>/home node <this worktree>/dist/index.js --frames <verb> [args] > frames/<verb>.jsonl` for each verb your surfaces read (run from inside <fx>/repo/seed; HOME on the node process); S7d reads `status` and `ls` in frame mode, plus a usage-error and a decline case. Commit nothing.
- No git on THIS repository (not even `git status`), no npm install, no network, no Playwright (`npx playwright …` will not launch here; say so, never fake a pixel result). node_modules and the generated fixture (design.json, tokens.css) are in place and must not be edited.
- Never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md at desktop/ root, package.json, design.json, tokens.css, e2e/**, tools/**; put what those files would need into openQuestions. The root README.md is editable only when the spec says so.
- Never delete or weaken a test to make a suite pass; change an assertion only to the new truth and declare it in testsModified. No eslint-disable without a same-line reason. No test-only branches in components; screens never branch on the mock scenario.
- Every new field the real adapter maps is `?? null`, never undefined; every new key on a zod object is declared, never left to passthrough; the real adapter never renders a design constant, a sample value or a fabricated caption; a surface flips to served only when its read model is real.
- If the spec is ambiguous, record the question in openQuestions and implement the most conservative reading. Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged. Verify each write by reading the file back.
- Your final message must be the JSON report the output schema demands: status complete only if every spec item was implemented and the gates ran.
