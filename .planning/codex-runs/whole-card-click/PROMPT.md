Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly; then read desktop/AGENTS.md (the app's loader, eight invariants) before your first edit under desktop/. Both are reproduced here verbatim so you have them even before you open them. The spec's line numbers were verified against origin/main at 279830d; where a number and the code disagree, the code wins: find the quoted code.

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

=================== THE SPEC ===================
# Spec — whole-card click target for SkillCard and PersonCard (desktop)

Repo: terum-skills (`skill-management-software`), branch `fix/whole-card-click` off `origin/main` at 279830d. Everything below lives under `desktop/`; paths are repo-relative. Line numbers refer to origin/main 279830d — where a number and the code disagree, the code wins: find the quoted code.

## Bug

The skill card (`desktop/src/components/domain/SkillCard.tsx`) opens the skill only from its title link (`.skill-card-ident>a`), while the whole card lights on hover (`.skill-card:hover` in `SkillCard.css`). The maintainer wants the whole card to open the skill. The Marketplace PersonCard (`desktop/src/screens/marketplace/market-components.tsx:35`) has the same defect: only the avatar link and the name link navigate, the card body does not. The design canvas draws card-level hover / focus / pressed states with the title as plain text.

## Fix — "stretched title link"

CSS-only, one accessible link per card, valid HTML (no nested interactive content, no `<a>` around buttons), pixel-neutral on the 88 locked fidelity boards. Do not add `z-index` anywhere. Do not add `role`, `tabindex`, or an `onClick` to the `<article>`.

### 1. `desktop/src/components/domain/SkillCard.css`

The card is already `position:relative`. The title anchor lives in `.skill-card-ident`, which has `overflow:hidden` on the anchor — that does not clip a `::after` whose containing block is the card (the anchor and `.skill-card-ident` are not positioned, so the pseudo-element's containing block is `.skill-card`).

Add, in this order (keep the file's one-line minified style — append rules to the end of the existing line, or as a second line; do not reformat the existing rules):

- `.skill-card-ident>a::after{content:'';position:absolute;inset:0}` — the overlay that makes the whole card the link's hit area.
- `.skill-card-buttons,.skill-card-bottom>div:last-child{position:relative}` — raises the More trigger, FavoriteHeart, the enable Switch and `.card-install` above the overlay (later in DOM + positioned = painted above a positioned element earlier in DOM, with no z-index). `.card-flag` is already `position:relative` and later in DOM; `.board-hover-tip` and the error alert are absolute with `z-index:10` already; LiftFigure ends up under the overlay, which is fine because it is presentational.
- `.skill-card-ident>a{-webkit-user-drag:none}` — an anchor spanning the card would otherwise start a link drag on mousedown-drag in WKWebView.
- `.skill-card-ident>a:hover{text-decoration:none}` — `src/styles/app.css:51` underlines every `a:hover`; with the stretched overlay the title would underline whenever the pointer is anywhere on the card, and the canvas draws the card hover state with the title as plain text. (Colour is already inline on the anchor, so only the underline leaks.) Merge this into the existing `.skill-card-ident>a` block if you prefer — one declaration either way.
- Focus and pressed states, GUARDED so keyboard users never lose the ring on WKWebViews without `:has()` (`src-tauri/tauri.conf.json:52` minimumSystemVersion 11.0; `src/styles/app.css:52` provides the global `a:focus-visible` ring that stays in force outside the guard):

```css
@supports selector(:has(a)) {
  .skill-card-ident>a:focus-visible{outline:none}
  .skill-card:has(.skill-card-ident>a:focus-visible){box-shadow:0 0 0 2px var(--tk-accent)}
  .skill-card:has(.skill-card-ident>a:active){background:var(--tk-bg3);border-color:var(--tk-border2)}
}
```

Do not change `SkillCard.tsx` (anchor, href, `data-testid` unchanged).

### 2. Marketplace PersonCard

`desktop/src/screens/marketplace/marketplace.css` (NOT `market.css`, which does not exist):

- `.market-person-card{position:relative}` — it is not positioned today (its rule is `display:flex;flex-direction:column;gap:8px;height:124px;...`). Add `position:relative` to that existing rule.
- `.market-person-ident>a::after{content:'';position:absolute;inset:0}`.
- `.market-person-ident>a{-webkit-user-drag:none}` and `.market-person-ident>a:hover{text-decoration:none}` (same reasons as the skill card).
- `.market-follow` is already `position:relative`; leave it — it sits above the overlay.
- The same `@supports selector(:has(a))`-guarded rules for `.market-person-card`: `.market-person-ident>a:focus-visible{outline:none}`, `.market-person-card:has(.market-person-ident>a:focus-visible){box-shadow:0 0 0 2px var(--tk-accent)}`, `.market-person-card:has(.market-person-ident>a:active){background:var(--tk-bg3);border-color:var(--tk-border2)}`.

`desktop/src/screens/marketplace/market-components.tsx:35` `PersonCard`: drop the duplicate avatar `<Link to={'/marketplace/people/'+q.handle} aria-label={q.name}>` so the card has exactly one link (the name); the stretched name link covers the avatar. GEOMETRY HAZARD: `.market-card-head>span:not(.market-mark):not(.market-install-mark)` (marketplace.css) styles every direct `span` child of the head with `flex-grow:1`, `line-height:20px`, `overflow:hidden`, etc. If `<Avatar/>` (which renders `span.board-avatar`) became a direct child of `.market-card-head` it would pick those up and the MarketplacePeople / Marketplace / MarketplaceFull boards would move. So keep a wrapper element in the Link's place: replace the `<Link ...>` with a plain `<div>` (no class, no attributes) around `<Avatar initials={q.initials} size={32}/>`. The blockified `<a>` flex item and a `<div>` flex item have identical geometry. Verify with the existing marketplace tests (`desktop/src/screens/marketplace/marketplace.test.tsx`).

### 3. Onboarding preview is inert

`desktop/src/screens/onboarding/OnboardingBasics.tsx:10`: `if(tab==='Manage')return <div style={{width:440}}><SkillCard skill={d.skill}/></div>;` — add `inert` and `aria-label="Skill card preview"` to that wrapper `<div>`. Reason: `OnboardingScreen.tsx:75`'s document keydown handler owns Enter there and the canvas draws the preview as a static default-state card; with a stretched link a body click anywhere on the preview would eject the user from onboarding into the skill. React 19.2 supports the `inert` boolean attribute (`<div inert>`); if the typecheck rejects the bare boolean, use whatever form typechecks (`inert=""` is the fallback), never a cast.

### 4. Tests

#### 4a. jsdom (vitest) — `desktop/src/screens/library/library-skill.test.tsx`

Keep every existing test. Add invariants (model on the scratch assertions below, which were written against the pre-fix tree and must still hold after it):

- the `deploy-check` card on `#/library/global` contains exactly one link, and it has `href="#/skill/deploy-check"`;
- the `<article>` has no `role` and no `tabindex` attribute;
- clicking the Switch and clicking the favorite heart do not change `location.hash` (jsdom does not run CSS, so this is the DOM-level invariant: the controls are buttons, not links, and they do not navigate);
- on `#/marketplace/people/lena`, the `a11y-audit` card (not installed) contains exactly one link with `href="#/skill/a11y-audit?root=marketplace"`, and clicking its `.card-install` button navigates to `#/skill/a11y-audit?__mock=not-installed&dialog=install&root=marketplace` (this is the Library-style `.card-install` button; the mock Library shows only installed skills, so the button is only reachable in a marketplace list).
- in `desktop/src/screens/marketplace/marketplace.test.tsx` (extend, keep every existing test): on `#/marketplace/people`, `person-card-ryan` contains exactly one link with `href="#/marketplace/people/ryan"`, and clicking its Follow button (`Follow ryan`) leaves `location.hash` at `#/marketplace/people`.

Scratch assertions to port (they were run against the same test harness — `open(route)` + `screen.findByTestId`; do not copy the absolute imports):

```tsx
it('control: the title is the link',async()=>{open('#/library/global');const card=await screen.findByTestId('skill-card-deploy-check');expect(within(card).getByRole('link',{name:'deploy-check'})).toHaveAttribute('href','#/skill/deploy-check');});
it('inventory: the only link in the card is the title',async()=>{open('#/library/global');const card=await screen.findByTestId('skill-card-deploy-check');expect(within(card).getAllByRole('link')).toHaveLength(1);expect(card.getAttribute('role')).toBeNull();expect(card.getAttribute('tabindex')).toBeNull();});
```

#### 4b. Playwright — new spec `desktop/e2e/routes/card-click.spec.ts`

Same harness as `desktop/e2e/routes/routes.spec.ts`: import `prepare` from `../fidelity/determinism` and call it with a `Board`-shaped object (`{name, route, klass:'screen', width:1440, height:900}`), collect console errors / pageerrors like `routes.spec.ts` does and assert `errors` is empty at the end of each test. Mock backend (the dev server on port 1420; the Playwright config starts it). Use `test.describe.configure({mode:'parallel'})` like the sibling spec.

Tests (each its own `test()`):

1. Body click opens the skill: open `#/library/global`; take the bounding box of `[data-testid="skill-card-deploy-check"] .skill-card-desc` and `page.mouse.click()` at its centre (NOT `locator.click()` — Playwright's actionability check sees the `::after` overlay intercepting the pointer and retries to timeout); expect `page` URL to match `/#\/skill\/deploy-check$/`.
2. Switch click: on `#/library/global`, click the `deploy-check` card's `role=switch` (`locator.click()` is fine here — the Switch is above the overlay); expect the URL still matches `/#\/library\/global$/` and `aria-checked` flipped from `true` to `false`.
3. Favorite click: `getByRole('button',{name:'Favorite deploy-check'})` click; URL unchanged; `aria-pressed` flipped.
4. Flag hover: hover the `pr-review` card's `[data-flag="update"]` (that is `design.SKILLS[design.HOVER_INDEX]`, the Library board's hover target); expect its `.board-hover-tip` to be visible; URL unchanged.
5. Marketplace install button: open `#/marketplace/skills`; the `a11y-audit` card is not installed, so its wrapper `.market-card-wrap` carries a `button.market-card-install` (absolute, later in DOM than the card, so it sits above the overlay); hover the card, click that button; expect the URL to match `/#\/skill\/a11y-audit\?__mock=not-installed&dialog=install&root=marketplace$/` and a `role=dialog` to be visible.
6. More → Remove: on `#/library/global`, hover the `deploy-check` card (the `.card-more` trigger is `visibility:hidden` until hover), click `getByRole('button',{name:'More actions for deploy-check'})`, click the `Remove` menu item; expect the URL to contain `dialog=remove`.
7. Keyboard focus ring lands on the card: on `#/library/global`, move focus to the `deploy-check` title link by keyboard (press `Tab` repeatedly, bounded at ~60 presses, until `document.activeElement` is that anchor — keyboard-driven focus is what makes `:focus-visible` match; `locator.focus()` may not). If `await page.evaluate(()=>CSS.supports('selector(:has(a))'))` is false, `test.skip()` gracefully with a message; otherwise assert the computed `box-shadow` of the `<article>` is not `none` and contains `0px 0px 0px 2px`, and the anchor's computed `outline-style` is `none`. Chromium 153 supports `:has()`, so this assertion runs on the gate machine.
8. Marketplace-origin card click keeps root: open `#/marketplace/people/ryan`; body-click (mouse, centre of `.skill-card-desc`) the first `[data-testid^="skill-card-"]` card; expect the URL to contain `root=marketplace` and match `/#\/skill\/[^?]+\?root=marketplace$/`.
9. PersonCard body click navigates: open `#/marketplace/people`; mouse-click the centre of `[data-testid="person-card-ryan"] .market-person-lines`; expect the URL to match `/#\/marketplace\/people\/ryan$/`.
10. PersonCard Follow does not navigate: on `#/marketplace/people`, click `getByRole('button',{name:'Follow ryan'})`; expect the URL still matches `/#\/marketplace\/people$/` and the button is now `Unfollow ryan`.

This spec must FAIL on origin/main (test 1, 8 and 9: the body click stays on the list page) and PASS after the fix. You cannot launch a browser inside the sandbox; write the spec carefully and say in the report that the orchestrator runs it.

### 5. Docs

Do NOT edit `desktop/GAPS.md`, `desktop/README.md`, `desktop/AGENTS.md`, `desktop/FIDELITY.md` or `desktop/package.json` (desktop/AGENTS.md invariant 2). The orchestrator adds the one-line convention note itself.

## Acceptance

- `npm --prefix desktop run typecheck`, `npm --prefix desktop run lint` (`--max-warnings 0`), `NODE_OPTIONS=--no-experimental-webstorage npm --prefix desktop test` all green; report real counts (baseline on the untouched tree: 67 files, 922 passed, 88 skipped).
- `git diff --stat origin/main` touches only: `desktop/src/components/domain/SkillCard.css`, `desktop/src/screens/marketplace/marketplace.css`, `desktop/src/screens/marketplace/market-components.tsx`, `desktop/src/screens/onboarding/OnboardingBasics.tsx`, `desktop/src/screens/library/library-skill.test.tsx`, `desktop/src/screens/marketplace/marketplace.test.tsx`, `desktop/e2e/routes/card-click.spec.ts`.
- No `eslint-disable`, no `as any`, no skipped or weakened existing test.

=================== STANDING CONSTRAINTS ===================
- Sandbox: `--sandbox workspace-write`, no network, no git (not even `git status` or `git diff`; use the file system), no `npm install`. `node_modules` at the repo root and at `desktop/node_modules` are already in place (symlinks). Use absolute paths in shell commands; never `cd`. The repo root is the `-C` directory you were started in.
- Gates (run from the desktop package, report real counts, never an impression): `npm --prefix <repo>/desktop run typecheck`, `npm --prefix <repo>/desktop run lint`, `NODE_OPTIONS=--no-experimental-webstorage npm --prefix <repo>/desktop test`. Node here is 25; without that NODE_OPTIONS the jsdom localStorage tests fail spuriously. If vitest fails with EPERM on `node_modules/.vite-temp` (the symlinked node_modules is outside your writable root), run the focused files with `npx vitest run <file>` and if that also cannot run, say so honestly in `gates.test.output` — the orchestrator re-runs every gate outside the sandbox. A browser will not launch in the sandbox: do not fake a Playwright result.
- Do not run `scripts/next-bug-number.sh`. Do not commit, stage, push, or apply anything. Leave changes in the working tree, unstaged.
- If the spec is ambiguous, record the question in `openQuestions` and implement the most conservative reading. Never resolve a design fork on your own.
- Do not edit `desktop/GAPS.md`, `desktop/README.md`, `desktop/AGENTS.md`, `desktop/FIDELITY.md`, `desktop/package.json`, `src/styles/tokens.css` or `src/fixtures/design.json`.
- Verify every write by reading the file back. Grep before writing anything new; extend what exists.
- Your final message must be the JSON report matching the output schema you were given (every key required).
