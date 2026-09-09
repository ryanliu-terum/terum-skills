Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. Both files are reproduced below so they are in your context, but read the on-disk copies too. This tree is branch feat/ask-detail, stacked on fix/first-run-in-app (PR #77, itself on origin/main 279830d = release 0.1.7): S7r's launch route, SetupBoot and setup-session, the first-run batch's LaunchCoordinator, launch-decision.ts, PromptCancelledError and the defaultless select are all in. Build on them, do not redo them. Every file:symbol anchor in the spec was verified on this exact tree by the orchestrator; anchor by symbol, never by line number; where the spec and the code disagree on a location, the code wins and the behaviour the spec describes still has to land.

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

=================== THE SPEC (locked; Ryan's picks are final) ===================

Branch: feat/ask-detail, stacked on fix/first-run-in-app (PR #77: creator onboarding, launch re-read, PromptCancelledError, the defaultless select, LaunchCoordinator/launch-decision.ts). Build on that tree; do not redo it. Every file:symbol anchor below was verified on this exact tree; anchor by symbol, never by line number.

Two parts. Part A carries decision context on ask frames end to end (CLI Prompter -> frame channel -> verbs -> desktop seam -> dialog). Part B is the desktop first-run driver's one-team-per-machine pre-flight. Implement both.

--------------------------------------------------------------------------------
PART A — Decision context on ask frames ("detail")
--------------------------------------------------------------------------------

The bug. In the app, the "Use this identity?" dialog has no body. The CLI prints the identity as a `print` frame (`Identity: @seed — Seed <seed@example.com> (GitHub: seed)`) and then asks with a bare `ask` frame; the desktop routes prints to the boot card's output and builds the dialog from the ask alone, so the person is asked to confirm something they cannot see. The same shape recurs for the §5.4 allowed-tools consents in install and sync (the grant list is a print, the y/N is a bare ask). Governing: phase-1 build spec §3 Prompter contract (.planning/specs/2026-09-02-phase-1-build.md, the "Library-first" paragraph), §5.4 approvals, §6.1 step 2; docs/frame-protocol.md; .planning/specs/m7-S7r.md §4 (RM-24).

Scope (Ryan): the identity confirmation and the §5.4 allowed-tools consents (install malformed, install normal, sync updated-tools). No other verb changes. Confirm dialog buttons read "Yes" / "No". Escape and the backdrop on a CONFIRM dismiss nothing: the dialog stays open and nothing is answered on the person's behalf.

A. CLI Prompter — src/lib/prompt.ts
- Add and export `interface AskOptions { detail?: readonly string[] }` with a doc comment: the lines the person needs in order to answer; a terminal prints them once, immediately before the question; frame mode carries them on the ask frame.
- Signatures on `Prompter`: `confirm(question: string, options?: AskOptions): Promise<boolean>`, `text(question: string, defaultValue?: string, options?: AskOptions): Promise<string>`, `select(question: string, choices: readonly string[], options?: AskOptions): Promise<string>`. `print` unchanged. `NonInteractivePrompter` unchanged (it has no question methods).
- `terminalPrompter`: each of confirm/text/select writes every detail line as `${line}\n` to `output` ONCE per call, immediately before its first `ask(...)` (for select: before the attempt loop, not per attempt). Nothing else changes, so the terminal output for the identity case is byte-identical to today (the line that used to be printed by the verb is now printed by the prompter, in the same position).

B. Frame channel — src/lib/frames.ts
- `AskFrame` gains `detail?: readonly string[]`.
- The internal `ask(kind, question, extra)` accepts `detail` alongside `default`/`choices` and spreads `detail` into the frame ONLY when it is defined and non-empty (an empty array yields no `detail` key at all, so the existing bare-ask `toEqual` assertions in src/lib/__tests__/frames.test.ts stay green).
- `io.confirm`/`io.text`/`io.select` forward `options?.detail`. A select re-ask after an invalid answer carries the same detail again (each ask frame is the whole question).
- docs/frame-protocol.md: in the `ask` row, add `"detail":["..."]` to the shape and this meaning text: `detail` is optional and carries the lines the person needs in order to answer (for example the identity line, or a skill's requested allowed-tools); render it with the question, as the dialog's description, not in the transcript; absent means none. In the versioning paragraph note that `detail` is an additive optional field: protocol stays 1.

C. Verbs (minimum scope)
- src/lib/auth.ts `collectIdentity`: replace the `io.print(identityLine)` + `io.confirm('Use this identity?')` pair with `io.confirm('Use this identity?', { detail: [identityLine] })`. No duplicate print. The question text is unchanged. Keep the identity line's exact format.
- src/commands/install.ts `ensureConsent`:
  - malformed grants: drop the preceding `io.print(...)`; ask `io.confirm(\`Install ${skill.name} despite malformed allowed-tools?\`, { detail: [\`allowed-tools for ${skill.name} could not be parsed: ${describeRaw(skill.grants.raw)}\`] })`.
  - normal grants: drop the preceding print; ask `io.confirm(\`Approve these tools for ${skill.name}?\`, { detail: [\`${skill.name} requests allowed-tools:\`, ...skill.grants.normalized.split('\n')] })`.
- src/commands/sync.ts updated-tools consent (the `allowed-tools changed for` block): drop the print; ask `confirm(\`Approve updated tools for ${skill.name}?\`, { detail: [\`allowed-tools changed for ${skill.name}:\`, ...grants.normalized.split('\n')] })`.
- src/commands/sync.ts `childIo`: confirm/text/select pass `options` through to the wrapped `io` (`io.confirm(question, options)`, `io.text(question, defaultValue, options)`, `io.select(question, choices, options)`).
- Hook mode (NonInteractivePrompter) unchanged. Every other Prompter call site is untouched.
- Phase-1 spec amendment, paste into .planning/specs/2026-09-02-phase-1-build.md immediately after the sentence in the "Library-first" paragraph that lists the four methods (the sentence containing "`confirm(question) → boolean`, `text(question, default?) → string`, `select(question, choices) → choice`, `print(line)`"): "**Decision context (2026-09-09, ask-detail).** The four methods stay; each question method gains an optional trailing `options: { detail?: string[] }` — the lines the person needs in order to answer. The terminal prints them once, immediately before the question; frame mode carries them on the `ask` frame as `detail`. A verb puts what the person needs to answer in `detail`, never in a preceding `print`, when the question depends on it (today: the `Identity:` line before `Use this identity?`, and the §5.4 allowed-tools lists before their consents)."

D. Desktop seam and adapter (desktop/src/backend/**)
- tauri/frames.ts: the `ask` member of `CliFrame` gains `detail?: readonly string[]`; `parseCliFrame` keeps `detail` when `f['detail']` is an array: filter to strings, and set the field only when the filtered list is non-empty (non-strings dropped; an empty or all-non-string list means no `detail` key). The `result` member of `CliFrame` gains `refused?: boolean`, kept when `f['refused'] === true` (Part B).
- tauri/run.ts `onFrame` ask case: spread `detail` into the seam ask frame when present (same idiom as `default`/`choices`). Result case: when `frame.refused === true`, the settled Result carries `refused: true` and the pushed seam result frame carries `refused: true` (same idiom as `declined` -> `cancelled`).
- types.ts: `Result<T>` failure branch gains `refused?: true` (exactly: `{ok:false;error:string;cancelled?:true;refused?:true;reason?:'no-team'|'ambiguous-team';value?:T}`); `PromptQuestion` gains `detail?: readonly string[]`; the seam `Frame` ask member gains `detail?: readonly string[]` and the result member gains `refused?: boolean`; the seam `Prompter` methods gain the same optional trailing `options?: {detail?: readonly string[]}` (declare `AskOptions` once in types.ts and reuse it). The Prompter still has exactly five members.
- prompter.ts `scriptedPrompter`: confirm/text/select accept the options and forward `detail` into the `Question` object ONLY when defined and non-empty (so `toHaveBeenCalledExactlyOnceWith({kind:'text',question:'Name',default:'old'})` in prompter.test.ts still holds). Matching stays keyed by `q.question`.
- drive.ts `driveRun`: passes `frame.detail` to `prompter.confirm(question, {detail})` / `text(question, default, {detail})` / `select(question, choices, {detail})` (omit the options argument when the frame has no detail), and gains a sixth optional positional parameter `onAsk?: (question: PromptQuestion) => void`, invoked with the full question (kind, question, choices/default, detail) BEFORE the prompter call for every ask frame.
- setup-session.ts: add `export function askedSetupStep(question: string): SetupStep | null` beside `printedSetupStep` — `'Use this identity?'` -> `'team'`; anything else -> `null`. `printedSetupStep` keeps its `Identity:` clause. `start()` passes `onAsk` to `driveRun`: `question => update({ activeStep: askedSetupStep(question.question) ?? current.activeStep })`, so the boot card's "Configuring the team" cue survives now that the identity line is no longer a print.
- Consumption and outcomes: see Part B (refused).
- mock/run.ts: `RunContext.ask` opts gain `detail?: readonly string[]`; the mock's pushed ask frame carries it (the existing `...opts` spread already does, once the type allows it; make sure an absent detail does not add a key). The mock's result frame carries `refused: true` when the result has it (Part B).

E. Dialog — desktop/src/app/providers.tsx `PromptDialog`
- Between `<DialogTitle>` and the `<form>`: when `question.detail?.length`, render `<DialogDescription>{question.detail.map((line, i) => <div key={i}>{line}</div>)}</DialogDescription>`, importing `DialogDescription` from `../components/ui/Dialog` (it exists; `.dialog-description` in app.css is the house 13px/20px text3 style). No new CSS.
- Confirm buttons: the secondary reads "No", the primary (submit) reads "Yes" — replacing "Cancel"/"Confirm" for `kind === 'confirm'` only. Text and select keep "Cancel" and "Continue".
- Escape and backdrop: `onOpenChange` ignores a close for `kind === 'confirm'` (the dialog stays open; nothing resolves). For text/select the existing behaviour stays: close -> `cancel()` -> `PromptCancelledError` -> the run is cancelled. "No" on a confirm resolves `false` exactly as the old Cancel did.
- Coordinate with what PR #77 already put in providers.tsx (`PromptCancelledError`, the defaultless select with the disabled "Choose…" placeholder and disabled Continue): extend, never overwrite. The workflow dialogs' own Confirm buttons (library/share screens' drawn dialogs) are NOT PromptDialog and do not change.

F. Recordings — NOT your job. The orchestrator re-records .planning/codex-runs/m7-S7r/frames/setup.jsonl and setup-join.jsonl from the rebuilt CLI after your run (never edit any .jsonl). Expected change in each: the `{"t":"print","level":"info","line":"Identity: @seed — Seed <seed@example.com> (GitHub: seed)"}` frame disappears and the ask becomes `{"t":"ask","id":"q1","kind":"confirm","question":"Use this identity?","detail":["Identity: @seed — Seed <seed@example.com> (GitHub: seed)"]}`. Write the replay tests against that shape. Until the orchestrator re-records, the two S7r setup replays in setup-replay.test.tsx will fail in your sandbox on the identity-detail assertion: report that verbatim in gates.test.output as expected, do not work around it. (The first-run recordings under .planning/codex-runs/first-run-in-app/frames/ contain no identity ask and are unaffected.)

--------------------------------------------------------------------------------
PART B — First-run driver pre-flight (one team per machine, desktop half; Ryan ruled REFUSE)
--------------------------------------------------------------------------------

In desktop/src/backend/setup-session.ts `start()`, before spawning setup:
1. If `launch.target` is set: call `backend.status()` first. If it is ok and `teams.length >= 1` and the target's repository identity equals NONE of the configured teams' remotes (`TeamStatus.remote`, null-skipped) -> do NOT spawn setup; settle with `{ ok: false, error: 'This machine is on team <A>. To join <target>, leave <A> first (Settings ▸ Team).', refused: true }` where `<A>` is `teams[0].name` and `<target>` is `launch.target` verbatim; outcome `'refused'`; consume the launch (the exact `writtenAt`, same rule and same prefs write/flush as ok/cancelled; manual `manual:` requests are never consumed). Same remote -> run setup as today (the CLI resumes). Status not ok, or teams empty, or no target -> run setup (the CLI decides).
2. Repository identity comparison — one exported pure function in desktop/src/backend/paths.ts (beside `githubUrl`, reuse its stripping), e.g. `export function repoIdentity(remote: string): string`: trim; `git@github.com:` -> `github.com/`; strip `^ssh://git@`, then any `^[a-z][a-z0-9+.-]*://` protocol; strip `\.git/?$` and a trailing `/`; lower-case the whole string; a bare `<org>/<repo>` (exactly two non-empty segments and no dot in the first) becomes `github.com/<org>/<repo>` — the CLI's `setup acme/team` shorthand is a github.com target. A file path or `file:` URL reduces to itself under the same rules (it will never equal a github.com remote, which is the correct refusal). Compare by string equality; apply the same function to both the launch target and each configured remote.
3. Result type: `refused?: true` on the seam Result and the `refused` mapping in tauri/run.ts and tauri/frames.ts (Part A/D above). Forward-compatible: the 0.1.7 CLI never sends it; the CLI batch feat/one-team-per-machine-cli will. A CLI result carrying `refused:true` settles the session with outcome `'refused'` and consumes the launch under the same rule as the pre-flight.
4. `SetupSnapshot.outcome` gains `'refused'`. setup-session's outcome mapping: ok -> finished/handoff; `cancelled` -> cancelled; `refused` -> refused; else failed.
5. SetupBoot.tsx:
   - `failed = result?.ok === false && !result.cancelled && !result.refused`; `refused = result?.ok === false && result.refused === true`.
   - Title for `'refused'`: "Setup not started". Tile: keep the existing expression (no `alert` icon for refused; alert stays failure-only).
   - refused renders `result.error` inside the existing `role="status"` live region (it already renders `result.error` when the result is not ok) and NO `role="alert"` element and no `data-failed` on the progress bar.
   - Actions when refused: primary "Open Settings ▸ Team" -> `navigate('/settings/teams')`; no secondary. Never auto-navigate on refused.
   - Cancelled (any `result.cancelled` outcome: the CLI's typed decline, Stop, or No/Cancel in a dialog) keeps its existing rendering (title "Setup cancelled", Retry/Back, no alert) and ADDITIONALLY navigates to `/library/global` once, after the consumption write — implement as a `useEffect` on `state.outcome === 'cancelled'` (the session writes `launch:consumedWrittenAt` and flushes before it publishes the outcome, so an effect keyed on the outcome runs after the write). Guard against navigating twice.
   - Failed keeps Retry/Back and the alert exactly as today.
6. Existing tests that assumed a target on a configured machine runs setup must be re-anchored, not deleted — the pre-flight now refuses a foreign target on a one-team machine, so the targets in those tests become the configured team's own remote (in a different spelling, which is the normalization proof):
   - desktop/src/screens/onboarding/setup-driver.test.tsx: the `launch` const target `'/fixture/team.git'` -> `'https://github.com/terum/team-skills.git'` (the mock status's one team remote is `github.com/terum/team-skills`); every assertion that printed or matched the old target follows.
   - desktop/src/app/launch-coordinator.test.tsx: `'org/team'` -> `'terum/team-skills'`; `'org/a'` -> `'terum/team-skills'` and `'org/b'` -> `'https://github.com/terum/team-skills'` (two distinct requests A and B by `writtenAt`, both same-remote so both drive setup); the `getByText('org/a')` / `getByText('org/b')` assertions follow. The consumed-request case (`other/team` with the consumed writtenAt) is unaffected.
   - desktop/src/backend/tauri/__tests__/setup-replay.test.tsx: the two S7r replays use the S7r status recording whose one team is `acme` with repository `https://github.com/acme/team`; their `target` becomes `'acme/team'` (the CLI's own joinCommand shorthand) and the spawn assertion becomes `[['setup','--','acme/team']]`.
   - The tests that assert "Setup cancelled" + Retry after a Cancel/Stop (setup-driver.test.tsx: the typed-decline case, "select Cancel is a typed cancellation…", "Stop cancels the run…") gain the navigation: after the cancelled outcome, `await waitFor(() => expect(location.hash).toBe('#/library/global'))`, and the request is consumed; the assertions about the cancelled rendering that can no longer be observed after navigation are replaced by the session snapshot (`existingSetupSession(b, launch)?.snapshot()` — outcome 'cancelled', result cancelled:true) plus the consumption write. Declare each in testsModified with "Part B.5".

--------------------------------------------------------------------------------
TESTS — each new or changed assertion must FAIL on the pristine base (origin/fix/first-run-in-app) and PASS after. The orchestrator runs your test files on a pristine copy of the base; write them so they compile against the new API and fail on the old tree.
--------------------------------------------------------------------------------

CLI (vitest from the repo root):
- src/lib/__tests__/fixtures.ts `ScriptedPrompter`: add `readonly details: Record<string, string[]> = {}`; confirm/text/select record `options?.detail` (as a plain string[] copy) under the question when provided. `NonInteractivePrompter` unchanged.
- src/lib/__tests__/auth.test.ts, the three identity cases that assert the Identity line ("shows the known identity on one line…", "a bound per-team handle is shown…", 'a recorded "no GitHub login" is a known answer…'): `io.lines` equals `[]` and `io.details['Use this identity?']` equals `[<the identity line>]`.
- src/lib/__tests__/frames.test.ts: new — `io.confirm('Use this identity?', { detail: ['Identity: @me — Me <me@x.test> (GitHub: octocat)'] })` yields an ask frame carrying `detail` (exact `toEqual`); `io.confirm('Proceed?', { detail: [] })` yields a frame with no `detail` key (`toEqual` without it); the existing bare-ask assertions unchanged.
- src/lib/__tests__/prompt.test.ts (model on the existing stream/channel helper and the "print writes one line" test): a terminal `confirm('Use this identity?', { detail: ['Identity: @me — Me <me@x.test> (GitHub: octocat)'] })` answered `y` writes exactly `'Identity: @me — Me <me@x.test> (GitHub: octocat)\nUse this identity? [y/N] '` once to the output (assert the exact output string) and resolves true.
- src/commands/__tests__/install.test.ts consent cases ("asks consent for allowed-tools in the pinned tree…" and the malformed case that asserts `io.lines.join('\n')` contains "could not be parsed"): the lines move from `io.lines` to `io.details[question]` — assert `io.lines` no longer contains them and `io.details['Approve these tools for helper?']` equals `['helper requests allowed-tools:', 'Bash(*)']` (normalized lines), and `io.details['Install sample despite malformed allowed-tools?']` has one line starting `'allowed-tools for sample could not be parsed: '`.
- src/commands/__tests__/sync.test.ts "reviews an added tool interactively…": `approved.lines.join('\n')` no longer contains 'allowed-tools changed'; `approved.details['Approve updated tools for sample?']` equals `['allowed-tools changed for sample:', 'Bash(ls)', 'Read(*)']`. Plus one endorsed-replay test proving `childIo` passthrough: run sync so that the endorsed batch installs a newly endorsed skill with allowed-tools through `childIo` (installOne -> ensureConsent) and assert the outer ScriptedPrompter's `details['Approve these tools for <name>?']` carries the grant lines (find the existing endorsed-batch fixture in sync.test.ts and extend or clone it).

Desktop (vitest from desktop/, NODE_OPTIONS=--no-experimental-webstorage):
- desktop/src/backend/tauri/__tests__/run.test.ts: `parseCliFrame` keeps `detail` (`['a', 1, 'b']` -> `['a','b']`; `[]` and `[1]` -> no key); a `cliRun` ask with detail reaches the seam frame with `detail`; a result frame with `refused:true` settles `{ok:false,error,refused:true}` and the seam result frame carries `refused:true`.
- desktop/src/backend/__tests__/drive.test.ts: an ask with detail reaches the scripted prompter's question with `detail`, and `onAsk` is invoked with the question before the answer.
- desktop/src/backend/__tests__/prompter.test.ts: detail forwarded into the unexpected question; no `detail` key when absent (existing assertion).
- desktop/src/app/providers.test.tsx: a confirm with detail renders the lines inside `.dialog-description` (each line its own div); confirm buttons read Yes/No (`getByRole('button',{name:'Yes'})` resolves true; the existing first test re-anchored from 'Confirm' to 'Yes'); Escape on a confirm (`fireEvent.keyDown(dialog,{key:'Escape'})` or userEvent `{Escape}`) leaves the dialog open and resolves nothing (the result callback is not called; the dialog is still in the document); a text prompt's Cancel still rejects (existing test).
- desktop/src/backend/tauri/__tests__/setup-replay.test.tsx: the S7r replays assert the identity dialog contains the Identity line (`toHaveTextContent('Identity: @seed — Seed <seed@example.com> (GitHub: seed)')`), that "Configuring the team" is the `current` row while the identity dialog is open (`data-state="current"`), and that the boot card's Setup output does NOT contain the Identity line; button names 'Confirm' -> 'Yes' and 'Cancel' -> 'No' for the confirm dialogs (hook, skill, identity); the text asks' 'Continue' stays. New: a refuse replay — target `'github.com/other/repo'` with the S7r status recording (one team acme) -> no setup spawn at all (`fake.spawns` has no `setup` argv), the launch is consumed (`launch:consumedWrittenAt` === STATE.writtenAt), the status line reads `This machine is on team acme. To join github.com/other/repo, leave acme first (Settings ▸ Team).` with no `role="alert"`, the heading reads "Setup not started", and the primary button "Open Settings ▸ Team" navigates to `#/settings/teams`.
- desktop/src/screens/onboarding/setup-driver.test.tsx: new — a target on a one-team mock status with a different remote (`'github.com/other/repo'`) -> setup not called, launch consumed, status line (no alert), primary "Open Settings ▸ Team" -> `#/settings/teams`; the same-remote target (the re-anchored `launch`) -> setup called; a declined/cancelled outcome -> navigates to `#/library/global` after consumption; a mock status that fails -> setup still called (the CLI decides). The button re-anchoring 'Cancel' -> 'No' on the typed-decline confirm.
- desktop/src/backend/__tests__/setup-steps.test.ts: `askedSetupStep('Use this identity?')` is 'team'; `askedSetupStep('Join this team?')` is null.
- A unit test for `repoIdentity` (beside paths.test.ts): `'https://github.com/Acme/Team.git'`, `'git@github.com:acme/team.git'`, `'github.com/acme/team/'`, `'acme/team'` all reduce to `'github.com/acme/team'`; `'/srv/x/team.git'` reduces to `'/srv/x/team'`; `'file:///srv/x/team.git'` reduces to `'/srv/x/team'` (protocol stripped, so a `file:` target and the same path compare equal) — assert exactly what your function returns and keep it consistent.

=================== STANDING CONSTRAINTS ===================

- Run NO git command. Do not `npm install`/`npm ci` (node_modules is already in place at the worktree root — a symlink — and under desktop/ — a real copy). Do not touch node_modules.
- Do not edit: desktop/AGENTS.md, desktop/FIDELITY.md, desktop/GAPS.md, desktop/README.md, desktop/package.json, desktop/e2e/**, desktop/src/styles/tokens.css, desktop/src/fixtures/design.json, any .jsonl recording, any fixture.sh, package.json, package-lock.json, .planning/codex-runs/** (except that you may read them).
- Native (@tauri-apps/*) imports only under desktop/src/backend/tauri/. Screens import only src/backend/types and src/backend/index.
- Every new key on a zod object in desktop/src/backend/tauri is declared on the closed object (never passthrough); every new DTO field maps with `?? null`, never undefined. `exactOptionalPropertyTypes` is on in desktop/: never assign `undefined` to an optional property; spread conditionally.
- No new CSS in desktop/. No change to any locked board's pixels (no drawn board renders PromptDialog or the refused Boot state; the fidelity gate is the orchestrator's).
- Gates you run and report with REAL counts:
  Root (from the worktree root): `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
  Desktop (from desktop/): `npm run typecheck`, `npm run lint`, `NODE_OPTIONS=--no-experimental-webstorage npm test`.
  Known sandbox issue: vitest under the root may fail with EPERM on node_modules/.vite-temp because the root node_modules is a symlink outside your writable root. If that happens, report it verbatim in gates.test.output as a sandbox failure — do not work around it by editing configs or node_modules. The orchestrator's own run outside the sandbox is the authoritative gate. If typecheck and lint pass and only vitest is blocked that way, say so plainly. The two S7r setup replays are expected red until the orchestrator re-records the frames (Part A.F): say so, do not touch the recordings.
- Never delete or weaken an existing test to make a suite pass; declare every existing-test change in testsModified with the spec section that requires it (the Confirm/Cancel -> Yes/No re-anchoring on confirm dialogs, the target re-anchoring in Part B.6, and the moved consent lines are expected and should be listed).
- No `eslint-disable` without a reason on the same line. No test-only branches in components.
- Where the spec is ambiguous, implement the most conservative reading and record the fork in openQuestions. Never resolve a design fork yourself.
- Do not commit, stage, or push. Leave every change in the working tree.
- Finish with the structured report the output schema requires. In `summary`, list which spec sections (A, B, C, D, E; Part B 1-6; the CLI and desktop test bullets) you completed; anything not completed goes in deviations with the reason.
