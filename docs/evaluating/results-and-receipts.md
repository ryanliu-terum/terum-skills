# Results and receipts

An eval ends with a printed report, a receipt on this machine, and a run tree you can open. This
page is what each number means and where it goes.

## The printed report

The report is written in this order. Sections with nothing to say are omitted.

```
verdict: PASS
why: wins on execution checks; 2 ties
skipped (environment): hybrid-review — missing codex
dropped (setup): seeded-repo — setup failed (rc=1): fatal: not a git repository
candidate-vs-baseline: +44% net lift (5W / 1L / 3T over 9 comparisons, sign test p=0.219)
candidate-vs-incumbent: +11% net lift (2W / 1L / 6T over 9 comparisons, sign test p=1.000)
arm scores: baseline 0.61 · candidate 0.82 · incumbent 0.74
case-runs passed: baseline 2/9 · candidate 5/9 · incumbent 4/9
triggers: recall=1.00 precision=0.83 (tp=5 fn=0 fp=1 tn=5)
  FALSE-FIRE: "rename this variable"
efficiency: baseline 3.0 turns · 22.8s · $0.11 | candidate 5.0 turns · 41.2s · $0.20 | incumbent 4.0 turns · 33.0s · $0.15
```

Arms appear in the order they ran: baseline, candidate, then incumbent when there is one.

| Line | What it says |
| --- | --- |
| `verdict:` | `PASS`, `NEUTRAL` or `FAIL`, banded on the candidate-vs-baseline comparison alone. An incomplete run appends `[partial — 5/9 scored]` or `[failed — 0/9 scored]`. |
| `why:` | One deterministic sentence, no model involved, built from what decided the baseline rows. |
| `skipped (environment):` | One line per case whose `requires` probe found something missing. |
| `dropped (setup\|staging):` | One line per case that never started, with the reason. |
| `candidate-vs-<arm>:` | One per comparison. Net lift as whole percent, the W/L/T record, the total, and the sign-test p to three decimals. |
| `arm scores:` | Per arm, the mean fraction of checks passed, or `n/a`. |
| `case-runs passed:` | Per arm, how many case-runs passed every check, over the case-runs where that can be said. |
| `triggers:` | Recall, precision and the four counts, then one line per prompt that went the wrong way. |
| `efficiency:` | Per arm, the mean turns, wall-clock seconds and dollars. |

There is no per-case table in the terminal report. The per-case rows are in the receipt, and the app
draws them.

The last line the verb prints is about sharing. When the evaluated bytes are already a published
version, the receipt is committed and the line is

```
Published this receipt to myteam for Version 3 of deploy-check.
```

Otherwise, when this machine has a team and a handle, there were results, and you did not pass
`--no-commit`:

```
These bytes are not a published version, so nothing was shared. To share these results, publish the skill again: npx -y terum-skills@latest publish deploy-check
```

and on a `FAIL` verdict, the same first sentence followed by

```
This run's verdict is FAIL: evaluate a fix rather than publishing these bytes — npx -y terum-skills@latest publish deploy-check asks before it publishes a failed verdict.
```

A commit that fails is reported and never turns a finished run into a failed one: `The eval is
complete and saved locally, but publishing its receipt failed: <reason>`.

## How one row is decided

A comparison row exists for each (case × repetition × opponent). The decision is taken in this
order and stops at the first rule that fires.

| Rule | Outcome | `decided_by` |
| --- | --- | --- |
| Both arms died | tie | `both-arms-failed` |
| The candidate died | tie | `candidate-run-failed` |
| The opponent died | tie | `opponent-run-failed` |
| One arm passed every check and the other did not | win or loss | `checks` |
| Both arms have the same all-or-nothing check result, and the case has no `judge` rubric | tie | `checks-equal-no-judge` |
| Both the same, and the case has a `judge` rubric | the judge's answer | `judge`, or a judge failure label |

Checks are all-or-nothing per arm: an arm passes only when every one of its checks passed. A case
with no checks makes both arms vacuously equal, so it falls through to the judge or to a tie.

A suite never reaches the judge. Its shared fields are parsed as a case, but `judge` is stripped, so
an equal suite row is always `checks-equal-no-judge`.

### The judge

The judge is only ever asked about a case the checks could not separate, and only when that case
carries a `judge` rubric. It is a single-turn, tool-free model call that sees four things: the task
both arms were given, the rubric, and the **last 6,000 characters** of each transcript's text. It
does not see the sandbox, the skill, the check results, or which arm is which. The arms are labelled
A and B.

Its prompt opens:

> You are judging two AI agent transcripts for the same task. Decide which one better satisfies the
> rubric. Be strict; "tie" is a valid answer when neither is clearly better.

It must answer `{"winner": "A" | "B" | "tie", "reason": "<one sentence>"}`.

**Every judged row is asked twice**, once in each A/B ordering. Agreement between the two orderings
is the verdict. Disagreement is discarded as position bias: the row becomes a tie with
`decided_by: judge-split` and the reason `orderings disagree (left vs right) — position-sensitive
verdict discarded`. Which ordering went first is drawn from a seeded generator (mulberry32, seed 0,
created once per run), so a run tree is reproducible.

Each ask walks an escalation chain of three attempts: the judge model, the judge model again, then
`opus`, with a short backoff between them. An unparsable or invalid `winner` retries down the chain.
A refusal that matches the usage-policy pattern returns immediately as `judge-refused` with no retry.
A network-shaped error counts toward the network tally. An exhausted chain is `judge-network-error`
when every attempt was a network failure, otherwise `judge-unparseable`. A failure on the first ask
skips the second. **Every judge outcome that is not `judge` forces the row to a tie.**

The judge model is `--judge-model`, else `--model`, else `sonnet`. The escalation model is `opus`
and is not configurable from the CLI.

## The numbers

**Net lift** is `(wins − losses) / (wins + losses + ties)` over the scored rows of one comparison,
0 when there are none. Ties are in the denominator, so they dilute: five wins and five ties is
+50%, not +100%.

**`sign_p`** is a two-sided exact sign test over the decisive rows only. With `n = wins + losses`
and `k = min(wins, losses)`, it is `min(1, 2·Σ C(n,i) for i ≤ k / 2ⁿ)`, and 1.0 when `n = 0`. It
answers one question: if the candidate and the opponent were equally good, how often would a split
this lopsided happen by chance. Ties are excluded from it entirely. With the default `k = 1` and a
handful of cases, it will rarely be small; `--k 3` or more is what makes it worth reading.

**`sign_p` is forced to 1.0 for every comparison in a receipt where a suite session ran.** A suite's
rows come from one shared agent session per arm, so they are not independent observations and a
sign test over them would be false precision. The other numbers stand.

The printed `candidate-vs-…` line does not read that field. It recomputes the sign test from the
W/L/T counts, so after a suite run the report shows a p the receipt does not carry. Trust the
receipt.

**The verdict** bands the candidate-vs-baseline comparison and nothing else:

| Verdict | Condition |
| --- | --- |
| `PASS` | net lift ≥ +1/3 |
| `FAIL` | net lift ≤ −1/3 |
| `NEUTRAL` | anything between, including no candidate-vs-baseline comparison at all |

The comparison is done in integers (`3·(W−L) ≥ W+L+T`) so the ±1/3 boundaries are exact.

**Arm scores** are, per arm, the mean of that arm's check-pass fraction across the scored,
non-failed samples. A case with no checks contributes nothing, so an arm whose cases all lack checks
scores `null` and prints `n/a`.

**Case-runs passed** is per arm, over the (case × repetition) entries where that arm's verdict can be
said: passed means every check passed. An arm that died twice, and a case with no checks, are neither
passed nor counted in the total. This is the number the app calls Quality.

**Efficiency** is, per arm, the arithmetic mean of turns, duration and cost across the same scored,
non-failed samples, each averaged independently over its non-null values. All three come from the
`result` event of the headless session's own stream: `num_turns`, `duration_ms`, and
`total_cost_usd` falling back to `cost_usd`. **The engine computes no cost of its own.** The dollars
are whatever Claude Code reported for that session; a missing or non-finite value becomes null rather
than zero.

**k > 1 does not roll up.** There is no per-case aggregation. Each (case, repetition) contributes its
own independent row to the W/L/T counts and its own sample to the means. `--k 3` over three cases is
nine rows per opponent, not three.

**Partial receipts.** `expected_rows` is `(selected cases + suite sub-cases) × k × opponents`,
counted before any requirement probe or setup failure. `scored_rows` is how many rows survived to be
counted. Three states:

| `execution_status` | When |
| --- | --- |
| `complete` | Every expected row was scored, or none was expected |
| `partial` | Some were scored, fewer than expected |
| `failed` | Rows were expected and none was scored |

The gap is named, not averaged away. A case skipped for a missing tool is in `environment_skips`; a
case that never started is in `dropped_cases` with `setup` or `staging` and a detail; a dead arm
appears in neither and shows only as the arithmetic difference. No unscored hole is ever counted as a
zero.

## The receipt

One JSON file per run. Schema version 2; schema 1 is read-only history. Every level is permissive
about unknown fields, so a newer receipt still parses on an older reader.

| Field | Meaning |
| --- | --- |
| `schema_version` | `1` or `2`. A schema-2 receipt must carry `content_digest`. |
| `skill_id` | The folder's declared `metadata.id`, or `null`. A committed receipt is never null. |
| `skill_name` | The folder name. |
| `version` | `v3`, a legacy 40-hex value, or `null`. **Null is the normal state of a local run**: a local eval happens before the bytes have a version number. |
| `content_digest` | `sha256:…` over the folder as it was evaluated, by the same function publish uses. Eval assets are excluded from it. |
| `run_id` | A UTC timestamp, `YYYYMMDDTHHMMSSZ`, so lexicographic order is chronological. |
| `verdict` | `PASS`, `NEUTRAL` or `FAIL`. |
| `attribution` | The `why:` line. |
| `execution_status` | `complete`, `partial` or `failed`. |
| `expected_rows` / `scored_rows` | The coverage pair above. |
| `comparisons` | `candidate-vs-baseline` and, when there was an incumbent, `candidate-vs-incumbent`. Each is `{win, loss, tie, net_lift, sign_p}`. |
| `arm_scores` | Arm → mean check fraction, or null. |
| `environment_skips` | Case → the requirements that were missing. Optional. |
| `dropped_cases` | Case → `{kind: setup\|staging, detail}`. Optional. |
| `per_case` | One entry per (case × repetition): each arm's `passed` verdict and its `[name, passed]` check list, plus each comparison's outcome. Display only; no statistic reads it. Optional. |
| `case_runs` | Arm → `{passed, total}`. Optional. |
| `triggers` | `{recall, precision, tp, fn, fp, tn}`, or `null` when no trigger evaluation ran. |
| `efficiency` | Arm → `{turns, duration_ms, cost_usd}`, each nullable. |
| `provenance` | See below. |

`provenance` records who and what produced the numbers:

| Field | Value |
| --- | --- |
| `runner_handle` | Your team handle, or the literal `local` when this machine holds no team binding. |
| `engine_version` | The running terum-skills package version. |
| `engine_commit` | The 12-character commit of the running package, only when that package root is itself a git toplevel. Otherwise the literal `unknown`. |
| `cc_version` | Whatever `claude --version` printed at preflight. |
| `model` / `judge_model` | The **requested aliases**, `sonnet` and so on, not the model ids that were resolved. The resolved id floats day to day; it is recorded per arm in the run tree's `run.jsonl` and is deliberately not a receipt field. |
| `k` | Repetitions per case. |
| `cases` | The selected case stems, plus the suite's single name when one ran. Never sub-case names. |
| `arm_skill_lists` | Each arm's resolved skill list, from the session's `init` event. |
| `timestamp` | When the run started, ISO-8601. |

Free text is scrubbed before the receipt exists: `attribution`, the check names in `per_case` (a name
carries its argument from the case file) and each `dropped_cases` detail pass through the redactor,
which replaces every credential-shaped substring with `[redacted]`: a GitHub token, a GitHub PAT, an
Anthropic key, an AWS access key id, a PEM private key block, and a Bearer JWT. The redactor also
takes a list of caller-supplied secrets, and eval passes none, so those six patterns are the whole
of it. Transcripts and run trees stay local and unredacted; the boundary is sharing, not recording.

### Where a run lands on this machine

```
~/.terum/skills/evals/local/<64-hex content digest>/<run id>/
    receipt.json
    run.jsonl
    transcripts/<case|suite>.<arm>.<rep>[.attempt-1].jsonl
    sandboxes/arm-XXXXXX/
    generated/{triggers.yaml,suite.yaml,cases/*.yaml}
```

On Windows the root is `%USERPROFILE%\.terum\skills\`.

The store is keyed by **content**, not by team or skill id, which is what makes a skill belonging to
no team evaluable at all, and what makes publish's attach step provable rather than trusted: it
matches on the digest it has computed.

`run.jsonl` is one meta line then one line per comparison row, arm sample and trigger block. It
carries more than the receipt does: the team, the heavy flag and its evidence, the staged and missing
dependencies, whether any arm spawned agents, the per-arm resolved model ids, and which assets this
run generated, as `generated_assets`, which carries `cases` and `triggers` as booleans and `suite`
only when the generator returned one.

Sandboxes are kept, at mode 0700, and eval never cleans them up.

### When a receipt goes to the team

The eval commits its own receipt when **all** of these hold: `--no-commit` was not given, a clone
exists, a team is selected, the folder has a `metadata.id`, you have a handle, and some committed
version folder of this skill digests exactly equal to the bytes that were evaluated. Then it writes
one path:

```
evals/<skill-id>/v<N>/<run id>.json
```

Append-only, one immutable file per committed run, grouped by version, and never overwriting a path
that already exists. The committed copy is **stamped** with the `skill_id` and the `version`, because
the local receipt's `version` is null. Nothing else moves: no version is minted, no skill bytes are
written, no question is asked.

When no published version matches, nothing is written and you get the share hint instead. This is the
normal outcome for a folder you have edited.

`--no-commit` skips the commit and suppresses the hint. The local receipt is written either way.

Publish attaches matching receipts later. Every local receipt of those exact bytes is copied into
`evals/<id>/<version>/<run id>.json`, stamped the same way and skipping paths that already exist,
whether or not that publish minted a version. Publish's success line ends `Attached K eval run(s).`,
and a publish that did mint a version adds `M local eval run(s) were not attached — they evaluated
this folder before its first publish.` when some local runs did not match. Publish also has a gate in
the other direction: if the **newest** local receipt of the bytes it is about to publish is `FAIL`,
it asks `Your latest eval of these exact bytes failed against the previous version. Publish anyway?`
and cancels on no. The question always reads that way: a local receipt is written with a null
version, so the branch that would name one is never reached.

## The estimate shown before a run

Setup's eval step, and the app, both show a cost and time estimate before they spend anything. They
are built differently.

The CLI's estimate walks every receipt in the team clone at `evals/<id>/<version>/<run>.json`,
reconstructing one run total per receipt as the sum over arms of `cost_usd × cases × k` and the same
for `duration_ms`. It takes the **median** of those totals. Receipts with no arms, a zero case count,
or any null or negative cost or duration are skipped. **With fewer than three usable receipts it
produces nothing** and the line says so:

```
Evaluating 6 skills, 4 at a time: about $9.42 and 10 min on this machine, from 11 earlier runs (median $1.57 · 5 min each).
```

```
Evaluating 6 skills, 4 at a time: no earlier runs to estimate from; each eval runs the skill's cases against a baseline on this machine and bills your Claude account.
```

Elapsed time scales by `ceil(count / parallel)`, so it reflects the concurrency you chose.

Its limits are worth knowing. It medians across **every** receipt in the clone regardless of model,
`k`, engine version or Claude Code version, and regardless of which skill each one was for. It is a
rough prior over "what an eval costs on this machine", not a prediction for the skill you are about
to run.

The app's estimate on a skill page is a different number: it comes from that one skill's newest
committed receipt, and only when that receipt's `provenance.model` is `sonnet` and every arm has both
a cost and a duration.

```
3 cases × k=1 reps × 2 arms, 6 agent runs on sonnet from this machine: roughly 10 minutes and about $3 — arm-run pricing from the last receipt.
```

No spend cap exists anywhere. The estimate is the only guard before a run.

## Reading receipts back: `eval-report`

```sh
npx -y terum-skills@latest eval-report <skill> [--team <team>]
```

Read-only. No fetch, no network, no model call, no prompt, and it takes no clone lock. The skill is
looked up in the team, by name or id, so it needs a configured team.

It reads two things:

- **Committed history** from `<clone>/evals/<skill-id>/v*/*.json`, every run, sorted by version
  descending **numerically** (so `v10` sorts above `v2`) and then run id descending.
- **This machine's local runs**, merged from the content-keyed store for the folder's current bytes
  and from the legacy per-team tree, newest run id first. A directory counts as a run only when it
  holds a `run.jsonl`. Each is marked `committed` when a run with that id also appears in the
  history.

It also resolves which receipt is "the" one for this skill: the current version's newest receipt.
That receipt is validated against its own path: its `skill_id` and `version` must match the
directory it sits in. When they do not, the terminal prints

```
warning: the newest receipt is invalid (receipt <path> does not match the receipt path: its skill ID or version disagrees.); older receipts are listed in history only.
```

and the report's state becomes `invalid`. When the current version has no receipt at all, the newest
valid history row supplies one instead, and the report records which version it came from, so a
detail page cannot headline a different receipt than the card beside it.

The terminal output of `eval-report` is the warnings only. The structured value is what the app and
other frame consumers read.

## How a score reaches a card

A card shows **one receipt's own candidate-vs-baseline comparison** and its provenance: the W/L/T
record, net lift as whole percent, the verdict that bands it, the sign p, and the model, `k`, Claude
Code version, runner and date that produced it. Never a statistic across receipts. There is no code
anywhere that combines two receipts into one number, and the surfaces are built so that one receipt
is on screen at a time. The provenance is carried so you can see for yourself whether two numbers are
comparable.

Which receipt a card picks depends on what the card is.

**A Marketplace card** walks the skill's versions newest first and shows the newest version that has
a usable receipt, marking the score stale when that is not the latest version. A schema-invalid or
misfiled receipt fails closed **for that version only** and the walk continues, so one corrupt file
cannot blank a skill with three good older evals. The problem is reported rather than skipped
silently, and the card can say the latest version's own eval is unreadable instead of presenting an
older one as current without saying so. The misfiled check only works because an attached receipt is
always a stamped copy, never a plain file copy.

**A Library card** is matched on bytes. The folder's current content digest is computed, and the card
shows a receipt whose `content_digest` equals it, from this machine's local store first and from the
team's committed receipts second. That is why **editing a skill blanks its score**: the digest
changes, no receipt matches the new bytes, and there is nothing honest to show. When some receipt
scored that skill at a different digest, the card marks the score stale rather than absent, so an
edit reads as "not evaluated yet" and not as "never evaluated".

Eval assets are excluded from the digest, so adding or regenerating cases does not blank a score.

## How a teammate's receipt reaches you

Through the team repository, like everything else. Their eval commits `evals/<id>/v<N>/<run>.json`
into the repo; your next `sync` (or any verb that refreshes the clone, or the app's background fetch
at launch and on window focus, at most once a minute) fetches and hard-resets your clone to
`origin/main`, and the file is then on your disk. Nothing is pushed to you and nothing polls.

Once it is in your clone, it is joined to your Library by content digest exactly as your own local
receipts are, so a teammate's receipt of the bytes you have installed shows on your card. Receipts
that cannot be parsed are named and excluded:

```
myteam/deploy-check: schema-invalid receipt v3/20260916T021107Z.json; not considered.
```

## Related

- [Running an eval](running-evals.md)
- [How evaluation works](overview.md)
- [Publish a skill](../guides/publish.md)
- [Local state](../reference/local-state.md)
- [The team repository](../reference/team-repo.md)
- [CLI reference](../reference/cli.md)
