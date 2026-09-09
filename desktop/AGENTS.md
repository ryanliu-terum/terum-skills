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
