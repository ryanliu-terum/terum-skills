# Review fixes for f-update-policy

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

## 28 confirmed findings

### 1. [blocker] A preferences write failure turns a successful update check into a permanent hard error, killing the chip and the Settings rows

**Where:** `desktop/src/backend/tauri/app-update.ts:47-51 (test: desktop/src/backend/tauri/app-update.test.ts:27-31)`

**What is wrong:** check() persists the `updates:app:lastShown` acknowledgement and, if `prefs.set`/`prefs.flush()` throws, discards the successful AppUpdateStatus it already obtained and returns `{ok:false,error:'Could not save update acknowledgement: …'}`. nativePrefs.flush() rethrows a STICKY `failure` that is set by ANY earlier failed write or by a failed hydration and is never cleared, so the throw is permanent for the process. Failure chain in one launch: (a) `['app-update']` caches an error Result, so TopBar's `status` is null (TopBar.tsx:19-20) and the chip never appears, and AppUpdateRows.tsx:35 renders '0.12.2 · the update check did not run.'; (b) `Check again` re-enters the same branch — because `shown.has(token)` is already true the else-branch re-writes and re-flushes on every call — and fails identically; (c) the same sticky failure then rejects the `prefs.flush?.()` at useAppUpdateCheck.ts:28, so `ready` is never set. A cosmetic one-session notice takes down D1/D2/D3/D4/D5 on exactly the launch the feature exists to celebrate. The new test `reports a failure to persist acknowledgement as a retryable check error` locks the behaviour in. (Four reviewers found this; merged. Their 'undeclared deviation' clause is wrong — the report's deviations array does contain 'Added successful-update UI and an acknowledgement preference.')

**Suggested fix:** Never let the acknowledgement write change the check result: wrap `deps.prefs.set('updates:app:lastShown', token)` in a catch that records the write failure out-of-band (e.g. its own query key) and fall through to `return deps.result(checked)`; drop the `await deps.prefs.flush?.()` from check(); short-circuit the else branch when `shown.has(token)` so the write happens at most once per session. Rewrite app-update.test.ts:27-31 to assert the check still returns `{ok:true,value:{lastApply:{…}}}` when prefs.set throws.

**Evidence the verifier read:** app-update.ts:45-52 `else { shown.add(token); try { deps.prefs.set('updates:app:lastShown', token); await deps.prefs.flush?.(); } catch (error) { return deps.result({ ok: false, error: \`Could not save update acknowledgement: ${String(error)}\` }); } }`. tauri/prefs.ts:43-45 `void pending.catch(error => { failure = error; });` / `async flush() { await pending; if (failure) throw failure; }` — `failure` is also set by hydration (line 27 `catch (error) { failure = error; file = null; }`) and never reset. AppUpdateRows.tsx:35 renders the 'did not run' branch on `status.data?.ok===false`; TopBar.tsx:19 `const status=update?.data?.ok?update.data.value:null`.

---

### 2. [should-fix] The whole update policy is silently disabled for the session when prefs.flush() rejects, and the branch has no test

**Where:** `desktop/src/app/useAppUpdateCheck.ts:28-33`

**What is wrong:** `setReady(true)` is only reached after `await backend.prefs.flush?.()` succeeds; on rejection the hook records an outcome and returns, so `ready` stays false. `version` (line 17) is gated on `ready`, so `staged` is null and D3 staging, D4 on-close arming and D5 overnight are all dead for the rest of the run — while the chip still renders from the cached observation, so the user sees 'Update ready' and nothing ever installs. Hydration (`await backend.prefs.ready`, line 26) is what makes the migrated policy readable; the flush only writes it back. nativePrefs' `failure` is sticky, so any earlier failed write reaches this branch. No test covers it: useAppUpdateCheck.test.tsx never mocks `flush`, and the mock's browserPrefs has no `flush`, so `?.()` short-circuits and the branch is unreachable in the suite.

**Suggested fix:** Record the flush rejection into `['app-update-policy-outcome']` but still call `setReady(true)` — i.e. move `setReady(true)` out of the flush try/catch so only surfaces/features/prefs.ready gate it. Add a useAppUpdateCheck.test.tsx case with a rejecting `flush` asserting stage/armOnClose/apply still run.

**Evidence the verifier read:** useAppUpdateCheck.ts:28-33 `try { await backend.prefs.flush?.(); } catch (error) { client.setQueryData(['app-update-policy-outcome'], {ok:false,error:…}); return; } if (!disposed) setReady(true);`; line 17 `const version = ready && status?.supported && status.newer ? status.latest : null;`. desktop/src/backend/prefs.ts:39-70 `browserPrefs()` returns no `flush`.

---

### 3. [should-fix] D1's 'with the app row focused' is a focus steal on every mount, and the chip's own focus call is dead code

**Where:** `desktop/src/screens/settings/AppUpdateRows.tsx:18 and desktop/src/components/domain/TopBar.tsx:28`

**What is wrong:** D1 scopes focus to the chip click. `useEffect(()=>{row.current?.focus();},[])` runs on every mount of AppUpdateRows (both notice and full mode), so reaching Settings ▸ Updates from the sidebar, from ⌘, or from a deep link yanks keyboard focus onto a `tabIndex={-1}` wrapper with no focus-visible rule, losing the nav position. Meanwhile the chip handler assigns `location.hash` and then calls `document.getElementById('app-update-row')?.focus()` synchronously: hashchange is dispatched asynchronously and the Settings tree has not rendered, so the lookup returns null on every route other than #/settings/updates and the optional chain swallows it. The chip path therefore works only by accident, through the mount effect. The added test (app-update.test.tsx:99) asserts the over-broad behaviour after a plain `open()`, so it freezes the defect; the TopBar test only asserts `location.hash`.

**Suggested fix:** Carry the intent in the navigation — chip sets `location.hash='/settings/updates?focus=app'`, AppUpdateRows focuses only when the existing `useSearchParams` reports `focus=app` and then clears it with `{replace:true}` — and delete the synchronous `getElementById(...).focus()` from TopBar. Add a test that a plain navigation to Updates does not move focus.

**Evidence the verifier read:** AppUpdateRows.tsx:17-18 `const row=useRef<HTMLDivElement>(null); useEffect(()=>{row.current?.focus();},[]);` and line 49 `<div id="app-update-row" ref={row} tabIndex={-1} …>`. TopBar.tsx:28 `onClick={()=>{location.hash='/settings/updates';document.getElementById('app-update-row')?.focus();}}`. app-update.test.tsx:99 `it('focuses the app row when navigating to Updates',async()=>{await configure();open();…expect(document.getElementById('app-update-row')).toHaveFocus();})`.

---

### 4. [should-fix] An app-ACL permission was invented for an app-defined command: unnecessary by this repo's own precedent, never compiled, and untested

**Where:** `desktop/src-tauri/capabilities/default.json:10 and desktop/src-tauri/permissions/app-update.toml:1-4`

**What is wrong:** Spec §3 asks only that 'capabilities/default.json gains the command'. The batch added `"allow-app-update-on-close"` plus a new `permissions/app-update.toml`, while `build.rs` is a bare `tauri_build::build()` with no `app_manifest(...).commands(...)`. The six existing app commands (cli_spawn, cli_write, cli_kill, read_app_state, host_platform, quit) carry no capability entry and work in the shipped app, so the entry buys nothing. It is also the batch's only build-time risk and cannot be checked here (no cargo, no tauri-build sources in ~/.cargo): either tauri-build does not register `src-tauri/permissions/*.toml` under the app ACL with a default `build()`, in which case `tauri::generate_context!()` cannot resolve the identifier and all three shipping targets fail to compile; or it does register it, in which case the app gains an app-ACL manifest whose effect on the six unlisted commands is exactly what nobody has run. No test covers it either, although TopBar.test.tsx:31-36 already parses that JSON file and asserts individual permission entries. (Everything else in the new Rust compiles by inspection: `super::read_app_state()` is `fn read_app_state() -> Result<Option<String>,String>` at lib.rs:304, `super::default_spawn_dir()` at lib.rs:148 returns Option<PathBuf>, `disclaim_tcc_responsibility(&mut Command)` at disclaim.rs:68, and `&State<CloseUpdate>` derefs to `&CloseUpdate`.)

**Suggested fix:** Delete the `"allow-app-update-on-close"` entry and `desktop/src-tauri/permissions/app-update.toml`, registering `app_update_on_close` exactly like the other six commands. If the permission is genuinely wanted, declare it properly via `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&["app_update_on_close"])))` and extend TopBar.test.tsx to assert the capability entry, the TOML identifier and `commands.allow`. Either way `cargo check` for the three targets must run before merge.

**Evidence the verifier read:** capabilities/default.json:8-14 lists `"core:default", "allow-app-update-on-close", "core:window:allow-start-dragging", …` with no entry for any other app command; permissions/app-update.toml `[[permission]] identifier = "allow-app-update-on-close" … commands.allow = ["app_update_on_close"]`; build.rs is `fn main() { tauri_build::build() }`; lib.rs:329 `generate_handler![cli_spawn, cli_write, cli_kill, read_app_state, host_platform, quit, app_update::app_update_on_close]`; `ls ~/.cargo/registry/src/*/tauri-build-*` → nothing.

---

### 5. [should-fix] Overnight install fires the moment the user returns: sleep counts as idleness and the fire check runs before lastActivity is refreshed

**Where:** `desktop/src/app/overnightWindow.ts:53,60 (test: overnightWindow.test.tsx:41-44)`

**What is wrong:** `tick(activity)` evaluates `time - lastActivity >= idleMs` at line 53 with the PREVIOUS `lastActivity`, and only refreshes it at line 60, so an activity event can itself satisfy the idle test. Idleness is a wall-clock delta, so time the machine spent asleep — or time the user spent in another app, since pointermove/keydown only reach this window — counts as idle. Concrete sequence: policy `overnight`, 0.12.2 staged, app left open; the laptop sleeps at 23:40; the lid opens at 02:10. `msUntilWindow` returns 0 and the elapsed delta is 2h30m ≥ 30min, so whichever lands first — the overdue timer or the first pointermove — calls onFire, which runs `appUpdate.apply(staged,'overnight')` then `backend.quit()` with no dialog (useAppUpdateCheck.ts:66-70), quitting under an actively-returning user and killing any running eval or sync. This contradicts the shipped copy 'while the app is open and idle' (AppUpdateRows.tsx:20) and K1's 'once the person has been idle for idleMs'. D5's 'plus the idle check on the next user event' is the only text that could authorise it. The test at :41-44 enshrines it.

**Suggested fix:** In `tick`, set `lastActivity = time` before the line-53 check when `activity === true` (or add `!activity &&` to the condition), AND treat a large positive gap between the scheduled delay and the elapsed wall time as a wake — reset `lastActivity` instead of firing — so a suspended laptop does not install the moment the lid opens. Update the 'suspended timer' test to assert the opposite.

**Evidence the verifier read:** overnightWindow.ts:52-60 `const date = now(), time = date.getTime(); … if (wait === 0 && !nights.current.has(night) && time - lastActivity >= idleMs) { … onFire … } if (activity || time < lastActivity) lastActivity = time;` with `const activity = () => tick(true);` bound to pointerdown/pointermove/keydown/wheel (lines 65-67). overnightWindow.test.tsx:41-44 mounts at 00:00, sets the clock to 02:00, fires one pointerMove and asserts `expect(onFire).toHaveBeenCalledOnce()`.

---

### 6. [should-fix] A failed manual install permanently clears the on-close arm for the rest of the session

**Where:** `desktop/src/backend/tauri/app-update.ts:57-60`

**What is wrong:** `apply()` unconditionally disarms first (correct, so two installers cannot race), but nothing restores the arm when the run fails. The only re-arm path is the effect at useAppUpdateCheck.ts:52-63 whose deps are `[backend, client, policy, ready, staged]` — none of which change after a failed apply. Sequence: policy `on-close`, 0.12.2 staged, shell armed; the user clicks Install now → Relaunch; `apply('0.12.2')` invokes `app_update_on_close({version:null})` (Rust sets `*armed = None`), then the CLI run fails (e.g. 'Nothing is staged for 0.12.2; download it first.' after a pruned staging dir); the dialog shows the error, the user clicks Later and keeps working. On quit, `take_for_exit` finds `None` and spawns nothing: no install, no marker, and the next launch offers the same Install now. The chosen 'When I quit' policy silently did nothing and no signal says it was disarmed.

**Suggested fix:** Track the last armed version in the `createAppUpdate` closure and restore it inside `apply` when the run result is not ok, before returning the failure: `if (!result.ok && armedVersion) await arm(armedVersion);`. Add a test that a failed apply leaves `app_update_on_close` armed with the original version.

**Evidence the verifier read:** app-update.ts:57-60 `apply: async (version, reason) => { const disarmed = await arm(null); if (!disarmed.ok) return disarmed; return deps.run([…'--apply'…]).done.then(r => r.ok ? {ok:true,value:undefined} : r).then(deps.result); }` — no re-arm on the failure branch. useAppUpdateCheck.ts:63 dependency array `[backend, client, policy, ready, staged]`. app_update.rs:36 `*armed = None;`, :19 `if armed.is_some() && !self.started.swap(true, …)`. The failure path is already exercised by app-update.test.tsx:70-73 ('keeps the dialog open and shows the error when apply fails').

---

### 7. [should-fix] Every automatic-update failure is written to a query entry with no observer, so it is garbage-collected after 5 minutes

**Where:** `desktop/src/app/useAppUpdateCheck.ts:19,45,48,55-56,60-61,69`

**What is wrong:** Staging, arming, disarming, the prefs flush and the overnight apply all record into `['app-update-policy-outcome']` via setQueryData. `useAppUpdateCheck` never observes that key; the only observer is AppUpdateRows.tsx:21, which exists solely while Settings ▸ Updates is mounted. The app's QueryClient sets retry/staleTime/refetch flags but no gcTime (providers.tsx:18), so the entry inherits react-query's 5-minute default — the authors explicitly set `gcTime: Infinity` for `['app-update']` (useAppUpdateCheck.ts:27, AppUpdateRows.tsx:24) but not here. Concrete failure: default `on-close`; at launch `armOnClose` resolves `{ok:false,'No CLI launch state; launch the app through terum-skills app first.'}` (app_update.rs:40); the error is cached with no observer and GC'd at t+5min. At t+30min the user opens Settings ▸ Updates, sees '0.12.2 downloaded and verified / Install now' with no error, quits, and nothing installs — nothing is armed, so the shell writes no failure marker either.

**Suggested fix:** Give the key an observer with a persistent lifetime inside useAppUpdateCheck (`useQuery({queryKey:['app-update-policy-outcome'],enabled:false,queryFn:skipToken,gcTime:Infinity})` beside the other two), or `client.setQueryDefaults(['app-update-policy-outcome'],{gcTime:Infinity})`.

**Evidence the verifier read:** useAppUpdateCheck.ts:14-15 observe `['app-update']` and `['app-update-staging']` only; every outcome write is a bare `client.setQueryData(['app-update-policy-outcome'], …)` (lines 19,30,45,48,55,56,60,61,69). AppUpdateRows.tsx:21 `useQuery({queryKey:['app-update-policy-outcome'],enabled:false,queryFn:skipToken})`. providers.tsx:18 `new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30_000,refetchOnWindowFocus:true,refetchOnReconnect:false,refetchOnMount:'always'}}})` — no gcTime.

---

### 8. [should-fix] One shared outcome key aggregates five unrelated failures, and line 55 writes success unconditionally, erasing an unread error

**Where:** `desktop/src/app/useAppUpdateCheck.ts:55`

**What is wrong:** `['app-update-policy-outcome']` is the single channel for the staging error (45/48), the prefs-flush error (30), the arm/disarm outcome (55-56) and the overnight apply error (69) — last writer wins — and line 55 writes the SUCCESS value `{ok:true,value:undefined}` unconditionally. Two concrete losses: (a) at launch the arm effect's `disarmOnClose()` success and the stage failure at line 45 race, so a fast stage failure is overwritten by the slower disarm success; (b) after a failed overnight apply (line 69 is the only trace, and `useOvernightWindow` has already marked the night consumed at overnightWindow.ts:54 so it will not retry), the user switches the policy — the effect re-runs, `disarmOnClose()` succeeds and line 55 overwrites the overnight failure with `{ok:true}`, so the user never learns the install did not happen. The cleanup at line 60 already gets this right (`if (!outcome.ok)`). Note the reviewer's 'Check again' trigger is wrong: that only re-runs the effect if the derived `staged` string actually changes.

**Suggested fix:** Mirror the cleanup — write the outcome in the effect body only when `!outcome.ok` — and keep distinct query keys (or an array) for the staging, arming and apply concerns so one failure cannot hide another.

**Evidence the verifier read:** useAppUpdateCheck.ts:54-57 `const result = policy === 'on-close' && staged ? backend.appUpdate.armOnClose(staged) : backend.appUpdate.disarmOnClose(); void result.then(outcome => { client.setQueryData(['app-update-policy-outcome'], outcome); }, …)` versus the cleanup at :59-61 `if (!outcome.ok) client.setQueryData(…)`. overnightWindow.ts:54 `nights.current.add(night);` before calling onFire.

---

### 9. [should-fix] A spawned-but-immediately-dead installer is indistinguishable from a successful handoff, so an on-close install can vanish with no marker

**Where:** `desktop/src-tauri/src/app_update.rs:64 and src/commands/appUpdate.ts:132`

**What is wrong:** `spawn()` returns Ok as soon as `Command::spawn` succeeds; stdout/stderr are `Stdio::null()` and nothing waits for the exit status, so every failure the CLI hits before it writes its first marker is invisible. In `src/commands/appUpdate.ts` the `--apply-now` leg returns `failure('Nothing is staged for …')` at line 132 while `markerPath`/`mark`/`failed` are only defined at lines 142-144, so that guard (and the unsupported-platform/not-released guards earlier) writes nothing; a `node` that cannot load the recorded `entry` (npx cache cleared between launch and quit) is equally silent, because `Command::spawn` only proves the node binary exists. Concrete failure: default 'When I quit', chip says 'Update ready · 0.12.2', the user quits, the installer dies with MODULE_NOT_FOUND, and the next launch's check returns `lastApply: null`, so Settings shows '0.12.2 downloaded and verified · Install now' as though the quit never happened. D4's promise that 'the marker records the failure' only covers the narrow `Command::spawn` error.

**Suggested fix:** Write a `phase:"waiting"` marker (the JSON `record_failure` already builds) from the shell immediately before `command.spawn()`, so an installer that dies before its own `mark('waiting')` leaves a stale pending marker; and in src/commands/appUpdate.ts move the `markerPath`/`mark`/`failed` definitions above the `staged.json`, `supported` and `released` guards in the applyNow branch.

**Evidence the verifier read:** app_update.rs:54 `.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());` and :64 `command.spawn().map(|_| ())`; on_exit (:99-105) treats any Ok as done. src/commands/appUpdate.ts:132 `if (!(await exists(join(versionDir,'staged.json')))) return failure(\`Nothing is staged for ${version}; download it first.\`);` precedes :142 `const markerPath = join(root,'run','app-update.json');` and :146 `await mark('waiting');`.

---

### 10. [should-fix] The entire effectful half of the new Rust module is untested, including the failure marker that must satisfy two parsers

**Where:** `desktop/src-tauri/src/app_update.rs:32-45, 49-65, 80-92 (tests at :108-127)`

**What is wrong:** The five `#[cfg(test)]` tests cover only `argv`, `released`, `timestamp`, the once-flag and a disarmed no-op exit. Untested: `app_update_on_close` (arm/disarm, the `started` guard, launch-state parsing, the node/entry field extraction), `spawn`, and `record_failure`. `record_failure`'s body must be accepted by BOTH `readMarker` (src/commands/appUpdate.ts:189-198) and the zod `z.strictObject` at desktop/src/backend/tauri/app-update.ts:6 — strict, so one extra or renamed key makes the desktop reject the whole `--check` payload and show 'the update check did not run'. I read both and the shapes match today, so this is a coverage gap rather than a live defect — which, with cargo unavailable (the code has never even been compiled), is why the reviewer's 'blocker' is overstated.

**Suggested fix:** Add Rust unit tests that (a) serialize `record_failure`'s JSON and assert the exact key set and value types against the zod object, (b) drive `app_update_on_close` with fabricated launch-state JSON covering missing `node`, missing `entry`, empty strings, a non-semver version and the post-`started` call, and (c) assert the argv+env by extracting a pure command builder that can be asserted without spawning.

**Evidence the verifier read:** app_update.rs:108-127 contains exactly `close_argv`, `versions`, `timestamps`, `handoff_is_once_even_if_a_late_arm_arrives`, `disarmed_exit_is_noop`. :85 `serde_json::json!({"schema":1,"version":version,"phase":"failed","at":at,"error":error,"reason":"on-close"})` vs app-update.ts:6 `z.strictObject({schema:z.literal(1),version:z.string(),phase:z.enum([…]),at:z.string(),error:z.string().nullable(),reason:z.enum(['on-close','overnight','manual']).optional()})` — compatible as written.

---

### 11. [should-fix] Two queryByRole('switch') assertions became vacuous; nothing proves the policy select is hidden in notice mode or when the surface is off

**Where:** `desktop/src/screens/settings/app-update.test.tsx:25 and :53`

**What is wrong:** Both assertions predate the diff, when AppUpdateRows rendered a Switch. AppUpdateRows now renders `InlineChoice` (role combobox) and the 'The app' group in SettingsContent contains nothing but AppUpdateRows, so `queryByRole('switch')` is trivially null in every mode and asserts nothing. No replacement was added. Concrete failure: dropping the `mode==='full'?…:null` guard on the 'Install updates' row would ship an update-policy select on a machine with no desktop build channel (notice mode) and the suite stays green.

**Suggested fix:** Change both to `expect(within(group()).queryByRole('combobox')).toBeNull()`, keeping the positive `getByRole('combobox',{name:'Install updates'})` assertion in the full-mode policy test.

**Evidence the verifier read:** app-update.test.tsx:25 `…expect(within(group()).queryByRole('switch')).toBeNull();` and :53 `…expect(within(group()).queryByRole('switch')).toBeNull();`. AppUpdateRows.tsx:49 renders `<InlineChoice label="Install updates" …/>`, and WorkflowControls.tsx:19-21 builds it from `BaseSelect.Trigger` (combobox), no switch. SettingsContent.tsx:92 `<Group label="The app" …><Card>…<AppUpdateRows …/></Card></Group>`.

---

### 12. [should-fix] configure() still seeds the removed updates:app:auto, so every Settings test runs under 'ask' and the shipping default on-close is never exercised

**Where:** `desktop/src/screens/settings/app-update.test.tsx:19`

**What is wrong:** `configure()` keeps the pre-diff `backend.prefs.set('updates:app:auto',false);`. The mock uses browserPrefs, whose new policy read path migrates `auto:false → 'ask'`, so all 20+ tests in the file — including 'offers Download and stages the advertised version', the 'newer available' row and the Download/Install-now flows — run under `ask`, the one policy where useAppUpdateCheck does not auto-stage. The default `on-close` (D3/Q4) is never rendered in Settings, and the file's coverage hinges on a legacy key this batch is deleting. Concrete failure: under the real default the launch hook stages immediately, so a user opening Settings ▸ Updates sees 'downloading …' then 'Install now', never 'Download' — a path with no Settings-level test.

**Suggested fix:** Replace the line with `backend.prefs.set('updates:app:policy','ask');`, and add at least one case that seeds no preference (default on-close) and asserts the automatic download progress then Install now.

**Evidence the verifier read:** app-update.test.tsx:19 `backend.prefs.set('updates:app:auto',false);`; mock/index.ts:202 `prefs:browserPrefs()`; backend/prefs.ts:44-52 reads the legacy key and returns `migrateAppUpdatePolicy(record)['updates:app:policy']`, which is `'ask'` for `auto === false` (prefs.ts:18). app-update.test.tsx:81 correspondingly expects the select to read 'Ask me'.

---

### 13. [should-fix] A pre-existing hook test still asserts a deleted preference and now passes only by accident of the migration

**Where:** `desktop/src/app/app-update-launch.test.tsx:33-36`

**What is wrong:** `it.each(['preference','not-newer','already-staged'])('does not stage for %s')` does `h.backend.prefs.set('updates:app:auto',false)` for the 'preference' case. Nothing reads `updates:app:auto` any more; the case passes only because browserPrefs migrates that legacy key to 'ask'. A test named after a preference now silently tests the migration, and it will flip to a false failure the moment the legacy key leaves `legacyPreferences`/`browserPrefs`. The file is also a second hook test beside the new useAppUpdateCheck.test.tsx (spec §3 names one test beside useAppUpdateCheck.ts), and its sibling at line 30 is still titled 'auto-stages the advertised version when the preference is on'. The report's testsModified array does not list this file (it is declared only as the deviation 'retained app-update-launch.test.tsx').

**Suggested fix:** Move this file to the policy vocabulary (`prefs.set('updates:app:policy','ask')`, rename the case) or fold its unique cases (surface/feature off, unmount, notPublished) into useAppUpdateCheck.test.tsx and delete it; list the change in testsModified.

**Evidence the verifier read:** app-update-launch.test.tsx:33-35 `it.each(['preference','not-newer','already-staged'] as const)('does not stage for %s',async mode=>{ … if(mode==='preference')h.backend.prefs.set('updates:app:auto',false); …})` and :30 `it('auto-stages the advertised version when the preference is on', …)`. No occurrence of `updates:app:auto` remains in production reads outside backend/prefs.ts:33 (legacy import) and :45-57 (migration).

---

### 14. [should-fix] D3's three fixed description strings and a successful 'Overnight' selection have no assertion at all

**Where:** `desktop/src/screens/settings/AppUpdateRows.tsx:20,49 (test: app-update.test.tsx:80-84)`

**What is wrong:** The spec fixes three exact strings ('Ask me — show Install now, never install by itself', 'When I quit — install the downloaded update after the app closes', 'Overnight — install and relaunch between 01:00 and 05:00 while the app is open and idle'). No test asserts any of them. The only policy test asserts the trigger labels ('Ask me' → 'When I quit') and then selects 'Overnight' ONLY in the branch where `prefs.set` throws, so `'overnight'` is never successfully persisted or rendered anywhere in the Settings suite — and that select is the only path a real user has to the overnight scheduler.

**Suggested fix:** Assert the matching description text in `group()` after each of the three selections, and add the successful Overnight selection (`expect(set).toHaveBeenCalledWith('updates:app:policy','overnight')`) before the throwing-write case.

**Evidence the verifier read:** AppUpdateRows.tsx:20 defines the three literals inline; :49 renders `desc={descriptions[policy]}`. app-update.test.tsx:81-83: the only `set` assertion is `expect(set).toHaveBeenCalledWith('updates:app:policy','on-close')`, and the Overnight click happens after `set.mockImplementation(()=>{throw new Error('Preferences are read-only.');})`, asserting the alert and that the trigger still reads 'When I quit'.

---

### 15. [should-fix] 'Check again' now writes a failed check into the shared cache, removing the top-bar chip and the last good observation

**Where:** `desktop/src/screens/settings/AppUpdateRows.tsx:26`

**What is wrong:** `recheck` changed from `action.perform(()=>backend.appUpdate.check({force:true}), value=>client.setQueryData(['app-update'],{ok:true,value}))` to running the check through `client.fetchQuery`, which stores whatever the check resolves to — including `{ok:false,…}` — under `['app-update']`. `useWorkflow.perform` only calls the success callback when `result.ok`, so previously a failed recheck left the last good observation in the cache; now the failure lands there first. TopBar reads the same key, so the chip disappears. Concrete failure: an update is advertised and staged, the user clicks 'Check again' while offline, the chip vanishes and the cached latest/staged observation is lost until relaunch even though a verified download is on disk. Only the failure → success direction is tested (app-update.test.tsx:43-46).

**Suggested fix:** Keep the last good observation on failure — restore the plain `action.perform(()=>backend.appUpdate.check({force:true}), value=>client.setQueryData(['app-update'],{ok:true,value}))` — and add a test that a failed 'Check again' leaves `['app-update']` and the chip intact.

**Evidence the verifier read:** AppUpdateRows.tsx:26 `const recheck=()=>void action.perform(()=>client.fetchQuery({queryKey:['app-update'],queryFn:()=>backend.appUpdate.check({force:true}),staleTime:0,retry:false}),value=>client.setQueryData(['app-update'],{ok:true,value}));`. useWorkflow.ts:44-50 `const result = await start(); … if (result.ok) success?.(result.value); … else setError(result.error);`. TopBar.tsx:18 reads `client?.getQueryState<Result<AppUpdateStatus>>(['app-update'])`.

---

### 16. [nit] Chip and Settings say 'Update ready' for a version the launch hook refuses to arm

**Where:** `desktop/src/components/domain/TopBar.tsx:20,28 vs desktop/src/app/useAppUpdateCheck.ts:18`

**What is wrong:** The chip decides 'Update ready' from `status.staged===status.latest` alone, and AppUpdateRows.tsx:43 shows 'Install now' on the same test, while the hook computes `staged` as `status.staged===version && !status.installed.includes(version)`. After an install that wrote installed.json but did not leave the user on the new build, `installed` contains the version while `newer` is still true: both visible affordances offer the update, but the hook's `staged` is null, so it never arms on close and never schedules overnight. Three surfaces disagree about the same state.

**Suggested fix:** Derive one predicate — export the `staged` computation from useAppUpdateCheck (or a small helper in backend/prefs) and use it in TopBar and AppUpdateRows too.

**Evidence the verifier read:** TopBar.tsx:28 `{status.staged===status.latest?'Update ready':'Update available'}`; AppUpdateRows.tsx:43 `else if(s.staged===s.latest){…control=<Button … onClick={()=>setRelaunch(s.latest)}>Install now</Button>;}`; useAppUpdateCheck.ts:18 `const staged = version !== null && status?.staged === version && !status.installed.includes(version) ? version : null;`.

---

### 17. [nit] pointermove reschedules the timer on every mouse move for as long as the policy is overnight

**Where:** `desktop/src/app/overnightWindow.ts:66-68`

**What is wrong:** `activity` is bound to pointermove and runs the full `tick(true)`: clearTimeout, `new Date()`, `msUntilWindow` (which allocates two more Dates inside `boundary`), then setTimeout. While policy is overnight and a version is staged — potentially all day, since the hook is enabled from launch — every mouse move over the window does that at pointer-event rate. Only the last activity timestamp matters until the window opens.

**Suggested fix:** Make the activity handler cheap: record `lastActivity` and only re-run `tick` when the pending timer would actually be wrong (inside the window), throttled to at most once per second.

**Evidence the verifier read:** overnightWindow.ts:65-67 `const activity = () => tick(true); const events = ['pointerdown','pointermove','keydown','wheel'] as const; for (const event of events) window.addEventListener(event, activity, { passive: true });` and tick's body at :49-64 (clearTimeout, now(), msUntilWindow, setTimeout).

---

### 18. [nit] Mock armOnClose/disarmOnClose do not record the call, as spec §3 requires

**Where:** `desktop/src/backend/mock/index.ts:195-196`

**What is wrong:** Spec §3 says 'armOnClose/disarmOnClose seam methods (mock: no-op, records the call for tests)'. The mock returns `ok(undefined)` and records nothing, although it already exposes a readonly record surface (`Backend & {readonly quitRequested:boolean}`). The new tests work around it with `vi.spyOn(backend.appUpdate,'armOnClose')`, so any test or harness that needs the mock's own record — the mock is also the e2e/fidelity fixture — has nothing to read.

**Suggested fix:** Push the call into the mock's recording structure (e.g. `armOnClose:async v=>{calls.push(['armOnClose',v]);return ok(undefined);}` and the same for disarm) and expose it on the readonly surface beside `quitRequested`.

**Evidence the verifier read:** mock/index.ts:195-196 `armOnClose:async()=>ok(undefined), disarmOnClose:async()=>ok(undefined),`; mock/index.ts:53 `export function createMockBackend(opts:{latencyMs?:number}={}):Backend & {readonly quitRequested:boolean}`; useAppUpdateCheck.test.tsx:20 `const arm = vi.spyOn(backend.appUpdate,'armOnClose'), disarm = vi.spyOn(backend.appUpdate,'disarmOnClose');`.

---

### 19. [nit] AppUpdateStatus.reason is populated but never read

**Where:** `desktop/src/backend/types.ts:130`

**What is wrong:** Spec §3 and K7 do authorise `AppUpdateStatus += reason`, but the adapter also copies `reason` onto `AppUpdateMarker` and the UI reads only `s.lastApply.reason`. A grep over production sources finds no consumer of the top-level `status.reason`. Two copies of one value on one object invite divergence; the adapter spreads them from the same source today but nothing enforces it.

**Suggested fix:** Either drop the top-level `reason` from AppUpdateStatus and the corresponding spread in tauri/app-update.ts, or make the UI read `s.reason` and drop it from the marker — one home for the value.

**Evidence the verifier read:** types.ts:130 `export interface AppUpdateStatus {reason?:AppUpdateReason; …}`; app-update.ts:41 maps `...(value.lastApply?.reason === undefined ? {} : { reason: value.lastApply.reason })` at the top level AND inside lastApply; AppUpdateRows.tsx:38,47 read only `s.lastApply.reason` / `last.reason`; `grep -rn "\.reason" desktop/src --include=*.tsx --include=*.ts | grep -v test | grep -v lastApply` returns only unrelated Result/clone/notOffered reasons.

---

### 20. [nit] The browser migration writes to localStorage inside get(), which usePreference calls as its getSnapshot, and persists the default for users who never had either key

**Where:** `desktop/src/backend/prefs.ts:44-59`

**What is wrong:** D3 says migrate 'on first read (one-time, in the prefs hydration the way chrome keys were migrated)'. The native path does exactly that (tauri/prefs.ts:23). The browser path instead does it inside `browserPrefs.get('updates:app:policy')`, which usePreference invokes as the useSyncExternalStore getSnapshot — i.e. during render, on every render and on every tearing re-read. It also writes `"on-close"` for a user with neither key: with `current === null && legacy === null` the record is empty, `migrateAppUpdatePolicy` still yields 'on-close', so `current !== encoded` and setItem runs, storing a value the user never chose (and pinning them to today's default if it ever changes). No infinite loop results because the write bypasses the listener notify.

**Suggested fix:** Run the migration once at store construction in `browserPrefs()` (mirroring the native hydration) and make `get` a pure read; skip the write when neither `updates:app:policy` nor `updates:app:auto` is present.

**Evidence the verifier read:** backend/prefs.ts:42-59 — the whole migration, including `if (current !== encoded) localStorage.setItem(PREF_PREFIX + key, encoded);`, lives inside `get<T>(key, fallback)`; prefs.ts:18 `if (migrated['updates:app:policy'] === undefined) migrated['updates:app:policy'] = migrated['updates:app:auto'] === false ? 'ask' : 'on-close';` (so an empty record yields 'on-close'). backend/index.ts:31 `useSyncExternalStore(listener=>prefs.subscribe?.(listener)??(()=>{}),()=>JSON.stringify(prefs.get(key,fallback)))`.

---

### 21. [nit] Only the selected policy's description is shown, and 'manual' is never sent to the CLI

**Where:** `desktop/src/screens/settings/AppUpdateRows.tsx:20,49`

**What is wrong:** (a) D3 lists three descriptions, one per policy; the row shows only `descriptions[policy]`, so the user cannot read what 'Overnight' means before choosing it. InlineChoice has no per-option description slot (it renders `BaseSelect.ItemText` only), so this is a real constraint of the drawn component, not an oversight — but it is still a partial match that should be recorded. (b) D7 defines `--reason manual` and the seam takes `reason?: 'manual'|'overnight'`, but the Install-now confirm calls `backend.appUpdate.apply(relaunch)` with no reason, so 'manual' is never written to a marker by the app; the resulting 'Updated to X' row is byte-identical to one produced by a pre-`--reason` build. D7's 'omitted' display keeps the behaviour conformant, so the value is merely dead.

**Suggested fix:** (a) Render the three descriptions under the row, or record in the spec that only the selected one is shown. (b) Pass the reason: `backend.appUpdate.apply(relaunch,'manual')`, and assert `--reason manual` reaches the argv in app-update.test.tsx.

**Evidence the verifier read:** AppUpdateRows.tsx:49 `<Row title="Install updates" desc={descriptions[policy]}>` and, in the dialog, `onClick={()=>void action.perform(()=>backend.appUpdate.apply(relaunch),()=>{void backend.quit().catch(action.fail);})}`; Backend.ts `apply(version: string, reason?: 'manual' | 'overnight')`; src/cli.ts:195 `.addOption(new Option('--reason <reason>', …).choices(['on-close','overnight','manual']))`; WorkflowControls.tsx:20 renders items as `<BaseSelect.ItemText>{option}</BaseSelect.ItemText>` with no description slot.

---

### 22. [nit] Shipped prose now contradicts the default policy (declared deviation — must not be lost at merge)

**Where:** `desktop/src/screens/settings/SettingsContent.tsx:92 and README.md:210`

**What is wrong:** SettingsContent.tsx:92 still renders the note 'it downloads its own new version here, and installs it only when you press Relaunch', and README.md:210 still says 'installs only after you press Relaunch'. With D3's default `on-close`, the app downloads AND installs on quit without the user pressing anything, so both statements are now false. K8 and K5 forbid this batch from editing those regions, and the report declares it ('Stale Relaunch-only wording remains in SettingsContent.tsx and README prose outside the command table'), so it is correctly left — but it is a post-merge action item.

**Suggested fix:** Orchestrator, post-merge: rewrite the SettingsContent note and the README sentence to describe the three policies, e.g. 'it downloads its own new version here and installs it when you quit, overnight, or when you press Install now — whichever you chose'.

**Evidence the verifier read:** SettingsContent.tsx:92 `<Group label="The app" note={…<Note>The CLI never installs a CLI release for you. The app is the one exception: it downloads its own new version here, and installs it only when you press Relaunch.</Note>}>`; README.md:210 '…verifies the published SHA-256, and installs only after you press Relaunch.' (the README diff touched only the command-table row at line 83).

---

### 23. [nit] on_exit swallows a poisoned-lock error with only a log, dropping the armed install with no record

**Where:** `desktop/src-tauri/src/app_update.rs:95-98`

**What is wrong:** `take_for_exit` maps a PoisonError to `Err(String)` and `on_exit` handles it with `log::error!` and `return` — a catch that only logs, with no written justification, which the standing rule forbids. If it happened the close would proceed, the armed installer would never spawn and `record_failure` would never run, so the next launch would show neither 'Updated to …' nor 'installing … did not finish'. I am downgrading the reviewer's should-fix to nit because the poison is not reachable: the only code holding that lock is `app_update_on_close`, whose body is all `Result`-returning calls plus `serde_json::Value` indexing (which returns Null rather than panicking). The fix is still one token and removes the class.

**Suggested fix:** Recover instead of dropping the install: `self.armed.lock().unwrap_or_else(|e| e.into_inner())` in `take_for_exit` (keep the Err in the command, where it surfaces to the WebView). If a poison must still abort, call `record_failure` before returning.

**Evidence the verifier read:** app_update.rs:17-20 `let mut armed = self.armed.lock().map_err(|e| e.to_string())?;` and :95-98 `let armed = match state.take_for_exit() { Ok(value) => value, Err(error) => { log::error!("Could not read close-time update: {error}"); return; } };` — no comment justifying the bare log. The lock is held in `app_update_on_close` (:34-43) only across `read_app_state()?`, `serde_json::from_str(...).map_err(...)?` and `launch[name].as_str()`.

---

### 24. [nit] tick() is unguarded, so a throw inside it silently kills the scheduler for the session

**Where:** `desktop/src/app/overnightWindow.ts:47-64`

**What is wrong:** `tick` calls `msUntilWindow(date, startHour, endHour)`, which throws RangeError on an invalid clock or out-of-range hours, and `tick` is only re-entered from `setTimeout(tick, …)` and the activity listeners. A throw inside the timer callback is an uncaught exception: no further timer is scheduled, `onError` is never called, and the overnight install stops for the rest of the process with nothing recorded. The onFire path is correctly protected (lines 55-58) but the scheduling loop around it is not. Unreachable with the production defaults (`now = () => new Date()`, hours validated once at line 42), but the module is shared with f-wizard, which supplies its own options.

**Suggested fix:** Wrap the body of `tick` in `try { … } catch (error) { callbacks.current.onError?.(error); }` and schedule the next timer in a `finally`, so a bad clock reading degrades to a retry instead of permanently stopping the scheduler.

**Evidence the verifier read:** overnightWindow.ts:47-64 — `function tick(activity = false): void { … const wait = msUntilWindow(date, startHour, endHour); … timer = setTimeout(tick, Math.max(1, delay)); }` with no try/catch, versus the guarded onFire at :55-58 `void Promise.resolve().then(…).catch(error => { callbacks.current.onError?.(error); });`. msUntilWindow throws at :28 (`validateHours`) and :29 (`if (!Number.isFinite(now.getTime())) throw new RangeError(...)`).

---

### 25. [nit] The launch effect's bare catch states a reason that is false for two of the three throw sites it covers

**Where:** `desktop/src/app/useAppUpdateCheck.ts:34`

**What is wrong:** `catch { /* The cached check error remains available to Settings; launch stays usable. */ }` wraps `backend.surfaces()`, `backend.features()`, `backend.prefs.ready` and `client.ensureQueryData`. The stated justification holds only for the last: a check that resolves `{ok:false}` is cached and does surface in Settings. If `surfaces()` or `features()` rejects, nothing is cached and nothing is recorded — `ready` stays false, the chip never appears, and no staging, arming or overnight install happens, with zero user-visible trace. The standing rule asks for an accurate reason on the line.

**Suggested fix:** Call `recordError(error)` before returning, or narrow the try so the surfaces/features rejection has its own handler and its own accurate comment.

**Evidence the verifier read:** useAppUpdateCheck.ts:23-34 — the try opens before `if (!(await backend.surfaces()).appUpdate || disposed) return;` and `if (!(await backend.features()).appUpdate || disposed) return;` and closes with `} catch { /* The cached check error remains available to Settings; launch stays usable. */ }`. `recordError` is defined at line 19 and used only by the overnight `onError`.

---

### 26. [nit] A stage that returns ok but staged:false is recorded nowhere and never retried this session

**Where:** `desktop/src/app/useAppUpdateCheck.ts:44-46`

**What is wrong:** The automatic staging path records `!result.ok` and applies `result.value.staged`, but the `ok && !staged` case (notPublished: the tag is advertised and its assets are missing) falls through both branches and writes nothing, while `attempted.current.add(version)` blocks any retry for the process. Under the default on-close policy the download silently never happens; the chip stays on 'Update available' and the Settings row keeps offering Download, which is honest but gives no hint that the automatic attempt already ran and produced nothing. W-01 documents the quiet notPublished behaviour, so this is a small gap rather than a contract break.

**Suggested fix:** Record it explicitly, e.g. `else if (!result.value.staged) client.setQueryData(['app-update-policy-outcome'], {ok:false, error:`${version} is announced but its files are not published yet.`})`, or add a one-line comment stating why a silent no-op is correct.

**Evidence the verifier read:** useAppUpdateCheck.ts:40-46 `attempted.current.add(version); … const result = await backend.appUpdate.stage(version).done; if (!result.ok) client.setQueryData(['app-update-policy-outcome'], result); else if (result.value.staged) client.setQueryData<…>(['app-update'], …);` — no else. Covered only as a non-assertion in app-update-launch.test.tsx:45-47.

---

### 27. [nit] The background-download row state (no Cancel button) has no test

**Where:** `desktop/src/screens/settings/AppUpdateRows.tsx:42`

**What is wrong:** `else if(action.busy||background)` renders 'Downloading…' and suppresses Cancel when the download was started by the launch hook rather than by this screen. The only download-progress test drives the `action.busy` path and asserts Cancel IS present; the `background`-only branch — the one a user hits under the default on-close policy — is never rendered in any test, so a regression that renders an enabled Cancel with no active Run (which would throw on click) goes unnoticed.

**Suggested fix:** Add a case that seeds `client.setQueryData(['app-update-staging'],'0.1.12')` without an active workflow and asserts 'Downloading…' is disabled and `queryByRole('button',{name:'Cancel'})` is null.

**Evidence the verifier read:** AppUpdateRows.tsx:42 `else if(action.busy||background){desc=…;control=<><Button disabled>Downloading…</Button>{action.busy?<Button onClick={()=>void action.stop()}>Cancel</Button>:null}</>;}` with `background` from `useQuery({queryKey:['app-update-staging'],…})` at :22. app-update.test.tsx:85-88 drives the path via a real stage Run (action.busy) and asserts `fireEvent.click(screen.getByRole('button',{name:'Cancel'}))`.

---

### 28. [nit] The row does not normalise the stored policy the way the hook does, and no test covers a malformed value

**Where:** `desktop/src/screens/settings/AppUpdateRows.tsx:16`

**What is wrong:** The hook wraps the read in `appUpdatePolicy(usePreference('updates:app:policy','on-close'))`; the row uses the raw typed `usePreference`. `preferenceValue` only compares `typeof`, so any stored string survives: `policies['bogus']` and `descriptions['bogus']` are undefined, giving a blank select value and an empty description row while the hook silently behaves as on-close. Narrower than the reviewer claims: both hydration paths normalise (nativePrefs runs migrateAppUpdatePolicy at :23, browserPrefs at prefs.ts:52), so a hand-edited preferences.json is cleaned up — the value can only get through via a programmatic `prefs.set('updates:app:policy', <garbage>)` within a session.

**Suggested fix:** Use `appUpdatePolicy(usePreference('updates:app:policy','on-close'))` in AppUpdateRows too, and add a case seeding a bogus value that asserts the select reads 'When I quit'.

**Evidence the verifier read:** AppUpdateRows.tsx:16 `const policy=usePreference<'ask'|'on-close'|'overnight'>('updates:app:policy','on-close');` vs useAppUpdateCheck.ts:11 `const policy = appUpdatePolicy(usePreference('updates:app:policy', 'on-close'));`. backend/prefs.ts:23-25 `preferenceValue` only checks `typeof value === typeof fallback`. tauri/prefs.ts:34-36 `set` validates only `isChromePreference(key)`.

---
