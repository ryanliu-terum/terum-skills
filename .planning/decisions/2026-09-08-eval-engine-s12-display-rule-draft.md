# Eval-engine §12 display rule: the D11 amendment, drafted for Ryan's read

Drafted under Ryan's D11 ruling (M7 takeover decision walk, 2026-09-08: Ryan amends the eval-engine §12 rule himself as product owner; Ajay is informed in the PR body). This file is the draft. It is applied to `.planning/specs/2026-09-04-eval-engine.md` inside batch S7v's pull request (the batch that lights EV-01, EV-02, EV-09, EV-16 and EV-19), never merged standalone, and the S7v commit that applies it is labelled "drafted under Ryan's D11 ruling, for his read". The three passages below change together; nothing else in the spec moves.

## 1. §5.4, the two comparability bullets (spec lines 251-256 at f8557c4)

Replace

> - Numbers from receipts with different `model` or `cc_version` are never merged or compared by any surface. The UI shows provenance beside any number.
> - A receipt with `execution_status: "partial"` displays its verdict greyed with "partial (7/9 scored)" — never silently promoted to a full verdict.

with

> - Numbers from receipts with different `model` or `cc_version` are never merged or compared by any surface. The UI shows provenance beside any number. A display surface may render the lift, the verdict and the per-arm scores of **one** committed receipt as that receipt states them, and may show a pre-run cost estimate derived from that same receipt's `efficiency` block, labelled as arm-run pricing for the receipt's own `model`; it never derives a statistic across receipts and never ranks skills by a receipt number.
> - A receipt with `execution_status: "partial"` displays its verdict greyed with "partial (7/9 scored)" — never silently promoted to a full verdict.

## 2. §12, the opening sentence (spec lines 480-482)

Replace

> The receipt JSON is the API. The UI never runs evals and never derives new statistics. For a given version the UI renders the **latest** receipt (max `run_id`); older receipts are history — kept, never displayed side by side or merged.

with

> The receipt JSON is the API. The UI never runs an eval itself: it may hand a run off to the CLI through the Prompter (the `eval` verb, with the CLI asking its own questions), and it never derives a new statistic. What it may show, per receipt: the lift, the verdict and the per-arm scores exactly as the committed receipt states them, a pre-run cost estimate computed from that one receipt's own `efficiency` numbers and labelled as arm-run pricing for the receipt's `model`, and the receipt's provenance beside every number. What it may not do: derive any statistic across receipts, rank or sort skills by a receipt number, show a number when there is no receipt (the slot renders empty), or show an estimate whose arm model differs from `receipt.provenance.model` (suppress it). For a given version the UI renders the **latest** receipt (max `run_id`); older receipts are history — listed, never displayed side by side or merged.

## 3. The app rules S7v ships (recorded here so the PR body and the spec agree)

1. Suppress the estimate when the arm model the app would run differs from `receipt.provenance.model`.
2. Render nothing (an empty slot, `—`, "Not evaluated") when there is no receipt; never a synthesized number.
3. Label every estimate as arm-run pricing from the receipt's own numbers, never as a total or a forecast.
4. `liftOnCards` and `runEvalInApp` flip to `true` in `FRAME_FEATURES` in S7v (the `hook` verb's `progress` flip belongs to S7ae; the frames.ts edit order is S7d → S7b → S7ae → S7l, D13; S7v's flips ride the same file after S7l or in its own one-line commit stacked on the last editor).

## Why (for Ryan's read)

The old sentence banned every drawn eval control on the skill page (EV-01 lift on cards, EV-02 run from the app, EV-09 the estimate, EV-16 the history list, EV-19 the library roll-up). The critic's finding stands: three of those need no new statistic at all, only permission to render one receipt's numbers where the board draws them; the run-in-app control is a Prompter hand-off to the CLI, not the UI running an eval; and the roll-up (EV-19) stays out because it is a cross-receipt statistic, which the amended rule still forbids. The amendment therefore lights four of the five rows and keeps the one the rule was written to prevent.
