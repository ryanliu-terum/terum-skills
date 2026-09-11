# Review fixes for f-auto-sync

An independent review pass (four reviewers per batch, then an adversarial verifier that read the code and
refuted what it could) produced the findings below against your worktree. Every one listed here was CONFIRMED
against the code you wrote; refuted claims have been dropped, so treat each of these as real.

**What to do.** Fix every `blocker` and every `should-fix`. Fix the `nit` items too unless a fix would break a
locked contract or contradict the spec — say which ones you skipped and why in `deviations`. Where a finding
names a test that was weakened or made vacuous, restore its teeth: the standing rule is that an existing test is
never weakened to match new behaviour. Where a finding says behaviour has no test, add the test.
Keep every spec decision and the cross-batch brief. Re-run the gates as instructed (root: lint, typecheck,
vitest --maxWorkers=3, build; desktop: typecheck, lint, vitest, build; no Playwright) and give a fresh final
report in the required schema.

The suggested fix on each finding is the reviewer's, not a spec: implement the *correct* fix. If you believe a
finding is wrong, say so in `deviations` with the evidence rather than silently leaving it.

## 30 confirmed findings

### 1. [blocker] A failed fetch on a team whose clone is missing is swallowed: sync returns success

**Where:** `src/commands/sync.ts:214-218`

**What is wrong:** The new fetch-error drain loop has three exits. CloneBusy -> skipped (211). RemoteAccessError / any other error -> skipped AND `unreachable.push(team)` (227), which makes the run `return failure(...)` at 551. The branch inserted between them at 214 (`if (!(await lstat(join(clone,'team.json')).catch(() => null)))`) `continue`s at 218 WITHOUT pushing to `unreachable`, so `unreachable.length` stays 0 and the run falls through to `return success(...)` at 554. At HEAD the same input hard-failed: `git show HEAD:src/commands/sync.ts:167` is `if (!(error instanceof CloneBusy)) throw error;`, so any non-RemoteAccess fetch error aborted the run into `failure('Sync failed: ...')`. The branch also replaces the fetch error with the readTeam rejection (216), so the actual cause is discarded and the notice names a pass that never ran. The missing-team.json test is checked BEFORE the RemoteAccessError test, so an unreachable remote on a team whose clone was never completed is swallowed the same way.

**Suggested fix:** Add `unreachable.push(team)` to the 214-218 branch (and update the `team leave` test, whose team genuinely did not sync), or gate the branch on the clone having existed when the run started so it only covers the mid-run-removal case. Either way keep the fetch error in `detail` and append the readTeam diagnostic rather than replacing it.

**Evidence the verifier read:** sync.ts:207-228 read in full; `unreachable.push(team)` appears only at line 227, after the two branches that `continue` at 212 and 218. sync.ts:550-554: `if (unreachable.length) { ... return failure(...) } ... return success(...)`. Old behaviour read from `git show HEAD:src/commands/sync.ts` lines 160-171. Concrete: delete `~/.terum/skills/teams/<team>` -> refreshClone throws a plain Error -> fetchErrors -> no team.json -> notice `Skipping endorsed batch for <team>: ENOENT ... team.json`, exit 0. Exactly this shape is visible in the orchestrator's own instrumented run (scratchpad/autosync-flake3.txt ORCH_OUTCOME).

---

### 2. [blocker] The unchanged fast path also skips the passes whose inputs are local, so auto-share and connected-edit mirroring stop silently on --auto/--hook

**Where:** `src/commands/sync.ts:237-247`

**What is wrong:** `present` (237) is built from remote HEAD (`stamp.head === heads.get(team)`), pending intent, and a stat of each ledger placement. When it holds, 246 `continue`s past the ENTIRE per-team body — not just the tree walk but `autoShareGlobal` (300-319), `reconcileShared` (321), the restore pass (~470) and `reconcileOrphans` (515). Two of those read purely local state the HEAD comparison says nothing about: `autoShareGlobal` scans `~/.claude/skills` via `localSkills` (connect.ts:517) for folders not yet in the repo, and `reconcileShared` compares each `config.shared[id].source` folder on disk against the repo copy and pushes local edits (connect.ts:281-345). Because the push is the only thing that would move HEAD, skipping it is self-sustaining. Concrete: the user creates `~/.claude/skills/my-skill` or edits a connected skill's source. HEAD has not moved and every ledger placement is intact, so `present` is true on every subsequent run; the app's automatic sync and the session hook both report ok with `changed:false`, the policy records `{state:'synced'}`, and nothing is shared or mirrored until the user clicks Sync now or a teammate pushes. Because the gate is `silent` (= hook || auto), this is also a regression for the pre-existing `sync --hook`. The restore pass is likewise unreachable in the fast path — its whole purpose is a `person.installed` entry with NO ledger entry, which the placement stat loop cannot detect. README.md:75 still advertises `sync` as "mirror connected edits". D6's literal text does say "no share pass", so this needs an orchestrator ruling, but D6's premise ("skip work that cannot have changed") is simply false for these passes.

**Suggested fix:** Move the auto-share block (292-319) and the `reconcileShared` call (321-329) above the `present` check so the fast path skips only the pending replay, the placement walk, the endorsed/restore batches and `reconcileOrphans`; or extend the predicate with an mtime/listing digest of the global skills root and of every `config.shared[*].source`. Then amend D6. Note origin/main's `autoShareRoots` widens this to every registered checkout.

**Evidence the verifier read:** sync.ts:237-247 (`if (present) { ...; continue; }`), with the auto-share block at 292-319 and `reconcileShared` at 321 both textually after the `continue`. connect.ts:506-531 `autoShareGlobal` -> `localSkills(AGENT_PATHS['claude-code'].global(home), ...)`. connect.ts:281-345 `reconcileShared` reads `tracked.source` off disk. `silent = Boolean(args.hook || args.auto)` at sync.ts:70.

---

### 3. [should-fix] D5 violated: a generic fetch error is reclassified from a failed run into a per-team skip with a new notice and a different verdict

**Where:** `src/commands/sync.ts:220-227`

**What is wrong:** D5 says "A team whose fetch failed is skipped and reported exactly as today" and §3 says "Keep every existing notice/verdict string byte-identical." At HEAD a fetch error that was neither RemoteAccessError nor CloneBusy was rethrown and the whole run returned `failure('Sync failed: <message>')` with no notice. The else-branch at 223-226 now emits a new notice `Skipping ${team}: ${detail}`, records `skipped/error`, and pushes to `unreachable`, so the verdict becomes `Sync finished with 1 team(s) skipped: team. See the notices above.` Concretely: `git` missing from PATH, an EACCES on the clone, or a `reset --hard` failure. `unreachable` also now carries reason:'error' teams, so neither its name nor its message ("team(s) skipped") means what it did.

**Suggested fix:** Keep the old classification: push to `unreachable` only in the RemoteAccessError branch, and collect the generic error and rethrow after the drain loop so the run still fails with `Sync failed: <message>`.

**Evidence the verifier read:** sync.ts:223-227 vs `git show HEAD:src/commands/sync.ts` lines 162-171 (`if (error instanceof RemoteAccessError) {...} if (!(error instanceof CloneBusy)) throw error;`). Verdict strings at sync.ts:551 and 557.

---

### 4. [should-fix] D5 phase B is no longer "sequential, as today": reconcileShared and reconcileOrphans now run once per team

**Where:** `src/commands/sync.ts:321 and src/commands/sync.ts:515`

**What is wrong:** D5 specifies "phase B (sequential, as today …): read, place, share, orphans, stamp" — one pass. The diff folded all of phase B into a per-team loop: `reconcileShared(store, runner, childIo, otherTeams, …)` at 321 and `reconcileOrphans(…, otherTeams, …)` at 515 are each invoked once per non-skipped team with `otherTeams = new Set(every other team)` (249) as the skip set. Both helpers begin with `await store.read()` and then walk the whole of `config.shared` / `config.placements`, so with N teams the batch turns two whole-ledger passes into 2N — the opposite of the spec's stated goal — and it is declared only as the vague deviation "sync used multiple passes". Work is still partitioned correctly (each entry is handled by exactly one team's iteration), so nothing is done twice, but the walk cost is N-fold and it is an undeclared restructure of a phase the spec said to leave alone.

**Suggested fix:** Keep the per-team loop for read/pending/place/endorsed/restore, and hoist one `reconcileShared(…, skipSet, …)` and one `reconcileOrphans(…, skipSet, …)` call back out after the loop, where `skipSet` is `new Set([...skipped.keys(), ...fastPathTeams])`.

**Evidence the verifier read:** sync.ts:248-249 builds `workTeams`/`otherTeams` per iteration; 321 and 515 are inside that loop. `git show HEAD:src/commands/sync.ts` lines 241 and 430 show both were single top-level calls taking `new Set(skipped.keys())`. The reviewer's secondary claim — that a `config.shared` entry whose `tracked.team` is not a key of `config.teams` is now never reconciled — is REFUTED: `otherTeams` is a skip set, not an iteration set, and connect.ts:284-286 still iterates all of `config.shared`, skipping only members of that set, so such an entry is reconciled on every iteration rather than none.

---

### 5. [should-fix] D2 violated: an unconditional onSettled notify('stamp') clears the whole read cache after every automatic sync, and double-invalidates after a changed one

**Where:** `desktop/src/backend/tauri/index.ts:425 (with desktop/src/backend/tauri/auto-sync.ts:29-32)`

**What is wrong:** D2 says the policy invalidates "when the result's `changed` is true or `placed > 0`". `onChanged` does exactly that (424: await in-flight reads, then `notify('clone','placed','stamp')`), but the wiring also passes `onSettled: () => { notify('stamp'); }`, which the policy runs unconditionally after every run including a no-op. `notify` (409) is `if (sources.length === 0) return; clearReads(); broadcast(...sources);` and `clearReads()` empties the entire `reads` map, not just stamp-derived entries. So (a) every automatic sync throws away every cached CLI read and re-spawns status/settings/inbox (invalidation.ts:8), which is exactly the cost the W-08 comment directly above refreshPolicy warns about ("notify('clone') re-spawns seven query prefixes and the shell caps concurrent CLI children at eight"); and (b) after a changed sync, onChanged's carefully-awaited wave is followed one microtask later by a second clearReads() that drops the sharing of the refetches it just started, so those argv spawn a second child while the first wave is still running. `stamp` is already in onChanged's list, so the second wave buys nothing. Unlike onChanged, onSettled also does not await in-flight reads first. Not in the report's deviations.

**Suggested fix:** Drop `onSettled`, or make it notify only when `last()` transitioned into or out of 'failed' (which is the only thing D4's Settings line needs), and skip it entirely when onChanged already ran for this cycle.

**Evidence the verifier read:** index.ts:409 `const notify = (...sources) => { if (sources.length === 0) return; clearReads(); broadcast(...sources); }`; index.ts:405 `const clearReads = () => { reads.clear(); }`; index.ts:424-425; auto-sync.ts:29-32 runs `options.onSettled?.()` in a `.then` that is not conditional on the outcome; desktop/src/app/invalidation.ts:8 `stamp: ['status','settings','inbox']`.

---

### 6. [should-fix] An invalidation or settle failure overwrites the sync outcome, so a successful sync is reported as failed and a real CLI error is hidden

**Where:** `desktop/src/backend/tauri/auto-sync.ts:26-32`

**What is wrong:** `last` is assigned three times in one run. Line 25 records the truth from `options.run()`. Line 26 then `await options.onChanged()` INSIDE the same async IIFE, so an invalidation rejection falls into the `.catch` at 27-28 and overwrites `last` with `{state:'failed', detail:<invalidation error>}`. Lines 29-32 do it again: `onSettled` is awaited in a `.then` whose catch unconditionally assigns `last = {at, state:'failed', ...}`. (a) `onChanged` is `async () => { await Promise.allSettled(...); notify('clone','placed','stamp'); }` and `notify` synchronously calls every subscribe listener (React Query's invalidate predicate); a throw from any listener turns a sync that actually fetched and placed skills into `Last automatic sync failed 2 minutes ago: <a React Query error>` in Settings ▸ Sync. (b) The reverse: a sync that genuinely failed with `Sync finished with 1 team(s) skipped: acme` has that detail replaced by whatever onSettled's notify threw. The onSettled catch at 31 also omits the `.split('\n')[0]` the D4 copy relies on, so a multi-line error leaks its second line into the row. The sync's outcome and the app's cache-invalidation outcome are two different facts sharing one slot. (refresh.ts:70-82 has the same shape for onChanged, so half of this is an inherited pattern; the onSettled half is new and is the one that can downgrade an already-recorded 'synced'.)

**Suggested fix:** Compute and assign `last` from `result` only, then run onChanged/onSettled in their own try/catch that never touches `last` (log, or record a distinct non-'failed' field). Never downgrade an already-recorded 'synced'.

**Evidence the verifier read:** auto-sync.ts lines 23-32 read verbatim; the `.catch` at 27 wraps the whole IIFE including the `await options.onChanged()` at 26, and the `.then` handler at 29-32 assigns `last` in its catch without splitting. index.ts:424 shows onChanged calls `notify`, and index.ts:409/408 show notify calls every listener synchronously. No test in desktop/src/backend/tauri/__tests__/auto-sync.test.ts makes onChanged or onSettled throw.

---

### 7. [should-fix] The 10-minute automatic-sync throttle is reset by every window focus, so a sync --auto child is spawned on every alt-tab

**Where:** `desktop/src/backend/tauri/index.ts:588 with desktop/src/app/LaunchCoordinator.tsx:67-68`

**What is wrong:** `refreshLaunch()` calls `autoSyncPolicy.reset()` (588), and LaunchCoordinator registers `const focus = () => { void refresh(); }` on the window `focus` event, where `refresh()` awaits `backend.refreshLaunch()` — so every focus, not only a native relaunch, wipes `lastAt` back to NEGATIVE_INFINITY. The adapter's own focus listener (427) triggers the policy first, then the reset lands, so focus N+1 always passes the throttle. D2's "at most once per 10 minutes" therefore never holds in the composed app. In most cases the CLI's own `--fresh-ms 600000` gate turns the extra run into a cheap no-op, so the concrete damage is a CLI child plus a full read-cache wipe (see the onSettled finding) on every alt-tab — but for any team whose stamp was withheld (the ordinary state whenever something is waiting in the Inbox: `pendingLeft > 0` -> 'incomplete' -> no stamp, sync.ts:538-545) the stamp is always stale, so that team takes a FULL fetch + phase B on every single focus. This mirrors the pre-existing `refreshPolicy.reset()` on the same line, where the blast radius was one read-only `refresh`; here it is a fetch-and-place run.

**Suggested fix:** Reset the automatic-sync throttle only from the real relaunch path (the `onLaunchRequest` handler), not from `refreshLaunch()`; then add a test that fires two focus events inside the interval with a `refreshLaunch()` between them and asserts exactly one `sync` spawn, and update refresh-on-focus.test.ts:~176 accordingly.

**Evidence the verifier read:** index.ts:580-589 (`refreshLaunch` -> `refreshPolicy.reset(); autoSyncPolicy.reset();`); LaunchCoordinator.tsx:58-68 (`async function refresh(){ const ctx = await backend.refreshLaunch(); ... }` and `window.addEventListener('focus', focus)`); App.tsx:28 mounts `<LaunchCoordinator/>` unconditionally; auto-sync.ts:34 `reset: () => { lastAt = Number.NEGATIVE_INFINITY; }`. The new adapter test bakes it in: `await backend.refreshLaunch(); focus(); await drain(); expect(syncs()).toHaveLength(3);` with no clock advance. Severity corrected from blocker: the pattern is inherited from the existing refreshPolicy reset on the line above, and --fresh-ms limits most (not all) of the cost.

---

### 8. [should-fix] --fresh-ms is spawned at exactly the policy throttle, so the two gates are redundant and neither reset() nor the intended 10-minute cadence works

**Where:** `desktop/src/backend/tauri/index.ts:804`

**What is wrong:** The adapter spawns `sync --auto --fresh-ms 600000` where 600000 IS `AUTO_SYNC_MIN_INTERVAL_MS` (auto-sync.ts:3). There are now two independent gates at the same value: the in-process throttle (auto-sync.ts:20-22), measured from the START of the previous run, and the CLI's stamp-age gate (sync.ts:164-168), measured from the stamp mtime written at the END of it. Two consequences. (a) `refreshLaunch()` clears only the in-process gate ("A relaunch is a terminal action landing: the throttle must not hide what it just changed") and cannot clear the CLI-side one, so a relaunch four minutes after the last sync runs a CLI that skips every team as `fresh`, returns ok with `changed:false, placed:0`, invalidates nothing, and records `{state:'synced'}` — the app shows nothing new and claims a successful sync. (b) If the reset-on-every-focus defect above is fixed in isolation, the two gates compound: trigger at T, stamp at T+5s; focus at T+600001 passes the throttle and spends `lastAt`, the CLI then computes age 595001 < 600000 and skips everything, and the next opportunity is T+1200001 — a real sync every ~20 minutes, not the 10 D4's copy promises.

**Suggested fix:** Drop `--fresh-ms` from the adapter's argv (the policy is the single source of cadence and the CLI default 0 always runs), or pass a value strictly below the throttle (`String(AUTO_SYNC_MIN_INTERVAL_MS / 2)`), or thread a force flag from `reset()`.

**Evidence the verifier read:** index.ts:804 `...(args.auto ? ['--auto','--fresh-ms', String(AUTO_SYNC_MIN_INTERVAL_MS)] : [])`; auto-sync.ts:3 `export const AUTO_SYNC_MIN_INTERVAL_MS = 10 * 60_000;` and 20-22 `const at = now(), elapsed = at - lastAt; if (elapsed >= 0 && elapsed < AUTO_SYNC_MIN_INTERVAL_MS) return; lastAt = at;`; sync.ts:164-168 measures `age` from the stamp's `mtimeMs`; sync.ts:545 writes the stamp at the end of phase B. Detail corrected: the ~20-minute steady state is currently masked by refreshLaunch resetting the throttle on every focus, so the two findings must be fixed together.

---

### 9. [should-fix] The autoAdvertised launch latch is consumed even when the launch trigger no-ops on busy, so D2's launch sync is lost for the session

**Where:** `desktop/src/backend/tauri/index.ts:357`

**What is wrong:** `onHello` sets `autoAdvertised = true` the first time ANY hello advertises autoSync and then schedules `autoSyncPolicy.trigger()` on a microtask. `trigger()` returns immediately when `options.busy()` is true (auto-sync.ts:19) without touching `lastAt`, and `busy()` is `activeWorkflows > 0` (422) — true for every non-read verb including the very run whose hello just armed the latch, because `activeWorkflows++` happens synchronously at 441 before `cliRun` and the hello arrives from inside that child's frame loop. Concrete: the app is launched through a deep link that starts `install`, or onboarding runs `setup`, so the first hello comes from that workflow; the latch flips, the microtask fires, busy() is true, nothing runs. No later hello can re-arm it (`!autoAdvertised` is now false and the `else if (first && ...refresh)` branch is dead), so D2's "once after the first hello that advertises features.autoSync" never happens for that session and the app waits for a focus round-trip. The batch's own test ('skips automatic sync while another workflow runs and retries on the next focus') stages exactly this loss and papers over it with an explicit `focus()`.

**Suggested fix:** Latch only on a trigger that actually started: have `trigger()` return whether it ran (or expose an inFlight flag) and set `autoAdvertised = true` only then; or re-attempt the launch trigger from `run()`'s finally when `activeWorkflows` drops to 0 and `last()` is still null.

**Evidence the verifier read:** index.ts:356-357 `if (!autoAdvertised && frame.features.autoSync === true) { autoAdvertised = true; void Promise.resolve().then(() => { if (!retired) autoSyncPolicy.trigger(); }); } else if (first && frame.features.refresh === true) ...`; auto-sync.ts:19 `if (inFlight || !options.supported() || options.busy()) return;` (returns before `lastAt = at`); index.ts:440-441 increments before `cliRun`; refresh-on-focus.test.ts 'skips automatic sync while another workflow runs and retries on the next focus'.

---

### 10. [should-fix] Nothing serializes the background automatic sync against a user-initiated Sync now, so the manual run reports every team as locked

**Where:** `desktop/src/backend/tauri/index.ts:420-426 with desktop/src/components/domain/useSyncAction.tsx:23`

**What is wrong:** `sync` acquires `run/<team>.lock` for every team in phase A and releases only in the outer finally (sync.ts:169-176, 560), and `acquireTeamLock` does NOT wait — it returns null immediately for a live lock (hook.ts:223-235). The adapter now starts a silent `sync --auto` on every window focus (and, per the reset finding, on literally every focus), while `useSyncAction` spawns a manual `sync` straight from the click with no check against `autoSyncPolicy`. Concrete: the user alt-tabs back (focus -> automatic sync starts, takes seconds) and immediately clicks Sync now; the manual process gets `release === null` for every team, records `skipped/locked`, and the single-team verdict printed into the dialog is `Sync incomplete: team skipped (another sync holds its lock) — retry when it finishes.` The dialog shows `team: skipped` for a sync that is in fact running. The reverse direction is guarded (Q2, `busy()` counts the manual sync because 'sync' is not in the read denylist); this direction is not.

**Suggested fix:** In the adapter's `sync` seam, when `args.auto` is falsy, `await autoSyncPolicy.settled()` before spawning, so a manual Sync now queues behind an in-flight automatic one instead of colliding with its locks.

**Evidence the verifier read:** sync.ts:169-175 (`const release = await acquireTeamLock(...); if (!release) { ... skipped.set(team,{reason:'locked', ...}); return; }`) and the releases run only in the `finally` at 560; hook.ts:215-235 `acquireTeamLock` returns null on a live lock with no wait; sync.ts:674 `${team.team} skipped (another sync holds its lock) — retry when it finishes` and 704 `Sync incomplete: ...`; useSyncAction.tsx has no policy check; auto-sync.ts:34 already exports `settled()`.

---

### 11. [should-fix] The CLI's per-team notices are dropped for --auto, so D4's failure line points at diagnostics that exist nowhere

**Where:** `desktop/src/backend/tauri/auto-sync.ts:25`

**What is wrong:** For `--auto` the CLI is silent: `notice()` only pushes to `notices` (sync.ts:119), `isHookSync` requires `hook === true` so `writeHookNotices` never runs (src/lib/execute.ts:52-57), and src/cli.ts:163 passes `notices: !options.hook && !options.auto`. The per-team cause therefore exists only in `SyncResult.notices`. Nothing reads it: `cliSync` parses `notices` and index.ts:804 maps it onto `SyncResult`, but auto-sync.ts:25 records only `result.error.split('\n')[0]` and SettingsContent.tsx:88 renders only `detail`. Concrete: a team's token expires; the CLI puts `Skipping acme: could not fetch …: Permission denied (publickey).` into `notices` and returns `failure('Sync finished with 1 team(s) skipped: acme. See the notices above.')` (sync.ts:551). Settings ▸ Sync then shows exactly that sentence, and there are no notices above anywhere in the app. The first-line truncation is spec'd by D4 and asserted by settings.test.tsx, so the fix is to carry the notices, not to widen `detail`.

**Suggested fix:** Add the notices to the recorded outcome (`last = {at, state:'failed', detail: firstLine, notices: result.value?.notices ?? []}`) and render them as lines under the failure row in the Sync group.

**Evidence the verifier read:** src/lib/execute.ts:52-53 `(value as Partial<SyncResult>).hook === true`; sync.ts:554 returns `hook: Boolean(args.hook)` (false for --auto); src/cli.ts:163 `notices: !options.hook && !options.auto`; auto-sync.ts:25; SettingsContent.tsx:88 renders `d.lastAutomatic.detail?.split('\n')[0]`.

---

### 12. [should-fix] D8 unmet: bench-sync.mjs was never run, so every speed claim (D5/D6/D7) is unmeasured

**Where:** `scripts/bench-sync.mjs:1`

**What is wrong:** D8 says "Measured, not claimed" and "the report must quote before/after numbers from it on this machine". The script exists and is coherent (three bare teams, 20 skills each, a cold pass then the unchanged fast path, reads timings out of the --frames result) and package.json `files` already excludes `scripts/`, so no exclusion edit is needed. But the implementer's report records the deviation verbatim: "No Linux before/after benchmark measurements." / "Git commands are forbidden. The script was syntax-checked only". That reason does not hold: every git call in the script runs inside its own `mkdtemp` fixture with `GIT_CONFIG_NOSYSTEM=1` and a throwaway `GIT_CONFIG_GLOBAL`, and never touches the repository's metadata. D5/D6/D7 are therefore three untested performance claims — which matters because D6's fast path turns out to skip correctness-relevant work (see the blocker above) and D5 turned two ledger walks into 2N.

**Suggested fix:** Run `npm run build && node scripts/bench-sync.mjs` and paste the two labelled wall-clock lines plus the per-phase timings into the report; if the fast path is not measurably cheaper, say so rather than leaving D8 blank.

**Evidence the verifier read:** scripts/bench-sync.mjs lines 1-50 read: `const root = await mkdtemp(join(tmpdir(), 'terum-bench-sync-'))`, `env` overrides HOME/USERPROFILE/GIT_CONFIG_GLOBAL, all git calls are `command('git', args, cwd)` with that env and a cwd under `root`. package.json `files` is ['dist','LICENSE','NOTICE','README.md']. scratchpad/codex/f-auto-sync-report.json deviations[1]: {"what":"No Linux before/after benchmark measurements.","why":"Git commands are forbidden. The script was syntax-checked only…"}.

---

### 13. [should-fix] The app-level "focus never starts sync" assertion was deleted and its replacement never renders the App

**Where:** `desktop/src/app/refresh-policy.test.tsx:18-42`

**What is wrong:** What was removed is `fireEvent(window,new Event('focus'));` from the two App-rendering tests — the focus event, not the guard: only the bare `expect(sync).not.toHaveBeenCalled();` remains, which now asserts nothing about focus. That assertion was not obsoleted by this batch: these tests run against `createMockBackend()`, which has no sync policy at all (the policy lives only in the Tauri adapter) while still answering `autoSync: true` from FEATURE_KEYS, so the App-layer property "no App component starts a sync from focus" still holds and is worth keeping — App does have a focus listener that calls into the backend (LaunchCoordinator.tsx:67-68). The nominal replacement at line 31 constructs `createAutoSyncPolicy` directly in the test body, registers its own `window.addEventListener('focus', …)` and asserts on a `vi.fn()`: no App is rendered, no backend is involved, and it is a strict subset of auto-sync.test.ts's first case. It would still pass if `onWindowFocus` stopped calling `autoSyncPolicy.trigger()` or if the wiring at index.ts:427 were deleted. Net: the file's own test name claims app-level focus coverage it does not have. §3 authorises replacing the assertion, but not with nothing.

**Suggested fix:** Restore `fireEvent(window,new Event('focus'));` before `expect(sync).not.toHaveBeenCalled();` (the mock App must still never sync from focus), and keep the policy-throttle unit assertions where they belong, in auto-sync.test.ts — or fold the throttle assertion into refresh-on-focus.test.ts, which already drives `focus()` against `createTauriBackend`.

**Evidence the verifier read:** git diff of refresh-policy.test.tsx: `-const button=...;fireEvent(window,new Event('focus'));expect(sync).not.toHaveBeenCalled();` / `+const button=...;expect(sync).not.toHaveBeenCalled();`, plus the renames. New test at lines 31-42 constructs `createAutoSyncPolicy({run,supported:()=>true,busy:()=>false,onChanged:()=>{},now:()=>now})` and its own listener; no `<App/>`. desktop/src/backend/mock/index.ts:103 `features(){return Object.fromEntries(FEATURE_KEYS.map(key=>[key,true]))}` and :184 `sync:` with no policy. Severity corrected from blocker: nothing is broken, coverage is lost.

---

### 14. [should-fix] The fetch-error reclassification (fatal -> per-team skip; missing clone -> silent success) has no test

**Where:** `src/commands/__tests__/sync.test.ts:1667`

**What is wrong:** The appended `automatic program sync` describe has exactly one fetch-failure case ('a failed fetch leaves other teams synchronized with the existing notice'), and its runner returns `{code:1, stderr:'fatal: repository not found'}`, which refreshClone classifies as a RemoteAccessError — the one branch whose behaviour did NOT change. Neither of the two reclassifications introduced by the drain loop is covered: (1) a plain non-RemoteAccess, non-CloneBusy fetch error, which at HEAD aborted the run into `Sync failed: <message>` and now yields `Sync finished with 1 team(s) skipped`; (2) a failed fetch on a team whose clone has no `team.json`, which now returns `ok: true` with no unreachable count (the blocker above). D5 requires "exactly as today", and the silent-success path is exactly the kind of regression a test would have caught.

**Suggested fix:** Add two cases: a runner whose `git fetch` rejects with a plain Error (assert the verdict and `teams[].state`/`reason` the spec intends, restoring the rethrow if "exactly as today" is the contract), and an unreachable remote whose clone has no `team.json` (assert it is still reported as unreachable and the run fails, not an endorsed-batch skip).

**Evidence the verifier read:** sync.test.ts 'a failed fetch leaves other teams synchronized with the existing notice' asserts only `result.ok === false`, `teams` shapes and `notices[0]).toContain('Skipping team:')` — satisfied by either branch. teamRepo.ts:561-564 turns a 'repository not found' fetch failure into RemoteAccessError via explainGitAccessFailure. No test in the file exercises sync.ts:214-218 or 223-226.

---

### 15. [should-fix] D4's new Sync-now dialog copy has no test

**Where:** `desktop/src/components/domain/useSyncAction.tsx:23`

**What is wrong:** The idle line changed from 'Sync runs only when you ask.' to 'Sync also runs by itself at launch and when you come back to the app.' Nothing asserts it. The one test that opens the dialog (refresh-policy.test.tsx) asserts `toHaveTextContent('Sync now')`, i.e. the title, and the settings tests cover the Settings row only. A revert or a typo in the user-visible half of D4 ships silently, and this is one of the strings the orchestrator has to redraw the locked SettingsSync / Sync-now boards against.

**Suggested fix:** After `fireEvent.click(button)` in refresh-policy.test.tsx (or beside the two new cases in settings.test.tsx) assert `expect(await screen.findByRole('dialog')).toHaveTextContent('Sync also runs by itself at launch and when you come back to the app.')`.

**Evidence the verifier read:** `grep -rn "Sync also runs by itself" desktop/src desktop/e2e` matches only useSyncAction.tsx:23. refresh-policy.test.tsx:21 asserts `toHaveTextContent('Sync now')`.

---

### 16. [nit] The "never on a timer" half of the replacement assertion is vacuous

**Where:** `desktop/src/app/refresh-policy.test.tsx:38`

**What is wrong:** `now+=AUTO_SYNC_MIN_INTERVAL_MS;await Promise.resolve();expect(run).toHaveBeenCalledTimes(1);` advances a hand-rolled `now` counter, not a clock, and the test installs no fake timers (the file contains no `vi.useFakeTimers()`). No setTimeout/setInterval could fire inside a single microtask tick regardless of what the policy does, so the assertion would pass even if `createAutoSyncPolicy` scheduled a timer. Since the spec named this test as the replacement for the deleted focus contract, its weakest half is carrying the load. (The file's first test — the regex over production source, K1 — is the real no-polling guard and is untouched.)

**Suggested fix:** Wrap the test in `vi.useFakeTimers()` and replace `await Promise.resolve()` with `await vi.advanceTimersByTimeAsync(AUTO_SYNC_MIN_INTERVAL_MS * 2)` before the assertion.

**Evidence the verifier read:** `grep -n "useFakeTimers" desktop/src/app/refresh-policy.test.tsx` returns nothing; the only `vi.` uses are restoreAllMocks, spyOn and fn.

---

### 17. [nit] D4 copy: the failed-automatic-sync line is missing its terminating period

**Where:** `desktop/src/screens/settings/SettingsContent.tsx:88`

**What is wrong:** D4 fixes the string as `Last automatic sync failed {relative}: {first line of the CLI's own error}.` The template renders `Last automatic sync failed ${relativeTime(...)}: ${d.lastAutomatic.detail?.split('\n')[0]??''}` with no trailing period, so the rendered line is e.g. `Last automatic sync failed 2 minutes ago: Could not fetch team` — one character off the copy the orchestrator hands Teddy for the SettingsSync redraw, and settings.test.tsx encodes the truncated form. The two other D4 strings both carry their trailing period and are byte-exact, which is what makes the omission read as an oversight rather than a reading of the spec.

**Suggested fix:** Append `.` to the template literal at SettingsContent.tsx:88 and to the regex in the new settings.test.tsx case.

**Evidence the verifier read:** SettingsContent.tsx:88 `{`Last automatic sync failed ${relativeTime(new Date(d.lastAutomatic.at).toISOString())}: ${d.lastAutomatic.detail?.split('\n')[0]??''}`}`; settings.test.tsx `findByText(/Last automatic sync failed 2 minutes ago: Could not fetch team/)`. Severity corrected from should-fix: it is a one-character copy deviation on a board the orchestrator is redrawing anyway.

---

### 18. [nit] The fast path records 'unchanged' for ledger paths the full pass skips as ineligible, so the count differs between a fast and a full run of the same state

**Where:** `src/commands/sync.ts:244`

**What is wrong:** In the fast path the eligibility probe short-circuits — `if (!(await eligible(path))) return true;` (239), so an unregistered placement does not block the skip — but the very next line records EVERY ledger path for the team: `for (const [path] of paths) recordPlacement(team, path, 'unchanged');` (244). The full pass does `if (!(await eligible(path))) continue;` (340) before any recordPlacement, and also skips entries the person file no longer lists and declined ones. Concrete: two global placements plus one under a de-registered checkout gives `counts.unchanged === 3` from a fast `sync --auto`/`--hook` and `2` from the full pass on identical on-disk state. Impact is narrow — the fast path is `silent`-only so the count is never printed, and the desktop's `cliSync` schema drops `counts` entirely — but it is the same TeamOutcome field reporting two numbers for one state to any frames consumer.

**Suggested fix:** Keep the per-path eligibility results computed for `present` and record only the eligible ones, instead of discarding them.

**Evidence the verifier read:** sync.ts:238-244 vs sync.ts:340; sync.ts:70 `silent = Boolean(args.hook || args.auto)` and 237 requires `silent`. Severity corrected from should-fix: no user-visible surface today.

---

### 19. [nit] The stamp records the pre-share HEAD, so the fast path cannot engage on the run after any run that pushed

**Where:** `src/commands/sync.ts:545`

**What is wrong:** `heads.get(team)` is captured right after refreshClone (198-200), before phase B. `autoShareGlobal` and `reconcileShared` can commit and push to the team repo, advancing origin and the clone's own HEAD. The stamp written at 545 therefore names the pre-push HEAD; the next run fetches the post-push HEAD, `stamp.head !== heads.get(team)`, and takes the full pass even though no peer changed anything. Self-correcting after one extra run, but it means D6's optimisation is skipped on every run that follows a share — which for an actively-connected user is most of them. (It also partly masks the fast-path share-skip blocker: the run after a share is full, the one after that is fast and shares nothing again.)

**Suggested fix:** Re-read HEAD in the clone immediately before `writeStamp` and stamp that, so the stamp names the commit the run actually reconciled against.

**Evidence the verifier read:** sync.ts:196-200 captures `heads` inside the parallel fetch task; sync.ts:545 `await writeStamp(store.root, team, { head: heads.get(team)!, at: ... })`; the auto-share/reconcileShared block at 292-329 runs between them and pushes through connect.ts's safeWrite path.

---

### 20. [nit] Progress frames mislabel the phase: `share` is announced before the placement walk, whose time is folded back into the already-emitted `place` row

**Where:** `src/commands/sync.ts:292 and src/commands/sync.ts:330`

**What is wrong:** `begin(team,'place')` fires at 250 and `finishPlace()` at 291, covering only the pending replay. `begin(team,'share')` fires at 292 and `finishShare()` at 329. The actual placement/endorsed/restore work then runs at 330-511, and its elapsed time is added back into the already-pushed `place` timing at 512-513. A consumer following the progress stream — the desktop's SetupBoot-style rows, or bench-sync.mjs — sees `team: share` while placements are still being copied and sees `place` complete long before any file is written, contradicting docs/frame-protocol.md's "emits a progress frame for fetch, place, share, and orphans as those phases begin". The totals are right; only the frame ordering lies. The new test asserts only the label sequence `['team: fetch','team: place','team: share','team: orphans']`, so it ratifies the misordering rather than the documented contract.

**Suggested fix:** Open the `share` timing after the placement loop (wrap only the auto-share + reconcileShared block once placements are done), or give the pending replay its own label and emit `place` at 330; then assert the frame order against the real phase boundaries.

**Evidence the verifier read:** Line numbers from grep: 250 `const finishPlace = begin(team,'place')`, 291 `finishPlace()`, 292 `const finishShare = begin(team,'share')`, 329 `finishShare()`, 330 `const placementAt = performance.now()`, 512-513 `const placementTiming = timings.find(...); if (placementTiming) placementTiming.ms += performance.now() - placementAt;`. docs/frame-protocol.md `### f-auto-sync`: "Each attempted team emits a progress frame for fetch, place, share, and orphans as those phases begin."

---

### 21. [nit] D1: timings ride the result on hook failures, though they are correctly gated to --auto on success

**Where:** `src/commands/sync.ts:551 and src/commands/sync.ts:557`

**What is wrong:** The success return at 554 spreads `...(args.auto ? { timings } : {})`, correctly scoping D1's `timings` to `--auto`. Both failure returns (551 and 557) instead include `timings` unconditionally whenever `silent` is true, i.e. also for `sync --hook`. A hook run that ends in `failure(...)` therefore emits a field docs/frame-protocol.md (`### f-auto-sync`, "The result adds `timings`" under the --auto paragraph) says belongs to automatic runs.

**Suggested fix:** Use the same `...(args.auto ? { timings } : {})` spread on both failure returns.

**Evidence the verifier read:** sync.ts:551 `..., silent ? { placed, deferred, notices, changed, hook: Boolean(args.hook), teams, timings } : undefined)`; 557 identical; 554 `..., ...(args.auto ? { timings } : {})`.

---

### 22. [nit] childIo's prompt-refusal message names --hook on an --auto run

**Where:** `src/commands/sync.ts:130-131`

**What is wrong:** `text` and `select` reject with `new Error('sync --hook cannot prompt')` whenever `silent` is true, which after this batch includes `--auto`. A child verb that reaches for a text/select question during an automatic sync surfaces that string as the CLI's error, which auto-sync.ts records as the AutoSyncOutcome detail and D4 renders verbatim in Settings ▸ Sync — telling the user about a flag the app never passes.

**Suggested fix:** Make the message reflect the mode: `` `sync ${args.auto ? '--auto' : '--hook'} cannot prompt` ``.

**Evidence the verifier read:** sync.ts:130-131 both reject with `new Error('sync --hook cannot prompt')`, guarded by `!silent`, and sync.ts:70 `const silent = Boolean(args.hook || args.auto)`.

---

### 23. [nit] --auto drops the locked-team notice from `notices` entirely, leaving a stuck session lock with no trace

**Where:** `src/commands/sync.ts:171-173`

**What is wrong:** `notice()` already suppresses PRINTING when `silent` is true (119) while still recording the line in `notices`. The new outer `if (!args.auto)` wrapper therefore changes nothing about what is printed — it removes the line from `notices` as well. A team skipped because another process holds `run/<team>.lock` then appears only as `{state:'skipped', reason:'locked'}` in `teams[]`, which the desktop's `cliSync` schema does not carry (it reads team/state/message, never reason/detail). The run returns ok, the policy records 'synced', and nothing anywhere says that team did not sync. `acquireTeamLock`'s 10-minute stale reclaim bounds the window, but within it the app reports clean syncs that did nothing for that team — and this is exactly the state the manual-vs-automatic collision above produces.

**Suggested fix:** Delete the `if (!args.auto)` wrapper and keep the original `if (!args.hook) notice(...)`; notice() already does the right thing for a silent run, and the line then rides `notices`.

**Evidence the verifier read:** sync.ts:119 `const notice = (line) => { notices.push(line); if (!silent) io.print(line); };`; sync.ts:170-174 `if (!args.auto) { if (!args.hook) notice(...) }`; HEAD version had only `if (!args.hook) notice(...)`. index.ts:48 `cliSync` team object is `{ team, state, message? }`.

---

### 24. [nit] D5: two phase-A notices are emitted in completion order, not config order

**Where:** `src/commands/sync.ts:172 and src/commands/sync.ts:179`

**What is wrong:** The drain loop at 207-228 was deliberately written to diagnose fetch errors in `Object.keys(config.teams)` order ("error arrival order must not change either the diagnosis or the report order"), but two notice sites remain inside the parallel task: the session-lock contention line (172) and the lock-acquisition error line (179). Both call `notice()`, which pushes to `notices` and, when not silent, prints immediately. With four teams fetching concurrently their order in `notices` — and their interleaving with surrounding terminal output — depends on which task loses its lock race first, where before it was deterministic config order. D5 says a skipped team is "reported exactly as today".

**Suggested fix:** Collect these two cases into a per-team map like `fetchErrors` and emit them from the same config-ordered drain loop.

**Evidence the verifier read:** Both `notice(...)` calls are inside the `mapWithConcurrency(Object.keys(config.teams), 4, async (team) => {...})` callback that starts at sync.ts:158; the ordering comment is at sync.ts:205-206.

---

### 25. [nit] writeStamp's finally-rm can replace the real write error, and it bypasses the fsForTests.rename seam

**Where:** `src/lib/hook.ts:181-182`

**What is wrong:** `try { await writeFile(temp, ...); await rename(temp, path); } finally { await rm(temp, { force: true }); }` — a rejection from `rm` inside the finally discards the in-flight exception from writeFile/rename. `force: true` covers ENOENT but not EPERM/EBUSY, which is a real shape on Windows (a target platform) when a scanner holds the temp file; the caller then sees `Sync failed: EBUSY ...` instead of why the stamp could not be written. The function also calls `rename` directly rather than `fsForTests.rename`, the seam hook.ts:10 exports specifically for the crash-between-write-and-rename case, so the new writer is outside that test seam.

**Suggested fix:** `finally { await rm(temp, { force: true }).catch(() => undefined); /* cleanup must not replace the write failure */ }` and use `fsForTests.rename`.

**Evidence the verifier read:** hook.ts:177-183 read verbatim; hook.ts:10 `export const fsForTests = { rename };` with the docblock "The one seam hook.test.ts needs to simulate a crash between the temp write and the rename." The HEAD implementation (sync.ts:547) was a plain `writeFile` with no temp file, so this whole block is new.

---

### 26. [nit] The Q2 workflow gate is an argv denylist inside the shared run(), incremented outside any try/finally

**Where:** `desktop/src/backend/tauri/index.ts:440-444`

**What is wrong:** Two problems in four lines. (a) `if (workflow) activeWorkflows++;` runs at 441 and the matching decrement is attached to `job.done` at 444, so everything between — `state()`, `cwd()` (which reads `backend.prefs.get`) and the `cliRun` call itself — is unguarded; any synchronous throw there pins the counter above zero, and `busy: () => activeWorkflows > 0` then short-circuits `trigger()` before `lastAt` is touched, so automatic sync is silently disabled for the rest of the session with nothing recorded in `last()` and no failure line in Settings. A child that never settles has the same effect. (b) K6 says f-auto-sync's new logic goes in auto-sync.ts "wired beside refreshPolicy with the fewest lines"; this instruments the generic `run()` that f-update-policy and f-md-parity also edit, and classifies by a DENYLIST of argv[0] (`status`, `ls`, `search`, `eval-report`, `refresh`, plus `app-update --check`) — so a new read verb added later fails CLOSED, counted as a workflow and permanently suppressing the focus trigger while in flight. The denylist happens to cover every verb `cached()` spawns today (status, ls, eval-report).

**Suggested fix:** Increment inside a try that decrements on a synchronous throw (or increment after `cliRun` returns), and invert the predicate to an explicit allowlist of mutating verbs so an unrecognised verb fails open. Better still, move the counter into auto-sync.ts as an exported `createWorkflowGate()`.

**Evidence the verifier read:** index.ts:440-444 read verbatim; index.ts:437 `const cwd = () => backend.prefs.get<string>('workspace','') || undefined;` is called synchronously in the options object at 442; index.ts:422 `busy: () => activeWorkflows > 0`; auto-sync.ts:19 returns before `lastAt = at`. `grep "cached(\["` over index.ts yields only status / ls / eval-report.

---

### 27. [nit] auto-sync.ts carries none of the justification refresh.ts states for the same code, and swallows more

**Where:** `desktop/src/backend/tauri/auto-sync.ts:21 and :27-32`

**What is wrong:** auto-sync.ts is a deliberate copy of refresh.ts's shape but drops both of its explanatory comments: refresh.ts:66-68 says why `elapsed >= 0` is required (a system clock stepped backwards must not wedge the throttle), refresh.ts:69 says why `lastAt` is set before the spawn, and refresh.ts:79-80 says why the catch may record-and-continue ("a background refresh has no user-facing surface and must never reject into the caller's focus handler or leave an unhandled rejection"). auto-sync.ts:21, :22 and :27-32 have none of them, and it additionally swallows a second failure source (onSettled) that refresh.ts does not have. The repo's standing rule is that a catch which neither rethrows nor handles must say on the line why continuing is safe.

**Suggested fix:** Carry refresh.ts's three comments over, and add one for the onSettled catch stating what the app loses when invalidation fails and why that is not the sync's outcome.

**Evidence the verifier read:** refresh.ts:66-68, :69 and :79-81 read verbatim; auto-sync.ts:20-22 and 27-32 have only the one-line docblock at 12 ("Launch/focus only. A workflow in progress skips the trigger without spending the throttle.").

---

### 28. [nit] Undeclared: the pending replay source changed from a fresh read to a start-of-run snapshot intersected by samePending

**Where:** `src/commands/sync.ts:254`

**What is wrong:** At HEAD the replay iterated `(await store.read()).pending.filter(entry => entry.team === team)` — a read taken at the team's own turn. It is now `config.pending.filter(entry => entry.team === team && current.pending.some(latest => samePending(latest, entry)))`, where `config` is the snapshot read at sync.ts:149 (before the whole parallel fetch phase) and `current` at 232. Two undeclared changes: (a) a pending recorded after the run started — a concurrent `terum-skills install` in another window that deferred a grant — is no longer replayed in this run, and the parallel fetch widened that window from "during this team's fetch" to "during any team's fetch"; (b) `samePending` compares `destination?.kind`, so a pending that had no destination in the start-of-run snapshot but has since had one filled in fails the intersection and is dropped from this run's replay. Both are self-correcting (pendingLeft > 0 withholds the stamp), but they are silent behaviour changes in the consent-replay path the spec did not touch, and using the snapshot as the SOURCE while the fresh read is only a filter is strictly worse than iterating the fresh read.

**Suggested fix:** Restore the fresh read: `for (const pending of current.pending.filter(entry => entry.team === team))`. Phase B is still sequential per team and nothing about the parallel fetch requires a frozen pending list.

**Evidence the verifier read:** sync.ts:149 `const config = await store.read();`, sync.ts:232 `const current = await store.read();`, sync.ts:254 the new filter; `git show HEAD:src/commands/sync.ts` line 175 `for (const pending of (await store.read()).pending.filter((entry) => entry.team === team)) {`; install.ts:275-277 `samePending` includes `a.destination?.kind === b.destination?.kind`. Severity corrected from should-fix: self-correcting on the next run and needs a concurrent writer to trigger.

---

### 29. [nit] The conflicting-option test asserts only ok:false, not why

**Where:** `src/commands/__tests__/sync.test.ts:1623`

**What is wrong:** `it.each([{auto:true,hook:true},{auto:true,prune:true},{freshMs:1}])(… expect(await run(args, new ScriptedPrompter())).toMatchObject({ ok: false }))` passes for any failure at all. Concretely, if the new guard at sync.ts:107 were deleted, `{auto:true,prune:true}` would still be rejected — by the pre-existing `sync prune needs an interactive terminal.` error, since `interactive` is false under `silent` — so the test would stay green with the guard gone. The sibling case at 1619 gets this right by matching `expect.stringContaining('--fresh-ms')`.

**Suggested fix:** Assert the message per case: `--auto cannot be combined with --hook or --prune.` for the first two and `--fresh-ms requires --auto` for the third.

**Evidence the verifier read:** sync.test.ts `it.each([{ auto: true, hook: true }, { auto: true, prune: true }, { freshMs: 1 }])('rejects conflicting program options %j', async args => { expect(await run(args, new ScriptedPrompter())).toMatchObject({ ok: false }); });`; sync.ts:107-108 are the two guards; sync.ts:118 `const interactive = !silent && io.interactive && 'confirm' in io;` and 138 `if (!interactive) throw new Error('sync prune needs an interactive terminal.');`.

---

### 30. [nit] The parallel-fetch bound is looser than the implementation it guards

**Where:** `src/commands/__tests__/sync.test.ts:1657`

**What is wrong:** With five teams, a concurrency limit of 4 and a 30 ms delay in every fetch, the test asserts only `expect(peak).toBeGreaterThanOrEqual(2)`. Lowering `mapWithConcurrency(Object.keys(config.teams), 4, …)` at sync.ts:158 to 2 — halving the speedup this batch exists to deliver — would leave the test green.

**Suggested fix:** Tighten the lower bound. `toBe(4)` is the sharpest but risks flake on a loaded box, since the four workers also run stampIsFresh, acquireTeamLock and a `rev-parse` before entering the 30 ms fetch window; `toBeGreaterThanOrEqual(3)` (keeping `toBeLessThanOrEqual(4)`) fails a drop to 2 without pinning exact interleaving.

**Evidence the verifier read:** sync.test.ts 'fetches teams concurrently within four slots, retaining config order': `expect(peak).toBeGreaterThanOrEqual(2); expect(peak).toBeLessThanOrEqual(4);`. sync.ts:158 `await mapWithConcurrency(Object.keys(config.teams), 4, async (team) => {`. Fix corrected from the reviewer's `toBe(4)`, which is not as deterministic as claimed.

---
