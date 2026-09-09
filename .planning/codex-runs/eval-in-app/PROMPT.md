Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly. Then read ./CLAUDE.md. This is ROUND 1 of batch `eval-in-app`: the CLI half only (files under `src/`, `docs/`, `.planning/specs/`). Do not touch `desktop/` in this round.

# Batch eval-in-app — CLI half

Governing documents (read them before editing): `.planning/decisions/2026-09-09-eval-button-decision-walk.md` (the eval-button ledger; D1 the app runs the eval via the CLI over `--frames`, D2 commit checkbox default on, D3 one dialog is the cost gate), `.planning/specs/2026-09-04-eval-engine.md` §12 (amended below), `docs/frame-protocol.md`.

Ryan's North Star (ratified 2026-09-09): the desktop app is where a team member does everything they would otherwise type into a terminal, with their own Claude login and money, never handed a command to run elsewhere, and the app never spends that money without a yes.

Standing note on policy: Ajay ruled 2026-09-07 that generated cases may back committed receipts, but 0.1.7's code still refuses `--commit` for generated runs (`src/commands/eval.ts:150`). C4 below mirrors the CODE's predicates (it moves the existing refusal before paid work) and does not change the policy.

## C1 — new read verb `eval-report <skill>`

New file `src/commands/evalReport.ts` exporting `run(args: EvalReportArgs, io: Prompter): Promise<Result<EvalReport>>` in the same style as `src/commands/receiptCheck.ts` / `src/commands/status.ts`.

- `EvalReportArgs extends WithForm { ref: string; team?: string; config?: ConfigStore; runner?: Runner }`.
- Read-only: no `refreshClone`, no network, no prompts (never call `io.confirm/text/select`; `io.print` only for the one warning below).
- Resolve the team with `selectTeam(config.teams, args.team, args.form)`, the skill with `findSkill(clone, teamName, args.ref)` (`src/lib/skills.ts:42`); a missing skill fails with the same message `eval` uses (`No skill named or identified by <ref> exists in team <team>.`).
- Result value:

```ts
export interface ReceiptView extends Receipt { path: string }   // Receipt = receiptSchema.passthrough() output, verbatim; path = absolute file path
export interface EvalReport {
  skill: { id: string; name: string };
  versions: {
    placed: string | null;      // 40-char tree of this machine's placement for (team, id) from config.placements (schema.ts:105); null when not placed or version null
    teamCurrent: string;        // resolveVersion(clone, name, undefined, runner) — HEAD:skills/<name> per src/lib/version.ts:22-27
    evaluated: string | null;   // latest?.version ?? null
  };
  latest: ReceiptView | null;   // the newest committed receipt for teamCurrent by run_id (filename order), see below
  latestState: 'ok' | 'none' | 'invalid';
  history: { version: string; run_id: string; verdict: Receipt['verdict']; execution_status: Receipt['execution_status']; model: string; cc_version: string; committed: true }[];
  localRuns: { run_id: string; run_dir: string; execution_status: 'complete' | 'partial' | 'failed' | 'unknown'; committed: boolean; receipt: ReceiptView | null }[];
}
```

- `latest` / `latestState`: the receipt directory is `join(clone, 'evals', record.id, teamCurrent)`. Export `receiptFiles` and `newestReceiptAt` from `src/commands/receiptCheck.ts` (they are module-private today at :91-108) and reuse them; do not fork the rule. No files → `latestState: 'none'`, `latest: null`. `newestReceiptAt` throws for a malformed/schema-invalid newest file → catch it, `latestState: 'invalid'`, `latest: null`, and `io.print` one warning naming the file (e.g. `warning: the newest receipt <absolute path> is invalid (…); older receipts are listed in history only.`). Also apply the receiptCheck identity rule (`receiptCheck.ts:72`): if `receipt.skill_id.toLowerCase() !== record.id.toLowerCase()` or `receipt.version !== teamCurrent`, that is `'invalid'` too (name the file). An older file is NEVER substituted for an invalid newest one.
- `history`: every schema-valid committed receipt for the skill id across every version directory under `join(clone, 'evals', record.id)` (40-hex directory names only, `.json` files only), newest first by `run_id` (string compare, run ids are `YYYYMMDDTHHMMSSZ`). Invalid files are skipped silently here (they are already reported through `latestState` when they are the newest for teamCurrent). Each row carries `model: receipt.provenance.model`, `cc_version: receipt.provenance.cc_version`, `committed: true`.
- `localRuns`: from `join(store.root, 'evals', teamName, record.id)` (the run tree `eval` writes, `eval.ts:111`): one row per subdirectory that contains `run.jsonl`; `run_id` = the directory name; `run_dir` = absolute path; `receipt` = the parsed `receipt.json` in that directory when present and schema-valid (C3 writes it; older runs have none) with `path`; `execution_status` = `receipt.execution_status` when the receipt is present, else `'unknown'` (do NOT derive it from run.jsonl rows — the UI contract forbids the app deriving statistics and this verb is the UI's read model); `committed` = `history.some(h => h.run_id === run_id)`. Newest first by `run_id`.
- Register in `src/cli.ts`: `program.command('eval-report <skill>').description('Show a skill\'s committed eval receipts and this machine\'s local runs (read-only, no fetch)').option('--team <team>', 'configured team (required when more than one exists)')` → `execute((io) => active.evalReport({ form: context.form, ref, ...options }, io), { verb: 'eval-report', notices: false })`. Add `evalReport?: typeof runEvalReport` to `CliVerbs` and `active`.
- Add `'eval-report'` to `FRAME_VERBS` in `src/lib/frames.ts:32` (after `'eval'`). `src/__tests__/frames-cli.test.ts` enumerates every FRAME_VERB with a stub and an invocation: add `'eval-report': ['eval-report', 'x']` to `INVOCATIONS` and `evalReport: asking` to its `verbs` (declare this in `testsModified`).
- Document the verb in `docs/frame-protocol.md` (one row/paragraph under a new "Verbs added for the desktop app" heading is enough: `eval-report <skill> [--team]`, read-only, returns the EvalReport object above as `result.value`).

## C2 — structured failure value on commit failure

- `src/lib/result.ts`: add `export const failureWith = <T>(value: T, error: string): Result<T> => ({ ok: false, error, value });` (keep `failure` as is).
- `src/commands/eval.ts`: `EvalResult` becomes
  ```ts
  export interface EvalResult { team: string; id: string; name: string; runDir: string; ccVersion: string; executionStatus: 'complete' | 'partial' | 'failed'; receiptPath?: string; commit: { ok: true; receiptPath: string } | { ok: false; error: string } | null; }
  ```
  `commit` is `null` when `--commit` was not requested; `{ok:true, receiptPath}` on a committed receipt (keep the existing top-level `receiptPath` too — the existing VE4 test asserts it); `{ok:false, error}` when the commit block threw.
- Wrap the `--commit` block (today `eval.ts:213-257`, the `safeWrite` call and everything that can throw inside it: `PushRefused`, `SafeWriteExhausted`, `GuardError`, `CloneBusy`, `RemoteAccessError`, any Error) in try/catch. On a throw return `failureWith({ team, id, name, runDir, ccVersion, executionStatus, receipt-free fields as above, commit: { ok: false, error: message } }, message)` where `message` is the thrown error's message. The evaluation itself is complete at that point (run tree and local receipt.json are on disk), so the failure carries the full `EvalResult` value. Do not swallow `CancelledError` differently from today (there is no prompt in the commit block, so this is moot; keep `fromError` for everything outside the block).
- `src/lib/execute.ts:33` already forwards `outcome.value` on a failing Result into the `result` frame, and `src/lib/frames.ts:181-186` writes `value` when present. Verify by test (see T4 below); change nothing there unless the test proves otherwise.

## C3 — local receipt file

After `aggregate` and `writeRunTree` (today `eval.ts:195-202`) and before any commit attempt, build the receipt with `buildReceipt` exactly as the commit block does today (same payload; `runner_handle: binding.handle ?? 'local'` — note `binding.handle` is `string | undefined` on a team without a joined handle) and write it as pretty JSON to `join(runDir, 'receipt.json')`. If `buildReceipt` fails, return `failure(receipt.error)` as today. Then the commit block (C2) reuses that same receipt value (build once, write locally, then `safeWrite` the same source string to `receiptPath(record.id, version, runId)`). `runningEngineCommit` therefore runs on every eval, not only committed ones; that is intended.

## C4 — deterministic commit-eligibility pre-flight before paid work

Add `function commitEligibility(args: EvalArgs, binding: { handle?: string }, form: InvocationForm | undefined, assets?: { name: string; wantsCases: boolean; wantsTriggers: boolean; authoredCaseFiles: string[]; authoredTrigger: boolean }): string | null` in `eval.ts` returning the refusal message or `null`.

- Without `assets` it checks (a) `args.commit && !binding.handle` → the existing message from `eval.ts:72` and (b) `args.working && args.commit` → the existing message from `eval.ts:60` (the existing test asserts `--working --commit` appears in it). Replace lines 60 and 72 with this one call placed where line 72 is today (after `selectTeam`), so (a)/(b) keep running before `refreshClone`. Keep the `--save`, `--gen/--case`, `--triggers-only/--execution-only`, `--k` checks where they are.
- With `assets` it checks (c) generation would run, using EXACTLY the predicates at `eval.ts:125-126`: `const generateCases = wantsCases && !args.noGen && (Boolean(args.gen) || authoredCaseFiles.length === 0); const generateTriggers = wantsTriggers && !args.noGen && (Boolean(args.gen) || !authoredTrigger);` → when `args.commit && (generateCases || generateTriggers)` return a message that names the two ways forward, e.g.
  `--commit is refused: <name> has no authored <eval cases | triggers.yaml | eval cases or triggers.yaml> and this run would generate them. Either run \`<invocation(form, 'eval <name>')>\` without --commit to generate and review them, or publish the reviewed assets into the skill's evals/ and then run \`<invocation(form, 'eval <name> --commit')>\`.`
  (use `invocation()` from `src/lib/invocation.ts` for the launch-aware spelling; say "eval cases" when only cases would be generated, "triggers.yaml" when only triggers would, both otherwise).
- Call the `assets` form right after the hygiene block (today `eval.ts:96-103`) and BEFORE `preflight()` (`:106`) and before the run tree is created. That means `wantsCases`, `wantsTriggers`, `authoredCasesDir`, `authoredCaseFiles`, `authoredTrigger` (today `:117-121`) move up to just after hygiene; the later code keeps using them. `assessHygiene` and `sourceFiles` already ran, so this adds no I/O beyond one `readdir`.
- Keep the refusal at `:150` as defence (unreachable on the paid path now). Never silently downgrade a requested commit.

## C5 — flag flip

`src/lib/frames.ts:42`: `runEvalInApp: true`. `features.progress` stays `false`. Update the exact-map assertion in `src/lib/__tests__/frames.test.ts` (the `FRAME_FEATURES` `toEqual`) accordingly — declare it in `testsModified`. Update the `runEvalInApp` mention in `docs/frame-protocol.md` only if it states the value (it lists names only today).

## C6 — cancel leaves no orphans

- `src/lib/evals/agent.ts` `spawnCollect`: keep a module-level `Set<ChildProcess>` of live children (add on spawn, delete on `close`). Install ONE `process.once('SIGTERM', …)` handler lazily on the first spawn (guard with a module-level boolean so tests that spawn many stubs install it once). The handler kills every live child with `SIGKILL` and then exits the process with code 143 (`process.exit(143)`) — the leader's exit must imply the agent's death regardless of `desktop/src-tauri/src/lib.rs:135`'s early return (the shell only kills the process group when the leader is still alive after 1.5 s).
- `src/lib/frames.ts:136`: on a `cancel` frame, after `failPending()`, invoke an optional `streams.onCancel?.()` hook (add `onCancel?(): void` to `FrameStreams`). In `src/index.ts:46` pass `onCancel: () => { process.kill(process.pid, 'SIGTERM'); }`. The hook lives in the bin, not in `frameChannel`, so `src/lib/__tests__/frames.test.ts` (which sends cancel frames in-process) keeps working unchanged. Note the reason in a one-line comment: a verb that never asks (eval) would otherwise keep running after cancel.

## Docs

- `.planning/specs/2026-09-04-eval-engine.md` §12 (line ~480): replace the two-sentence opening ("The receipt JSON is the API. The UI never runs evals and never derives new statistics. For a given version the UI renders the **latest** receipt (max `run_id`); older receipts are history — kept, never displayed side by side or merged.") with exactly this paragraph:

  > The receipt JSON is the API. The UI never runs an eval itself: it may hand a run off to the CLI through the Prompter (the `eval` verb over `--frames`, with the CLI asking its own questions and the person's own Claude login doing the work), and it never derives a new statistic. Per receipt it may show the lift, the verdict and the per-arm scores exactly as the committed receipt states them, a pre-run cost estimate computed from that one receipt's own `efficiency` numbers and labelled as arm-run pricing for the receipt's `model`, and the receipt's provenance beside every number. It may not derive any statistic across receipts, rank or sort skills by a receipt number, show a number when there is no receipt, or show an estimate whose arm model differs from `receipt.provenance.model`. For a given version the UI renders the latest receipt (max `run_id`); an invalid latest receipt is reported as invalid, never replaced by an older one; older receipts are history — listed, never displayed side by side or merged.

  Keep the card table and the "Hard rules" paragraph that follow. Add one reconciliation note after the paragraph: "Reconciliation (2026-09-09, eval-button decision walk D1): PR #68's §12 clauses (a), (c) and (d) stand; clause (b) — the UI composes the command and hands the person to a terminal — is replaced by the sentence above."
- `docs/frame-protocol.md`: document the `eval-report` verb (C1) and that a failing `result` frame may carry `value` (the verb's partial result, e.g. `eval` after a completed evaluation whose receipt commit failed) — the `result` row already says `value` is the verb's own result object; add the failure case explicitly.
- `desktop/AGENTS.md:57` is amended in ROUND 2 (desktop half) — do not edit `desktop/` now.

## Tests (each must FAIL on the base tree and PASS after; put them in `src/commands/__tests__/evalReport.test.ts`, `src/commands/__tests__/eval.test.ts`, `src/__tests__/frames-cli.test.ts` or a new `src/__tests__/frames-eval-cancel.test.ts`; use the fixtures in `src/lib/__tests__/fixtures.ts` exactly as `eval.test.ts` and `receiptCheck.test.ts` do — `bareTeam`, `pushFromSeed`, `cloneWithIdentity`, `ScriptedPrompter`, a stub `AgentApi`, `preflight: async () => success({ ccVersion: 'stub' })`)

1. `eval-report` on a clone fixture with two committed receipts for one version (push `evals/<id>/<tree>/20260907T010000Z.json` and `…/20260907T020000Z.json` from the seed; the tree is `git rev-parse HEAD:skills/sample` in the seed after the skill push) → `latest.run_id === '20260907T020000Z'`, `latestState 'ok'`, `history` has both newest first, `versions.teamCurrent` equals that tree hash, `versions.evaluated` equals it, `versions.placed === null`.
2. Newest file malformed (push a third file `…/20260907T030000Z.json` containing `{"nope":true}`) → `latestState 'invalid'`, `latest === null`, `history` still lists the two valid ones, the ScriptedPrompter saw one printed warning naming the bad file.
3. Placed ≠ teamCurrent: record a placement in config (`store.update(c => { c.placements['/tmp/x'] = { id, team: 'team', version: '<40 hex, different>', scope: { kind: 'global' }, placed_at: '…', fingerprint: '…' }; })` — check `schema.ts:105` and `scopeSchema` for the exact shape) → `versions.placed` is that hash and `versions.teamCurrent` is the tree.
4. `eval --commit` with a `safeWrite` that throws `PushRefused` (inject a `runner` that fails `git push` — see `wrapRunner` in fixtures.ts; or a runner whose `push` returns a non-zero code so `safeWrite` raises `PushRefused`/`SafeWriteExhausted`; assert on the shape, not the class) → result `ok:false` WITH `value.runDir` set, `value.executionStatus === 'complete'`, `value.commit.ok === false`; and `join(value.runDir, 'receipt.json')` exists (C3).
5. `eval --commit` on a skill with no authored cases (no `evals/cases`), authored `triggers.yaml` present → refusal BEFORE preflight: `preflightCalls === 0`, the stub agent never invoked, the error message mentions both ways forward (contains `--commit` and `review`).
6. Same with cases but no `triggers.yaml` (and not `--execution-only`) → same refusal; and a control: `--commit --no-gen` with cases only proceeds past preflight.
7. `receipt.json` exists in `runDir` after a run WITHOUT `--commit`, parses with `receiptSchema`, and has `provenance.runner_handle === 'seed'` (or `'local'` when the team binding has no handle).
8. Frames: (a) the `hello` frame carries `runEvalInApp: true` (update the FRAME_FEATURES assertion); (b) a cancel frame mid-eval kills the stub agent child. For (b) drive the BUILT bin like `src/__tests__/bin.test.ts` does (compile with `tsc -p tsconfig.build.json --outDir <scratch>/dist`, symlink `node_modules`, spawn `node <scratch>/dist/index.js --frames eval --execution-only --no-gen -- sample` with `HOME` = a scratch home whose `~/.terum/skills` config and team clone point at a bareTeam fixture with an authored case, and `TERUM_SKILLS_AGENT_CMD` = a stub shell script). The stub: on `--version` prints `1.0.0`; when its `-p` prompt starts with `Reply with the single word` prints a minimal stream-json (`{"type":"system","subtype":"init","model":"stub","skills":[]}` then `{"type":"result","result":"ok"}`) and exits 0; otherwise writes its own `$$` to `<scratch>/agent.pid` and `sleep 60`. The test waits for the pid file, writes `{"t":"cancel"}` to the child's stdin, then asserts within ~5 s that `process.kill(pid, 0)` throws `ESRCH` and the leader exited. Skip the test on `win32`.

## Gates (run them, report real counts)

`npm run lint && npm run typecheck && npm test` from the repo root (absolute paths, no `cd`). The suite spawns git against bare-repo fixtures; that is expected. Report the counts in `gates`.

## Standing constraints

- Read `AGENTS.md` first; read the module header comments of every file you touch (eval.ts, receiptCheck.ts, frames.ts, agent.ts, result.ts, execute.ts) before editing.
- Grep before writing: `receiptFiles`/`newestReceiptAt` exist — export and reuse them; `buildReceipt`/`receiptPath` exist; `resolveVersion` exists; `findSkill`/`selectTeam` exist. Never leave two active paths doing the same thing.
- Node 22 ESM, TypeScript strict; imports end in `.js`; verbs never touch `process.stdin/stdout/console` (the ESLint rule enforces it) — the `process.kill` in `src/index.ts` (the bin) and the SIGTERM handler in `agent.ts` (the trust boundary that already spawns processes) are the only new process-level calls.
- Do not run `git` inside the sandbox (its metadata lives outside the writable root); verify writes by reading files back. Do not commit, stage, or push. Leave changes in the working tree.
- Do not edit `desktop/**`, `package.json`, `.claude/**`, `FIDELITY.md`, `GAPS.md`.
- If the spec is ambiguous, record the question in `openQuestions` and implement the most conservative reading; never resolve a design fork yourself.
- Never delete or weaken a test to make a suite pass; declare every test change in `testsModified`.
- `node_modules` is already in place (a symlink); the sandbox has no network — do not `npm install`.
