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

=================== THE SPEC: .planning/specs/m7-S7f.md ===================
# m7-S7f: the `ls` / `search` skill payload, and the Library and Skill detail surfaces (CLI + app)

**Status:** LOCKED for implementation (M7 queue, batch 4 of tranche 1). Rows RM-49, RM-10, BM-08, RM-30, RM-02, RM-03, RM-38, RM-01, BM-01, BM-04, AD-21, AD-22. Approver named for information: Ryan. Depends on S7af (stack on `origin/codex/m7-S7af` while it is unmerged: the served-surfaces flag, `Result.value` on ok:false, print frames on a failing read, `--team` on every verb and the widened `SearchHit` all come from it).
**Sources (binding, in this order):** the takeover ledger (`.planning/decisions/2026-09-08-m7-takeover-decision-walk.md`; D2 hides favorites, D6 features mapping is S7q's, D7 categories read-only); the M7 document §4 S7f with its two verifier lenses (`.planning/research/2026-09-08-m7-close-the-canvas-gaps.md`), §10.2 BM-01/BM-04/BM-08 and §10.8 AD-21/AD-22; the costing §2 paragraphs for RM-49, RM-10, RM-30, RM-02, RM-03, RM-38, RM-01 (`.planning/research/2026-09-07-desktop-app-gap-costing.md`; grep `#### <id> `). Teddy's D-BM-4 = A: `declined` rides `ls member <handle>`. Anchors below were re-verified on `src/commands/ls.ts` and `src/commands/search.ts` (blob-identical since b5c0507); the code wins over a number.
**Governing rules:** root `AGENTS.md` (the CLI's invariants: safeWrite-only writes, the guard, consent on the normalised grant hash, the placements ledger); `desktop/AGENTS.md` (eight invariants); the North Star. Every new field is additive and `?? null` on the wire; `hello.protocol` stays 1; printed lines change only where this spec says (exactly one new `format()` segment).

## 0. What this batch is

The Library and the Skill detail page light from real data. The CLI's `ls` payload gains the fields every card and the detail page draw (description, grants + hash, installers, last-changed date, SKILL.md body, the project registry, a member's declined ids) and degrades per row instead of failing whole; `search` inherits the shared fields. The real adapter implements `library()` and `skill()` from `ls`, `ls project <name>`, `ls --local`, `status` and `validate`, flips those two surfaces on, and never invents what the CLI does not return.

## 1. CLI half (`src/commands/ls.ts`, `src/commands/search.ts`, `src/lib/readme.ts`, `src/lib/skills.ts`, `src/lib/schema.ts`, `src/lib/teamRepo.ts`)

### 1.1 RM-49 + BM-08 + RM-10: `listSkills` degrades per row and spawns one git child per listing
- Rewrite `listSkills` (ls.ts, `async function listSkills(team, people, clone, runner, io)`) to enumerate through `skillRecords(clone, teamName, { onProblem })` (the enumerator `search.ts` already uses; it skips a bad folder and refuses a folder whose frontmatter `name` differs from its directory), collecting `{ source: 'skills/<name>', message }` into `problems`. Keep the boundary: an unreadable `skills/` root still fails the whole verb (an empty team and an unreadable clone are never the same answer).
- The roster read at `const people = await readPeople(clone)` becomes per-file tolerant AT THE CALL SITE (never inside `readPeople`, whose other caller, `readReadmeData`, must stay fail-closed): read `people/*.json` one file at a time as `search.ts:37` does (`readPerson(clone, handle).catch(…)`), print one line per skipped file and add `{ source: 'people/<file>.json', message }` to `problems`. A skipped member's install counts are absent, not zero: the roster row for that handle is omitted and the PR body says so.
- Versions: add `export async function skillVersions(runner, clone, ref = 'HEAD'): Promise<Map<string, string>>` to `src/lib/teamRepo.ts` beside the private `skillTrees` reader (one `git ls-tree <ref>:skills`; wraps the private `Git` closure, never leaks its type; returns an empty map, never throws, when the ref has no `skills/` tree; a git failure surfaces with `requireGitResult`'s text `git ls-tree …:skills failed: <stderr>`). `listSkills` calls it ONCE; a skill absent from the map gets `latest: '—'`, `unresolved: true` and one printed line (the R11 ruling ls.ts already applies). The last-changed dates (§1.4) come from a bounded fan-out of at most 8 concurrent `git log` children (the `search.ts` chunk-of-eight idiom), so peak git concurrency for a listing is ≤ 9. Test with a runner spy asserting the peak in flight.
- `LsSkill` gains `unresolved: boolean` (mirrors `SearchHit.unresolved`); `LsResult` gains `problems: readonly { source: string; message: string }[]` (REQUIRED; all four success sites: the default listing, `showMember`, `showProject`, and `showLocal` which returns `[]`).

### 1.2 RM-30, RM-02, RM-03, RM-01: the fields
- `LsSkill` gains `description: string` (verbatim `frontmatter.description`, never printed), `grants: string | null` and `grantsHash: string | null` (`allowedTools()`'s normalised string and sha256 from the record's `grants`; `null` when malformed, which is the one case never hashed), `installedBy: readonly Installer[]` (RM-03: `export interface Installer { handle; displayName; scope; since }` and `export function installersById(people): Map<string, Installer[]>` in `src/lib/readme.ts` right after `installCounts`; one entry per install RECORD, oldest first, including archived people, while `installCounts` still counts a person once), `body: string | null` (RM-01: `parseSkillFrontmatter` returns `body: source.slice(match[0].length)`; `SkillRecord` carries `body`; `skillAtSource` in `install.ts` sets it from the source it parsed; `ls` carries it so the Skill detail's SKILL.md tab renders from the wire, `null` only when the record has none).
- `SearchHit` gains `description`, `grants`, `grantsHash`, `updated` and `unresolved` stays; `search.ts`'s `formatSkill({…})` literal is extended with every new REQUIRED `LsSkill` key so `npm run typecheck` holds (`installedBy: []`, `body: null`, `unresolved: hit.unresolved`, `updated: hit.updated`).

### 1.3 BM-01 and BM-04: the project registry and a member's declined ids
- `LsResult` gains `projects?: readonly { name: string; skills: readonly string[]; remotes: readonly string[]; [k: string]: unknown }[]` built right after `team.json` is parsed, codepoint-sorted by name (`readme.ts`'s precedent, not `localeCompare`), spreading each parsed entry's passthrough keys (so S7p's hand-maintained `description` survives), returned on the default, member and project forms; ABSENT (omitted, never `[]`) on `--local`.
- `LsResult` gains `member?: { handle: string; declined: Person['declined'] }` on `ls member <handle>` only (D-BM-4 = A), from the `member` already found; the printed `Installed:` line stays.

### 1.4 RM-38: `updated`
- `export async function latestChange(runner, clone, name): Promise<string>` in `src/lib/readme.ts` beside `latestTree`: `git log -1 --format=%cI -- skills/<name>`, an ISO-8601 committer date, `'—'` when the folder has no history (caught, one printed line, the row survives). `LsSkill.updated: string` and `SearchHit.updated: string`; `format()` gains EXACTLY ONE new segment (`; <updated>`) and no other; `search` inherits it through the shared formatter. The app half of RM-38 is deliberately narrow (verifier lens 2, point 3): the adapter maps `updated` onto a new nullable `SkillCard.updated: string | null`; NO sort is implemented and the "Recently updated" control stays the static label the board draws (recorded as a design fork in the PR body; the mock's cards get `updated: null`... no: the mock has no date; keep the field `null` on the mock too, pixel-neutral).

### 1.5 Spec text
Append the paste-ready paragraphs from the costing rows (RM-49, RM-10, RM-30, RM-02, RM-03, RM-38, RM-01) and §10.2 (BM-01, BM-04, BM-08) to `.planning/specs/2026-09-02-phase-1-build.md` at the sections each names (§6 `ls` bullet, §3 module map for `skillVersions`, §5.3 for the body). One commit, labelled as the §6 amendment; the spec is Ryan's and he is named in the PR body.

## 2. App half (`desktop/src/backend/tauri/index.ts`, `types.ts`, `mock/`, the two screens)

- **Schemas:** declare every new key on closed zod objects (`cliLs` with `roster`, `skills[]` incl. all §1 fields, `problems`, `projects?`, `member?`, `local?`; widen `cliSearch`). Never rely on passthrough for a key the seam reads.
- **AD-21 `library({scope})`:** `ls --team <team>` (or `ls project <name>` for a project scope; `ls --local` for `installed`; `status` for the team name and counts). Card mapping: `name`, `category`, `project` (the endorsement list: `Global` for a global endorsement, the project key, or `—`), `installs: \`${n} installs\``, `installsN`, `installed` (from `ls --local` placements), `desc` = `description`, `grants`… and the honest defaults the review fixed: `size: '—'`, `tokensK: 0` (no render site), `wlt: null`, `summary: null` (the chip then reads "Not evaluated" per PR #61), `favorite: false` (D2: hidden on the real adapter), `enabled: true` (placement is loading), `flags: []` except `broken` when `unresolved`, `updated` from the wire. `overview` renders from the counts the CLI returns (`skills` = rows, `installs` = sum of `installsN`, `evaluated: '—'`, meter zeros, attention `'—'`) with the two notes from PR #61 built from real numbers, never the fixture's literals. Title `${scope} · ${rows.length} of ${rows.length} skills`? No: the header subtitle rule from PR #61 is `${shown} of ${count} skills` where `count` is the team's skill count; both are real here (same number), fine. Flip `surfaces.library = true`.
- **AD-22 `skill({ref})`:** `ls` (the row), `ls --local` (installed, path), `status` (repo/origin), `validate <ref>` (bare pass/fail → `hygiene: []` plus the caption; per-check rows stay unavailable until S7m and render nothing), `body` → `skillMd` (split frontmatter/body as the mock does), `installedBy` → `users`/`used_by`, `grants` → the Quality chips (`grants_approved: ''`), `receipt: null` (lands the evals tab on "Not evaluated"), `history: []`, `activity: []`, `files: [ 'SKILL.md' ]`, `lines: null`-shaped: the seam's `SkillDetail` types `favorites`, `lines`, `files` as required numbers/arrays; make `favorites` and `lines` `number | null` on the seam and render nothing for `null` (the mock keeps its numbers); never default a required fabricable field to a number. Flip `surfaces.skill = true`.
- **Argv:** every read passes `--team <team>` (S7af rule; `selectTeam` would prompt on a multi-team config and `read()` fails on any ask). `ls --local` needs no team.
- **Mock:** `SkillCard.updated: null`, `SkillDetail.favorites/lines` stay numbers; strict `toEqual`s updated. Pixel-neutral: the 88 locked boards do not move.
- **Screens:** the Library and Skill screens must render every nullable slot as empty (`—` where the board draws a dash slot, nothing otherwise); remove any hard-coded caption that only the mock could satisfy (the Quality caption "passed on connect, 12 days ago" becomes "Hygiene checks · <pass|fail> on connect" from `validate`'s result, or is hidden when validate was not run).

## 3. Tests
- CLI: the `ls.test.ts` twins named in the costing rows (one malformed folder costs one row; one malformed people file costs one roster row; frontmatter/folder name mismatch reported and skipped; unreadable `skills/` root fails whole; `unresolved` + `problems`; description verbatim and the printed line unchanged except the `updated` segment; grants + hash with `null` for malformed; `installedBy` incl. two scopes for one person; `projects` in name order incl. a project with no skills, absent on `--local`; `member.declined` on `ls member`; runner spy for the concurrency bound). `search.test.ts`: description/grants/updated on hits; the shared format line gains exactly one segment. `src/lib/__tests__/readme.test.ts`: `installersById`, `latestChange` (date and `—`). `src/lib/__tests__/teamRepo.test.ts`: `skillVersions` (three cases in the costing). `src/lib/__tests__/schema.test.ts`: body after the closing `---` (CRLF and no trailing newline); `install.test.ts`: `skillAtSource` carries the source's body.
- App: `index.test.ts` (fake Bridge): `library()` and `skill()` mappings, every nullable null, `--team` on the argv, `surfaces` flips; the real-data proof `replay.test.ts` replays `.planning/codex-runs/m7-S7f/frames/{ls,ls-local,ls-project-terum,ls-member-mira,status,search}.jsonl` (recorded by the orchestrator from the fixture team against THIS branch's rebuilt CLI) through `library()` and `skill({ref:'deploy-check'})` and asserts the served DTOs carry the fixture's real description, grants, installers, updated date, body and project registry with no design constant.

## 4. Acceptance
Root: `npm run lint && npm run typecheck && npm test && npm run build` (baseline 1131 tests). Desktop: `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` (baseline 40 files / 514 tests plus S7af's additions). No Playwright, no git, no network, no installs. The orchestrator runs the 88-board fidelity gate, the route smokes and the real-data proof.

## 5. Out of scope
`ls --local` rows' `health`/`tracked`/`placement`/`shared` (S7g); `--host` (S7h); `status` fields (S7k); receipts (S7n); hygiene findings (S7m); favorites/follow (D2, hidden); any sort implementation for `updated` (design fork, recorded); `GAPS.md`/`FIDELITY.md`/`AGENTS.md` (describe in `openQuestions`).


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
