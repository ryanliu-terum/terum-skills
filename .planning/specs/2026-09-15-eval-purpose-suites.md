# Eval purpose suites — cases that test what a skill is for (IE7)

**Status:** DRAFT rev 1 (Ryan, 2026-09-15, in session with Claude). Not built.
Supersedes nothing yet; revises engine spec §4.3 (session cap), §7.1 (dead-arm row
rule), adds a §5.1 sibling asset (suite), and adds a second generator mode to the
eval-gen spec. Every decision below marked **locked** was made by Ryan in the
2026-09-15 session; everything marked **[veto cheap]** is a default chosen here.

**North Star.** *Test cases actually test what the skill is meant to do.* A receipt
that says PASS must mean the skill did its job better than a bare agent on the same
input, not that it recited its own rulebook.

**Governing contracts (as revised here, otherwise unchanged):**
- Engine spec rev 16 (`2026-09-04-eval-engine.md`): case schema §5.1, sandbox §4.3,
  arm loop §7.1, contamination §7.3, judge §7.5, receipt §5.3 (frozen for Teddy —
  this spec fits inside it, §7 below), banding §16.5.
- Eval-gen spec rev 2 (`2026-09-07-eval-gen.md`): generation is local, on the
  member's subscription, never in CI; `command_succeeds` stays out of the generated
  whitelist (§6.3 there; this spec does not lift it).
- Head-to-head spec rev 1 (`2026-09-09-eval-head-to-head.md`): unbuilt; §6 and §8
  below hand it the comparison this spec cannot make.

Code anchors are against `origin/main` at `d5431ee8`. The checkout this was written
from (`feat/frame-mode`) lags the eval module by ~2,300 lines; build from a worktree
off `origin/main`.

## 1. Problem and evidence

Two measured runs on 2026-09-15 and 2026-09-16 (run trees under
`~/.terum/skills/evals/local/`) show the same failure from opposite directions:

- **Five effort levels of a copied built-in reviewer read as one prompt.** Copies of
  Claude Code 2.1.273's `/code-review` at low, medium, high, xhigh and max, evaluated
  on the same six generated cases (k=3, sonnet), all banded NEUTRAL with candidate
  arm scores 0.88–0.93 against a 0.90 baseline. Every non-tie traced to two checks
  (`command_matching: git diff` missing `git -C <sandbox> diff`; an exact code
  fragment the model paraphrased). No check asked whether the review found the bug.
  The candidate arms never called the Agent tool: the fan-out was skipped by the
  model on two-line diffs, and no effort flag reached the model.
- **hybrid-review PASSes without ever reviewing.** Seven authored protocol cases
  (`.claude/skills/hybrid-review/evals/cases/`), 12 wins / 0 losses / 9 ties, arm
  scores 0.35 → 0.88, sign p = 0.0005. Every winning check is a phrase from the
  SKILL.md ("codex login status", "no-op", "rate_limits", "OFF-STANDARD"). The
  candidate's launch of the workflow engine failed with
  `Workflow script file not found: .claude/workflows/ultrareview.js`; no finder, no
  Codex verifier, no finding ran. The baseline lost by answering "I don't see a
  hybrid-review skill" in one turn.

Root causes, each addressed by one section below:

| Cause | Where | Fix |
|---|---|---|
| A heavy skill cannot finish inside the 10-minute / 25-turn session cap; a killed candidate is scored as a **loss** | `agent.ts:18,206`; `execution.ts:375` | §2.1, §2.2 |
| No check can penalise a wrong finding | `checks.ts` CHECKS table | §2.3 |
| Measuring N defects costs N sessions per arm; a row is all-or-nothing so one N-defect case reads as a tie | `execution.ts:378-380` | §3 |
| The generator writes phrase checks because its prompt describes nothing else | `generate.ts:192` | §4 |
| Nothing tells the runner a skill is expensive before it runs it N times | `commands/eval.ts` | §5 |
| hybrid-review's sandbox lacks its engine, though the SKILL.md names the script | `seedSandbox` | §6.1, §6.2 |

## 2. Engine fixes (stand alone; ship first)

### 2.1 Session cap: two hours, no retry on timeout — **locked**

- `DEFAULT_TIMEOUT_MS` (`agent.ts:18`) becomes `7_200_000`. `--max-turns`
  (`agent.ts:206`) default rises to `200` **[veto cheap]**; an orchestrator's
  Workflow launch is one turn, but its inline fallback is not.
- `runCase` passes `timeoutMs` and `maxTurns` through the `RunAgentOptions` it
  already accepts (`execution.ts:292` passes only `transcriptPath` and `model` today).
  A case or suite may set `timeout_minutes` (≤ 120) and `max_turns` **[veto cheap]**.
- `AgentRunError` gains a subclass `AgentTimeoutError`, thrown at `agent.ts:195`.
  The retry loop (`execution.ts:289-302`) retries **crashes only**; a timeout is
  final. Rationale: rev 7's retry exists for infra flakes; a two-hour timeout that
  retries costs four hours and double tokens for a deterministic failure.
- `--append-system-prompt` HEADLESS_NOTE unchanged.

### 2.2 Dead arm is unscored, not a verdict — **locked**, revises §7.1

Today (`execution.ts:374-376`): both null → `both-arms-failed` tie (a hole);
candidate null → **loss**; opponent null → **win**. Only `both-arms-failed` rows are
excluded from `scored_rows` (`results.ts:82`).

New rule. *Dead* = no transcript: killed by the cap or exited non-zero.

- candidate null, opponent present → outcome `tie`, `decided_by: candidate-run-failed`,
  **unscored**.
- opponent null, candidate present → `tie`, `opponent-run-failed`, **unscored**.
- both null → unchanged.
- `results.ts:82`: `scored` excludes every `*-run-failed` row. `execution_status`
  and the verdict band (`stats.ts:34`) see scored rows only. The grey suffix the
  verdict line already prints (`[partial — 14/21 scored]`) is the user-visible signal.

Boundary, **locked**: a session that exits cleanly having asked a question **has a
transcript**. Its checks fail, and that is a real loss. Rev 7's finding (the
balk-and-ask death was the dominant noise source) still holds for that shape; it does
not hold for a kill or a crash, which say nothing about the skill.

Receipt impact: `case_runs[].outcomes` is an enum of win/loss/tie
(`receipt.ts:58`). Unscored rows are **omitted** from `case_runs` and counted in
`expected_rows − scored_rows`. No schema change.

### 2.3 Sixth transcript check: `transcript_omits`

Mirror of `transcript_mentions` in the CHECKS table: pass = the case-insensitive
substring never appears in the transcript's text. Added to the generator whitelist
(`generate.ts:17`). This is the precision half of every reviewer case: a distractor
the skill must *not* flag.

## 3. Suite: one session per arm, one row per sub-case

### 3.1 Why a new asset

A case is one task, one sandbox, one session per arm, one row. Ten planted defects
as ten cases cost ten sessions per arm. Ten defects as ten checks in one case cost
one session but read as a **tie** whenever neither arm passes all ten
(`execution.ts:378-380`, §5.1 all-or-nothing). The suite keeps the one session and
makes each defect its own row.

### 3.2 Asset: `evals/suite.yaml`

```yaml
# generated by terum-skills eval-gen — review before trusting   (when generated)
task: Review the uncommitted diff in this repository before I commit it.
files:            # inline seeds, or
fixture: ../fixtures/pricing-repo     # a directory relative to this file
setup: |          # /bin/sh -ce, 60 s cap, non-zero aborts the suite (unscored)
  git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base
  sh .probes/run.sh expect-pass && git apply .plants.diff && sh .probes/run.sh expect-fail
  rm -rf .probes .plants.diff
requires: []      # host tools, e.g. [codex]; probed once per suite (§4.3 rev 8)
timeout_minutes: 120
cases:            # each is a ROW; name is the per-case key in the receipt
  - name: sign-flip-applyDiscount
    checks: [{ transcript_mentions: applyDiscount }]
  - name: off-by-one-pricing-42
    checks: [{ transcript_mentions: "pricing.ts:42" }]
  - name: distractor-roundHalfUp
    checks: [{ transcript_omits: roundHalfUp }]
```

Shared fields validate through the existing `loadCase` path; each sub-case's `checks`
validate through the existing check parser. No `judge` field on sub-cases (§3.4). A
skill may carry `evals/cases/*.yaml` **and** `evals/suite.yaml`; both run.

### 3.3 Runner: `runSuite` beside `runCase` (`execution.ts`)

Per rep: probe `requires` once → for each arm: `seedSandbox` once (suite file is in
`evals/`, which staging already excludes — the answer key never enters the sandbox,
§4.3) → one `runAgent` → §7.3 contamination check unchanged → for each sub-case:
`runChecks(sub.checks, transcript ?? emptyTranscript, sandbox)` → `decide()` per
sub-case with the §2.2 rule → one `ComparisonRow` per (sub-case × opponent).

- **Samples.** One `ArmSample` per sub-case per arm, carrying that sub-case's
  `fraction` and the **session's** efficiency copied onto each. The per-arm mean of
  identical values is the session's cost, so `efficiency` stays correct (§7).
- **Dead session.** `transcript === null` for an arm → every sub-case row for that
  arm is unscored at once (§2.2).
- **Transcripts** are named `<suite>.<arm>.<rep>.jsonl`; the retry-rename path uses
  the same stem.
- **Judge off** (§3.4).

### 3.4 What the suite does not do

- No per-sub-case judge: a per-defect rubric has nothing to decide that the anchor
  does not. A suite-level rubric is **deferred** (§8).
- No parallelism: arms and reps stay sequential, as everywhere in the engine.
- No change to `runCase`, to light skills, or to how a case is read.

### 3.5 Command wiring (`commands/eval.ts`)

- `plannedGeneration` (`eval.ts:384-391`) keys off `authoredCaseFiles.length === 0`.
  A suite **counts as an authored case asset**; otherwise a suite-only skill gets
  three generated cases stacked on top. This is the one silent trap in the chunk.
- `expected_rows = Σ suites (sub-cases × k × opponents) + Σ cases (k × opponents)`.
- `provenance.cases` lists the **suite name once**, not its sub-cases (§7).

## 4. Ground-truth generation (eval-gen mode 2)

**Runs for every skill** that has no authored assets (or under `--gen`), replacing
today's case prompt. The heavy flag (§5) decides sessions and the notice, **not**
what gets generated — Ryan, 2026-09-15: "the new generator prompt should run for all
skills".

### 4.0 Which skills get a repository

The generator decides the **shape** from what the skill acts on, in this order:

| The skill… | World the generator builds | Shape | Row = |
|---|---|---|---|
| reviews or fixes code | a repository with planted defects and one distractor | **suite** (§3) | one defect |
| audits a spec or document | a spec with planted contradictions, a stale claim against seeded code, one unusual-but-correct clause | suite | one planted fault |
| summarises or hands off a session | a fabricated session log placed as a file, with decisions that must appear and ones that must not be invented | suite | one fact |
| answers from its own knowledge | nothing seeded; the SKILL.md is the world | cases with `transcript_mentions` + `transcript_omits` | one question |
| behaves differently by how it is asked (flags, refusals, protocol steps, CLI wrappers) | nothing seeded, or a one-line file | **cases** as today, one per behaviour | one behaviour |
| produces judgment output (design, readability) | a rubric, not a fact | cases with `judge` | one rubric |

Rule stated to the model: *if you can write a hidden ground truth the skill must
recover, and a literal identifier a correct output must cite, build that world and
emit a suite; if the skill's behaviour depends on how it is asked, emit one case per
behaviour; if neither, emit cases with a short rubric.* The validator enforces
whichever shape returns. Author override: `metadata.eval.shape: suite|cases`
**[veto cheap]**. A rulebook skill still gets rulebook cases — that is the right
measurement for it.

The rest of §4 describes the suite shape for the first three rows; the case shape is
eval-gen rev 2 unchanged plus the sixth check kind.

**Prompt contract.** From the SKILL.md alone, write: a small repository (3–6 files)
as inline `files`; a clean base; a patch `.plants.diff` introducing **2–6 real
defects across ≥ 2 files** plus **exactly one distractor** (code that looks wrong
and is correct); one sub-case per defect with a `transcript_mentions` anchor that a
finding must cite (an identifier or `file:line`, never prose); one sub-case for the
distractor with `transcript_omits`; and per defect a **probe** under `.probes/` that
exits 0 on the base and non-zero after the patch. Defect count must stay below any
finding cap the SKILL.md states (the built-in reviewer caps at 8 on medium).

**Self-validation, built into `setup`.** Commit base → run probes expecting pass →
apply patch → run probes expecting fail → delete `.probes/` and `.plants.diff`. A
probe that disagrees makes setup exit non-zero, and a failed setup is already an
unscored abort (`execution.ts` catch on `setup failed`). A fake bug therefore
**aborts** the suite instead of poisoning both arms. This is why the
`command_succeeds` exclusion (eval-gen §6.3) can stand: the generator writes probes
that run *before* any arm, not verifiers that score arms.

**Validator** (extends `validateCases`): ≥ 2 defect sub-cases, exactly 1 distractor
sub-case, non-empty `files`, `setup` contains `git init`, every anchor non-empty,
checks within the whitelist (now six kinds), no `judge`. Two correction re-asks then
fail, as today. Output size may force **one model call per suite**; the existing
`GENERATION_TIMEOUT_MS` applies.

**Human review** stays the contract: the header comment, the printed path, and
commit only through the existing author flow (eval-gen rev 2). Nothing here writes
the skill silently.

### 4.1 The prompt (`suitePrompt`, sibling of `casePrompt` in `generate.ts`)

The model returns the repository, the patch, the probes, and the sub-cases. **The
engine composes `setup` itself** (below); the model never writes shell that runs
against an arm.

```
Generate evaluation assets for this Claude Code skill so that running it measures
whether the skill does its job, not whether it restates its instructions.

First decide the SHAPE. If you can build a world containing a hidden ground truth the
skill must recover (a repository with planted defects for a reviewer or fixer, a spec
with planted contradictions for an auditor, a session log with facts that must and
must not appear for a summariser), and can name a literal identifier a correct output
must cite, return {"suite": ...} as below. If the skill's behaviour depends on how it
is asked (flags, refusals, protocol steps, wrapping a command), return {"cases": [...]}
in the case shape instead, one case per behaviour. If neither, return cases with a
short "judge" rubric each.

Suite shape — a repository is the example; a spec or log is a single file in files/
with the same rules:

{"suite": {
  "task": "one headlessly answerable instruction, e.g. 'Review the uncommitted diff in this repository before I commit it.'",
  "files": { "<path>": "<full file contents>", ... },
  "plants_diff": "<a unified diff that applies cleanly to files/ with `git apply`>",
  "probes": { "<name>": "<shell command, exit 0 on the clean base and non-zero after plants_diff is applied>", ... },
  "cases": [
    { "name": "lowercase-hyphenated-stem", "kind": "defect", "probe": "<probe name>",
      "checks": [ { "transcript_mentions": "<identifier or file:line a correct finding must cite>" } ] },
    { "name": "lowercase-hyphenated-stem", "kind": "distractor",
      "checks": [ { "transcript_omits": "<identifier of the correct code that looks wrong>" } ] }
  ]
}}

Rules.
- The repository: 3 to 6 source files in one language, realistic enough that a
  reviewer must read call sites to judge a change. No package installs; anything the
  probes run must work with the language's standard toolchain already on PATH.
- The defects: between 2 and 6, spread across at least 2 files, each a genuine bug a
  maintainer would fix (wrong sign, off-by-one, broken caller contract, unchecked
  null, swapped arguments, stale invariant). No style issues, no "could be clearer".
  If the SKILL.md states a maximum number of findings, plant fewer than that.
- Exactly one distractor: a change in plants_diff that looks wrong at a glance and is
  correct. Its case uses transcript_omits on an identifier only that change touches.
- Anchors: every defect case's transcript_mentions is an identifier (function, variable,
  constant) or a file:line that a finding about that defect would have to cite. Never
  prose, never a sentence the skill might paraphrase.
- Probes: one per defect. Each is a shell command that exits 0 on the clean base and
  non-zero once plants_diff is applied, proving the defect is real and observable.
  Keep them to one line; `node -e`, `python3 -c`, or a direct test runner call.
- plants_diff must apply with `git apply` to files/ exactly as given. Do not include
  the probes or the diff itself inside files/.
- The task must be answerable with no human follow-up and must not tell the agent
  what to look for.
- Checks may use ONLY transcript_mentions and transcript_omits.
- Do not include fixture, setup, judge, or bucket; the engine writes setup itself.

SKILL.md:
<full SKILL.md>

CANDIDATE FILE LISTING (names only):
<file names>
```

**Engine-composed `setup`** (written into the suite file by the validator; probes land
under `.probes/<name>` with 0755, the diff as `.plants.diff`):

```
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm base
for p in .probes/*; do sh "$p" || exit 1; done
git apply .plants.diff
for p in .probes/*; do if sh "$p"; then exit 1; fi; done
rm -rf .probes .plants.diff
```

A probe that fails on the base, or passes after the patch, exits setup non-zero and
the suite aborts unscored. This is the self-validation, and the reason eval-gen §6.3's
`command_succeeds` exclusion stands: probes run before any arm, never against one.

**Validator additions** (over today's `validateCases`): 2–6 `defect` cases and exactly
one `distractor`; every defect names an existing probe; `plants_diff` applies to
`files` in a temp directory **during validation**; checks limited to the two kinds
above; anchors non-empty; no extra fields; then the suite is materialized to
`suite.yaml` with the composed `setup`. Two correction re-asks, then fail with the
last error.

**Expected iteration.** Probes that test the wrong thing are caught by the setup gate
at the price of a regenerate. "Realistic enough that a reviewer must read call sites"
is the instruction most likely to be under-delivered — the 2026-09-15 runs showed the
model defaults to two-line diffs. Exit criterion: a reviewed generated suite that
separates a code-review copy from baseline.

## 5. Heavy-skill detection, mode choice, notice

**Detection.** Heavy decides sessions and the notice only; it never decides what is
generated (§4.0).
- *First run, static scan:* the SKILL.md **or any file in the skill folder** names the
  `Agent`, `Task`, or `Workflow` tool, or contains `codex exec` or `claude -p` → heavy.
  The scan is exact for every skill in this team; its one blind spot is a skill that
  fans out through a script it never names. The confirm prompt prints the evidence
  line (e.g. "SKILL.md names the Workflow tool and .claude/workflows/ultrareview.js")
  so a wrong call is visible before anything runs. Author override:
  `metadata.eval.heavy: true|false` in frontmatter **[veto cheap]**.
- *Every run, observed:* a `Transcript.toolUses(): string[]` helper (beside
  `bashCommands()`, `agent.ts:76`) collects tool-use names; `spawns_agents` = any of
  `Task|Agent|Workflow`, or a Bash command matching `/\bcodex\b|claude -p/`. Recorded
  in the **local run record** (`run.jsonl` meta), not the receipt, so no schema change.
  From the second run the mode is measured, not guessed.

**Mode choice.** Heavy → k=1 by default and the notice below; the assets are whatever
§4.0 produced (a heavy reviewer gets a suite because it reviews, not because it is
heavy). A heavy skill whose assets are *cases* still runs one session per case, and
the notice's X is the case count. The runner asks:
- CLI: `io.confirm` with the guess as default; on a non-interactive channel without
  `--heavy` / `--no-heavy` **[veto cheap]** the run is refused with the head-to-head
  spec's `PromptClosedError` wording.
- Desktop: a checkbox in the existing pre-run dialog (`EvalRunDialogHost.tsx`),
  reusing `estimateFromReceipts` for the cost line. **Teddy's side.**

**Notice, final copy — locked text, one clause held:**

```
This skill appears to call subagents, which can be expensive. Instead of
running it once per case, this evaluation runs one session with the skill
and one without, against a single fixture with many checks, to limit usage
and wall-clock time. The verdict therefore rests on one session and will
vary more between runs. To reduce variance, uncheck the box below; that
runs the skill X times in sequence. If the run is interrupted or your
usage runs out, it is marked unscored and must be run again.
```

Held: a "computer goes to sleep" clause is **out until tested** (whether the session
timer counts sleep on macOS is unverified). The contact line is an open question
(§11).

## 6. Repo-script skills: dependency staging and the hybrid-review suite

Some skills do not do their work in the agent's context. Their SKILL.md tells the
agent to call the Workflow tool on a script that lives in the **repository**, not in
the skill folder (`hybrid-review`, `ultrareview`, `harden`; the Codex-side skills
read `.claude/codex/` the same way). The eval sandbox holds only the skill folder and
the case's seeds, so the call dies with `Workflow script file not found` and the
skill degrades to prose — the 2026-09-16 run in §1. The path is right there in the
SKILL.md; the engine can stage it. Ryan, 2026-09-15: *"if the skill.md calls
workflow, shouldn't we be able to access that workflow script? it's in the skill.md"*.

### 6.1 Dependency staging (chunk 8) — engine

**Scan.** After hygiene, scan the SKILL.md body for repo-relative path tokens
(`[\w.-]+(/[\w.-]+)+`, no leading `/`, no `..`). Keep each token that resolves to an
existing file or directory under the **eval's repo root** and lies **outside the
skill folder** (inside is already copied). Repo root: for a local or `--working`
skill, the nearest `.git` ancestor of the skill folder; for a team-library skill,
the `.git` ancestor of the eval's cwd **[veto cheap]**.

**Stage.** In `seedSandbox`, after skill staging, for each kept path: a directory is
copied whole; a file is copied, and if it is a script (`.js .mjs .cjs .ts .sh .py`)
its **parent directory** is copied too (workflow engines import sibling helpers).
Always excluded: `node_modules`, `.git`, `__tests__`, anything the token itself does
not name. Total staged bytes capped at 20 MB **[veto cheap]**; over the cap the run
prints the offending path and stages nothing from it. Staged into **candidate and
incumbent arms only** — the files are the skill's method; §7.1's "baseline stages
nothing" stands.

**Record.** `run.jsonl` meta gains `staged_dependencies: string[]`; the run prints
one line per staged path. No receipt change. A token that resolves nowhere prints
`SKILL.md references <path>, which is not present here; the skill may not run` and
is recorded under `missing_dependencies` — the honest result for a teammate who
installed a skill whose method never travelled with it.

**Hygiene warning HYG7 [veto cheap]** — warning tier, like rev 16's HYG6: *"this
skill references N repository paths outside its folder; it depends on files it does
not carry"*. Printed by validate, share, publish, and eval; gates nothing. The
author's fix is to move the script into the skill folder and reference it there —
the Workflow tool accepts any in-repo path — after which the ordinary folder copy
stages everything and the scan finds nothing to add.

**Not done here:** import-following beyond the parent directory; staging into the
baseline arm; any change to the §7.3 contamination check (it asserts skill-list
membership, not files).

### 6.2 Authored hybrid-review suite (chunk 7) — assets only

With §6.1, the fixture no longer carries the engine. Under
`.claude/skills/hybrid-review/evals/`:
- `fixtures/review-repo/` — a multi-file repository (5–8 files, two modules that
  call each other) on `main`, with a branch carrying a planted diff: 3–5 defects
  across ≥ 2 files including one broken caller contract, plus one distractor. Big
  enough that the finders fan out; §1 shows two-line diffs never trigger it.
- `suite.yaml` — `requires: [codex]`, `timeout_minutes: 120`, one sub-case per
  defect (anchor = identifier or `file:line`), one distractor (`transcript_omits`).

The workflow script and its directory are staged by §6.1 from the SKILL.md's own
reference; the sandbox inherits `PATH` and `HOME` (`agent.ts` spawn env) so the
Codex binary and login are reachable; `requires` skips the suite cleanly elsewhere.
No staleness: the current script is copied at run time.

What this measures: hybrid-review's finders and Codex panel on a real diff, against
a bare agent. What it cannot measure: whether the Codex panel beats the Claude panel.
That is ultrareview-vs-hybrid-review on the **same suite**, the head-to-head spec's
job (§8). Proof of life for the chunk: the candidate transcript shows a Workflow
launch and a `codex exec` command, and at least one row is scored.

## 7. Receipt and app: no schema change, three conventions

The suite fits receipt schema v2 as is:

| Field | Convention | Why it stays honest |
|---|---|---|
| `case_runs[]` / `per_case` | one entry per **sub-case**, `rep` as usual | the app's per-case table shows one row per defect |
| `arm_scores` | mean over sub-case samples | reads as the share of defects caught |
| `comparisons.*.sign_p` | **1.0** for any run containing a suite | rows from one session are not independent; p = 1 says "no evidence to reject" |
| `efficiency` | per-arm mean of the session's cost copied onto each sub-case sample | equals the session's cost |
| `provenance.cases` | the **suite name once** | `estimate.ts` multiplies per-arm means by `cases.length × k`; one suite = one session |

The tell that a receipt came from a suite is `provenance.cases.length <
Object.keys(per_case).length`. An optional `sessions` field is the clean form and is
one additive line (the v1→v2 precedent added `content_digest` the same way); it lands
**only after Teddy confirms the app tolerates an unknown optional field** (§11).

## 8. What this spec deliberately does not do

- **No head-to-head.** ultrareview-vs-hybrid-review on one suite is the comparison
  that answers "does the Codex panel earn its cost". It needs the head-to-head spec's
  per-arm skill identity (HH1). This spec makes the suite; that spec runs two skills
  on it.
- **No scripted human.** A resume loop that answers an agent's question from a
  case-supplied script would unblock "asks before acting" cases. Bug risk 3 (touches
  the trust boundary), difficulty 3. Deferred.
- **No per-arm effort flag.** Only the built-in copies care. Deferred.
- **No lifting of `command_succeeds` from the generated whitelist.** §4's probes run
  in setup, before any arm; verifiers that score arms stay authored-only.
- **No change to light skills.** `runCase`, the case schema, and the phrase checks are
  untouched; a rulebook skill is still measured as a rulebook.
- **No MCP in the sandbox.** Arms run with `--strict-mcp-config`; a skill whose
  method is calling Terum's tools cannot be measured by this engine. Named, not
  addressed.
- **No parallelism.** The engine stays sequential at every level.

## 9. Build order and exit

| # | Chunk | Necessity | Bug risk | Difficulty | Depends on | Exit |
|---|---|---|---|---|---|---|
| 1 | §2.1 cap + no timeout retry | 3 | 1 | 0 | — | a 15-minute fake skill completes; a timeout is not retried |
| 2 | §2.2 dead arm unscored | 3 | 1 | 1 | — | `decide` tests: null candidate → unscored; question-ending transcript → loss |
| 3 | §2.3 `transcript_omits` | 3 | 0 | 0 | — | check test + whitelist test |
| 4 | §3 suite runner + wiring | 3 | 1 | 1 | 2 | suite-only skill generates nothing; dead session empties all sub-cases; receipt validates under v2 |
| 5 | §5 detection + notice | 2 | 1 | 1 | 4 | static + observed flags agree on hybrid-review; refusal on closed prompt |
| 6 | §4 ground-truth generation | 4 | 2 | 3 | 3, 4 | shape decision matches §4.0 on the eleven harness skills; a generated suite whose probe disagrees aborts setup; a reviewed suite runs on a code-review copy and separates it from baseline |
| 8 | §6.1 dependency staging + HYG7 | 4 | 1 | 1 | — | hybrid-review candidate arm launches the Workflow tool in a sandbox seeded from a bare case; a missing path prints and is recorded; a skill referencing nothing stages nothing |
| 7 | §6.2 hybrid-review suite (assets only) | 4 | 0 | 2 | 1, 2, 4, 8 | candidate transcript shows Workflow launch + `codex exec`; at least one row scored |

Scores: Necessity to the North Star, Bug risk, Difficulty (incl. how cloudy), each
0–4, never summed. Chunks 1–3, the CLI half of 5, and 8 are one PR (all small, all
on the launcher / seeder / command). 7 is data, not code: authored once 4 fixes the
file shape, proven by one real run.

## 10. Defaults chosen here [veto cheap]

1. `--max-turns` default 200.
2. Per-case/suite `timeout_minutes` (≤ 120) and `max_turns` fields.
3. Overrides live in SKILL.md frontmatter: `metadata.eval.heavy` (sessions) and
   `metadata.eval.shape: suite|cases` (what is generated). The two are independent.
4. CLI flags `--heavy` / `--no-heavy` for non-interactive channels. Mode 2 is the
   generator for every skill; there is no flag to select it.
5. Suite mode default k = 1; the notice's checkbox is k-per-case mode with the
   skill's authored/generated cases.
6. Generated suite: 2–6 defects, exactly 1 distractor, 3–6 files.
7. Dependency staging (§6.1): repo root = `.git` ancestor of the skill folder, else
   of the cwd; script files bring their parent directory; 20 MB cap; candidate and
   incumbent arms only; HYG7 is warning tier.
8. `spawns_agents`, `staged_dependencies`, `missing_dependencies` recorded in
   `run.jsonl` meta, not the receipt.

## 11. Open questions (need a human)

1. **Teddy:** does the desktop cross-check `provenance.cases` against `per_case`
   keys, and does its receipt parser tolerate an unknown optional `sessions` field?
   Gates §7's clean form and the suite's per-case display.
2. **Ryan:** the notice's contact line. The draft text carried a personal phone
   number; the CLI is open source and prints this text to every user. Team contact,
   repo issues, or the number — decide before §5 ships. The number is deliberately
   not recorded in this file.
3. **Unverified:** whether the session timer counts macOS sleep. Test before adding
   the sleep clause to the notice.
4. **Unproven:** whether sonnet writes reliable probes (§4). The first generated
   suite is the test; expect prompt iterations, each one generation call.
