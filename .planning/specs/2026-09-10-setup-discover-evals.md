# SPEC — batch `setup-discover-evals` (LOCKED)

Base commit: `9fb73e9` of `ryanliu-terum/terum-skills` (`origin/main`). Every line number below is that
commit's. Author: Claude (spec writer), 2026-09-10. Audience: an OpenAI Codex agent with no conversation
context. Everything you need is in this file; nothing is "as discussed elsewhere".

---

## 0. Summary

1. Teddy (2026-09-10): "in the onboarding flow also allow for the option to have all skills evaluated, and
   also the option to have skills automatically found (build the functionality too)."
2. Two new **optional, opt-in steps of the CLI `setup` wizard** — `discover` (find folders on this machine
   that hold `.claude/skills`, and register them) and `evals` (evaluate every shared skill that has no
   receipt for its current version) — so the terminal wizard and the desktop app get them from one code path.
3. One new public verb, `checkout discover`, which is the same discovery engine on its own, plus a new
   `src/lib/discover.ts` traversal library.
4. Desktop: two new `SetupBoot` rows, two new `SETUP_STEP_KEYS`, one new seam method
   `Backend.checkouts.discover(...)`, and a "Find skills…" control in Settings ▸ This machine ▸ Checkouts.
5. Frame protocol: `FRAME_VERBS += 'checkout discover'`, `FRAME_FEATURES.discover = true`, and the first
   verbs in this product that actually emit `progress` frames (through a new optional `Prompter.progress`).

---

## 1. Bugs / asks closed

| id | reporter's words | user-visible symptom today |
|---|---|---|
| ASK-DISCOVER | Teddy, 2026-09-10: "also the option to have skills automatically found (build the functionality too)" | Setup never looks for skill folders. A new machine ends with only `~/.claude/skills` in the library; every project checkout must be typed by hand into `checkout add` or Settings ▸ Checkouts. On Teddy's Windows box the folders live under `\\wsl.localhost\Ubuntu\home\teniroo\Projects`, so the hand-typing is a UNC path. |
| ASK-EVALS | Teddy, 2026-09-10: "in the onboarding flow also allow for the option to have all skills evaluated" | Setup never offers to evaluate. Every shared skill must be evaluated one at a time with `eval <skill>`; a freshly joined machine has no way to say "score everything the team shares". |

Neither is a defect in existing behaviour; both are missing capability. Nothing below changes what setup
does when the person declines.

---

## 2. Root cause — where onboarding actually runs (evidence, quoted at 9fb73e9)

**2.1 The mock's drawn six-step wizard never shows in the real app.** `desktop/src/backend/tauri/index.ts:506-507`:

```ts
    async surfaces(): Promise<Surfaces> {
      return { divergence: false, status: true, settings: true, onboarding: false, library: true, skill: true, receipts: true, inbox: false, catalog: true, roster: true, update: true, checkouts:true };
```

and `desktop/src/backend/tauri/index.ts:522`:

```ts
    onboarding: async () => gap('Onboarding data'),
```

`desktop/GAPS.md:21` records "The drawn 14-board flow is final (Teddy)". **Do not touch `OnboardingScreen.tsx`,
`OnboardingFlow`, or any `Onboarding*` board.**

**2.2 The real app's onboarding is `SetupBoot` driving the CLI `setup` verb over frames.**
`desktop/src/screens/onboarding/SetupBoot.tsx:8-11`:

```tsx
const rows: readonly [SetupStep, string][] = [
 ['github','Checking GitHub access'], ['team','Configuring the team'],
 ['actions','Offering local skills'], ['hook','Offering the session hook and Claude Code skill'],
];
```

`desktop/src/backend/setup-session.ts:91` spawns it (`run = backend.setup({...})`) and
`desktop/src/backend/tauri/index.ts:670` maps it to the CLI:

```ts
    setup: (args: SetupArgs) => run(['setup', ...(args.target ? ['--', args.target] : [])], cliSetup, (value): SetupResult => ({ team: value.team, role: value.role, steps: value.steps ?? null }), ['config', 'clone', 'placed']),
```

So: **one CLI code path, two front ends.** Both new steps go in `src/commands/setup.ts`.

**2.3 The CLI has no discovery of any kind.** `src/lib/local-skills.ts:48` `localSkillRoots(home, cwd, checkouts, extraRoots)`
only assembles roots it is *told about* — `~/.claude/skills`, the registered `config.checkouts`, and the
nearest git root of `cwd`. Nothing walks the filesystem looking for `.claude/skills`. Verified:
`grep -rn "discover" src/` at 9fb73e9 returns nothing outside test names.

**2.4 The CLI has no batch eval.** `src/cli.ts:140` registers `eval <skill>` only; `src/commands/eval.ts:67`
`run(args, io)` evaluates exactly one `args.ref`. There is no `--all`.

**2.5 No verb emits `progress` today.** `src/lib/frames.ts:22-23`:

```ts
/** Reserved: no verb emits progress yet (the CLI has no progress events); the shape is fixed so a shell can render it when one does. */
export interface ProgressFrame { t: 'progress'; step: string; current?: number; total?: number; }
```

and `src/lib/prompt.ts:17-29` — the `Prompter` a verb is handed has **no way to emit one**:

```ts
export interface Prompter {
  readonly interactive: boolean;
  readonly channel?: 'terminal' | 'frames';
  confirm(question: string, options?: AskOptions): Promise<boolean>;
  text(question: string, defaultValue?: string, options?: AskOptions): Promise<string>;
  select(question: string, choices: readonly string[], defaultChoice?: string, options?: AskOptions): Promise<string>;
  print(line: string): void;
}
```

The ESLint rule named at `src/lib/prompt.ts:8-10` ("Verbs never touch process.stdin / stdout / console")
means the `Prompter` is the **only** channel out of a verb. So this batch must add the emitter (§6.1).
The desktop half already works: `desktop/src/backend/tauri/run.ts:121` translates it and
`desktop/src/screens/onboarding/SetupBoot.tsx:27,33` renders it.

**2.6 The Settings ▸ Checkouts group is real-adapter-only, so it is on no locked board.** It is gated at
`desktop/src/screens/settings/SettingsContent.tsx:78` on `features?.checkouts&&surfaces?.checkouts===true`,
and the mock answers `checkouts:false` (`desktop/src/backend/mock/index.ts:107`). The fidelity oracle
renders the **mock**, so `SettingsMachine` (`desktop/FIDELITY.md:71`, locked) does not draw this group.
`desktop/src/screens/settings/settings.test.tsx:361` proves it: *"hides Checkouts on the mock machine board"*.

**2.7 `SetupBoot` is also on no locked board.** `desktop/src/screens/onboarding/OnboardingScreen.tsx:39`
renders it only when a launch context exists:

```tsx
 if(step==='boot'&&ctx&&(decide(ctx,consumed,status.data)==='boot'||existingSetupSession(backend,ctx)))return <SetupBoot key={ctx.writtenAt} launch={ctx}/>;
```

and the mock returns none (`desktop/src/backend/mock/index.ts:98`: `async launchContext(){return null;}`).
The locked rows `OnboardingBoot` (`desktop/FIDELITY.md:85`) and `OnboardingError` (`:97`), both at route
`#/onboarding/boot`, therefore render the **drawn** boot body at `OnboardingScreen.tsx:89`
(`<ProgressCard rows={d.bootRows} placed={3} total={d.BOOT_STEPS}/>`), not `SetupBoot`.
**Consequence: adding rows to `SetupBoot` moves no locked board.** No `FIDELITY.md` row is flipped by this batch.

---

## 3. Decisions taken

Each is closed here. Do not re-open any of them; implement exactly as written.

**D1. Both features are steps of the CLI `setup` wizard, not app-only screens.**
Why: `AGENTS.md` "one path per behaviour"; the app mirrors the wizard through the existing frame relay
(§2.2), so the terminal and the app get identical behaviour from one implementation.

**D2. Discovery lives in a new library `src/lib/discover.ts`; `checkout discover` and the setup step are its
only two callers.** Why: two callers need it; a private helper inside `checkout.ts` would force `setup.ts` to
import a command for a pure filesystem walk.

**D3. `discoverSkillRoots` takes `config: Pick<Config,'shared'|'placements'>` and reports each candidate's
`skillFolders` with the SAME code `checkout list` uses** — `localSkills()` + `localSkillCounts()`
(`src/lib/local-skills.ts:101,180`), exactly as `src/commands/checkout.ts:42-43` does. Why: two different
definitions of "how many skill folders does this folder hold" printed by two sibling verbs is the
duplicate-path failure `CLAUDE.md:31` forbids. This adds `config` (and an internal one-shot
`canonicalLedger`) to the brief's signature — see §14 brief correction BC-2.

**D4. Candidate test is cheap; the count is expensive and runs only for candidates.** A directory `D` is a
candidate iff `D !== home` and `<D>/.claude/skills/<name>/SKILL.md` exists as a regular file for at least one
`<name>`. The cheap test stops at the first hit. Only then does `localSkills` read every `SKILL.md` in that
folder. Why: the expensive read must not run for every scanned directory under a home folder.

**D5. Symlinks are never followed, and that falls out of `readdir(dir,{withFileTypes:true})`**: a symlink to a
directory reports `isSymbolicLink() === true` and `isDirectory() === false`, so enqueueing only entries where
`entry.isDirectory()` is true already excludes them. Why: no extra `lstat` per entry, and a symlink loop
cannot occur. (Node ≥ 18 `Dirent` semantics; asserted by a test, §7 A5.)

**D6. Directory names are matched case-insensitively against the skip set.** Why: Windows is
case-insensitive, so `AppData` / `APPDATA` / `Node_Modules` must all skip; a Linux folder literally named
`Build` skipping too is an accepted, documented cost.

**D7. All dot-directories are skipped except `.claude`, which is probed but never enqueued.** Why: the brief's
rule; it also removes any need to special-case `.git`, `.cache`, `.npm`, `.venv`, `.terum`, `.vscode`,
`.idea`, `.Trash`. Those names stay in the exported constant as documentation.

**D8. Nothing under `stateRoot` (`~/.terum/skills`) is ever visited, tested with `underCheckout()`
(`src/lib/checkouts.ts:11`), never with a `root + '/'` prefix check.** Why: COMMON's Windows rule — a POSIX
`root + '/'` prefix check is a bug on `\\wsl.localhost\...` paths, and `underCheckout` uses `sep`.
`underCheckout` also refuses the `/tmp/x/.terum` vs `/tmp/x/.terumX` sibling confusion (test A15).

**D9. Nothing is fatal.** Every `readdir` failure (`EACCES`, `EPERM`, `ELOOP`, `ENOENT`, `ENOTDIR`, anything
else) is recorded in `problems` and the walk continues. A `--under` root that does not exist is a `problems`
entry, not a thrown error. Why: the brief; and a home folder always contains something unreadable.

**D10. The time budget is checked before each directory is read, so `budgetMs: 0` returns
`{candidates:[], scanned:0, truncated:true, problems:[]}` immediately.** Why: the brief names
"truncation by budget=0" as a required test; checking after the first read would scan one directory.

**D11. `signal.aborted` stops the walk and returns the partial result with `truncated: true`;
`discoverSkillRoots` never throws `AbortError`.** Why: a cancel is not a failure, the caller knows it
cancelled, and a partial answer is more useful than none. The signal is *polled*, never listened to, so no
listener leaks.

**D12. The frontier is walked eight directories at a time with `Promise.all`, mirroring
`src/commands/ls.ts:67-69`** (`for (let index = 0; index < records.length; index += 8) { const chunk = records.slice(index, index + 8); ... }`).
`candidates` and `problems` are sorted by `path` before returning, so output is deterministic. Why: the
brief pointed at `local-skills.ts` for a concurrency pattern, but that file is sequential (`for … await`,
`src/lib/local-skills.ts:120-168`); the chunk-of-8 pattern is the one the codebase actually uses. See BC-3.

**D13. `Prompter` gains ONE optional member, `progress?(update: ProgressUpdate): void`; `terminalPrompter`
does NOT implement it; `frameChannel().io` does.** Callers write `io.progress?.(…)`. Why: §2.5 — there is no
other channel out of a verb; making it optional means every existing `Prompter` implementation (including
`ScriptedPrompter` in `src/lib/__tests__/fixtures.ts:26` and `NonInteractivePrompter` at `:54`) still
compiles unchanged, and terminal output is byte-identical to today.

**D14. `FRAME_FEATURES.progress` stays `false`.** Contract C2 assigns that flip to batch `w02-perf`; editing
that key here would collide on the exact line `w02-perf` edits. `docs/frame-protocol.md` line 18 is reworded
instead (§4.9), because "No verb emits progress today" becomes false. Nothing in the desktop reads
`features.progress` at 9fb73e9 (verified: `grep -rn "FEATURE_KEYS\|features.*progress" desktop/src` finds
only the key list), so nothing is hidden by leaving it false.

**D15. `confirm` has no default and cannot express "default yes".** `src/lib/prompt.ts:97-101` renders every
confirm as `[y/N]` and returns true only for `y`/`yes`; `frameChannel`'s confirm (`src/lib/frames.ts:160-163`)
carries no `default` either. So **every new confirm defaults to NO (blank = no)**. Do not add a `default`
option to `confirm`: that would change `Prompter`, `AskFrame`, the desktop `Prompter` and the prompt dialog,
all of which other batches touch. See BC-4. (The eval confirm was specified default-NO by the brief anyway.)

**D16. Both new steps are skipped when the channel is not interactive** (`!io.interactive`), in addition to
`args.quiet` and the `--no-*` flags. Why: precedent at `src/commands/setup.ts:112` (the app step gates on
`!io.interactive`) and `src/commands/__tests__/setup.test.ts:26` ("connect's picker only prompts on an
interactive channel"). This also removes any `PromptClosedError` question from these steps. Note frame mode
sets `interactive: true` (`src/lib/frames.ts:158`), so the desktop app **does** get both steps.

**D17. Order in `setup.ts`: … `actions` → the "Next, from any terminal:" hint block → `discover` → `evals` →
`community` → `hook` → `wrapper` → `done`.** Why: `printedSetupStep` maps `'Next, from any terminal:'` to
`'actions'` (`desktop/src/backend/setup-session.ts:15`); running the new steps before that block would make
the app's active-step cue jump backwards. This keeps `activeStep` monotonic.

**D18. `Step` union and `SETUP_STEP_KEYS` insert `'discover','evals'` after `'invite'` and before
`'community'`.** That is simultaneously "after actions, before community" (the brief) and execution order.
Both lists must stay in the same order — `desktop/src/screens/onboarding/setup-driver.test.tsx:15` asserts
`Object.keys(SETUP_STEP_TO_BOARD)` equals `SETUP_STEP_KEYS`.

**D19. `SETUP_STEP_TO_BOARD` maps both new steps to `'Done'`** (the brief). The value set assertion at
`setup-driver.test.tsx:16` already contains `'Done'`, so it keeps passing.

**D20. Zero-candidate outcomes:** `discover` with zero candidates prints
`No skill folders found under <root>.` and records **`steps.discover = 'done'`** (the brief: the search did
happen). `evals` with zero candidates prints
`Every shared skill already has an eval receipt for its current version.` and records
**`steps.evals = 'skipped'`** (nothing was evaluated, so "Skipped" is the truthful row). The brief did not
specify the evals case; this is the conservative reading. See BC-6.

**D21. The eval preflight runs exactly once, after the person says yes, and its result is reused for every
skill in the batch** by passing a memoized function through the existing `EvalArgs.preflight` seam
(`src/commands/eval.ts:45`). Why: `preflight()` (`src/lib/evals/agent.ts:235-252`) spawns a **real agent
task** ("Reply with the single word: ok"), so running it once per skill would spend the person's Claude
account n extra times, and running it before the question would spend it without consent. This is the
`2026-09-09-eval-button-decision-walk.md` Decision 3 principle ("the app never spends that money without a
yes") applied to the wizard.

**D22. No `<estimate>` is printed.** `grep -rn "evalEstimate\|minutes" src/` at 9fb73e9 finds nothing in the
CLI (`EvalEstimate` exists only in `desktop/src/backend/types.ts:35`), so the CLI cannot price a run. The
parenthesis "(about N min in total)" is **omitted entirely** — never invented. This is
`2026-09-09-eval-button-decision-walk.md` Decision 3 (LOCK): "No invented numbers."

**D23. A skill whose newest receipt at the current version is schema-invalid is EXCLUDED from the batch,
with one printed warning.** Why: it has a receipt; re-running it automatically would spend money to
overwrite a human's problem. `src/commands/evalReport.ts:48-52` already treats this as a *warned* state
rather than "no receipt". A skill whose current version cannot be resolved is likewise excluded with a
printed line (`src/commands/ls.ts:73-76` prints the same class of problem).

**D24. The evals step is skipped, with a printed reason, when the configured team has no joined handle.**
Why: `commitEligibility` (`src/commands/eval.ts:335`) refuses `--commit` without a handle
(`Team X has no joined handle; run \`team join\` before committing an eval receipt.`), so every eval in the
batch would fail. Skipping is honest; asking would be a question we cannot honour.

**D25. Cancellation is NOT reimplemented.** A frames `cancel` reaches `src/index.ts:47`
(`onCancel: () => { process.kill(process.pid, 'SIGTERM'); }`); on POSIX that fires the handler at
`src/lib/evals/agent.ts:123-127`, which SIGKILLs live agent children and `process.exit(143)` — so the batch
stops **mid-skill**, not after the current skill, and no `result` frame arrives (documented at
`docs/frame-protocol.md:28`). Ctrl-C (SIGINT) terminates by default. **Install no signal handler.** See
BC-5 and §9 for Windows. Batch `w06-eval-lock` owns any cancellation fix; do not duplicate it.

**D26. Per-skill eval failures never abort the batch**: the error line is printed, `failed` is incremented,
the loop continues, and the run ends with the summary line and `steps.evals = 'done'`.

**D27. The desktop seam method is `Backend.checkouts.discover(args)`, inside the existing `checkouts` group.**
Why: `desktop/src/backend/Backend.ts:21` already groups `checkouts: { add; remove }`, `:23` groups
`projects: { create }`, and contract C3 puts the CLI verb inside the `checkout` group. A top-level
`Backend.discover` would be the only checkout-family method outside that group. The brief wrote
`Backend.discover`; see BC-1.

**D28. The Settings control is added to the Checkouts group in `case 'machine'`
(`desktop/src/screens/settings/SettingsContent.tsx:78`), gated additionally on `features?.discover`.** Per
§2.6 this group is invisible in the mock, so no locked board moves; per `desktop/AGENTS.md` invariant 2 a
false switch **hides** the control (never disables it), which is what an older CLI without the verb gets.

**D29. The real adapter passes `--under=<dir>`, not `--under <dir>`.** Why: a folder path may begin with `-`;
commander parses `--opt=value` as a value regardless of leading dashes, while `--opt value` would be read as
a missing argument. `--register` is a plain boolean flag.

**D30. `SetupBoot` does not draw a duplicate progress row for a step that already has one.** Since
`discover`/`evals` now have their own rows, the extra row pushed at `SetupBoot.tsx:27` would repeat them with
the raw step id as the label. §4.13 gives the exact three-line edit.

---

## 4. Changes per file

### 4.1 `src/lib/prompt.ts` — add the progress seam (D13)

Current, lines 17-29 (quoted in §2.5). Replace **only** the interface block with:

```ts
/** A verb's report that a long step has moved on. A terminal ignores it; frame mode writes one `progress` frame. */
export interface ProgressUpdate { step: string; current?: number; total?: number; }

export interface Prompter {
  readonly interactive: boolean;
  /**
   * What is on the other end: a terminal, or a program over frames (docs/frame-protocol.md). Verbs read it
   * only for the two questions that need a terminal and make no sense to a program: the app opt-in in
   * setup and the `gh auth login` offer (decision walk D5, 2026-09-08). Absent means terminal.
   */
  readonly channel?: 'terminal' | 'frames';
  confirm(question: string, options?: AskOptions): Promise<boolean>;
  text(question: string, defaultValue?: string, options?: AskOptions): Promise<string>;
  select(question: string, choices: readonly string[], defaultChoice?: string, options?: AskOptions): Promise<string>;
  print(line: string): void;
  /**
   * Optional: only a channel that can render progress implements it (frame mode does; a terminal does not,
   * because a verb that wants a person to see progress prints a line). Callers must use `io.progress?.(…)`.
   */
  progress?(update: ProgressUpdate): void;
}
```

`terminalPrompter`'s returned object (lines 94-125) is **unchanged**: it deliberately does not implement
`progress`.

### 4.2 `src/lib/frames.ts` — ProgressFrame reuse, the emitter, the verb, the feature

**(a)** Line 1 currently:

```ts
import { MAX_SELECT_ATTEMPTS, PromptClosedError, type Prompter } from './prompt.js';
```

becomes:

```ts
import { MAX_SELECT_ATTEMPTS, PromptClosedError, type Prompter, type ProgressUpdate } from './prompt.js';
```

**(b)** Lines 22-23 currently:

```ts
/** Reserved: no verb emits progress yet (the CLI has no progress events); the shape is fixed so a shell can render it when one does. */
export interface ProgressFrame { t: 'progress'; step: string; current?: number; total?: number; }
```

become:

```ts
/** Emitted by `checkout discover` and by `setup`'s discover/evals steps; every other verb is silent. One shape, declared once (Prompter.progress). */
export interface ProgressFrame extends ProgressUpdate { t: 'progress'; }
```

**(c)** Line 32 (`FRAME_VERBS`) — append `'checkout discover'` at the END of the array, before `] as const;`:

```ts
export const FRAME_VERBS = ['checkout add', 'checkout remove', 'checkout list', 'project create', 'login', 'setup', 'team create', 'team join', 'team remove', 'team leave', 'team workflow-update', 'invite', 'ls', 'status', 'publish', 'validate', 'eval', 'eval-report', 'connect', 'install', 'uninstall-skill', 'uninstall', 'sync', 'search', 'update', 'app', 'profile', 'decline', 'checkout discover'] as const;
```

(Contract C2: appended at the end. Batch `w08-refresh-receipts` appends `'refresh'` before it and
`w01-app-update` appends `'app-update'` after it; the orchestrator resolves the three-way append.)

**(d)** Lines 39-44 (`FRAME_FEATURES`) — add `discover: true` on a **new line** after the `progress: false,`
line. Do **not** edit the `progress: false` line itself (D14 / C2). Result:

```ts
export const FRAME_FEATURES: Readonly<Record<string, boolean>> = Object.freeze({
  checkouts: true, projects: true,
  memberRole: true, localIdentity: true, roles: true,
  favorites: false, follow: false, lastSeen: false, installScope: true, inviteScoping: false,
  disablePerMachine: false, projectMembers: false, liftOnCards: false, runEvalInApp: true, perCase: false, progress: false,
  discover: true,
});
```

**(e)** The `io: Prompter` object (lines 157-182) gains one member, immediately after `print(line) { … },`
(line 179-181), before the closing `};`:

```ts
    progress(update) {
      // Exactly one `result` frame ends a run (docs/frame-protocol.md); nothing may follow it.
      if (closed) return;
      writeFrame(output, { t: 'progress', ...update });
    },
```

### 4.3 `src/lib/discover.ts` — NEW FILE (precise skeleton; every exported signature given)

Behaviour contract (implement exactly):

```ts
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { underCheckout, checkoutPath } from './checkouts.js';
import { canonicalLedger, localSkillCounts, localSkills } from './local-skills.js';
import type { Config } from './schema.js';

export const DEFAULT_MAX_DEPTH = 4;
export const DEFAULT_BUDGET_MS = 20_000;
/** A progress report costs a frame; one every quarter second is enough for a person to see motion. */
export const PROGRESS_INTERVAL_MS = 250;
/** How many directories are read at once. Mirrors the chunk size ls uses for skill records (src/commands/ls.ts:67). */
export const SCAN_CONCURRENCY = 8;

/**
 * Folder names never worth walking, lowercased. Every dot-directory is skipped anyway (except `.claude`,
 * which is probed, never entered); the dotted names below are listed for the reader, not for the check.
 */
export const SKIPPED_DIRECTORIES: ReadonlySet<string>; // exactly, lowercased:
// '.git','node_modules','dist','build','out','target','.cache','.npm','.pnpm','.yarn','.venv','venv',
// '__pycache__','.terum','.vscode','.idea','library','appdata','snap','.trash','$recycle.bin',
// 'system volume information'

export interface DiscoverCandidate {
  /** The folder that holds `.claude/skills`, as `path.resolve` produced it (never realpath'd away). */
  path: string;
  /** Counted with the same code `checkout list` prints (localSkills + localSkillCounts). */
  skillFolders: number;
  /** Its canonical path is already in `config.checkouts`. */
  registered: boolean;
  /** It has a `.git` entry (file or directory). */
  repoRoot: boolean;
}
export interface DiscoverProblem { path: string; reason: string }
export interface DiscoverResult {
  candidates: DiscoverCandidate[];
  scanned: number;
  truncated: boolean;
  problems: DiscoverProblem[];
}
export interface DiscoverOptions {
  under: readonly string[];
  home: string;
  checkouts: readonly string[];
  stateRoot: string;
  /** The ledger halves `localSkills` needs; pass the whole config. */
  config: Pick<Config, 'shared' | 'placements'>;
  maxDepth?: number;
  budgetMs?: number;
  onProgress?: (progress: { scanned: number; found: number; current: string }) => void;
  signal?: AbortSignal;
  /** Test knob for the clock (precedent: EvalArgs.now, src/commands/eval.ts:46). */
  now?: () => number;
}

export async function discoverSkillRoots(options: DiscoverOptions): Promise<DiscoverResult>;
```

Algorithm, step by step:

1. `const now = options.now ?? Date.now;` `const started = now();`
   `const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;` `const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;`
2. `const ledger = await canonicalLedger(options.config);` (once).
   `const registered = new Set(await Promise.all(options.checkouts.map(checkoutPath)));`
   `const canonicalHome = await checkoutPath(options.home);`
3. Frontier: `let frontier = [...new Set(options.under.map((dir) => resolve(dir)))].map((dir) => ({ dir, depth: 0 }));`
   `const seen = new Set(frontier.map((entry) => entry.dir));`
4. Loop while `frontier.length > 0`:
   - If `options.signal?.aborted` → `truncated = true; break;`
   - If `now() - started >= budgetMs` → `truncated = true; break;` (**checked before any read**, so
     `budgetMs: 0` truncates with `scanned === 0`.)
   - Take the next `SCAN_CONCURRENCY` entries and `await Promise.all(chunk.map(visit))`; the remainder plus
     everything `visit` enqueued becomes the next frontier.
5. `visit({dir, depth})`:
   - `scanned += 1`.
   - `let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { problems.push({ path: dir, reason: error instanceof Error ? error.message : String(error) }); return; }`
   - `repoRoot = entries.some((entry) => entry.name === '.git')`.
   - Candidate probe: if `entries.some((entry) => entry.name === '.claude' && entry.isDirectory())` **and**
     `resolve(dir) !== resolve(options.home)` **and** `await checkoutPath(dir) !== canonicalHome`, call
     `hasSkillFolder(join(dir,'.claude','skills'))`; on true push a candidate (see 6).
   - Children: for every `entry` where `entry.isDirectory()` is true (this excludes symlinks, D5) and
     `entry.name !== '.claude'` and `!entry.name.startsWith('.')` and
     `!SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())`, let `child = join(dir, entry.name)`; skip when
     `depth + 1 > maxDepth`, when `seen.has(child)`, or when `underCheckout(child, options.stateRoot)`;
     otherwise `seen.add(child)` and enqueue `{ dir: child, depth: depth + 1 }`.
   - Progress: `maybeProgress(dir)` — call `options.onProgress?.({ scanned, found: candidates.length, current: dir })`
     only when `now() - lastProgress >= PROGRESS_INTERVAL_MS`, then set `lastProgress = now()`.
6. `hasSkillFolder(skillsRoot)`: `readdir(skillsRoot,{withFileTypes:true})` (errors → `problems`, return
   false); for each `entry.isDirectory()`, `stat(join(skillsRoot, entry.name, 'SKILL.md'))` and return true on
   the first `isFile()`; `ENOENT`/`ENOTDIR` are not problems (just "not a skill folder"), any other error is
   pushed to `problems`. On true, compute
   `const inventory = await localSkills(skillsRoot, options.config, { scope: 'project', stateRoot: options.stateRoot, ledger });`
   `const skillFolders = localSkillCounts(inventory).skillFolders;` and push
   `{ path: resolve(dir), skillFolders, registered: registered.has(await checkoutPath(dir)), repoRoot }`.
7. Before returning: fire `options.onProgress?.({ scanned, found: candidates.length, current: '' })` once
   unconditionally (so the last count is always reported), then sort:
   `candidates.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);` and the same for `problems`.
   Return `{ candidates, scanned, truncated, problems }`.

Notes the implementation must honour:
- `stateRoot` containment uses `underCheckout` **only** (D8). Never `child.startsWith(stateRoot + '/')`.
- Path handling is `node:path` only — `join`, `resolve`, `sep`. No string surgery on separators (a UNC root
  `\\wsl.localhost\Ubuntu\home\teniroo\Projects` must survive `resolve` unchanged on Windows).
- `checkoutPath` (`src/lib/checkouts.ts:10`) already falls back to `resolve` when `realpath` throws, which is
  what a UNC path or a deleted folder does. Use it; never call `realpath` directly.
- **Do not put the literal string `terum-skills` anywhere in this file** — see §8 note on the invocation
  tripwire.

### 4.4 `src/commands/checkout.ts` — the `discover` kind

Current lines 10-11:

```ts
export interface CheckoutArgs extends WithForm { kind: 'add' | 'remove' | 'list'; path?: string; config?: ConfigStore; home?: string; cwd?: string; }
export type CheckoutResult = { path: string; registered: boolean } | { path: string; placementsRemaining: number } | { checkouts: { path: string; rootState: LocalInventory['rootState']; skillFolders: number }[] };
```

become:

```ts
export interface CheckoutArgs extends WithForm { kind: 'add' | 'remove' | 'list' | 'discover'; path?: string; under?: string[]; depth?: number; budgetMs?: number; register?: boolean; config?: ConfigStore; home?: string; cwd?: string; }
export type CheckoutResult = { path: string; registered: boolean } | { path: string; placementsRemaining: number } | { checkouts: { path: string; rootState: LocalInventory['rootState']; skillFolders: number }[] } | DiscoverResult;
```

Imports to add at the top of the file:

```ts
import { DEFAULT_BUDGET_MS, DEFAULT_MAX_DEPTH, discoverSkillRoots, type DiscoverResult } from '../lib/discover.js';
import { printable } from '../lib/skill-source.js';
```

and widen the existing `import { fromError, success, type Result } from '../lib/result.js';` (line 8) to
`import { failure, fromError, success, type Result } from '../lib/result.js';`.

Insert this block **after** the `remove` branch (i.e. after current line 39, before current line 40
`const config = await store.read(); const ledger = await canonicalLedger(config);` which is the `list` tail):

```ts
    if (args.kind === 'discover') {
      const depth = args.depth ?? DEFAULT_MAX_DEPTH;
      if (!Number.isInteger(depth) || depth < 0) return failure('--depth must be a non-negative integer.');
      const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS;
      if (!Number.isInteger(budgetMs) || budgetMs < 0) return failure('--budget-ms must be a non-negative integer.');
      const home = args.home ?? homedir();
      const cwd = args.cwd ?? process.cwd();
      const roots = (args.under?.length ? args.under : [home]).map((dir) => resolve(cwd, dir));
      const config = await store.read();
      const found = await discoverSkillRoots({
        under: roots, home, checkouts: config.checkouts ?? [], stateRoot: store.root, config,
        maxDepth: depth, budgetMs,
        onProgress: (progress) => io.progress?.({ step: 'discover', current: progress.scanned }),
      });
      io.print(`Looked in ${found.scanned} folders under ${roots.map(printable).join(', ')}…`);
      for (const candidate of found.candidates) io.print(`${printable(candidate.path)} — ${candidate.skillFolders} skill folders${candidate.registered ? ' · already registered' : ''}`);
      if (!found.candidates.length) io.print('none found');
      if (found.truncated) io.print(`(stopped after ${Math.round(budgetMs / 1000)} s; pass --budget-ms to look longer)`);
      for (const problem of found.problems) io.print(`Could not look in ${printable(problem.path)}: ${printable(problem.reason)}`);
      if (args.register) {
        for (const candidate of found.candidates) {
          if (candidate.registered) continue;
          try {
            await registerCheckout(store, candidate.path, io, { home, explicit: true });
            candidate.registered = true;
          } catch (error) {
            io.print(`Could not register ${printable(candidate.path)}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      return success(found);
    }
```

`homedir` and `resolve` and `registerCheckout` are already imported (lines 1, 2, 4).

Note: `checkout list` at line 45 prints the fixed plural `skill folders`; the line above matches it
deliberately — do NOT add singular/plural handling (one house style per verb family).

### 4.5 `src/cli.ts` — register `checkout discover` after `checkout list` (C3)

Current lines 73-74:

```ts
  checkout.command('list').description('List registered checkout folders')
    .action(async () => execute(io => active.checkout({ form: context.form, kind: 'list' }, io), { verb: 'checkout list', notices: true }));
```

Insert immediately after them (still inside the `checkout` group, before `const project = …` at line 76):

```ts
  checkout.command('discover').description('Look for folders on this machine that hold Claude Code skills; --register adds the ones that are not in your library yet')
    .option('--under <dir>', 'folder to look under; repeat for more (default: your home folder)', (value: string, previous: string[] = []) => [...previous, value])
    .option('--depth <n>', 'how many folder levels below each root to look (default 4)', Number)
    .option('--budget-ms <n>', 'how long to look, in milliseconds (default 20000)', Number)
    .option('--register', 'register every folder found that is not already in your library')
    .action(async (options: { under?: string[]; depth?: number; budgetMs?: number; register?: boolean }) => execute(io => active.checkout({ form: context.form, kind: 'discover', ...options, cwd: process.cwd() }, io), { verb: 'checkout discover', notices: true }));
```

The `verb` string must be exactly `'checkout discover'` (it is the `result` frame's `verb`, and
`src/__tests__/frames-cli.test.ts:71` asserts `result.verb.startsWith(verb.split(' ')[0])`).

### 4.6 `src/commands/eval.ts` — export the pending-receipt selector

Add to the imports at the top:

```ts
import { newestReceiptAt } from './receiptCheck.js';
import { skillVersions } from '../lib/teamRepo.js';
```

(`src/commands/evalReport.ts:12` already imports `newestReceiptAt` from `./receiptCheck.js`, so
command→command is the established direction; `openTeamRepo, refreshClone, treeText` are already imported
from `../lib/teamRepo.js` at line 25 — extend that import rather than adding a second one.)

Add this exported function at the end of the file:

```ts
export interface PendingEval { id: string; name: string; version: string }

/**
 * The team's shared skills whose CURRENT version carries no committed receipt — the batch `setup` offers to
 * run. Read-only and offline: it reads the clone as it stands (no fetch, no library disk scan), using the
 * same three readers `ls` and `eval-report` use — skillRecords (src/lib/skills.ts:23), skillVersions
 * (src/lib/teamRepo.ts:279) and newestReceiptAt (src/commands/receiptCheck.ts:100).
 *
 * A skill is EXCLUDED (with a reported line) when its current version cannot be resolved, or when the
 * newest receipt at that version exists but is schema-invalid: it has a receipt, and re-running it
 * automatically would spend the person's Claude account on someone else's problem.
 */
export async function skillsWithoutReceipt(clone: string, team: string, runner: Runner, report: (line: string) => void): Promise<PendingEval[]> {
  const records = await skillRecords(clone, team, { onProblem: ({ name, message }) => report(`${name}: ${message}`) });
  let versionProblem: string | undefined;
  const versions = await skillVersions(runner, clone).catch((error: unknown) => { versionProblem = error instanceof Error ? error.message : String(error); return new Map<string, string>(); });
  const pending: PendingEval[] = [];
  for (const record of records) {
    const version = versions.get(record.name);
    if (version === undefined) { report(`${record.name}: could not resolve the current version${versionProblem === undefined ? ': absent from HEAD:skills' : `: ${versionProblem}`}`); continue; }
    try {
      if (await newestReceiptAt(join(clone, 'evals', record.id, version)) === undefined) pending.push({ id: record.id, name: record.name, version });
    } catch (error) {
      report(`${record.name}: the newest receipt for the current version is invalid (${error instanceof Error ? error.message : String(error)}); evaluate it on its own when you have time.`);
    }
  }
  return pending;
}
```

`skillRecords` is already imported at line 24; `join` at line 5; `Runner` at line 21. `skillVersions` returns
the same 40-hex tree hash `resolveVersion` returns (`src/lib/teamRepo.ts:298` parses
`^\d+\s+tree\s+([0-9a-f]{40})\t(.+)$` from `ls-tree HEAD:skills`;
`src/lib/version.ts` `resolveVersion` returns `git rev-parse --verify HEAD:skills/<name>` lowercased), and
that hash is the `version` segment of `receiptPath` (`src/lib/evals/receipt.ts:91-93`). No behaviour of
`run()` changes.

### 4.7 `src/commands/setup.ts` — the two new steps

**(a) Imports.** Add:

```ts
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { registerCheckout } from '../lib/checkouts.js';
import { discoverSkillRoots } from '../lib/discover.js';
import { preflight as systemPreflight } from '../lib/evals/agent.js';
import { printable } from '../lib/skill-source.js';
import { run as evalRun, skillsWithoutReceipt, type EvalArgs } from './eval.js';
```

There is no import cycle: nothing under `src/commands/` imports `setup.js` statically
(`grep -rn "from './setup.js'" src/` finds only `src/commands/install.ts:79`, which uses a **deferred**
`await import('./setup.js')`), and `eval.ts` imports neither `setup.ts` nor `install.ts`.

**(b) `SetupVerbs`.** Current lines 22-29 gain one member:

```ts
export interface SetupVerbs {
  team: typeof team;
  connect: (args: ConnectArgs, io: Prompter) => Promise<Result<ConnectOutcome | undefined>>;
  app: typeof runApp;
  invite: typeof invite;
  offerHook: typeof defaultOfferHook;
  offerWrapper: typeof defaultOfferWrapper;
  eval: typeof evalRun;
}
```

and line 95 becomes:

```ts
  const verbs: SetupVerbs = { team, connect, app: runApp, invite, offerHook: defaultOfferHook, offerWrapper: defaultOfferWrapper, eval: evalRun, ...args.verbs };
```

**(c) `SetupArgs`.** Add three fields beside the existing `app?: boolean` (line 33):

```ts
  /** `false` (--no-discover) skips the offer to look for skill folders on this machine. */
  discover?: boolean;
  /** `false` (--no-evals) skips the offer to evaluate every shared skill that has no receipt. */
  evals?: boolean;
  /** Test knob for the agent probe; defaults to the real one. Mirrors EvalArgs.preflight (src/commands/eval.ts:45). */
  preflight?: EvalArgs['preflight'];
```

**(d) `Step` union.** Line 52 becomes (D18):

```ts
type Step = 'welcome' | 'app' | 'role' | 'github' | 'team' | 'actions' | 'invite' | 'discover' | 'evals' | 'community' | 'hook' | 'wrapper' | 'done';
```

**(e) Module-level copy constants**, added beside `ROLE_QUESTION` (line 67):

```ts
export const DISCOVER_QUESTION = 'Look for skill folders on this machine and add them to your library?';
export const DISCOVER_WHERE_QUESTION = 'Look under which folder?';
export const DISCOVER_START_LINE = 'Looking for skill folders on this machine…';
/** No estimate is printed: this CLI computes none, and an invented number is forbidden (eval-button decision walk, Decision 3). */
export function evalsQuestion(count: number): string {
  return `Evaluate the ${count} shared ${count === 1 ? 'skill' : 'skills'} that ${count === 1 ? 'has' : 'have'} no receipt yet? This runs Claude on each one and commits each receipt to the team repo.`;
}
```

**(f) The steps themselves.** Current lines 231-238 are the hint block, ending with:

```ts
    say(`  ${invocation(args.form, 'connect')}      — connect your local skills to the team (asks which)`);
```

Insert the following **immediately after that line** and **before** line 240
(`const communityUrl = args.communityUrl ?? COMMUNITY_URL;`):

```ts
    // Discover (Teddy, 2026-09-10): opt-in, never fatal, and only where a person can answer. A non-interactive
    // channel gets neither question, the same rule the app step above follows (§D5, 2026-09-08).
    if (args.quiet || args.discover === false || !io.interactive) steps.discover = 'skipped';
    else {
      io.print(DISCOVER_START_LINE);
      try {
        if (!(await io.confirm(DISCOVER_QUESTION))) steps.discover = 'skipped';
        else {
          const home = args.home ?? homedir();
          const root = resolve(args.cwd ?? process.cwd(), await io.text(DISCOVER_WHERE_QUESTION, home));
          const config = await store.read();
          const found = await discoverSkillRoots({
            under: [root], home, checkouts: config.checkouts ?? [], stateRoot: store.root, config,
            onProgress: (progress) => io.progress?.({ step: 'discover', current: progress.scanned }),
          });
          for (const candidate of found.candidates) io.print(`${printable(candidate.path)} — ${candidate.skillFolders} skill folders${candidate.registered ? ' · already registered' : ''}`);
          for (const problem of found.problems) io.print(`Could not look in ${printable(problem.path)}: ${printable(problem.reason)}`);
          if (found.truncated) io.print(`(stopped early; run \`${invocation(args.form, 'checkout discover --budget-ms 60000')}\` to look longer)`);
          const unregistered = found.candidates.filter((candidate) => !candidate.registered);
          if (found.candidates.length === 0) io.print(`No skill folders found under ${printable(root)}.`);
          else if (unregistered.length > 0) {
            const all = await io.confirm(`Add all ${unregistered.length}?`);
            for (const candidate of unregistered) {
              if (!all && !(await io.confirm(`Add ${printable(candidate.path)}?`))) continue;
              try { await registerCheckout(store, candidate.path, io, { home }); }
              catch (error) { io.print(`Could not register ${printable(candidate.path)}: ${error instanceof Error ? error.message : String(error)}`); }
            }
          }
          steps.discover = 'done';
        }
      } catch (error) {
        // A wizard that finished every durable step must not fail on an optional search.
        io.print(`Could not look for skill folders: ${error instanceof Error ? error.message : String(error)}`);
        steps.discover = 'skipped';
      }
    }

    // Evals (Teddy, 2026-09-10): offer to score every shared skill whose current version has no receipt.
    // Default NO; the agent probe runs once, only after the yes, and its result is reused for the batch.
    if (args.quiet || args.evals === false || !io.interactive || teamName === '') steps.evals = 'skipped';
    else {
      try {
        const handle = (await store.read()).teams[teamName]?.handle;
        if (!handle) {
          io.print('Skipping the eval offer: this machine has no joined handle for the team yet, so a receipt could not be committed.');
          steps.evals = 'skipped';
        } else {
          const candidates = await skillsWithoutReceipt(clone, teamName, runner, (line) => io.print(line));
          if (candidates.length === 0) {
            io.print('Every shared skill already has an eval receipt for its current version.');
            steps.evals = 'skipped';
          } else if (!(await io.confirm(evalsQuestion(candidates.length)))) steps.evals = 'skipped';
          else {
            const probe = await (args.preflight ?? systemPreflight)();
            if (!probe.ok) {
              io.print(`Skipping the evals: ${probe.error}`);
              steps.evals = 'skipped';
            } else {
              // One agent probe for the whole batch: every run uses the same (default) model, so the
              // per-run preflight would repeat an identical paid call n times (src/lib/evals/agent.ts:235).
              const reuse: EvalArgs['preflight'] = async () => probe;
              let evaluated = 0;
              let failed = 0;
              for (const [index, candidate] of candidates.entries()) {
                io.print(`Evaluating ${index + 1} of ${candidates.length} · ${candidate.name}`);
                io.progress?.({ step: 'evals', current: index + 1, total: candidates.length });
                const outcome = await verbs.eval({ form: args.form, ref: candidate.name, team: teamName, commit: true, config: store, runner, preflight: reuse }, io);
                if (outcome.ok) evaluated += 1;
                else { failed += 1; io.print(outcome.error); }
              }
              io.print(`Evaluated ${evaluated} of ${candidates.length}; ${failed} failed.`);
              steps.evals = 'done';
            }
          }
        }
      } catch (error) {
        io.print(`Could not evaluate the shared skills: ${error instanceof Error ? error.message : String(error)}`);
        steps.evals = 'skipped';
      }
    }
```

`clone` is in scope from line 182 (`const clone = store.teamClone(teamName);`); `store`, `runner`, `verbs`,
`steps` from lines 93-96.

### 4.8 `src/cli.ts` — the two setup flags

Current lines 61-66:

```ts
  program
    .command('setup [target]')
    .description('Onboarding wizard: on a new machine, asks whether to create a team or join one; re-run to resume your team; pass <org>/<repo> or a remote URL to join directly (one team per machine: leave the current team first)')
    .option('--app', 'open the desktop app (the default wherever one exists)')
    .option('--no-app', 'keep setup in the terminal; do not open the desktop app')
    .action(async (target: string | undefined, options: { app?: boolean }) => execute((io) => active.setup({ form: context.form, target, app: options.app, cwd: process.cwd() }, io), { verb: 'setup', notices: true }));
```

become:

```ts
  program
    .command('setup [target]')
    .description('Onboarding wizard: on a new machine, asks whether to create a team or join one; re-run to resume your team; pass <org>/<repo> or a remote URL to join directly (one team per machine: leave the current team first)')
    .option('--app', 'open the desktop app (the default wherever one exists)')
    .option('--no-app', 'keep setup in the terminal; do not open the desktop app')
    .option('--no-discover', 'do not offer to look for skill folders on this machine')
    .option('--no-evals', 'do not offer to evaluate the shared skills that have no receipt')
    .action(async (target: string | undefined, options: { app?: boolean; discover?: boolean; evals?: boolean }) => execute((io) => active.setup({ form: context.form, target, app: options.app, discover: options.discover, evals: options.evals, cwd: process.cwd() }, io), { verb: 'setup', notices: true }));
```

(Commander's `--no-x` sets `options.x = false` and leaves it `true` otherwise; the setup code only tests
`=== false`, so `true` and `undefined` behave identically.)

### 4.9 `docs/frame-protocol.md` — two required edits (both are gated by tests)

**(a) Line 18**, currently:

```
| `progress` | `{"t":"progress","step":"...","current":n,"total":n}` | Reserved. No verb emits progress today (`features.progress` is `false`); the shape is fixed so a shell can render it when one does. |
```

becomes:

```
| `progress` | `{"t":"progress","step":"...","current":n,"total":n}` | Optional and rare. `checkout discover` and `setup`'s `discover` and `evals` steps emit it; every other verb is silent. `step` names the step (`discover`, `evals`); `current` counts what is done so far and `total` appears only when the verb knows it. `features.progress` stays `false`: it advertises a determinate bar for every long verb, which this CLI does not have. Ignoring progress frames is always safe. |
```

**(b) Line 72** — required by `src/lib/__tests__/frames.test.ts` "CP-19: every feature is named in the
protocol features sentence", which asserts the sentence starting `` `hello.features` names `` contains
`` `discover` ``. Change its first clause and append one sentence:

- in the list `…, `memberRole`, `localIdentity`, `checkouts`, and `projects`.` → `…, `memberRole`, `localIdentity`, `checkouts`, `projects`, and `discover`.`
- append at the end of the paragraph: `` `discover` is true and means the `checkout discover` verb exists and `setup` offers to look for skill folders on this machine; a shell whose CLI reports it false hides the "find skills" control. ``

**(c) Optional but preferred** — append to the "Verbs added for the desktop app" section (after line 83):

```
`checkout discover [--under <dir>…] [--depth <n>] [--budget-ms <n>] [--register]` looks for folders that hold `.claude/skills`. `result.value` is `{ candidates: { path, skillFolders, registered, repoRoot }[], scanned, truncated, problems: { path, reason }[] }`. It follows no symlinks, enters no dot-directory but `.claude`, never descends into `~/.terum`, and never offers the home folder itself. Unreadable folders land in `problems`; a run that hits its time budget sets `truncated`. `--register` adds every candidate that is not registered yet and sets its `registered` to true in the result. While it runs it emits `progress` frames with `step: "discover"` and `current` = folders scanned.
```

### 4.10 `desktop/src/backend/types.ts`

**(a) Line 12** (`FEATURE_KEYS`) — append `'discover'` at the END of the array (contract C2 order:
`refresh` from w08, then `discover`, then `appUpdate` from w01):

```ts
export const FEATURE_KEYS = ['favorites','follow','roles','lastSeen','installScope','inviteScoping','disablePerMachine','projectMembers','liftOnCards','runEvalInApp','perCase','progress','memberRole','localIdentity','checkouts','projects','discover'] as const;
```

**(b) Line 109** (`SETUP_STEP_KEYS`) — insert `'discover','evals'` after `'invite'` (D18):

```ts
export const SETUP_STEP_KEYS = ['welcome','app','role','github','team','actions','invite','discover','evals','community','hook','wrapper','done'] as const;
```

**(c)** Add these three interfaces beside `CheckoutAdded` (line 63):

```ts
export interface DiscoverCandidate {path:string;skillFolders:number;registered:boolean;repoRoot:boolean}
export interface DiscoverResult {candidates:DiscoverCandidate[];scanned:number;truncated:boolean;problems:{path:string;reason:string}[]}
export interface DiscoverArgs {under?:string[];register?:boolean}
```

### 4.11 `desktop/src/backend/Backend.ts` — one method in the existing group (D27)

Line 21, currently:

```ts
  checkouts: { add(path:string):Run<CheckoutAdded>; remove(path:string):Run<CheckoutRemoved> };
```

becomes:

```ts
  /** `discover` looks for folders holding `.claude/skills`; it is available only where `features().discover` is true. */
  checkouts: { add(path:string):Run<CheckoutAdded>; remove(path:string):Run<CheckoutRemoved>; discover(args:DiscoverArgs):Run<DiscoverResult> };
```

Add `DiscoverArgs, DiscoverResult` to the type import on line 1.

### 4.12 `desktop/src/backend/tauri/index.ts` — the adapter (contract C4: only the seam method)

Add the schema beside `cliCheckoutAdded` (line 58):

```ts
const cliDiscover = z.object({candidates:z.array(z.object({path:z.string(),skillFolders:z.number(),registered:z.boolean(),repoRoot:z.boolean()})),scanned:z.number(),truncated:z.boolean(),problems:z.array(z.object({path:z.string(),reason:z.string()}))});
```

Line 571, currently:

```ts
    checkouts:{add:path=>run(['checkout','add','--',path],cliCheckoutAdded,v=>v,['config']),remove:path=>run(['checkout','remove','--',path],cliCheckoutRemoved,v=>v,['config'])},
```

becomes:

```ts
    checkouts:{add:path=>run(['checkout','add','--',path],cliCheckoutAdded,v=>v,['config']),remove:path=>run(['checkout','remove','--',path],cliCheckoutRemoved,v=>v,['config']),discover:args=>run(['checkout','discover',...(args.register?['--register']:[]),...(args.under??[]).map(dir=>`--under=${dir}`)],cliDiscover,v=>v,['config'])},
```

`--under=<dir>` (not `--under <dir>`) so a folder whose name starts with `-` is still a value (D29). No other
line of `index.ts` changes (contract C4).

### 4.13 `desktop/src/screens/onboarding/SetupBoot.tsx`

**(a)** Lines 8-11 become:

```tsx
const rows: readonly [SetupStep, string][] = [
 ['github','Checking GitHub access'], ['team','Configuring the team'],
 ['actions','Offering local skills'], ['discover','Looking for skill folders on this machine'],
 ['evals','Evaluating shared skills'], ['hook','Offering the session hook and Claude Code skill'],
];
```

**(b)** Line 20, currently `const steps=result?.value?.steps;`, gains one line after it (D30):

```tsx
 const progress=state.progress, progressRow=progress?rows.find(([key])=>key===progress.label):undefined;
```

**(c)** Line 27, currently:

```tsx
 if(state.progress)cardRows.push(['running',state.progress.label??'Setup progress','']);
```

becomes:

```tsx
 if(progress&&!progressRow)cardRows.push(['running',progress.label??'Setup progress','']);
```

**(d)** Line 33 `placed`/`total` and line 34's live region use the local `progress`, and the live region
prefers the row's human label over the raw step id:

```tsx
  <ProgressCard label="Setup progress" rows={cardRows} placed={progress?.done??null} total={progress?.total??null} failed={failed}/>
  <div role="status" aria-live="polite">{result?(result.ok?state.outcome==='handoff'?'Ask your team owner to invite you.':'Setup finished.':result.error):progressRow?.[1]??progress?.label??current??'Setup is running.'}</div>
```

Nothing else in the file changes. Keep the file's dense, blank-line-free style.

### 4.14 `desktop/src/backend/setup-session.ts`

**(a)** `SETUP_STEP_TO_BOARD` (lines 7-10) — insert the two keys **between `invite` and `community`**, so the
key order still equals `SETUP_STEP_KEYS`:

```ts
export const SETUP_STEP_TO_BOARD = {
 welcome:'Welcome', app:'Style', role:'Team', github:'Team', team:'Team', actions:'Basics',
 invite:'Team', discover:'Done', evals:'Done', community:'Feedback', hook:'Done', wrapper:'Done', done:'Done',
} as const satisfies Record<SetupStep, string>;
```

**(b)** `printedSetupStep` (lines 11-21) — add two branches after the `'Next, from any terminal:'` branch
(wizard order), **and tighten the existing wrapper rule**. Replace the whole function with:

```ts
export function printedSetupStep(line:string):SetupStep|null {
 if(line.startsWith('Welcome to terum-skills.')||line.startsWith("Your team's skills")||line.startsWith('This wizard'))return 'welcome';
 if(line.startsWith('GitHub'))return 'github';
 if(line.startsWith('Identity:')||line.startsWith('Team ')||line.startsWith('Joined '))return 'team';
 if(line.startsWith('Next, from any terminal:')||line.startsWith('Connected '))return 'actions';
 if(line.startsWith('Looking for skill folders')||line.startsWith('No skill folders found')||line.startsWith('Could not look')||/ — \d+ skill folders( · already registered)?$/.test(line))return 'discover';
 if(line.startsWith('Evaluating ')||line.startsWith('Evaluated ')||line.startsWith('Every shared skill already has')||line.startsWith('Skipping the eval'))return 'evals';
 if(line.startsWith('Feedback and requests:'))return 'community';
 if(line.includes('session hook'))return 'hook';
 if(line.includes('/terum-skills Claude Code skill')||line.includes('/terum-skills skill'))return 'wrapper';
 if(line.startsWith('Members:')||line.startsWith('Repository:')||line.startsWith('README:'))return 'done';
 return null;
}
```

Three things about this function are load-bearing; do not simplify them away.

1. **The candidate-line regex.** The discover step prints file paths for the first time in this wizard, in
   the shape `` `<path> — <n> skill folders[ · already registered]` `` (S2). Matching that shape is how those
   lines join the `discover` step; `—` is U+2014 and `·` is U+00B7, exactly as §5 prints them.
2. **The wrapper rule is tightened from `line.includes('/terum-skills')&&line.includes('skill')` to
   `line.includes('/terum-skills Claude Code skill')||line.includes('/terum-skills skill')`.** The old rule
   fires on any path containing `/terum-skills` — and the reporter's own machine has
   `…/Projects/SSM/terum-skills`, which discovery now prints, so a discovered folder would flip the app's
   active step to `wrapper`. The six lines `src/lib/wrapper.ts:131-140` prints all contain one of the two
   tightened phrases (`/terum-skills Claude Code skill` at 131, 133, 134, 140; `/terum-skills skill` at 132
   and 136), so every existing case in `desktop/src/backend/__tests__/setup-steps.test.ts:3-8` still passes.
3. **`Registered <path> in your library.` deliberately stays unmatched (null).** `connect` also calls
   `registerCheckout` (`src/commands/connect.ts:9`) during the `actions` step, so mapping that line to
   `discover` would move the cue backwards for a connect-time registration. An unmatched line leaves
   `activeStep` where it was (`desktop/src/backend/setup-session.ts:98`), which is correct in both steps.

**(c)** `askedSetupStep` (lines 22-24):

```ts
export function askedSetupStep(question:string):SetupStep|null {
 if(question==='Use this identity?')return 'team';
 if(question==='Look for skill folders on this machine and add them to your library?'||question==='Look under which folder?'||question.startsWith('Add all ')||/^Add .+\?$/.test(question))return 'discover';
 if(question.startsWith('Evaluate the '))return 'evals';
 return null;
}
```

### 4.15 `desktop/src/backend/mock/index.ts`

**(a)** `checkouts` (line 113) gains `discover`:

```ts
  checkouts:{add:path=>long('settings',async ctx=>{ctx.print('Registered '+path);for(const listener of listeners)listener('config');return ok({path,registered:true});}),remove:path=>long('settings',async ctx=>{ctx.print('Forgot '+path);for(const listener of listeners)listener('config');return ok({path,placementsRemaining:0});}),discover:()=>long('settings',async()=>ok({candidates:[],scanned:0,truncated:false,problems:[]}))},
```

The mock invents no folders: it has no filesystem, and a fabricated candidate would be fixture data
presented as a real machine's contents.

**(b)** `setup` (line 184) models the two questions and returns `steps`:

```ts
  setup:args=>long('share',async ctx=>{ctx.print('Setting up terum-skills…');const choice=await ctx.ask('select','Create a team or join one?',{choices:['Create a new team','Join an existing team']});const role=choice==='Create a new team'?'creator' as const:'joiner' as const;const team=args.target??design.TEAM_REPO;let connected:ConnectOutcome|undefined;if(args.offerConnect!==false){const picked=await connectPicker(ctx,team);if(!picked.ok)return fail(picked.error);connected=picked.value;}const steps:NonNullable<SetupResult['steps']>={role:'done',team:'done',actions:connected?'done':'skipped'};ctx.print('Looking for skill folders on this machine…');if(await ctx.ask('confirm','Look for skill folders on this machine and add them to your library?')){await ctx.ask('text','Look under which folder?','~');ctx.print('No skill folders found under ~.');steps.discover='done';}else steps.discover='skipped';steps.evals=await ctx.ask('confirm','Evaluate the 1 shared skill that has no receipt yet? This runs Claude on each one and commits each receipt to the team repo.')?'done':'skipped';return ok({team,role,...(connected?{connected}:{}),steps});}),
```

Add `SetupResult` to the type import on line 9 (`import type { ConnectBatch, ConnectOutcome, InviteResult, Result, Roster, Run, SearchHit, SetupResult, SkillCard } from '../types';`).

### 4.16 `desktop/src/screens/settings/SettingsContent.tsx` — "Find skills…" (D28)

Add state and the action beside line 29-30:

```tsx
  const [found,setFound]=useState<DiscoverCandidate[]>([]);
  const [foundNote,setFoundNote]=useState<string|null>(null);
  function findSkills(){void action.run(()=>backend.checkouts.discover({register:false}),{},value=>{setFound(value.candidates);setFoundNote([value.candidates.length?null:'No skill folders found.',value.truncated?'Stopped early; some folders were not looked at.':null,value.problems.length?`${value.problems.length} folders could not be read.`:null].filter(Boolean).join(' ')||null);});}
```

Add `DiscoverCandidate` to the type import on line 9.

Inside the Checkouts `<Card>` on line 78, **after** the existing `Add a checkout…` row and before `</Card>`:

```tsx
{features?.discover?<><Row title="Find skills…" desc="Look for folders on this machine that hold .claude/skills, then add the ones you want."><Button icon="search" disabled={action.busy} onClick={findSkills}>Find skills…</Button></Row>{foundNote===null?null:<Row title={foundNote}/>}{found.map(candidate=><Row key={candidate.path} title={candidate.path} desc={`${candidate.skillFolders} skill folders${candidate.registered?' · already registered':''}`}>{candidate.registered?null:<Button disabled={action.busy} onClick={()=>void action.run(()=>backend.checkouts.add(candidate.path),{},()=>setFound(rows=>rows.map(row=>row.path===candidate.path?{...row,registered:true}:row)))}>Add</Button>}</Row>)}</>:null}
```

`search` is a real icon key in the generated design fixture (verified:
`Object.keys(design.ICON_PATHS)` contains `search`). Keep the file's dense style; do not reformat any other line.

---

## 5. Copy strings (verbatim; every user-visible string this batch adds)

CLI, `checkout discover` (`src/commands/checkout.ts`):

| # | string (template) | where |
|---|---|---|
| S1 | `` `Looked in ${found.scanned} folders under ${roots.map(printable).join(', ')}…` `` | first line of every run. Fixed plural "folders", matching `checkout list` (checkout.ts:45). |
| S2 | `` `${printable(candidate.path)} — ${candidate.skillFolders} skill folders${candidate.registered ? ' · already registered' : ''}` `` | one per candidate |
| S3 | `none found` | when there are no candidates |
| S4 | `` `(stopped after ${Math.round(budgetMs / 1000)} s; pass --budget-ms to look longer)` `` | when `truncated` |
| S5 | `` `Could not look in ${printable(problem.path)}: ${printable(problem.reason)}` `` | one per problem |
| S6 | `` `Could not register ${printable(candidate.path)}: ${…message}` `` | `--register` failure, per folder |
| S7 | `--depth must be a non-negative integer.` | failing Result |
| S8 | `--budget-ms must be a non-negative integer.` | failing Result |

Registration lines come from the existing `registerCheckout` (`src/lib/checkouts.ts:43-44`) unchanged:
`Registered <path>` / `Already registered <path>` with `explicit: true`, and
`Registered <path> in your library.` without it (setup uses the latter).

CLI, `setup` discover step (`src/commands/setup.ts`):

| # | string | where |
|---|---|---|
| S9 | `Looking for skill folders on this machine…` | printed before the offer; drives the app's `discover` row |
| S10 | `Look for skill folders on this machine and add them to your library?` | confirm (renders `[y/N]`; blank = no — D15) |
| S11 | `Look under which folder?` | text, default = the home folder |
| S12 | S2 (identical template) | one per candidate |
| S13 | S5 (identical template) | one per problem |
| S14 | `` `(stopped early; run \`${invocation(args.form, 'checkout discover --budget-ms 60000')}\` to look longer)` `` | when `truncated` |
| S15 | `` `No skill folders found under ${printable(root)}.` `` | zero candidates |
| S16 | `` `Add all ${unregistered.length}?` `` | confirm |
| S17 | `` `Add ${printable(candidate.path)}?` `` | confirm, per folder, only when S16 was declined |
| S18 | `` `Could not register ${printable(candidate.path)}: ${…message}` `` | per folder |
| S19 | `` `Could not look for skill folders: ${…message}` `` | any thrown error; step becomes `skipped` |

CLI, `setup` evals step:

| # | string | where |
|---|---|---|
| S20 | `Skipping the eval offer: this machine has no joined handle for the team yet, so a receipt could not be committed.` | D24 |
| S21 | `Every shared skill already has an eval receipt for its current version.` | zero candidates |
| S22 (n>1) | `` `Evaluate the ${count} shared skills that have no receipt yet? This runs Claude on each one and commits each receipt to the team repo.` `` | confirm, default no |
| S22 (n=1) | `Evaluate the 1 shared skill that has no receipt yet? This runs Claude on each one and commits each receipt to the team repo.` | same confirm, singular |
| S23 | `` `Skipping the evals: ${probe.error}` `` | preflight failed after the yes |
| S24 | `` `Evaluating ${index + 1} of ${candidates.length} · ${candidate.name}` `` | one per skill (the `·` is U+00B7, as used in `SkillScreen`/settings copy) |
| S25 | `` `Evaluated ${evaluated} of ${candidates.length}; ${failed} failed.` `` | summary |
| S26 | `` `${record.name}: could not resolve the current version: absent from HEAD:skills` `` (or `: <git error>`) | `skillsWithoutReceipt` report |
| S27 | `` `${record.name}: the newest receipt for the current version is invalid (${…}); evaluate it on its own when you have time.` `` | `skillsWithoutReceipt` report |
| S28 | `` `Could not evaluate the shared skills: ${…message}` `` | any thrown error; step becomes `skipped` |

CLI help text (`src/cli.ts`):

| # | string |
|---|---|
| S29 | `Look for folders on this machine that hold Claude Code skills; --register adds the ones that are not in your library yet` |
| S30 | `folder to look under; repeat for more (default: your home folder)` |
| S31 | `how many folder levels below each root to look (default 4)` |
| S32 | `how long to look, in milliseconds (default 20000)` |
| S33 | `register every folder found that is not already in your library` |
| S34 | `do not offer to look for skill folders on this machine` |
| S35 | `do not offer to evaluate the shared skills that have no receipt` |

Desktop:

| # | string | where |
|---|---|---|
| S36 | `Looking for skill folders on this machine` | `SetupBoot` row label |
| S37 | `Evaluating shared skills` | `SetupBoot` row label |
| S38 | `Find skills…` | Settings button label and row title (the `…` is U+2026) |
| S39 | `Look for folders on this machine that hold .claude/skills, then add the ones you want.` | Settings row description |
| S40 | `No skill folders found.` | Settings note after a run with no candidates |
| S41 | `Stopped early; some folders were not looked at.` | Settings note when `truncated` |
| S42 | `` `${value.problems.length} folders could not be read.` `` | Settings note when problems exist |
| S43 | `` `${candidate.skillFolders} skill folders${candidate.registered?' · already registered':''}` `` | Settings candidate row description |
| S44 | `Add` | Settings per-candidate button (matches the existing detected-checkout button on line 78) |

The mock reuses S9/S10/S11/S15 and the singular S22 verbatim.

---

## 6. Types and seam changes

### 6.1 CLI (`src/lib/prompt.ts`, `src/lib/frames.ts`)

```ts
// prompt.ts — NEW
export interface ProgressUpdate { step: string; current?: number; total?: number; }
// prompt.ts — Prompter gains, as the ONLY change to the interface:
  progress?(update: ProgressUpdate): void;

// frames.ts — CHANGED (same structural shape, one declaration)
export interface ProgressFrame extends ProgressUpdate { t: 'progress'; }
```

`FRAME_VERBS` gains `'checkout discover'` at the end; `FRAME_FEATURES` gains `discover: true` on a new line.
`FRAME_PROTOCOL` stays `1` — `docs/frame-protocol.md:74` says so explicitly: *"Additive changes (new optional
fields, new `features` keys, a verb starting to emit `progress`) do not bump it."*

### 6.2 CLI (`src/lib/discover.ts`, `src/commands/checkout.ts`, `src/commands/eval.ts`, `src/commands/setup.ts`)

See §4.3 (`DiscoverCandidate` / `DiscoverProblem` / `DiscoverResult` / `DiscoverOptions`), §4.4
(`CheckoutArgs.kind` widened; `CheckoutResult` union gains `DiscoverResult`), §4.6 (`PendingEval`,
`skillsWithoutReceipt`), §4.7 (`SetupVerbs.eval`, `SetupArgs.discover/evals/preflight`, the `Step` union).

### 6.3 Desktop seam (`desktop/src/backend/types.ts`, `Backend.ts`)

```ts
export interface DiscoverCandidate {path:string;skillFolders:number;registered:boolean;repoRoot:boolean}
export interface DiscoverResult {candidates:DiscoverCandidate[];scanned:number;truncated:boolean;problems:{path:string;reason:string}[]}
export interface DiscoverArgs {under?:string[];register?:boolean}
// Backend.checkouts gains: discover(args:DiscoverArgs):Run<DiscoverResult>
```

`FEATURE_KEYS` gains `'discover'`; `SETUP_STEP_KEYS` gains `'discover','evals'`. `Surfaces`,
`Capabilities`, `SetupArgs` and `SetupResult` are unchanged — `SetupResult.steps` is already
`Partial<Record<SetupStep,'done'|'skipped'|'printed'>>` and picks up the new keys, and the adapter's
`cliSetup` schema (`desktop/src/backend/tauri/index.ts:46`) is built from `SETUP_STEP_KEYS`, so it needs no
edit.

The desktop `Prompter` (`desktop/src/backend/types.ts:6`) is **unchanged** and still has exactly five
members — `desktop/AGENTS.md` invariant 1 holds. Progress reaches the app as a `Frame`, not through the
prompter (`desktop/src/backend/tauri/run.ts:121`).

Real-adapter behaviour on an older CLI: `features()` (`desktop/src/backend/tauri/index.ts:498-501`) maps a
missing `hello.features` key to `false`, so `features.discover` is false and the Settings control is hidden
(invariant 2). Nothing calls `checkouts.discover` in that state.

---

## 7. Tests

All new root tests use the existing bare-repo/temp-dir fixtures in `src/lib/__tests__/fixtures.ts`
(`temporaryDirectory`, `bareTeam`, `cloneWithIdentity`, `mappedRunner`, `fakeGh`, `ScriptedPrompter`).
All new desktop tests use vitest + Testing Library, exactly like the files they sit beside.

### A. `src/lib/__tests__/discover.test.ts` — NEW

Build the tree with `temporaryDirectory()` + `mkdir`/`writeFile`. A helper
`skillAt(root, name)` writes `<root>/.claude/skills/<name>/SKILL.md` with valid frontmatter (copy the shape
from `src/commands/__tests__/setup.test.ts:18-22`). Every call passes
`config: { shared: {}, placements: {} }` unless the test says otherwise.

| # | `it(…)` title | arrange / act / assert |
|---|---|---|
| A1 | `finds a folder that holds .claude/skills and counts its skill folders` | `home/projects/alpha` with two skills, `home/projects/beta` with one. Act: `discoverSkillRoots({under:[home],home,checkouts:[],stateRoot,config})`. Assert: two candidates sorted by path, `skillFolders` 2 and 1, `truncated` false, `problems` empty, `scanned >= 3`. |
| A2 | `never offers the home folder itself, even when it holds .claude/skills` | `skillAt(home,'x')` and one real candidate below. Assert: candidates contain only the child; `home` is absent. |
| A3 | `stops at maxDepth and reports nothing deeper` | candidate at `home/a/b/c/d/e` (depth 5). Act with `maxDepth: 4`. Assert: no candidates. Act again with `maxDepth: 5`. Assert: exactly that one. |
| A4 | `skips node_modules, dist, AppData and every dot-directory except .claude` | candidates planted under `home/node_modules/x`, `home/NODE_MODULES/y`, `home/dist/z`, `home/AppData/w`, `home/.hidden/v`, and one under `home/keep/ok`. Assert: exactly one candidate, `home/keep/ok`. (Proves D6's case-insensitivity and D7.) |
| A5 | `does not follow a symlinked directory, so a symlink loop terminates` | `home/real/alpha` is a candidate; `symlink(home, home/real/loop)` and `symlink(home/real/alpha, home/link)`. Assert: the run returns, `truncated` false, and `candidates.map(c=>c.path)` equals `[home/real/alpha]` — the symlinked copy is not reported. Skip the whole test on `process.platform === 'win32'` (symlink needs elevation). |
| A6 | `records an unreadable folder in problems and keeps scanning` | `chmod(home/locked, 0o000)`; a candidate under `home/open/alpha`. Assert: the candidate is found and `problems` has one entry whose `path` is `home/locked` and whose `reason` contains `EACCES`. Skip on win32 and when `process.getuid?.() === 0` (root can read anything); restore the mode in a `finally`. |
| A7 | `marks a candidate already in config.checkouts as registered` | pass `checkouts:[home/projects/alpha]`. Assert: that candidate has `registered:true`, the other `false`. |
| A8 | `reports repoRoot for a .git directory and for a .git file` | `mkdir(alpha/.git)`, `writeFile(beta/.git,'gitdir: …')`, `gamma` with neither. Assert: `repoRoot` true, true, false. |
| A9 | `a zero budget returns truncated with nothing scanned` | `budgetMs: 0`. Assert exactly `{candidates:[],scanned:0,truncated:true,problems:[]}`. |
| A10 | `never descends into the state root` | `stateRoot = home/.terum/skills`; plant a candidate at `home/.terum/skills/teams/t/checkout`. Assert: no candidates and no problems mentioning that path. |
| A11 | `an aborted signal stops the walk and reports truncated` | `const controller = new AbortController(); controller.abort();` Assert: `truncated:true`, `candidates` empty, and no rejection. |
| A12 | `records a missing root as a problem instead of throwing` | `under:[join(home,'no-such-folder')]`. Assert: resolves; `problems` has one entry with that path and an `ENOENT` reason; `candidates` empty. |
| A13 | `reports progress at most once per interval and always once at the end` | inject `now` returning a controlled counter that advances 10 ms per call; collect `onProgress` calls. Assert: no two consecutive reports are less than `PROGRESS_INTERVAL_MS` apart, and the last call has `current === ''` and `scanned` equal to the result's `scanned`. |
| A14 | `returns candidates and problems sorted by path` | three candidates created in a non-alphabetical order plus two unreadable folders. Assert both arrays are sorted ascending. |
| A15 | `does not treat a sibling of the state root as inside it` | `stateRoot = home/.terum`; plant a candidate at `home/.terumX/alpha` — but note `.terumX` is a dot-directory, so instead use `stateRoot = home/state` and a candidate at `home/stateX/alpha`. Assert: the candidate IS found. (This is the `root + '/'` prefix bug class COMMON names for Windows paths.) |
| A16 | `a .claude/skills that holds only files is not a candidate` | `writeFile(home/a/.claude/skills/README.md)` only. Assert: no candidates, no problems. |
| A17 | `a folder inside a candidate can itself be a candidate` | `home/mono` is a candidate and `home/mono/packages/web` is another. Assert: both are returned. |
| A18 | `a .claude/skills whose only entry has no SKILL.md is not a candidate` | `mkdir(home/a/.claude/skills/empty)` with nothing inside. Assert: no candidates. |

### B. `src/commands/__tests__/checkout.test.ts` — EXTEND (new `it`s only; change nothing existing)

| # | `it(…)` title | assertions |
|---|---|---|
| B1 | `checkout discover lists every candidate with its count and returns the structure` | a temp home with two candidates; `run({kind:'discover',under:[home],home,config:store,cwd:home}, io)` on a `ScriptedPrompter`. Assert `io.lines[0]` matches `/^Looked in \d+ folders under /`, one line per candidate ending `— 1 skill folders`, and `result.value.candidates` has length 2. |
| B2 | `checkout discover prints none found when nothing matches` | empty home. Assert `io.lines` contains exactly `none found` and `candidates` is `[]`. |
| B3 | `checkout discover --register registers the unregistered candidates and leaves the registered one alone` | one candidate already in `config.checkouts`, one not. Assert: `(await store.read()).checkouts` gains exactly one path; `io.lines` contains `Registered <path>` once and `Already registered` never (registered candidates are skipped before `registerCheckout`); the returned candidates both have `registered: true`. |
| B4 | `checkout discover --budget-ms 0 says it stopped early` | Assert `io.lines` contains `(stopped after 0 s; pass --budget-ms to look longer)` and `truncated` is true. |
| B5 | `checkout discover refuses a negative depth and a fractional budget` | `{kind:'discover',depth:-1}` → `{ok:false,error:'--depth must be a non-negative integer.'}`; `{kind:'discover',budgetMs:1.5}` → `{ok:false,error:'--budget-ms must be a non-negative integer.'}`. Assert no filesystem walk happened (a candidate exists but `value` is absent). |
| B6 | `checkout discover reports an unreadable folder and still succeeds` | `chmod 0o000` (skip on win32/root). Assert result `ok`, and one `Could not look in …` line. |
| B7 | `checkout discover emits progress frames with step discover` | drive it with `frameChannel({input,output}).io` (the harness at `src/lib/__tests__/frames.test.ts:10-27` is the model). Assert at least one frame equals `{t:'progress',step:'discover',current:<number>}` and that no frame carries `total`. |
| B8 | `checkout discover keeps its own registration failure out of the result` | make `registerCheckout` fail by pointing a candidate at the home root — instead, assert the catch by registering a candidate that is deleted between discovery and registration is impractical; use a `ConfigStore` whose `update` throws once (wrap `store.update`). Assert: result `ok`, one `Could not register …` line, `registered` still false for that candidate. |

### C. `src/lib/__tests__/frames.test.ts` — ONE CHANGED assertion + new `it`s

**Changed (C9 declaration):** the `expect(FRAME_FEATURES).toEqual({…})` object at lines 35-39 gains
`discover: true`. Reason: this batch adds a feature key, and that assertion is an exact-shape lock whose whole
point is that a new key must be declared. No assertion is removed or loosened.

New:

| # | `it(…)` title | assertions |
|---|---|---|
| C1 | `progress frames carry the step and only the numbers the verb knows` | `s.channel.io.progress?.({step:'evals',current:2,total:5})` then `{step:'discover',current:7}`. Assert the two frames are exactly `{t:'progress',step:'evals',current:2,total:5}` and `{t:'progress',step:'discover',current:7}` — no `total` key on the second. |
| C2 | `progress after the result frame is dropped` | `s.channel.result({verb:'setup',ok:true,exitCode:0})` then `s.channel.io.progress?.({step:'evals',current:1})`. Assert the frame list ends at the result. |
| C3 | `the terminal prompter reports no progress channel` | `expect(terminalPrompter({input,output}).progress).toBeUndefined()` and assert `output` received nothing. |

### D. `src/__tests__/frames-cli.test.ts` — ONE REQUIRED addition

The `INVOCATIONS` map (line 23-29) must gain `'checkout discover': ['checkout', 'discover'],` — the test at
line 60 (`expect(INVOCATIONS[verb], \`no invocation for ${verb}\`).toBeDefined()`) fails otherwise. This is an
addition demanded by the new FRAME_VERB, not a weakening.

### E. `src/commands/__tests__/setup.test.ts` — EXTEND

Every case builds on the existing `configuredCreator(...)` / `freshCreator()` helpers (lines 51-78) and the
`AnsweringPrompter` at lines 24-49. Where a case needs the new confirms, extend that prompter's `confirms`
map with the new question prefixes (`Look for skill folders`, `Add all `, `Add `, `Evaluate the `) — adding
map entries changes no existing expectation.

Discover:

| # | `it(…)` title | assertions |
|---|---|---|
| E1 | `setup offers discovery, registers every candidate, and records steps.discover done` | plant two candidates under the test home; answer the discover confirm yes, the folder question blank (takes the default home), `Add all 2?` yes. Assert `(await store.read()).checkouts` has both paths, `result.value.steps.discover === 'done'`, and the printed lines include `Looking for skill folders on this machine…`. |
| E2 | `declining the discovery offer registers nothing and records skipped` | confirm no. Assert `checkouts` is unchanged/absent, `steps.discover === 'skipped'`, and `Look under which folder?` was never asked. |
| E3 | `declining Add all falls back to one confirm per folder` | `Add all 2?` no, `Add <a>?` yes, `Add <b>?` no. Assert exactly one path registered and both per-folder questions were asked. |
| E4 | `quiet setup never asks about discovery` | `quiet:true`. Assert `steps.discover === 'skipped'` and the prompter was never asked `Look for skill folders…`. |
| E5 | `--no-discover never asks about discovery` | `discover:false`. Same assertions as E4. |
| E6 | `a non-interactive channel skips both new steps` | run with `NonInteractivePrompter` (`src/lib/__tests__/fixtures.ts:54`). Assert `steps.discover === 'skipped'` and `steps.evals === 'skipped'` and setup still returns `ok`. |
| E7 | `zero candidates print the no-folders line and record done` | empty home. Assert the printed line `No skill folders found under <root>.` and `steps.discover === 'done'`. |
| E8 | `the folder question honours an edited answer` | answer the text question with a sibling directory that holds the only candidate; assert the candidate under the home default was NOT registered and the sibling's was. |
| E9 | `a discovery failure is printed and setup still succeeds` | inject failure by passing a `home` whose value is a FILE, not a directory (so `readdir` throws `ENOTDIR`) — assert the run is `ok`, `steps.discover === 'done'` with one `Could not look in …` problem line (a `readdir` failure is a problem, not a throw), then separately stub `verbs`-level failure is unnecessary. Additionally assert the catch-all by making `store.read()` throw once: `Could not look for skill folders: …` is printed and `steps.discover === 'skipped'`, and `result.ok` is true. |

Evals:

| # | `it(…)` title | assertions |
|---|---|---|
| E10 | `setup offers the eval batch only for shared skills with no receipt at the current version` | bare team seeded with two skills; commit a valid receipt for skill A at its current tree hash (`evals/<idA>/<version>/20260101T000000Z.json`). Assert the confirm question is `Evaluate the 1 shared skill that has no receipt yet? …` (singular form). |
| E11 | `accepting runs eval once per candidate with commit true and reports the summary` | stub `verbs.eval` to record its args and return `success({...})`. Assert it was called once per candidate, every call carries `commit: true`, `team: <team>` and a `preflight` function, the printed lines contain `Evaluating 1 of 2 · <name>` and `Evaluated 2 of 2; 0 failed.`, and `steps.evals === 'done'`. |
| E12 | `a failed eval is printed and the batch continues` | stub `verbs.eval` to fail on the first candidate and succeed on the second. Assert both were called, the error line was printed, the summary is `Evaluated 1 of 2; 1 failed.`, `steps.evals === 'done'`, and `result.ok` is true. |
| E13 | `declining the eval offer runs no eval` | confirm no. Assert the stub was never called and `steps.evals === 'skipped'`. |
| E14 | `quiet setup and --no-evals never ask` | two cases (`quiet:true`, `evals:false`). Assert the question was never asked and `steps.evals === 'skipped'`. |
| E15 | `a failing preflight after the yes is printed and the step is skipped` | `preflight: async () => failure('claude is not runnable')`. Assert `Skipping the evals: claude is not runnable` is printed, the eval stub was never called, `steps.evals === 'skipped'`, `result.ok` is true. |
| E16 | `the agent probe runs exactly once for the whole batch` | count `preflight` invocations across two candidates. Assert the count is 1, and that the function handed to `verbs.eval` resolves to the same value. |
| E17 | `a skill whose only receipt is for an older version is still a candidate` | commit a receipt under a different (older) 40-hex directory. Assert it appears in the question's count. |
| E18 | `a skill with a schema-invalid newest receipt is excluded with a warning` | write `{"schema_version":1}` (invalid) at the current version. Assert the printed line contains `the newest receipt for the current version is invalid` and that the skill is NOT in the offered count; when it is the only skill, `Every shared skill already has an eval receipt for its current version.` is printed and `steps.evals === 'skipped'`. |
| E19 | `a machine with no joined handle skips the eval step` | configure the team without `handle`. Assert the S20 line is printed, `steps.evals === 'skipped'`, no confirm asked. |
| E20 | `progress frames name the evals step with current and total` | run setup with `frameChannel().io`. Assert the frame stream contains `{t:'progress',step:'evals',current:1,total:2}` and `{…current:2,total:2}`. |

Also add one unit test file `src/commands/__tests__/skills-without-receipt.test.ts` (or extend
`src/commands/__tests__/eval.test.ts`) for `skillsWithoutReceipt` alone:

| # | `it(…)` title | assertions |
|---|---|---|
| E21 | `skillsWithoutReceipt returns the skills whose current tree hash has no receipt` | as E10/E17 but calling the function directly; assert the returned `version` equals `git rev-parse HEAD:skills/<name>`. |
| E22 | `skillsWithoutReceipt reports a skill absent from HEAD:skills instead of offering it` | create `skills/x/SKILL.md` on disk but do not commit it. Assert it is reported (`could not resolve the current version`) and not returned. |

### F. Desktop tests

| # | file | `it(…)` title | assertions |
|---|---|---|---|
| F1 | `desktop/src/backend/__tests__/setup-steps.test.ts` (EXTEND the `it.each` table) | `maps printed step %s to its drawn tour step` | add rows `['Looking for skill folders on this machine…','Done']`, `['No skill folders found under ~.','Done']`, `['/Users/you/code/mrf — 3 skill folders','Done']`, `['/Users/you/code/mrf — 1 skill folders · already registered','Done']`, `['Could not look in /Users/you/Library: EACCES','Done']`, `['Evaluating 1 of 2 · deploy-check','Done']`, `['Evaluated 2 of 2; 0 failed.','Done']`. |
| F2 | same file, NEW `it` | `maps the discover and evals questions to their steps` | `askedSetupStep('Look for skill folders on this machine and add them to your library?')` → `'discover'`; `askedSetupStep('Look under which folder?')` → `'discover'`; `askedSetupStep('Add all 2?')` → `'discover'`; `askedSetupStep('Add /Users/you/code/mrf?')` → `'discover'`; `askedSetupStep('Evaluate the 3 shared skills that have no receipt yet? …')` → `'evals'`; `askedSetupStep('Join this team?')` → `null`. |
| F3 | same file, NEW `it` | `does not mistake a discovered folder path for the wrapper step` | `printedSetupStep('/home/teniroo/Projects/SSM/terum-skills — 4 skill folders')` → `'discover'`; `printedSetupStep('Registered /home/teniroo/Projects/SSM/terum-skills in your library.')` → `null` (it must not steal the `actions` cue from `connect`); `printedSetupStep('Evaluating 1 of 1 · terum-skills')` → `'evals'`; and the six wrapper lines still map to `'wrapper'`: `'The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at /x); skipped.'`, `'/x exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.'`, `'The /terum-skills Claude Code skill at /x is current.'`, `'Updated the /terum-skills Claude Code skill at /x.'`, `'Skipped the /terum-skills skill; re-run setup to install it later.'`, `'Installed the /terum-skills Claude Code skill at /x.'` (all six copied verbatim from `src/lib/wrapper.ts:131-140`). This test is the guard on the tightened rule in §4.14b. |
| F4 | `desktop/src/screens/onboarding/setup-driver.test.tsx` **CHANGED** | rename `uses four result-driven rows without inventing a progress counter` → `uses six result-driven rows without inventing a progress counter` and change `toHaveLength(4)` to `toHaveLength(6)` | Reason (C9): the row count is part of this feature — the CLI now reports two more steps and `SetupBoot` draws a row per step. Every other assertion in that test is untouched. |
| F5 | same file, NEW `it` | `shows a discover progress counter on its own row instead of a seventh row` | mock `b.setup` with `createRun(async ctx=>{ctx.print('Looking for skill folders on this machine…');ctx.progress(12,0,'discover');return {ok:true,value:{team:'t',role:'creator',steps:{discover:'done'}}};})`. Assert `.onboarding-progress-row` count is 6 (not 7) while the run is live, that the row titled `Looking for skill folders on this machine` carries `data-state="current"` before the result lands, and that `screen.getByRole('status')` reads `Looking for skill folders on this machine`, never the raw `discover`. |
| F6 | same file, NEW `it` | `still shows an unknown progress label as its own row` | emit `ctx.progress(1,2,'placing')`. Assert the row count is 7 and the extra row's text is `placing` (proves §4.13c did not remove the fallback). |
| F7 | `desktop/src/backend/__tests__/mock.test.ts` **CHANGED** (line 33) | `returns fixture-shaped results for successful verbs` | change the setup call's answer callback from `()=> 'Join an existing team'` to `frame=>frame.kind==='confirm'?false:'Join an existing team'`. Reason (C9): the mock's `setup` now asks two confirms, and `createRun.answer` rejects a string answer to a confirm (`desktop/src/backend/mock/run.ts:37`); the helper already receives the frame, so using it is the minimal fix. The assertion (`.ok` is `true`) is unchanged. |
| F8 | same file, NEW `it` | `models the discover and evals questions and reports both step outcomes` | drive `b.setup({offerConnect:false})` answering every confirm `true` and the text ask `''`; assert the result's `steps` contains `discover:'done'` and `evals:'done'`; then drive it again answering every confirm `false` and assert `discover:'skipped'`, `evals:'skipped'`. |
| F9 | same file, NEW `it` | `discovers nothing in the mock` | `expect(await createMockBackend().checkouts.discover({}).done).toEqual({ok:true,value:{candidates:[],scanned:0,truncated:false,problems:[]}})`. |
| F10 | `desktop/src/backend/tauri/__tests__/index.test.ts` (EXTEND `teamCases`, line 34) | `orders %s as verb, flags, separator, positionals` | add `['checkout discover', b => b.checkouts.discover({under:['-x','/two'],register:true}).done, ['checkout','discover','--register','--under=-x','--under=/two']]` and `['bare checkout discover', b => b.checkouts.discover({}).done, ['checkout','discover']]`. |
| F11 | same file, NEW `it` | `reads the discover result and rejects a malformed one` | replay a valid `DiscoverResult` value → `{ok:true,value:…}`; replay `{candidates:'no'}` → `ok:false` with an error containing `could not read the result`. |
| F12 | `desktop/src/screens/settings/settings.test.tsx` NEW | `offers Find skills… only when the CLI reports the discover feature` | `vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),checkouts:true})` (the pattern at line 366) plus `vi.spyOn(backend,'features').mockResolvedValue({...await backend.features(),discover:false})`; open `#/settings/machine`; assert `screen.queryByRole('button',{name:'Find skills…'})` is null. Repeat with `discover:true` and assert it is present. |
| F13 | same file, NEW | `lists what discover found and adds one candidate` | with both switches true, stub `backend.checkouts.discover` to return one registered and one unregistered candidate; click `Find skills…`; assert both paths render with `1 skill folders` / `2 skill folders · already registered`, that only the unregistered row has an `Add` button, that clicking it calls `backend.checkouts.add` with that path, and that the row's button disappears afterwards. |
| F14 | same file, NEW | `says so when discover finds nothing, stops early, or cannot read a folder` | stub `discover` to return `{candidates:[],scanned:9,truncated:true,problems:[{path:'/x',reason:'EACCES'}]}`; assert the note row reads `No skill folders found. Stopped early; some folders were not looked at. 1 folders could not be read.` |

No existing test is deleted or weakened. The three changed tests are F4 (row count), F7 (mock answer
callback) and the `FRAME_FEATURES` shape in §7 C — each with its reason stated above, per contract C9.

---

## 8. Gates

Run in this order and report the real counts.

```
# repo root
npm run lint
npm run typecheck
npm test
npm run build

# desktop
cd desktop
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e:routes
```

- Never run `npm install` / `npm ci`. `node_modules` is already populated at the root and in `desktop/`.
- `npm run build` at the root is `tsc -p tsconfig.build.json && node scripts/bundle-skill.mjs`.
- **You cannot run** `cargo` (the Rust shell) or `npm run e2e:fidelity` (it needs `TERUM_DESIGN_DIR`, the
  private design canvas, which is not in this worktree). Say so plainly in your report; do not fake a result.
  The orchestrator runs `cargo check` for `aarch64-apple-darwin`, `x86_64-pc-windows-msvc` and
  `aarch64-pc-windows-msvc`, and runs the fidelity gate.
- Expected pre-existing state at 9fb73e9: all eight runnable gates above are green. Any failure you see is
  yours; fix the cause, never the gate.
- **Two gates fail unless you make the paired edit**, so check them deliberately:
  1. `src/lib/__tests__/frames.test.ts` "CP-19: every feature is named in the protocol features sentence"
     fails unless `docs/frame-protocol.md` line 72 gains the literal `` `discover` `` (§4.9b).
  2. `src/__tests__/frames-cli.test.ts` "FRAME_VERBS names only registered commands, and every one is
     covered here" fails unless `INVOCATIONS` gains `'checkout discover'` (§7 D).
- **The invocation tripwire.** `src/lib/__tests__/invocation-tripwire.test.ts:19` fails the build if any line
  under `src/` (outside `__tests__`) contains the literal text `terum-skills` and is not listed in
  `src/lib/__tests__/invocation-catalog.ts`. **Keep that literal out of every line you add to `src/`** —
  including comments. If a line genuinely needs it, add an entry
  `{ file, line, policy: 'prose' | 'fixed' | 'routed' | 'not-a-hint', pattern: '<the trimmed line>' }` to the
  catalog. (`invocation(args.form, 'checkout discover --budget-ms 60000')` in §4.7f is safe: the literal is
  not in the source line.)
- `desktop/src/backend/__tests__/seam.test.ts` greps the tree: nothing outside `src/backend/tauri/` may
  import `node:*`. `SettingsContent.tsx` imports only `../../backend/types` and `../../backend` — keep it so.

---

## 9. Windows verification (cannot be checked on Linux)

You are on Linux. State in your report that the following were **not** verified here.

What Linux cannot prove:

1. **UNC roots.** `\\wsl.localhost\Ubuntu\home\teniroo\Projects` has no drive letter and uses backslashes.
   Test A15 covers the *prefix-check* bug class on POSIX, and D8 pins the fix (`underCheckout`, which uses
   `sep`), but only Windows can prove the walk actually enumerates a UNC tree.
2. **Case-insensitive skip names** (D6) — the lowercase comparison is platform-independent, but `AppData`
   only actually exists on Windows.
3. **Cancellation.** `desktop/src-tauri/src/lib.rs:156-157` says it in the source:
   *"Allow stdin-close cancellation 1,500 ms, then terminate the Unix process group. Windows falls back to
   `Child::kill`: it does not terminate descendant processes."* So on Windows, pressing **Stop** during the
   evals batch kills `node`, and a `claude` grandchild that was already running may survive. The CLI's own
   SIGTERM handler (`src/lib/evals/agent.ts:123-127`, which SIGKILLs live agent children and exits 143)
   **does not run on Windows**, because `process.kill(process.pid,'SIGTERM')` there is `TerminateProcess`.
   Batch `w06-eval-lock` owns any fix; do not attempt one here. Also note `proper-lockfile`'s exit hook does
   not run on Windows, so a clone lock left by a terminated eval waits out its stale window
   (`src/lib/teamRepo.ts:507`: `stale: options.lockStale ?? 60_000`).
4. **`registerCheckout` on a UNC path.** `realpath` on `\\wsl.localhost\…` can throw; `checkoutPath`
   (`src/lib/checkouts.ts:10`) falls back to `resolve`, and `registerCheckout` (`:28-33`) calls `realpath`
   directly and converts `ENOENT`/`ENOTDIR` into `"<root> does not exist."` — an unhandled `EINVAL` there
   would surface as a raw error. Left as-is (pre-existing behaviour, not this batch's).

Falsifiers the reporter (Teddy) runs on Windows 11 x64:

```
npx -y terum-skills@latest checkout discover --under="\\wsl.localhost\Ubuntu\home\teniroo\Projects"
npx -y terum-skills@latest checkout discover --under="\\wsl.localhost\Ubuntu\home\teniroo\Projects" --register
npx -y terum-skills@latest checkout list
npx -y terum-skills@latest setup
```

Expected: the first lists his project checkouts with their skill-folder counts and never lists anything under
`~/.terum`; the second prints one `Registered …` line per new folder; `checkout list` then shows them; `setup`
offers **"Look for skill folders on this machine and add them to your library? [y/N]"**, accepts
`\\wsl.localhost\Ubuntu\home\teniroo\Projects` at **"Look under which folder?"**, and then offers
**"Evaluate the N shared skills that have no receipt yet? …"**. In the desktop app, the setup screen shows the
two new rows ("Looking for skill folders on this machine", "Evaluating shared skills") with a live counter,
and Settings ▸ This machine ▸ Checkouts shows a **Find skills…** button.

---

## 10. Out of scope / do not touch

| thing | why |
|---|---|
| `desktop/src/screens/onboarding/OnboardingScreen.tsx`, `OnboardingParts.tsx` (beyond reading), and every `Onboarding*` board | The drawn 14-board wizard never runs in the real app (§2.1) and `desktop/GAPS.md:21` records "The drawn 14-board flow is final (Teddy)". |
| `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`, `desktop/package.json`, `desktop/src/styles/tokens.css`, `desktop/src/fixtures/design.json`, anything under `.shots` | Maintainer-owned or generated (`desktop/AGENTS.md` invariants 2 and 3). This batch flips **no** FIDELITY row (§2.6, §2.7) — tell the orchestrator that explicitly. |
| `FRAME_FEATURES.progress` | Contract C2 gives the flip to `w02-perf` (D14). |
| `version` in either `package.json` | Contract C8; the orchestrator bumps 0.1.10 → 0.1.11 last. |
| `eval --all` / a standalone batch-eval verb | Out of scope by the brief: `eval <skill>` stays the unit. The batch exists only inside `setup`. |
| `refreshClone` (`src/lib/teamRepo.ts:471`) and the `RefreshOptions` contract | This batch does not call it and adds none of its fields (§11). `eval` refreshes per run at `src/commands/eval.ts:83`; the candidate scan deliberately reads the clone as it stands. |
| A `default` option on `confirm` (D15) | It would change `Prompter`, `AskFrame`, the desktop `Prompter` and the prompt dialog, all of which other batches touch. |
| Any signal handler for the evals loop (D25) | `w06-eval-lock` owns cancellation. |
| Renaming or restructuring `desktop/src/backend/tauri/index.ts` beyond the two lines in §4.12 | Contract C4: five batches touch that file in the same window. |
| `desktop/src/backend/types.ts` `Prompter` (line 6) | It must keep exactly five members (`desktop/AGENTS.md` invariant 1). Progress reaches the app as a `Frame`. |
| The stale title of `desktop/src/backend/__tests__/s7q.test.ts:9` (`advertises all thirteen mock feature switches` — there are 16 today, 17 after this batch) | Pre-existing inaccuracy; the assertion is derived from `FEATURE_KEYS` and still passes. Do not rename it in this batch. |

---

## 11. Cross-batch contracts used, and the merge-conflict watch list

Merge order the orchestrator will use:
`w07-library-header → w08-refresh-receipts → w06-eval-lock → w03w04-skill-routing → w05-skill-markdown →
sidebar-spacing → **setup-discover-evals** → w02-perf → w01-app-update`.

**C1 `refreshClone` / `RefreshOptions` — this batch owns NO field and adds NO parameter.** For completeness,
the contract's text, which every batch that touches `refreshClone` must declare identically:

```ts
export interface RefreshOptions { lockWaitMs?: number; onWaiting?: (info: { label: string; elapsedMs: number }) => void; deadlineMs?: number }
```

`w06-eval-lock` owns `lockWaitMs`/`onWaiting`; `w08-refresh-receipts` owns `deadlineMs`. Every batch adds it
as ONE optional trailing parameter `options?: RefreshOptions` and never changes the positional parameters.
**This batch changes `src/lib/teamRepo.ts` in no way**; it only *reads* `skillVersions` from it (§4.6).

**C2 — owned here:** `FRAME_VERBS += 'checkout discover'` (appended at the END, after `w08`'s `'refresh'`,
before `w01`'s `'app-update'`); `FRAME_FEATURES += discover: true` (appended at the END, after `w08`'s
`refresh: true`, before `w01`'s `appUpdate: true`; `w02-perf` flips the existing `progress` key and this batch
does not touch it); `FEATURE_KEYS` (`desktop/src/backend/types.ts:12`) `+= 'discover'` in the same relative
order. The mock answers `true` for every key (`desktop/src/backend/mock/index.ts:101`, derived — no edit
needed); the real adapter reads `hello.features.<key>` with a missing key = false
(`desktop/src/backend/tauri/index.ts:498-501`, derived — no edit needed).

**C3 — owned here:** `checkout discover` is registered **inside the existing `checkout` group, immediately
after `checkout list`** (`src/cli.ts:73-74`). No new top-level command is added; `w08`'s `refresh` and
`w01`'s `app-update` go after `decline` and do not collide.

**C4 — honoured:** the only edits to `desktop/src/backend/tauri/index.ts` are the new `cliDiscover` schema
constant beside line 58 and the one-line `checkouts:` object at line 571. `skill()`, `inventoryDetail`,
`LaunchCoordinator`, `cache` and every other region are untouched.

**C5, C6, C7 — not touched:** this batch edits neither `SkillScreen.tsx`, `RunEvalDialog.tsx` nor
`LaunchCoordinator.tsx`.

**C8 — honoured:** no `version` bump anywhere.

**C9 — honoured with three declared test changes:** the `FRAME_FEATURES` shape assertion
(`src/lib/__tests__/frames.test.ts:35-39`), the row count in
`desktop/src/screens/onboarding/setup-driver.test.tsx:36,40`, and the setup answer callback in
`desktop/src/backend/__tests__/mock.test.ts:33`. Each reason is stated in §7. Nothing is deleted or loosened.

**New contract this batch introduces (tell the following batches):**
`Prompter.progress?(update: ProgressUpdate)` in `src/lib/prompt.ts`, implemented by `frameChannel().io` and
deliberately absent from `terminalPrompter`. `w02-perf` should **reuse** this seam rather than inventing a
second one, and it owns the `FRAME_FEATURES.progress` flip and the follow-up reword of
`docs/frame-protocol.md` line 18.

**Merge-conflict watch list (files this batch edits that other batches also edit):**

| file | our edit | other batches |
|---|---|---|
| `src/lib/frames.ts` | `FRAME_VERBS` tail, a NEW line `discover: true,` in `FRAME_FEATURES`, `ProgressFrame extends ProgressUpdate`, `io.progress` | w08 (`refresh`), w01 (`app-update`), w02-perf (`progress: false → true` on the line above ours) |
| `src/lib/prompt.ts` | `ProgressUpdate` + `Prompter.progress?` | w02-perf may want the same seam — it merges after us and should reuse it |
| `src/cli.ts` | one `checkout.command('discover')` block after `checkout list`; two `--no-*` options on `setup` | w08 (`refresh` after `decline`), w01 (`app-update` after `decline`) |
| `src/commands/setup.ts` | `SetupVerbs.eval`, three `SetupArgs` fields, the `Step` union, two step blocks | nothing else in this window |
| `src/commands/eval.ts` | `skillsWithoutReceipt` appended at the end; two imports | w06-eval-lock edits the lock/refresh region near line 83 |
| `docs/frame-protocol.md` | lines 18 and 72, plus one appended paragraph | w08 / w01 / w02-perf all touch line 72 (the features sentence) |
| `desktop/src/backend/types.ts` | `FEATURE_KEYS` tail, `SETUP_STEP_KEYS`, three new interfaces | w08 / w01 append to `FEATURE_KEYS` on the same line |
| `desktop/src/backend/Backend.ts` | `checkouts` group gains `discover` | w08 / w01 add their own methods elsewhere in the interface |
| `desktop/src/backend/tauri/index.ts` | `cliDiscover` + the `checkouts:` line | five batches (C4) |
| `desktop/src/backend/mock/index.ts` | `checkouts` line and the `setup` line | w03w04 edits `skill()` — a different region |
| `desktop/src/screens/settings/SettingsContent.tsx` | the Checkouts group in `case 'machine'` | w01 adds `AppUpdateRows` in `case 'updates'` — a different section |
| `desktop/src/backend/setup-session.ts`, `SetupBoot.tsx` | ours alone in this window | — |

---

## 12. PR

**Title (58 chars):** `feat(setup): discover skill folders and evaluate all skills`

**Body outline:**

- **What.** Two new optional steps in the CLI `setup` wizard — `discover` (find folders on this machine that
  hold `.claude/skills` and register them) and `evals` (evaluate every shared skill whose current version has
  no receipt) — plus the verb `checkout discover`, a new `src/lib/discover.ts`, the first `progress` frames
  this CLI emits, two new `SetupBoot` rows, and a "Find skills…" control in Settings ▸ This machine.
- **Why.** Teddy, 2026-09-10: "in the onboarding flow also allow for the option to have all skills evaluated,
  and also the option to have skills automatically found (build the functionality too)." Both are steps of
  the one wizard so the terminal and the app get them from one code path (`AGENTS.md`, one path per behaviour).
- **How verified.** Root `lint`/`typecheck`/`test`/`build` and desktop `typecheck`/`lint`/`test`/`build`/`e2e:routes`
  with real counts. New tests: `src/lib/__tests__/discover.test.ts` (18 cases incl. depth cut-off, ignore
  list, symlink loop, EACCES, zero budget, abort, missing root, sorting, progress throttle), extensions to
  `checkout.test.ts`, `setup.test.ts`, `frames.test.ts`, `setup-steps.test.ts`, `setup-driver.test.tsx`,
  `mock.test.ts`, `tauri/__tests__/index.test.ts`, `settings.test.tsx`. Three existing tests changed, each
  declared in the spec (FRAME_FEATURES shape, SetupBoot row count 4 → 6, the mock setup answer callback).
- **Windows notes.** Not verifiable on Linux: UNC roots, `AppData`, and cancellation
  (`desktop/src-tauri/src/lib.rs:156-157` — Windows `Child::kill` does not terminate descendants, so a
  cancelled eval batch may leave a `claude` grandchild; `w06-eval-lock` owns that). Falsifier commands are in
  §9 of the spec.
- **Boards.** No `FIDELITY.md` row moves: the Checkouts group is hidden in the mock
  (`surfaces.checkouts:false`) and `SetupBoot` never renders in the mock (`launchContext()` returns null), so
  `SettingsMachine`, `OnboardingBoot` and `OnboardingError` are unaffected.

---

## 13. Open questions (each with the default you MUST take without asking)

| # | question | the default you take |
|---|---|---|
| Q1 | Should `SETUP_STEP_TO_BOARD` map `discover`/`evals` to `Basics` rather than `Done`? | `'Done'`, as the brief says. The mapping only picks a tour board name that the real app never draws (§2.1); `'Done'` is already in the asserted value set. |
| Q2 | Should the discovery offer default to yes? | No — `confirm` cannot express a default (D15) and the terminal renders `[y/N]`. Do not add a `default` option to `confirm`. |
| Q3 | Should `skillFolders` mean the same thing as `checkout list`'s number? | Yes (D3): compute it with `localSkills` + `localSkillCounts`, exactly as `src/commands/checkout.ts:42-43` does. |
| Q4 | Should the evals step refresh the clone before selecting candidates? | No. Read the clone as it stands; `eval` refreshes per run (`src/commands/eval.ts:83`). This keeps the batch clear of the C1 `refreshClone` contract. |
| Q5 | Should `discover` be offered when a `--under` root the person typed does not exist? | The offer still happens; the missing root becomes one `problems` entry printed as `Could not look in …`, and the step ends `done` with zero candidates (D9, D20). |
| Q6 | What if a discovered folder is already registered? | It is listed with ` · already registered` and never re-registered; `--register` and the setup step both skip it. |
| Q7 | Is `progress` allowed while `FRAME_FEATURES.progress` is false? | Yes. `docs/frame-protocol.md:74`: "a verb starting to emit `progress`" is additive and does not bump the protocol; `run.ts:121` already translates it; `SetupBoot` already renders it. The flag advertises a *determinate bar for every long verb*, which is still false. |

---

## 14. Brief corrections (where this spec departs from the batch brief, and why)

| id | the brief said | the code at 9fb73e9 says / this spec says |
|---|---|---|
| BC-1 | `Seam: Backend.discover(args): Run<DiscoverResult>` | `desktop/src/backend/Backend.ts:21` already groups `checkouts: { add; remove }` and `:23` groups `projects: { create }`, and contract C3 puts the CLI verb inside the `checkout` group. The seam is therefore `Backend.checkouts.discover(args)` (D27). If the maintainer prefers the top-level name it is a one-line move. |
| BC-2 | `discoverSkillRoots({ under, home, checkouts, stateRoot, maxDepth?, budgetMs?, onProgress?, signal? })` | The signature also takes `config: Pick<Config,'shared'\|'placements'>` (and an optional `now` test knob), because `skillFolders` must be counted with the same `localSkills`/`localSkillCounts` code `checkout list` uses (`src/commands/checkout.ts:42-43`), and those need the ledger halves of the config. Two different definitions of "skill folders" in sibling verbs is the duplicate path `CLAUDE.md:31` forbids. (D3.) |
| BC-3 | "Concurrency-limited fs (reuse the pattern local-skills.ts uses…)" | `src/lib/local-skills.ts` is **sequential** (`for (const name of names) { … await … }`, lines 120-168). The concurrency pattern the codebase actually uses is the chunk-of-8 `Promise.allSettled` in `src/commands/ls.ts:67-69`; this spec mirrors that. (D12.) |
| BC-4 | `confirm(…)` "default yes" for the discovery offer and "Add all `<n>`?" | `Prompter.confirm` has **no** default parameter: `src/lib/prompt.ts:99` renders `` `${question} [y/N] ` `` and returns true only for `y`/`yes`, and `frameChannel`'s confirm (`src/lib/frames.ts:160-163`) sends no `default`. "Default yes" is not expressible without changing `Prompter`, `AskFrame`, the desktop `Prompter` and the prompt dialog — all touched by other batches. Every new confirm therefore defaults to NO. (D15.) |
| BC-5 | "Cancel (SIGINT / frames cancel) stops after the current skill — reuse whatever cancellation the eval verb already honours" | There is no such graceful cancellation to reuse. A frames `cancel` reaches `src/index.ts:47` → `process.kill(process.pid,'SIGTERM')` → the handler at `src/lib/evals/agent.ts:123-127` SIGKILLs live agent children and calls `process.exit(143)`. The batch stops **mid-skill**, no `result` frame arrives (`docs/frame-protocol.md:28` says so), and on Windows the handler never runs at all. This spec documents that and installs no handler; `w06-eval-lock` owns any fix. (D25, §9.) |
| BC-6 | "`setup` step `evals` … `SetupResult.steps.evals: 'done'\|'skipped'`" (zero-candidate case unspecified) | Zero candidates records `'skipped'` and prints `Every shared skill already has an eval receipt for its current version.` — nothing was evaluated, so the app's row reading "Skipped" is the truthful one. (Contrast: the brief explicitly makes the *discover* zero-candidate case `'done'`, and this spec keeps that.) (D20.) |
| BC-7 | "the eval preflight fails" as a pre-condition for the offer | `preflight()` (`src/lib/evals/agent.ts:235-252`) spawns a **real** agent task. Running it before the question would spend the person's Claude account without consent, and running it inside every `eval` call would repeat it n times. It runs **once, after the yes**, and its result is reused through the existing `EvalArgs.preflight` seam. A failure there prints `Skipping the evals: …` and marks the step `skipped`. (D21.) |
| BC-8 | "`<estimate>` = sum of each skill's estimate if the CLI already computes one (grep `evalEstimate`, `minutes`)" | It does not: `grep -rn "evalEstimate\|minutes" src/` at 9fb73e9 finds only `src/lib/hook.ts:187` ("started more than ten minutes ago"). The parenthesis is omitted entirely. (D22.) |
| BC-9 | "CHECK `desktop/FIDELITY.md`: Settings boards are locked but the Checkouts group is not drawn on any board; if it is not on a locked board, add a Find skills… button" | Confirmed, with evidence: the group is gated on `surfaces?.checkouts===true` (`SettingsContent.tsx:78`) and the mock answers `checkouts:false` (`mock/index.ts:107`) — the fidelity oracle renders the mock, and `settings.test.tsx:361` asserts *"hides Checkouts on the mock machine board"*. The button is added. Additionally: `SetupBoot` is likewise absent from `OnboardingBoot`/`OnboardingError` because the mock's `launchContext()` returns null (`mock/index.ts:98`) and `OnboardingScreen.tsx:39` requires a context. **No FIDELITY row is flipped by this batch.** (§2.6, §2.7.) |
| BC-10 | "`printedSetupStep` recognises the new print lines ('Look for skill folders' → 'discover')" | `Look for skill folders…` is a **question**, not a print line, so it belongs in `askedSetupStep`. The step's first *printed* line is `Looking for skill folders on this machine…` (S9), which is what `printedSetupStep` matches. Both mappings are specified in §4.14. |
| BC-11 | (not mentioned) | Adding `checkout discover` to `FRAME_VERBS` **forces** two other edits or the suite goes red: `INVOCATIONS` in `src/__tests__/frames-cli.test.ts:23-29`, and the `` `hello.features` names `` sentence in `docs/frame-protocol.md:72` (the CP-19 test). Both are specified (§7 D, §4.9b). |
| BC-12 | "`printedSetupStep` recognises the new print lines" (assumed additive) | It cannot be purely additive. The existing wrapper rule `line.includes('/terum-skills')&&line.includes('skill')` (`desktop/src/backend/setup-session.ts:18`) fires on **any** path containing `/terum-skills`, and this batch prints discovered folder paths for the first time — the reporter's own machine has `…/Projects/SSM/terum-skills`, which would flip the app's active step to `wrapper` mid-discovery. The rule is tightened to `line.includes('/terum-skills Claude Code skill')||line.includes('/terum-skills skill')`, which still matches all six lines `src/lib/wrapper.ts:131-140` prints and every existing case in `setup-steps.test.ts:3-8`. Guarded by test F3. (§4.14b.) |
| BC-13 | (not mentioned) | The `SetupBoot` progress row at `SetupBoot.tsx:27` would now duplicate the `discover`/`evals` rows with the raw step id as its label, because `desktop/src/backend/tauri/run.ts:121` maps the CLI's `step` onto the seam frame's `label`. §4.13 suppresses the duplicate when the label names a row it already draws, and keeps the fallback row for any other label (tests F5, F6). (D30.) |

---

## Appendix — Repo facts and Codex constraints (from the shared brief, verbatim)

### Repo facts

- Root: CLI package `terum-skills` (TS, ESM, Node 22+, commander, zod, yaml, proper-lockfile 4.1.2). Build:
  `npm run build` = `tsc -p tsconfig.build.json && node scripts/bundle-skill.mjs` → `dist/` (68 unbundled files today).
  Tests: vitest, collocated `src/**/__tests__/`, bare-repo fixtures, no network. Gates: `npm run lint && npm run typecheck && npm test`.
- Desktop: `desktop/` Vite 8 + React 19 + TS strict + Tauri 2.11. Code style is deliberately dense (single-line
  components, no blank lines inside components) — match the surrounding style. Mock backend `desktop/src/backend/mock/`,
  real adapter `desktop/src/backend/tauri/` (`index.ts` ≈ 700 long lines, `bridge.ts`, `frames.ts`, `run.ts`,
  `prepare-run.ts`, `cache.ts`?). Gates: `cd desktop && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e:routes`.
  `e2e:fidelity` needs the design canvas (`TERUM_DESIGN_DIR`) which Codex does not have — it skips; the orchestrator runs it.
- Rust shell `desktop/src-tauri/src/lib.rs` spawns `node <entry> --frames <verb…>` per call (8-child cap, CREATE_NO_WINDOW on
  Windows, tracked children killed on window destroy). Codex cannot run cargo; the orchestrator runs
  `cargo check` for aarch64-apple-darwin / x86_64-pc-windows-msvc / aarch64-pc-windows-msvc.
- Frame protocol: `src/lib/frames.ts` (FRAME_VERBS, FRAME_FEATURES, hello frame), `docs/frame-protocol.md`.
  Frames: hello | print | ask | progress | result (down), answer | cancel (up). `ProgressFrame { t:'progress'; step:string; current?:number; total?:number }`
  is declared but NO verb emits it yet (FRAME_FEATURES.progress=false). Desktop `Frame` type for progress is `{t:'progress';done:number;total:number;label?:string}` — check `desktop/src/backend/tauri/frames.ts` for the translation before assuming.
- Prompter (`src/lib/prompt.ts`): `interactive`, `channel?: 'terminal'|'frames'`, `confirm`, `text`, `select`, `print`. Exactly five members.
- Config lives in `~/.terum/skills/` (`config.json`, `run/app.json`, `run/terum.stamp`, teams clones under `teams/<team>/`).
- Node_modules are pre-populated in the worktree (root and desktop). `esbuild@0.28.2` is ALSO present in root
  `node_modules` (installed without saving) so a spec may add it to root `devDependencies` — the orchestrator syncs the lockfile afterwards. NOTHING else can be installed.
- Codex constraints to restate in the spec: no git commands at all; do not commit/stage; do not run `npm install`/`npm ci`;
  never edit `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`, `desktop/package.json`,
  `desktop/src/styles/tokens.css`, `desktop/src/fixtures/design.json` (generated), anything under `.shots`; root `package.json`
  may be edited ONLY where the spec lists the exact edit. Report gates honestly.

*(Two of those facts are now stale by this spec's own changes, deliberately: `ProgressFrame` gains its first
emitters (§4.2, §4.7), and the `Prompter` gains a sixth, optional member (§4.1). Both are this batch's work.
Note also that the CLI `Prompter` already has six members at 9fb73e9, counting `channel?`; the "exactly five"
sentence describes the **desktop** `Prompter` at `desktop/src/backend/types.ts:6`, which this batch does not
change.)*

### Governing rules that bind decisions here

- Root `CLAUDE.md:9-10,31`: correctness = spec + North Star, never cheapness; no attacker model
  (hostile-caller findings out of scope); **"Grep for existing code that already does the same thing before
  writing a new function… never leave two active paths doing the same thing."** (binds D3, D12, D21.)
- `AGENTS.md:30-49`: nothing runs but laptops + the git host (shell out only to `git`/`gh`; platform tools
  only through the `Exec` seam in `src/lib/runner.ts` for the app verb); every team-repo write through
  `safeWrite()`; guard = authorization; provenance = the placements ledger; **one path per behaviour**.
  This batch shells out to nothing new: discovery is pure `node:fs`, and the evals batch calls the existing
  `eval` verb, whose receipt commit already goes through `safeWrite` (`src/commands/eval.ts:310-313`).
- `desktop/AGENTS.md` invariant 1 (the seam — screens import only `src/backend/types` + `src/backend/index`),
  invariant 2 (flags come from the CLI, one consumer each, a false switch **hides** the control — binds D28),
  invariant 3 (generated files never hand-edited), invariant 5 (pixels come from the boards; no locked board
  moves — §2.6, §2.7), invariant 7 (no shortcuts in tests or lint; declare every test change — §7).
- Teddy, 2026-09-09: the real adapter serves ONLY real data (no fixture literals, no plausible constants,
  honest absent state). Binds §4.15a: the mock's `discover` returns an empty result rather than inventing
  folders, and the real adapter returns exactly what the CLI walked.
- `.planning/decisions/2026-09-09-eval-button-decision-walk.md` Decision 3 (LOCK): *"One dialog with an honest
  no-estimate line… No invented numbers."* Binds D22.
- `.planning/decisions/2026-09-08-m7-takeover-decision-walk.md` Decision 9 / S7w: refresh after own actions +
  on window focus + Sync now; **NO timer, NEVER a polling sync.** This batch adds no timer; the adapter's
  `run(...,['config'])` invalidation is the existing after-own-action refresh
  (`desktop/src/backend/tauri/index.ts:69,73`).

### Codex constraints (restated — these bind you)

- **No git commands at all.** Not `git status`, not `git diff`. Leave every change in the working tree,
  unstaged. Do not commit, stage, branch or merge.
- **No `npm install` / `npm ci` / `npx playwright install`.** `node_modules` is already in place at the root
  and under `desktop/`. This batch adds **no** dependency, so root `package.json` is **not** edited at all.
- **Never edit** `desktop/GAPS.md`, `desktop/FIDELITY.md`, `desktop/AGENTS.md`, `desktop/README.md`,
  `desktop/package.json`, `desktop/src/styles/tokens.css`, `desktop/src/fixtures/design.json`, or anything
  under `.shots`.
- **No network.**
- **Report gates honestly**, with real counts, and name what you could not run (`cargo`, `e2e:fidelity`).
- Ambiguity → take the most conservative reading and record it; every fork you would have asked about is
  already closed in §3 and §13.
