# Eval head-to-head — two skills, one brief, three arms (IE6)

**Status:** DRAFT rev 1 (Ryan, 2026-09-09).

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
decision instead. Someone should reconcile that with Terum.

**Governing contracts (unchanged by this spec):**
- Engine spec (`2026-09-04-eval-engine.md` rev 16): case schema §5.1, receipt schema
  §5.3 (frozen for Teddy), §6.0 write invariant, §7.1 arm loop, **§7.3 contamination
  refusal** (this spec generalizes §7.3 and changes nothing else about it), §7.5 judge.
- Eval-gen spec (`2026-09-07-eval-gen.md` rev 2): the generator is the only model
  orchestration outside `agent.ts`; generation never runs in CI.

**Measurement caveat, kept in front of the reader.** The determinism probe
(`2026-09-04-eval-determinism-probe.md`) found arm scores reproduce (r = 0.97) while
the *difference* between them does not (r = 0.35), and per-skill ranking is
uncorrelated across reruns (ρ −0.07 to −0.22). Everything in §5 follows from that:
this mode prints the two numbers that reproduce and refuses to print the one that
does not.

## 1. Behavior

`terum-skills eval <skill> --vs <other-skill>` enters head-to-head mode. Both refs
resolve through the existing `findSkill` path in the same team; both trees are
materialized and hygiene-checked exactly as the candidate is today.

The run then proceeds in five steps, of which only the third is new work:

1. **Derive a shared task brief.** A new generation mode reads both `SKILL.md` files
   and both file listings and returns a short plain-prose description of the job the
   two skills are competing to do — naming neither of them (§3.1). It lands in the run
   tree as `brief.md`.
2. **Human reads and edits it.** The brief is printed with its path, then one
   `io.confirm("Use this brief?")`. **Yes** → continue. **No** → the command stops,
   telling the reader to edit `brief.md` and re-run with `--brief <path>`. This is the
   whole neutrality guarantee: the brief is the only thing the case generator sees, and
   a human signed off on its text.
3. **Generate cases from the brief alone.** Neither `SKILL.md` enters the
   case-generation prompt (§3.2). This is the structural difference from today's
   generator, which is deliberately seeded with the candidate's own skill text.
4. **Run three arms** over those cases, k reps each: `baseline` (nothing staged),
   `candidate` (skill A), `rival` (skill B).
5. **Report arm scores side by side**, plus the paired comparison records, with **no
   verdict band and no winner label** (§5). Nothing is committed.

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
- Non-interactive channel without `--brief` → refused (`PromptClosedError` is not the
  right failure; the message must name `--brief`).
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
- (`candidate-vs-incumbent` is not produced in this mode; the incumbent arm is skipped.)

"Does B help?" is read off `arm_scores.rival` vs `arm_scores.baseline`, which is the
D29-sanctioned display form. A `rival-vs-baseline` comparison row is deliberately **not**
emitted: it would invite a lift-vs-lift subtraction, which is the r = 0.35 quantity.

`expectedRows` becomes `cases × k × 2`.

## 3. The brief and brief-seeded generation (`generate.ts`)

### 3.1 `deriveBrief`

New export. Prompt receives both `SKILL.md` files and both file listings; returns JSON
`{"brief": "..."}`. Validation, in the existing `askWithValidation` three-attempt
correction loop:

- non-empty, ≤ 1,500 characters;
- **must not contain either skill's name** (case-insensitive, token match). A brief that
  names a tool is describing the tool, not the job. This is a cheap, deterministic
  neutrality check and it is the reason the correction loop exists here.

Output is written to `<runDir>/brief.md` with the same provenance header the other
generated assets carry (`# generated by terum-skills eval-gen — review before trusting`
plus model/engine/timestamp).

`--brief <path>` reads the file and skips derivation, the neutrality check, and the
confirm gate — a human wrote it, so it is neutral by assumption.

### 3.2 Brief-seeded cases

`GenerateOptions` gains an optional `brief?: string`. When present, `context()` returns
the brief **alone** — no `SKILL.md`, no file listing. `casePrompt`'s instructions are
otherwise unchanged, including the exactly-three-cases rule, the bucket taxonomy, the
at-least-one-adversarial rule, and the check whitelist
(`transcript_mentions`, `command_matching`, `no_command_matching`, `file_exists`,
`file_absent` — never `command_succeeds`).

Raise the count to **five cases** in this mode: three is too thin a denominator for a
comparison anyone will act on, and the cases are cheaper here than the arms.

The eval-gen spec's accepted circularity risk is *removed*, not merely mitigated, in
this mode — the generator never sees either skill's text. The brief-derivation step
inherits it instead, which is exactly why a human signs the brief.

## 4. Report and run tree

`renderReport` gains a head-to-head mode. It prints:

```
head-to-head: <A> vs <B> — 5 cases · k=5 · no verdict (see below)
arm scores: candidate 0.82 · rival 0.71 · baseline 0.61
candidate-vs-baseline: 14W 6L 5T
candidate-vs-rival: 11W 9L 5T
efficiency: candidate 6.2 turns · 41.3s · $0.38 | rival 7.1 turns · 52.9s · $0.44 | baseline ...
brief: <runDir>/brief.md (human-confirmed)
note: arm scores reproduce across runs; the gap between them does not. This is
      evidence about two skills on one task brief, not a ranking.
```

- **No `verdict:` line.** `aggregate` currently derives the band from
  `candidate-vs-baseline` unconditionally (`results.ts:84–85`); in head-to-head mode
  `verdict` is `null` and the renderer omits the line rather than printing `NEUTRAL`.
- **No winner language anywhere** — not in the report, not in the run tree, not in the
  exit code.
- `execution_status` and the unscored-hole greying behave exactly as today.
- Run tree is written as usual under `evals/<team>/<skill-id>/<run-id>/`, keyed on A's
  id, with `_meta` gaining `mode: "head-to-head"`, `rival_skill_id`, `rival_skill_name`,
  `rival_version`, and `brief_source: "derived" | "supplied"`.

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
  gate. *Exit:* `brief.md` lands, names neither skill, and a declined confirm stops the
  run with the re-run instruction.
- **HH4 — report mode.** §4. *Exit:* no verdict line, no winner language, the caveat
  note present.

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

**Cost, for the record, not as a decider:** 5 cases × k=5 × 3 arms = 75 agent runs per
head-to-head, plus judge calls on check-ties, plus two generation calls. Roughly double
a standard `eval` run.
