Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. The work is confined to desktop/ (plus nothing else).

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

=================== THE SPEC: .planning/specs/2026-09-08-design-strings-app-half.md ===================
# Design-side strings: the app half (S1d)

**Status:** LOCKED for implementation, 2026-09-08. Owner: Ryan (M7 takeover). Source rulings: Teddy's design-strings decision walk (`.planning/decisions/2026-09-08-design-strings-decision-walk.md`, D14's 28 rows, D11, D13, D17) and the costing §3.2 (`.planning/research/2026-09-07-desktop-app-gap-costing.md`). The canvas half is already applied: `build.py` was patched by `.planning/codex-runs/design-strings/patch_ak.py` (read it; every new string below is quoted from it), the 99 boards were re-rendered, and `desktop/src/fixtures/design.json` + `desktop/src/styles/tokens.css` were regenerated and committed (`ee5fa73`). **This spec makes the app match the patched canvas again.** Nothing here adds a feature.

Governing rules: `desktop/AGENTS.md` (all eight invariants; you are an implementing agent: never edit `GAPS.md`, `FIDELITY.md`, `AGENTS.md`, `README.md`, `package.json`, `design.json`, `tokens.css`), the North Star (a teammate sees only real data; nothing drawn promises what the CLI cannot do), and the pixel rule: every screen reproduces its board's geometry exactly. You cannot run the fidelity oracle (no Playwright in the sandbox); the orchestrator runs it after you. So follow the board strings and layout rules here to the letter.

## 0. What changed in the fixture (design.json), and what must compile against it

1. **`origin` → `project`** on every skill-shaped record (RM-14): `SKILLS[]`, `CATALOG[]`, `MARKET_EXTRA[]`, `INBOX[]`, `DETAIL`, `DETAIL_PARTIAL`, `DETAIL_NO_RECEIPT`, `DETAIL_NOT_INSTALLED`. Values unchanged (`terum`, `ssm`, `mrf`, `docs`, `local`). The token means **project membership** (the team.json list the skill is endorsed on, or the machine-local `local`), never a GitHub owner.
   - `src/fixtures/schema.ts`: rename the key in `detailSchema`, `SKILLS`, `INBOX`, `CATALOG`, `MARKET_EXTRA` (lines 2, 19, 20, 21, 22).
   - `src/backend/types.ts:14` `SkillCard.origin` → `SkillCard.project`. Rename every reader: `src/backend/mock/index.ts:48`, `src/backend/mock/derive.ts` (incl. `skill_ref`), `src/backend/mock/onboarding.ts:8` (`sample.origin`), `src/components/domain/SkillCard.tsx:15`, `src/screens/skill/SkillScreen.tsx:41` (crumb), `src/screens/inbox/reports.tsx:38`, and any test that builds a card literal. `grep -rn origin src` must end with zero skill-record hits (the word may survive only in unrelated strings such as git remotes).
2. **`LIBRARY_OVERVIEW`** (RM-16): `skills_delta`, `installs_delta` and `sparkline` are gone; `skills_note` (`"7 endorsed to Global"`) and `installs_note` (`"across every people file · 12 active teammates"`) arrived. Update `schema.ts:4` and `Library['overview']` typing (`types.ts`), the mock, and `src/components/domain/Analytics.tsx` (§2.1).
3. **`ONBOARD_PLACED` → `BOOT_STEPS`** (number 4, D11/CP-O1): `schema.ts:81`, `types.ts:60` (`Onboarding` Pick), `mock/onboarding.ts:7-8`, `screens/onboarding/OnboardingScreen.tsx:68` (§2.9).
4. **`JOIN_BLOCK_NOTE`** (string, CP-05/TJ-O2) is new: add it to `schema.ts` (a `z.string()` beside `INVITE_TIP`), to the `Onboarding` Pick in `types.ts:60`, and to the mock's onboarding object; consume it in §2.6 and §2.9.
5. `DETAIL_PARTIAL.repo` now equals `TEAM_REPO` (`terum/team-skills`, CP-34); `INBOX[secret-scan].category` is `security` (CP-27); `DETAIL.receipt.results` and `DETAIL_PARTIAL.receipt.results` lost their "N rounds settled by checks, M by judge" clause (EV-21). These flow through the fixture; make sure nothing re-derives the old values (e.g. the mock's `skill_ref` must not manufacture `<origin>/team-skills`, see §2.2).

Run `npm run typecheck` first: it enumerates most of §0 for you.

## 1. Two app-wide rules (D13)

- **Home abbreviation.** Every CLI message the app renders passes through one helper, `abbreviateHome(text: string, home: string): string` in `src/backend/paths.ts` (new; pure, no I/O): it replaces the absolute home prefix at the start of a path token with `~` (`/Users/teddy/.terum/skills/config.json` → `~/.terum/skills/config.json`; also `/home/<u>/…` and `C:\Users\<u>\…` shapes). The mock applies it to its error strings; `src/backend/tauri/index.ts` applies it to every `Result.error` and every print line it forwards, with `home` from the platform (`host_platform()` already exists; if home is not known, the helper is the identity). Unit-test it (four cases incl. a path that merely contains the home string mid-way, which must NOT change).
- **Error lines wrap.** The `ErrorLine` primitive (`src/components/domain/Primitives.tsx` / `Primitives.css:1`) drops `white-space: nowrap` for `max-width: 100%; overflow-wrap: anywhere; text-align: left; box-sizing: border-box;` (the board's `error_line`, build.py). Onboarding's own error line already wraps; leave it.

## 2. Screen by screen (board strings verbatim; `build.py` is the oracle, `patch_ak.py` quotes each)

### 2.1 Library (boards Library, LibraryLight, LibraryEmpty, LibraryNoResults, LibraryCollapsed, LibraryError, OnboardingDone)
- `Analytics.tsx`: the Skills tile's secondary is `<Small>{o.skills_note}</Small>` (no arrow, no `Delta`); the Team installs tile's secondary is `<Small>{o.installs_note}</Small>` (no `Delta`, no `Sparkline`). Delete the now-unused `Sparkline` and `Delta` components and their CSS if nothing else uses them. The zero state is unchanged.
- View header subtitle (CP-10): `"15 of 30 skills"` on the Global library, i.e. `${skills.length} of ${COUNTS.Global} skills` (the mock's global count is 30 and the grid renders 15); the empty state keeps `"0 skills"`; project scopes follow the same `${shown} of ${count} skills` form.
- LibraryEmpty terminal hint (CP-06): `npx -y terum-skills@latest install <ref>` (was `install <skill>`).
- LibraryError (CP-36): body `"terum-skills could not read ~/.terum/skills. Check the folder still exists and is readable, then try again."`, secondary button `"Show in Finder"` (was "Open settings"), error line `"EACCES: permission denied, scandir '~/.terum/skills'"` (the mock's `errors.library`, `mock/index.ts:11`).

### 2.2 Skill detail (SkillDetail*, 20 boards)
- Remove dialog (CP-01): title `Remove {name}?` (was `… from Global?`); body `"Its files leave ~/.claude/skills on this machine and your people file stops listing it. Because the team endorses it, your people file also records that you declined it, so sync stops offering it back; installing it again clears that."`; command `npx -y terum-skills@latest uninstall-skill <owner>/<repo>/<skill>` built from `skill_ref`.
- `mock/derive.ts:64` `skill_ref` (CP-44): `${s.repo || TEAM_REPO}/${s.name}` — the repository is read from the configured remote, never built from a project name.
- Quality tab (CP-04): caption `"Hygiene checks · passed on connect, 12 days ago · free, no model calls"`; validate hint prefix `"Runs on connect, publish, sync and in CI"`.
- Details row `Installs` (TJ-13): the bare number (`12`), not `12 teammates`.
- Facepile label (TJ-13): `{n} teammate{s} ha{s|ve} installed this`; uses popover header `Installed by {n} teammates`.
- Evals tab empty state title (CP-45): `"Not evaluated"` (was "No receipt yet"); rail `Evaluated` value when there is no receipt: `"Never"` (was "Never · no receipt").
- History rail (EV-20): rows are not interactive: no hover, no focus ring, no selected state. Only the FIRST row (state `showing`: bg4 fill, quiet text = text2) shows the lift figure, the partial fraction and the strip; every other row shows only `when` and `runner · version` (transparent background, text3). Caption: `"One row per committed run, newest first, across versions. The page renders the latest run for this version; older runs are listed, never compared or merged."` Remove any `?history=`-style hover/focus test branch these rows had; keep the route.
- Figure 2 record cell (CP-17): `${w}W–${l}L–${ti}T` (en dashes, order W L T), cell width 76px (was 56px); the three "(win–tie–loss)" captions do not change.

### 2.3 Inbox (Inbox, InboxLight, InboxUpdate, InboxEval, InboxError)
- Update report (`reports.tsx:42`, CP-17 + CP-45): `Evaluated: {lift} {verdict} against no skill on {who}'s run; {iw}W–{il}L–{it}T against the incumbent.` and, with no receipt, `No receipt for {version} yet;` (was "Not evaluated yet;").
- Review report (`reports.tsx:57`, CP-06): `{n} of 6 checks passed on connect: …` and `… installed it from {who}'s connect before this proposal; none declined it.`
- InboxError (`InboxScreen.tsx:67`, CP-22/CP-36): body `"The team repo did not answer, so what is here may be stale. Check your network and your git access to the repository, then try again."`; secondary button `"Copy error"` (was "Open settings"); error line = the fixture's `ONBOARD_FETCH_ERROR` string (the mock's `fatal` at `mock/index.ts:10` becomes that value; decode `&#39;` for rendering as the other fixture strings do).

### 2.4 Marketplace (MarketplaceSkills, MarketplaceCategory, MarketplacePerson, MarketplaceProjectNotInstalled, MarketplaceProjectInstall, MarketplaceError)
- Top rated page subtitle (CP-10): `${shown} of ${CATALOG_N} skills · by installs, from people files`; category page subtitle: `${shown} of ${n} skill(s) · category from SKILL.md frontmatter · by installs`.
- Person page buckets (CP-12): within each bucket, skills sort by installs descending (`derive.ts`, the bucket builder).
- Filters popover slider ratio (TJ-13): `Math.min(1, installs_min / TEAM_N)` (pixel-neutral today).
- Project rail status when not installed (CP-03, D17): `"Placed by install project, inside a checkout of this repo"` (`market-components.tsx:52`; also the states-sheet specimen if the app has one). Project install dialog body (`MarketplaceScreen.tsx:29`): `Adds the project's {n} skills to your people file and places them into this repo's .claude/skills. Run it inside a checkout of {remote} — from anywhere else it exits and copies nothing.`
- MarketplaceError: unchanged copy; only the ErrorLine wrap rule (§1) applies.

### 2.5 Share (Share, ShareLight, ShareInvite, ShareEmpty, ShareError)
- Find members field (CP-18): no filter button (the product's only filter popover filters skills).
- ShareError header keeps the `Invite` action (CP-18).
- ShareEmpty body (CP-05): `"Invite teammates by their GitHub login. GitHub emails each one; the join block runs the wizard, which accepts the pending invitation with gh signed in and otherwise asks them to accept it in the browser."`; its terminal hint and the invite dialog's command placeholder: `invite <github-login>...` (variadic, CP-06).
- Invite dialog caption under "Send them this" (CP-05): the fixture's `JOIN_BLOCK_NOTE` verbatim.

### 2.6 Settings (SettingsTeams, SettingsUpdates, SettingsSharing, SettingsAdvanced, SettingsLeave, SettingsError)
- Teams ▸ Leave row (`SettingsContent.tsx:38`, CP-S6): `"Removes its placed skills, the clone and this entry here, and the session-start hook when this was the last team. You stay a member; run setup again to come back."`
- Leave dialog bullets (`SettingsDialogs.tsx:17`, CP-S6), five, in this order: (1) `Its placed skills leave ~/.claude/skills and the project checkouts on this machine ({g} global, {p} in checkouts) — a copy you edited by hand is moved to quarantine instead of deleted, and a folder that is also a skill's authoring source is left where it is`; (2) `The clone at {clone} and this team's entry in config.json — a clone holding uncommitted or unpushed work is moved to quarantine instead`; (3) `Its connected skill records and any pending operations on this machine`; (4) `This is your last team here, so the session-start hook is removed from ~/.claude/settings.json; if that file cannot be written the leave still finishes and says so`; (5) `Your people file in the team repo stays: you remain a member (an admin archives that with team remove {handle}), and setup brings this machine back`.
- Updates (`SettingsContent.tsx:57`, CP-32): Release notice desc `"One line after a command when a newer release is advertised or observed, at most once a day per release. Silenced by the CI, NO_UPDATE_NOTIFIER or TERUM_SKILLS_NO_UPDATE_NOTIFIER environment variables, not from here."`; Release probe desc `"Reads release tags from github.com/ryanliu-terum/terum-skills on an interactive sync, at most once a day, and whenever you run update — never from the session hook or a prune, and only while a team on this machine lives on GitHub. It runs no package manager and makes no registry request; a copy launched with npx also reads that cache's @latest entry, which can be the newer of the two."`
- Advanced ▸ Local state (`SettingsContent.tsx:70`, CP-S2): `"~/.terum/skills · config, team clones, cache, quarantine, run stamps, eval runs. Nothing in it is team truth. The clones, cache and run stamps are disposable — setup and team join rebuild them. config.json is not: delete it and every skill Terum placed goes invisible to the tool (no ledger entry, so sync neither refreshes nor adopts those folders and install refuses their targets until you re-install each one with --force), every tool approval is asked again, every connected skill's baseline is lost, and your handle, email and display name are re-asked."`
- Sharing (`SettingsContent.tsx:66-67`, CP-06): hint `npx -y terum-skills@latest connect ~/.claude/skills/<first unshared>` (prefix stays "Share stands for"); Frontmatter row desc `"connect adds license, id and author to your SKILL.md, after showing the three lines and asking."`
- SettingsError (`mock/index.ts:11`, CP-S5/D13): the error line is `Invalid ~/.terum/skills/config.json: Expected property name or '}' in JSON at position 412 (line 14 column 3)` (the mock stores it already abbreviated; the real adapter gets there through `abbreviateHome`).

### 2.7 Onboarding (OnboardingBoot, OnboardingError, OnboardingManage, OnboardingShare, OnboardingTeam, OnboardingDone)
- Boot rows (`mock/onboarding.ts:7`, D11): success = `[done, "Team {key} found on this machine", "@{handle}"]`, `[done, "Fetched {TEAM_REPO}", "main"]`, `[done, "Nothing new to place", "the join placed the Global set"]`, `[current, "Recording the sync", "run/terum.stamp"]`, `[pending, "Approve updated tools for <skill>? · asked only when a grant changed upstream", ""]`; progress `placed=3, total=BOOT_STEPS`. Failed = `[done, "Team … found …", "@…"]`, `[failed, "Couldn't fetch {TEAM_REPO}", "not reached"]`, `[pending, "Nothing new to place", ""]`, `[pending, "Recording the sync", ""]`; progress `placed=1, total=BOOT_STEPS`. `OnboardingScreen.tsx:68` reads `d.BOOT_STEPS`. The real-adapter fallback rows at `:79/:83` are out of scope (shell hygiene, design walk D9/D10); only make them compile.
- Basics ▸ Manage hint: `install <ref>`; Basics ▸ Share hint: `connect` (both from the fixture's `BASICS_HINT`, so verify they render from the fixture and nothing hard-codes `share`).
- Team step caption under "Send them this" (`OnboardingScreen.tsx:72`): the fixture's `JOIN_BLOCK_NOTE`.
- Done card (`OnboardingDone.tsx:9`, CP-O2): append `" The Claude Code session-start hook is set up by `setup` in the terminal; Settings ▸ Sync shows this machine's answer."` to the ready paragraph (render the backticked `setup` as the board does: the board prints it as plain text with backticks).

## 3. Tests
- Update every test that pins an old string (`mock.test.ts`'s strict `toEqual`s, `library-skill.test.tsx`, `inbox.test.tsx`, `settings.test.tsx`, `share.test.tsx`, `onboarding` tests, `Analytics` tests) to the new strings; declare each in `testsModified` with the board row it follows. Never weaken an assertion to pass; change it to the new truth.
- Add: `abbreviateHome` unit tests (§1); a history-rail test asserting only the first row renders a figure/strip; an Analytics test asserting no sparkline/arrow renders and both notes do.

## 4. Acceptance (your gates; report real counts)
`npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` in `desktop/` (Node 25 here; the flag stops the built-in localStorage shadowing jsdom's). Baseline before your change: typecheck 0, lint 0, 37 files / 492 tests; expect typecheck and lint at 0 and every test green with the new counts. Do not run Playwright, git, npm install or anything with network. Verify each write by reading the file back. Ambiguity → the conservative reading (the board's exact string) and an `openQuestions` entry.

## 5. Out of scope (do not touch)
`GAPS.md`, `FIDELITY.md`, `AGENTS.md`, `README.md`, `e2e/**`, `tools/**`, `design.json`, `tokens.css`, `src-tauri/**`, the CLI under `../src`, any real-adapter read model (the ten `gap()`s stay), the four `COUNTS` literals (S7af's), the BootError fallback rows, the Share→Connect tab label (Share stays the product noun).

=================== THE CANVAS PATCH (the source of every new string): .planning/codex-runs/design-strings/patch_ak.py ===================
"""AK · design-side strings (Teddy's 2026-09-08 design-strings decision walk, applied by the M7 launch overseer on Ryan's Mac, 2026-09-08).

Closes, as one patch: D14's 28 mechanical wording rows (CP-01, CP-04, CP-05, CP-06, CP-O4, RM-43, CP-08, CP-10, CP-12, CP-27, CP-34,
CP-44, CP-46, CP-42, CP-17, CP-45, EV-20, EV-21, CP-18, CP-22, CP-36, TJ-13, TJ-O2, CP-32, CP-S2, CP-S6, CP-O2, RM-16, RM-14),
CP-19's three refused commands, D11 (CP-O1 boot follows a join that already asked), D13 (CP-S5 Settings error is the CLI's real
message with a tilde) and D17 (CP-03's three honest strings). Every replacement names an anchor that must occur exactly once (or
`count` times) in the live build.py, so a stale anchor aborts before anything is written. Values verified against the costing §3.2
and the walk; where a row left Teddy a choice, the walk's ledger value is taken and the alternative is named in a comment.

Deliberately NOT applied here (recorded for the PR body): CP-08's two inventory JSON files are not on this machine; CP-10 (d)'s
generic disclosure gate; CP-12's second (person-bucket) gate, refuted as vacuous; CP-46's version VALUE change and per-detail ids
(D14 locks "identical output": the hoist and the gate only); RM-43 (6) neutral command form (BRIEF.md:32 / CP-33 keep npx);
CP-O1's Share→Connect tab relabel (the product noun Share is Teddy's, GAPS.md:11); TJ-O2 (3) Settings ▸ Teams Join gate (a board
drawing, not a string); CP-S5's second wrap specimen on the states sheet; D9/D10's eleven new boards.
Run: python3 .patches/patch_ak.py   (then: python3 build.py; node render-mac.mjs; npm run export in desktop/)."""
import pathlib
import re

BUILD = pathlib.Path(__file__).resolve().parent.parent / "build.py"


class Patch:
    def __init__(self, name: str):
        self.name = name
        self.src = BUILD.read_text(encoding="utf-8")
        self.n = 0

    def rep(self, old: str, new: str, count: int = 1) -> None:
        found = self.src.count(old)
        if found != count:
            raise SystemExit(f"[{self.name}] anchor occurs {found}x, expected {count}:\n{old[:240]}")
        self.src = self.src.replace(old, new)
        self.n += 1

    def write(self) -> None:
        BUILD.write_text(self.src, encoding="utf-8")
        print(f"patch applied: {self.name} ({self.n} replacements)")


p = Patch("AK · design-side strings")

# ---- CP-01 · SkillDetailRemove: the per-skill verb, no scope promise, the decline suppression named ----------------------------
p.rep('''    d = dialog(t, "Remove deploy-check from Global?",
               "Its files leave ~/.claude/skills on this machine and your people file stops listing it. The team copy stays, and you can install it again any time.",
               primary="Remove", primary_kind="danger", command=cli("uninstall deploy-check"))''',
      '''    d = dialog(t, "Remove deploy-check?",
               "Its files leave ~/.claude/skills on this machine and your people file stops listing it. Because the team endorses it, your people file also records that you declined it, so sync stops offering it back; installing it again clears that.",
               primary="Remove", primary_kind="danger", command=cli(f"uninstall-skill {skill_ref(DETAIL)}"))''')

# ---- CP-04 · SkillDetailQuality: the verb is connect; validate's six callers ---------------------------------------------------
p.rep("Hygiene checks · passed on share, 12 days ago · free, no model calls", "Hygiene checks · passed on connect, 12 days ago · free, no model calls")
p.rep('prefix="Runs on share, publish and in CI"', 'prefix="Runs on connect, publish, sync and in CI"')

# ---- CP-05 + TJ-O2 (1) · the join-block captions say what the CLI's trailing paragraph says (invite.ts slackBlock) -------------
p.rep('INVITE_TIP = "GitHub emails the invitation; the block runs the joiner&#39;s wizard"',
      'INVITE_TIP = "GitHub emails the invitation; the block runs the joiner&#39;s wizard"\n'
      'JOIN_BLOCK_NOTE = ("GitHub emails the invitation. The block runs the joiner&#39;s wizard: with gh signed in it accepts the pending invitation, "\n'
      '                   "otherwise it asks them to accept it in the browser, and git must have access to this repository.")   # invite.ts:54, spec §6 :339')
p.rep('''small(t, "GitHub emails the invitation; this runs the joiner&#39;s wizard, which accepts it and offers the Global set.")''',
      '''small(t, JOIN_BLOCK_NOTE)''')
p.rep('''f"{INVITE_TIP}, which accepts the invitation and offers the Global set."''', '''JOIN_BLOCK_NOTE''')
p.rep('''"Invite teammates by their GitHub login. GitHub emails each one, and the join block runs the wizard that offers them the team&#39;s Global set.",''',
      '''"Invite teammates by their GitHub login. GitHub emails each one; the join block runs the wizard, which accepts the pending invitation with gh signed in and otherwise asks them to accept it in the browser.",''')
p.rep('''"""The Slack-ready block `invite` prints: the joiner's wizard, which accepts the invitation and offers the Global set (build spec §6.1)."""''',
      '''"""The Slack-ready block `invite` prints: the joiner's wizard, which accepts the pending invitation with gh signed in or asks them to accept it in the browser (invite.ts slackBlock; build spec §6.1)."""''')

# ---- CP-06 + CP-O4 + RM-43 + CP-19 · placeholders, the dead `share` verb, the variadic invite operand ---------------------------
p.rep('terminal_hint(t, cli("install &lt;skill&gt;"), prefix="From the terminal")', 'terminal_hint(t, cli("install &lt;ref&gt;"), prefix="From the terminal")')
p.rep('''BASICS_HINT = {"Manage": cli("install &lt;skill&gt;"), "Eval": cli(f'eval {SKILLS[0]["name"]} --commit'), "Share": cli("share"),''',
      '''BASICS_HINT = {"Manage": cli("install &lt;ref&gt;"), "Eval": cli(f'eval {SKILLS[0]["name"]} --commit'), "Share": cli("connect"),''')
p.rep('cli(f"share ~/.claude/skills/{LOCAL_UNSHARED[0]}")', 'cli(f"connect ~/.claude/skills/{LOCAL_UNSHARED[0]}")')
p.rep('"share adds license, id and author to your SKILL.md, after showing the three lines and asking."',
      '"connect adds license, id and author to your SKILL.md, after showing the three lines and asking."')
p.rep("of 6 checks passed on share: frontmatter", "of 6 checks passed on connect: frontmatter")
p.rep("installed it from {who}\\'s share before this proposal", "installed it from {who}\\'s connect before this proposal")
p.rep('cli("invite &lt;github-login&gt;")', 'cli("invite &lt;github-login&gt;...")', count=2)
p.rep("invites, a first share, the session hook", "invites, a first connect, the session hook")
p.rep('''    """The one spelling of every printed command (phase-1 spec: `npx -y terum-skills@latest …`, -y so a first-run machine never stalls on npx's prompt)."""''',
      '''    """The boards' one spelling of every printed command: the npx form (`npx -y terum-skills@latest …`, -y so a first-run machine never stalls on npx's
    prompt). The CLI itself prints two forms (bare `terum-skills` when the PATH bin is a global install, npx otherwise; src/lib/invocation.ts); the app
    has no launch evidence, so every board keeps the npx form (BRIEF.md:32, CP-33)."""''')

# ---- CP-10 · every page that prints a universe count discloses the sample it renders -------------------------------------------
p.rep('subtitle: str | None = "30 skills"', 'subtitle: str | None = "15 of 30 skills"')
p.rep('subtitle=f"{CATALOG_N} skills · by installs, from people files"', 'subtitle=f"{len(CATALOG)} of {CATALOG_N} skills · by installs, from people files"')
p.rep('''subtitle=f"{plural(n, 'skill')} · category from SKILL.md frontmatter · by installs"''',
      '''subtitle=f"{len(category_skills(key))} of {plural(n, 'skill')} · category from SKILL.md frontmatter · by installs"''')

# ---- CP-12 · a person's buckets sort by installs; the categories index gate (edit order: bucket first) --------------------------
p.rep('''    return [(name, [s for s in mine if LIST_OF[s["name"]][0] == name]) for name in ["Global"] + [q["name"] for q in PROJECTS] if any(LIST_OF[s["name"]][0] == name for s in mine)]''',
      '''    return [(name, sorted((s for s in mine if LIST_OF[s["name"]][0] == name), key=lambda s: -installs_of(s))) for name in ["Global"] + [q["name"] for q in PROJECTS] if any(LIST_OF[s["name"]][0] == name for s in mine)]''')
p.rep('''        problems.append("top rated is not sorted by installs")''',
      '''        problems.append("top rated is not sorted by installs")
    cat_counts = [c[2] for c in CATEGORIES]
    if cat_counts != sorted(cat_counts, reverse=True):
        problems.append('the categories index is not sorted by count, but its label says "Most skills"')''')

# ---- CP-27 · one skill, one category; the inbox cross-check gate ---------------------------------------------------------------
p.rep('dict(kind="share", name="secret-scan", origin="terum", category="infra", days=1,', 'dict(kind="share", name="secret-scan", origin="terum", category="security", days=1,')
p.rep('''    if [it["days"] for it in INBOX] != sorted(it["days"] for it in INBOX):
        problems.append("items are not newest first")''',
      '''    if [it["days"] for it in INBOX] != sorted(it["days"] for it in INBOX):
        problems.append("items are not newest first")
    for it in INBOX:   # CP-27: an item that names a catalog skill carries that skill's category, never a second one
        s = SK.get(it["name"]) or next((x for x in MARKET_EXTRA if x["name"] == it["name"]), None)
        if s and it.get("category") and it["category"] != s["category"]:
            problems.append(f'{it["title"]}: category {it["category"]!r} disagrees with the catalog ({s["category"]!r})')''')

# ---- CP-34 + CP-44 · no ref to a team this machine never joined; skill_ref reads the configured remote -------------------------
p.rep('used_by=["AP", "RL", "TZ"], users=[], repo="mrf/team-skills", path="skills/migration-guard"', 'used_by=["AP", "RL", "TZ"], users=[], path="skills/migration-guard"')
p.rep('''    """The self-locating three-part ref <org>/<repo>/<skill>: it carries its own repository, so a pasted command works on a machine with no local config."""
    repo = s.get("repo") or f'{s["origin"]}/team-skills\'''',
      '''    """The self-locating three-part ref <owner>/<repo>/<skill>. The repository is READ from the team's configured remote (config.teams[<team>].remote →
    githubOwnerRepo; schema.ts:72, remote.ts:192), never built from a team, project or list name: `team create` ASKS for it and merely suggests
    `<team>-shared-skills`, and a joiner's local team name IS the repository basename (phase-1-build.md:333). `project` is a LIST key, not a GitHub owner."""
    repo = s.get("repo") or TEAM_REPO''')

# ---- CP-46 · the displayed version and the tree hash are named constants (values unchanged: D14 locks identical output) --------
p.rep('''DETAIL = dict(
    SKILLS[0],''',
      '''DEPLOY_CHECK_V = "5f0e12ab9c3d"                                       # the DISPLAYED version: the first 12 of the tree hash (eval-engine.md:491)
DEPLOY_CHECK_V40 = "5f0e12ab9c3d4e7ab1f28a6d0c3e9b47d2f1a8c0"           # git rev-parse HEAD:skills/deploy-check (readme.ts:119); unrelated to metadata.id
# CP-46: the sample version happens to be a slice of SKILL_MD_ID; the costing's fix re-mints it as 7ad3f1c05e92. D14 (2026-09-08) locked the
# hoist with identical output, so the value stays until a design session re-renders every board that prints it.

DETAIL = dict(
    SKILLS[0],''')
p.rep('version="5f0e12ab9c3d", version_full="5f0e12ab9c3d4e7ab1f28a6d0c3e9b47d2f1a8c0"', 'version=DEPLOY_CHECK_V, version_full=DEPLOY_CHECK_V40')
p.rep('dict(when="8 days ago", runner="ajay", version="5f0e12ab9c3d", wlt=(11, 3, 4), rows=None)', 'dict(when="8 days ago", runner="ajay", version=DEPLOY_CHECK_V, wlt=(11, 3, 4), rows=None)')
p.rep('("RL", "<b>ryan</b> pushed 5f0e12ab9c3d · checklist.md, scripts/verify.sh", "12 days ago")', '("RL", f"<b>ryan</b> pushed {DEPLOY_CHECK_V} · checklist.md, scripts/verify.sh", "12 days ago")')
p.rep('         version="5f0e12ab9c3d", sessions=14, on_target=9,', '         version=DEPLOY_CHECK_V, sessions=14, on_target=9,')
p.rep('fact="ajay · 18 rounds · 11W 3L 4T · v 5f0e12ab9c3d"', 'fact=f"ajay · 18 rounds · 11W 3L 4T · v {DEPLOY_CHECK_V}"')
p.rep('dict(DETAIL, kind="author", days=9, actor=None, author=AJAY, scope="Global", version="5f0e12ab9c3d", installs_n=12,',
      'dict(DETAIL, kind="author", days=9, actor=None, author=AJAY, scope="Global", version=DEPLOY_CHECK_V, installs_n=12,')

# ---- CP-42 · where Governance went -----------------------------------------------------------------------------------------------
p.rep('SETTINGS_NAV = [', "# 'Sharing ▸ Governance' from the source sketch is this: Team policy, read-only, changed by PR (settings_teams' policy card).\nSETTINGS_NAV = [")

# ---- CP-17 · the record cell spells itself in the CLI's order (W L T) ------------------------------------------------------------
p.rep('        record = f"{w}–{ti}–{l}"', '        record = f"{w}W–{l}L–{ti}T"')
p.rep('''f'<span style="width: 56px; text-align: right; font-family: {MONO}; font-size: 12px; color: {t["text1"]}; font-variant-numeric: tabular-nums; flex-shrink: 0;">{record}</span>\'''',
      '''f'<span style="width: 76px; text-align: right; font-family: {MONO}; font-size: 12px; color: {t["text1"]}; font-variant-numeric: tabular-nums; flex-shrink: 0;">{record}</span>\'''')
p.rep("{iw}–{it_}–{il} against the installed version.')", "{iw}W–{il}L–{it_}T against the incumbent.')")

# ---- CP-45 · one wording per fact: "Not evaluated" (skill), "No receipt for <version> yet" (version), "Never" (date slot) ----------
p.rep('empty = centered_state(t, "chart", "No receipt yet",', 'empty = centered_state(t, "chart", "Not evaluated",')
p.rep('evaluated = "Never · no receipt" if rc is None else', 'evaluated = "Never" if rc is None else')
p.rep('''ev = rp_bold(t, "Not evaluated yet;") + (''', '''ev = rp_bold(t, f'No receipt for {it["version"]} yet;') + (''')

# ---- EV-20 · the history rail shows one receipt's numbers; older rows are listed, never compared (eval-engine §12) ---------------
p.rep('''def history_row(t, h, *, state="default") -> str:
    """state: default | hover | selected | focus (selected + focus compose: bg4 plus the ring). The selected fill is stronger, so the
    quiet 12px text (runner · version, and a greyed partial number) steps from text3 up to text2 — the sidebar's rule for counts."""
    r = receipt_of(h)
    selected = state in ("selected", "focus")
    bg = t["bg4"] if selected else (t["bg3"] if state == "hover" else "transparent")
    ring = f" box-shadow: 0 0 0 2px {t['accent']};" if state == "focus" else ""
    quiet = t["text2"] if selected else t["text3"]
    color = figure_color(t, r)
    if color == t["text3"]:
        color = quiet
    fraction = f'<span style="font-weight: 400; margin-left: 4px;">{r["partial"][0]}/{r["partial"][1]}</span>' if r.get("partial") else ""
    return (f'<div style="display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border-radius: 6px; background: {bg};{ring}">'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">'
            f'<span style="font-size: 13px; font-weight: 500; color: {t["text1"]};">{h["when"]}</span>'
            f'<span style="font-size: 12px; font-weight: 510; color: {color}; font-variant-numeric: tabular-nums;">{lift_number(r["lift"])}{fraction}</span></div>'
            f'<span style="font-size: 12px; color: {quiet}; font-family: {MONO}; white-space: nowrap;">{h["runner"]} · {h["version"]}</span>'
            f'{row_strip(t, h["rows"])}</div>')''',
      '''def history_row(t, h, *, state="default") -> str:
    """state: default | showing. Rows are not interactive (EV-20, eval-engine §12: the page never puts two receipts' numbers side by side):
    only the row whose receipt the page renders ("showing", the newest) carries its figure, partial fraction and strip; every other row
    keeps when and runner · version. The showing fill is stronger, so its quiet 12px text steps from text3 up to text2 — the sidebar's rule."""
    r = receipt_of(h)
    showing = state == "showing"
    bg = t["bg4"] if showing else "transparent"
    quiet = t["text2"] if showing else t["text3"]
    color = figure_color(t, r)
    if color == t["text3"]:
        color = quiet
    fraction = f'<span style="font-weight: 400; margin-left: 4px;">{r["partial"][0]}/{r["partial"][1]}</span>' if r.get("partial") else ""
    figure = f'<span style="font-size: 12px; font-weight: 510; color: {color}; font-variant-numeric: tabular-nums;">{lift_number(r["lift"])}{fraction}</span>' if showing else ""
    strip = row_strip(t, h["rows"]) if showing else ""
    return (f'<div style="display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border-radius: 6px; background: {bg};">'
            f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">'
            f'<span style="font-size: 13px; font-weight: 500; color: {t["text1"]};">{h["when"]}</span>{figure}</div>'
            f'<span style="font-size: 12px; color: {quiet}; font-family: {MONO}; white-space: nowrap;">{h["runner"]} · {h["version"]}</span>'
            f'{strip}</div>')''')
p.rep('rows = "".join(history_row(t, h, state="selected" if i == 0 else "default") for i, h in enumerate(s["history"]))',
      'rows = "".join(history_row(t, h, state="showing" if i == 0 else "default") for i, h in enumerate(s["history"]))')
p.rep('"One row per committed run, newest first. The page renders the latest run for this version; older runs are kept, never merged."',
      '"One row per committed run, newest first, across versions. The page renders the latest run for this version; older runs are listed, never compared or merged."')
p.rep('''hist = [cell(f"history row · {st}", f'<div style="width: 210px;">{history_row(t, DETAIL["history"][1], state=st)}</div>') for st in ("default", "hover", "selected", "focus")]
    hist.append(cell("history row · partial run · selected", f'<div style="width: 210px;">{history_row(t, DETAIL_PARTIAL["history"][0], state="selected")}</div>'))''',
      '''hist = [cell(f"history row · {st}", f'<div style="width: 210px;">{history_row(t, DETAIL["history"][1 if st == "default" else 0], state=st)}</div>') for st in ("default", "showing")]
    hist.append(cell("history row · partial run · showing", f'<div style="width: 210px;">{history_row(t, DETAIL_PARTIAL["history"][0], state="showing")}</div>'))''')

# ---- EV-21 · per-round decided_by specimens; the counted-attribution prose goes (no receipt field carries it) ---------------------
p.rep('''        cell("History strip cell · hovered", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by judge, both orderings"), span=2),''',
      '''        cell("History strip cell · hovered · decided by checks (the common case)", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by checks"), span=2),
        cell("… · decided by judge", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by judge, both orderings"), span=2),
        cell("… · judge-split", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by judge-split, both orderings"), span=2),
        cell("… · opponent-run-failed", with_tip(t, row_strip(t, s["history"][0]["rows"], hovered=strip_i), f"{case} · rep {rep} · {word} · decided by opponent-run-failed"), span=2),''')
p.rep('(net lift +0.44, p = {P_BASE}; 12 rounds settled by checks, 2 by judge). Against the incumbent ', '(net lift +0.44, p = {P_BASE}). Against the incumbent ')
p.rep('''f"baseline the candidate won 5, lost 0, and tied 2 of 7 scored rounds (net lift +0.71, p = {P_PARTIAL}; 4 rounds settled by checks, "
                                           "1 by judge) (Fig. 2). no-rollback carries both unscored rounds (Table 1).",''',
      '''f"baseline the candidate won 5, lost 0, and tied 2 of 7 scored rounds (net lift +0.71, p = {P_PARTIAL}) (Fig. 2). "
                                           "no-rollback carries both unscored rounds (Table 1).",''')

# ---- CP-18 · ShareError keeps Invite; Find members has no facet control ------------------------------------------------------------
p.rep('return shell(t, view_header(t, "Members", None, ico="users", action=None)', 'return shell(t, view_header(t, "Members", None, ico="users", action=("Invite", "user-plus"))')
p.rep('''                  placeholder="Search skills, people and projects", popover: str = "") -> str:''',
      '''                  placeholder="Search skills, people and projects", popover: str = "", filter: bool = True) -> str:''')
p.rep('''            f'{filter_button(t, active=active, state="pressed" if popover else "default")}{popover}</div>')''',
      '''            f'{filter_button(t, active=active, state="pressed" if popover else "default") if filter else ""}{popover}</div>')''')
p.rep('{market_search(t, width=None, placeholder="Find members")}', '{market_search(t, width=None, placeholder="Find members", filter=False)}')
p.rep("Invite, Find members with the filter control, and the roster with the invitation last.", "Invite, Find members (no facets: the product's only filter popover filters skills), and the roster with the invitation last.")

# ---- CP-22 + CP-36 · the two error boards name the failure that is drawn and the remedy that exists --------------------------------
p.rep('''                          "The team repo did not answer, so what is here may be stale. Check your connection or the token in Settings, then try again.",
                          "Try again", "Open settings",
                          error_line(t, "fatal: unable to access 'https://github.com/terum/team-skills.git/': Could not resolve host: github.com"))''',
      '''                          "The team repo did not answer, so what is here may be stale. Check your network and your git access to the repository, then try again.",
                          "Try again", "Copy error",
                          error_line(t, ONBOARD_FETCH_ERROR))''')
p.rep('''                                  "terum-skills could not open the skills folder. Check the path in Settings, then try again.",
                                  "Try again", "Open settings",
                                  error_line(t, "ENOENT: no such file or directory, scandir '~/.terum/skills'")),''',
      '''                                  "terum-skills could not read ~/.terum/skills. Check the folder still exists and is readable, then try again.",
                                  "Try again", "Show in Finder",
                                  error_line(t, "EACCES: permission denied, scandir '~/.terum/skills'")),''')

# ---- TJ-13 · the count is installs over every people file, archived members included: tense, not noun -----------------------------
p.rep('''detail_row(t, "Installs", f'{s["installs_n"]} teammate{"" if s["installs_n"] == 1 else "s"}'),''', '''detail_row(t, "Installs", str(s["installs_n"])),''')
p.rep('''label=f'{n} teammate{"" if n == 1 else "s"} use{"s" if n == 1 else ""} this\'''', '''label=f'{n} teammate{"" if n == 1 else "s"} ha{"s" if n == 1 else "ve"} installed this\'''')
p.rep('>Used by {s["installs_n"]} teammates</span>', '>Installed by {s["installs_n"]} teammates</span>')
p.rep('''cell("“12 teammates use this” · hovered", f'<div style="width: 300px;">{facepile(t, s["used_by"], 12, label="12 teammates use this", hovered=True''',
      '''cell("“12 teammates have installed this” · hovered", f'<div style="width: 300px;">{facepile(t, s["used_by"], 12, label="12 teammates have installed this", hovered=True''')
p.rep('''label=f'{DETAIL["installs_n"]} teammates use this')''', '''label=f'{DETAIL["installs_n"]} teammates have installed this')''')
p.rep("TEAM_N = 12                 # teammates (install counts come from their people files, so none exceeds 12)",
      "TEAM_N = 12                 # active teammates. Install counts come from EVERY people file, archived members included (readme.ts:35), so a count may exceed this")
p.rep('''f'{f["installs_min"]} teammates', f["installs_min"] / TEAM_N))''', '''f'{f["installs_min"]} teammates', min(1, f["installs_min"] / TEAM_N)))''')

# ---- TJ-O2 (2) · the joiner's invitation gate, in the CLI's words, on the states sheet -----------------------------------------------
p.rep('''              cell("logins · rejected (invite&#39;s line)", box(text_field(t, INVITEE, width=240, error=f"Could not invite @{INVITEE} (GitHub status 403). GitHub caps invitations at 50 per repository per day."), 240))]''',
      '''              cell("logins · rejected (invite&#39;s line)", box(text_field(t, INVITEE, width=240, error=f"Could not invite @{INVITEE} (GitHub status 403). GitHub caps invitations at 50 per repository per day."), 240)),
              cell("join gate · the browser hand-off (team.ts:492)", box(ob_error_line(t, f"Accept the invitation at https://github.com/{TEAM_REPO}/invitations before continuing."), ONBOARD_W), span=3),
              cell("join gate · the blocking confirm (team.ts:493)", box(ob_error_line(t, "Continue after accepting the invitation? (y/N) · on no: Invitation acceptance was declined."), ONBOARD_W), span=3)]''')

# ---- CP-32 · the release-probe disclosure, corrected on timing and sources ---------------------------------------------------------
p.rep('''setting_row(t, "Release notice", "One line after a command when a newer release is advertised. Silenced by the CI or NO_UPDATE_NOTIFIER environment variables, not from here.", value_text(t, "On", quiet=True)),''',
      '''setting_row(t, "Release notice", "One line after a command when a newer release is advertised or observed, at most once a day per release. Silenced by the CI, NO_UPDATE_NOTIFIER or TERUM_SKILLS_NO_UPDATE_NOTIFIER environment variables, not from here.", value_text(t, "On", quiet=True)),''')
p.rep('''setting_row(t, "Release probe", "Reads release tags from github.com/ryanliu-terum/terum-skills at sync. Runs no package manager and reads no registry.", value_text(t, "GitHub tags", quiet=True)),''',
      '''setting_row(t, "Release probe", "Reads release tags from github.com/ryanliu-terum/terum-skills on an interactive sync, at most once a day, and whenever you run update — never from the session hook or a prune, and only while a team on this machine lives on GitHub. It runs no package manager and makes no registry request; a copy launched with npx also reads that cache&#39;s @latest entry, which can be the newer of the two.", value_text(t, "GitHub tags", quiet=True)),''')

# ---- CP-S2 · config.json is the ledger, not disposable ------------------------------------------------------------------------------
p.rep('''"~/.terum/skills · config, team clones, cache, quarantine, run stamps, eval runs. Safe to delete: nothing in it is team truth, and placed skills stay on disk."''',
      '''"~/.terum/skills · config, team clones, cache, quarantine, run stamps, eval runs. Nothing in it is team truth. The clones, cache and run stamps are disposable — setup and team join rebuild them. config.json is not: delete it and every skill Terum placed goes invisible to the tool (no ledger entry, so sync neither refreshes nor adopts those folders and install refuses their targets until you re-install each one with --force), every tool approval is asked again, every connected skill&#39;s baseline is lost, and your handle, email and display name are re-asked."''')

# ---- CP-S6 · the Leave dialog lists what team leave does -------------------------------------------------------------------------------
p.rep('''    extra = bullet_list(t, [f'Its placed skills leave ~/.claude/skills and the project checkouts on this machine ({COUNTS["Global"]} global, {PLACEMENTS_N - int(COUNTS["Global"])} in checkouts)',
                            f'The clone at {q["clone"]} and this team&#39;s entry in config.json',
                            "Your people file in the team repo stays: you remain a member, and setup brings this machine back"])''',
      '''    extra = bullet_list(t, [f'Its placed skills leave ~/.claude/skills and the project checkouts on this machine ({COUNTS["Global"]} global, {PLACEMENTS_N - int(COUNTS["Global"])} in checkouts) — a copy you edited by hand is moved to quarantine instead of deleted, and a folder that is also a skill&#39;s authoring source is left where it is',
                            f'The clone at {q["clone"]} and this team&#39;s entry in config.json — a clone holding uncommitted or unpushed work is moved to quarantine instead',
                            "Its connected skill records and any pending operations on this machine",
                            "This is your last team here, so the session-start hook is removed from ~/.claude/settings.json; if that file cannot be written the leave still finishes and says so",
                            f'Your people file in the team repo stays: you remain a member (an admin archives that with team remove {ME["handle"]}), and setup brings this machine back'])''')
p.rep('"Removes its placed skills, the clone and this entry here. You stay a member; run setup again to come back."',
      '"Removes its placed skills, the clone and this entry here, and the session-start hook when this was the last team. You stay a member; run setup again to come back."')

# ---- CP-O2 · the Done card names the hook and where its answer shows -------------------------------------------------------------------
p.rep('''Sharing and the Marketplace are in the sidebar; evals live on each skill&#39;s page.")''',
      '''Sharing and the Marketplace are in the sidebar; evals live on each skill&#39;s page. The Claude Code session-start hook is set up by `setup` in the terminal; Settings ▸ Sync shows this machine&#39;s answer.")''')

# ---- RM-16 · the overview tiles carry no time series and name their populations ---------------------------------------------------------
p.rep('''    skills="30", skills_delta="+3 this month",''',
      '''    skills="30", skills_note="7 endorsed to Global",   # RM-16: no committed date on a skill (schema.ts:43-51); a fact from team.json's global[] instead (gated in check_onboarding)''')
p.rep('''    installs="148", installs_delta="+9 this week · 12 teammates · last 12 weeks", sparkline=[4, 6, 3, 8, 5, 9, 7, 11, 8, 12, 10, 9],''',
      '''    installs="148", installs_note="across every people file · 12 active teammates",   # RM-16: installed[].since is restamped by install and sync, so no honest series exists; both populations named''')
p.rep('''            stat_tile(t, "Skills", o["skills"], delta_line(t, "arrow-up-right", t["good"], o["skills_delta"])),''',
      '''            stat_tile(t, "Skills", o["skills"], small(t, o["skills_note"])),''')
p.rep('''            stat_tile(t, "Team installs", o["installs"],
                      delta_line(t, "arrow-up-right", t["good"], o["installs_delta"])
                      + sparkline(t, o["sparkline"]), grow=2),''',
      '''            stat_tile(t, "Team installs", o["installs"], small(t, o["installs_note"]), grow=2),''')

# ---- RM-14 · the card line is PROJECT membership: the sample key is `project` (values unchanged) --------------------------------------------
p.rep('origin="', 'project="', count=22)
p.rep('{s["origin"]} / {s["category"]}', '{s["project"]} / {s["category"]}')
p.rep('dim(s["origin"])', 'dim(s["project"])')
p.rep('CATALOG = [s for s in SKILLS if s["origin"] != "local"] + MARKET_EXTRA   # local skills are not shared, so the marketplace never lists them',
      'CATALOG = [s for s in SKILLS if s["project"] != "local"] + MARKET_EXTRA   # `project` is the team.json list the skill is endorsed on (or the machine-local "local", RM-14): local skills are not shared, so the marketplace never lists them')
p.rep('LOCAL_UNSHARED = [s["name"] for s in SKILLS if s["origin"] == "local"]', 'LOCAL_UNSHARED = [s["name"] for s in SKILLS if s["project"] == "local"]')
p.rep('''f'{SKILLS[0]["origin"]} / {SKILLS[0]["category"]} · skill\'''', '''f'{SKILLS[0]["project"]} / {SKILLS[0]["category"]} · skill\'''')

# ---- CP-O1 (D11) · the boot follows a join that already asked: status rows, no placement counter, the one interruption drawn -------------
p.rep("ONBOARD_PLACED = 4                    # placements written so far on the boot board, of len(GLOBAL_SET)",
      "BOOT_STEPS = 4                        # the boot board's status rows: found, fetched, nothing new to place, recording (the join already asked; CP-O1 shape a, D11)")
p.rep('''    if not 0 < ONBOARD_PLACED < len(GLOBAL_SET):
        problems.append("the boot board places the whole Global set, or none of it")
''',
      '''    if not LIBRARY_OVERVIEW["skills_note"].startswith(f"{len(GLOBAL_SET)} "):
        problems.append("the Library's Skills tile note disagrees with the Global set (RM-16)")
''')
p.rep('''def boot_rows(t, *, failed=False) -> list:
    n = len(GLOBAL_SET)
    if failed:
        return [("done", f'Team {TEAMS[0]["key"]} found on this machine', f'@{ME["handle"]}'), ("failed", f"Couldn&#39;t fetch {TEAM_REPO}", "not reached"),
                ("pending", "Placing the team&#39;s Global set into ~/.claude/skills", f"0 of {n}"), ("pending", "Recording the sync", "")]
    return [("done", f'Team {TEAMS[0]["key"]} found on this machine', f'@{ME["handle"]}'), ("done", f"Fetched {TEAM_REPO}", "main"),
            ("current", "Placing the team&#39;s Global set into ~/.claude/skills", f"{ONBOARD_PLACED} of {n}"), ("pending", "Recording the sync", "run/terum.stamp")]''',
      '''def boot_rows(t, *, failed=False) -> list:
    """Status rows for a boot that FOLLOWS a join which already asked (CP-O1 shape a, D11): nothing is placed unattended, so there is no
    placement counter. The one question sync can still ask (an upstream grant change, sync.ts:190) is drawn as a possible interruption."""
    if failed:
        return [("done", f'Team {TEAMS[0]["key"]} found on this machine', f'@{ME["handle"]}'), ("failed", f"Couldn&#39;t fetch {TEAM_REPO}", "not reached"),
                ("pending", "Nothing new to place", ""), ("pending", "Recording the sync", "")]
    return [("done", f'Team {TEAMS[0]["key"]} found on this machine', f'@{ME["handle"]}'), ("done", f"Fetched {TEAM_REPO}", "main"),
            ("done", "Nothing new to place", "the join placed the Global set"), ("current", "Recording the sync", "run/terum.stamp"),
            ("pending", "Approve updated tools for &lt;skill&gt;? · asked only when a grant changed upstream", "")]''')
p.rep("progress_card(t, boot_rows(t), placed=ONBOARD_PLACED, total=len(GLOBAL_SET)),", "progress_card(t, boot_rows(t), placed=3, total=BOOT_STEPS),")
p.rep("progress_card(t, boot_rows(t, failed=True), placed=0, total=len(GLOBAL_SET), failed=True)", "progress_card(t, boot_rows(t, failed=True), placed=1, total=BOOT_STEPS, failed=True)")
p.rep('''("current", "Placing the team&#39;s Global set into ~/.claude/skills", f"{ONBOARD_PLACED} of {len(GLOBAL_SET)}"),''',
      '''("done", "Nothing new to place", "the join placed the Global set"), ("pending", "Approve updated tools for &lt;skill&gt;? · asked only when a grant changed upstream", ""),''')
p.rep("progress_bar(t, ONBOARD_PLACED, len(GLOBAL_SET))", "progress_bar(t, 3, BOOT_STEPS)")
p.rep("progress_bar(t, 0, len(GLOBAL_SET), failed=True)", "progress_bar(t, 1, BOOT_STEPS, failed=True)")

# ---- CP-S5 (D13) · the Settings error is the CLI's real line, the home directory abbreviated under one app-wide rule; error lines wrap ---
p.rep('''error_line(t, "SyntaxError: Unexpected token } in JSON at position 412 · ~/.terum/skills/config.json")''',
      '''error_line(t, "Invalid ~/.terum/skills/config.json: Expected property name or &#39;}&#39; in JSON at position 412 (line 14 column 3)")''')   # config.ts:37-38, V8 >= 22.12; the tilde is the app's home-abbreviation rule (D13), applied to every CLI message the app renders
p.rep('''            f'font-family: {MONO}; font-size: 12px; color: {t["text3"]}; white-space: nowrap;">{text}</div>')''',
      '''            f'font-family: {MONO}; font-size: 12px; color: {t["text3"]}; max-width: 100%; overflow-wrap: anywhere; text-align: left; box-sizing: border-box;">{text}</div>')''')

# ---- CP-03 (D17) · the project-install copy says when and where the skills land -----------------------------------------------------------
p.rep('''    body = (f'Adds the project&#39;s {n} skills to your people file. They are placed into the repo&#39;s .claude/skills the next time you sync inside a checkout '
            f'of {q["remote"]}; nothing is copied until then.')''',
      '''    body = (f'Adds the project&#39;s {n} skills to your people file and places them into this repo&#39;s .claude/skills. Run it inside a checkout '
            f'of {q["remote"]} — from anywhere else it exits and copies nothing.')''')
p.rep('"Placed when you sync in the repo"', '"Placed by install project, inside a checkout of this repo"', count=2)

p.write()


=================== STANDING CONSTRAINTS ===================
- Work only under desktop/. Read the per-directory README/AGENTS files for every subtree you touch before your first edit there.
- Gates: from desktop/, run `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` and report REAL counts in the report (baseline: typecheck 0, lint 0, 37 files / 492 tests).
- No git (not even `git status`), no npm install, no network, no Playwright (`npx playwright …` will not launch here; say so, never fake a pixel result). node_modules and the generated fixture (design.json, tokens.css) are already in place and must not be edited.
- Never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md, package.json, design.json, tokens.css, e2e/**, tools/**, src-tauri/**.
- Never delete or weaken a test to make a suite pass; change an assertion only to the new board truth and declare it in testsModified. No eslint-disable without a same-line reason. No test-only branches in components.
- If the spec is ambiguous, record the question in openQuestions and implement the most conservative reading (the board's exact string). Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged. Verify each write by reading the file back.
- Your final message must be the JSON report the output schema demands: status complete only if every spec item was implemented and the gates ran.
