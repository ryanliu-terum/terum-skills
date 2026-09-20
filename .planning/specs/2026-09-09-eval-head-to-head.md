# Eval head-to-head — two skills, one brief, three arms (IE6)

**Status:** DRAFT rev 2 (Ryan, 2026-09-19). Rev 2 folds in the four blocker resolutions
from `.planning/decisions/2026-09-19-eval-head-to-head-blockers-decision-walk.md` — D1 judge
rubrics, D2 the `scored:` line, D3 the supplied-brief check, D4 the comparison-row format —
plus six non-blocking findings from the same review. Rev 1 was never built.

Adds a head-to-head execution mode to the `eval` verb: two different skills scored
against each other on one neutrally-derived case set, in one run, with no winner label.

**D29 standing:** D29 (ajay, 2026-09-04, Terum `89631cef`) bans ranking or sorting
skills by lift or any displayed number, and engine spec §2 lists "any cross-skill
comparison surface" as Out. Ryan ruled in session on 2026-09-09 (Terum `ab237d5e`)
that a **paired, same-run** comparison falls OUTSIDE that ban, because D29's rationale
— denominators too small for cross-skill comparison — applies to *independently
produced* lift numbers, whereas this is structurally the existing
`candidate-vs-incumbent` comparison that already gates publish: same cases, same k
reps, same sandbox seeding, same judge with position swap, both skills staged in one
run. The ban on ranking surfaces survives intact and is enforced here by §5.

`record_override` could not be used — the endpoint rejected both the surfaced
`decision_id` and its note id ("receipt is missing, not yours, or expired") and
`check_decision` returns no `receipt_id` field — so the ruling was recorded as a
decision instead. Someone should reconcile that with Terum — still unreconciled as of
rev 2 (2026-09-19).

**Governing contracts (unchanged by this spec):**
- Engine spec (`2026-09-04-eval-engine.md` rev 16): case schema §5.1, receipt schema
  §5.3 (frozen for Teddy), §6.0 write invariant, §7.1 arm loop, **§7.3 contamination
  refusal** (this spec generalizes §7.3 and changes nothing else about it), §7.5 judge.
- Eval-gen spec (`2026-09-07-eval-gen.md` rev 2): the generator is the only model
  orchestration outside `agent.ts`; generation never runs in CI.

**Measurement caveat, kept in front of the reader.** Two separate studies, and rev 2
splits the citation because rev 1 attributed both to one of them:

- The SkillEvaluator test–retest
  (`.planning/research/2026-09-03-phase-3-eval-share-research.md` §4) found per-skill lift
  correlating at only r = 0.35 across identical runs, while the **without-skill** arm
  correlated at r = 0.97. The same analysis measured the *with-skill* arm moving ~0.08
  between identical runs, against ~0.083 for lift.
- The determinism probe (`.planning/research/2026-09-04-eval-determinism-probe.md`) found
  per-skill ranking uncorrelated across reruns (ρ −0.07 to −0.22).

The honest statement is narrower than rev 1's. Arm scores correlate far better *across a
set of skills* than their difference does, but a single with-skill arm score — which is
what both `candidate` and `rival` are — moves about as much as lift does in absolute
terms; the r = 0.97 vs r = 0.35 gap is substantially a dynamic-range effect across
fourteen skills. §5's refusals follow from the **ranking** result (ρ ≈ 0), not from a
claim that the two printed numbers are stable. The mitigations are k = 5 and the paired
W/L/T record with its sign test (§4), not the arm scores.

## 1. Behavior

`terum-skills eval <skill> --vs <other-skill>` enters head-to-head mode. Both refs
resolve through the existing `findSkill` path in the same team; both trees are
materialized at their head tree in the refreshed clone (`resolveVersion`, as the candidate
is) and hygiene-checked exactly as the candidate is today. A hygiene refusal on either
tree fails the run, and the message names which of the two failed.

The run then proceeds in five steps, of which only the third is new work:

1. **Derive a shared task brief.** A new generation mode reads both `SKILL.md` files and
   both file listings — aliased to `Skill 1` / `Skill 2` in an order drawn from the run's
   seeded RNG, never A-first and never by name (§3.1) — and returns a short plain-prose
   description of the job the two skills are competing to do, naming neither of them. It
   lands in the run tree as `brief.md`.
2. **Human reads and edits it.** The brief is printed with its path, then one
   `io.confirm("Use this brief?")`. **Yes** → continue. **No** → the command stops,
   telling the reader to edit `brief.md` and re-run with `--brief <path>`. This is the
   whole neutrality guarantee: the brief is the only thing the case generator sees, and
   a human signed off on its text.
3. **Generate cases from the brief alone.** Five of them, each carrying a judge rubric
   also derived from the brief (§3.2). Neither `SKILL.md` enters the case-generation
   prompt. This is the structural difference from today's generator, which is
   deliberately seeded with the candidate's own skill text.
4. **Run three arms** over those cases, k reps each: `baseline` (nothing staged),
   `candidate` (skill A), `rival` (skill B).
5. **Report arm scores side by side**, plus the paired comparison records with their sign
   test and an always-present `scored:` line, with **no verdict band and no winner label**
   (§4, §5). Nothing is committed.

### 1.1 Flags

| Flag | Meaning |
|---|---|
| `--vs <ref>` | The rival skill. Enters head-to-head mode. |
| `--brief <path>` | Supply the brief directly; skips derivation and the confirm gate. Required on a non-interactive channel. |
| `--k <n>` | Unchanged. **Default rises to 5 in this mode** (§7). |

### 1.2 Refusals (all checked before any agent call)

- `--vs` + `--commit` → *"head-to-head runs are never committed: a receipt pins one
  skill id and one tree hash."*
- `--vs` + `--case` → a named case is an authored assertion belonging to one skill.
- `--vs` + `--save` → brief-derived cases belong to neither skill's folder.
- `--vs` + `--triggers-only` → trigger evals are per-skill; this mode is execution only.
  (`--vs` implies `--execution-only`; passing it explicitly is accepted.)
- `--vs` naming the same skill id as `<skill>` → refused.
- `--vs` with a skill outside the selected team → refused by `findSkill` as today.
- `--vs` + `--no-gen` → refused: head-to-head cases come from the brief, so `--no-gen`
  leaves the run with zero cases — and `expectedRows === 0` reports `complete` by engine
  §7.1, i.e. a clean-looking report over no evidence. (`--gen` is implied by `--vs` and is
  accepted as a no-op, like `--execution-only`.)
- Non-interactive channel without `--brief` → refused. Detect it by reading
  `Prompter.interactive` (`prompt.ts:15`) before any agent call, **not** by catching a
  `PromptClosedError` out of `io.confirm`: that is the wrong failure, and the message must
  name `--brief`. On this branch non-interactive means piped stdin — `terminalPrompter`
  resolves `interactive` from `input.isTTY` (`prompt.ts:61`) and `src/index.ts:51` is the
  only construction site. The board sink on `feat/bulk-write-batching`
  (`createBoardSink`, `interactive: false`) will make this the *common* path rather than a
  scripted edge case once that lands; the refusal is written to hold either way.
- `--working` continues to apply to `<skill>` only; the rival is always a committed
  version. Mixing an uncommitted working tree into both sides of a comparison makes the
  result unreproducible, and only one source can be `--working` anyway.

## 2. Per-arm skill identity — generalizing §7.3

This is the one load-bearing change, and the one place a silent bug is possible.

`execution.ts` today carries a single `skillName: string` (`RunCaseOptions:204`) used
for **both** the staging path `.claude/skills/<name>` (`seedSandbox:126`) **and** the
contamination assertion (`:269`), which refuses the whole run when an arm's resolved
skill list disagrees with what that arm staged. With two distinct skills in one matrix,
one scalar cannot express the invariant.

**Replace** `skillName: string` + `arms: { candidate, incumbent? }` with a single
arm table carrying identity and tree together:

```ts
export type ArmSpec = { name: string; dir: string } | null;   // null = baseline
export const ARMS = ['baseline', 'candidate', 'incumbent', 'rival'] as const;
```

`RunCaseOptions.arms: Partial<Record<Arm, ArmSpec>>`, with `baseline: null` always
present and `candidate` always set.

**The assertion becomes per-arm over the set of skills under evaluation in this run:**

```ts
const evaluated = new Set(armSpecs.filter(s => s !== null).map(s => s.name));
// for each arm, for each name in `evaluated`:
//   expected = (arm's staged name === name)
//   if (skillList.includes(name) !== expected) throw new ContaminationError(...)
```

So skill A's arm must contain A **and must not contain B**; B's arm the reverse;
baseline neither. The existing rules survive unchanged: a staged arm that reports no
skill list at all still refuses the run (§7.3 / §17.7), and membership — never list
equality — remains the signal, because the CLI always lists its own built-ins.

**This is the change I would gate on hostile tests**, not on review: leaking B's tree
into A's arm produces no error today, just a clean-looking score.

### 2.1 Comparison rows

The opponent loop gains `rival`, keeping `candidate` on the left:

- `candidate-vs-baseline` — does A help at all?
- `candidate-vs-rival` — the paired head-to-head.
- (`candidate-vs-incumbent` is not produced in this mode; the incumbent arm is skipped.
  `materializeIncumbent` (`eval.ts:178`) is not called at all — no incumbent tree is
  materialized, and `opponents` is fixed at 2 rather than derived from its result.)

"Does B help?" is read off `arm_scores.rival` vs `arm_scores.baseline`, which is the
D29-sanctioned display form. A `rival-vs-baseline` comparison row is deliberately **not**
emitted: it would invite a lift-vs-lift subtraction, which is the r = 0.35 quantity.

`expectedRows` becomes `cases × k × 2`.

## 3. The brief and brief-seeded generation (`generate.ts`)

### 3.1 `deriveBrief`

New export. The prompt receives both `SKILL.md` files and both file listings, **aliased to
`Skill 1` / `Skill 2`, ordered by skill name (ASCII, ascending) rather than by which one was
typed first**. Rev 2 first specified a seeded-RNG order; that was wrong, and implementation
caught it — the seed is fixed at 0, so the first draw is constant and the CLI's first
argument would land in the same alias slot on every run, which is exactly the systematic
tilt the swap exists to remove. Name order is deterministic and reproducible like a seed,
but it is uncorrelated with which skill the caller is championing: the candidate takes the
`Skill 1` slot in roughly half of all pairs instead of all of them. Rev 1 fed them
A-then-B by name: §7.5 swaps A/B orderings for
the judge precisely because position bias was a top-two noise source in the 2026-09-04
probe, and the deriver is the one place the two skills are read side by side — its output
seeds every case, so a fixed order is a systematic tilt in every rep. Aliasing also makes
the model far less likely to emit either name, which is the check below.

Returns JSON `{"brief": "..."}`. Validation, in the existing `askWithValidation`
three-attempt correction loop: non-empty, ≤ 1,500 characters, and `checkBriefNeutrality`.

`checkBriefNeutrality(brief, names)` is a **standalone pure function**, not logic buried in
the correction loop, because the supplied-brief path calls it too and must not pay a model
round-trip. It returns `refuse` / `warn` / `ok`:

- a name that is hyphenated or splits into two or more tokens (`live-trigger-monitoring`)
  → **refuse** on a hit. A brief containing that string is describing the tool, not the job.
- a single-token name → **warn** and continue. This project's own skills are named `search`,
  `eval`, `install`, `sync`, `ls`, `run`; a `search`-vs-`ls` head-to-head cannot be described
  in prose that never uses the word "search", and a hard refusal there burns three attempts
  and fails the run. No dictionary and no word list — the rule is hyphen-or-token-count, so
  it stays deterministic and has nothing to maintain.

Output is written to `<runDir>/brief.md` with the same provenance header the other
generated assets carry (`# generated by terum-skills eval-gen — review before trusting`
plus model/engine/timestamp).

`--brief <path>` reads the file and skips derivation and the confirm gate, but **not the
checks**: the 1,500-character cap and `checkBriefNeutrality` both run, and a hit on a
multi-token name refuses outright, since there is no correction loop to recover on this
path. Rev 1 skipped them on the grounds that a human wrote the file — but §1.2 makes
`--brief` mandatory without a terminal, and a file path handed to a scripted run is not a
signature. That gap widens once the `--format md` board sink lands (see §1.2): every such
invocation is non-interactive by construction, so "a human signed it" would then be
covering the common case rather than the edge case. The confirm gate remains the primary guarantee where a human is
present; the deterministic check is what remains where one is not.

### 3.2 Brief-seeded cases

`GenerateOptions` gains an optional `brief?: string`. When present, `context()` returns the
brief **alone** — no `SKILL.md`, no file listing.

Two things change in `casePrompt` for this mode. Rev 1 stated the first of them twice and
contradictorily ("including the exactly-three-cases rule", then "raise the count to five");
the count is **five**.

1. **Five cases, not three.** Three is too thin a denominator for a comparison anyone will
   act on, and the cases are cheaper here than the arms. The count becomes a parameter:
   `validateCases` (`generate.ts:94`) hardcodes `supplied.length !== 3` and the prompt
   string (`generate.ts:123`) says "exactly three" — both read the mode's count.
2. **Every case carries a `judge` rubric**, 2–4 sentences, derived from the brief alone and
   never from either `SKILL.md`. Without one the mode cannot discriminate at all:
   `decide()` (`execution.ts:325`) returns `checks-equal-no-judge` whenever the two arms'
   all-checks-passed booleans match, and two competent skills on the same task pass the same
   checks. Against the empty baseline checks discriminate fine — the arm with no skill fails
   the skill-shaped ones — which is why this has never bitten before. Note that **no case
   file in this project carries a rubric today**, so §7.5's judge chain runs against a live
   model here for the first time; that is a known, accepted risk, taken because the
   alternative is a 75-agent-run exit gate that returns 25 ties. The rubric passes
   `checkBriefNeutrality` (§3.1) like the brief does, inside the same three-attempt
   correction loop.

Everything else is unchanged: the bucket taxonomy, the at-least-one-adversarial rule, and
the check whitelist (`transcript_mentions`, `command_matching`, `no_command_matching`,
`file_exists`, `file_absent` — never `command_succeeds`).

The eval-gen spec's accepted circularity risk is *removed*, not merely mitigated, in
this mode — the generator never sees either skill's text. The brief-derivation step
inherits it instead, which is exactly why a human signs the brief.

## 4. Report and run tree

`renderReport` gains a head-to-head mode. It prints:

```
head-to-head: <A> vs <B> — 5 cases · k=5
scored: 50/50 rows
arm scores: candidate 0.82 · rival 0.71 · baseline 0.61
candidate-vs-baseline: 14W 6L 5T over 25 comparisons, sign test p=0.115
candidate-vs-rival:    11W 9L 5T over 25 comparisons, sign test p=0.824
efficiency: candidate 6.2 turns · 41.3s · $0.38 | rival 7.1 turns · 52.9s · $0.44 | baseline ...
brief: <runDir>/brief.md (human-confirmed)
note: arm scores correlate across skills better than their difference does, but a
      single with-skill arm still moves ~0.08 between identical runs. This is
      evidence about two skills on one task brief, not a ranking.
```

- **No `verdict:` line.** `aggregate` currently derives the band from
  `candidate-vs-baseline` unconditionally (`results.ts:84–85`); in head-to-head mode
  `verdict` is `null` and the renderer omits the line rather than printing `NEUTRAL`.
  `Aggregate.verdict` therefore widens to `Verdict | null`. The §5.3 receipt schema
  (`receipt.ts:56`, `z.enum(['PASS','NEUTRAL','FAIL'])`) stays **frozen and unchanged** —
  head-to-head never commits, and what guarantees that is §1.2's runtime refusal, not the
  type. Do not widen the receipt for symmetry.
- **An always-present `scored: <n>/<m> rows` line**, greyed when
  `execution_status !== 'complete'`. Today the partial marker is a suffix on the verdict
  line (`results.ts:130–133`), so removing that line removes the warning with it: a run
  where a third of the matrix died would print three clean-looking arm scores and say
  nothing. Rev 1's "greying behaves exactly as today" could not be implemented literally.
  Stating the denominator on every run rather than only broken ones is engine §5.3's
  no-coercion rule — "unscored holes stay visible, never averaged into a clean-looking
  number" — applied where the band used to carry it.
- **Comparison rows carry the sign test, not net lift.** `11W 9L 5T over 25 comparisons,
  sign test p=0.824`, from a sibling formatter beside `summarize()` (`stats.ts:48`). The
  W/L/T record alone reads to a human as a win; run the sample above through `signTest` and
  `candidate-vs-rival` is p = 0.824 while `candidate-vs-baseline` is p = 0.115 — neither
  distinguishable from a coin flip at 25 rows. Once the verdict band is gone the p-value is
  the reader's only calibration. The net-lift percentage is dropped because it is the one
  quotable cross-skill number this mode could emit; `net_lift` and `sign_p` both stay on
  `ComparisonSummary` and in the run tree, so nothing is lost to later analysis.
- **Arm order is candidate · rival · baseline, imposed explicitly.** `renderReport`
  iterates `Object.entries(arm_scores)` in insertion order, which is `armDirs` order and
  therefore baseline-first (`results.ts:138`); §7.5's fixed order is real work, not a no-op.
- **No `why:` line in this mode.** `attributionLine` (`results.ts:104`) reads only
  `candidate-vs-baseline` rows, so under a head-to-head headline it would read as if it
  described the head-to-head.
- **No winner language anywhere** — not in the report, not in the run tree, not in the
  exit code.
- `execution_status` and the unscored-hole accounting behave exactly as today; only where
  the warning is *printed* changes.
- Run tree is written as usual under `evals/<team>/<skill-id>/<run-id>/`, keyed on A's
  id, with `_meta` gaining `mode: "head-to-head"`, `rival_skill_id`, `rival_skill_name`,
  `rival_version` (the rival's head tree in the refreshed clone), `brief_source:
  "derived" | "supplied"`, and `brief_order` — which of the two was `Skill 1` in the
  derivation prompt (§3.1), without which the aliasing is unauditable.

## 5. What this spec deliberately does not do

1. **No winner label, no verdict band, no ranking, no sort, no leaderboard.** D29 as
   narrowed by `ab237d5e` permits the paired measurement; it does not permit a surface
   that orders skills. If a later UI wants to render this, it renders arm scores side by
   side, the way share cards already do.
2. **No receipt, ever.** A receipt pins one `skill_id` and one tree hash and its
   `candidate-vs-incumbent` record gates publish. A head-to-head run pins two unrelated
   trees; committing it under either id would inject "lost to an unrelated skill" into
   that skill's gating record.
3. **No trigger comparison.** Which of two skills fires for a prompt is a genuinely
   interesting question and a different feature; trigger evals are catalog-wide and
   per-skill today.
4. **Exactly two skills.** No N-way. The arm table would support it; the display rules
   would not survive it.
5. **The existing three-arm path is untouched.** Same flags, same comparisons, same
   receipts, same publish gate. The only shared code that changes is §2's arm identity,
   which is a refactor with identical behavior when one skill is under evaluation.

## 6. Build order and exit

- **HH1 — arm identity.** §2 refactor alone: `ArmSpec`, per-arm contamination, no new
  arm, no new flag. *Exit:* the full existing eval suite passes unchanged, plus new
  tests proving a cross-staged tree raises `ContaminationError` for each arm position.
- **HH2 — the rival arm.** `rival` in `ARMS`, the opponent loop, `expectedRows`,
  `--vs` resolution and all of §1.2's refusals. *Exit:* a head-to-head run over an
  authored case set produces both comparisons and three arm scores.
- **HH3 — brief derivation and brief-seeded generation.** §3 in full, plus the confirm
  gate. *Exit:* `brief.md` lands, names neither skill, and a declined confirm stops the run
  with the re-run instruction; five cases generate, each carrying a rubric; a supplied
  `--brief` naming a multi-token skill is refused with no model call; the derivation
  prompt's skill order varies with the seed.
- **HH4 — report mode.** §4. *Exit:* no verdict line, no `why:` line, no winner language;
  `scored: n/m rows` present on a complete run and greyed on a partial one; comparison rows
  carry the sign test and no net-lift percentage; arms print candidate · rival · baseline;
  the caveat note present.

**Overall exit:** a real head-to-head run between two genuinely similar shared skills,
reviewed by a human who agrees the brief is fair to both.

## 7. Defaults chosen here (veto cheap)

1. **k defaults to 5 in head-to-head mode** (3 elsewhere). The comparison is the noisier
   quantity; the extra reps are the cheapest available mitigation.
2. **Five generated cases** (three elsewhere), per §3.2.
3. **Brief cap 1,500 characters.** Long enough for a real task description, short enough
   that a human actually reads it before confirming.
4. **`--working` applies to the primary skill only** (§1.2).
5. **Arm order in the report is candidate · rival · baseline**, fixed, never sorted by
   score — sorting is the ranking surface D29 bans.
6. **Every generated case carries a 2–4 sentence judge rubric** (§3.2), derived from the
   brief alone.
7. **The brief checks apply to supplied briefs too** — the 1,500-character cap and
   `checkBriefNeutrality`, refusing on multi-token names and warning on single-token ones
   (§3.1).
8. **Comparison rows print the sign test, never net lift** (§4).
9. **The derivation prompt orders the two skills by name, not by argument position**
   (§3.1), recorded in `_meta.brief_order`.

**Cost, for the record, not as a decider:** 5 cases × k=5 × 3 arms = 75 agent runs per
head-to-head, plus two generation calls, plus judge calls on check-ties — which in this
mode actually fire, since §3.2's rubrics are what make that path reachable at all. Each
judge call is double-asked with a position swap; engine §7.5 calls them "the cheap half of
a comparison." Roughly double a standard `eval` run.
