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

=================== THE SPEC: .planning/specs/m7-S7k.md ===================
# m7-S7k: the `status` read model, and the status footer + Settings surfaces (CLI + app)

**Status:** LOCKED for implementation (M7 queue, batch 6 of tranche 1). Rows RM-41, RM-48, RM-S1, TJ-12, BM-02, BM-03, BM-09, BM-10, RM-22, RM-07, AD-20, AD-24. Approver named for information: Ryan (the status rows, one approval for RM-41 + RM-48 per OD-4; RM-S1 the second paragraph) and Ajay (TJ-12) — a notification split, not a review split (the orchestrator merges, Decision 12). Depends on S7af (stack on `origin/codex/m7-S7af` while it is unmerged: `Result.value` on ok:false is what lets `status` report absent, foreign and incomplete clones at all).
**Sources (binding, in this order):** the takeover ledger D7 (categories are READ ONLY; TJ-12's write route stays refused; the row renders team.json's own array), D3 (nothing keys off `roles`), D9 (no timer, no native file check); the M7 document §4 S7k with both verifier lenses, §10.2 BM-02/BM-03/BM-09/BM-10 and §10.8 AD-20/AD-24 (§10.8 wins over lens 2's point 12: the surfaces flip in this PR with honest defaults for the fields other batches fill later); Teddy's D-BM-2 = A (tools = presence only, offline), D-BM-5 = A (one PR); the costing §2 paragraphs RM-41, RM-48, RM-S1, RM-22, RM-07. `src/commands/status.ts` and `src/lib/hook.ts` are blob-identical since b5c0507; anchors below were re-read on main after PR #61.
**Governing rules:** root `AGENTS.md`; `desktop/AGENTS.md`; the North Star. Every new field is `?? null`, never undefined (`JSON.stringify` drops undefined and the app could not tell "unset" from "older CLI"). The printed `status` block is unchanged line for line: every row here is a Result-only addition. `status` never prompts (verified: it only calls `io.print`); keep it so, because the adapter drives it through `read()`, which fails on any ask.

## 0. What this batch is

`status` returns everything the footer, the Onboarding join block and Settings ▸ Teams / Sync / This machine / Account draw and today invent: per team, `pending`, `syncedAt`, `policy`, `categories`, `clonePath`, `joinCommand` and `joinBlock`; machine-wide, the `ledger` (placements, approvals, shared) and the `identity` block; plus tool presence (`tools`). The app's real adapter implements `status()` and `settings()` from `status`, `ls --local` and `host_platform()`, flips both surfaces on, and renders every field another batch fills later as its honest absent value.

## 1. CLI half (`src/commands/status.ts`, `src/lib/hook.ts`, `src/lib/auth.ts`, `src/commands/sync.ts`, `src/commands/invite.ts`)

`TeamStatus` gains, per team (all initialised in the detail literal so every return carries a well-formed value):
- **RM-41 `pending`:** `pending: { op: 'install' | 'uninstall'; id: string; scope: Config['pending'][number]['scope']; version: string | null; started: string }[]` = `config.pending.filter(e => e.team === team)` (drop `team`, keep `version`), set BEFORE the `clone.state` branch (a broken clone must still report work in flight).
- **RM-48 `syncedAt: string | null`:** from a new `export async function stampedAt(storeRoot, team): Promise<string | null>` in `src/lib/hook.ts` beside `stampPath` (stat the stamp; `mtimeMs` as ISO; `null` on ENOENT; rethrow otherwise). Set BEFORE the clone is described. Takes the MTIME per the costed spec, not the file body. `stale` is untouched (placement and meaning). Reading rules for the app (verbatim into the PR body): the value is never rewritten (no skew correction); `null` does not mean "never synced" (`team leave` deletes the stamp); a non-empty `pending` beside an old `syncedAt` means the last run left work undone and the remedy is `sync`, not an error.
- **RM-S1 `policy: { publish: 'pr' | 'push'; skill_license: string } | null`:** `teamJson.policy` right after the existing `readTeam(clone)`; `null` for an absent, foreign, incomplete or unreadable clone (by construction).
- **TJ-12 `categories: string[] | null`** (Ledger D7: read-only): `teamJson.categories` from the same read; `null` follows `policy`'s rule. No guard change. Factual correction to carry: `misc` is the seventh member of the scaffolded list, not an eighth default.
- **BM-02 `clonePath: string | null`:** `store.teamClone(team)` assigned BEFORE `describeClone`, never inlined into the literal (a throw there would escape the per-team catch).
- **BM-03 `joinCommand: string | null; joinBlock: readonly string[] | null`:** split `slackBlock` in `src/commands/invite.ts` into an exported `joinLines(ownerRepo): readonly string[]` plus the byte-preserving wrapper (invite's stdout unchanged); set after `detail.repository` from `githubOwnerRepo(binding.remote)`; `null` on a generic-git remote. Test: `joinBlock.join('\n')` is byte-identical to `slackBlock('acme/team')` for a GitHub team.

`StatusResult` gains, machine-wide (declared beside `teams` ABOVE the try so the outer catch's return carries them too; filled right after the config read and BEFORE `--team` narrowing):
- **BM-09 `ledger: { placements: { path; id; team; version; scope; placed_at }[]; approvals: { id; grants: string /* the sha256 */; approved_at }[]; shared: { id; source; team }[] }`** from `config.placements`, `config.approvals`, `config.shared` (`fingerprint` omitted; the scope arm copied explicitly). RM-07's CLI half is superseded: additionally `export` the `approved(config, id, grants)` predicate in `src/commands/sync.ts` (one keyword) so the app's approval comparison and `sync`'s gate cannot diverge; no revoke verb.
- **BM-10 `identity: { default_handle; email; display_name; github } | null`** (each `string | null`; the outer `null` when login never ran), from the config.
- **RM-22 `tools: { git: boolean; gh: boolean }`** (D-BM-2: presence only, offline): add `export async function gitState(runner = systemRunner): Promise<{ installed: boolean }>` beside `ghState` in `src/lib/auth.ts` (`git --version` exit 0; false on non-zero or spawn error; never throws); `tools.gh` from `ghState(runner).installed`. No `gh auth status`, no `claude`.

Spec text: append the paste-ready paragraphs (RM-41+RM-48 as ONE §6 `status` paragraph, RM-S1, TJ-12's one sentence under D7, BM-02, BM-03, BM-09, BM-10, RM-22, RM-07's §5.4 clarification) to `.planning/specs/2026-09-02-phase-1-build.md` at the sections each names; never touch §12.

Existing assertions that change (verifier-named): `status.test.ts`'s whole-result `toEqual` on the zero-team case gains `ledger: { placements: [], approvals: [], shared: [] }`, `identity: null`, `tools`; the `status` stub in `src/__tests__/cli.test.ts` (typed by `CliVerbs`) gains the same; extend the `query()` helper in `status.test.ts` rather than touching §12's acceptance walk.

## 2. App half (`desktop/src/backend/tauri/index.ts`, `types.ts`, `mock/`, Shell/Footer/Settings screens)

- **Schema:** a closed `cliStatus` zod object declaring every field above (`.passthrough()` is forbidden for keys the seam reads; a plain `z.object` STRIPS unknown keys silently, so declare them). `status` is read through `read(['status', …])`; with S7af merged a failing `status` (any unreadable team) still delivers `value`, and the adapter must use it: `Result.ok === false` with `value` renders the served data plus the error line, never the bare error alone.
- **AD-20 `status()`:** `machine.os` from `host_platform()`, `machine.hostname: ''` (MC-03 is S7r's), `machine.gh_login: ''`, `me` from `identity` (`handle` = the team binding's handle, `name` = `display_name ?? ''`, `email ?? ''`), `teams[]` from `TeamStatus` (`name`/`key` = team, `handle`, `remote` = repository, `members` = memberCount, `skills` = sharedSkills, `clone` = clonePath, `last_sync` = syncedAt (formatted by the app's two spellings; the VALUE is never rewritten), `stamp` = syncedAt's ISO, `policy` mapped `'pr'` → "Pull request" / `'push'` → "Push" (the printed-string call from the BRIEF; record it) and `skill_license` → `license`, `categories`), `counts.Global` = rows under the global root of `ls --local`; OMIT `counts.Pushes/Updates/Alerts` and every project key (a `'0'` would be a claim). Flip `surfaces.status = true`.
- **AD-24 `settings()`:** from `ls --local` + `status` + `host_platform()`: `MACHINE`, `ME`, `TEAMS`, `TEAM_POLICY` (mapped as above), `PLACEMENTS` from `ledger.placements` (state/placed `'—'` until S7g), `PLACEMENTS_N` = its length, `APPROVALS` = `ledger.approvals` joined against the current grants hash only when `ls` carries `grantsHash` (S7f) else `[]`, `QUARANTINE []` (S7s), `SHARED` from `ledger.shared` (the seam's `SHARED` type is `never[]` today: widen it to the four-tuple the runtime parser expects and give the mock the fixture's rows), `LOCAL_UNSHARED []`, `HOOK.installed false` (S7l), `APP_VERSION` from the app's own package, `AGENT_CLI` `'—'`, `COMMUNITY` the fixture's link (a product constant, not data), `STORAGE` and `PINNED_N` `'—'`/`0`-shaped absent values (S7s), `CLI_VERSION` = `status.version`, `CLI_LATEST '—'` (S7e), `TEAM_POLICY.categories` from `categories`. Stop folding `catalog()` into the Settings screen's error path. Flip `surfaces.settings = true`.
- **Screens (pixel-neutral on the mock):** Settings ▸ Teams' Categories row renders `team.categories` (strings; the current JSX destructures `[name]` from ten `[key, icon, count]` tuples: change it to map strings; keep the chip geometry); its desc "From SKILL.md frontmatter; the list is admin-extendable." becomes "From team.json; an admin extends it by pull request." (Teddy's copy call recorded; the mock's fixture keeps the drawn list so the board holds — if that changes the locked board, keep the old string on the mock and the new one only when the data source is the real adapter is NOT allowed (no adapter-branching in components): put the sentence into the DTO as `TEAM_POLICY.categoriesNote` so both backends supply it). The three sync-freshness rules render as copy on Settings ▸ Sync (`null` → "No sync recorded on this machine"; pending → "Work left undone; run sync"). The Account gh row renders presence only ("git present / gh present" ticks from `tools`), never "signed in" (RM-45).
- **Footer:** identity from `me`; `—` for absent.

## 3. Tests
- CLI (`src/commands/__tests__/status.test.ts`, `src/lib/__tests__/hook.test.ts`, `src/lib/__tests__/auth.test.ts`, `src/commands/__tests__/sync.test.ts`, `src/commands/__tests__/invite.test.ts`): the costing rows' named cases (pending on an absent clone; none for a team without; version key carried; `stampedAt` ISO / null / future verbatim; syncedAt for absent, incomplete and foreign clones; policy and categories null when unreadable, no printed line; clonePath for a bad clone; joinBlock byte-identical to `slackBlock`; ledger full and empty; identity null vs values; `gitState` exit codes; `approved` exported and unchanged).
- App: `index.test.ts` with a fake Bridge replaying `.planning/codex-runs/m7-S7k/frames/{status,ls-local}.jsonl` (recorded by the orchestrator against this branch's rebuilt CLI): `status()` and `settings()` served DTOs carry the fixture's real handle, repository, member count, clonePath, policy `pr`, categories `[ops, engineering, debugging]`, ledger placement for deploy-check, identity `seed`, tools; `counts` has only `Global`; a failing status frame with value still serves teams. Screen tests for the categories row over strings and the sync copy. The real-data proof = that replay test.

## 4. Acceptance
Root: `npm run lint && npm run typecheck && npm test && npm run build`. Desktop: `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test`. No Playwright, no git, no network, no installs. The orchestrator runs the 88-board fidelity gate, route smokes and the replay.

## 5. Out of scope
`hook on|off` (S7l); storage bytes and quarantine (S7s); update advice (S7e); placements' health/tracked (S7g); a `doctor` verb; `gh auth status`; any write to team.json; `GAPS.md` (describe its re-anchor and the retired status/settings gap lines in `openQuestions`).


=================== STANDING CONSTRAINTS ===================
- Read the per-directory README for every subtree you touch before your first edit there (desktop/src/backend/tauri/README.md in particular).
- Gates: from desktop/, `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` (baseline on this branch: 45 files / 625 tests); for a CLI change also, from the repo root, `npm run lint && npm run typecheck && npm test && npm run build` (baseline 1131 tests). Report REAL counts.
- Recorded fixture frames from the CLI at main (status, ls, ls --local, ls member mira, ls project terum, search '') are in .planning/codex-runs/<batch>/frames/*.jsonl for your replay test. If your batch changes the CLI payload (S7k does: `status` gains fields), rebuild the CLI (`npm run build` at the root) and re-record: copy /Users/ryanliu/Documents/Terum/review-2026-09-08-desktop-blank-map/fixture.sh into your run record dir, set its CLI= line to <this worktree>/dist/index.js, run it with a fixture root INSIDE your run record dir (e.g. .planning/codex-runs/<batch>/fx; the git commands it runs act on that scratch fixture, not on this repository, and are allowed), then `printf '' | HOME=<fx>/home node <this worktree>/dist/index.js --frames <verb> [args] > frames/<verb>.jsonl` for each verb your surfaces read (run from inside <fx>/repo/seed; HOME on the node process); S7k reads `status` and `ls --local`. Commit nothing.
- No git on THIS repository (not even `git status`), no npm install, no network, no Playwright (`npx playwright …` will not launch here; say so, never fake a pixel result). node_modules and the generated fixture (design.json, tokens.css) are in place and must not be edited.
- Never edit GAPS.md, FIDELITY.md, AGENTS.md, README.md at desktop/ root, package.json, design.json, tokens.css, e2e/**, tools/**; put what those files would need into openQuestions. The root README.md is editable only when the spec says so.
- Never delete or weaken a test to make a suite pass; change an assertion only to the new truth and declare it in testsModified. No eslint-disable without a same-line reason. No test-only branches in components; screens never branch on the mock scenario.
- Every new field the real adapter maps is `?? null`, never undefined; every new key on a zod object is declared, never left to passthrough; the real adapter never renders a design constant, a sample value or a fabricated caption; a surface flips to served only when its read model is real.
- If the spec is ambiguous, record the question in openQuestions and implement the most conservative reading. Never resolve a design fork yourself.
- Do not commit. Do not push. Leave every change in the working tree, unstaged. Verify each write by reading the file back.
- Your final message must be the JSON report the output schema demands: status complete only if every spec item was implemented and the gates ran.
