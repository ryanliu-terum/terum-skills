# Review fixes for f-wizard

An independent review pass (five lenses, then an adversarial verifier that read the code and refuted what it could)
produced the findings below against your rebased branch. Every one listed here was CONFIRMED against the code you
wrote; refuted claims have been dropped, so treat each of these as real.

**What to do.** Fix every `blocker` and every `should-fix`. Fix the `nit` items too unless a fix would break a locked
contract or contradict the spec or an amendment — say which ones you skipped and why in `deviations`. Where a finding
names a test that was weakened, made vacuous, or now protects the wrong output, restore its teeth: an existing test is
never weakened to match new behaviour, and a snapshot is never left recording a defect. Where a finding says behaviour
has no test, add the test.

Two of these are serious enough to name here. The measured estimate never fires against a real receipt, so the headline
promise of this batch — telling the person what the batch will cost before they pay for it — is inert in production and
the fallback sentence is false. And a partial-but-committed eval stays queued, so an unattended overnight drain pays for
the same skill again every night with nothing to stop it. Fix those two first and make sure each has a test that would
fail without the fix.

One correction to your earlier report: the repository already reconstructs a whole-run total from the same per-arm
receipt averages, in `desktop/src/backend/tauri/eval-report.ts`. Your open question about the receipt schema is
answered there — use that conversion rather than the billing fallback.

Keep every spec decision and amendment A1-A3 and the cross-batch brief. Re-run the gates as instructed (root: lint,
typecheck, vitest --maxWorkers=3, build; desktop: typecheck, lint, vitest, build; no Playwright) and give a fresh final
report in the required schema.

The suggested fix on each finding is the reviewer's, not a spec: implement the *correct* fix. If you believe a finding
is wrong, say so in `deviations` with the evidence rather than silently leaving it.

## 43 confirmed findings

### 1. [blocker] The measured estimate can never fire: its receipt shape is one buildReceipt rejects

**Where:** `src/lib/evals/estimate.ts:6`

**What is wrong:** `const measured = z.object({ efficiency: z.object({ cost_usd, duration_ms }) })` demands a FLAT efficiency object. Every receipt this CLI writes has `efficiency: z.record(z.string(), efficiencySchema)` — a per-arm map (receipt.ts:74, filled at eval.ts:297 from results.ts:70-79 which builds `efficiency[arm] = {turns,duration_ms,cost_usd}`). safeParse on `{efficiency:{candidate:{...},baseline:{...}}}` fails (cost_usd/duration_ms missing at the top level), so `costs.length` stays 0 and estimateFromReceipts returns null for every real clone. setup.ts:367-368 therefore always prints the fallback `Evaluating {n} skills, 4 at a time: no earlier runs to estimate from…`, which is a false statement for any team with receipts. D1 and A1-P5 — the headline deliverable — are inert in production. The 'conservative' framing in the agent's deviation is contradicted inside this repo: desktop/src/backend/tauri/eval-report.ts already reconstructs a whole-run total from the same per-arm averages (perArm = provenance.cases.length * provenance.k; cost = Σ_arm cost_usd × perArm), so the Evals tab shows a measured estimate from the very receipts the wizard says do not exist.

**Suggested fix:** Parse with `receiptSchema` and reconstruct the run total as eval-report.ts already does: perArm = provenance.cases.length * provenance.k; cost = Σ_arm cost_usd × perArm; duration from Σ_arm duration_ms × perArm; skip receipts with a null arm value, keep the ≥3-run threshold and the existing wording. If the conversion is genuinely refused, the fallback sentence must stop asserting there are no earlier runs.

**Evidence the verifier read:** estimate.ts:6 flat schema vs receipt.ts:41-46,74 `efficiency: z.record(z.string(), efficiencySchema)`; results.ts:70-79 writes the per-arm map; eval.ts:297 passes summary.efficiency straight into buildReceipt. The batch's own test setup.test.ts:1028-1032 feeds the real shape and asserts null. Merged duplicates: the three separate reports of this same defect (spec-base, spec-a1, spec-a3 lenses).

---

### 2. [blocker] A partial-but-committed eval stays queued and is re-billed every night, forever

**Where:** `src/commands/eval.ts:577`

**What is wrong:** runQueue computes `const error = !outcome.ok ? outcome.error : outcome.value.executionStatus !== 'complete' ? `Evaluation ${...}; the item remains queued.` : outcome.value.commit?.ok !== true ? … : undefined;` and keeps the item whenever `error !== undefined`. But eval.ts:311-326 builds and commits the receipt regardless of execution_status, returning success with `commit:{ok:true}` and `executionStatus:'partial'`. `partial` is the ordinary outcome whenever `scored < expectedRows` (results.ts:83) — e.g. a case skipped for a missing host tool (environment_skips) or an arm that failed twice. Sequence: user picks Overnight for 5 skills, one has a case this machine cannot run; the drain pays for it, commits the receipt, and re-queues it with lastError; useOvernightWindow's `fired` key is per calendar night (overnightWindow.ts:26,47-49,58-60), so the drainer fires again the next night and pays again, indefinitely, unattended. Nothing caps attempts. The queue's notion of 'done' also contradicts skillsWithoutReceipt (eval.ts:515), which now sees a receipt and would never re-offer the skill.

**Suggested fix:** Treat a committed receipt as done: `const error = !outcome.ok ? outcome.error : outcome.value.commit?.ok !== true ? 'No receipt was committed; the item remains queued.' : undefined;` and surface the partial status in the printed line instead. Optionally have the unattended nightly drain skip items that already carry lastError.

**Evidence the verifier read:** eval.ts:577 (the ternary), eval.ts:311-326 (commit happens before executionStatus is inspected), results.ts:83 (`scored < expectedRows ? 'partial'`), overnightWindow.ts:26/47-49/58-60 (per-night fired key, reschedules to the next night).

---

### 3. [blocker] The D1 measured estimate can never fire on a real receipt; every test for it fabricates a receipt shape the product never writes

**Where:** `src/lib/evals/estimate.ts:6`

**What is wrong:** `measured` requires `efficiency.cost_usd` / `efficiency.duration_ms` at the top of `efficiency`. Real receipts never have that shape: src/lib/evals/receipt.ts:74 declares `efficiency: z.record(z.string(), efficiencySchema)` and src/lib/evals/results.ts:70-79 writes it keyed by arm. A zod object with two required number fields cannot parse `{candidate:{...},baseline:{...}}`, so `safeParse` fails, `continue` fires for every committed receipt, `costs.length` stays 0 and `estimateFromReceipts` returns null 100% of the time. setup.ts:367 therefore always prints the "no earlier runs to estimate from" variant — the measured half of D1 is unreachable in production. The three passing estimate tests write `JSON.stringify({efficiency:{cost_usd,duration_ms}})` by hand (setup.test.ts:1020-1022, 1040-1043, 1048-1050) instead of going through `receiptSchema`/`pendingReceipt`, and the one test on the real shape (setup.test.ts:1028) asserts that null is correct. The report declares the schema mismatch as a deviation but not the consequence.

**Suggested fix:** Sum `cost_usd` and `duration_ms` across each receipt's arms to get the whole-run total (that is measured data, not an invention), take the median of those per-run sums, and skip receipts with any null arm value; then build at least one estimate fixture through `receiptSchema.parse(...)`/`pendingReceipt` so a schema change breaks the test instead of silently disabling the feature.

**Evidence the verifier read:** estimate.ts:6 `z.object({efficiency:z.object({cost_usd:…,duration_ms:…})})` vs receipt.ts:74 `efficiency: z.record(z.string(), efficiencySchema)` and results.ts:75 `efficiency[arm] = { turns, duration_ms, cost_usd }`; grep for `efficiency` shows eval.ts:297 is the only writer and it writes `summary.efficiency` (the per-arm record). setup.test.ts:1028 ('does not invent totals from legacy per-arm averages') asserts `estimateFromReceipts(...)` is null for the real shape.

---

### 4. [should-fix] In "In batches" the summary line, the progress frames and the green/red colouring are per batch, not per run

**Where:** `src/lib/evals/batch.ts:25,49,55 with src/commands/setup.ts:398-406`

**What is wrong:** setup.ts:398 loops `for (let offset = 0; offset < candidates.length; offset += width)` calling runEvalBatch once per slice and discarding its return value; runEvalBatch computes everything from `items.length` with a fresh `done = 0`. With 5 candidates and an answer of 2 the person sees `Evaluating 2 skills, 2 at a time…` / `Evaluated 2 of 2; 0 failed.` three times and never sees 5 — moments after the estimate line promised `Evaluating 5 skills, 4 at a time`. The progress frames carry `total: items.length` (the batch width) and `current` restarts at 1, so SetupBoot's evals row (SetupBoot.tsx:27) counts '1 of 2', '2 of 2', '1 of 2'… instead of climbing to 5. A1 P5 specifies one run-wide `Evaluated {ok} of {n}; {failed} failed.` and `progress {current: done, total: n}` with n the candidate count. It also breaks A3.1's colour rule: banner.ts:49-50 greens `Evaluated \d+ of \d+; 0 failed\.` and reds the failing form per line, so a clean later batch prints green after an earlier batch failed. `Now` is unaffected (width = candidates.length, one batch).

**Suggested fix:** Give runEvalBatch run-wide `offset`/`total` inputs used for the opening line and the progress frames, and move the `Evaluated {ok} of {n}; {failed} failed.` print out into setup.ts / runQueue after the loop, accumulating ok and failed across batches.

**Evidence the verifier read:** batch.ts:25 (`Evaluating ${items.length}…`), batch.ts:49 (`total: items.length`, `done` local), batch.ts:55, setup.ts:397-406 (width slice, return value discarded), SetupBoot.tsx:27, banner.ts:49-50. Merged three duplicate reports (spec-base, spec-a1, spec-a3).

---

### 5. [should-fix] The Welcome step prints a `> Welcome` header, which A3.1 explicitly forbids, and the snapshot locks it in

**Where:** `src/commands/setup.ts:162`

**What is wrong:** A3.1: "**Welcome has no header.** The Welcome step prints no `> ` header line; the mark and the bold welcome line are its header." setup.ts:161 prints MARK + `  Welcome to terum-skills, your team's skill library.`, then line 162 calls `section('welcome')`, so the first `say(line)` triggers `openSection()` (setup.ts:148) and emits `\n> \x1b[1mWelcome\x1b[0m`. The committed snapshot shows the result: mark, blank, `  Welcome to terum-skills, your team's skill library.`, blank, `> Welcome`, `  Welcome to terum-skills.` — three welcomes where Codex opens with one, and the snapshot test ("…emits only headers for sections that print") now protects the wrong output.

**Suggested fix:** Delete `section('welcome');` at setup.ts:162, re-record the snapshot, and assert the decorated transcript contains no `> Welcome` line.

**Evidence the verifier read:** setup.ts:161-163 and the helper at setup.ts:147-148; src/commands/__tests__/__snapshots__/setup.test.ts.snap lines 28-31 show the `[1mWelcome[0m` header immediately after the welcome line.

---

### 6. [should-fix] The mock evals ask frame pre-selects 'Overnight'; the real CLI pre-selects 'Skip'

**Where:** `desktop/src/backend/mock/onboarding.ts:14`

**What is wrong:** setup.ts:369 calls `io.select(evalsQuestion(n), ['Now','In batches','Overnight','Skip'], 'Skip', …)`, so the real ask frame carries `default: 'Skip'` and PromptDialog (`useState(question.default??'')`, providers.tsx:39) opens with the Skip radio checked. replaySetupEvals sends `default: 'Overnight'`, so against the mock the dialog opens with Overnight checked and Continue already enabled. The new route spec asserts `dialog.getByRole('radio',{name:'Overnight'})).toBeChecked()`, making the divergence a gate and locking a mock-only default into any board recorded from the mock — against the standing rule that mock and real must be interaction-identical.

**Suggested fix:** Set `default: 'Skip'` in replaySetupEvals and have the replay/e2e driver `.check()` the Overnight radio before Continue; update setup-evals.spec.ts to assert Skip is checked on open.

**Evidence the verifier read:** desktop/src/backend/mock/onboarding.ts line 14 of the new block (`default: 'Overnight'`), setup.ts:369 (`'Skip'`), providers.tsx PromptDialog `useState(question.default??'')`, desktop/e2e/routes/setup-evals.spec.ts:10.

---

### 7. [should-fix] The `{done} of {total}` count fires on every progress row, showing a meaningless "N of N" during discovery

**Where:** `desktop/src/screens/onboarding/SetupBoot.tsx:27`

**What is wrong:** A3.2 scopes the count to the evals row. The implementation is `progress?.label===key?`${progress.done} of ${progress.total}`:…`, which matches any row whose key equals the progress label. The discover step emits `io.progress?.({ step: 'discover', current: progress.scanned })` with no total (setup.ts:320), and desktop/src/backend/tauri/run.ts:123 coerces that to `total: Math.max(frame.total ?? current, current, 1)` = current. So while scanning, the 'Looking for skill folders on this machine' row flickers '412 of 412', '413 of 413', … where before this batch (diff shows the old expression had no progress branch) it was blank.

**Suggested fix:** Gate on the evals row — `key==='evals'&&progress?.label==='evals'?…` — or require `progress.total>progress.done` before rendering the count.

**Evidence the verifier read:** SetupBoot.tsx:27 (new branch, see the diff against origin/main), setup.ts:320 emits discover progress with `current` only, run.ts:123 coerces total to current.

---

### 8. [should-fix] A finished eval holds its pool slot while it waits on the question mutex, so one open prompt stalls the whole batch

**Where:** `src/lib/evals/batch.ts:46`

**What is wrong:** Each worker ends with `await exclusive(async () => { flush(); io.print(✓/✗); io.progress… })`. settleWithConcurrency's worker (concurrency.ts:29-35) only picks up the next item after `fn` resolves, so a worker blocked in `exclusive` is not free. While eval A holds the mutex on an interactive question (the `commit:true` generated-assets confirm is the one such prompt), evals B/C/D that have already finished their paid runs park in `exclusive` and occupy all remaining slots. Concrete: `Now` with 8 candidates at parallel 4 — item 1 asks, items 2-4 finish, and items 5-8 do not start until the person answers, with nothing in flight. Contradicts A1 P1 ("keep `limit` workers busy until every item has settled") and is untested: batch.test.ts:26 uses 3 items at parallel 3, so nothing is ever queued behind the pool.

**Suggested fix:** Do not block the worker on the flush: `const flushed = exclusive(async () => {…}); pending.push(flushed); return outcome;`, then `await Promise.all(pending)` after settleWithConcurrency resolves so the final `Evaluated …` line still comes last.

**Evidence the verifier read:** batch.ts:46-51, concurrency.ts:29-35 (worker awaits fn before taking the next index), batch.ts:33 `ask` chains on the same `tail`, src/lib/evals/__tests__/batch.test.ts:26 (3 items / parallel 3).

---

### 9. [should-fix] Only the first line of a failed eval's error survives; the rest is dropped

**Where:** `src/lib/evals/batch.ts:48`

**What is wrong:** `io.print(outcome.ok ? `✓ ${item.name}` : `✗ ${item.name}: ${outcome.error.split(/\r?\n/)[0]}`)` is the only place a failed eval's error reaches the person in the wizard's Now/In batches paths — setup.ts:403 discards runEvalBatch's return value entirely. On origin/main the sequential loop printed the whole error (`io.print(outcome.error)` at old setup.ts:352). The errors that matter most are multi-line by construction: RemoteAccessError's message is `${message}\n${explanation}` (teamRepo.ts:79). So an expired gh credential prints `✗ deploy-check: The remote refused the push:` and swallows the instructions that say how to fix it; the error is never buffered either, so nothing recovers it.

**Suggested fix:** Before the settle print, push the remaining lines into that eval's own block: on `!outcome.ok`, `for (const line of outcome.error.split(/\r?\n/).slice(1)) buffer.push(line)` prior to `flush()`, keeping the `✗ {name}: {first line}` summary A1 P3 specifies.

**Evidence the verifier read:** batch.ts:48; setup.ts:403-405 (no capture of the result); `git show origin/main:src/commands/setup.ts` line 352 `else { failed += 1; io.print(outcome.error); }`; teamRepo.ts:77-80 RemoteAccessError super(`${message}\n${explanation}`).

---

### 10. [should-fix] An I/O error while reading receipts for the decorative estimate cancels the whole evals offer

**Where:** `src/commands/setup.ts:367`

**What is wrong:** `await estimateFromReceipts(clone)` sits inside the evals try block. estimate.ts rethrows every readdir error other than a top-level ENOENT (line 19) and does not guard `readFile` at all (line 23). Any unreadable entry under `<clone>/evals/**` — EACCES, EIO, or an EISDIR from a `.json` name that is not a regular file — propagates to the catch at setup.ts:413, which prints `Could not evaluate the shared skills: …` and sets `steps.evals = 'skipped'`. The person is never asked the question and no eval is offered, because a decorative cost line could not be computed.

**Suggested fix:** `const measured = await estimateFromReceipts(clone).catch(() => null);` at the call site, or skip unreadable files inside `walk` so the estimate degrades to the no-data line instead of removing the offer.

**Evidence the verifier read:** setup.ts:367 inside the try opened at setup.ts:348 with the catch at setup.ts:413-416; estimate.ts:18-19 (rethrows non-ENOENT), estimate.ts:23 (unguarded readFile).

---

### 11. [should-fix] The estimate tests assert a receipt shape that cannot exist, so no gate catches the dead path

**Where:** `src/commands/__tests__/setup.test.ts:1019`

**What is wrong:** The 'prints the measured medians' test (line 1017) writes `{ efficiency: { cost_usd, duration_ms } }` (also lines 1041 and 1048) — a shape receiptSchema/buildReceipt rejects and no producer in this repo writes. Worse, the companion test at line 1028 is named 'does not invent totals from legacy per-arm averages or null measurements' and feeds the real, current shape `{efficiency:{candidate:{cost_usd:1,duration_ms:2000}}}`, labelling receipt.ts rev 8 — the only schema this CLI has ever written — as legacy. The suite is green while the shipped estimate never produces a number.

**Suggested fix:** Build the estimate fixtures through `buildReceipt` (or reuse the fixture in src/lib/evals/__tests__/receipt.test.ts), assert a non-null estimate and the numeric line, and delete the flat-`efficiency` fixtures; keep one negative case for receipts whose arm measurements are null.

**Evidence the verifier read:** setup.test.ts:1019 (`samples` of flat `{cost_usd,duration_ms}`), 1041, 1048; setup.test.ts:1028-1032 (real per-arm shape asserted null); receipt.ts:74 is the only shape buildReceipt accepts.

---

### 12. [should-fix] The drain never checks whether the pinned version already has a receipt, so it pays twice for work already done

**Where:** `src/commands/eval.ts:560`

**What is wrong:** runQueue's `run` only guards that the queued version is still current (`expectedVersion`, eval.ts:103). It never asks the question skillsWithoutReceipt asks at eval.ts:515 — `newestReceiptAt(join(clone,'evals',<skillId>,<version>))`. Concrete: the user picks Overnight for 3 skills, then that afternoon runs `terum-skills eval deploy-check --commit` by hand (or a teammate's receipt for the same tree syncs in). At 01:00 the app runs deploy-check again at full agent cost and commits a second receipt at a fresh runId — no error, no signal. The same happens after a Stop that lands the receipt before `updateEvalQueue` (eval.ts:579) runs.

**Suggested fix:** In runQueue's `run`, after the refresh pins the clone, resolve the skill id and skip the item when `await newestReceiptAt(join(store.teamClone(item.team),'evals',id,item.version)) !== undefined`: remove it from the queue and report it as already evaluated.

**Evidence the verifier read:** eval.ts:560-580 (the whole run callback; the only guards are the dequeue race check and expectedVersion); eval.ts:515 shows the receipt check exists and is not used here; newestReceiptAt is imported at eval.ts:11 for that one call site only.

---

### 13. [should-fix] A3 says the Welcome step prints no `> ` header; the code prints one and the new test plus snapshot pin the violation

**Where:** `src/commands/setup.ts:162`

**What is wrong:** A3.1: "**Welcome has no header.** The Welcome step prints no `> ` header line; the mark and the bold welcome line are its header." setup.ts:162 calls `section('welcome')` immediately after the mark/welcome block, so the first subsequent print triggers `openSection()` and emits `\n> \x1b[1mWelcome\x1b[0m`. The new assertion at setup.test.ts:1137 was written to the implementation (`expect(titles).toEqual(['> Welcome','> Role',…])`) and the committed snapshot freezes it, so the fidelity pass will never surface the drift. Not listed in the report's deviations.

**Suggested fix:** Delete `section('welcome')` at setup.ts:162, drop `'> Welcome'` from the expected titles at setup.test.ts:1137, and re-record src/commands/__tests__/__snapshots__/setup.test.ts.snap.

**Evidence the verifier read:** setup.ts:162 `section('welcome');` with openSection at setup.ts:287 emitting `header(titles[pendingSection])`; snapshot line 27 `  Welcome to \x1b[1mterum-skills\x1b[0m…` immediately followed by line 29 `> \x1b[1mWelcome\x1b[0m`; setup.test.ts:1137 pins the list including '> Welcome'.

---

### 14. [should-fix] The mock's evals ask frame pre-selects Overnight while the real CLI pre-selects Skip, and the two new tests pin the mock's version

**Where:** `desktop/src/backend/mock/onboarding.ts:17`

**What is wrong:** `replaySetupEvals` sends `default: 'Overnight'`; src/commands/setup.ts:369 sends `'Skip'` as the default and src/lib/frames.ts puts it on the ask frame. `PromptDialog` seeds its radio from `question.default` (providers.tsx:39 `useState(question.default??'')`), so the real app opens the evals dialog with Skip checked and the mock opens with Overnight checked — a viewer who just presses Continue queues two paid evals in the mock and skips them for real. setup-evals-replay.test.tsx:18 and e2e/routes/setup-evals.spec.ts:10 both assert `radio {name:'Overnight'}` is checked, so the divergence is certified rather than caught, and boards redrawn from the mock will show the wrong pre-selection. A3.2 asks that the default replay *answers* Overnight, not that Overnight be the default choice. Undeclared in the report.

**Suggested fix:** Set `default: 'Skip'` in mock/onboarding.ts:17, have the replay click Overnight explicitly, and change the two assertions to expect Skip checked initially and Overnight after the click.

**Evidence the verifier read:** onboarding.ts:17 `choices:['Now','In batches','Overnight','Skip'], default:'Overnight'` vs setup.ts:369 `io.select(evalsQuestion(...), ['Now','In batches','Overnight','Skip'], 'Skip', {...})` and snapshot line 78 `Press enter to choose 4. Skip, or type a number.`; providers.tsx:39 `const [value,setValue]=useState(question.default??'')`. Merged duplicate of the same finding reported under the tests lens.

---

### 15. [should-fix] The new "{done} of {total}" right-column text fires for every step row, so a mid-scan discover row reads as finished with a fabricated denominator

**Where:** `desktop/src/screens/onboarding/SetupBoot.tsx:27`

**What is wrong:** A3.2 scopes the counter to the evals row. The implementation is `progress?.label===key?`${progress.done} of ${progress.total}`:…` over all six rows. Discover emits progress with no total (setup.ts:320 `io.progress?.({ step:'discover', current: progress.scanned })`) and desktop/src/backend/tauri/run.ts:121 fills the gap with `total: Math.max(frame.total ?? current, current, 1)`, i.e. total === current. So while discovery is still scanning, the 'Looking for skill folders on this machine' row — state `current` — reads "137 of 137": a running step rendered as complete against a denominator nobody supplied. setup-driver.test.tsx:181 hides it by mocking an explicit `ctx.progress(12,12,'discover')`. Undeclared deviation.

**Suggested fix:** Gate the counter on the evals row and on a real total: `progress?.label===key&&key==='evals'&&progress.total>progress.done?…`, leaving other rows on the existing outcome rule.

**Evidence the verifier read:** SetupBoot.tsx:27 (the ternary applies inside `rows.map`, rows list at SetupBoot.tsx:8-12 includes ['discover','Looking for skill folders on this machine']); setup.ts:320 emits current only; run.ts:121 `push({t:'progress',done:current,total:Math.max(frame.total ?? current,current,1),label:frame.step})`.

---

### 16. [should-fix] In the "In batches" path the progress counter, the opening line and the summary line all restart per batch instead of spanning the run

**Where:** `src/lib/evals/batch.ts:49`

**What is wrong:** setup.ts:401-404 loops `for (let offset=0; offset<candidates.length; offset+=width)` and calls `runEvalBatch` once per slice; `done` and `items.length` are local to each call. With 6 candidates at 2 at a time the frames carry (1,2),(2,2),(1,2),(2,2),(1,2),(2,2): SetupBoot's evals row shows "2 of 2" while only 2 of 6 are done, then jumps back to "1 of 2", and ProgressCard's placed/total track does the same — while the check-in confirm one line earlier correctly says "(4 of 6 done, 2 left)". batch.ts:25 and batch.ts:55 likewise print `Evaluating 2 skills, 2 at a time…` and `Evaluated 2 of 2; 0 failed.` three times for one six-skill run. A1 P5 specifies `total = n` and one pre-batch line. No test covers two batches of progress (the `batches continue=%s` case asserts only the confirm text; the `Now`/`In batches` concurrency case stops after the first batch).

**Suggested fix:** Give runEvalBatch an offset/total (`progressBase`, `progressTotal`, defaulting to 0 / items.length) and emit `current: base + ++done, total: progressTotal`; print the opening and closing summary lines once in setup.ts around the loop. Add a setup test with 4 candidates at 2 at a time asserting progress frames 1..4 of 4.

**Evidence the verifier read:** batch.ts:19 `let tail=Promise.resolve(), done=0;` and batch.ts:49 `io.progress?.({step:'evals',current:++done,total:items.length})`, both per call; setup.ts:401-406 calls runEvalBatch per slice with `items: candidates.slice(offset, offset+width)`; setup.ts:403 builds the confirm from the run-wide `offset`/`candidates.length`. Merged duplicate of the same finding reported under the tests lens.

---

### 17. [should-fix] The D5/A3.3 'frames transcript unchanged' test runs a wizard with zero eval candidates, and nothing asserts the CLI's evals ask frame carries detail/descriptions

**Where:** `src/commands/__tests__/setup.test.ts:1077`

**What is wrong:** The test builds `const args = await optionalSetup();` and `optionalSetup(count = 0)` (setup.test.ts:840-844) only calls `seedPending` when `count` is truthy, so `candidates.length === 0`, setup.ts:357 takes the empty-batch branch, and neither transcript contains the estimate line, the four-choice select, `detail`, `descriptions`, the queue line, the `── name ──` blocks or the `✓`/`✗` settle lines. `expect(frames.events).toEqual(plain.events)` therefore compares two runs carrying none of this batch's new output. Separately, grep for `descriptions` in setup.test.ts finds nothing: the branch at setup.ts:369 (`...(io.channel==='frames'?{detail:[estimate]}:{})` plus the four description strings) is asserted only against the hand-written desktop mock, so if the CLI stopped sending them every desktop test would still pass while the app's estimate line and option descriptions silently disappeared. Severity lowered from blocker: it is a coverage hole, not a shipped defect.

**Suggested fix:** Change the test to `optionalSetup(2)` and answer the evals select in both runs; add one frames-mode assertion on the evals ask frame (question byte-identical, `default:'Skip'`, choices in order, `detail:[estimateLine(2,null)]`, the four descriptions), in the style of the progress-frame test at setup.test.ts:1004.

**Evidence the verifier read:** setup.test.ts:1078 `const args = await optionalSetup();`; setup.test.ts:842 `if (count) await seedPending(...)`; setup.ts:357-366 empty-candidates branch; `grep -n 'descriptions' src/commands/__tests__/setup.test.ts` → no hits (the only `detail` hit, line 384, is unrelated). src/lib/__tests__/frames-descriptions.test.ts covers frameChannel generically, not the wizard's frame.

---

### 18. [nit] `Evaluated in batches` is printed to the terminal as a transcript line

**Where:** `src/commands/setup.ts:408`

**What is wrong:** Base spec §3 introduced 'Evaluated in batches' as the desktop step-row copy for the `batched` outcome, and A3.2 replaced that row copy with `Done`. It was never a CLI line. After the real summary (`Evaluated 2 of 2; 0 failed.`) a terminal user gets a bare, tense-less `Evaluated in batches`; banner.ts `body()` matches none of its outcome patterns (its regex requires `Evaluated \d+ of \d+`), so it also renders uncoloured among the coloured outcomes. `steps.evals === 'batched'` already carries the fact to the app.

**Suggested fix:** Drop `io.print('Evaluated in batches')` at setup.ts:408.

**Evidence the verifier read:** setup.ts:407-408; banner.ts:49-50 patterns; A3.2 'Setup result outcomes' maps batched to `Done`.

---

### 19. [nit] The estimate always claims 4 at a time, even when the user then chooses a different width

**Where:** `src/commands/setup.ts:367`

**What is wrong:** `estimateLine(candidates.length, await estimateFromReceipts(clone))` uses the default `parallel = EVAL_PARALLEL_DEFAULT` (estimate.ts:36) and the spec requires printing it before the question — correct so far. But after `In batches` and an answer of `1` the run takes ~n× the median instead of the printed `ceil(n/4)×`, and no corrected line is ever shown. Moot while finding 1 stands (the numeric branch never renders), visible the moment estimates work.

**Suggested fix:** After the `How many at a time?` answer, reprint `estimateLine(candidates.length, measured, batchSize)` when the chosen width differs from the default.

**Evidence the verifier read:** setup.ts:367 (no parallel argument), estimate.ts:36 (`parallel = EVAL_PARALLEL_DEFAULT`), setup.ts:386-391 where batchSize is chosen afterwards. Merged two duplicate reports.

---

### 20. [nit] The nightly drain also runs items the user explicitly queued as 'later'

**Where:** `desktop/src/backend/tauri/eval-queue.ts:10`

**What is wrong:** `drain: () => deps.run(['eval','--drain','--parallel','4'], …)` sends no `--window`, so runQueue's filter (eval.ts:561 `args.window === undefined || item.window === args.window`) keeps every item. EvalQueueDrainer.tsx:32 only *decides* to fire on an `overnight` item, then drains everything. 'later' items exist because the user answered No to `Continue with the next …?` and was told to run them by hand (setup.ts:379). Concrete: 6 candidates at width 2, the user stops after batch 1 → 4 items land as 'later'; that night an unrelated overnight item triggers the drain and all 5 are billed. HOWEVER the two reviewers' spec argument is wrong: base spec §3 specifies the app argv as `eval --drain --max 1` (no `--window`) and A1 P2 specifies `eval --drain --parallel 4` (no `--max 1`), so the code matches both specs literally; the agent declared it in openQuestions and documented it at docs/frame-protocol.md:163 ('This unfiltered drain includes later items too, as required by A1.'). This is an orchestrator product decision, not implementation drift — hence nit, not should-fix.

**Suggested fix:** If the product answer is 'no': `['eval','--drain','--window','overnight','--parallel','4']` and update desktop/src/backend/tauri/__tests__/eval-queue.test.ts and desktop/src/app/eval-queue-drainer.test.tsx.

**Evidence the verifier read:** desktop/src/backend/tauri/eval-queue.ts:10; eval.ts:561 filter; setup.ts:379; f-wizard.md §3 desktop bullet (`eval --drain --max 1`) and f-wizard-A1-parallel.md P2; docs/frame-protocol.md:163. Merged two duplicate reports; severity corrected down from should-fix.

---

### 21. [nit] `How many at a time?` retries without an attempt cap

**Where:** `src/commands/setup.ts:386`

**What is wrong:** `while (true) { const answer = (await io.text('How many at a time?', '4')).trim(); if (valid) break; io.print('Enter a whole number of at least 1.'); }`. Neither prompter caps `text`: frames.ts:166-169 returns whatever the client sends (an empty answer falls back to the default '4', which is valid and exits), and every other prompt loop in the codebase is bounded by MAX_SELECT_ATTEMPTS (prompt.ts:127, frames.ts:170). A client or script that keeps answering a non-empty non-numeric string never lets setup return, so no `result` frame is written and SetupBoot spins on 'Setup is running.'. Downgraded from should-fix: the loop only advances on a fresh answer, so this is a misbehaving-client/test hang rather than a production hang.

**Suggested fix:** Bound it like the others: `for (let attempt = 0; attempt < MAX_SELECT_ATTEMPTS; attempt++)`, then fall back to EVAL_PARALLEL_DEFAULT or throw (the surrounding catch already turns a throw into `Could not evaluate the shared skills: …`).

**Evidence the verifier read:** setup.ts:386-390; frames.ts:166-169 (text has no retry loop) vs frames.ts:170-178 and prompt.ts:127,142 (select is capped).

---

### 22. [nit] `In batches` makes the answered width the parallelism, unbounded, while the lock budget stays fixed at 300 s

**Where:** `src/commands/setup.ts:396`

**What is wrong:** `const parallel = choice === 'In batches' ? batchSize : EVAL_PARALLEL_DEFAULT` with batchSize accepted as any integer ≥ 1 (setup.ts:388 rejects only non-integers and 0), while every eval is started with the constant `lockWaitMs: EVAL_LOCK_WAIT_MS` (300_000, batch.ts:7). A1 P4 justifies that budget as covering `p - 1` receipt pushes ahead of one in the queue, so the rationale does not hold at a width the user picks. A user who types 30 can have ~29 safeWrite pushes queued ahead of the last one and those evals then fail with a lock timeout after their agent runs were already paid for. Correcting the reviewers: DEFAULT_DEADLINE_MS (30 s) bounds only the `git fetch` inside a refresh (teamRepo.ts:557), not the whole safeWrite, so their '~90 s at p=4' arithmetic is invented — hence nit, not should-fix.

**Suggested fix:** Either clamp the answered width (with the cap stated in the retry copy) or scale the budget: `lockWaitMs: Math.max(EVAL_LOCK_WAIT_MS, parallel * 30_000)`.

**Evidence the verifier read:** setup.ts:388,396,404; batch.ts:7 (`EVAL_LOCK_WAIT_MS = 300_000`); teamRepo.ts:84 DEFAULT_DEADLINE_MS and teamRepo.ts:557 (deadlineMs applied only when `args[0] === 'fetch'`).

---

### 23. [nit] An onSettled observer that throws rewrites a successful eval into a failure

**Where:** `src/lib/evals/batch.ts:44`

**What is wrong:** `try { input.onSettled?.(item, outcome); } catch (error) { outcome = fromError(error); }` replaces the real result: a successful eval whose observer throws is printed as `✗ {name}: {observer error}`, counted in `failed`, and returned in `outcomes[i]` as the observer's error, so the caller can no longer tell the receipt was committed — which in the drain path (where runQueue decides removal from `outcome`) would re-queue and re-bill a completed eval. Both call sites (setup.ts:403, eval.ts:565) pass no onSettled, so there is no failing input today; the hazard is latent, hence nit rather than should-fix.

**Suggested fix:** `try { input.onSettled?.(item, outcome); } catch { /* an observer must not change the eval's outcome */ }`, or let the observer error propagate to the caller.

**Evidence the verifier read:** batch.ts:44-45 reassigns `outcome`, which is then used at batch.ts:48 and returned at 51; setup.ts:403-405 and eval.ts:565-568 pass no onSettled.

---

### 24. [nit] `eval --drain` on an empty queue prints "Evaluating 0 skills, 4 at a time…"

**Where:** `src/lib/evals/batch.ts:25`

**What is wrong:** runQueue always calls runEvalBatch, with no early return when `pending` is empty (eval.ts:562-571), and runEvalBatch prints its opening line unconditionally. A user who runs `terum-skills eval --drain` with nothing queued sees `Evaluating 0 skills, 4 at a time…` then `Evaluated 0 of 0; 0 failed.` and exits 0, while `--queue-list` says `No queued evals.` for the same state (eval.ts:556). It is the first thing a user does after the wizard prints 'Run them now with `eval --drain`'.

**Suggested fix:** In runQueue, when `pending.length === 0`, print `No queued evals.` and return `success({ items: [], attempted: 0, completed: 0, failures: [] })` before calling runEvalBatch.

**Evidence the verifier read:** eval.ts:562 (`pending` filter) and 567 (runEvalBatch called unconditionally); batch.ts:25 unconditional print; eval.ts:556 the contrasting `No queued evals.`

---

### 25. [nit] A second concurrent drain surfaces proper-lockfile's raw message to the user

**Where:** `src/lib/evals/queue.ts:34`

**What is wrong:** `retries: kind === 'drain' ? 0 : {…}` means a drain that collides with another drain rejects immediately with proper-lockfile's own ELOCKED text, and runQueue's outer catch (eval.ts:588) turns it into the Result error verbatim. A user who happens to be running `eval --drain` in a terminal at 01:00 sees 'Lock file is already being held' in the app. Correcting the reviewer's mechanism: EvalQueueDrainer's `role="alert"` is fed only by useOvernightWindow's onError, and `startQueued` returns a failed Result rather than throwing (EvalRunProvider.tsx:36-39 → track), so the raw text lands in the eval run dialog's `result.error`, not in the drainer's alert. The refusal itself is correct and covered by eval-queue.test.ts.

**Suggested fix:** Catch ELOCKED around the drain lock and return `failure('Another terum-skills drain is already running; wait for it to finish or stop it.')`.

**Evidence the verifier read:** queue.ts:32-36 (`retries: 0` for drain), eval.ts:588 (`catch (error) { return fromError(error); }`), EvalRunProvider.tsx:36-39 and track() at :16-29 (failed Result stored in state, not thrown), EvalQueueDrainer.tsx:24,34 (await without `.ok` check).

---

### 26. [nit] New runtime import cycle between prompt.ts and banner.ts

**Where:** `src/lib/prompt.ts:1`

**What is wrong:** prompt.ts:1 imports `{ colorCapable, style }` from banner.js, and banner.ts:2 imports `{ terminalOutputIsTTY }` from prompt.js as a value. It resolves today only because all three are hoisted `export function` declarations and no module-level initializer calls across the cycle (banner.ts's only top-level value is the MARK template literal). Converting any of them to a `const` arrow, or adding a module-level call in either file, breaks module init with a TDZ error depending on entry order. Typecheck, build and tests pass, so this is a fragility note, not a defect.

**Suggested fix:** Move `terminalOutputIsTTY` (or the `colorCapable`/`style` pair) into a leaf module, e.g. src/lib/tty.ts, imported by both.

**Evidence the verifier read:** src/lib/prompt.ts:1 `import { colorCapable, style } from './banner.js';` and src/lib/banner.ts:2 `import { terminalOutputIsTTY } from './prompt.js';`; prompt.ts:6 and banner.ts:29,35,39 are all function declarations.

---

### 27. [nit] The protocol doc advertises the dead estimate path and calls the current receipt shape "legacy"

**Where:** `docs/frame-protocol.md:155`

**What is wrong:** "The cost line precedes that question and uses only explicit measured run totals in the current team clone; legacy per-arm averages cannot be substituted for totals" documents a capability that never fires (finding 1) and misnames receipt.ts rev 8 — the only receipt shape this CLI has ever written — as legacy. A maintainer reading this will believe the wizard prints measured numbers whenever receipts exist. (Reported at line 160; the sentence is at 154-155.)

**Suggested fix:** After fixing the estimate, state what is actually computed (per-run totals reconstructed as Σ_arm × cases × k); if the fallback stands, say plainly that no receipt records a whole-run total today.

**Evidence the verifier read:** docs/frame-protocol.md:154-156; receipt.ts:74 is the only efficiency shape in the repo; estimate.ts:13 carries the same wording in a code comment.

---

### 28. [nit] Un-specified hint string when a select has no default, plus an off-by-one if a default is not among the choices

**Where:** `src/lib/prompt.ts:132`

**What is wrong:** A3.1 prescribes one hint: `  Press enter to choose {n}. {default}, or type a number.` For a select with no default — the Role question (setup.ts:236) and the connect picker (connect.ts:139) both pass `undefined` — the implementation invents `  Type a number to choose.`, which is now frozen in the committed snapshot (line 41) and is not among A3.1's enumerated furniture. Separately `choices.indexOf(defaultChoice)+1` renders `Press enter to choose 0. X` for a default absent from `choices` (no caller does that today).

**Suggested fix:** Either omit the hint when `defaultChoice === undefined` or record the extra string as a deliberate addition in the amendment doc; guard the index with `const i = choices.indexOf(defaultChoice); if (i < 0) …`.

**Evidence the verifier read:** prompt.ts:132 `const hint = defaultChoice === undefined ? '  Type a number to choose.' : `Press enter to choose ${choices.indexOf(defaultChoice)+1}…``; snapshot line 41 `\x1b[2m  Type a number to choose.\x1b[0m`.

---

### 29. [nit] Connect descriptions are positionally derived from `candidates` while the choices come from a de-duplicating Map, and a mismatch now throws even in plain mode

**Where:** `src/commands/connect.ts:139`

**What is wrong:** `choices = new Map(candidates.map(c => [label, c.path]))` and the select is given `[...choices.keys(), exit]`, but `descriptions` is `[...candidates.map(...), skipCopy]`. The two arrays are parallel only while every candidate yields a unique label. Labels go through `printable()` (skill-source.ts:13, which maps every control character to `?`), so two candidates whose names or paths differ only in control characters render identically, the Map collapses one, and prompt.ts:124 throws `Select descriptions must match choices.` — a check that runs before the `decorated` branch, so a decoration-only feature can kill a NO_COLOR/piped connect step. desktop/src/backend/tauri/frames.ts:46 takes the safer route for the same data (drop the descriptions, emit a diagnostic). Latent rather than live: localSkillRoots dedups roots by canonical repo root and canonical skills dir (local-skills.ts:56-73) and the qualifier appends the path when name+root label collide, so I could not construct an ordinary reachable collision.

**Suggested fix:** Build both arrays from one source (`[...choices.entries()]`, storing `{path,name}` as the value), and make terminalPrompter drop mismatched descriptions with a warning rather than throw, matching the frames parser.

**Evidence the verifier read:** connect.ts:139 (descriptions from `candidates`, choices from `[...choices.keys(), exit]` built at connect.ts:137); prompt.ts:124 `if (options?.descriptions && options.descriptions.length !== choices.length) throw new Error('Select descriptions must match choices.')` above the `decorated` computation at prompt.ts:125; frames.ts:46-47 drops instead of throwing. Merged: three reviewers reported this (spec-a3, desktop, tests lenses).

---

### 30. [nit] Dead classifier clause `line==='Queued for overnight'`, with a test case that proves nothing

**Where:** `desktop/src/backend/setup-session.ts:19`

**What is wrong:** The equality sits after `line.startsWith('Queued ')` in the same `||` chain, and `'Queued for overnight'.startsWith('Queued ')` is true, so the clause is unreachable. No code path prints that bare line either: it is the base spec's desktop step-row copy (superseded by A3.2, where SetupBoot.tsx:27 renders `'Queued'`), and the CLI prints `Queued {n} evals for overnight: …` (setup.ts:378). setup-steps.test.ts:45 asserts on the dead literal, so it reads as coverage for a line shape that can never occur.

**Suggested fix:** Drop the equality clause and the corresponding it.each entry; the `Queued ` prefix already covers both real lines.

**Evidence the verifier read:** setup-session.ts:19 `…||line.startsWith('Queued ')||line==='Queued for overnight'||…`; setup.ts:378 prints `Queued ${n} evals for overnight: …`; setup-steps.test.ts:45 it.each includes 'Queued for overnight'. Merged duplicate (reported under both spec-a3 and desktop lenses).

---

### 31. [nit] Two of the three new classification cases assert line shapes nothing prints, and one quotes copy the CLI no longer uses

**Where:** `desktop/src/backend/__tests__/setup-steps.test.ts:45`

**What is wrong:** `'Queued for overnight'` is the base spec's step-row copy, never a CLI line. `'Queued 3 evals for overnight: the app runs them one at a time between 01:00 and 05:00 …'` says "one at a time" while setup.ts:378 prints "in parallel" — the case passes only because `printedSetupStep` matches on the `Queued ` prefix, so it documents copy that does not exist and would not notice a real reword. `'Evaluated in batches'` is printed (setup.ts:408) but nothing in setup.test.ts asserts it, and the spec defines it as a row label rather than a transcript line.

**Suggested fix:** Replace the two fictional strings with the lines the wizard actually emits (use the real "in parallel" wording), and either drop `io.print('Evaluated in batches')` from setup.ts:408 or assert it in setup.test.ts so the string has one owner.

**Evidence the verifier read:** setup-steps.test.ts:45 it.each list; setup.ts:378 `…the app runs them in parallel between 01:00 and 05:00…`; setup.ts:408 `io.print('Evaluated in batches')`; no hit for 'Evaluated in batches' in src/commands/__tests__/.

---

### 32. [nit] `io.print('Evaluated in batches')` emits a transcript line no spec asks for

**Where:** `src/commands/setup.ts:408`

**What is wrong:** The base spec lists `Evaluated in batches` as the desktop step-row copy for the `batched` outcome, and A3.2 then overrides that row copy to `Done`. Nothing asks for it to be printed. It lands in the app's Setup output list and, decorated, as the bare fragment `  Evaluated in batches` right after the real `Evaluated X of N; Y failed.` summary. Harmless (setup-session.ts classifies it into `evals` via the `Evaluated ` prefix and it clears the progress row), but an undeclared addition to the transcript.

**Suggested fix:** Delete the line; `steps.evals = 'batched'` already carries the outcome to SetupBoot.

**Evidence the verifier read:** setup.ts:407-408 `steps.evals = choice === 'In batches' ? 'batched' : 'done'; if (steps.evals === 'batched') io.print('Evaluated in batches');`; SetupBoot.tsx:27 renders `Done` for a `batched` outcome (only `queued` gets its own word).

---

### 33. [nit] `ok`/`bad` are applied by prefix regex to every printed line instead of to the enumerated call sites

**Where:** `src/lib/banner.ts:43`

**What is wrong:** A3.1 says "Apply `ok` to exactly these existing lines" and lists them. `body()` instead pattern-matches every decorated line against `/^(Created team |Joined |Invited |Connected |Registered |Installed the session hook |Queued .* evals )/` and friends. No false positive exists in today's wizard, but any future line beginning `Connected `/`Registered `/`Joined ` silently acquires a green ✓, and the coupling is invisible from the call sites.

**Suggested fix:** Optional: wrap the enumerated call sites in `ok(...)`/`bad(...)` at the point of print (keeping `body()` for indentation and the already-glyphed ✓/✗ settle lines) so the coloured set is greppable.

**Evidence the verifier read:** banner.ts:49-50 — the whole ok/bad decision is two regexes over the line text inside `body()`, which setup.ts:289 applies to every `io.print` in decorated mode.

---

### 34. [nit] A3's ok()/bad() line list is untested: 4 of ~12 enumerated shapes are asserted, so a regex typo silently drops the colour

**Where:** `src/lib/__tests__/banner.test.ts:29`

**What is wrong:** banner.test.ts:29 asserts only `body('✓ alpha')`, `body('  command')`, `body('  • item')` and `body('  • Could not look in /gone')`. Nothing covers `Created team `, `Joined `, `Invited `, `Connected `, `Registered `, the two `Installed …` lines, `Queued … evals `, `Skipping the evals: `, `Could not evaluate the shared skills: `, or the `0 failed` vs `N failed` split (`/^Evaluated \d+ of \d+; 0 failed\.$/` green vs `[1-9]\d*` red), which is the one branch with a real edge. Severity lowered from should-fix: the only consequence of a regex typo is missing colour in decorated terminal mode.

**Suggested fix:** Add one it.each in banner.test.ts listing every A3.1 line with its expected green/red/plain result, including `Evaluated 3 of 3; 0 failed.`, `Evaluated 0 of 3; 3 failed.` and a near-miss like `Evaluated 3 of 3; 0 failed` (no period) that must stay plain.

**Evidence the verifier read:** banner.test.ts:26-30 is the only test touching `body()`; the reviewer's cited range 36-41 is the sessionBox test — corrected to :29.

---

### 35. [nit] Radio descriptions are visual only — `aria-label` on the input suppresses them and nothing associates them with the option

**Where:** `desktop/src/app/providers.tsx:40`

**What is wrong:** Each option renders `<input type="radio" aria-label={choice} …/><span>{choice}<span className="prompt-option-description">{description}</span></span>`. `aria-label` overrides the wrapping label's text, so the accessible name is exactly the choice and the description never reaches assistive tech; there is no `aria-describedby` either. A screen-reader user hears "Now / In batches / Overnight / Skip" with no indication that Overnight queues the work to the 01:00-05:00 window. Severity lowered from should-fix: A3.2 only requires the description to render under the option in the muted tier, which it does, so no stated contract is broken.

**Suggested fix:** Give each description span an id and add `aria-describedby={descriptionId}` to its radio input, keeping `aria-label={choice}` so the existing `getByRole('radio',{name})` queries and the route spec still resolve.

**Evidence the verifier read:** providers.tsx:40 — `<input type="radio" name={question.question} aria-label={choice} …/><span>{choice}{question.descriptions?.[index]&&<span className="prompt-option-description">…</span>}</span>`, no aria-describedby anywhere in the file.

---

### 36. [nit] The connect picker's exit description says "Connect skills later" even when the exit choice is "Done"

**Where:** `desktop/src/backend/mock/index.ts:87`

**What is wrong:** `const end = batch.shared.length ? 'Done' : 'Skip'`, but the descriptions array always ends with ``'Connect skills later with `npx -y terum-skills@latest connect`.'``. After one skill is connected, the option reads "Done" with a description telling the user to connect skills later. src/commands/connect.ts:139 has the identical defect. A3.1 specifies that description only for `Skip`.

**Suggested fix:** Append the exit description only when the exit is `Skip`; pass an empty string for `Done`.

**Evidence the verifier read:** mock/index.ts:87 `choices:[...remaining,end],descriptions:[...remaining.map(...),'Connect skills later with `npx -y terum-skills@latest connect`.']` with `end` computed one line above; connect.ts:137 `const exit = batch.shared.length ? 'Done' : 'Skip';` and connect.ts:139's unconditional trailing description.

---

### 37. [nit] The new route spec skips `prepare()` and the console-error assertions every sibling route spec uses

**Where:** `desktop/e2e/routes/setup-evals.spec.ts:3`

**What is wrong:** routes.spec.ts, evals-empty-state.spec.ts and collapse.spec.ts all call `prepare(page, board)` from e2e/fidelity/determinism.ts (frozen Date, seeded Math.random, animations disabled, `html[data-app-ready="true"]` wait, font checks) and register console/pageerror/response/requestfailed listeners closed with `expect(errors).toEqual([])`. setup-evals.spec.ts does a bare `page.goto('/#/onboarding/boot?start=1')` with none of that, so it cannot catch a React error or a failed request in the onboarding path and it drives `.check()` at dialogs that may still be animating.

**Suggested fix:** Use `prepare(page,{name:'SetupEvals',route:'#/onboarding/boot?start=1',klass:'screen',width:1440,height:900})` and add the four listeners plus the closing `expect(errors).toEqual([])`.

**Evidence the verifier read:** setup-evals.spec.ts:1-3 imports only `@playwright/test` and goes straight to `page.goto`; evals-empty-state.spec.ts:2 imports `prepare` from '../fidelity/determinism' and lines 7-11 register the four listeners with `expect(errors).toEqual([])` at the end.

---

### 38. [nit] The "Now" replay asserts "2 of 2" inside a 150 ms window the mock itself closes

**Where:** `desktop/src/screens/onboarding/setup-evals-replay.test.tsx:26`

**What is wrong:** mock/onboarding.ts:31-32 prints `✗ release-notes…`, emits `progress(2,2,'evals')`, sleeps 150 ms, then prints `Evaluated 1 of 2; 1 failed.` — and setup-session.ts:106 nulls `progress` on any line matching `/^(Queued |Evaluated )/`. The test's `await waitFor(()=>expect(row.parentElement).toHaveTextContent('2 of 2'))` therefore races a 150 ms observation window against waitFor's 50 ms polling; on a loaded box it will flake.

**Suggested fix:** Lengthen the mock's post-settle sleep, or gate the final print behind a promise the test resolves after asserting '2 of 2' (the pattern setup-driver.test.tsx already uses with its `gate`).

**Evidence the verifier read:** onboarding.ts:31 `…ctx.progress(2,2,'evals');await ctx.sleep(150);` then :32 `ctx.print('Evaluated 1 of 2; 1 failed.')`; setup-session.ts:106 `...(/^(Queued |Evaluated )/.test(line) ? { progress: null } : {})`; setup-evals-replay.test.tsx:26 uses plain waitFor with real timers.

---

### 39. [nit] A1 P3 requires the capturing Prompter to copy `channel`; only `interactive` is asserted anywhere

**Where:** `src/lib/evals/batch.ts:34`

**What is wrong:** batch.ts:35 correctly spreads `...(io.channel === undefined ? {} : { channel: io.channel })`, but the only assertion is `expect(captured.interactive).toBe(true)` in batch.test.ts's question test, and setup.test.ts:935 loosened its eval-call check to `expect.objectContaining({ interactive: io.interactive, print: expect.any(Function) })`, which also omits `channel`. If the spread were dropped, evals run from the app would receive a prompter with no channel and any `io.channel === 'frames'` branch downstream would take the terminal path with no test failing.

**Suggested fix:** Give the outer prompter `channel:'frames'` in one batch.test.ts case and assert `captured.channel === 'frames'`; add `channel: io.channel` to the objectContaining at setup.test.ts:935.

**Evidence the verifier read:** batch.ts:35; batch.test.ts:25 `expect(captured.interactive).toBe(true)` is the only property assertion on the captured prompter; setup.test.ts:935 objectContaining lists only interactive and print.

---

### 40. [nit] The no-data estimate assertion is self-referential, and the line reads "Evaluating 1 skills" for a single candidate

**Where:** `src/lib/evals/estimate.ts:36`

**What is wrong:** setup.test.ts:1036 does `expect(io.events).toContain(`print:${estimateLine(1, null)}`)`, comparing the wizard's output against the same function that produced it, so it cannot catch a reword of the no-data variant (the decorated snapshot pins only the 2-skill measured-less form). That test is also the only place `count === 1` is exercised, and `estimateLine` has no singular handling, so a one-candidate run prints "Evaluating 1 skills, 4 at a time: …" one line above a question that correctly says "the 1 shared skill that has".

**Suggested fix:** Assert the literal no-data sentence in that test, and pluralise: `${count} ${count===1?'skill':'skills'}` in both branches of estimateLine, with a one-candidate case added.

**Evidence the verifier read:** estimate.ts:36-39 interpolates `${count} skills` in both branches; setup.ts:96 `evalsQuestion` does handle the singular; setup.test.ts:1036 `expect(io.events).toContain(`print:${estimateLine(1, null)}`)`.

---

### 41. [nit] Two of the drainer's pre-launch guards are untested, and `runEvalBatch`'s `onSettled` hook is dead code

**Where:** `desktop/src/app/EvalQueueDrainer.tsx:27`

**What is wrong:** `onFire` bails on `active.current || isBusy() || activeSetupSession(backend)` and re-checks disposed/enabled/interrupted/window/isBusy/activeSetupSession after the async `service.list()`. eval-queue-drainer.test.tsx covers preference-off, window, idle, Stop, list failure and 'during a run never starts another batch', but never `activeSetupSession` (a first-run wizard open at 01:30 must not have a paid batch start under it) and never the post-`list` races (disposed or interrupted set while `list()` is in flight). Separately `runEvalBatch`'s `onSettled` parameter has no caller anywhere in src/ or desktop/src, and its catch converts a *successful* eval into a failure if the callback throws.

**Suggested fix:** Add a drainer case that mounts with an active setup session and asserts `drain` is never called, and one that fires `pointermove` while `list()` is pending and asserts no batch starts. Either exercise `onSettled` in batch.test.ts or drop the parameter.

**Evidence the verifier read:** EvalQueueDrainer.tsx:27 and :33 hold the guards; eval-queue-drainer.test.tsx's seven its (lines 39-81) contain no `activeSetupSession` or in-flight-list case. `grep -rn onSettled src/ desktop/src` shows batch.ts:15/44 declaring it and no call site (the desktop hits are the unrelated `cliRun` option); batch.ts:44-45 `try { input.onSettled?.(...) } catch (error) { outcome = fromError(error); }`.

---

### 42. [nit] `createInterface({terminal: !decorated})` changes readline mode for every decorated prompt with no coverage at a real TTY

**Where:** `src/lib/prompt.ts:93`

**What is wrong:** Decoration now switches the interactive prompt out of readline's terminal mode (and appends a manual `output.write('\n')` after each answer). Every prompt test drives `PassThrough` streams, where the two modes are nearly indistinguishable, so nothing exercises the change where it matters — and A3 explicitly requires the wizard to work in Windows conhost and over ssh. The rationale is also unrecorded in the code.

**Suggested fix:** Note why `terminal: !decorated` is correct in a comment, and add a prompt test that a decorated prompt still resolves when the input stream delivers the answer in chunks.

**Evidence the verifier read:** prompt.ts:93 `const rl = createInterface({ input, output, terminal: !decorated });` (was `terminal: true`), prompt.ts:101 `if (decorated) output.write('\n');`; the new decorated-select test at prompt.test.ts:209 uses the same `channel()` PassThrough fixture as every other case. The connect-descriptions half of this reviewer's finding is merged into the connect.ts:139 entry above.

---

### 43. [nit] The only byte-literal pin of the singular evals question was replaced with the plural form, leaving the singular branch unpinned

**Where:** `desktop/src/backend/__tests__/mock.test.ts:171`

**What is wrong:** The assertion moved from the 1-skill sentence to the 2-skill one, and `grep -rn 'Evaluate the 1 shared skill'` over the repo now returns nothing. Every remaining root-side assertion uses `evalsQuestion(n)` (setup.test.ts, m3-setup-walkthrough.test.ts), i.e. it compares the function against itself; the decorated snapshot pins only the plural form. Severity lowered from should-fix: the singular text is produced by the same helper whose plural output IS pinned byte-for-byte in the snapshot, and setup-session.ts classifies on the `Evaluate the ` prefix, so a reword of the singular branch alone breaks no consumer — it just goes unnoticed.

**Suggested fix:** Keep the plural case for the 2-skill mock and add `expect(evalsQuestion(1)).toBe('Evaluate the 1 shared skill that has no receipt yet? This runs Claude on each one and commits each receipt to the team repo.')` in setup.test.ts.

**Evidence the verifier read:** mock.test.ts:171 diff replaces the 1-skill literal with the 2-skill literal; `grep -rn 'Evaluate the 1 shared skill'` over the worktree (excluding node_modules) returns nothing; setup.ts:95-97 is the only producer.

---
