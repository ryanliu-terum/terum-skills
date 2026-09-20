---
title: Eval head-to-head blockers decision walk
date: 2026-09-19
north_star: Two skills, one brief, some numbers, at the lowest build cost — a rough signal beats no signal; refine after a real run.
status: complete
deferred:
  - what: the six non-blocking findings from the same review are unwalked — §3.2's three-vs-five case-count contradiction, the undefined `--vs --no-gen` (zero cases reports as complete), the missing position swap in brief derivation, and the mechanical lows (verdict nullability, arm print order, the `why:` line, skipping materializeIncumbent, rival version pinning, citation paths)
    gate: before HH2 is handed to /codex-implement — a spec rev 2 that fixes D1–D4 but leaves §3.2 self-contradictory would be built literally
---

# Eval Head-to-Head Blockers — Decision Walk

**North Star:** Two skills, one brief, some numbers, at the lowest build cost — a rough
signal beats no signal; refine after a real run.

Ratified 2026-09-19 by Ryan, against two alternatives that were offered and declined:
"honest + actionable evidence (a run that ends in all ties has failed)" and
"compliance-first — D29 above all". Several decisions below would flip under either.

**Frame note, logged at ratification:** the cheapest-signal frame nominally demotes
findings 1 and 4 to HH5 follow-ups and gates the build on findings 2 and 3 only.
Finding 1 did not survive that sorting — see D1's zoom-out. What is being minimised is
cost *to a useful signal*, not cost to merge.

## Origin

Surfaced 2026-09-19 by a review of `.planning/specs/2026-09-09-eval-head-to-head.md`
(DRAFT rev 1, Ryan, 2026-09-09) read against the engine code it refactors:
`src/lib/evals/{execution,generate,results,stats,receipt}.ts`, `src/commands/eval.ts`,
`src/lib/prompt.ts`, and engine spec `2026-09-04-eval-engine.md` §5.1 / §7.1 / §7.3 / §7.5.

Four findings were load-bearing enough to block the build:

1. Brief-generated cases carry no `judge` rubric, so head-to-head comparisons collapse to
   `checks-equal-no-judge` ties (`execution.ts:325`).
2. Omitting the `verdict:` line also deletes the partial-run grey marker, which is a suffix
   on that exact line (`results.ts:130-133`) — contradicting §4's "greying behaves exactly
   as today."
3. The brief neutrality check is skipped for `--brief` supplied briefs, and `--brief` is
   mandatory non-interactively — so both the human signature and its deterministic backstop
   are absent on the automated path (§1.2, §3.1).
4. §5's r = 0.97 reproducibility claim belongs to the *without-skill* baseline arm, not the
   with-skill arms this mode prints; and §4's sample report drops the sign-test p that
   `summarize()` normally carries (`stats.ts:48`).

## Decision Ledger

| # | Decision | Importance | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|---|
| 1 | Judge rubrics for brief-generated cases | 7/10 | LOCK | A 75-run exit gate that returns 25 ties is the expensive outcome; ~10 lines of prompt buys out that risk | — |
| 2 | Where the partial-run warning lives | 6/10 | LOCK | Strip the verdict band and its greying bracket has nothing to annotate, so the denominator gets stated outright | — |
| 3 | Neutrality check on a supplied `--brief` | 6/10 | LOCK | The no-terminal path is how the app and md-format skills call this, so the one guarantee §1 advertises must hold there too | — |
| 4 | What each comparison row prints | 5/10 | LOCK | §4's own sample numbers are p=0.824 and p=0.115 — noise that reads as a win unless the sign test is printed | — |

---

## Decision 1 — Judge rubrics for brief-generated cases

**Verdict: LOCK (option A — generate rubrics now)** · **Importance: 7/10** — it decides
whether the first real head-to-head (the spec's Overall exit: ~75 agent runs plus a human's
review time) produces any discrimination at all. Cheap to reverse: a generation-prompt field
and one validator line, no stored data, no schema.

### Plain English

- **What's at stake:** When two skills are compared, something has to decide which did
  better. The engine has two deciders — mechanical checks ("did the file get created?") and
  an LLM judge. The judge only wakes when a case carries a written rubric, a couple of
  sentences saying what "better" means for that task. The case generator has never written
  one.
- **Why it bites here and not before:** Against the empty baseline, checks discriminate —
  the arm with no skill fails the skill-shaped checks. In a head-to-head both arms have a
  skill, both probably do the job, both pass the same checks, and the engine has nothing
  left to say. Every row comes back a tie.
- **Impact:** Add rubrics and head-to-head can distinguish two working skills — or it
  returns `judge-split` ties instead and the extra model calls bought nothing. Skip them and
  the first real run very likely reports 25 ties, costing a full run to learn. Either way it
  is undone in an afternoon; nothing is stored or migrated.
- **Why it's a fork:** Not a single `judge:` rubric exists anywhere in this project — only
  unit-test fixtures. The judge chain has never run against a live model here. Turning it on
  is not "switch on the working feature"; it is "run an unexercised path for the first time,
  inside the feature we are trying to ship cheaply."
- **Options:**
  - **A — generate a `judge` rubric per case, derived from the brief.** *(the difference
    that decides: it is the only mechanism that can separate two competent skills, but its
    real-world behaviour is unmeasured in this project)*
  - **B — ship check-only, put rubrics behind a tripwire from the first real run.** *(the
    difference that decides: the tie rate gets learned from real data rather than predicted,
    and that run was already scheduled as the exit gate)*
  - *(Rejected without a fork: "generate more or finer checks so the skills diverge."
    Checks are all-or-nothing per arm, so more checks make it* more *likely both arms fail
    at least one — producing* more *ties, not fewer.)*
- **Recommendation given:** B as a GATE — cheapest under the ratified frame, and the more
  honest read, since A is a guess about judge behaviour nobody here has observed.
- **Zoom-out (does this serve the North Star?):** The pick reads off-frame — cheapest-signal
  points at B. It reconciles if the quantity being minimised is cost *to a useful signal*
  rather than cost to merge: a 75-agent-run exit gate returning 25 ties is the expensive
  outcome, and ~10 lines of prompt buys out that risk. Recorded on that reading.
- **The call:** Ryan chose **A — rubrics now**, in HH3 alongside the rest of §3.

### Scores

| Option | Fit (0-4) | Bug risk (0-4) | Wins if |
|---|---|---|---|
| A — rubrics now | 3 — matches head-to-head §7's own cost model ("plus judge calls on check-ties") and engine §7.1 "equal + rubric → judge (§7.5)"; no spec sentence yet says generated cases carry rubrics | 2 — new field on a tested path (`generate.ts:122`, `validateCases:94`), but the live judge chain is unexercised here; a vague rubric or a split-happy judge returns the same null at higher cost | You would rather not burn 75 agent runs proving that ties swamp the run |
| B — check-only + tripwire | 1 — spec is silent on generated rubrics, and B assumes checks discriminate between two skilled arms, which §5.1's all-or-nothing rule argues against | 0 — no code change | You want the first real run to tell you the tie rate instead of predicting it |

### Implementation notes folded into the LOCK (not separate decisions)

- The rubric is derived from **the brief alone**, never from either `SKILL.md` — otherwise
  it reintroduces the circularity §3.2 exists to remove.
- Validation joins the existing three-attempt `askWithValidation` correction loop:
  non-empty, 2–4 sentences.
- The rubric is subject to the same skill-name neutrality check as the brief, since it
  enters the case set and is read by the judge.
- §7's cost line stops being hypothetical: judge calls now actually fire on check-ties.
  Engine §7.5 calls them "the cheap half of a comparison."

### Technical

- **Files / code paths:** `generate.ts:122` (`casePrompt` JSON shape), `generate.ts:94`
  (`validateCases`), `execution.ts:325`
  (`if (evalCase.judge === undefined) → 'checks-equal-no-judge'`). `loadCase` already accepts
  `judge`, so no parser work.
- **Migration / schema:** none. `decided_by: 'checks-equal-no-judge'` is already a documented
  value in engine §7.1's row bookkeeping.
- **Effort / blast radius:** ~10 lines plus a validator rule; changes the cost model, since
  §7's 75-run estimate assumes judge calls that currently never fire.
- **Grounding findings (verified against live code, not hypothesis):** no `judge:` rubric
  exists in any case file in this project — `grep -rln "judge:" --include='*.yaml'` returns
  nothing outside `src/lib/evals/__tests__/execution.test.ts:113-126`. Every production eval
  run to date has been decided by checks or tied.

---

## Decision 2 — Where the partial-run warning lives once the verdict line is gone

**Verdict: LOCK (option C — always print `scored: n/m rows`)** · **Importance: 6/10** — it
shapes one display path and is reversible in minutes, but the failure it prevents is someone
reading a half-broken run as a real result and acting on it.

### Plain English

- **What's at stake:** Today a crashed-mid-matrix run reports
  `verdict: NEUTRAL [partial — 37/50 scored]`. That bracket is the only signal that evidence
  is missing. §4 removes the verdict line, and the bracket is glued to it, so it vanishes
  too. A head-to-head where a third of the runs died would print three clean-looking arm
  scores and say nothing.
- **Why it's a fork:** Not *whether* to fix it — that is settled. The fork is that
  head-to-head has no verdict band, so it has no summary line to hang a warning on. In
  normal mode the band is what you read first and the bracket rides along; here there is
  nothing to ride.
- **Impact:** Renderer-only, no stored data, minutes to reverse. The difference is whether a
  reader who was not watching the run can tell how much of it completed.
- **Options:**
  - **C — always print `scored: 37/50 rows` in this mode, greyed when partial.** *(the
    difference that decides: the denominator shows on every run, not only broken ones —
    which matters precisely because no verdict band is left to carry it)*
  - **A — move the bracket to the headline** `head-to-head: A vs B — 5 cases · k=5
    [partial — 37/50 scored]`. *(the difference that decides: cheapest possible, one string
    move, visible only when something went wrong)*
  - **B — print `verdict: n/a (head-to-head)` and leave the bracket in place.** *(the
    difference that decides: no renderer restructuring, but it puts a `verdict:` line back
    into the one mode whose §4 rationale is that it has none)*
- **Recommendation given:** C — strip the band and the annotation has nothing to annotate,
  so state the denominator outright. The only option where a clean run also tells you it was
  clean.
- **Zoom-out (does this serve the North Star?):** Yes, directly. A rough signal is only
  usable if you can see how much of it landed; `scored: n/m` is two lines and makes the
  cheapness safe rather than merely cheap.
- **The call:** Ryan chose **C**.

### Scores

| Option | Fit (0-4) | Bug risk (0-4) | Wins if |
|---|---|---|---|
| C — always print `scored:` | 4 — `results.ts` header states the invariant outright: "No coercion anywhere (§5.3): unscored holes stay visible, never averaged into a clean-looking number"; an unconditional denominator is that sentence's point | 1 — mechanical; a wrong denominator is visible on the next run and nothing falls back to silence | You want a reader who was not there to know how complete the run was |
| A — bracket on the headline | 3 — matches §4's "`execution_status` and the unscored-hole greying behave exactly as today" | 1 — mechanical, falls back to today's behaviour | You want the minimum change that closes the hole |
| B — `verdict: n/a` line | 2 — implied by §4's greying sentence, but works against §4's own "the renderer omits the line rather than printing NEUTRAL" | 1 — mechanical | You would rather not touch the renderer's structure at all |

### Technical

- **Files / code paths:** `results.ts:130-133` — `grey` is computed from `execution_status`
  and `scored_rows`/`expected_rows`, then pushed only as a suffix inside
  `` `verdict: ${verdict}${grey}` ``. Nothing else in `renderReport` carries completeness.
- **Migration / schema:** none. `execution_status` already exists on `Aggregate` and is
  already returned from `run()` as `EvalResult.executionStatus`.
- **Effort / blast radius:** renderer-only; no effect on normal-mode output.
- **Interaction:** `expectedRows === 0` reports `complete` by engine §7.1. If a zero-case
  head-to-head stays reachable — `--vs --no-gen` is undefined in the draft, one of the
  out-of-scope findings below — C prints `scored: 0/0 rows` rather than nothing.

---

## Decision 3 — Is a supplied brief checked, or trusted?

**Verdict: LOCK (option A′ — scaled check)** · **Importance: 6/10** — reversible in minutes,
but the path it governs is not the edge case the spec assumes: it is the main path.

### Plain English

- **What's at stake:** The brief is the single thing that decides what both skills get
  tested on. §1 calls the human's sign-off "the whole neutrality guarantee." `--brief <path>`
  skips both halves — the confirm (by design) and the automatic check that the brief does not
  name either skill. §1.2 then makes `--brief` mandatory whenever there is no terminal.
- **What the grounding changed:** the non-interactive path is not "the automated path", it is
  the *primary* one. `createBoardSink` (`src/lib/render/sink.ts:38-47`) hands every
  `--format md` invocation a prompter with `interactive: false` whose `confirm` throws at
  once — that is the sink behind the `/eval`-style skills — and the desktop app has its own
  eval host (`desktop/src/app/EvalRunDialogHost.tsx`, `eval-queue-host`). Most invocations
  will arrive with no human able to confirm anything, and `--brief` is how they all come in.
  "A human wrote it, so it is neutral by assumption" is doing a lot of work for a file path
  assembled by an app.
- **What that rules out:** refusing head-to-head entirely without a terminal — tempting,
  since head-to-head needs generation and generation never runs in CI — would block the
  desktop app and every skill-driven run. Not viable; dropped before it reached the options.
- **Impact:** either the deterministic name check runs on every brief the generator sees, or
  there is exactly one code path into case generation with no neutrality guarantee on it.
  A few lines, trivially reversible; the consequence is whether a partisan or stale brief can
  silently set the terms of the comparison.
- **Why it's a fork:** the check refuses any brief naming either skill, and this project's own
  skills are named `search`, `eval`, `install`, `sync`, `ls`, `run`. A `search`-vs-`ls`
  head-to-head would demand a description that never uses the word "search", with no
  correction loop on a supplied brief to recover — a hard stop. Strict checking can make the
  mode unusable for exactly the common-word skills worth comparing.
- **Options:**
  - **A′ — check supplied briefs, refusal scaled to the name.** *(the difference that
    decides: closes the hole without making common-word skills uncomparable)*
  - **A — check strictly, any token match refuses.** *(the difference that decides: one rule,
    no judgment call, at the price of false refusals)*
  - **C — leave it as drafted, supplied briefs trusted.** *(the difference that decides: zero
    work, and the advertised guarantee does not exist on the path most runs take)*
- **Recommendation given:** A′ — ~5 lines of deterministic string work, no model call, and the
  only option where "the brief is neutral" stays true for an app-driven run.
- **Zoom-out (does this serve the North Star?):** Yes. It is the cheap path made safe rather
  than merely cheap — five lines to stop the one guarantee the feature rests on from being
  absent exactly where nobody is watching.
- **The call:** Ryan chose **A′**.

### Scores

| Option | Fit (0-4) | Bug risk (0-4) | Wins if |
|---|---|---|---|
| A′ — scaled check | 3 — matches §3.1's "must not contain either skill's name… a cheap, deterministic neutrality check" and keeps §1's "whole neutrality guarantee" true on every path | 1 — deterministic string work; worst case is a warning on a brief that was fine, and it falls back to running | You want the guarantee to hold where nobody is watching, without blocking common-word skills |
| A — strict check | 3 — same sentence, applied without exception | 2 — new refusal on a path with no correction loop; `search`-vs-`ls` becomes unrunnable non-interactively | You would rather have one rule than a judgment call about ordinary words |
| C — trust supplied briefs | 0 — contradicts §1's "the brief is the only thing the case generator sees, and a human signed off on its text"; on this path nobody signed off | 0 — no code change | You treat `--brief` as an explicit caller assertion and accept that the app is the caller |

### Implementation notes folded into the LOCK (not separate decisions)

- **The "ordinary word" rule needs no dictionary:** hard-refuse when the skill name contains
  a hyphen or splits into two or more tokens; warn when it is a single token. Deterministic,
  no word list, nothing to maintain.
- The 1,500-character cap moves with the check — §3.1 attaches it to derivation only, so a
  supplied brief is uncapped as drafted.
- The check is lifted out of `askWithValidation`'s correction loop into a standalone pure
  function, so the supplied-brief path calls it without a model round-trip.

### Technical

- **Files / code paths:** `generate.ts:69` (`askWithValidation`) for the extraction;
  `eval.ts` gains the `--brief` read and the check before any agent call, per §1.2.
- **Migration / schema:** none.
- **Effort / blast radius:** ~5 lines plus the extraction.
- **Settled free by this:** §1.2 says `PromptClosedError` "is not the right failure; the
  message must name `--brief`" without saying how to detect the channel.
  `Prompter.interactive` (`prompt.ts:15`) is readable before any agent call, satisfying
  §1.2's "all checked before any agent call." The spec should name it, so nobody implements
  the refusal by catching the throw from `sink.ts:39`.
- **Grounding findings (verified):** `src/lib/render/sink.ts:38-47` builds `interactive:
  false` with `confirm` → `PromptClosedError`; `desktop/src/app/EvalRunDialogHost.tsx` and
  `eval-queue-host.test.tsx` confirm a desktop eval path exists.

---

## Decision 4 — What the comparison rows print, and what §5 claims about reproducibility

**Verdict: LOCK (option C — W/L/T + sign-test p, no net lift)** · **Importance: 5/10** — a
caveat paragraph and one display line, no stored data, reversible in minutes. It rates this
high only because it is the reader's sole calibration once the verdict band is gone, and §5
is the claim the spec leads with.

### Plain English

- **The part that is not a fork — §5's caveat is factually off:** §5 says this mode "prints
  the two numbers that reproduce and refuses to print the one that does not." The r = 0.97 in
  that sentence is specifically the **without-skill** arm
  (`2026-09-03-phase-3-eval-share-research.md:116`); Terum's record of the same analysis puts
  the *with-skill* arm's run-to-run movement at ~0.08 against ~0.083 for lift. Candidate and
  rival are both with-skill arms. In absolute terms the two numbers this mode prints move
  about as much as the one it refuses to print; the r = 0.97 vs r = 0.35 gap is largely a
  dynamic-range effect across fourteen skills. Text fix, not a design change.
- **The part that is a fork:** `summarize()` prints
  `+20% net lift (11W / 9L / 5T over 25 comparisons, sign test p=0.824)`. §4's sample prints
  `11W 9L 5T` and nothing else, without saying it is dropping anything.
- **Why it matters more than it looks:** run §4's own sample numbers through the sign test.
  `candidate-vs-rival: 11W 9L` → **p = 0.824**. `candidate-vs-baseline: 14W 6L` → **p =
  0.115**. Neither is distinguishable from a coin flip at 25 rows — but "14W 6L 5T" reads to
  a human as clearly better. The p-value is what stands between this report and a confident
  wrong conclusion, and §4's sample silently removes it, in the same mode that already
  removed the verdict band.
- **Impact:** a renderer line either way. The difference is whether a reader can tell the
  result is noise.
- **Options:**
  - **C — `11W 9L 5T over 25 comparisons, sign test p=0.824`.** *(the difference that
    decides: keeps the uncertainty signal, drops the one quotable number a reader could
    screenshot as a ranking)*
  - **A — reuse `summarize()` unchanged, net lift and all.** *(the difference that decides:
    literally free, already tested, already what `candidate-vs-incumbent` prints)*
  - **B — W/L/T only, as §4 drafts it.** *(the difference that decides: tidiest report, and
    the only one that can turn p = 0.824 into "A won")*
- **Recommendation given:** C. A is defensible — the paired comparison is what the narrowing
  sanctioned — but "+8% net lift, skill A over skill B" is the most screenshot-able
  cross-skill number this feature could emit, and three lines buys it away while keeping the
  part that protects the reader. B should not survive in any form.
- **Zoom-out (does this serve the North Star?):** Yes. Cheapest-signal fails on its own terms
  if the cheap signal gets misread as a strong one; three lines is what stops that.
- **The call:** Ryan chose **C**.

### Scores

| Option | Fit (0-4) | Bug risk (0-4) | Wins if |
|---|---|---|---|
| C — W/L/T + p, no net lift | 3 — serves §5's stated purpose better than §5's own sample does, and honours §5.1's ban on a surface that orders skills | 1 — a format variant beside `summarize()` (`stats.ts:48`); wrong formatting is visible immediately | You want a reader to see that 11W-9L is noise, without handing them a number to quote |
| A — reuse `summarize()` | 2 — implied by the existing `candidate-vs-incumbent` display, which already prints net lift under the same engine rules | 0 — no new code | You want zero work and trust the narrowing to cover a paired lift number |
| B — W/L/T only | 1 — matches §4's sample literally, but the spec never states the omission or why | 0 — no new code | You believe any statistic beyond the raw record invites misreading |

### Implementation notes folded into the LOCK (not separate decisions)

- `net_lift` and `sign_p` stay on `ComparisonSummary` and in the run tree. This is display
  only; nothing is lost to later analysis.
- k stays at 5 and the suppressed `rival-vs-baseline` row stays suppressed. The corrected
  caveat does not reopen either.
- §5's citations split correctly: ρ −0.07 / −0.22 →
  `.planning/research/2026-09-04-eval-determinism-probe.md`; r = 0.97 / 0.35 →
  `2026-09-03-phase-3-eval-share-research.md` §4.

### Technical

- **Files / code paths:** `stats.ts:48` (`summarize`) and its call site `results.ts:136`.
  C adds a sibling formatter; A changes nothing; B needs a conditional that drops fields.
- **Migration / schema:** none.
- **Effort / blast radius:** ~3 lines for C. No effect on normal-mode output in any option.
- **Verified arithmetic:** `signTest(11,9) = 0.824`, `signTest(14,6) = 0.115`, computed from
  `stats.ts:8-20` against §4's own sample report.

---

## Out of scope for this walk

Ryan scoped this walk to the blockers. The same review raised six non-blocking findings that
were **not** walked and remain open. They are declared in `deferred:` so they surface in
`DEFERRED-INDEX.md`, gated on the handoff to `/codex-implement`:

- **§3.2 contradicts itself on case count** — "including the exactly-three-cases rule"
  followed by "raise the count to five." `validateCases` (`generate.ts:94`) and the prompt
  string (`generate.ts:123`) both hardcode three. A builder implements the sentence it reads.
- **`--vs --no-gen` is undefined** — yields zero cases, and `expectedRows === 0` reports
  `complete` by engine §7.1. Belongs in §1.2's refusal list. (D2's `scored: 0/0 rows` makes
  the outcome visible but does not prevent it.)
- **No position swap in brief derivation** — §7.5 swaps A/B for the judge precisely because
  position bias was a top-two noise source, yet §3.1 feeds the deriver A then B, fixed, and
  its output seeds every case. Aliasing to `Skill 1`/`Skill 2` with RNG-seeded order also
  cuts name leakage into the brief, which eases D3's check.
- **Mechanical lows** — `Aggregate.verdict` must widen to `Verdict | null` while the frozen
  §5.3 receipt schema stays untouched; arm print order is insertion order today
  (`results.ts:138`) so §7.5's fixed candidate·rival·baseline is real work; the `why:` line is
  derived from baseline rows only and would misread under a head-to-head headline;
  `materializeIncumbent` must be skipped in `--vs` mode; the rival's version needs pinning;
  the determinism-probe citation path is wrong.

**The common-word skill-name problem was not deferred — it was absorbed into D3** and
resolved there by the hyphen/token rule.
