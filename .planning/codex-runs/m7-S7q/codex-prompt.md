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

=================== THE SPEC: .planning/specs/m7-S7q.md ===================
# m7-S7q: the hello-features wiring and the nine no-CLI rows (app-only)

**Status:** LOCKED for implementation (M7 queue, batch 3 of tranche 1; every later un-grey depends on it). Rows AC-06, AC-07, AC-08, CP-13, CP-14, IB-08, RM-27, RM-45, RM-47. Approver: none for the CLI (there is no CLI change: Ledger D6 LOCKS the app-side mapping, no CLI key rename). Depends on S7af (stack on `origin/codex/m7-S7af` while it is unmerged).
**Sources:** Ledger D6 (app-side mapping), D1 (`roles` = permission chip, stays false; `memberRole` is S7b's new key), D2 (favorites/follow hidden on the real adapter), D9 (no sixth Tauri command), D10 (window minimum 960x600 stays; sideways scroll is S7x's). M7 document §4 S7q with its verifier corrections A to K (authoritative over the batch text). `desktop/AGENTS.md` invariants; in particular invariant 2 changes meaning here (the flags gain consumers), and GAPS.md/AGENTS.md are maintainer files: describe the needed GAPS.md:28-32 rewrite in `openQuestions`, do not edit them.

## 0. What this batch is

The CLI's `hello` frame publishes twelve capability switches (`FRAME_FEATURES`, `src/lib/frames.ts`: favorites, follow, roles, lastSeen, installScope, inviteScoping, disablePerMachine, projectMembers, liftOnCards, runEvalInApp, perCase, progress), all `false` at 0.1.6. The adapter throws the frame away (`run.ts`: `case 'hello': return;`) and hard-codes its own eight `Capabilities`, so nothing on screen ever changes when the CLI gains an ability, and five of the eight flags have no reader anywhere in `desktop/src` (only `windowChrome` is consumed). This batch makes the app read the hello frame, exposes the CLI's switches on the seam, and gives every flag a consumer that hides or greys the drawn control when the CLI says `false`, while the mock keeps every switch `true` so the 88 locked boards do not move. It also records two refusals (AC-07, CP-14) and fixes the platform-seam leaks the verifier found (AC-08).

## 1. The seam (`desktop/src/backend/types.ts`, `Backend.ts`)

- Keep the eight-key `Capabilities` (D6): `disablePerMachine` straight across from the hello frame; `perCaseEvalTables` from the hello key `perCase`; `inboxEventLog`, `offtargetKind`, `machineRegistry` stay `false` on the real adapter (their mechanisms are cut; the mock keeps `true`); `windowChrome`, `openInEditor`, `clipboard` unchanged.
- Add `features: Readonly<Record<FeatureKey, boolean>>` to the seam as `Backend.features(): Promise<Features>` where `FeatureKey` is the CLI's twelve names plus `memberRole` (D1; `false` until S7b's CLI ships it, and `false` when the hello frame omits a key). The mock declares every key `true`. The real adapter fills it from the hello frame of a cheap read (`--frames status` is the first process every session runs; cache the hello frame from ANY run in the session: `run.ts` gets an `onHello(frame)` option and the adapter memoises the last hello it saw; before any run has happened, `features()` runs `status` once). A key absent from the frame maps to `false` (`?? false`), never `undefined`.
- `run.ts`: `case 'hello'` stops returning; it calls `options.onHello?.(frame)` and still emits no seam frame (the shell never draws hello).

## 2. Every flag gets a consumer (the un-grey rule; pixel-neutral when `true`)

Each drawn control below reads its switch through `useQuery(['features'])` (and `['capabilities']`) and, when the switch is `false`, is HIDDEN (not disabled, not stubbed: Ledger D2 and the North Star) unless the row below says "greyed". The `true` branch renders exactly today's markup, so the mock's boards are byte-identical. Add one test per flag: `false` renders the documented degraded surface, `true` renders the same DOM as before (snapshot-neutral).

| switch | control(s) | when false |
|---|---|---|
| `favorites` | the card heart with count (SkillCard), the detail Favorite button, MarketplaceProject's heart | hidden; the per-viewer `favorite` pref is not read on the real adapter (D2: never a count of one) |
| `follow` | Follow button and follower count on MarketplacePerson / MarketplacePeople cards | hidden |
| `roles` | the Admin/Member permission chip and its menu on Share (ShareScreen member row) | hidden (D1: this key is the PERMISSION chip; S7h will draw the read-only host-admin column from `ls --host`, which must NOT key off `roles`) |
| `memberRole` | the roster job label ("founder", "platform") on Share and Marketplace people cards | hidden (lights in S7b) |
| `lastSeen` | the Last active column on Share | column present, cell renders `—` (the header stays for geometry) |
| `installScope` | the scope radios in the Install dialog | the radio group is replaced by one static line naming the scope the CLI will use ("Global"); the dialog keeps its height |
| `inviteScoping` | the Invite scoping section | hidden (the dialog's height shrinks; the mock is unaffected) |
| `disablePerMachine` | the per-skill enable Switch on the card and the rail status card | hidden; the status card shows "Loaded in every session" for installed skills |
| `projectMembers` | project member facepiles, the Teams column on Share, "N teammates use this project" | hidden / `—` |
| `liftOnCards` | the lift figure and verdict chip on Library and Marketplace cards | the figure slot renders `—` and the chip is hidden |
| `runEvalInApp` | the Run eval button and dialog on the Evals tab and Onboarding Basics ▸ Eval | hidden; the terminal hint stays |
| `perCase` → `perCaseEvalTables` | Table 1 and the per-case rows on the Evals report and InboxEval | hidden with the board's "per-case rows are not in the committed receipt" line (one `Small`) |
| `progress` | the Onboarding boot card's live progress phases (S7r's consumer) | S7r's; here only expose the key |
| `inboxEventLog` (capability) | the Inbox nav group and screens | already hidden by S7af's `surfaces.inbox`; nothing more |
| `offtargetKind` | the off-target alert kind and Settings ▸ Inbox's kind row | kind row hidden |
| `machineRegistry` | "your other machines", the footer machine name | hidden / `—` |

## 3. The nine rows

- **AC-06 (window chrome, verifier corrections C and D):** decide decorations per platform FIRST, in `tauri.conf.json`: macOS keeps `decorations:true` + `titleBarStyle: Overlay` + `hiddenTitle` + `trafficLightPosition {x:16,y:14}`; Windows gets `decorations:true` and NO drawn window controls (delete the three decorative `window-controls` spans TopBar renders for `drawn-controls`: they duplicate the native title bar and inset one end block, which the design forbids). `windowChrome` becomes `'mac-overlay' | 'native' | 'cosmetic'`; `'native'` draws neither lights nor controls. Fix the mac-overlay spacer: `TopBar.tsx` substitutes `<div style={{width:78}}/>` for the 52 px TrafficLights, moving the mark 26 px right; make it 52 so the mark stays at x 76 as drawn. Dragging: add `data-tauri-drag-region` to the top bar's empty regions (it does not inherit), and hand-build double-click-to-maximise via `getCurrentWindow().toggleMaximize()` under `core:window:allow-internal-toggle-maximize` (already granted), in `src/backend/tauri/` behind a seam method `windowAction('toggle-maximize'|'start-drag')`. No resize targets (decorations stay true). Record in the PR body: the fidelity gate runs browser mode (cosmetic), so the two platform headers are untested by it; write one vitest per mode asserting the TopBar's left-block geometry (mark at x 76 in cosmetic and mac-overlay, x 16 in native). Window minimum stays 960x600 (D10).
- **AC-07 (category icons in team.json): REFUSED, recorded.** Cover-note text for the PR body: `guardTeam` admits exactly rows c/d/e (`src/lib/guard.ts:153-156`) and `categories` is written once, at scaffold time (`src/commands/team.ts` `const team: Team = { …, categories: CATEGORIES, … }`); the app maps category → icon app-side from a fixed table with a neutral fallback icon (`iconName()` must never throw on an unknown category: return `'tag'`).
- **AC-08 (four calls behind one seam, corrections E and F):** add `Backend.openUrl(url)` (adapter: `openUrl` from `@tauri-apps/plugin-opener`; add `opener:allow-open-url` to `capabilities/default.json` scoped to `https://github.com/*`; mock/browser: `window.open(url, '_blank', 'noopener')`) and `Backend.revealPath(path)` (adapter: `revealItemInDir`, permission already granted; mock: no-op ok). Route EVERY external anchor through `openUrl`: `SkillScreen`'s repo link becomes a computed deep link `https://github.com/<repo>/tree/<version_full>/skills/<name>/` (never the bare repo root), `market-components.tsx`'s hard-coded `https://github.com/terum/team-skills` anchor is computed from the project's `remote`, Settings' Show in Finder uses `revealPath`. `copyImage` stays as shipped (name its owner: this batch). `user-select: none` on `.shell` and `.onboarding-frame` is confirmed and stays.
- **CP-13, CP-14:** CP-14 (project metadata verbs) REFUSED, recorded with the same cover-note reasoning; the project description/icon fields stay hand-maintained in team.json (S7p documents them). CP-13: the "New skill" CTA is relabelled "Connect" (A3, RM-37 MOOT) wherever the app draws it, and it opens the connect picker (`backend.connect({})`) through the Prompter.
- **IB-08 (one definition for the three counters):** `LIBRARY_OVERVIEW.attention` (8 = 2 failing evals + 3 updates + 3 not evaluated) already contains the 3 updates the sidebar counts separately. Define, in `src/backend/mock/derive.ts` and as a seam comment, `attention = failingEvals + updatesAvailable + notEvaluated` and `counts.Alerts = attention`, `counts.Updates = updatesAvailable`; assert the identity in a test against the fixture (8 = 2+3+3, Updates 3, Alerts 8). The real adapter serves these only when `status` carries them (S7k); until then they are omitted (S7af rule).
- **RM-27 (correction H):** the app never receives the gh-login question; it must render the CLI's PRINT frame `GitHub CLI is installed but logged out. Run \`gh auth login\` in a terminal, then try again.` inside the workflow popup as a highlighted line, not lose it. Test with a recorded print frame.
- **RM-45:** the app never offers to change credential configuration, probe access or retry with other credentials (phase-1 spec :338). Every error board's remedy copy is checked against that: none may say "sign in" or "change the token"; the Account gh row's "Sign in" hands off to the terminal (`openInEditor`-style) and says so.
- **RM-47 (correction I):** the six clone states (`absent`, `incomplete{not-a-repository|no-team-json|unverifiable}`, `foreign`, `ok`, and ok-but-unreadable) each get one sentence in a `cloneStateCopy()` helper in `src/backend/mock/derive.ts` (Teddy still owns the final wording; use the CLI's own `describeClone` lines verbatim where they exist) consumed by Settings ▸ Teams and the footer; `absent` never says "another window left this team".

## 4. Tests

`seam.test.ts` must keep passing unchanged. Add the per-flag pair tests (§2), the TopBar geometry tests (AC-06), `openUrl`/`revealPath` mock tests, the IB-08 identity test, the RM-27 print-frame test, an adapter test that `features()` reads a recorded hello frame (`.planning/codex-runs/m7-S7q/frames/status.jsonl`) and maps every key (`perCase` → `perCaseEvalTables`, absent `memberRole` → `false`).

## 5. Acceptance

`npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` in `desktop/`; `cargo check` is not needed (no Rust edit) unless you touch `tauri.conf.json`, in which case run it (`tauri-build` validates the config). No Playwright, no git, no network. The orchestrator runs the 88-board fidelity gate: every branch must be a no-op in the `true` state the mock reports.

## 6. Out of scope

Any edit under `src/` (the CLI) incl. `frames.ts`; `GAPS.md`/`AGENTS.md` (describe the five-line rewrite in `openQuestions`); the Inbox feed; `memberRole`'s CLI side (S7b); the sideways-scroll CSS (S7x); a sixth Tauri command (D9).


=================== STANDING CONSTRAINTS ===================
- Read the per-directory README for every subtree you touch before your first edit there (desktop/src/backend/tauri/README.md in particular).
- Gates: from desktop/, `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` (baseline on this branch: 45 files / 625 tests); for a CLI change also, from the repo root, `npm run lint && npm run typecheck && npm test && npm run build` (baseline 1131 tests). Report REAL counts.
- Recorded fixture frames from the CLI at main (status, ls, ls --local, ls member mira, ls project terum, search '') are in .planning/codex-runs/<batch>/frames/*.jsonl for your replay test. If your batch changes the CLI payload (S7f), rebuild the CLI (`npm run build` at the root) and re-record: copy /Users/ryanliu/Documents/Terum/review-2026-09-08-desktop-blank-map/fixture.sh into your run record dir, set its CLI= line to <this worktree>/dist/index.js, run it with a fixture root INSIDE your run record dir (e.g. .planning/codex-runs/<batch>/fx; the git commands it runs act on that scratch fixture, not on this repository, and are allowed), then `printf '' | HOME=<fx>/home node <this worktree>/dist/index.js --frames <verb> [args] > frames/<verb>.jsonl` for each verb your surfaces read (run from inside <fx>/repo/seed; HOME on the node process). Commit nothing.
- No git on THIS repository (not even `git status`), no npm install, no network, no Playwright (`npx playwright …` will not launch here; say so, never fake a pixel result). node_modules and the generated fixture (design.json, tokens.css) are in place and must not be edited.
- Never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md at desktop/ root, package.json, design.json, tokens.css, e2e/**, tools/**; put what those files would need into openQuestions. The root README.md is editable only when the spec says so.
- Never delete or weaken a test to make a suite pass; change an assertion only to the new truth and declare it in testsModified. No eslint-disable without a same-line reason. No test-only branches in components; screens never branch on the mock scenario.
- Every new field the real adapter maps is `?? null`, never undefined; every new key on a zod object is declared, never left to passthrough; the real adapter never renders a design constant, a sample value or a fabricated caption; a surface flips to served only when its read model is real.
- If the spec is ambiguous, record the question in openQuestions and implement the most conservative reading. Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged. Verify each write by reading the file back.
- Your final message must be the JSON report the output schema demands: status complete only if every spec item was implemented and the gates ran.
