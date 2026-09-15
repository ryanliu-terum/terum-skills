---
title: Eval-gen runtime contract decision walk
date: 2026-09-14
north_star: When a teammate sees an eval verdict on a shared skill, it should mean the tests actually ran — a generated test that can't execute should never quietly weaken, inflate, or fake that verdict.
status: complete
deferred:
  - what: an evidence floor or publish policy for partial verdicts — fewer than 3 scored cases still yields PASS/FAIL from the surviving rows (D5)
    gate: a receipt with fewer than 3 scored cases is published to shared-skills after D1–D4 ship; then hand Ajay option A (NEUTRAL below MIN_CASES, counted in cases) as the proposal
---

# Eval-Gen Runtime Contract — Decision Walk

**North Star:** When a teammate sees an eval verdict on a shared skill, it should mean the
tests actually ran — a generated test that can't execute should never quietly weaken,
inflate, or fake that verdict.

Ratified as proposed. The alternative frame — "evals should never fail unattended in the
app" — was offered and declined; several decisions below would flip under it.

## Origin

Surfaced 2026-09-14 by deleting the nine frozen 3-case sets under `~/.claude/skills/*/evals/cases`
and rerunning `terum-skills eval` (0.19.0) so they regenerated under spec rev 3's 3–7 bound.
The regenerated sets exposed that `casePrompt` (`src/lib/evals/generate.ts:141`) never states
the runtime contract `execution.ts` enforces, and `validateCases` (`:94-120`) checks shape only:

- **Prose in `setup`** — the model writes "Assume codex is logged in…"; `/bin/sh -ce` runs
  `Assume` → rc=127 → case aborted (`execution.ts:148,299-302`). 8 cases aborted across the run.
- **Absolute path in `files`** — `/tmp/scratch/…` trips the sandbox guard (`execution.ts:119`),
  which throws past the setup-only catch and fails the **whole** skill's eval (codex-spec).
- **Generation timeout** — single-fix's case-generation call exceeded the 120 s cap; larger
  requested sets mean longer model calls.

Run outcome (final, 7 of 9 evaluated): 7 receipts published to shared-skills, 3 of them partial
(codex-implement 2/6, harden 6/7, state 3/6); ultrareview PASS complete (6 cases); 2 skills produced
no receipt (codex-spec — unsafe path; single-fix — generation timeout). 8 cases aborted at setup. Latent since IE5 — the 0.1.5 prompt was
equally silent; the old sets happened to comply.

## Shipped

D1–D4 and D6 landed on `main` as PR #254 (merge `ab3bc1b`, 2026-09-15 05:53 UTC; branch
`fix/eval-gen-runtime-contract`, commit `f73b25d`). CI: actionlint, gates, mirrors, package all green;
local `npm test` 2283/2283. Not yet in a published npm release at time of writing — D7's regeneration
runs against the released CLI, so it waits for the next release to carry this commit.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Prompt states the `setup`/`files` contract | LOCK | Build preconditions for real; stub external tools; fall back to stating the assumption in the task; never drop the case | — |
| 2 | Path guard runs at generation time too | LOCK | Same predicate as the runner, shared so it can't drift; bad paths become a re-ask, not a dead eval | — |
| 3 | Dry-run every generated `setup` before saving | LOCK | Prose is valid shell, so only executing it proves it runs; heuristics tolerate silent failures | — |
| 4 | One dead case never kills the eval; the receipt records what was dropped and why | LOCK | Keep surviving evidence, but make "partial" testify — generalise `environment_skips` into a typed dropped-cases record | — |
| 5 | Evidence floor / publish policy for partial verdicts | DEFER | D1–D4 stop generated cases cancelling and label the rare residual; the app already greys partials. A floor would change Ajay's §7.1 for little marginal gain | a receipt with < 3 scored cases published after D1–D4 ship → hand Ajay option A |
| 6 | Generation timeout 120 s → 300 s; timeout is not a "correction" | LOCK | The cap was sized for exactly 3 cases; complex skills deserve the 3–7 the spec intends, and a timeout must not be retried as if the model could fix it | — |
| 7 | Cleanup of today's run | LOCK | Wait for D1–D4/D6, then delete and regenerate all nine once; delete codex-spec's poisoned case today; don't publish these nine until regenerated | — |

---

## Decision 1 — What the prompt tells the model about `setup`

**Verdict: LOCK**

### Plain English
- **What's at stake:** the model is handed a box labelled `setup: optional` and nothing else, so it guesses. Telling it "this is a script the computer runs — build the scenario, don't describe it" is the cheapest fix available and not itself contested.
- **Why it's a fork:** once told to *build* preconditions, the model hits scenarios it can't build with shell — "codex is logged in", "quota nearly exhausted", "a prior run already produced a report". The real question is what it should do with those.
- **Options:**
  - **A — Drop the case.** Every surviving case truly runs. *(decides: loses coverage of exactly the external-state branches that matter most for tool-wrapping skills)*
  - **B — Assumption in the task.** State the precondition as something the user tells the agent; leave `setup` empty. *(decides: coverage kept, but tests belief-and-act rather than check-and-act)*
  - **C — Stub the tool.** Ship a tiny fake binary in `files` (`bin/codex` answering `login status` as the scenario needs) — what the pre-regression sets already did. *(decides: most realistic; asks more of the generator, so more re-asks under D3)*
- **Recommendation:** C first, B as fallback, never A.
- **Zoom-out:** A serves "tests actually ran" but at the cost of the tests being about anything; B and C keep them meaningful *and* runnable. C fits the North Star best.
- **The call:** C → B fallback, as recommended. Prompt text: *build it for real; if the precondition is an external tool's state, stub the tool with a small script in `files`; if even that is impossible, put the assumption in the task and leave `setup` empty.*

### Technical
- **Files / code paths:** `wt-release-0190/src/lib/evals/generate.ts:141` (`casePrompt`) — ~3 sentences alongside `FIXTURE_RULE`. No validator change here; enforcement is D2/D3.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** minutes · nil beyond prompt drift (D3 backstops) · every future generating run; zero effect on skills already holding `evals/cases/`.
- **Grounding findings:** none needed — `scratchpad/evals-cases-backup-20260914/codex-implement/deep-run-quota-gate.yaml` is a working option-C example from the old generator (`chmod +x bin/codex && export PATH="$PWD/bin:$PATH" …`).

---

## Decision 2 — Check `files` paths before the case is saved

**Verdict: LOCK**

### Plain English
- **What's at stake:** the runner already refuses absolute paths, `..`, and anything under `.claude/`. Today it refuses at run time, where the throw escapes the setup-only catch and kills the whole skill's eval (codex-spec, this run). Refusing at generation time gives the model a corrected re-ask and never writes the bad case to disk.
- **Why it's a fork:** it isn't — not manufactured. One implementation choice: extract the predicate into a single shared function so the two checks can never drift apart again.
- **Recommendation / the call:** do it, with the shared predicate.
- **Zoom-out:** directly closes the hard-failure class; no tension with the North Star.

### Technical
- **Files / code paths:** lift `execution.ts:119-123` into an exported `assertSafeCasePath(rel, caseName)` (or similar) and call it from both `stage()` and `validateCases` (`generate.ts:94-120`) on every `files` key.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** minutes · nil · generation runs; feeds the existing two-retry re-ask in `askWithValidation`.
- **Grounding findings:** none — conceptual; both sites read this session.

---

## Decision 3 — How a non-executable `setup` is caught

**Verdict: LOCK**

### Plain English
- **What's at stake:** D1 tells the model the rules; D3 is the backstop for when it breaks them anyway. Without one, a bad `setup` is saved into the skill, published with the next version, and silently drops a test from every future eval.
- **Why it's a fork:** the obvious check fails. `Assume codex is logged in` is *valid* shell — a call to a program named `Assume`. A syntax check passes prose. Only running it answers "will this run?", and that costs time and an async validator.
- **Options:**
  - **A — Dry-run before saving.** Stage the case's files into a scratch dir, run its `setup` exactly as the eval would, discard. Failure text feeds the existing re-ask loop. *(decides: the only option that catches everything — prose, typos, missing tools, a stub that won't execute)*
  - **B — "Looks like a sentence" heuristic.** Capitalised first word, trailing full stop, no shell punctuation. *(decides: instant; catches today's exact symptom and nothing else)*
  - **C — B now, A later.** *(decides: obvious cases blocked immediately; the real guarantee deferred)*
- **Recommendation:** A. The heuristic is not a bridge but a false sense of coverage — once in, A gets deprioritised and a lowercase variant reopens this.
- **Zoom-out:** this decision *is* the North Star. Only A guarantees "a generated test that can't execute never quietly weakens the verdict"; B tolerates a class of silent failures; C defers the guarantee.
- **The call:** A.

### Technical
- **Files / code paths:** `generate.ts` — `validate` becomes `(raw) => Promise<Result<T>>` (`askWithValidation` is already async). New `dryRunCase()` reuses an exported `stage()` from `execution.ts` into an `mkdtemp` sandbox, spawns `/bin/sh -ce` with the same 60 s cap, returns the stderr tail as the error string.
- **Subtlety:** a D1 option-C stub under `files/bin/…` needs `chmod +x`; `stage()` only does that for `*.sh` (`execution.ts:127`). Extend to `bin/*` or have the prompt require an explicit `chmod +x` in `setup`.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~1–2 h with tests · low · generation runs only; ~1–5 s per case against a multi-minute eval.
- **Grounding findings:** none needed; both code paths read this session.

---

## Decision 4 — When one case can't run, what happens to the rest

**Verdict: LOCK**

### Plain English
- **What's at stake:** two inconsistent reactions today. A `setup` failure silently drops the case and the receipt says only "2/6 scored" with no reason recorded anywhere; a staging failure kills the whole skill's eval. After D2/D3 generated cases rarely hit either, but authored cases and host drift (tool present at generation, absent tonight) still can.
- **Why it's a fork:** the North Star cuts both ways — "tests actually ran" argues for failing loud; destroying six good cases over one typo is also destroying evidence, and makes unattended app runs brittle. Honest vs useful.
- **Options:**
  - **A — Drop the case, record why on the receipt.** Case name, kind (setup / staging / environment), error tail. Verdict still partial; README and `ls` show *what* was dropped, not just a fraction. *(decides: keeps surviving evidence and never hides the hole — the receipt testifies)*
  - **B — Fail the whole eval on any staging or setup error.** *(decides: one typo in one authored case costs the skill its receipt; an overnight run produces nothing — the "silently lost" failure today's publish walk was fixing)*
  - **C — Widen the catch, record nothing.** *(decides: stops the whole-eval death; receipt stays uninformative — strictly worse than A for the same effort)*
- **Recommendation:** A — generalise the existing `environment_skips` slot (Rev 8, "missing host tools") into a typed "didn't run" record.
- **Zoom-out:** A makes "partial" *mean* something. The North Star is about not faking verdicts, not about refusing to produce them; B is honest but hostile to the app's unattended mode.
- **The call:** A.

### Technical
- **Files / code paths:** `execution.ts:299-302` widen to staging errors (`unsafe file path`, `fixture dir not found`, `setup failed`) → return `{ rows: [], arms: [], dropped: { kind, message } }` alongside the `skipped` path at `:228`. `results.ts:62,112` + `receipt.ts:106` add `dropped_cases: Record<case, { kind: 'setup' | 'staging' | 'environment'; detail: string }>` (or fold `environment_skips` in and keep the old field populated). Renderers: `results.ts:190-191`, `readme.ts:325` (append count/kind to the partial tag), `ls.ts:211`, `evalReport.ts`.
- **Migration / schema:** additive; zod field `.optional()`, old receipts stay valid.
- **Effort / risk / blast radius:** ~2 h · low · every receipt consumer, all additive.
- **Grounding findings:** confirmed — setup aborts are logged (`ABORTED (setup)`) but written nowhere in the receipt; `environment_skips` is the only "didn't run" field and is specific to missing host tools.

---

## Decision 5 — What a partial verdict is allowed to claim

**Verdict: DEFER**

### Plain English
- **What's at stake:** codex-implement's published receipt says PASS from two comparisons (1W/0L/1T). The banding rule asks only "did the skill win by a third or more of the comparisons that happened?" — never "were there enough comparisons to mean anything?"
- **Why it's a fork:** not a bug — it is how §7.1 defines the verdict and §5.4 handles partials. Ajay wrote and revised that spec (rev 3, 2026-09-14). Changing what PASS means is a team-semantics call.
- **Options:**
  - **A — Evidence floor.** Fewer than N scored *cases* → NEUTRAL, "insufficient evidence". N=3 = the generator's minimum, so a complete run always clears it. *(decides: a thin PASS cannot exist; a strong skill that lost one of three cases to a missing host tool is demoted too)*
  - **B — Publish policy.** Verdict unchanged; a receipt partial *because cases were dropped* stays local until fixed and rerun. *(decides: team repo holds only verdicts built on the tests as authored; slower for the team to notice together)*
  - **C — Nothing beyond D4.** *(decides: zero spec change; headline word can still mislead at a glance)*
  - **DELEGATE** — hand Ajay the question with A as the written proposal.
- **Recommendation (initial):** DELEGATE with A. **Revised during the walk** after the user asked whether D1–D4 don't already stop tests cancelling: they do, for generated cases. The residual paths (authored case with bad setup; host drift; both arms crashed) are rare and D4 labels every one of them. Grounding the app showed it already refuses to promote a partial: chip greyed (`desktop/src/components/domain/verdict.ts:3`), fraction shown (`Primitives.tsx:30`), banner "the verdict is greyed until a complete run lands" (`SkillScreen.tsx`). D5's marginal gain — greyed `PASS` → `NEUTRAL` — is small for a spec change that is not ours alone.
- **Zoom-out:** the North Star is about not *faking* verdicts. After D1–D4 the residual partial is labelled, greyed, and explained; that is not faking. Building a floor now would solve a problem the batch mostly removes.
- **The call:** DEFER. Build nothing. Revisit trigger below.

### Technical
- **Files / code paths (if revisited):** `src/lib/evals/stats.ts:34-41` `verdictBand` — `n = w+l+t; PASS if 3·net ≥ n` (1W/0L/1T → PASS). Option A: `if (casesScored < MIN_CASES) return 'NEUTRAL'` — count *cases*, not rows, or a k=3 single-case run clears it. Option B: publish path in `commands/eval.ts` (~`:320` receipt build → `safeWrite`), gated on D4's `dropped_cases` kinds.
- **Spec touchpoints:** §7.1 (verdict per row / banding), §5.4 (partial handling) — Ajay's.
- **Migration / schema:** none now.
- **Grounding findings:** `check_decision` returned no standing ruling on verdict floors. App already greys partials and banners them; README (`readme.ts:325`) appends "— partial (n/m scored)". Old receipts are immutable — a floor would not rewrite the three thin PASSes already published (see D7).
- **Revisit trigger:** a receipt with fewer than 3 scored cases is published to shared-skills *after* D1–D4 ship. If it fires, hand Ajay option A as the proposal.

---

## Decision 6 — The generation timeout

**Verdict: LOCK**

### Plain English
- **What's at stake:** single-fix produced no receipt because the model did not finish *writing* its cases inside the 2-minute cap. That cap was sized for exactly 3 cases; spec rev 3 asks for up to 7 and D1 asks each to carry a tool stub. single-fix's SKILL.md is 34 KB, twice the others.
- **Why it's a fork:** give the model more time, or ask it for less.
- **Found on the way (not a fork, fixed either way):** a timeout is treated like a bad answer — retried twice with *"Your previous response could not be used: model call timed out"* appended as a correction. single-fix most likely burned 3 × 120 s to produce nothing.
- **Options:**
  - **A — More time.** Raise generation to 5 min (arm runs already get 10). On timeout retry once silently, then fail naming the skill size. *(decides: complex skills get the 3–7 cases the spec intends; a stuck call costs ≤10 min)*
  - **B — Ask for less on timeout.** Keep 2 min; retry requesting exactly 3 cases. *(decides: always finishes — but gives the most complex skills the fewest tests, backwards from why 3–7 exists)*
  - *Not an option:* shrinking what the model reads — a standing ruling has the generator see the full SKILL.md deliberately.
- **Recommendation:** A.
- **Zoom-out:** A produces the tests the spec asked for and fails honestly when it can't; B produces a verdict from fewer tests than the skill deserves and calls it complete.
- **The call:** A.

### Technical
- **Files / code paths:** `agent.ts:231-232` `askJson` defaults to `120_000`; `generate.ts` passes `{ model }` only. Add `GENERATION_TIMEOUT_MS = 300_000` beside `MIN_CASES`/`MAX_CASES` with a spec-rev-3 comment; pass `{ model, timeoutMs }`. `generate.ts:67-81` `askWithValidation`: distinguish `AgentRunError` from validation failure — on timeout retry **once** with no correction text, then `failure()` naming the SKILL.md byte size. D3's dry-run runs after the model call returns and does not consume this budget.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~30 min with a test · nil · generation runs only.
- **Grounding findings:** `DEFAULT_TIMEOUT_MS = 600_000` (`agent.ts:18`) for arm runs. SKILL.md sizes: single-fix 33,823 B; harden 17,331; hybrid-review 16,669. The run log shows one line for single-fix with no per-attempt output — consistent with three silent timeouts.

---

## Decision 7 — Cleaning up what today's run left behind

**Verdict: LOCK**

### Plain English
- **What's at stake:** three kinds of debris. (1) Three thin PASSes published to the team (codex-implement 2/6, harden 6/7, state 3/6) — permanent, but displaced by a later complete run of the same version. (2) Every regenerated set on the runner's machine contains broken cases, now part of skill content — a publish before they are fixed bakes them into a team version. (3) codex-spec and single-fix have no receipt for their current version, so `--pending` would offer them: codex-spec fails identically, single-fix regenerates with the still-buggy prompt.
- **Why it's a fork:** how fast the team's view gets clean vs paying for generation twice.
- **Options:**
  - **A — Wait for the fix, regenerate once.** Land D1–D4 + D6, delete all nine regenerated sets, rerun; complete receipts displace the partials in one pass. Today: delete codex-spec's poisoned case; don't publish new versions of these nine until regenerated. *(decides: one generation bill; greyed partials visible until the fix lands)*
  - **B — Restore the frozen 3-case sets and rerun now.** Complete receipts today for ~$3–5 / 30 min; back to 3 cases until the fix. *(decides: clean within the hour, paid twice)*
  - **C — Hand-edit the ~9 broken files and rerun.** *(decides: clean today with the larger sets; throwaway work the fix redoes, and "generated" headers on human-edited files)*
- **Recommendation:** A — the partials are labelled and greyed, so waiting is cosmetic; B and C pay twice to fix what the fix redoes.
- **Zoom-out:** nothing published is faked; everything partial is labelled. A keeps the North Star intact and spends once.
- **The call:** A. Backup of the 27 old case files: let go (generated, reproducible; decision-walk's remain committed in the team repo) — the user did not ask to preserve them.

### Technical
- **Files / code paths:** poisoned file `~/.claude/skills/codex-spec/evals/cases/verify-args-exclude-evidence-and-suggestion.yaml` — deleted today (copy kept in the session scratchpad). Regeneration route once the fix ships: `rm -rf ~/.claude/skills/<skill>/evals/cases` × 9 (codex-implement, codex-spec, decision-walk, harden, hybrid-review, single-fix, spec-readable, state, ultrareview), then `terum-skills eval <nine>`.
- **Supersession:** newest receipt by UTC run-id wins for a version (`eval.ts` `materializeIncumbent` / `latestReceiptedTree`); README (`readme.ts:325`) and the app read the newest.
- **Publish hazard:** `evals/` is inside `skillContentDigest` (D9); a publish before regeneration mints a version carrying the broken cases. Standing note until regeneration: do not publish these nine.
- **Grounding findings:** `--pending` = every shared skill with no receipt for its current version (`eval --help`); codex-spec and single-fix qualify.

---

## Tests (acceptance criteria for the LOCKed set — not a separate decision)

- `validateCases`: rejects a `files` key that is absolute, contains `..`, or seeds `.claude/` (D2); rejects a case whose `setup` exits nonzero in the dry-run sandbox — prose, a bad command, a stub that is not executable (D3); accepts the D1 option-C shape (stub under `files/bin/…` + `chmod +x` or auto-chmod).
- `runCase`: a staging throw yields `{ rows: [], arms: [], dropped: { kind: 'staging', … } }` and the eval continues (D4); `aggregate` carries `dropped_cases` onto the receipt and the report line renders it.
- `askWithValidation`: an `AgentRunError` timeout retries once with no correction text, then fails naming the SKILL.md size (D6); a validation failure still gets the two corrected re-asks.
- Existing exactly-3 / 3–7 bound tests keep passing — the bound is unchanged.
