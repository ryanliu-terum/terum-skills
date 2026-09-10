# SPEC — batch `w08-refresh-receipts` (Bugs.pdf W-08 "Does not see evals")

**Base commit: `9fb73e9`** (`ryanliu-terum/terum-skills`, `origin/main`, verified with
`git -C /home/teniroo/Projects/SSM/terum-skills rev-parse --short HEAD` → `9fb73e9`; it is the merge of PR #131
`feat/card-menu-actions`, and it already contains PR #132 `project create` / `projects` and PR #133).
Every file path and line number below was read at `9fb73e9` and every quoted line is verbatim from it.
You are implementing this alone, with no conversation context. Everything you need is in this document.

---

## Repo facts (read this before anything else)

- **Root: the CLI package `terum-skills`** (TypeScript, ESM, Node 22+, commander, zod, yaml, proper-lockfile
  4.1.2). Build: `npm run build` = `tsc -p tsconfig.build.json && node scripts/bundle-skill.mjs` → `dist/`
  (68 unbundled files today). Tests: vitest, collocated under `src/**/__tests__/`, bare-repo fixtures, no
  network. Gates: `npm run lint && npm run typecheck && npm test`.
- **Desktop: `desktop/`** — Vite 8 + React 19 + TypeScript strict + Tauri 2.11. The code style is deliberately
  dense (single-line components, no blank lines inside components) — **match the surrounding style.** Mock
  backend `desktop/src/backend/mock/`, real adapter `desktop/src/backend/tauri/` (`index.ts` ≈ 700 long lines,
  plus `bridge.ts`, `frames.ts`, `run.ts`, `prepare-run.ts`). Gates:
  `cd desktop && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e:routes`.
  `e2e:fidelity` needs the design canvas (`TERUM_DESIGN_DIR`), which you do not have; it skips, and the
  orchestrator runs it.
- **Rust shell `desktop/src-tauri/src/lib.rs`** spawns `node <entry> --frames <verb…>` per call (8-child cap,
  `CREATE_NO_WINDOW` on Windows, tracked children killed on window destroy). You cannot run cargo; the
  orchestrator runs `cargo check` for `aarch64-apple-darwin`, `x86_64-pc-windows-msvc` and
  `aarch64-pc-windows-msvc`.
- **Frame protocol:** `src/lib/frames.ts` (`FRAME_VERBS`, `FRAME_FEATURES`, the hello frame) and
  `docs/frame-protocol.md`. Frames are `hello | print | ask | progress | result` (down) and `answer | cancel`
  (up). `ProgressFrame { t:'progress'; step:string; current?:number; total?:number }` is declared but **no verb
  emits it yet** (`FRAME_FEATURES.progress = false`). The desktop `Frame` type for progress is
  `{t:'progress';done:number;total:number;label?:string}` — check `desktop/src/backend/tauri/frames.ts` for the
  translation before assuming anything about it. (This batch emits no progress frames.)
- **Prompter (`src/lib/prompt.ts`):** `interactive`, `channel?: 'terminal'|'frames'`, `confirm`, `text`,
  `select`, `print`. Exactly five members plus `channel`.
- **Config lives in `~/.terum/skills/`**: `config.json`, `run/app.json`, `run/terum.stamp`, team clones under
  `teams/<team>/`.
- **`node_modules` are pre-populated** in the worktree (root and desktop). `esbuild@0.28.2` is also present in the
  root `node_modules` (installed without saving), so a spec *may* add it to root `devDependencies` and the
  orchestrator syncs the lockfile afterwards. **Nothing else can be installed. This spec adds no dependency.**

**Codex constraints — restated, and they are absolute:**

- **No git commands at all** (not even `git status`). Do not commit, do not stage. Leave every change in the
  working tree, unstaged.
- **Do not run `npm install` or `npm ci`.** There is no network.
- **Never edit** `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`,
  `desktop/package.json`, `desktop/src/styles/tokens.css`, `desktop/src/fixtures/design.json` (generated), or
  anything under `.shots`. Root `package.json` may be edited **only** where a spec lists the exact edit — this
  spec lists none, so do not edit it.
- **Report gates honestly.** Real counts, real output. If a step cannot run in the sandbox, say so; never fake a
  result.
- Ambiguity → take the most conservative reading and record the fork in your report's `openQuestions`. Never
  resolve a design fork yourself. (§13 has already resolved every fork this batch contains.)

**Governing rules that bind decisions here** (each is cited again at the decision it binds):

- Root `CLAUDE.md`: correctness = spec + North Star, never cheapness; there is no attacker model (hostile-caller
  findings are out of scope); grep for existing code before writing new; **one active path per behaviour**.
- `AGENTS.md` invariants: nothing runs but laptops + the git host (shell out only to `git`/`gh`; platform tools
  only through the `Exec` seam in `src/lib/runner.ts`, and only for the `app` verb); every team-repo write goes
  through `safeWrite()`; guard = authorization; consent predicate on allowed-tools; provenance = the placements
  ledger; placement native/explicit; frontmatter legal; one path per behaviour.
- `desktop/AGENTS.md`'s **eight invariants — read the whole file.** The ones this batch touches: **1** the seam
  (nothing outside `src/backend/` touches Tauri or I/O; screens never branch on platform); **2** flags come from
  the CLI (`FEATURE_KEYS` in `desktop/src/backend/types.ts`, one consumer each, a false switch hides the
  control); **3** generated files are never hand-edited; **4** the fidelity oracle is read-only and its
  tolerances are fixed; **5** pixels come from the boards, and locked rows in `desktop/FIDELITY.md` must not move
  (this batch moves none); **6** the eval report is components over the receipt, never a derived statistic;
  **7** no shortcuts in tests or lint; **8** the gates and the sandbox.
- Teddy, 2026-09-09: **the real adapter serves ONLY real data** — no fixture literals, no plausible constants, an
  honest absent state; and every interaction the mock shows must exist on the real adapter.
- Decision ledgers under `.planning/decisions/`: `2026-09-08-desktop-app-cli-decision-walk.md` (D2 "no updater
  JSON", D5, D7, D8 app verb), `2026-09-08-m7-takeover-decision-walk.md` (**Decision 9 / S7w**: refresh after the
  app's own actions, on window focus, and via Sync now; **no timer, never a polling sync**),
  `2026-09-09-eval-button-decision-walk.md`. Do not re-litigate a LOCK; where this batch fills a case a ledger did
  not consider, §3 says so and cites the line.
- `desktop/GAPS.md` and `desktop/FIDELITY.md` are maintainer-owned: §10 tells the **orchestrator** what to write
  there; you never edit them.
- CI: `.github/workflows/ci.yml` (root gates), `desktop-ci.yml` (desktop gates, no cargo, no fidelity).
  Release: `release.yml`.

---

## 0. Summary

1. Add a CLI verb `refresh`: per configured team, `git fetch origin` + `git reset --hard origin/main` on the team
   clone under the existing per-clone writer lock, and nothing else — no placement, no prompts, no push, no sync
   stamp. It returns a per-team report and exits 0 whenever the query ran.
2. Advertise it: `FRAME_VERBS += 'refresh'`, `FRAME_FEATURES.refresh = true`, desktop `FEATURE_KEYS += 'refresh'`.
3. Teach the real desktop adapter to run it in the background — once on the first `hello` it sees, and on every
   window focus — throttled to one run per 60 s, single-flight, and to invalidate reads through the existing
   `notify('clone')` channel **only when a clone actually moved**.
4. Fix a second, independent defect with the same symptom: the Evals tab's "Not evaluated" branch drops the
   `HistoryRail`, so teammates' committed receipts for *earlier* versions render nowhere.
5. Why now: Teddy (Windows) cannot see evals Ryan and Ajay committed, because nothing in the desktop app has ever
   run `git fetch` on his team clone. Every team-derived surface (Library, Marketplace, Roster, Inbox, Evals) is
   served from a clone that only moves when the user personally runs a *write* verb.

---

## 1. Bugs / asks closed

| id | reporter's words (verbatim) | user-visible symptom |
|---|---|---|
| **W-08** | "Does not see evals [Ryan and Ajay have run evals on decision-walk, but I see none]" | The desktop app's Skill ▸ Evals tab for `decision-walk` renders the empty state **"Not evaluated"** although two teammates committed eval receipts for exactly the version the app is showing. Restarting the app, alt-tabbing away and back, and re-opening the tab all keep showing "Not evaluated" forever. |
| **W-08b** (second defect, same symptom, found during triage) | — (not separately reported; found by reproduction) | Even on a freshly fetched clone, if the skill has been edited since the last eval, `eval-report` returns N committed receipts in `history` with `latest: null`; the Evals tab then renders "Not evaluated" and **does not render the History rail**, so those N teammate runs are invisible. |

W-08b is included in this batch because it is one `if` away from the same file and produces the identical
user-visible sentence; shipping the fetch alone would leave Teddy hitting the same wall the first time anyone
edits `decision-walk` after today's evals.

---

## 2. Root cause — the evidence, copied in

### 2.1 `eval-report` reads the working tree of a clone that nothing ever fetches

`src/commands/evalReport.ts:30-35` at `9fb73e9`:

```ts
30    const clone = resolve(store.teamClone(teamName));
31    const record = await findSkill(clone, teamName, args.ref);
32    if (!record) return failure(`No skill named or identified by ${args.ref} exists in team ${teamName}.`);
33    const teamCurrent = await resolveVersion(clone, record.name, undefined, args.runner ?? systemRunner);
34    const root = join(clone, 'evals', record.id);
35    const currentDirectory = join(root, teamCurrent);
```

`resolveVersion(clone, name, undefined, runner)` is `src/lib/version.ts:22-23`:

```ts
22  const expression = `HEAD:skills/${name}`;
23  const result = await runner.run('git', ['rev-parse', '--verify', expression], { cwd: clone });
```

So `teamCurrent` is the tree hash of `skills/<name>` **at the local clone's HEAD**. This is the crucial subtlety:
a stale clone can report the *correct, current* version while holding none of the receipt files for it — there is
no version mismatch to notice, no warning, no error.

Missing receipt files are indistinguishable from "nobody evaluated it". `src/commands/receiptCheck.ts:92-96`:

```ts
92  export async function receiptFiles(directory: string): Promise<string[]> {
93    let names: string[];
94    try { names = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort(); }
95    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
96    return names;
97  }
```

and `subdirectories` in `src/commands/evalReport.ts:82-85` does the same for the history walk. Result:
`latestState: 'none'`, `latest: null`, `history: []`.

The verb's own contract says it will never fix this itself — `src/cli.ts:139` (first 130 characters of the line,
verbatim):

```ts
139  program.command('eval-report <skill>').description("Show a skill's committed eval receipts and this machine's local runs (read-only, no fetch)")…
```

and `docs/frame-protocol.md:78`:

> `eval-report <skill> [--team <team>]` is read-only: it reads the local clone and this machine's run tree without fetching, networking, or prompting.

### 2.2 Only three call sites ever move a clone forward

`src/lib/teamRepo.ts:471-493`:

```ts
471  export async function refreshClone(runner: Runner, clone: string, options: { label?: string; env?: NodeJS.ProcessEnv; lockStale?: number } = {}): Promise<void> {
…
477    await withCloneLock(clone, async (assertHeld) => {
478      for (const args of [['fetch', 'origin'], ['reset', '--hard', 'origin/main']]) {
479        assertHeld();
480        const result = await runner.run('git', args, { cwd: clone, env: options.env });
481        if (result.code !== 0) {
482          const stderr = (result.stderr || result.stdout).trim();
483          const message = `Could not refresh ${options.label ?? clone}: ${stderr}`;
484          if (args[0] === 'fetch') {
485            const origin = await runner.run('git', ['remote', 'get-url', 'origin'], { cwd: clone, env: options.env });
486            const copy = origin.code === 0 ? explainGitAccessFailure(origin.stdout.trim(), result.stderr) : null;
487            if (copy) throw new RemoteAccessError(message, stripRemoteCredentials(origin.stdout), stderr, copy);
488          }
489          throw new Error(message);
490        }
491      }
492    }, options);
493  }
```

Verify for yourself (this exact command was run at `9fb73e9` and produced exactly these four lines):

```
$ grep -rn "refreshClone" src/ --include=*.ts | grep -v __tests__
src/commands/eval.ts:83:    await refreshClone(runner, clone, { label: teamName });
src/commands/publish.ts:54:    await refreshClone(runner, clone, { label: team });
src/commands/sync.ts:155:        await refreshClone(runner, clone, { label: team, env: args.hook ? { GIT_TERMINAL_PROMPT: '0' } : {}, lockStale: args.lockStale });
src/lib/teamRepo.ts:471:export async function refreshClone(runner: Runner, clone: string, options: …
```

`install`, `connect`, `team join`, `profile`, `decline` and `invite` do not call it, but they all write through
`safeWrite()`, whose loop begins at `src/lib/teamRepo.ts:119-120`:

```ts
119      await requireGit(['fetch', 'origin']);
120      await requireGit(['reset', '--hard', 'origin/main']);
```

— which is why a *write* leaves the clone at the remote head **as of that write**, and why Teddy's clone was
parked exactly where his own `install` left it.

### 2.3 The app never runs any of those verbs on its own; "refresh on focus" only re-reads the same stale clone

`desktop/src/backend/tauri/index.ts:301-307, 366-368`:

```ts
301  /**
302   * How long a read verb's answer is shared across callers (BUGS.md L18/M24). One Library render used to spawn six CLI
303   * processes (three `status`, two `ls --local`, one `ls --team`); every read now goes through one process per argv per
304   * window. The window is short and cleared early on any mutation the app makes and whenever the window regains focus,
305   * so a change made in a terminal shows on the next look.
306   */
307  export const READ_CACHE_TTL_MS = 15_000;
…
366    const clearReads = () => { reads.clear(); };
367    if (typeof window !== 'undefined') window.addEventListener('focus', clearReads);
368    const notify = (...sources: ChangeSource[]) => { if (sources.length === 0) return; clearReads(); for (const source of sources) for (const listener of listeners) listener(source); };
```

`clearReads` empties a 15-second in-process memo. Nothing fetches. Combined with
`desktop/src/app/providers.tsx:18` (`refetchOnWindowFocus:true`), focusing the window re-spawns the *same* read
verbs against the *same* unfetched clone, forever.

**Measured (triage + two independent verifier reproductions, all three agreeing):** on a throwaway team built
under a `HOME` override with the real shipped CLI, a clone parked before the receipt commits gives

```
ok=True  latestState=none
versions={'placed':None,'teamCurrent':'2415ad8f…','evaluated':None}
history=[]   localRuns=0
```

where `teamCurrent` is byte-identical to the receipts' own `version` field. After a single
`git fetch origin && git reset --hard origin/main` and nothing else:

```
ok=True  latestState=ok  versions={…,'evaluated':'2415ad8f…'}
latest run_id=20260910T060851Z runner=ajayw36 verdict=NEUTRAL
history=[('20260910T060851Z','ajayw36'), ('20260910T053814Z','ryanliu-terum')]
```

**One fetch is the entire fix.** A no-op `git ls-remote` against the real GitHub remote from the reporter's
network measured 0.41 s / 0.44 s / 0.61 s over three runs.

### 2.4 The second defect

`desktop/src/screens/skill/SkillScreen.tsx:113` (one 9,014-character line; the relevant substring, verbatim):

```tsx
{s.latestState==='invalid'?<div className="evals-body"><CenteredState icon="alert" title="The newest receipt for this version is invalid" body={`${s.invalidReceiptFile??'The receipt file'} could not be read as a receipt. Older receipts are listed in History; none is shown in its place.`} {...(features?.runEvalInApp?{primary:'Run eval'}:{})} onPrimary={()=>param('dialog','run-eval')}/>{s.history.length?<HistoryRail history={s.history}/>:null}</div>:!s.receipt||!s.summary||!s.reportNumbers?<CenteredState icon="chart" title="Not evaluated" body={s.cases===undefined?"Run an eval to score this skill against a baseline with no skill.":"Run an eval to score this skill against a baseline with no skill. Three cases, three reps each, on this machine."} {...(features?.runEvalInApp?{primary:'Run eval'}:{})} secondary="How evals work" onPrimary={()=>param('dialog','run-eval')} onSecondary={()=>param('tab','skill')}><TerminalHint command={s.evalCommand}/></CenteredState>:
```

The `latestState === 'invalid'` branch ends with `{s.history.length?<HistoryRail history={s.history}/>:null}`.
The `!s.receipt||!s.summary||!s.reportNumbers` branch — which is what a skill edited after its last eval takes —
renders a bare `CenteredState` whose title asserts **"Not evaluated"** while `s.history` may hold N committed
teammate runs. Reproduced end to end by two verifiers on a *fresh* clone.

---

## 3. Decisions taken (every fork closed)

**DECISION 3.1 — A new top-level verb `refresh`, not a `--fresh` flag on the read verbs.** A fetch inside
`eval-report` / `ls` / `status` would break the published contract in two places (`src/cli.ts:139`,
`docs/frame-protocol.md:78`) and the "reads never mutate the clone" rule the codebase states in `src/commands/ls.ts:29`
(*"§6 read-only team inventory; it deliberately neither pulls nor prompts."*) and `:114`, and warns about at
`:226` (*"Team status is from local clones and may be stale; open endorsement requests are not checked."*). It would also break the read cache: `sharedRead` (`desktop/src/backend/tauri/index.ts:391`)
memoises by argv for 15 s, so a fetching read would fetch once per distinct argv and serialise unrelated screens
behind the writer lock. One primitive fixes Library, Marketplace, Roster, Inbox and Evals at once.

**DECISION 3.2 — Never run `sync` automatically.** Ledger `.planning/decisions/2026-09-08-m7-takeover-decision-walk.md`
Decision 9 (GATE) reads: *"Refresh after the app's own actions and on window focus, plus a Sync now button. No
native file check, no timer, never a polling sync."* The spec that implemented it, `.planning/specs/m7-S7r.md:40`,
gives the reason: *"NO timer, NO polling read, NEVER an automatic sync (an app-initiated sync writes the stamp and
suppresses the SessionStart hook for an hour)."* Since PR #119, `sync` additionally **commits and pushes** through
its auto-share pass (`src/commands/sync.ts:207-232`). A sync on focus would push. `refresh` avoids every one of
those: no stamp, no push, no prompts. **This fills a case the ledger did not consider (the data source is a cache
of a remote, so "refresh on focus" was implemented as "re-read the cache" and never became "refresh the cache").
It does not re-litigate a LOCK.**

**DECISION 3.3 — `refresh` never writes `run/<team>.stamp`.** The stamp means "this team is fully synced": it is
what `stampIsFresh` (`src/lib/hook.ts:171`, `STAMP_FRESH_MS = 60 * 60_000` at `:149`) uses to suppress the
SessionStart hook for an hour, and what `status.syncedAt` reports. `refresh` does no placement, no pending replay,
no auto-share and no reconcile, so writing the stamp would suppress a real `sync --hook` that still has work to
do. **Consequence, stated plainly and accepted:** Settings ▸ Sync keeps showing "No sync recorded on this machine"
until a real sync runs. That is the truth.

**DECISION 3.4 — No Rust change; `src-tauri/src/lib.rs` stays at five commands.** `.planning/specs/m7-S7ag.md:4`
records: *"Ledger D9: `lib.rs` stays at FIVE commands (`cli_spawn`, `cli_write`, `cli_kill`, `read_app_state`,
`host_platform`); no sixth command, no file watching, no timer."* Do not add, rename or remove a Tauri command.
The deferred native "stat `config.json` and `run/<team>.stamp`" command from D9's gate **stays deferred**: it
watches two *local* files, neither of which moves when a teammate pushes, so it does not solve W-08.

**DECISION 3.5 — No `setInterval`, no `setTimeout`, no timer of any kind, anywhere in this change.**
`desktop/src/app/refresh-policy.test.tsx:11-16` greps every non-test `src/**/*.ts(x)` for `/setInterval|refetchInterval/`
and `/setTimeout[\s\S]{0,200}(?:refetch|invalidateQueries)/` and fails the build on a hit. The throttle is a
`Date.now()` comparison. The fetch's own time bound lives in the CLI (`RunOptions.deadlineMs`).

**DECISION 3.6 — Capability discovery goes through BOTH `FRAME_VERBS` and `FRAME_FEATURES`, and the adapter gates
on `hello.features.refresh`.** `FRAME_VERBS` is forced: `src/lib/__tests__/frames.test.ts:182-191` (CP-19) asserts
`FRAME_VERBS` equals the set of non-hidden commander commands with action handlers **in both directions**, so a
public `refresh` missing from `FRAME_VERBS` fails, and `attemptedVerb` (`src/lib/frames.ts:49-58`) needs it to
label the result frame. `FRAME_FEATURES.refresh = true` is the discovery channel the adapter reads, matching the
precedent PR #132 set for `project create` / `projects` at `9fb73e9`; the adapter reads `hello.features` in ten
places and `hello.verbs` in none. `FEATURE_KEYS += 'refresh'` is required by cross-batch contract C2 (see §11);
its single consumer is the adapter itself, exactly like `localIdentity`, which is in `FEATURE_KEYS`
(`desktop/src/backend/types.ts:12`) and is read only at `desktop/src/backend/tauri/index.ts:510, 512, 528, 551,
597, 600, 637` and by no screen (verified with
`grep -rn localIdentity desktop/src --include=*.tsx --include=*.ts | grep -v 'backend/tauri\|backend/mock\|backend/types.ts\|fixtures\|\.test\.'`,
which returns nothing). Invariant 2's "every flag has exactly one consumer" is satisfied.

**DECISION 3.7 — `refresh` is public and documented, not hidden.** Forced by CP-19 (see 3.6): a
`{ hidden: true }` command in `FRAME_VERBS` fails that test in the other direction. It is also genuinely useful in
a terminal.

**DECISION 3.8 — No `Backend` seam method, no mock method, no screen calls `refresh`.** All of the refresh
machinery lives under `desktop/src/backend/tauri/`. This satisfies `desktop/AGENTS.md` invariant 1 (nothing
outside `src/backend/` learns about it) and guarantees the mock is byte-identical, so every locked fidelity board
is untouched *by construction*. **This deviates from the batch brief's line "Mock: features.refresh true;
`refresh()` resolves `{changed:false,...}` instantly".** The `features.refresh: true` half happens for free —
`desktop/src/backend/mock/index.ts:101` is `async features(){return Object.fromEntries(FEATURE_KEYS.map(key=>[key,true])) as Features;}`
— but a `Backend.refresh()` the mock must fake would put a fabricated `{changed:false}` on the mock path with no
consumer at all, and would be a seam method no screen calls. Do **not** add one.

**DECISION 3.9 — The launch trigger fires on the FIRST `hello` this adapter instance sees, and never again.**
Not on every run's hello. Two reasons. (a) Correctness: `sync`, `eval`, `publish`, `install`, `connect` and every
`safeWrite` verb already fetch, so piggybacking a refresh on their hello is pure waste and would report `busy`
while they hold the writer lock. (b) It keeps every existing adapter test's spawn count exactly as it is —
critically `desktop/src/backend/tauri/__tests__/features.test.ts:18-27`, whose second hello has **every**
`FEATURE_KEYS` entry `true` and which asserts `expect(f.spawns.map(s=>s.args)).toEqual([['connect'],['sync']])`
at `:26`. With the first-hello gate, that all-true hello is the *second* hello and triggers nothing.

**DECISION 3.10 — Focus is listened for on BOTH the DOM `focus` event and Tauri's
`getCurrentWindow().onFocusChanged()`.** Verified present in the pinned dependency:
`desktop/node_modules/@tauri-apps/api/window.d.ts:1299` declares
`onFocusChanged(handler: EventCallback<boolean>): Promise<UnlistenFn>`. Reason: `@tanstack/query-core`'s
`FocusManager` subscribes only to `visibilitychange` while the adapter's existing listener is only `focus`, and
it could not be verified from Linux whether WebView2 delivers a DOM `focus` to the page on app re-activation. The
shell's own event is authoritative; the DOM listener stays so browser dev and vitest keep working. Outside the
Tauri shell `getCurrentWindow()` throws synchronously, so the call is wrapped in `try/catch` with a written
reason.

**DECISION 3.11 — Throttle state is instance-scoped, never module-scoped.** `hello`, `reads`, `clearReads` and the
focus listener all live inside `createTauriBackend()` (`desktop/src/backend/tauri/index.ts:314-368`). Module-local
throttle state would be shared by every backend instance, which in vitest means every test in a file, making
spawn-count assertions order-dependent and unfalsifiable. `createRefreshPolicy(...)` is called once per backend
instance and owns all of its state.

**DECISION 3.12 — A newer backend instance retires the previous instance's window listeners.** Today
`window.addEventListener('focus', clearReads)` (`:367`) is registered per instance and never removed; a leaked
listener only clears a dead `Map`, which is harmless. Attaching a CLI spawn to it is **not** harmless: a retired
backend would spawn a child against a retired fake bridge on every later focus event in the same test file. One
module-level `retireWindowListeners` handle (idempotent, order-independent, a no-op in production where
`pickBackend()` returns a single module singleton at `desktop/src/backend/index.ts:9`) removes the previous
instance's DOM listener and unlistens its Tauri subscription. This is not "module-local throttle state"; it is a
single-window invariant.

**DECISION 3.13 — Invalidate only when a clone actually moved, and only after the reads that were in flight at
that moment have settled.** `notify('clone')` clears the memo and invalidates seven query prefixes
(`desktop/src/app/invalidation.ts:6`: `['library','skill','catalog','roster','inbox','receipts','status']`),
which re-spawns a full wave of reads. `desktop/src-tauri/src/lib.rs:28` caps children at
`MAX_CHILDREN: usize = 8` and a refused spawn is *not* silent — `lib.rs:66` returns
`"too many pending terum-skills processes (8); wait for one to finish"`, which reaches a read as `ok:false` and
renders a board's error state. Awaiting the currently-recorded read promises before notifying costs nothing
(already-settled entries resolve immediately), needs no timer, and closes the window in which a focus-driven wave
1 and an invalidation-driven wave 2 overlap. The refresh child itself is only ever the 7th of 8 (a Skill screen's
focus wave measured 6 processes), so it can never starve wave 1 on its own.

**DECISION 3.14 — `changed` is computed from HEAD movement **or** a dirty tracked tree before the reset.**
`git rev-parse HEAD` before and after covers the W-08 case. A `reset --hard` that restores a locally modified or
deleted tracked file without moving HEAD also changes what the read verbs see, so one
`git status --porcelain --untracked-files=no` before the refresh decides that case. `--untracked-files=no` is
load-bearing: `reset --hard` does not remove untracked files, so counting them would report `changed: true` on
every single refresh for a clone with one stray file, producing an invalidation storm every 60 s.

**DECISION 3.15 — `unreachable` is `RemoteAccessError` only; everything else is `error` with the git stderr in
`detail`.** `explainGitAccessFailure` (`src/lib/remote.ts:204-229`) recognises only "Repository not found",
"terminal prompts disabled", "Authentication failed", and SSH permission denials; an offline machine's
"Could not resolve host" and a deadline expiry both arrive as a plain `Error`. Do **not** widen the classifier —
it is shared code used by `sync` and `publish`, nothing renders these states today, and `detail` carries the full
stderr either way.

**DECISION 3.16 — `deadlineMs` bounds the **fetch**, not the lock wait.** The batch brief says "`deadlineMs` (C1,
owned here) bounds the lock wait"; **the code at `9fb73e9` wins**: the lock wait is already bounded at ≈3.75 s by
`acquireCloneLock` (`src/lib/teamRepo.ts:507`, `retries: { retries: 10, minTimeout: 50, maxTimeout: 500 }`), after
which it throws `CloneBusy`. The fetch is the only unbounded step. Worst case for one team is therefore
≈3.75 s + `deadlineMs`. Default `REFRESH_DEADLINE_MS = 20_000`.

**DECISION 3.17 — `refresh` passes `GIT_TERMINAL_PROMPT=0` and a non-interactive credential config through the
existing `options.env` seam, using `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` rather than adding a
`-c` argument.** `src/lib/runner.ts:39-40` already forces `GIT_TERMINAL_PROMPT: '0'` on every piped run, so a
*terminal* credential prompt cannot hang the child; Git Credential Manager on Windows can still raise a **GUI
dialog**, which a silent background verb must never do. Setting `credential.interactive=false` through the env is
a no-op for git itself if GCM ignores it (git ignores config keys it does not know), needs **zero** change to
`refreshClone`'s argument list, and therefore cannot conflict with the other batch editing that function.
`grep -rn "GIT_CONFIG" src/` at `9fb73e9` returns nothing, so there is no collision.

**DECISION 3.18 — The verb prints one line per non-refreshed team on a terminal and nothing over frames.**
Gated on `io.channel !== 'frames'` (`src/lib/prompt.ts:24`: `readonly channel?: 'terminal' | 'frames';`, and
`src/lib/frames.ts:159` sets `channel: 'frames'`). The result value's `detail` field carries the same facts, so a
program loses nothing.

**DECISION 3.19 — `notices: true` on the command registration.** It costs the app nothing: `src/index.ts:54` is
`const noUpdateCheck = frames || …` and `:55` builds `afterVerb` only when `process.stderr.isTTY && !noUpdateCheck`,
so a background refresh performs no npm registry probe.

**DECISION 3.20 — W-08b: render the History rail in the not-evaluated state ONLY when `s.history.length > 0`, and
keep today's copy verbatim when history is empty.** This is what keeps the locked board safe. The board that draws
this state is **`desktop/FIDELITY.md:28`**:

```
| SkillDetailNoReceipt | `#/skill/onboarding-tour?tab=evals` | locked | 0.0030 |  |
```

`#/skill/onboarding-tour` resolves to `design.DETAIL_NO_RECEIPT`, and the generated fixture at `9fb73e9` reports
(verified by reading `desktop/src/fixtures/design.json`):

```
DETAIL             receipt=object history=4
DETAIL_PARTIAL     receipt=object history=1
DETAIL_NO_RECEIPT  receipt=null   history=0
DETAIL_NOT_INSTALLED receipt=object history=4
```

`receipt: null` **and** `history: []`, so the `history.length > 0` guard leaves `SkillDetailNoReceipt`
pixel-identical. **No locked board moves. `desktop/FIDELITY.md` is not edited.** Additionally, the wrapper
`<div className="evals-body">` is added **only** on the history-non-empty path: `.evals-body` is
`display:flex;gap:24px;flex-grow:1;min-height:0;overflow:hidden`
(`desktop/src/screens/skill/skill.css`), so wrapping unconditionally would change the locked board's layout.

**DECISION 3.21 — `HistoryRail` gets a `showing?: boolean` prop defaulting to `true`.** With no receipt rendered,
nothing is "showing", so row 0 must not claim the `data-showing` highlight, the lift figure, or the `RowStrip` —
that is `desktop/AGENTS.md` invariant 6 working, not against it. The default `true` means **no existing call site
changes**. The footer caption is emitted as **one single expression producing one text node** in both branches, so
the locked boards that render the rail (`SkillDetailEvals`, `SkillDetailEvalsReport`, `SkillDetailPartial`,
`SkillDetail*`) keep a byte-identical DOM.

**DECISION 3.22 — `refreshLaunch()` clears the throttle but does not itself trigger a refresh.** A deep-link
relaunch is exactly the moment the clone may have moved (the user just did something in a terminal), so the
throttle must not suppress the next refresh — but triggering from inside `refreshLaunch()` would add a spawn to
existing tests (`desktop/src/backend/tauri/__tests__/run.test.ts:422, 430, 441`;
`desktop/src/backend/tauri/__tests__/share-settings.test.ts:102`) and the OS focus event that accompanies a
relaunch supplies the trigger anyway.

**DECISION 3.23 — A failed refresh is silent to the user in this batch.** It is recorded in the policy's `last()`
outcome for diagnosis; nothing renders it. The natural home for a visible line is Settings ▸ Sync, which is a
**locked** fidelity row (`desktop/FIDELITY.md:72`: `| SettingsSync | #/settings/sync | locked | 0.0030 |`), so it
needs a canvas redraw first. Recorded for the orchestrator in §10.

**DECISION 3.24 — Bare `refresh` on a machine with no configured team does no git work at all** and returns
`{ ok: true, value: { changed: false, teams: [] } }`. `Object.keys(config.teams)` is empty; the loop body never
runs. No adapter-side gate is needed.

---

## 4. Changes per file

> **Do not reformat any file.** Every edit below is an anchored substring replacement or an append. The desktop
> code style is deliberately dense (single-line components, no blank lines inside components) — match it.

### 4.1 `src/lib/teamRepo.ts` — add `RefreshOptions`, thread `deadlineMs` into the fetch

Current, lines 463-471 and 480 (verbatim):

```ts
463  /** The per-clone writer lock's path — the one safeWrite holds; `team leave` takes it before removing the clone. */
464  /**
465   * Bring a clone to `origin/main` the way safeWrite does — fetch, then hard reset. The clone is
466   * disposable state (§4.2), so a local `main` that drifted (a process killed between safeWrite's
467   * commit and its reset) heals here instead of wedging every later verb behind a fast-forward
468   * failure. Verb preflights (`publish`, `sync`) share this; `pull --ff-only` is never the right
469   * refresh for a clone we own (D5b, 2026-09-05 close-out walk).
470   */
471  export async function refreshClone(runner: Runner, clone: string, options: { label?: string; env?: NodeJS.ProcessEnv; lockStale?: number } = {}): Promise<void> {
…
480        const result = await runner.run('git', args, { cwd: clone, env: options.env });
```

**Edit A** — insert this block immediately **before** line 464's `/**` (i.e. between line 463 and line 464). The
text of the interface must be **byte-identical** to what the other batches write, because more than one batch
adds it and git merges identical additions cleanly:

```ts
/**
 * Cross-batch contract C1: the optional trailing options `refreshClone` accepts. `lockWaitMs`/`onWaiting` bound
 * and report the wait for the per-clone writer lock; `deadlineMs` bounds the fetch. A field a caller does not
 * use is accepted and ignored. Never change the positional parameters.
 */
export interface RefreshOptions { lockWaitMs?: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void; deadlineMs?: number }
```

**Edit B** — change the parameter type on line 471. Replace

```ts
export async function refreshClone(runner: Runner, clone: string, options: { label?: string; env?: NodeJS.ProcessEnv; lockStale?: number } = {}): Promise<void> {
```

with

```ts
export async function refreshClone(runner: Runner, clone: string, options: { label?: string; env?: NodeJS.ProcessEnv; lockStale?: number } & RefreshOptions = {}): Promise<void> {
```

**Edit C** — on line 480, give the **fetch step only** the deadline. Replace

```ts
        const result = await runner.run('git', args, { cwd: clone, env: options.env });
```

with

```ts
        // A hung fetch must not hold a child slot or the writer lock; the local reset needs no deadline.
        const result = await runner.run('git', args, { cwd: clone, env: options.env, ...(args[0] === 'fetch' ? { deadlineMs: options.deadlineMs } : {}) });
```

Behaviour to know, and do not be surprised by: `RunOptions.deadlineMs` (`src/lib/runner.ts:6`) with a defined
value flips `detached: true` for the git child on non-Windows (`src/lib/runner.ts:36`
`const grouped = options.deadlineMs !== undefined && platform() !== 'win32';`) so the whole fetch process group is
killed on expiry. That is desirable here and affects no existing caller, because only `refresh` passes it. On
expiry the runner resolves `{ code: 124, stderr: 'terum-skills: git fetch exceeded 20 s' }`
(`src/lib/runner.ts:90`), which `refreshClone` turns into a plain `Error`, i.e. state `'error'`.

**Nothing else in `teamRepo.ts` changes.** `withCloneLock` and the `assertHeld()` re-check before the reset are
already exactly right for a background caller.

### 4.2 `src/commands/refresh.ts` — NEW FILE (complete contents)

```ts
/**
 * §6: the one verb that only moves a team clone forward — fetch, then hard reset to origin/main, under the
 * per-clone writer lock, and nothing else. No placement, no pending replay, no auto-share, no push, no prompt,
 * and deliberately NO `run/<team>.stamp` write: the stamp means "fully synced" (src/commands/sync.ts, and
 * stampIsFresh in src/lib/hook.ts suppresses the session hook for an hour), which a fetch does not earn.
 *
 * It exists because every read verb is contractually fetch-free, so a teammate's committed receipt reaches this
 * machine only when someone runs a write verb. The desktop app calls this in the background on launch and on
 * window focus (Bugs.pdf W-08). A per-team failure is never a process failure: `ok` is false only when the
 * config itself cannot be read or `--team` names a team that is not configured.
 */
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import type { WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { normalizeRemote } from '../lib/remote.js';
import { fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import { CloneBusy, type CloneState, describeClone, refreshClone, RemoteAccessError } from '../lib/teamRepo.js';

export interface RefreshArgs extends WithForm {
  /** Absent means every configured team. */
  team?: string;
  config?: ConfigStore;
  runner?: Runner;
  /** Test knob: the clone lock's stale window in ms (mirrors SyncArgs.lockStale). */
  lockStale?: number;
  /** How long the fetch may run before it is killed; default REFRESH_DEADLINE_MS. */
  deadlineMs?: number;
}
export type RefreshState = 'refreshed' | 'busy' | 'unreachable' | 'no-clone' | 'error';
export interface RefreshTeam {
  team: string;
  state: RefreshState;
  /** True when this refresh changed what the read verbs see: HEAD moved, or a dirty tracked tree was reset. */
  changed: boolean;
  /** HEAD after the attempt, or null when it could not be read. */
  head: string | null;
  /** This CLI's own explanation for a state other than 'refreshed'. */
  detail?: string;
}
export interface RefreshResult { changed: boolean; teams: RefreshTeam[] }

/** A fetch that has not finished in this long is killed; a background caller must never wedge (W-08). */
export const REFRESH_DEADLINE_MS = 20_000;
/**
 * git already runs without a terminal prompt for piped runs (lib/runner.ts), but Git Credential Manager can raise
 * a GUI dialog on Windows for an expired credential, which a silent background verb must never do. Passed as
 * config through the environment so refreshClone's argument list is untouched; git ignores keys it does not know.
 */
const NON_INTERACTIVE_GIT: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.interactive', GIT_CONFIG_VALUE_0: 'false' };

export async function run(args: RefreshArgs, io: Prompter): Promise<Result<RefreshResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const config = await store.read();
    const runner = args.runner ?? systemRunner;
    const deadlineMs = args.deadlineMs ?? REFRESH_DEADLINE_MS;
    // selectTeam is the one place ambiguity is decided; an unknown --team is the only per-team failure that
    // fails the whole run, exactly as every other verb behaves.
    const names = args.team === undefined ? Object.keys(config.teams) : [selectTeam(config.teams, args.team, args.form)[0]];
    const teams: RefreshTeam[] = [];
    for (const team of names) {
      const binding = config.teams[team]!;
      const clone = store.teamClone(team);
      const described = await describeClone(clone, normalizeRemote(binding.remote), runner);
      // Never repair and never re-clone: `sync` and `team join` own repair, and this verb runs unattended.
      if (described.state !== 'ok') { teams.push({ team, state: 'no-clone', changed: false, head: null, detail: cloneDetail(described) }); continue; }
      const before = await headOf(runner, clone);
      const wasDirty = await hasTrackedChanges(runner, clone);
      try {
        await refreshClone(runner, clone, { label: team, env: NON_INTERACTIVE_GIT, lockStale: args.lockStale, deadlineMs });
        const after = await headOf(runner, clone);
        teams.push({ team, state: 'refreshed', changed: wasDirty || before !== after, head: after });
      } catch (error) {
        // A background caller must never surface an error board for one team, and the clone it failed on is
        // still readable: report what happened and keep going. Re-read HEAD so the report is not a guess.
        const head = await headOf(runner, clone);
        if (error instanceof CloneBusy) teams.push({ team, state: 'busy', changed: false, head, detail: error.message });
        else if (error instanceof RemoteAccessError) teams.push({ team, state: 'unreachable', changed: false, head, detail: [error.stderr, error.explanation].filter(Boolean).join('\n') });
        else teams.push({ team, state: 'error', changed: false, head, detail: error instanceof Error ? error.message : String(error) });
      }
    }
    // A program reads `detail`; only a person needs the line, and a program's channel must stay result-only.
    if (io.channel !== 'frames') for (const outcome of teams) if (outcome.state !== 'refreshed') io.print(`${outcome.team}: not refreshed (${outcome.state})${outcome.detail ? ` — ${outcome.detail}` : ''}`);
    return success({ changed: teams.some((outcome) => outcome.changed), teams });
  } catch (error) { return fromError(error); }
}

function cloneDetail(state: Exclude<CloneState, { state: 'ok' }>): string {
  return state.state === 'absent' ? 'no clone for this team on this machine'
    : state.state === 'foreign' ? `the folder is a clone of ${state.origin}`
    : `the clone is incomplete (${state.reason})${state.error ? `: ${state.error}` : ''}`;
}

/** HEAD as a full sha, or null when the clone has no readable HEAD. Never throws: a report, not a gate. */
async function headOf(runner: Runner, clone: string): Promise<string | null> {
  try {
    const result = await runner.run('git', ['rev-parse', 'HEAD'], { cwd: clone });
    const sha = result.stdout.trim();
    return result.code === 0 && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
  } catch { return null; }
}

/**
 * Tracked modifications the hard reset will discard. Untracked files are excluded on purpose: `reset --hard`
 * leaves them, so counting them would report `changed` on every refresh of a clone holding one stray file.
 */
async function hasTrackedChanges(runner: Runner, clone: string): Promise<boolean> {
  try {
    const result = await runner.run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: clone });
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch { return false; }
}
```

**Hard constraint on this file:** no line may contain the literal string `terum-skills`.
`src/lib/__tests__/invocation-tripwire.test.ts:7-23` inventories **every** line under `src/` (excluding
`__tests__`) that contains `terum-skills` and asserts the set equals `src/lib/__tests__/invocation-catalog.ts`
exactly. Adding an uncatalogued line fails `npm test`. The file above obeys this; keep it that way.

### 4.3 `src/cli.ts` — register the verb

Three anchored edits, each substring is unique in the file at `9fb73e9`.

**Edit A (import).** Insert after line 30 (`import { run as runReceiptCheck } from './commands/receiptCheck.js';`):

```ts
import { run as runRefresh } from './commands/refresh.js';
```

**Edit B (`CliVerbs`, line 39).** Replace the substring

```ts
receiptCheck?: typeof runReceiptCheck; }
```

with

```ts
receiptCheck?: typeof runReceiptCheck; refresh?: typeof runRefresh; }
```

**Edit C (`active`, line 42).** Replace the substring

```ts
receiptCheck: verbs.receiptCheck ?? runReceiptCheck }
```

with

```ts
receiptCheck: verbs.receiptCheck ?? runReceiptCheck, refresh: verbs.refresh ?? runRefresh }
```

**Edit D (registration).** Cross-batch contract C3: new top-level commands are registered **after** `decline`.
Insert immediately after line 172 (the `.action(...)` line of the `decline` command) and before line 173
(`  return program;`):

```ts
  program.command('refresh')
    .description('Fetch each team clone to origin/main and nothing else: no placement, no prompts, no push, and no sync stamp')
    .addOption(new Option('--team <team>', 'configured team (required when more than one exists)').hideHelp())
    .action(async (options: { team?: string }) => execute((io) => active.refresh({ ...options, form: context.form }, io), { verb: 'refresh', notices: true }));
```

`Option` is already imported at `src/cli.ts:7`. The description contains no `terum-skills` literal, so
`invocation-catalog.ts` needs no new entry.

### 4.4 `src/lib/frames.ts` — advertise the verb and the feature

**Edit A (line 32, `FRAME_VERBS`).** Contract C2: append at the END. Replace the unique substring

```ts
'app', 'profile', 'decline'] as const;
```

with

```ts
'app', 'profile', 'decline', 'refresh'] as const;
```

**Edit B (lines 39-44, `FRAME_FEATURES`).** Contract C2: append at the END. Replace the unique substring

```ts
  disablePerMachine: false, projectMembers: false, liftOnCards: false, runEvalInApp: true, perCase: false, progress: false,
```

with

```ts
  disablePerMachine: false, projectMembers: false, liftOnCards: false, runEvalInApp: true, perCase: false, progress: false,
  refresh: true,
```

(Note: that same substring also appears once in `src/lib/__tests__/frames.test.ts:38` — see §7.1 Edit A; make
sure you edit both files, and only those two.)

### 4.5 `docs/frame-protocol.md` — document the feature key and the verb

**Edit A.** `docs/frame-protocol.md:72` currently begins:

```
`hello.features` names `favorites`, `follow`, `roles`, `lastSeen`, `installScope`, `inviteScoping`, `disablePerMachine`, `projectMembers`, `liftOnCards`, `runEvalInApp`, `perCase`, `progress`, `memberRole`, `localIdentity`, `checkouts`, and `projects`.
```

Replace `` `checkouts`, and `projects`. `` with `` `checkouts`, `projects`, and `refresh`. `` so the sentence
reads `…, `localIdentity`, `checkouts`, `projects`, and `refresh`.`, and append this sentence at the very end of
that same paragraph (line 72), after the existing final sentence
`` `installScope` is true: install destinations and destination-aware removal are available. ``:

```
`refresh` is true and means the `refresh` verb exists: a shell may fetch each team clone to `origin/main` in the background without running `sync`, so a teammate's committed work becomes visible to the read verbs.
```

This is required by `src/lib/__tests__/frames.test.ts:193-198` (CP-19), which reads the line beginning
`` `hello.features` names `` and asserts every key of `FRAME_FEATURES` appears in it wrapped in backticks.

**Edit B.** Append to the "Verbs added for the desktop app" section (after the last `eval-report` bullet, i.e.
after line 83):

```markdown

`refresh [--team <team>]` moves each configured team clone to `origin/main` — `git fetch origin` then
`git reset --hard origin/main`, under the same per-clone writer lock every write verb takes — and does nothing
else: no placement, no pending replay, no auto-share, no push, no question, and **no `run/<team>.stamp` write**
(the stamp means "fully synced" and still belongs to `sync` alone). The clone is disposable state, so a local
commit in it is discarded by the reset. `result.value` is:

- `changed: boolean` — true when at least one clone moved.
- `teams`: one row per team as `{ team, state, changed, head, detail? }`. `state` is `refreshed` (the fetch and
  reset ran), `busy` (another process holds that clone's writer lock — that process is itself fetching),
  `unreachable` (a recognised remote access failure), `no-clone` (nothing at the path, an incomplete clone, or a
  clone of a different remote — never repaired here), or `error`. `head` is HEAD after the attempt or null;
  `detail` is this CLI's own explanation for any state other than `refreshed`.

Exit code is 0 whenever the query ran: a per-team failure is reported in its row, never as a process failure.
Over frames the verb emits only `hello` and `result`.
```

### 4.6 `README.md` — one row in the verb table

Insert immediately after line 74 (the `sync` row, which reads
`` | | `sync` | Pull, finish pending installs, mirror connected edits, refresh placed copies | ``):

```
| | `refresh` | Fetch the team clone to `origin/main` and nothing else — no placement, no sharing, no stamp; the desktop app runs it in the background so a teammate's committed work becomes visible |
```

### 4.7 `desktop/src/backend/types.ts` — append the feature key

Contract C2: append at the END of `FEATURE_KEYS` (line 12). Replace the unique substring

```ts
'checkouts','projects'] as const;
```

with

```ts
'checkouts','projects','refresh'] as const;
```

Nothing else in this file changes. `desktop/src/backend/mock/index.ts:101` already answers `true` for every
`FEATURE_KEYS` entry, so the mock needs **no edit at all**.

### 4.8 `desktop/src/backend/tauri/refresh.ts` — NEW FILE (complete contents)

Contract C4: w08's new adapter logic lives in its own module.

```ts
/**
 * W-08: teammates' commits reach this machine only through a fetch, and every CLI read verb is contractually
 * fetch-free. The adapter therefore runs the CLI's own `refresh` verb — the smallest thing that fetches and does
 * nothing else — once when it first learns the CLI has it, and whenever the window regains focus: in the
 * background, at most once a minute, one at a time, never blocking a render, and invalidating reads only when a
 * clone actually moved (ledger D9: after the app's own actions and on focus, never on a timer).
 *
 * There is no timer here on purpose: desktop/src/app/refresh-policy.test.tsx greps production source for
 * setInterval/setTimeout-driven refetches. The throttle is a clock comparison; the fetch's time bound is the
 * CLI's own `deadlineMs`.
 */
import { z } from 'zod';
import type { Result } from '../types';

/** The CLI's `refresh` result (terum-skills src/commands/refresh.ts). Only the fields the adapter reads. */
export const cliRefresh = z.object({
  changed: z.boolean(),
  teams: z.array(z.object({
    team: z.string(),
    state: z.enum(['refreshed', 'busy', 'unreachable', 'no-clone', 'error']),
    changed: z.boolean(),
    head: z.string().nullable(),
    detail: z.string().optional(),
  })),
}).passthrough();
export type CliRefresh = z.infer<typeof cliRefresh>;

/** One background refresh a minute, at human alt-tab rhythm; a real fetch costs about half a second. */
export const REFRESH_MIN_INTERVAL_MS = 60_000;

/** The last attempt, kept for diagnosis. Nothing renders it today (a visible line needs a canvas redraw). */
export interface RefreshOutcome { at: number; state: 'refreshed' | 'skipped' | 'failed'; detail?: string }

export interface RefreshPolicyOptions {
  /** Runs the `refresh` verb once and settles; it is driven read-only, so it never answers a question. */
  run(): Promise<Result<CliRefresh>>;
  /** Whether this CLI has the verb: `hello.features.refresh`. A CLI without it is never spawned for one. */
  supported(): boolean;
  /** Called after a refresh that moved a clone. Awaited, so the caller may settle in-flight reads first. */
  onChanged(): Promise<void> | void;
  minIntervalMs?: number;
  now?: () => number;
}

export interface RefreshPolicy {
  /** Fire and forget: at most one run in flight, at most one per interval, never throws. */
  trigger(): void;
  /** Clear the throttle so the next trigger runs (a deep-link relaunch is exactly that moment). */
  reset(): void;
  last(): RefreshOutcome | null;
  /** Resolves when the in-flight run, if any, has settled. Used by tests; harmless in production. */
  settled(): Promise<void>;
}

export function createRefreshPolicy(options: RefreshPolicyOptions): RefreshPolicy {
  const interval = options.minIntervalMs ?? REFRESH_MIN_INTERVAL_MS;
  const clock = options.now ?? (() => Date.now());
  let lastAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | undefined;
  let last: RefreshOutcome | null = null;
  const trigger = (): void => {
    if (inFlight) return;
    if (!options.supported()) return;
    const at = clock();
    const elapsed = at - lastAt;
    // A clock that jumped backwards (a system time change) must not wedge the throttle: only a
    // forward-and-recent last attempt suppresses this one.
    if (elapsed >= 0 && elapsed < interval) return;
    lastAt = at; // set before the spawn: a failing refresh must not retry-storm on every focus event
    inFlight = (async () => {
      const result = await options.run();
      if (!result.ok) { last = { at, state: 'failed', detail: result.error }; return; }
      const failures = result.value.teams.filter((team) => team.state !== 'refreshed');
      last = failures.length
        ? { at, state: 'skipped', detail: failures.map((team) => `${team.team}: ${team.state}${team.detail ? ` — ${team.detail}` : ''}`).join('; ') }
        : { at, state: 'refreshed' };
      if (result.value.changed) await options.onChanged();
    })().catch((error: unknown) => {
      // A background refresh has no user-facing surface and must never reject into the caller's focus handler
      // or leave an unhandled rejection: the failure is recorded and the next focus tries again.
      last = { at, state: 'failed', detail: error instanceof Error ? error.message : String(error) };
    }).finally(() => { inFlight = undefined; });
  };
  return { trigger, reset: () => { lastAt = Number.NEGATIVE_INFINITY; }, last: () => last, settled: async () => { await inFlight; } };
}
```

### 4.9 `desktop/src/backend/tauri/index.ts` — wire it (contract C4: fewest possible lines)

**Edit A (imports).** Add after line 21 (`import { scannedRoots } from './scanned-roots';`):

```ts
import { cliRefresh, createRefreshPolicy } from './refresh';
```

**Edit B (module scope).** Insert immediately after line 311 (the closing `}` of `readReason`, before the two
blank lines and `export function createTauriBackend`):

```ts
/** One app window, one adapter. A second instance (tests construct many) retires the first instance's window
 *  listeners, so a retired backend can never spawn a CLI child on a later focus event. */
let retireWindowListeners: (() => void) | undefined;
```

**Edit C (replace the focus listener).** Line 367 currently reads:

```ts
  if (typeof window !== 'undefined') window.addEventListener('focus', clearReads);
```

Delete that whole line (it is replaced by the block below, which still calls `clearReads()` on focus, so
`read-cache.test.ts`'s "window focus clears it" assertion keeps passing). Then, immediately **after** the
`const notify = (...sources: ChangeSource[]) => …;` line (line 368 before your deletion, 367 after it — anchor on
the text, not the number), insert:

```ts
  // W-08: reads never fetch (src/cli.ts eval-report, docs/frame-protocol.md), so a teammate's committed receipt
  // reaches this machine only when something runs `refresh`. Reads are invalidated only when a clone moved, and
  // only after the reads already in flight have settled: notify('clone') re-spawns seven query prefixes and the
  // shell caps concurrent CLI children at eight (src-tauri/src/lib.rs).
  const refreshPolicy = createRefreshPolicy({
    supported: () => hello?.features.refresh === true,
    run: () => read(run(['refresh'], cliRefresh, value => value, [])),
    onChanged: async () => { await Promise.allSettled([...reads.values()].map(entry => entry.promise)); notify('clone'); },
  });
  const onWindowFocus = () => { clearReads(); refreshPolicy.trigger(); };
  retireWindowListeners?.();
  let retired = false; let unlistenNativeFocus: (() => void) | undefined;
  if (typeof window !== 'undefined') window.addEventListener('focus', onWindowFocus);
  // The shell's own focus event is authoritative: a WebView may not deliver a DOM `focus` to the page when the
  // app is re-activated. Outside the Tauri shell (browser dev, vitest) getCurrentWindow() throws or its IPC
  // rejects, and the DOM listener above is then the only trigger — which is correct there.
  try { void getCurrentWindow().onFocusChanged(({ payload }) => { if (payload && !retired) onWindowFocus(); }).then(stop => { if (retired) stop(); else unlistenNativeFocus = stop; }, () => undefined); }
  catch { /* Not inside the Tauri shell: there is no window event to subscribe to, and nothing to clean up. */ }
  retireWindowListeners = () => { retired = true; if (typeof window !== 'undefined') window.removeEventListener('focus', onWindowFocus); unlistenNativeFocus?.(); };
```

`run` is a function declaration at `:371` and `read` is a module-level function at `:699`; both are hoisted, and
`refreshPolicy.trigger()` only ever runs after construction, so the references are safe.

**Edit D (the launch trigger).** Line 318 currently reads:

```ts
  const onHello = (frame: Extract<CliFrame, { t: 'hello' }>) => { hello = frame; };
```

Replace it with:

```ts
  // The launch refresh: the FIRST hello is where this adapter learns whether the CLI has `refresh` at all. Later
  // hellos are not triggers — every verb that produces one (sync, eval, publish, install, connect) already
  // fetched. Scheduled as a microtask so it never re-enters run()/cwd() from inside the frame loop.
  const onHello = (frame: Extract<CliFrame, { t: 'hello' }>) => { const first = hello === null; hello = frame; if (first) void Promise.resolve().then(() => { refreshPolicy.trigger(); }); };
```

**Edit E (`refreshLaunch`).** Lines 482-489 currently read:

```ts
482    async refreshLaunch() {
483      await launchListenerReady;
484      stateOnce = undefined;
485      if (hello === null) { featuresOnce = undefined; hello = null; }
486      generation++;
487      clearReads();
488      return backend.launchContext();
489    },
```

Insert `refreshPolicy.reset();` immediately after line 487's `clearReads();`, so the block becomes:

```ts
    async refreshLaunch() {
      await launchListenerReady;
      stateOnce = undefined;
      if (hello === null) { featuresOnce = undefined; hello = null; }
      generation++;
      clearReads();
      // A relaunch is a terminal action landing: the throttle must not hide what it just changed.
      refreshPolicy.reset();
      return backend.launchContext();
    },
```

**Nothing else in `index.ts` changes.** In particular: do not touch `skill()` (`:573`), `evalReport()` (`:604`),
`sharedRead` (`:391`), `cached` (`:404`) or the `Backend` object's method list.

### 4.10 `desktop/src/backend/tauri/README.md` — one bullet

Insert after the `run.ts` bullet (line 8), keeping the existing style:

```markdown
- `refresh.ts`: the background clone refresh (W-08). `createRefreshPolicy()` runs the CLI's `refresh` verb once at launch and on window focus, throttled to one run a minute, single-flight, and invalidates reads through `notify('clone')` only when a clone actually moved. No timer, no seam method, no mock counterpart.
```

### 4.11 `desktop/src/components/domain/EvaluationReport.tsx` — `HistoryRail` gains `showing`

Line 19 currently reads (verbatim, one line):

```tsx
export function HistoryRail({history}:{history:SkillDetail['history']}){return <aside className="history-rail"><SectionLabel trailing={<Small>{history.length} run{history.length===1?'':'s'}</Small>}>History</SectionLabel><div className="board-column" style={{gap:2}}>{history.map((h,i)=><div key={h.when+h.version+':'+i} className="history-row" data-showing={i===0||undefined}><div><span>{h.when}</span>{i===0?<span className="history-figure" style={{color:token(!h.summary||h.summary.partial?'text2':verdictToken(h.summary).fg)}}>{liftLabel(h.summary)}{h.summary?.partial?<span style={{fontWeight:400,marginLeft:4}}>{h.summary.partial.join('/')}</span>:null}</span>:null}</div><span className="board-mono history-meta">{h.runner} · {h.version}</span>{h.local?<Small>· local, not committed</Small>:null}{i===0?<RowStrip rows={h.rows}/>:null}</div>)}</div><Small>One row per committed run, newest first, across versions. The page renders the latest run for this version; older runs are listed, never compared or merged.</Small></aside>;}
```

Replace it with (one line; four changes — the signature, `data-showing`, the two `i===0` gates, and the caption
turned into a single ternary expression so it stays one text node):

```tsx
/** `showing` is false when the page renders no receipt: no row is the one on screen, so row 0 must not claim the highlight, the lift figure or the round strip (AGENTS invariant 6). */
export function HistoryRail({history,showing=true}:{history:SkillDetail['history'];showing?:boolean}){return <aside className="history-rail"><SectionLabel trailing={<Small>{history.length} run{history.length===1?'':'s'}</Small>}>History</SectionLabel><div className="board-column" style={{gap:2}}>{history.map((h,i)=><div key={h.when+h.version+':'+i} className="history-row" data-showing={showing&&i===0||undefined}><div><span>{h.when}</span>{showing&&i===0?<span className="history-figure" style={{color:token(!h.summary||h.summary.partial?'text2':verdictToken(h.summary).fg)}}>{liftLabel(h.summary)}{h.summary?.partial?<span style={{fontWeight:400,marginLeft:4}}>{h.summary.partial.join('/')}</span>:null}</span>:null}</div><span className="board-mono history-meta">{h.runner} · {h.version}</span>{h.local?<Small>· local, not committed</Small>:null}{showing&&i===0?<RowStrip rows={h.rows}/>:null}</div>)}</div><Small>{showing?'One row per committed run, newest first, across versions. The page renders the latest run for this version; older runs are listed, never compared or merged.':'One row per committed run, newest first, across versions. No run exists for this version; the runs listed are for earlier versions and are never compared or merged with it.'}</Small></aside>;}
```

The default `showing=true` means the two existing call sites (`SkillScreen.tsx:113`, twice) are unchanged and
every locked board that draws the rail renders a byte-identical DOM.

### 4.12 `desktop/src/screens/skill/SkillScreen.tsx` — render History in the not-evaluated state

**Edit A (type import, line 10).** Replace

```tsx
import type { Run,SkillDetail,Result,ValidateResult } from '../../backend/types';
```

with

```tsx
import type { Features,Run,SkillDetail,Result,ValidateResult } from '../../backend/types';
```

**Edit B (new helper component).** Append at the end of the file (after the final line 115), matching the file's
own convention of module-level helper components (`Author` at :28, `UsesPopover` at :40, `SkillMd` at :41,
`Quality` at :42, `Activity` at :43):

```tsx
/** The Evals tab with no receipt for this version. When teammates' runs exist for EARLIER versions, "Not
 *  evaluated" is an over-claim about data the page holds, so History is shown beside a truthful empty state —
 *  and only then: with no history the markup is exactly what it was, which is what the locked
 *  SkillDetailNoReceipt board draws (FIDELITY.md row SkillDetailNoReceipt, DETAIL_NO_RECEIPT has history []). */
function EvalsEmpty({skill:s,features,onRunEval,onHow}:{skill:SkillDetail;features:Features|undefined;onRunEval:()=>void;onHow:()=>void}){
 const empty=<CenteredState icon="chart" title={s.history.length?"No receipt for this version":"Not evaluated"} body={s.history.length?"This version has not been evaluated. Older runs for earlier versions are listed in History; they are never compared or merged with this version.":s.cases===undefined?"Run an eval to score this skill against a baseline with no skill.":"Run an eval to score this skill against a baseline with no skill. Three cases, three reps each, on this machine."} {...(features?.runEvalInApp?{primary:'Run eval'}:{})} secondary="How evals work" onPrimary={onRunEval} onSecondary={onHow}><TerminalHint command={s.evalCommand}/></CenteredState>;
 return s.history.length?<div className="evals-body">{empty}<HistoryRail history={s.history} showing={false}/></div>:empty;
}
```

**Edit C (line 113).** Replace this exact substring (it occurs once):

```tsx
:!s.receipt||!s.summary||!s.reportNumbers?<CenteredState icon="chart" title="Not evaluated" body={s.cases===undefined?"Run an eval to score this skill against a baseline with no skill.":"Run an eval to score this skill against a baseline with no skill. Three cases, three reps each, on this machine."} {...(features?.runEvalInApp?{primary:'Run eval'}:{})} secondary="How evals work" onPrimary={()=>param('dialog','run-eval')} onSecondary={()=>param('tab','skill')}><TerminalHint command={s.evalCommand}/></CenteredState>:
```

with

```tsx
:!s.receipt||!s.summary||!s.reportNumbers?<EvalsEmpty skill={s} features={features} onRunEval={()=>param('dialog','run-eval')} onHow={()=>param('tab','skill')}/>:
```

Do not reformat any other part of line 113, and do not touch the `latestState==='invalid'` branch that precedes
it or the `evals-tab` branch that follows it.

---

## 5. Copy strings (verbatim, with where each appears)

**CLI — `src/cli.ts` command description** (terminal `--help` only):

```
Fetch each team clone to origin/main and nothing else: no placement, no prompts, no push, and no sync stamp
```

**CLI — `--team` option description** (copied from the other verbs' identical option):

```
configured team (required when more than one exists)
```

**CLI — `src/commands/refresh.ts` print line**, one per team that did not refresh, terminal only:

```
<team>: not refreshed (<state>) — <detail>
```

built as `` `${outcome.team}: not refreshed (${outcome.state})${outcome.detail ? ` — ${outcome.detail}` : ''}` ``.
The dash is U+2014 EM DASH with a space on each side.

**CLI — `src/commands/refresh.ts` clone details** (into `RefreshTeam.detail`, never rendered by the app today):

```
no clone for this team on this machine
the folder is a clone of <origin>
the clone is incomplete (<reason>)
the clone is incomplete (<reason>): <error>
```

**Desktop — Evals tab, no receipt for this version AND `history.length > 0`** (new copy; no board draws this
state, so no canvas redraw is implied):

title:

```
No receipt for this version
```

body:

```
This version has not been evaluated. Older runs for earlier versions are listed in History; they are never compared or merged with this version.
```

**Desktop — Evals tab, no receipt and NO history** — unchanged, verbatim as today:

title:

```
Not evaluated
```

body (when `s.cases === undefined`):

```
Run an eval to score this skill against a baseline with no skill.
```

body (otherwise):

```
Run an eval to score this skill against a baseline with no skill. Three cases, three reps each, on this machine.
```

secondary button: `How evals work` · primary button (when `features.runEvalInApp`): `Run eval`.

**Desktop — `HistoryRail` footer caption.** With `showing` true (every existing call site, every locked board) it
is byte-identical to today:

```
One row per committed run, newest first, across versions. The page renders the latest run for this version; older runs are listed, never compared or merged.
```

With `showing={false}` (only the new not-evaluated-with-history path):

```
One row per committed run, newest first, across versions. No run exists for this version; the runs listed are for earlier versions and are never compared or merged with it.
```

**README row** and **frame-protocol paragraph**: as written verbatim in §4.5 and §4.6.

**No other user-visible string changes anywhere.** No new control, no new button, no new banner, no change to
Settings ▸ Sync (which keeps saying "No sync recorded on this machine" until a real sync runs — see DECISION 3.3).

---

## 6. Types and seam changes

### CLI (`src/`)

```ts
// src/lib/teamRepo.ts — NEW, cross-batch contract C1 (byte-identical text in every batch that adds it)
export interface RefreshOptions { lockWaitMs?: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void; deadlineMs?: number }
// and the parameter type of refreshClone becomes
//   options: { label?: string; env?: NodeJS.ProcessEnv; lockStale?: number } & RefreshOptions = {}
// This batch implements deadlineMs ONLY; lockWaitMs and onWaiting are accepted and ignored here.

// src/commands/refresh.ts — NEW
export interface RefreshArgs extends WithForm { team?: string; config?: ConfigStore; runner?: Runner; lockStale?: number; deadlineMs?: number }
export type RefreshState = 'refreshed' | 'busy' | 'unreachable' | 'no-clone' | 'error';
export interface RefreshTeam { team: string; state: RefreshState; changed: boolean; head: string | null; detail?: string }
export interface RefreshResult { changed: boolean; teams: RefreshTeam[] }
export const REFRESH_DEADLINE_MS = 20_000;
export function run(args: RefreshArgs, io: Prompter): Promise<Result<RefreshResult>>;

// src/cli.ts
export interface CliVerbs { …existing…; refresh?: typeof runRefresh }

// src/lib/frames.ts
FRAME_VERBS  += 'refresh'      (appended last)
FRAME_FEATURES += refresh: true (appended last)
```

`FRAME_PROTOCOL` stays `1`. `docs/frame-protocol.md:74` is explicit: *"Additive changes (new optional fields, new
`features` keys, a verb starting to emit `progress`) do not bump it."* PR #132 added a verb and a features key at
protocol 1; this is the same shape.

### Desktop (`desktop/src/`)

```ts
// desktop/src/backend/types.ts
FEATURE_KEYS += 'refresh'   (appended last; `Features` and `FeatureKey` widen automatically)

// desktop/src/backend/tauri/refresh.ts — NEW
export const cliRefresh: z.ZodType<…>;            // the CLI result, loosely validated (.passthrough())
export type CliRefresh = z.infer<typeof cliRefresh>;
export const REFRESH_MIN_INTERVAL_MS = 60_000;
export interface RefreshOutcome { at: number; state: 'refreshed' | 'skipped' | 'failed'; detail?: string }
export interface RefreshPolicyOptions { run(): Promise<Result<CliRefresh>>; supported(): boolean; onChanged(): Promise<void> | void; minIntervalMs?: number; now?: () => number }
export interface RefreshPolicy { trigger(): void; reset(): void; last(): RefreshOutcome | null; settled(): Promise<void> }
export function createRefreshPolicy(options: RefreshPolicyOptions): RefreshPolicy;

// desktop/src/components/domain/EvaluationReport.tsx
export function HistoryRail({history, showing = true}: {history: SkillDetail['history']; showing?: boolean}): JSX.Element;
```

**No change to `desktop/src/backend/Backend.ts`, `desktop/src/backend/types.ts` beyond `FEATURE_KEYS`,
`desktop/src/backend/tauri/frames.ts`, `desktop/src/backend/tauri/run.ts`, `desktop/src/backend/tauri/bridge.ts`,
or `desktop/src/backend/mock/**`.** The mock's `features()` derives from `FEATURE_KEYS`
(`desktop/src/backend/mock/index.ts:101`), so `refresh` becomes `true` there automatically with no edit.
`desktop/src/backend/tauri/frames.ts` needs nothing: `CliFrame`'s hello already types `features` as
`Readonly<Record<string, boolean>>` (`:9`) and `parseCliFrame` passes it through unchanged (`:28-30`).

---

## 7. Tests

Every test below is new unless marked **(existing file, extended)**. `desktop/AGENTS.md` invariant 7 and
cross-batch contract C9 apply: no test is deleted or weakened.

### 7.1 Existing CLI test files that MUST be extended (they gate the build)

**Edit A — `src/lib/__tests__/frames.test.ts:35-39` (existing file, extended).** This is an exact-object
assertion on `FRAME_FEATURES`; a new key fails it until it is listed. Replace the substring

```ts
      disablePerMachine: false, projectMembers: false, liftOnCards: false, runEvalInApp: true, perCase: false, progress: false,
```

with

```ts
      disablePerMachine: false, projectMembers: false, liftOnCards: false, runEvalInApp: true, perCase: false, progress: false,
      refresh: true,
```

Reason: the feature key is new and this assertion is the inventory of the feature map. Nothing is weakened — the
assertion stays exact.

**Edit B — `src/__tests__/frames-cli.test.ts` (existing file, extended).** Its first test asserts *"FRAME_VERBS
names only registered commands, and every one is covered here"* (`:56-61`) and it generates one frame-mode test
per `FRAME_VERBS` entry (`:63-75`). Two additions:

- `:23-29` `INVOCATIONS`: add `refresh: ['refresh'],` (put it on the line that already ends with
  `update: ['update'],`).
- `:54` the `verbs` object: add `refresh: asking` (append after `update: asking`).

Reason: the map is the per-verb invocation inventory the new verb must join. Nothing is weakened.

**Edit C — do NOT edit** `src/lib/__tests__/invocation-catalog.ts`: §4.2 and §4.3 keep the literal
`terum-skills` out of every new `src/` line, so the tripwire's inventory is unchanged. If you find you have
introduced such a line, remove the literal rather than cataloguing it.

### 7.2 `src/commands/__tests__/refresh.test.ts` — NEW

Model it on `src/commands/__tests__/evalReport.test.ts` (same fixtures, same shape). Import from
`../../lib/__tests__/fixtures.js`: `bareTeam`, `pushFromSeed`, `cloneWithIdentity`, `git`, `holdCloneLock`,
`denyingRunner`, `ScriptedPrompter`, `clean`, `exists`. Import `createConfigStore` from `../../lib/config.js`,
`stampedAt`/`stampIsFresh` from `../../lib/hook.js`, `systemRunner` from `../../lib/runner.js`, and
`run`/`REFRESH_DEADLINE_MS` from `../refresh.js`. Build the same `ID`/`skill`/`receipt(version, run_id)` helpers
`evalReport.test.ts:10-20` uses, so the W-08 test can assert through `eval-report` itself.

| # | `it(...)` title | arrange → act → assert |
|---|---|---|
| 1 | `'fetches the clone so receipts a teammate committed after the last write become visible (W-08)'` | Arrange: `bareTeam()`; `pushFromSeed` `skills/sample/SKILL.md`; read `tree` = `git rev-parse HEAD:skills/sample` in the seed; `cloneWithIdentity` into `store.teamClone('team')`; register the team in config; **then** `pushFromSeed` two receipts under `evals/<ID>/<tree>/<run_id>.json`. Act/assert: `evalReport` first reports `{latestState:'none', history:[], versions:{teamCurrent:tree}}` — the correct current version with no receipts, which is exactly Teddy's state; then `run({config:store},io)` returns `{ok:true, value:{changed:true, teams:[{team:'team', state:'refreshed', changed:true}]}}`; then `evalReport` reports `latestState:'ok'` and two history rows in `run_id`-descending order. |
| 2 | `'is idempotent: a second run reports changed false and the same head'` | Run twice. Second result: `changed:false`, `teams[0].changed === false`, `teams[0].head` equal to the first run's `head` and to `git rev-parse HEAD` in the clone. |
| 3 | `'never writes the sync stamp or the run directory'` | `stampedAt(store.root,'team')` is `null` before and after; `stampIsFresh(store.root,'team')` is `false` after; `exists(join(store.root,'run'))` is `false` after. |
| 4 | `'asks nothing and does not rewrite config.json'` | `io.asked` is `[]`; the bytes of `config.json` read before and after are identical (the assertion `evalReport.test.ts:37,42` already uses). |
| 5 | `'prints one line per team that did not refresh on a terminal'` | Two teams configured, one whose clone directory was removed. Assert `io.lines` equals `['b: not refreshed (no-clone) — no clone for this team on this machine']` (or whichever team). |
| 6 | `'prints nothing when a program is on the other end'` | Same arrangement as #5 but drive it with `Object.assign(new ScriptedPrompter(), { channel: 'frames' as const })`. Assert `io.lines` is `[]` **and** the returned `teams` still carries the same `state` and `detail`, i.e. the program loses nothing. |
| 7 | `'reports busy without moving the clone when another process holds the writer lock'` | `const release = await holdCloneLock(clone)` before the act; assert `ok:true`, `teams[0].state === 'busy'`, `changed:false`, and `git rev-parse HEAD` unchanged from before; release in a `finally`. (This path really pays `withCloneLock`'s ≈3.75 s retry budget — give the test a generous vitest timeout, e.g. `15_000`.) |
| 8 | `'classifies a recognised remote access failure as unreachable and still refreshes the other team'` | Two teams. For team `a` use a `denyingRunner` rule that answers `['fetch','origin']` with `{code:128,stdout:'',stderr:"fatal: repository '/gone.git' not found"}` and `['remote','get-url','origin']` with the path, delegating everything else to `systemRunner`; team `b` is healthy. Assert `ok:true`; `a` is `state:'unreachable'` with `detail` containing both the git stderr and the explanation sentence; `b` is `state:'refreshed'`; the overall `changed` reflects `b` alone. |
| 9 | `'reports an unrecognised fetch failure as error with the git stderr in detail'` | Point `origin` at a path that is not a repository (`git remote set-url origin <tmp>/nope.git` in the clone) and run with the real `systemRunner`. Assert `state:'error'`, `detail` contains `does not appear to be a git repository`, `ok:true`, `changed:false`. (This pins the fact recorded in DECISION 3.15: `explainGitAccessFailure` does not recognise this, so it is `error`, not `unreachable`.) |
| 10 | `'reports no-clone for a missing clone and never re-clones it'` | `clean(clone)` first. Assert `state:'no-clone'`, `head:null`, `detail === 'no clone for this team on this machine'`, and `exists(clone)` is still `false` afterwards. |
| 11 | `'reports no-clone for a folder that clones a different remote'` | Point the clone's `origin` at a second bare repo. Assert `state:'no-clone'` and `detail` starts with `the folder is a clone of `. |
| 12 | `'discards a local commit in the clone: the clone is disposable state'` | Write and commit a stray tracked file in the clone, note its HEAD, then refresh. Assert `changed:true`, the stray file is gone, and HEAD equals `origin/main`. This pins `refreshClone`'s existing contract so nobody later "improves" `refresh` into a merge. |
| 13 | `'reports changed when a hard reset restores a tracked file that was deleted locally'` | Delete a tracked file in the clone (no commit, HEAD does not move) and refresh. Assert `state:'refreshed'`, `changed:true`, the file is back. This is the `--untracked-files=no` branch of DECISION 3.14. |
| 14 | `'does not report changed for an untracked file the reset leaves alone'` | Write an untracked file in the clone, refresh with no new commits. Assert `changed:false` and that the untracked file still exists. (Without `--untracked-files=no` this test fails — that is the point.) |
| 15 | `'--team selects one team, a bare run refreshes every configured team, and an unknown --team fails'` | Two teams. `run({team:'a',…})` → one row for `a` only. `run({…})` → two rows. `run({team:'nope',…})` → `{ok:false}` whose error is `Team nope is not configured.` |
| 16 | `'refreshes nothing and touches git not at all when no team is configured'` | Empty `config.teams`; `runner` is `denyingRunner([])` (throws on any call). Assert `{ok:true, value:{changed:false, teams:[]}}` and no throw. |
| 17 | `'passes the fetch deadline to the runner for the fetch step only, and never for the reset'` | Wrap `systemRunner` with a recording runner (`wrapRunner` from the fixtures) that captures `(args, options)`. Run with `deadlineMs: 1234`. Assert the recorded `['fetch','origin']` call carries `deadlineMs === 1234` and the recorded `['reset','--hard','origin/main']` call carries `deadlineMs === undefined`. Also assert the default: with no `deadlineMs` argument the fetch call carries `REFRESH_DEADLINE_MS`. |
| 18 | `'a fetch killed at its deadline settles as an error rather than hanging'` | `denyingRunner` answering `['fetch','origin']` with the runner's real expiry shape `{code:124,stdout:'',stderr:'terum-skills: git fetch exceeded 0.05 s'}` and delegating the rest. Assert `ok:true`, `state:'error'`, `detail` contains `exceeded`, and the promise settles. |
| 19 | `'runs git without a terminal prompt and without an interactive credential helper'` | Recording runner again. Assert every recorded `git` call for this team carries `env.GIT_TERMINAL_PROMPT === '0'`, `env.GIT_CONFIG_COUNT === '1'`, `env.GIT_CONFIG_KEY_0 === 'credential.interactive'`, `env.GIT_CONFIG_VALUE_0 === 'false'`. |
| 20 | `'reports an empty head as null rather than guessing'` | A clone whose `git rev-parse HEAD` fails (an `--orphan` branch with no commit, or a `denyingRunner` answering `rev-parse` with code 128). Assert `head` is `null` and the run still settles `ok:true`. |

### 7.3 `desktop/src/backend/tauri/__tests__/refresh-policy.test.ts` — NEW (pure policy, no bridge)

Drives `createRefreshPolicy` directly with an injected `now` and a stub `run`. No timers.

| # | `it(...)` title | assert |
|---|---|---|
| 1 | `'runs once and does not run again inside the interval'` | `now` fixed; call `trigger()` three times; `run` called once. |
| 2 | `'runs again once the interval has passed'` | advance the injected clock past `REFRESH_MIN_INTERVAL_MS`; `run` called twice. |
| 3 | `'does not run at exactly the interval boundary minus one, and does at the boundary'` | elapsed `interval - 1` → not run; elapsed exactly `interval` → run. Pins the `<` comparison. |
| 4 | `'a clock that jumps backwards does not wedge the throttle'` | first trigger at t=10_000_000; then set `now` to t-3_600_000 (a system clock change) and trigger: `run` is called again. |
| 5 | `'is single-flight: a trigger while a run is in flight starts nothing'` | `run` returns a promise the test resolves manually; trigger twice; `run` called once; resolve; `settled()` resolves. |
| 6 | `'never spawns when the CLI does not support the verb'` | `supported: () => false`; ten triggers; `run` never called; `last()` is `null`. |
| 7 | `'calls onChanged exactly once when a clone moved'` | `run` resolves `{ok:true,value:{changed:true,teams:[{team:'t',state:'refreshed',changed:true,head:'a'.repeat(40)}]}}`; `onChanged` called once; `last()` is `{state:'refreshed'}`. |
| 8 | `'never calls onChanged when nothing moved'` | same but `changed:false` everywhere; `onChanged` not called. |
| 9 | `'records a skipped outcome naming every team that did not refresh'` | teams `[busy, unreachable]` with details; `last()!.state === 'skipped'` and `detail` contains both team names, both states and both details, joined by `'; '`. |
| 10 | `'records a failed outcome and does not throw when the run reports a failure'` | `run` resolves `{ok:false,error:'…'}`; `last()!.state === 'failed'`, `detail` is the error; no rejection. |
| 11 | `'records a failed outcome and does not throw when the run rejects'` | `run` rejects with an `Error`; same assertions; `settled()` resolves; a later `trigger()` after the interval still works. |
| 12 | `'does not reject when onChanged itself throws, and still clears the in-flight slot'` | `onChanged` rejects; `settled()` resolves; `last()!.state === 'failed'`; a later trigger past the interval runs again. |
| 13 | `'a burnt attempt still counts: a failing run does not retry-storm'` | `run` rejects; trigger three times inside the interval; `run` called once. |
| 14 | `'reset clears the throttle so the next trigger runs immediately'` | trigger, then `reset()`, then trigger at the same clock value; `run` called twice. |
| 15 | `'treats an empty teams array as a clean refresh with nothing to invalidate'` | `{ok:true,value:{changed:false,teams:[]}}`; `last()!.state === 'refreshed'`; `onChanged` not called. |

### 7.4 `desktop/src/backend/tauri/__tests__/refresh-on-focus.test.ts` — NEW (adapter + fakeBridge)

Use `fakeBridge` from `./fake-bridge`. Its script must emit a hello whose `features` includes `refresh: true` for
the supported cases and omits it for the unsupported ones, then a `result` frame for the verb. Add an
`afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); })` and construct exactly one backend per test.

| # | `it(...)` title | assert |
|---|---|---|
| 1 | `'runs refresh once when the first hello reports the feature'` | one read (`backend.status()`), then `await vi.waitFor(...)`: `f.spawns.map(s=>s.args.join(' '))` contains exactly one `'refresh'`. |
| 2 | `'does not invalidate reads when no clone moved'` | script `{changed:false,teams:[…refreshed…]}`; a listener registered through `backend.subscribe` is never called. |
| 3 | `'invalidates with clone only when a clone moved'` | script `{changed:true,…}`; the listener is called with `'clone'`; a subsequent `backend.status()` re-spawns `status` (the memo was cleared). |
| 4 | `'throttles: three focus events inside the interval spawn one refresh'` | `vi.useFakeTimers({toFake:['Date']})` (the pattern `read-cache.test.ts:54` uses); dispatch `new Event('focus')` three times; exactly one `'refresh'` spawn. |
| 5 | `'refreshes again after the interval'` | advance `vi.setSystemTime(Date.now() + REFRESH_MIN_INTERVAL_MS + 1)`; dispatch focus; two `'refresh'` spawns. |
| 6 | `'is single-flight: a focus while a refresh is in flight spawns nothing'` | hold the refresh child open with the `hold` pattern of `read-cache.test.ts:20-26`; dispatch focus; still one `'refresh'` spawn; release. |
| 7 | `'a CLI without the refresh feature never spawns refresh, at launch or on focus'` | hello with `features:{}`; read, then focus; zero `'refresh'` spawns, ever. |
| 8 | `'a CLI that emits no hello at all never spawns refresh'` | script emits only `{kind:'exit',code:1}`; zero `'refresh'` spawns. This is the assertion that keeps every legacy recorded-frames test green. |
| 9 | `'the launch trigger fires on the first hello only, never on a later verb hello'` | first run's hello has `features:{}` (no refresh), second run's hello has `refresh:true`; assert zero `'refresh'` spawns. This is the exact shape of `features.test.ts:18-27` and is what keeps its `[['connect'],['sync']]` assertion true. |
| 10 | `'a failing refresh is silent and non-fatal'` | script the refresh result as `{ok:false,error:'…'}`; no listener call, no unhandled rejection, and a subsequent `backend.status()` still returns `ok:true`. |
| 11 | `'a refresh that asks a question is cancelled, never answered'` | script an `ask` frame for the `refresh` argv; assert `f.kills` is non-empty, `f.writes` contains no `"t":"answer"` line, and no listener call. |
| 12 | `'a refresh whose result does not match the schema is a silent failure'` | script `value: {changed:'yes'}`; no listener call, no throw, and a later `backend.status()` still works. |
| 13 | `'notify waits for the reads that were in flight when the refresh finished'` | hold a `status` read open; make the refresh return `changed:true`; assert the subscribe listener has NOT fired while the read is held; release the read; `await vi.waitFor(...)` the listener fires. |
| 14 | `'a retired backend instance never spawns on a later focus event'` | construct backend A (hello with `refresh:true`, drive one read so its hello lands), then construct backend B, then dispatch `focus`; assert A's bridge records no second `'refresh'` spawn. |
| 15 | `'refreshLaunch clears the throttle so the next focus refreshes immediately'` | fake `Date`; first refresh at launch; `await backend.refreshLaunch()`; dispatch focus at the same clock value; two `'refresh'` spawns. |
| 16 | `'the refresh run is not memoised: it never enters the read cache'` | after a refresh, advance the clock by less than `READ_CACHE_TTL_MS`, `reset()` the throttle via `refreshLaunch()` and focus again; a second `'refresh'` process is spawned (i.e. it is not served from `reads`). |

### 7.5 `desktop/src/backend/tauri/__tests__/skill-detail-screens.test.tsx` — (existing file, extended)

Append two `it(...)` blocks using the file's own `open(route, amend)` helper and `detailReplay`'s `amend`
callback. At `9fb73e9` the recording
`.planning/codex-runs/mock-vs-real-2026-09-09/frames/eval-report-deploy-check.jsonl` already reports
`latestState:'none'`, `latest:null`, `history:[]` — the "Not evaluated" state — so the amend only has to add
history rows.

- `it('shows teammates\' committed runs when this version has no receipt of its own', …)` — `open('#/skill/deploy-check?tab=evals', (name, value) => { if (name === 'eval-report-deploy-check') value.history = [ …two rows… ]; })`, where each row matches the CLI shape the adapter parses (`desktop/src/backend/tauri/eval-report.ts:19`): `{version:'a'.repeat(40), run_id:'20260910T060851Z', timestamp:'2026-09-10T06:08:51Z', runner_handle:'ajayw36', comparison:null, verdict:'NEUTRAL', execution_status:'complete'}` and a second, older row for `ryanliu-terum`. Assert: the heading `No receipt for this version` is on the page, the body sentence `This version has not been evaluated. Older runs for earlier versions are listed in History; they are never compared or merged with this version.` is on the page, `History` is on the page, both handles are on the page, the words `Not evaluated` are **not** on the page, and no element carries `data-showing` (`document.querySelectorAll('[data-showing]')` has length 0).
- `it('keeps the drawn empty state exactly when there is no history at all', …)` — `open('#/skill/deploy-check?tab=evals')` with no amend. Assert `Not evaluated` is on the page, the drawn body sentence is on the page, `History` is **not** on the page, and `document.querySelector('.evals-body')` is `null` (no wrapper is introduced on the locked-board path).

### 7.6 `desktop/e2e/routes/evals-empty-state.spec.ts` — NEW Playwright route spec

Model it on `desktop/e2e/routes/card-click.spec.ts` (same `prepare(page, {name, route, klass:'screen', width:1440, height:900})` import from `../fidelity/determinism`, same console/pageerror/response listeners, `test.describe.configure({mode:'parallel'})`).

- `test('SkillDetailNoReceipt keeps the drawn empty state and draws no History rail', …)`: go to
  `#/skill/onboarding-tour?tab=evals`; assert `page.getByText('Not evaluated')` is visible; assert
  `page.getByText('History')` has count 0; assert `page.locator('.history-rail')` has count 0; assert
  `page.locator('.evals-body')` has count 0; assert the collected `errors` array is empty.
  This is the guard the design-fit review asked for: it makes a later "simplification" of the
  `s.history.length ? … : …` guard fail a route test instead of a fidelity diff on a maintainer's machine.

---

## 8. Gates — exact commands, in order

From the repository root:

```
npm run lint
npm run typecheck
npx vitest run src/commands/__tests__/refresh.test.ts src/commands/__tests__/evalReport.test.ts src/commands/__tests__/sync.test.ts src/lib/__tests__/frames.test.ts src/__tests__/frames-cli.test.ts src/lib/__tests__/invocation-tripwire.test.ts src/__tests__/cli.test.ts
npm test
npm run build
```

Then from `desktop/`:

```
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e:routes
```

**Expected pre-existing state at `9fb73e9`:** all of the above pass before your change. There are no known
pre-existing failures for you to work around. If a gate is red before you touch anything, say so in your report
with the exact output and do not "fix" it as part of this batch.

**Run one battery at a time.** Do not run the root vitest suite and the desktop vitest/Playwright suites
concurrently.

**What you cannot run, and must say so honestly in your report:**
- `cargo check` for `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`. This batch makes
  **no Rust change at all** (DECISION 3.4), so there is nothing for it to catch, but you still cannot run it. The
  orchestrator runs it.
- `npx playwright test e2e/fidelity` — it needs the design canvas via `TERUM_DESIGN_DIR`, which you do not have;
  it skips. The orchestrator runs it. **Expected result: zero fidelity rows change.** The mock backend is
  untouched by construction, and the one board that draws the changed branch (`SkillDetailNoReceipt`,
  `desktop/FIDELITY.md:28`) is served by `DETAIL_NO_RECEIPT`, whose `history` is `[]`, so it renders exactly the
  markup it renders today.
- `npm run export:check` — needs the canvas; the orchestrator runs it. This batch edits neither generated file.

**Forbidden:** any git command (not even `git status`), `npm install` / `npm ci`, network access, committing or
staging. Leave your changes in the working tree, unstaged.

**Files you must never edit:** `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`,
`desktop/README.md`, `desktop/package.json`, `desktop/src/styles/tokens.css`, `desktop/src/fixtures/design.json`,
anything under `.shots`. Root `package.json` is **not** edited by this batch either — this change adds no
dependency and bumps no version (contract C8).

---

## 9. Windows verification (what cannot be checked on Linux)

Everything in §8 runs on Linux. These four things cannot be, and are the reporter's falsifiers on his own
Windows 11 x64 machine.

**9.1 The diagnosis itself.** Before installing anything new, in a Windows shell:

```
git -C "%USERPROFILE%\.terum\skills\teams\<team>" log -1 --format=%H%n%cI
dir "%USERPROFILE%\.terum\skills\teams\<team>\evals"
```

Prediction: HEAD is a commit dated **at or before 2026-09-10T05:49:52Z** — that is, strictly before
`8181447a` (2026-09-10T06:28:00Z), the commit that carried the first receipt — and `evals` holds only
`.gitkeep`. (The prediction is stated as a range, not as one commit: on a Windows + WSL box the desktop app and a
WSL shell root their stores at different `HOME`s, so the Windows clone may have been last moved by an even
earlier write verb. Any HEAD in that range confirms the diagnosis; only receipts actually present at that HEAD
would refute it.)

**9.2 The verb itself, against a CLI built from this change** (not `terum-skills@latest`, which does not have
the verb yet — the app and the CLI ship separately, and an app-only update leaves W-08 exactly as it is):

```
node <path-to-this-build>\dist\index.js refresh
node <path-to-this-build>\dist\index.js eval-report decision-walk
```

Expected: `refresh` exits 0 and prints nothing; `eval-report` then reports both teammate receipts. Repeat
`refresh` immediately: still exit 0, still silent.

**9.3 No console flash, no credential dialog.** Launch the desktop app, open
`#/skill/decision-walk?tab=evals`, alt-tab away and back. Expected: the receipts appear without touching
Settings; **no** console window flashes (the node child is spawned with `CREATE_NO_WINDOW`,
`desktop/src-tauri/src/lib.rs:52,75`, and its git grandchildren inherit `windowsHide: !inherit`,
`src/lib/runner.ts:45`); **no** Git Credential Manager dialog appears (DECISION 3.17). Then check Settings ▸ Sync
still reads **"No sync recorded on this machine"** — `refresh` does not write the stamp and must not start
claiming a sync happened.

**9.4 A refresh killed mid-fetch.** Alt-tab into the app and immediately close the window while the network is
slow. On Windows, killing a child is `TerminateProcess`: no signal handler runs, so `proper-lockfile`'s exit hook
never fires and the clone's lock directory
(`%USERPROFILE%\.terum\skills\teams\.<team>.safewrite.lock`) can be left behind. Expected recovery: it is
reclaimed as stale after 60 s (`src/lib/teamRepo.ts:507`, `stale: options.lockStale ?? 60_000`), and a `sync` run
inside that window reports the team as busy rather than failing. This is not new in kind — the app can already be
killed mid-`eval`/`sync`/`publish`, which take the same lock — but the `deadlineMs` added here bounds how long a
refresh can hold it (DECISION 3.16).

**Windows path note:** nothing in this batch compares or joins a path by prefix. The clone path is
`join(homedir(), '.terum', 'skills', 'teams', <team>)` (`src/lib/config.ts:37, 97-99`) and is passed to git only
as `cwd`. Teddy's `\\wsl.localhost\...` UNC roots are *checkout* roots read by `ls --local`, never the team
clone, so this change never touches a UNC path. **Do not add any `root + '/'` prefix check or any other
POSIX-shaped path comparison to this code.**

---

## 10. Out of scope / do not touch

- **`sync`, `eval`, `publish`, `install`, `connect`** — unchanged. They already refresh, and their `notify(...)`
  already invalidates. Do not add a `refresh` call after them.
- **The read verbs (`eval-report`, `ls`, `status`, `search`, `validate`)** — unchanged, still fetch-free. That
  contract is published in two places (`src/cli.ts:139`, `docs/frame-protocol.md:78`), and `ls` and `status`
  print their own staleness warning (`src/commands/ls.ts:226`, `src/lib/hook.ts:179`).
- **`run/<team>.stamp`, `stampIsFresh`, `STAMP_FRESH_MS`, `status.syncedAt`, Settings ▸ Sync** — unchanged
  (DECISION 3.3). Settings ▸ Sync is a locked fidelity row.
- **`desktop/src-tauri/**` (any Rust)** — unchanged (DECISION 3.4). Five commands, no file watching, no timer.
- **`desktop/src/backend/mock/**`, `desktop/src/fixtures/**`, `desktop/src/backend/Backend.ts`,
  `desktop/src/backend/tauri/{frames,run,bridge,prepare-run,eval-report,prefs,detect,scanned-roots}.ts`** —
  unchanged. No new mock scenario, no new `?__mock=` value.
- **`desktop/src/app/providers.tsx`, `invalidation.ts`, `LaunchCoordinator.tsx`, `refresh-policy.test.tsx`** —
  unchanged. `notify('clone')` already invalidates the right seven prefixes; `LaunchCoordinator` belongs to other
  batches (contract C7).
- **`desktop/src/screens/skill/RunEvalDialog.tsx`** — unchanged (contract C6 belongs to other batches).
- **Version numbers** — do not bump `version` in root or `desktop/package.json` (contract C8).
- **`src/lib/remote.ts` / `explainGitAccessFailure`** — do not widen the classifier (DECISION 3.15). It is shared
  with `sync` and `publish`.
- **`src/backend/__tests__/s7q.test.ts:9`** — its title says "thirteen mock feature switches" while
  `FEATURE_KEYS` already has sixteen at `9fb73e9`. The assertion itself derives from `FEATURE_KEYS` and keeps
  passing. Leave the stale title alone; it is not this batch's to fix.
- **A visible "could not refresh" line anywhere in the UI** — deferred (DECISION 3.23).

**For the ORCHESTRATOR (maintainer-owned files this batch cannot edit):**
- `desktop/FIDELITY.md`: **no row changes.** No board moves; no row goes to `in-progress`.
- `desktop/GAPS.md`: two notes worth adding by hand. (1) The Marketplace "no synced X ago" note changes character
  once `refresh` lands — the clone is now fetched in the background, so the Marketplace's staleness is bounded by
  a minute rather than by the user's last write verb. (2) A failed background refresh is silent in this batch;
  the natural home for a truthful line is a second line under Settings ▸ Sync ▸ "Last sync", which is a locked
  board and needs a canvas redraw first (DECISION 3.23).
- `.planning/decisions/2026-09-08-m7-takeover-decision-walk.md`: a one-line amendment for Ryan recording that
  (a) `refresh` closes the **remote** staleness case D9 did not consider, (b) the deferred sixth native
  `stat_state_files()` command stays deferred and its gate is still unmet, and (c) `lib.rs` stays at five
  commands.
- Release note: **"update the CLI too."** The `hello.features.refresh` gate means an app-only update leaves W-08
  exactly as it is, silently.

---

## 11. Cross-batch contracts used, and the merge-conflict watch list

Nine batches build in parallel from `9fb73e9`. The orchestrator merges in this order:
`w07-library-header → w08-refresh-receipts → w06-eval-lock → w03w04-skill-routing → w05-skill-markdown → sidebar-spacing → setup-discover-evals → w02-perf → w01-app-update`.

**Contracts this batch OWNS:**

- **C1 — `refreshClone`'s `deadlineMs`.** The interface text is fixed and identical across batches:
  ```ts
  export interface RefreshOptions { lockWaitMs?: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void; deadlineMs?: number }
  ```
  `w06-eval-lock` owns `lockWaitMs`/`onWaiting`; **`w08-refresh-receipts` owns `deadlineMs`**. This batch declares
  the full interface and implements `deadlineMs` only; the other two fields are accepted and ignored here.
  **Never change `refreshClone`'s positional parameters.** *(Note: the contract text says "adds ONE optional
  trailing parameter `options?: RefreshOptions`"; at `9fb73e9` `refreshClone` **already has** a trailing options
  parameter at `src/lib/teamRepo.ts:471`. The code wins: the interface is intersected into that existing
  parameter's type, which produces the same merged result with no positional change — see §4.1 Edit B.)*
- **C2 — `'refresh'`.** `FRAME_VERBS` gets `'refresh'` appended at the END; the cross-batch order for later
  batches is `'refresh'` (w08), then `'checkout discover'` (setup-discover-evals), then `'app-update'` (w01).
  `FRAME_FEATURES` gets `refresh: true` appended at the END; the cross-batch order is `refresh: true` (w08),
  `discover: true` (setup-discover-evals), `appUpdate: true` (w01); `w02-perf` flips the existing
  `progress: false → true` in place. Desktop `FEATURE_KEYS` gets `'refresh'` appended in the same order; the mock
  answers `true` (derived, no edit); the real adapter reads `hello.features.refresh` with a missing key = false.
- **C3 — the `refresh` command in `src/cli.ts`.** New top-level commands are registered AFTER `decline`, in the
  order `refresh` (w08) then `app-update` (w01). `checkout discover` goes inside the existing `checkout` group.
- **C4 — `desktop/src/backend/tauri/refresh.ts`.** All new adapter logic is in that module; the wiring in
  `index.ts` is the minimum described in §4.9.

**Merge-conflict watch list** (files this batch touches that another batch also touches):

| file | this batch's edit | who else |
|---|---|---|
| `src/lib/teamRepo.ts` | `RefreshOptions` above `refreshClone`; `& RefreshOptions` on the parameter; `deadlineMs` on the fetch step | **w06-eval-lock** also edits `refreshClone`. The `RefreshOptions` text is byte-identical in both, so the addition merges cleanly; the parameter-type edit is the same substring in both. |
| `src/lib/frames.ts` | one word appended to `FRAME_VERBS` (`:32`); one key appended to `FRAME_FEATURES` (`:39-44`) | setup-discover-evals, w01, w02-perf. All appends, in the C2 order. |
| `src/cli.ts` | one import; one field in `CliVerbs` (`:39`); one field in `active` (`:42`); one command block after `decline` (`:172`) | w01, setup-discover-evals. Same three declaration lines; register after `decline` in the C3 order. |
| `docs/frame-protocol.md` | the `hello.features` names sentence (`:72`) + a new verb section | every batch adding a verb or a feature key. |
| `src/lib/__tests__/frames.test.ts` | the exact `FRAME_FEATURES` object (`:35-39`) | every batch adding a feature key. |
| `src/__tests__/frames-cli.test.ts` | `INVOCATIONS` (`:23-29`) and the `verbs` object (`:54`) | every batch adding a verb. |
| `desktop/src/backend/types.ts` | one entry appended to `FEATURE_KEYS` (`:12`) | setup-discover-evals, w01. |
| `desktop/src/backend/tauri/index.ts` | imports; one module-level `let`; the focus listener block replacing `:367`; `onHello` at `:318`; two lines in `refreshLaunch` at `:487` | **w02-perf** (`concurrency.ts` + cache policy), **w01** (`app-update.ts`), **w03w04** (rewrites `skill()`/`inventoryDetail`), **setup-discover-evals** (a `discover` seam method). None of them touches `:316-318`, `:366-368` or `:482-489`. Keep your edits to those anchors. |
| `desktop/src/screens/skill/SkillScreen.tsx` | one type import (`:10`); one substring on `:113`; one appended helper component | **w03w04** (crumb/root/not-found), **w05** (markdown component), **w02-perf** (progress lines). The whole render is one 9,014-character line — keep the edit to the single anchored substring in §4.12 Edit C and **do not reformat**. |
| `desktop/src/components/domain/EvaluationReport.tsx` | `HistoryRail` gains `showing` (`:19`) | nobody else in this window, but `w06-eval-lock` touches `RunEvalDialog.tsx` nearby. |

---

## 12. PR

**Title** (conventional, 60 chars):

```
fix(desktop): fetch the team clone so teammates' evals show
```

**Body outline:**

- **What.** A new CLI verb `refresh` (fetch + hard reset each team clone to `origin/main`, under the existing
  writer lock, and nothing else), advertised through `FRAME_VERBS` / `FRAME_FEATURES.refresh` / desktop
  `FEATURE_KEYS`, and run by the real desktop adapter in the background on launch and on window focus — throttled
  to once a minute, single-flight, invalidating reads through the existing `notify('clone')` channel only when a
  clone actually moved. Plus: the Evals tab now shows the History rail when the current version has no receipt but
  teammates' runs for earlier versions exist.
- **Why.** Bugs.pdf W-08: the desktop app never ran `git fetch` on the team clone, so every team-derived surface
  was served from wherever the user's last *write* verb left it. The reporter's clone was parked at his own
  `install` (05:40:38Z); the receipts he could not see were committed at 06:28:00Z and 06:33:04Z. Focus-refresh
  cleared a 15-second memo and re-read the same unfetched clone. One `git fetch` is the entire fix; three
  independent reproductions confirm it, driving the real CLI, the real adapter mapper and the real screens.
- **What it deliberately does not do.** It never runs `sync` (which since #119 commits and pushes), never writes
  `run/<team>.stamp` (so Settings ▸ Sync keeps telling the truth and the SessionStart hook is not suppressed),
  adds no timer or poll, adds no Tauri command (`lib.rs` stays at five), and adds no seam method or mock
  behaviour. Ledger D9 is honoured, not re-litigated: it banned an automatic *sync*, for reasons (`m7-S7r.md:40`)
  that a fetch-only primitive is built to avoid; the deferred native mtime command stays deferred because it
  watches two local files that do not move when a teammate pushes.
- **How verified.** Root: lint, typecheck, `npm test`, `npm run build`. Desktop: typecheck, lint, `npm test`,
  `npm run build`, `e2e:routes`. New: `src/commands/__tests__/refresh.test.ts` (20 cases including the W-08
  regression end to end through `eval-report`, busy/unreachable/no-clone/error, the deadline plumbing, the
  no-team no-git case, and the credential env), `desktop/src/backend/tauri/__tests__/refresh-policy.test.ts`
  (15 cases including a backwards clock, a rejecting run and a rejecting `onChanged`),
  `desktop/src/backend/tauri/__tests__/refresh-on-focus.test.ts` (16 cases including version skew, no hello,
  single-flight, retired instances and cancellation), plus screen and route coverage for the History rail.
  Fidelity: no board moves; `SkillDetailNoReceipt` is served by a fixture whose `history` is `[]`, and the new
  markup is gated on `history.length > 0`. `cargo check` and `e2e:fidelity` are the maintainer's to run.
- **Windows notes.** Verify on the reporter's box: `refresh` then `eval-report decision-walk` against a CLI built
  from this branch (not the published `@latest`, which has no such verb — **the CLI must be updated too, an
  app-only update changes nothing**); confirm the Evals tab fills in on alt-tab with no console flash and no
  credential dialog; confirm Settings ▸ Sync still reads "No sync recorded on this machine". A refresh killed by
  the window closing can leave a stale clone lock for up to 60 s on Windows (`TerminateProcess` runs no exit
  hook); `deadlineMs` bounds how long a refresh can hold it.

---

## 13. Open questions

None are left open for you: every fork below already has the answer you must take. Do not ask; do not deviate.

| # | question | **the answer you take** |
|---|---|---|
| 1 | Should the Evals tab show History when the current version has no receipt? | **Yes, and only when `s.history.length > 0`**, with the copy in §5 and `showing={false}` on the rail (DECISION 3.20/3.21). With no history the markup is byte-identical to today, which is what the locked `SkillDetailNoReceipt` board draws. Do not draw a new board and do not touch `desktop/FIDELITY.md`. |
| 2 | Should a failed background refresh be visible? | **No, not in this batch** (DECISION 3.23). Record it in the policy's `last()` and ship nothing user-facing; Settings ▸ Sync is a locked board. |
| 3 | Throttle interval? | **60 s**, exported as `REFRESH_MIN_INTERVAL_MS` so it is one edit (DECISION 3.13, §4.8). |
| 4 | Hide `refresh` from `--help`? | **No — public and documented** (DECISION 3.7). CP-19 forces it. |
| 5 | Guard against a Windows credential GUI? | **Yes**, through the env (DECISION 3.17). If GCM ignores the key it is a no-op; git ignores config keys it does not know. |
| 6 | Also refresh after the app's own long verbs? | **No** (DECISION 3.9). They already fetch and already invalidate. |
| 7 | Gate the adapter on `hello.verbs` or `hello.features`? | **`hello.features.refresh`** (DECISION 3.6), matching #132's precedent and the adapter's ten existing `hello.features` reads. Put the verb in `FRAME_VERBS` too, but for the CP-19/`attemptedVerb` reason, not as the gate. |
| 8 | Add `Backend.refresh()` and a mock implementation? | **No** (DECISION 3.8). This deviates from one line of the batch brief, deliberately and for the reasons given there. |
| 9 | Does `deadlineMs` bound the lock wait or the fetch? | **The fetch** (DECISION 3.16). The lock wait is already bounded at ≈3.75 s by `proper-lockfile`'s retry budget. |
| 10 | What if the CLI on the machine is older and has no `refresh`? | **Nothing happens, silently**: `hello.features.refresh` is absent → `=== true` is false → zero spawns, ever. That is also what keeps every existing recorded-frames test's spawn count unchanged. |
