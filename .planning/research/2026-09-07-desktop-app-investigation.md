# terum-skills desktop app — implementation investigation (phase-2 frontend)

**Status:** RESEARCH (2026-09-07). Not a spec. The investigation Teddy asked for ("investigate and begin looking to spec the actual implementation plan") before the phase-2 frontend spec is written. Everything here is evidence-cited; the one decision that gates the spec is in §9.1, the batch for Ajay and Ryan in §9.2.
**Inputs:** the design canvas (67 boards on six pages, `~/Projects/SSM/design/terum-skills/build.py` @ md5 `c8cdc419…`, 3,561 lines); the CLI on `main @ 3b26647` (npm `terum-skills@0.1.3`, published 2026-09-07T08:42Z; the reader reports were written against `359d0f9`, one release earlier — §12 lists what changed); the phase-1 build spec (rev 12, 2026-09-06), the eval-engine spec (header rev 14, changelog rev 15), the eval-integration plan (rev 4), the ledger (D1–D41), the six decision walks; Tauri v2 documentation (2.11.x, verified 2026-09-07); the house frontend (`Terum-Dashboard`). Eleven reader reports plus the critic and its gap-fillers (≈12,000 lines), copied to `~/Projects/SSM/design/terum-skills/.review/2026-09-07-desktop-spec/` — listed in Appendix A; the numbers below cite them as `[report §section]` and the sources as `file:line`.
**Objective being served (Teddy's handoff, verbatim intent):** "Build the FRONTEND ONLY of a locally hosted Tauri desktop app for terum-skills, bootable on mock data, so teammates can wire the real backend (eval, tracking, sharing) afterward. Backend is NOT Teddy's job and NOT this work's job."

---

## 0. Summary

1. **The frontend-only build is a plain Vite + React app that runs in a browser on mock data.** Tauri cannot run on the WSL2 machine the design is built on (no Rust toolchain, no `libwebkit2gtk-4.1`; both are hard prerequisites for `tauri dev`). The Tauri shell is a later wrap done on the Mac. Nothing in the design port depends on Tauri, and the seam below guarantees nothing ever will. `[tauri §0, §2]`
2. **The seam already exists in the CLI.** Every one of the 19 verbs on `main` is `run(args, io: Prompter): Promise<Result<T>>` (`src/cli.ts:26-34`, phase-1 spec `§3:56`, §13 default 40 `:544`); the `Prompter` is five members (`src/lib/prompt.ts:20-26`); 17 of 19 verbs return a typed payload. The frontend codes against that shape, through one interface, with a mock adapter now and a real adapter later. `[commands §0, libs §2]`
3. **The design's dialogs are Prompter questions.** The CLI asks 27 distinct questions (18 confirm sites, 7 text labels, 2 selects). The Install / Remove / Publish / Leave dialogs are the desktop rendering of a `confirm`; the design's own `dialog()` prints the CLI verb it stands for. The frontend therefore needs a **scripted prompter** that pre-answers only what the user saw in the dialog, plus an escape hatch for unexpected questions. `[commands §3, frontend §2.5]`
4. **The pixel gate is real and cheap.** Playwright's bundled Chromium on this machine renders the design's own boards with **zero differing pixels** against `.shots/*.png`; the Inter variable font the design uses is byte-identical to one npm package file. The port can be held to a measured tolerance per board. `[frontend §0, §4, §5]`
5. **Design and specs disagree in ~15 places, and none of them is a bug in either.** Net lift on cards (§12), the Run-eval button (§12 vs D27), install scope radios (§13 default 6 / D17), invite scoping + role, favorites, Follow, per-machine enable/disable, last-seen, project membership, Inbox kinds, filter defaults, per-case tables, hygiene `warn`, token counts. Each is an ask to Ajay or Ryan, not a frontend decision. §7 tables them; §9.1 asks Teddy the one question that decides how the frontend handles them.
6. **The phase-2 gate is still a gate**, and the desktop app is written down nowhere in the specs. D21 says "a local web UI served by the CLI". A one-line D21 amendment from Ryan (§9.2, T1) is the cheapest honest fix; the frontend-only work does not need the gate lifted. `[spec-delta §3]`
7. **The CLI repo moved 116 commits during this investigation** (a072e3d → 359d0f9 → 3b26647). Phase 1 shipped, `publish`/`setup`/`status`/`update`/`validate`/`eval`/the hook all exist, and **IE3 landed at 3b26647: `eval --commit` writes one immutable receipt through safeWrite under guard row g, and the README eval column renders the newest valid receipt**; `ui`, `eval show`, CI (IE4), and the share card do not exist. The stale first-pass reports were corrected by a delta pass; where the two disagree, the `.v2.md` reports win. `[spec-delta §4]`

---

## 1. What exists today

### 1.1 The design (67 boards, six canvas pages)

| Page | Boards | What they are |
|---|---|---|
| Frame | 3 — `Main`, `Light`, `FigmaDark` | the 1440×900 shell: top bar (traffic lights, Terum mark, back/forward, ⌘K search, bell), sidebar (Library ▸ Global 30 / Projects Terum 22 · SSM 15 · MRF 32 / Inbox ▸ Pushes 3 · Updates 3 · Alerts 8 / Team ▸ Marketplace · Share), footer (avatar · handle · machine name · settings gear). `FigmaDark` is a rejected 2023 palette kept for comparison, not a theme. |
| Library | 8 — `Library`, `LibraryLight`, `LibraryCollapsed`, `LibraryEmpty`, `LibraryNoResults`, `LibraryLoading`, `LibraryError`, `SkillCard` (states sheet) | four overview tiles, search row, a 3-across card grid; the card's net-lift figure + verdict chip, health flags, enable/disable switch |
| Skill detail | 20 — `SkillDetail` + Activity, Disabled, Error, Evals, EvalsReport (1440×1900), Files, Hovers (sheet), Install, Light, Loading, NoReceipt, NotInstalled, Partial, Quality, RailClosed, Remove, RunEval, States (sheet), UsesHover | header + tabs (SKILL.md, Evals, Quality, Activity), rail (status switch, details, repo, author, evaluated, share-with-CLI), the eval report as a document, run history, Install / Remove / Run-eval dialogs |
| Inbox | 10 — `Inbox` + Alert, Empty, Error, Eval, Light, Loading, Panes (sheet, 2780), States (sheet), Update | one list newest-first of seven kinds (share, update, alert×4, eval, review, author, team); the selected item as an email-style report with From / To / Date / Subject and actions |
| Marketplace | 19 — `Marketplace`, `MarketplaceNoHero`, `MarketplaceFull` (1440×1080), Filters, Light, Loading, NoResults, Error, Skills, Projects, Project, ProjectInstall, ProjectNotInstalled, People, Person, PersonNotInstalled, Categories, Category, States (sheet) | home (Top rated · Teams/Projects · People · Browse by category), filters popover, project and person pages with a rail and bulk install/uninstall, four expanded pages, category pages |
| Share | 7 — `Share`, ShareInvite, ShareLight, ShareLoading, ShareEmpty, ShareError, ShareStates (sheet) | the Members roster (Name / Status with role menu / Joined / Teams / Last seen) and the Invite dialog (GitHub logins, scoping, role, join block) |

Not drawn: **Settings** (a 333-item verified inventory exists at `design/terum-skills/.review/2026-09-07-settings/`; Teddy has not been asked the one question yet), **Onboarding** (PDF page 3 — and `setup` is a shipped 5-to-11-question wizard that `install` invokes silently on a fresh machine, see §12 G1). The Person profile page of PDF page 9 **is** drawn as `MarketplacePerson` (the critic corrected the handoff on this). Board titles and the page-by-page acceptance list are in `[share-system §7]`.

The design system: 29 tokens × dark/light lifted from linear.app (`build.py:26-58`), Inter with `"cv01","ss03"` at 13/12/11px and weights 400/500/510/590, 28px rows, radii 4/6/8, 16px stroke-1.5 icons (45 named paths), ~75 WCAG contrast pairs gated at 4.5 (text) / 3.0 (figures, controls), and eight data gates (`check_receipts`, `check_inbox`, `check_history`, `check_report`, `check_versions`, `check_people`, `check_market`, `check_contrast`) that refuse inconsistent sample data. `[share-system §2–§6]`

### 1.2 The CLI on `main @ 3b26647` (0.1.3; reader citations are against `359d0f9`)

- **Verbs (18 top-level + 6 sub, 19 modules):** `login`, `setup [target]`, `team create|join|remove|leave`, `invite`, `ls` (+`--local`, `member`, `project`), `status`, `publish`, `validate`, `eval`, `share`, `install`, `uninstall-skill`, `uninstall` (machine teardown), `sync` (+`--hook`, `--prune`), `search`, `update`, and hidden `readme`, `guard-push` (`src/cli.ts:48-121`). `[commands §1–§2]`
- **Seam facts:** `buildProgram(execute, verbs: CliVerbs, context)` takes an injectable verb map typed as each module's `run` (`src/cli.ts:31-34`) — the test suite already drives every verb with stubs. `Result<T>` is `{ok:true,value} | {ok:false,error,value?}` (`src/lib/result.ts:1-3`). Prompter: `interactive`, `confirm`, `text`, `select`, `print` — `secret` was deleted with the PAT path; `PromptClosedError` has three reasons. `[libs §2]`
- **Read models that exist:** `status` → `StatusResult` (per-team clone state, roster, counts, staleness; `src/commands/status.ts:47-53`); `ls --local` → `LsResult.local: LocalSection[]` (per-root inventory with per-row problems; `src/commands/ls.ts:15-18`); `search` → `SearchHit[]` with `unresolved: boolean` added by rulings walk R12 explicitly "so the phase-2 UI can grey out Install" (`src/commands/search.ts:16,56`; `.planning/decisions/2026-09-06-phase1-rulings-decision-walk.md:38`). Pure library readers: `readPeople`, `readTeam`, `installCounts`, `skillRecords`/`findSkill` (`src/lib/skills.ts:7`), `sourceFiles` (`src/lib/skill-source.ts`), `inspectHygiene` (`src/lib/evals/hygiene.ts:6-35`), `describeUpdate` (`src/lib/update.ts`), `receiptSchema` (`src/lib/evals/receipt.ts:50-87`). `[commands §4, libs §4]`
- **What no verb returns:** the SKILL.md body, receipts per version (readable now: since 3b26647 `eval --commit` lands `evals/<id>/<tree>/<run>.json` through safeWrite under guard row g, `src/commands/eval.ts:159-201`, `src/lib/guard.ts:9,46`; nothing yet reads a receipt body for a UI — `readme.ts:171-184` reads only the verdict), who-installed lists, inbox events, favorites, follows, per-machine enable/disable, people roles, project membership, category counts, a quarantine listing, progress events, a typed decline. `[commands §6, eval §7]`
- **Packaging:** `package.json` has `bin` + `files` and no `exports`/`main`/`types`; `tsconfig.build.json` emits no `.d.ts`; `dist/index.js` runs commander on import (`src/index.ts:45`). Four non-breaking edits expose the library (a `src/lib-entry.ts` barrel that is not `index.ts`, an `exports` map, `declaration: true`, a CI tarball assertion). There is no `--json` mode and no server. `[libs §5]`
- **Behaviours a GUI caller must respect:** `cwd` decides whether project skills exist at all (`src/lib/local-skills.ts:32`; `src/commands/install.ts:224-228`); `placementHome` is POSIX-only so `home` must always be passed on Windows (`src/commands/install.ts:236`); four lock families, and `sync --hook` is a silent no-op within an hour of the stamp (`src/lib/hook.ts:148,164`; `src/commands/sync.ts:105`) — a UI must call plain `sync`; `safeWrite` hard-resets the clone (`src/lib/teamRepo.ts:125-126`); declines arrive as `ok:false` strings (`'Share was declined.'` etc.); `print` carries information no `Result` field has; `ls` spawns one `git` per skill while a batched `skillTrees` reader exists privately (`src/lib/teamRepo.ts:283`); `gh auth login` is the one child that needs a real terminal (`src/lib/auth.ts:39-45`). `[libs §8]`

### 1.3 The specs, as they bind the UI

| Rule | Cite |
|---|---|
| **D20** — everything the UI shows lives in the repo; the UI is a renderer with no second source of truth ("… and usage selections") | `team-skill-sharing.md:133` |
| **D21** — primary UI is a local web UI served by the CLI (`terum-skills ui`); offline, no auth, no hosting | `:134` |
| **D23** — the frontend is built against a small data interface, made concrete as library-first: the UI supplies a `Prompter` and calls the same functions | `:136`; `phase-1-build.md:56`, `:544` |
| **D24** — the page set (Browse / Profile / Skill / Evals) is PROPOSED; the canvas may diverge | `:137` |
| **D25** — the local UI shows the repo as of last pull; it cannot share a link | `:141` |
| **D27** — the Evaluate button streams the run or opens a terminal; PROPOSED, "leaning: stream" | `:148` |
| **D38** — "rated" means install counts from `people/*.json`; eval scores are a distinct signal shown alongside | `:140` |
| **§12 eval UI contract** — the receipt JSON is the API; the UI never runs evals and never derives statistics; latest receipt per version; hard rules: no list sorted by a receipt number, no lift-style decimal at card level, "—" without a receipt, greyed when partial, never mix `model`/`cc_version` on one surface | `eval-engine.md:477-497` |
| **Consent** — `approvals` are per machine and never committed; a changed grant hash is no approval; `sync --hook` never places an unapproved grant | `phase-1-build.md §5.4` |
| **Placements ledger** is the only set of deletable paths; the clone is disposable; placed copies are generated output, not an authoring surface (§13 default 33) | `:534`, `:368` |
| **Phase-2 gate** — GATE; tripwire "first time a teammate asks how to browse skills without the terminal, or a third team joins"; `setup` step 8 is "the line phase 2 replaces with opening the local UI"; `ui` must not appear in wizard output | walk `:64-84`; `phase-1-build.md:22, :383, :545`; `eval-integration.md:143` |
| **D41 / update notices** — advertisement, not availability; once per candidate per 24 h; a UI must carry the advertised wording | `team-skill-sharing.md:41`; `phase-1-build.md:294` |
| Honesty strings already shipped that the app inherits verbatim: `From the local clone; GitHub access is not checked.` (`status`), `Team status is from local clones and may be stale; open endorsement requests are not checked.` (`ls --local`), `Evaluated skills: not yet available` | `phase-1-build.md:340-342` |

Full MUST / NEVER / DEFAULT tables with line numbers: `[spec-delta §2]`.

### 1.4 The machines

| | WSL2 box (this one) | teddy-mbp | Windows host |
|---|---|---|---|
| Role | design generator, frontend dev in a browser, the pixel gate | Tauri init, window chrome, macOS build | Tauri Windows build, later |
| Node | v24.15.0, npm only | — | — |
| Rust / webkit2gtk | **absent / absent** — `tauri dev` impossible until installed (`[tauri §2.6]` has the apt + rustup list; Ubuntu 26.04 arm64 ships `libwebkit2gtk-4.1`) | Xcode CLT + rustup | MSVC + WebView2 + rustup |
| Playwright | Chromium 153 installed and validated; renders the design at 0 px difference | — | — |
| Native npm binaries for the stack | all publish `linux-arm64` (esbuild, rollup, lightningcss, tailwind oxide) | — | — |

---

## 2. The seam: what the frontend calls

Two readers converged independently on the same shape `[tauri §10.4, frontend §2.5]`; this section merges them.

**One directory owns every non-mock capability; nothing outside it does I/O or imports `@tauri-apps/*`.**

```
src/backend/
  types.ts        Result<T>, Prompter (mirrors src/lib/prompt.ts), every DTO, the Frame union
  Backend.ts      the interface — one method per verb the UI surfaces + reads + capabilities
  prompter.ts     scriptedPrompter(answers, onUnexpected)
  index.ts        pickBackend(): mock | tauri | http — resolved ONCE at boot
  mock/           fixtures + fake timers + failure/emptiness toggles   (the browser build)
  tauri/          sidecar transport (later, teammates)
  http/           D21 transport (later, only if `terum-skills ui` ships)
```

**The interface mirrors the verbs one-for-one, plus read models and capabilities.**

```ts
export interface Backend {
  // capabilities — what THIS backend can honour; the mock says yes to everything drawn
  capabilities(): Promise<Capabilities>;
  // reads (TanStack Query)
  status(): Promise<Result<StatusResult>>;                 // = status verb
  library(q: { team: string; scope: Scope }): Promise<Result<SkillCard[]>>;
  skill(q: { team: string; ref: string }): Promise<Result<SkillDetail>>;
  receipts(q: { skillId: string; version: string }): Promise<Result<Receipt | null>>;  // latest per version
  inbox(q: { team: string }): Promise<Result<InboxItem[]>>;
  catalog(q: CatalogQuery): Promise<Result<Catalog>>;
  roster(q: { team: string }): Promise<Result<Roster>>;
  search(args: SearchArgs): Promise<Result<SearchHit[]>>;   // = search verb
  // long or interactive verbs — a Run<T>, never a bare promise
  install(args: InstallArgs): Run<InstalledResult[]>;
  uninstallSkill(args: UninstallArgs): Run<UninstalledResult[]>;
  share(args: ShareArgs): Run<ShareResult | undefined>;
  publish(args: PublishArgs): Run<PublishResult>;
  sync(args: SyncArgs): Run<SyncResult>;
  invite(args: InviteArgs): Run<InviteResult>;
  team(args: TeamArgs): Run<TeamResult>;
  eval(args: EvalArgs): Run<EvalResult>;
  validate(args: ValidateArgs): Promise<Result<ValidateResult>>;
  update(): Promise<Result<UpdateAdvice>>;
  // capabilities the CLI does not own
  openInEditor(path: string): Promise<Result<void>>;        // opener plugin | window.open in mock
  copyToClipboard(text: string): Promise<Result<void>>;
  prefs: PrefStore;                                          // app-owned file | localStorage in mock
}
export interface Run<T> {
  frames: AsyncIterable<Frame>;                    // print | ask | progress
  answer(id: string, value: string | boolean): void;
  cancel(): Promise<void>;
  done: Promise<Result<T>>;
}
```

**Why `Run<T>` and not a promise:** the verbs ask questions mid-flight. If the mock returns bare promises, the UI never grows the progress panel, the cancel button, or the "answer this question" modal that install, sync, share, and eval need, and D27 gets decided by accident. `[tauri §10.4]`

**The scripted prompter.** The Install dialog collects the grants approval (and, as drawn, a scope); the user presses Install; the mutation runs with a prompter pre-loaded with exactly those answers. Any question the dialog did not anticipate pushes a new dialog rather than deadlocking or auto-answering — the build spec is explicit that answering consent on the user's behalf is a §5.4 bypass (`phase-1-build.md §6.1`). `[frontend §2.5]`

**Capabilities.** The mock backend reports every drawn affordance as supported, so the frontend renders the canvas as designed. A real adapter reports what the CLI can do today (`favorites: false`, `installScope: false`, `runEvalInApp: false`, …) and the UI hides or greys the control with the honest string. This is how the frontend can be built as drawn without hard-coding a spec violation: the only place favorites, follows, per-machine disable, or scope radios have state is the mock adapter — D20 is not breached because the frontend never owns a second source of truth for anything a real backend cannot hold. §9.1 asks Teddy whether he wants this.

**The wire protocol the real adapter would speak** (recorded so the teammates' choice is not foreclosed; JSON-lines, one object per line): down — `{"t":"print","line"}`, `{"t":"ask","id","kind":"confirm"|"text"|"select","question","default"?,"choices"?}`, `{"t":"progress",…}`, `{"t":"result","ok",…}`; up — `{"t":"answer","id","value"}`, `{"t":"cancel"}`. It is `Prompter` serialised. `[tauri §10.4]`

**Three rules that make the seam hold** `[tauri §10.4]`: (1) no `@tauri-apps/*` import outside `src/backend/tauri/` — an ESLint `no-restricted-imports` rule plus a test that greps the tree; (2) no component ever branches on `isTauri()`; (3) every long verb is a `Run<T>`, even in the mock.

**Things the frontend must never do** (from the specs): read `~/.terum/skills/config.json` or `~/.claude/skills` directly (D20/D23); compute or re-derive any eval statistic (§12); write into the CLI's `config.json` — app preferences go in an app-owned file (bare `uninstall` deletes `~/.terum/skills` except `quarantine/` and `backups/`, `phase-1-build.md:349`).

---

## 3. Integration options for the real backend (deferred by design)

Four options, scored in `[tauri §10.2]`; the recommendation is **O4 now, against a seam shaped for O2, that O1 can also satisfy; O3 ruled out.**

| | O1 webview → localhost server (D21 literally) | O2 Node sidecar, JSON-lines Prompter protocol | O3 Rust reimplementation | O4 frontend-only mock now |
|---|---|---|---|---|
| D23 "same functions" | ✓ | ✓ (the sidecar *is* the CLI) | ✗ a second implementation of every verb | ✓ undecided |
| D1 no server | ✗ a port, no auth | ✓ | ✓ | ✓ |
| Effort to first call | `ui` is **not built** — a whole server | one protocol module + ~150 lines of Rust | months; re-derives §5–§7 | zero |
| Packaging | CLI must be reachable | +~116 MB/platform (Node SEA) or bun (~57 MB) or require Node | one binary | n/a |
| Streaming / cancel / prompts | SSE + correlation ids, hand-rolled | process-native | native | fake timers |
| Testable in a browser | ✓ | needs the mock | needs the mock | ✓ |

Within O2 there is a second choice the libs reader settles in favour of **in-process import**: the sidecar process imports the library (after the four `exports` edits) rather than shelling to the bin — 17 typed payloads arrive as objects, `print` becomes a callback, and the injectable `ConfigStore`/`Runner`/`cwd`/`home` seams let the app point the library at a sandbox. `[libs §5.5]`

**The question this leaves for the teammates, not for this phase:** bundle a Node runtime (SEA is Stability 1.1, no macOS x64; bun cross-compiles), require `npx -y terum-skills@latest` (offline breaks, version drifts), or require `npm install -g terum-skills` (now a first-class supported shape — `invite`'s Slack block leads with it, `src/commands/invite.ts:304-310`). `[tauri §3, spec-delta T13]`

---

## 4. Frontend stack (recommendation)

From `[frontend §1]`, every version verified against the npm registry on 2026-09-07 and every choice judged on px-exact fidelity, house convention, and a solo builder's cost.

| Area | Choice | Pin | Why (one line) |
|---|---|---|---|
| Framework | React 19 + Vite + TypeScript strict | `react@19.2.8`, `vite@8.2.2`, `typescript@5.9.3` | house default (`Terum-Dashboard`), Tauri's `react-ts` template |
| Styling | Tailwind v4 with **generated `tokens.css`** from `build.py`'s `TOKENS` and a `@theme { --*: initial; --spacing: 4px }` reset | `tailwindcss@4.3.3` | one source of truth for the 29 tokens; near-miss values cannot exist |
| Primitives | **Base UI** (`@base-ui/react`) | `1.8.0` (2026-09-04) | covers every primitive drawn; Radix has had no commit since 2026-07-31 and shadcn switched in July 2026 |
| Routing | react-router v8, `HashRouter` | `react-router@8.3.1` | the only history that works unchanged under Vite, a localhost server, and Tauri's asset protocol; the house Dashboard does the same. Do not install `react-router-dom` (v8 removed it) |
| Data | TanStack Query over the `Backend` interface; in-memory mock adapter with latency / failure / emptiness toggles reachable from the URL (`#/library?__mock=error`) | `@tanstack/react-query@5.102.8` | msw intercepts HTTP, a transport the real backend may never use |
| App state | Zustand with `persist` | `zustand@5.0.15` | sidebar, overview, rail, theme, unread, dialog stack are cross-tree |
| Content | react-markdown + remark-gfm (SKILL.md tab, five block kinds, no highlighter); the eval report = components over the receipt JSON | `react-markdown@10.1.0` | §12: the receipt is the API |
| Icons | **inline the 45 `ICON_PATHS` as a typed local set** | — | only 21/45 match current Lucide; `settings`, `heart`, `bell`, `check-circle`, `play`, `trash` differ; two are custom `[share-system §5]` |
| Fonts | Inter Variable from `@fontsource-variable/inter/standard.css` (family `'Inter Variable'`, features `"cv01","ss03"`); mono: JetBrains Mono Variable **and change `build.py`'s `MONO` to match** | `@fontsource-variable/inter@5.3.0` | the `standard` file is byte-identical (md5 `4b73e2ff…`) to what the design renders; the default import is the wrong (wght-only) binary; Berkeley Mono is commercial and was never actually loaded |
| Workshop | Storybook 10 (Vite builder, addon-a11y) for the nine specimen sheets only; cut first if the schedule slips | `storybook@10.6.0` | the `*States`/`*Hovers`/`*Panes` boards map 1:1 to stories |
| Tests | vitest + Testing Library + jsdom; Playwright for flows and both visual gates; axe; eslint flat config + typescript-eslint as in the CLI repo | `vitest@4.1.11`, `@playwright/test@1.63.0` | the house already runs this Playwright shape at 1440×900 |
| Fixtures | **generate** `src/fixtures/design.json` and `tokens.css` from `build.py` with `tools/export-design.py --check`; zod-parse at the boundary; port the eight `check_*` gates as vitest suites | `zod@4.5.4` (matches the CLI) | `import build` is side-effect-free; 20 constants, 59,650 bytes; hand-porting re-encodes eight gates by eye |

Proposed `src/` layout and npm scripts: `[frontend §7]`. Environment fit (linux-arm64 binaries, Node 24, port 1420 so `tauri.conf.json` needs no edit): `[frontend §8]`.

---

## 5. Fidelity gate and mock data

**Gate A — design conformance:** each app screen at 1440×900 diffed against the read-only `design/terum-skills/.shots/<Board>.png`; per-class `maxDiffPixelRatio` starting at 0.30 % (screens) / 0.35 % (dialogs) / 0.20 % (loading, empty, error) / 0.25 % (full-page), lowered per board to just above its noise floor; a `FIDELITY.md` table marks each board `todo | in-progress | locked` and only `locked` boards fail the build; masks (traffic lights, machine name, relative times) each cost a written reason. 59 of the 67 boards are in scope; the 7 specimen sheets become stories and Gate B baselines; `FigmaDark` is excluded. **Gate B — regression:** committed app baselines, tight tolerance, every commit. Determinism rules copied from the house (seeded PRNG, frozen clock, `document.fonts.ready`, animations paused) plus one assertion the design's own pipeline lacks: fail the run if `document.fonts.check('13px "Inter Variable"')` is false. Feasibility measured, not argued: 0 differing pixels on `Library` and `SkillDetail` between the design's snap Chromium 151 and Playwright's Chromium 153. `[frontend §5]`

**Mock data:** one fixture set exported from `build.py` (SKILLS, INBOX, CATALOG, PEOPLE, PROJECTS, ROSTER, MEMBER, INVITED, CATEGORIES, DETAIL×4, AUTHOR_OF, LIST_OF, COUNTS, CATALOG_N, TEAM_N, MARKET_EXTRA, TOKENS), refreshed by script with `--check` in CI, with the design's `TODAY = 2026-09-06` clock injected so relative times stay stable. Two known conflicts ride along and must be resolved on the design side first (`AUTHOR_OF` contradicts four earlier boards; mira's joined date vs an Inbox item — `.review/2026-09-07-regression/PENDING-marketplace.md`). The receipt fixtures must be shaped to `receiptSchema` exactly, because no real receipt exists yet and the app's first real data will be zod-parsed against it. `[frontend §6, eval §1]`

---

## 6. Scope: routes, screens, components

Routes read off the breadcrumbs and sidebar selections `[frame §1, inbox-market §1.2, share §1.1]`:

| Route | Boards | Notes |
|---|---|---|
| `#/library/global`, `#/library/project/:name` | Library ×7 + SkillCard sheet | tiles, search, grid; states via `?__mock=`. **A project library is not drawn** — the sidebar has Terum / SSM / MRF rows but no board renders one `[frame §1.1:90]` |
| `#/skill/:ref` (+ `?tab=skill|evals|quality|activity`, `?dialog=install|remove|run-eval`, `?rail=closed`) | SkillDetail ×20 | the report at `?tab=evals` scrolls (1900px board) |
| `#/inbox`, `#/inbox/:id` | Inbox ×10 | sidebar sub-rows Pushes / Updates / Alerts are typed counts today; must become a derivation over the item list |
| `#/marketplace`, `?q=&filters=`, `/skills`, `/projects`, `/projects/:key` (+`?install`), `/people`, `/people/:handle`, `/categories`, `/categories/:key` | Marketplace ×19 | hero vs no-hero still Teddy's pick |
| `#/share` (+ `?dialog=invite`) | Share ×7 | header says "Members", sidebar row says "Share" — by design |
| `#/settings/*` | not drawn | reserved; the inventory exists; app-owned prefs file |
| first run / onboarding | not drawn | must at least detect missing `git` / `gh` / agent CLI as a first-class state `[tauri R4]` |
| ⌘K | drawn as an affordance only | app-side search over the clone (skills, people, projects); no results surface drawn |

Component inventory: ~60 primitives in `build.py` map to `components/ui` (Base UI wrappers: Tooltip, Menu, Popover, Dialog, Select, Switch, RadioGroup, Checkbox, Slider, Tabs, Button, Icon, Kbd, Skeleton, Chip) and `components/domain` (SkillCard, VerdictChip, LiftFigure, Facepile, Meter, Sparkline, CliBox, TerminalHint, MemberRow, PersonCard, ProjectCard, CategoryTile, InboxRow, ReportDoc, Sidebar, TopBar, ViewHeader, StatTile, CenteredState, …). Per-primitive props, variants, and px geometry: `[frame §2, inbox-market §2, share-system §4]`.

Things the app must decide that the boards cannot (structural, from `[share-system §8.1]`): a minimum window size and reflow rules (every board is a fixed 1440×900 with `overflow: hidden`); real scroll containers and sticky headers; portalled tooltips / menus / popovers with collision handling and a tooltip max-width; `user-select` back on for content; dialogs as `position: fixed` with focus trap, Esc, scrim-click; dark / light / system theme switching (no toggle is drawn anywhere).

---

## 7. Where the design and the specs disagree

Each row is a product or spec decision, not a frontend one. "Handling" is what the frontend does under the §9.1 recommendation (as drawn, behind a capability flag, gap recorded).

| # | On the canvas | The spec / the code | Verdict `[spec-delta §5, eval §8]` | Handling |
|---|---|---|---|---|
| C1 | Net lift as the big number on cards and the detail header | §12: "no lift-style decimal appears at card level"; probe #5 found per-skill rank ρ = −0.07 / −0.22 vs SkillsBench | ask Ajay for a one-line §12 amendment, **or** drop the decimal to one click deeper — the evidence now leans to dropping | `capabilities.liftOnCards`; mock true |
| C2 | Run-eval dialog with an estimate line, in-app | §12: "the UI never runs evals"; D27 (PROPOSED): stream or open a terminal | a contradiction **inside** the specs; Ajay resolves. The `eval` verb exists, asks no prompts, has no cost confirm, prints lines only | `capabilities.runEvalInApp`; the estimate shows the fixed ceilings, never a derived cost |
| C3 | Per-case table, per-run history strips, report prose | receipt has `comparisons`/`arm_scores`/`efficiency` and one free-text field; no `per_case` (passthrough permits); prose would be a UI template restating stored numbers | Ajay: additive `per_case` block in §5.3; §12 line blessing a restating template | mock carries `per_case`; the template restates only stored numbers |
| C4 | Install dialog scope radios (Global / Terum / SSM / MRF) | `InstallArgs` has no scope; §13 default 6 [veto cheap]: no per-install override; D17: scope is which `team.json` list references the ID | drop, or veto default 6 — Ryan | `capabilities.installScope` |
| C5 | Invite dialog scoping + role | `invite` takes GitHub logins only; `teamSchema` has no roles; admin = repo admin on the host, stored nowhere; §6.0's permitted `team.json` writes are closed | spec gap; a real change needs §5.1 + a guard row — Ryan | `capabilities.inviteScoping`, `.roles` |
| C6 | Favorites with team-wide counts; Follow / followers; role chip; last seen | no fields in `people/<handle>.json` (`src/lib/schema.ts:54-64`); D20 forbids app-local state shown team-wide; last-seen's only artefact is the machine-local stamp | one bundled ask to Ryan for §5.2 fields + verbs (guard row (b) already permits writing your own file) | `capabilities.favorites`, `.follow`, `.roles`, `.lastSeen` |
| C7 | Enable / disable per machine, "files stay on disk" | not expressible: placement **is** the loading mechanism; the only off-states are uninstall and quarantine; `declined` mutes everywhere | the largest invented mechanic; product call | `capabilities.disablePerMachine` |
| C8 | Inbox: seven kinds, unread, "acted on", off-target telemetry | the only announcement channels are `sync --hook`'s stderr line and interactive sync's prompts; no event log; off-target has no collector anywhere | needs its own spec section: recomputed-at-sync vs append-only local log; cut `offtarget` from v1 unless a collector is specced | mock as drawn; the adapter contract says which kinds are derivable |
| C9 | Marketplace filter defaults (PASS-only, lift ≥ +20 %, installs ≥ 3) | §12 bans ranking, §2 bans leaderboards; filtering is not named, but a default hiding every NEUTRAL/FAIL is an editorial stance on unrankable numbers | ship filters opt-in with all defaults off | frontend default |
| C10 | Project members, facepiles, per-project admin, checkout paths | `team.json` projects have `remotes` + `skills`, never members; paths are machine-local and come from cwd | people-file `projects[]` (cheap, self-declared) or cut; a `config.json` project → path map is a confirmed gap | `capabilities.projectMembers`; workspace picker (§8) |
| C11 | Quality tab: hygiene `pass|warn|fail`, "4.2k tokens · cap 5k" | `inspectHygiene` findings are binary; HYG6 caps 20,000 **characters**, no tokenizer in `src/` | drop `warn` until §9 gains an advisory tier; show a labelled approximation ("~4.2k tokens at 4 chars/token") | frontend copy |
| C12 | "Edit" opens the file | placed copies are generated output (sync quarantines edits); only `config.shared[id].source` is editable, and only for your own skills | Edit opens the authored source or is hidden | frontend rule |
| C13 | 12-char version hashes; W–T–L vs W–L–T; "Partial run · 7 of 9 rounds scored" | `shortHash` is 8; the report prints two orders on one page; spec says "partial (7/9 scored)" | pick one each; design-side fixes | frontend copy |
| C14 | "Search 30 skills", ⌘K over skills, people, projects | `search` is skills-only, substring, over the clone | app-side combined search over the clone; no-results surface undrawn | frontend |
| C15 | Machine name in the footer; "your other machines" | no machine identity anywhere; cross-machine propagation is `people/<you>.json.installed` + `sync` per machine under that machine's `approvals` | read-only hostname is free; a registry is new state | frontend shows the hostname |

Design-side defects already logged and awaiting Teddy (21 items in `.review/2026-09-07-regression/PENDING*.md`) are not repeated here.

---

## 8. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Nothing Tauri can be run or verified on this machine | High | browser/mock mode is a permanent first-class target; Tauri work happens on the Mac; never report "works in Tauri" from here |
| R2 | `terum-skills ui` (D21) is not built and not scheduled; O1 is not a shortcut | High | the spec must not assume a server exists |
| R3 | The CLI keeps moving (110 commits during this investigation) | Certain | pin the reviewed commit in the spec; generate DTOs from `src/lib/schema.ts` where possible; re-read before each interface change |
| R4 | The app is never self-contained: `git`, `gh`, the agent CLI are spawned | High | first-run detection of missing tools as a first-class state |
| R5 | `cwd` silently decides whether project skills exist | High | an explicit, user-visible workspace selection passed as `cwd` to every verb |
| R6 | Gate A red from day one, then ignored | High if unmanaged | `FIDELITY.md`; only `locked` boards block |
| R7 | Sidecar size (~116 MB/platform with Node SEA) | High for O2 | a product call for the teammates: SEA vs bun vs require Node |
| R8 | The mono font decision deferred while baselines get committed | High | settle it before the first `locked` board; change `build.py`'s `MONO` to match |
| R9 | `isTauri()` leaking into components kills the browser mode | Medium | lint rule + grep test |
| R10 | Declines rendered as errors | Medium | ask the CLI team for a typed decline; string-match the eight known messages meanwhile |
| R11 | Playwright's Chromium updates and the 0-px match ends | Medium | pin `@playwright/test`; re-run one board's diff before touching thresholds |
| R12 | Signing costs and an updater endpoint (D1 has no server) | Medium | decide "internal, unsigned" vs signed before the first release; GitHub Releases as the updater endpoint or none |
| R13 | Six contrast pairs sit within 0.5 of their floor; `text4` is glyph-only | Medium | port `check_contrast` as a unit test; axe per route |

---

## 9. Decisions

### 9.1 The one for Teddy now

**Where the canvas and the specs disagree (§7), is the frontend built as drawn — every affordance behind a capability flag the mock says yes to, each gap recorded as an ask to Ajay or Ryan — or spec-clean, with those controls dropped until the specs change?**

Recommendation: **as drawn, behind capability flags.** The handoff's objective is the frontend on mock data; a spec-clean build would not match the design Teddy is finishing, and the capability mechanism keeps D20 intact because the only place invented state lives is the mock adapter. Two rows are excepted from "as drawn" because the frontend's own defaults decide them: C9 (filter defaults off) and C11/C12/C13 (copy). Under spec-clean, C1–C8 and C10 disappear from the first build and the mock loses ~a third of the drawn surface.

### 9.2 The batch for Ajay and Ryan (one bundled ask each, not fifteen)

| To | Ask |
|---|---|
| Ryan (ledger, phase-1 spec) | **T1** a one-line D21 amendment: the phase-2 UI may be a desktop shell whose channel supplies the `Prompter`; the HTTP server is one transport, not the requirement. **T7** the §5.2 people-file fields (favorites, follows, role, last seen, projects) + verbs. **T8/C5** invite scoping + role. **T9/C4** veto or keep §13 default 6. A typed decline on `Result`. Export the batched `skillTrees` reader. The four `exports`-map edits. A `config.json` project → checkout-path map. Not yet: `setup` step 8 opening the app (spend the gate when the app is real). |
| Ajay (eval specs) | **C1** §12 amendment or not. **C2** D27 vs §12. **C3** additive `per_case` + a template-may-restate line. **C11** an advisory hygiene tier. Bookkeeping: engine header says rev 14, changelog says rev 15; the integration plan pins rev 13; `--judge-escalation-model` is specified but unimplemented. |

### 9.3 Defaults I am taking unless vetoed (all [veto cheap])

- **Repo:** a sibling repo `terum-skills-app` (not `terum-skills/ui/`), so the frontend phase does not enter the CLI repo's review gates and history; merging later is a directory move. The frontend spec still lives with the other specs in `terum-skills/.planning/specs/`.
- **Seam target:** O4 now, O2-shaped (in-process import inside a sidecar), O1-compatible; O3 out.
- **App preferences:** an app-owned file (Tauri store plugin; `localStorage` in the mock), never `config.json`.
- **Multi-team:** one team at a time with a switcher bound to `--team`, modelled on `status`.
- **Workspace:** an explicit, persisted workspace folder passed as `cwd`.
- **`gh auth login`:** answer that one confirm with `false` and show a copyable instruction card.
- **Inbox:** one list newest-first with filters; sub-row counts derived; `offtarget` cut from v1.
- **Window chrome:** macOS overlay with traffic lights; native decorations on Windows/Linux (D-F7 needs Teddy's eye once the shell exists).
- **Icons inline; Inter Variable standard; JetBrains Mono; Base UI; HashRouter; Storybook only for the nine sheets.**

---

## 10. Proposed build order (draft, to be written into the spec)

| Milestone | Exit criterion |
|---|---|
| **M0 — decide + spec** | §9.1 answered; the batch in §9.2 sent; spec written to `.planning/specs/2026-09-07-desktop-app-frontend.md`, audited by `/ultraspec` or `/codex-spec`, locked |
| **M1 — scaffold + design system** | repo, Vite/React/TS/Tailwind, `tools/export-design.py` (tokens + fixtures, `--check`), Icon set, fonts, Base UI wrappers, the shell (top bar, sidebar, footer, theme, HashRouter), `Backend` + mock adapter + `scriptedPrompter` + `Run<T>`, Gate A/B harness, `FIDELITY.md`; `Main` and `Light` locked; `npm run check` green |
| **M2 — Library + Skill detail** | 8 + 20 boards locked; Install / Remove / Run-eval flows through the scripted prompter; the eval report as components over `receiptSchema` |
| **M3 — Inbox + Marketplace** | 10 + 19 boards locked; filters, project / person pages, bulk install dialog, expanded and category pages |
| **M4 — Share, Settings, Onboarding, ⌘K** | 7 Share boards locked; Settings and Onboarding once drawn; first-run tool detection |
| **M5 — Tauri shell (on the Mac)** | `tauri init`, window chrome, opener / clipboard / window-state / store plugins, still on the mock; no `@tauri-apps` import outside `src/backend/tauri/` |
| **M6 — real backend (teammates)** | `src/backend/tauri/` + the sidecar + the CLI's `exports` map; the UI does not change; capability flags flip from the adapter |

---

## 11. What the spec will contain, and where

House shape (`.planning/specs/2026-09-02-phase-1-build.md` as the template): status line with rev + date + parents; §1 context; §2 scope in/out; §3 stack + repo layout; §4 file trees; §5 data contracts (`Backend`, `Prompter`, `Run<T>`, `Capabilities`, every DTO, the fixtures schema, the protocol frames); §6 screen behaviour per route incl. every state and dialog and the exact prompt each dialog pre-answers; §7 the fidelity gate rules; §8 the mock adapter contract; §9 verification tasks (V-numbered); §10 build order; §11 acceptance (named vitest / Playwright suites with adversarial cases: capability-off rendering, unexpected prompter question, decline vs failure, `?__mock=` states, the §12 hard rules as tests, the eight ported gates, the no-Tauri-import grep); §12 defaults chosen [veto cheap]. Path: `terum-skills/.planning/specs/2026-09-07-desktop-app-frontend.md`.

---

## Appendix A — the reader reports

| File | Covers | Note |
|---|---|---|
| `design-frame-library-detail.md` | shell, Library, Skill detail: routes, components, data, actions, 14 contradictions | written @ a072e3d; its "publish / leave not built" claims are superseded |
| `design-inbox-marketplace.md` | Inbox, Marketplace: routes, seven kinds, catalog/projects/people/categories, 22 ambiguities | @ a072e3d |
| `design-share-system-tokens.md` | Share page; tokens, typography, 45-icon verification, primitives, the eight gates as rules, all 67 boards | @ a072e3d |
| `cli-library-surface.md` | first CLI pass | **stale** — read `cli-commands.v2.md` + `cli-libs.v2.md` instead |
| `spec-constraints.md` | first spec pass | **partly stale** — corrections in `spec-delta.v2.md §6` |
| `tauri-feasibility.md` | Tauri 2.11.x facts with URLs, prerequisites, sidecar packaging, IPC, plugins, window chrome, security, testing, the O1–O4 comparison, 17 risks | current |
| `frontend-stack.md` | the stack table with pins, the measured fidelity gate, the fixtures export, layout and scripts | current |
| `cli-commands.v2.md` | every verb on 359d0f9, the 27-question inventory, structured reads, gaps | current |
| `cli-libs.v2.md` | every lib module, the Prompter now, config schema, packaging, CI, GUI-caller risks | current |
| `spec-delta.v2.md` | revision ledger, binding rules, the phase-2 gate, built vs not, app-only concepts, T1–T14 | current |
| `eval-delta.v2.md` | receipt schema, hygiene, the `eval` flow, §12 verbatim, reliability facts, G1–G15 | current |
| `critic.md`, `gap-*.md` | completeness pass over the first seven | see §12 addendum when present |

## Appendix B — pins

CLI: `main @ 8bf12a8` at 2026-09-07 09:11 UTC (reader citations against `359d0f9`; §12's delta covers 3b26647), npm `terum-skills@0.1.3`. Design: `build.py` 3,561 lines, `canvas.json` 67 boards, published canvas `70b328b7-…` label "People page + Share page (round 1)". Tauri: core 2.11.5, `@tauri-apps/cli` 2.11.4, `@tauri-apps/api` 2.11.1. Node here v24.15.0. Playwright Chromium 153 (`chromium-1243`).

---

## 12. Critic addendum (completeness pass over the first seven reports, plus the 3b26647 delta)

The critic (`critic.md`) re-verified the corpus from source and found eight gaps no report covered, eight contradictions between reports, and eight claims without evidence. Gap-fillers wrote `gap-1…4, 6, 7.md`; G5 and G8 were still running when this was written. The full texts live beside the reports in `.review/2026-09-07-desktop-spec/`.

| # | Gap | What the filler established | Consequence for the spec |
|---|---|---|---|
| G1 | **Onboarding / first-run is unowned** | `setup` is a shipped wizard: eleven questions for a creator, five for a joiner, test-asserted (`src/commands/__tests__/setup.test.ts:348-352, 478-481`), with a resumable step map returned even on failure. `install <org>/<repo>/<skill>` on a machine with no team runs that wizard quietly first (`src/commands/install.ts:59-70`) — so the design's one-confirm Install dialog is, on a fresh machine, a five-to-eleven-question flow. The zero-team state of every screen is undrawn; the shipped copy is `src/lib/hints.ts:2-6`. Missing `git` / `gh` / `claude` detection has no owner. The PDF's page 3 is the only onboarding sketch; it is vector-only, so read it via `python3 -c "import fitz; fitz.open(p)[2].get_pixmap(dpi=150).save('p3.png')"`. | a first-run route, a `setup` flow through the scripted prompter, and an environment-check state are in scope for M4 |
| G2 | **Printed commands were never diffed against the CLI** | 21 call sites; two boards print commands that are wrong today: `uninstall deploy-check` (bare `uninstall` is now machine teardown; the verb is `uninstall-skill`, `build.py:1593`) and `validate` labelled "and in CI" (no CI job exists). `eval … --commit` (`build.py:1392`) was refused at 359d0f9 and **works at 3b26647**. `install project <key>` only succeeds inside a checkout of that project's remote. Fifteen per-string fixes in `gap-2.md §9`; a ninth generator gate that checks every printed command against a contract emitted from `src/cli.ts` is designed in `gap-2.md §7`. | the app builds commands from one typed builder, never copy; the design-side fixes wait for Teddy's go |
| G3 | **The Settings inventory the spec leaned on is a revision behind** | `inventory.verified.json` has 333 items (257 confirmed, 76 corrected); re-classified at 359d0f9: 28 rows flip to built; only 7 of 51 editable rows are wireable; the per-team PAT row is dead (rev 9 deleted `teams.<team>.token`). | Settings is mostly a read-only diagnostics surface plus seven real controls |
| G4 | **Nothing specified how the open window learns its data changed** | Four concurrent writers (the app, a terminal, the SessionStart hook, teammates via git). Local changes are observable (config.json, the stamp, the placed folders); remote changes are not — that is D25. Decisions D-R1…D-R6 in `gap-4.md §12`: hybrid refresh (`Backend.subscribe` push + revalidate-on-visible + a 60 s local poll + an explicit Sync now), invalidation keyed by source (`config`, `clone:<team>`, `placed`, `stamp:<team>`), **no optimistic cache writes for CLI-backed mutations** (`pending` is durable, `ok:false` does not mean nothing happened), **never auto-sync on a timer** (it suppresses the hook's sync for an hour), Sync now renders the `SyncResult`, and a staleness chip distinct from a change line. | adds `subscribe` to the `Backend` interface and a §6 refresh section to the spec |
| G5 | Share-card bundle (D28–D30) has no board and D30 assigns the rasterizer to this app | filler pending | decide owner and phase before M4 |
| G6 | **Teddy's source mocks were never opened** | The Person profile of PDF p9 **is** drawn (`MarketplacePerson`); `Plugins` is dropped by Teddy's own "out of scope for v1" annotation on PDF p1; the three sidebar rows Terum / SSM / MRF have no drawn destination; silent drift: the sketch's Updates count, the ♡ count, an "indicator system" of flags on PDF p2, and a 0–100 Score concept. | the project-library route is a real hole; the rest are design-track items for Teddy |
| G7 | **The README generator is a shipped renderer of the same data** | `src/lib/readme.ts` renders the identical read model on every push. Disagreements: 8-char vs 12-char versions (both binding — §12 governs eval surfaces, `readme.ts:189` governs the README; the app renders 12 and links to a README showing 8), the endorsement string masks project membership, and the README discloses staleness on the happy path while the design does so only in error states. | inherit the disclosure lines; do not normalise the hash |
| G8 | Resize, minimum window size, platform chrome, i18n undecided | filler pending | §6 structural decisions; record "no i18n" explicitly |

Contradictions resolved from source: the five a072e3d-era "built?" columns are superseded by `cli-commands.v2.md` (C1); the Prompter has five members, `secret` is gone (C2); inline the icons (C3); **the phase-2 gate binds shipping a `ui` verb and changing `setup` step 8, not designing a frontend against a data interface** — and the D23 row now carries a DECIDED amendment that "the app opens the UI" is a change to the wizard's last step, not a second implementation, the strongest sentence against a Rust rewrite (C4); `COMMUNITY_URL` is decided, the Issues page (C5); the hash rule above (C6).

Unverified and worth reproducing in M1: the 0-differing-pixel measurement could not be reproduced by the critic (no `playwright` package resolvable from the investigation directory); every design baseline was rendered against a 404 for `support.js`, which is harmless but should be known.

**The 3b26647 delta (after the readers ran):** IE3 landed — `eval --commit` pins the version, validates against `receiptSchema`, redacts, and lands exactly one file through safeWrite under guard row g (`src/commands/eval.ts:159-201`, `src/lib/guard.ts:9,46`); the README eval column renders the newest valid receipt per version, qualifying partial runs (`src/lib/readme.ts:171-184`); `provenance.engine_commit` is the product checkout's commit or `unknown` for npm installs; `ComparisonRow` gains an optional `swapped`. A `/terum-skills` wrapper skill with per-verb aliases was added (`.claude/skills/terum-skills/SKILL.md`) — it runs prompt-free verbs from a Claude Code session and hands prompting verbs to the terminal, because the Prompter refuses to ask without a TTY. npm latest is 0.1.3.
