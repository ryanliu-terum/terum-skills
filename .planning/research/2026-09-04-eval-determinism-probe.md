# Eval engine determinism probe — 2026-09-04

**Question:** run the same eval twice on identical inputs — same answer?
**Setup:** scratchpad harness over `src/lib/evals/` at 79e8dfe (pre-rev-6 fix): toy
`det-skill` (a PREFLIGHT-OK deploy-report convention), 2 cases (`summary`
check-decided, `advice` judge-decided), k=3, baseline+candidate, model `sonnet`,
judge `sonnet`, seeded RNG (seed 0), CC 2.1.236. Two invocation pairs: stub agent
binary (via `TERUM_SKILLS_AGENT_CMD`), then the real CLI.
**Visual reports:** probe #1 https://claude.ai/code/artifact/0ed1e5fc-a6f4-4249-b560-db98eacf4c07 ·
probes #2–3 (rev-7 rerun + validity battery) https://claude.ai/code/artifact/788d3a23-4131-4294-8f08-54d64a41e6b2

## Findings

1. **Engine plumbing: fully deterministic.** Two complete pipeline runs
   (loadCase → seedSandbox → runCase → aggregate → renderReport) against the stub
   binary produced **byte-identical JSON**, including the seeded judge position
   swaps. Any irreproducibility in a receipt is the model's, never the engine's.

2. **§7.3 as originally specced refused every real run (VE1, now closed).** The
   real CLI's init event always lists its **16 built-in skills** (deep-research,
   dataviz, code-review, loop, schedule, claude-api, …), so the `baseline = []`
   equality assertion could never hold. Both real invocations refused identically,
   down to skill ordering. Confirmed at the same time: `--setting-sources project`
   + `CLAUDE_PROJECT_DIR` does exclude `~/.claude/skills` (no user-authored skills
   appeared). Fix (rev 6, shipped with this note): assert **membership of the skill
   under eval** — present in staged arms, absent in baseline — ignore the rest.
   Full lists stay auditable in `provenance.arm_skill_lists`.

3. **Real verdicts at k=3 are noisy.** With rev-6 semantics shimmed in, two
   identical invocations:

   | | run 1 | run 2 |
   |---|---|---|
   | candidate-vs-baseline | 2W / 0L / 4T | 3W / 2L / 1T |
   | net lift | **+0.33** (on the PASS line) | **+0.17** |
   | verdict | **PASS** | **NEUTRAL** |
   | arm scores (base · cand) | 0.75 · 0.75 | 0.75 · 0.58 |

   Row-level outcome agreement: **1/6**. (Reference point: the phase-3 research
   measured 13/14 verdict-band agreement for skilldeck's engine on a larger,
   less adversarial suite — the two numbers are not directly comparable.)

4. **Noise attribution (transcript forensics).** Not triggering: the skill fired
   in **12/12** candidate runs. Not the judge: consistent when reached. The
   dominant source was **compliance variance**: det-skill's unconditional
   magic-string mandate reads as injection-shaped, and in run 1 the agent balked
   and stopped to ask all 3 `summary` reps (a headless agent that asks dies
   silently → no `report.txt` → checks tie); in run 2 it complied 2/3. One model
   mood-swing flipped the verdict. Hence the §5.1 authoring rule (rev 6): phrase
   conventions as natural practice, not incantation.

## Consequences folded into spec rev 6

- §7.3 membership-not-equality + VE1 closed (with the built-ins caveat).
- §5.1 authoring rule: cases/conventions must not pattern-match to injection.
- §16.6 caveat: band-edge verdicts at k=3 are one rep from flipping; append-only
  receipts are the designed mitigation. Default k=3 deliberately unchanged.

Kept out of scope: a built-ins allowlist for detecting planted *foreign* skills
(indistinguishable from built-ins by name; `--setting-sources project` remains the
exclusion mechanism), and any re-measurement at k=10 — worth doing once the `eval`
verb (ME2) exists and the harness can be retired.

## Probe #2 — rev 7 variance reducers (same day)

Four changes landed as spec rev 7 and re-measured on the identical protocol
(same toy skill, cases, k=3, seed, model):

1. **Judge double-asked in both orderings; disagreement → `judge-split` tie.**
2. **Headless note** (`--append-system-prompt`) on every arm: unattended, never
   stop to ask.
3. **One arm retry** on AgentRunError, in a fresh sandbox; `retried` recorded.
4. **`model_id`** snapshot recorded per arm from the init event (measured value:
   `claude-sonnet-5`; the request alias `sonnet` floats).

| | probe #1 (rev 6) | probe #2 (rev 7) |
|---|---|---|
| stub runs | byte-identical | byte-identical |
| row-level agreement | 1/6 | **6/6** |
| verdicts | PASS vs NEUTRAL | **PASS vs PASS** |
| W/L/T | 2W/0L/4T vs 3W/2L/1T | 6W/0L/0T, both runs |
| candidate arm score | 0.75 / 0.58 | **1.00, both runs** |

The headless note did the heavy lifting: candidate compliance went to 100% (the
balk-and-ask death mode vanished), and with clean transcripts the double-asked judge
picked the candidate consistently in all six judge rows across both runs.

**Caveats, honestly:** n=2 runs on a 2-case toy suite that was accidentally
adversarial in exactly the way change 2 targets — this is strong evidence the
targeted noise sources are gone, not proof of general verdict stability; a
band-edge skill will still wobble. And the headless note is a measurement
trade-off recorded deliberately: arms no longer measure whether an agent would
stop to ask a human, because in this harness there is no human — both arms get
the note identically, so the *comparison* stays fair.

## Probe #3 — validity battery (2026-09-06, engine at d294401)

Reliability was measured; this battery measured **validity**: does the verdict land
where it should for skills of known character, and do the two previously
unexercised paths (incumbent arm, trigger evals) work for real? Four experiments,
run concurrently on the same harness (model `claude-sonnet-5` recorded per arm,
zero retries used):

| experiment | design | expected | got |
|---|---|---|---|
| E1 irrelevant skill | cooking conventions staged on deploy tasks, k=3 | NEUTRAL, ≈0 lift | **NEUTRAL**, −0.17 (0W/1L/5T) |
| E2 harmful skill | "never persist deploy artifacts" compliance rule, k=3 | FAIL | **FAIL**, −0.67 (0W/4L/2T), arm score 0.33 vs 1.00 |
| E3 real incumbent | det-skill v1 (no convention) vs v2 (convention), k=2 | PASS, candidate beats both arms | **PASS**, 4W/0L/0T vs baseline AND vs incumbent |
| E4 trigger evals | 4-skill catalog, 3 should-fire + 3 near-miss prompts | high recall/precision | **recall 1.00, precision 1.00** (3/3 tp, 3/3 tn) |

Notes:

- E1's single judge loss (both orderings agreed the baseline note was marginally
  better) sits comfortably inside the neutral dead zone — the band absorbed it,
  which is the band doing its job.
- E2 shows the harmful-skill path honestly: the candidate only partially obeyed
  the bad policy (2 ties where it wrote the file anyway), and the verdict still
  reached FAIL on the 4 compliant-and-harmful rows.
- E3 is the first real exercise of a three-arm matrix: the incumbent arm staged
  under the same skill name passes the rev-6 membership contamination check, and
  the candidate-vs-incumbent comparison — the publish regression gate's signal —
  read +1.00 as designed.
- Engine-level §15 adversarial coverage was audited the same day: 62 unit tests
  across the 8 modules cover every engine-side entry; guard-eval and
  `--working --commit` refusal belong to the unbuilt CLI layer (ME2/ME3).

Verdict semantics now have empirical backing on all three verdict bands plus
triggers. Remaining untested for real: partial/timeout greying (unit-covered
only), redaction at the sharing boundary (unit-covered only), and everything
CLI-side.
