# harden: 2026-09-11-library-marketplace-refactor

> **STOPPED BY RYAN, 2026-09-11.** The loop reads "still running" because round 3 never completed a
> valid pass — its Codex find half succeeded (21 findings) and its Claude verify half aborted on a spend
> limit. Rather than wait for the reset, Ryan chose to implement against a tracked list of open findings
> (`.planning/reviews/2026-09-11-refactor-open-findings.md`), each mapped to the batch that resolves it.
> **So the acceptance bar "three rounds with zero BLOCKER/DRIFT" was NOT met.** This run is reported as
> two counted rounds with 20 findings still open — not as "hardened".

**Lane:** spec (codex-spec — Codex finds, Claude verifies and triages) · **shape:** full rounds — the whole spec every round · **mode:** unattended · **cap:** 3 passes
**Started:** 2026-09-11T10:30:33.350Z

**Verdict:** still running — pass 3 (full) is next

## Convergence

| Pass | Kind | Report | Confirmed | Top tier (BLOCKER + DRIFT) | Applied (mechanical / clear) | Gates | Commit |
|---|---|---|---|---|---|---|---|
| 1 | full | `.planning/specs/reviews/2026-09-11-library-marketplace-refactor.codex-spec.r1.review.md` | 10 | 8 | 1 / 7 | n/a | `f11a04a` |
| 2 | full | `.planning/specs/reviews/2026-09-11-library-marketplace-refactor.codex-spec.r2.review.md` | 14 | 8 | 0 / 7 | n/a | `09b89aa` |

1 invalid attempt(s), not counted:
- round 3 attempt at 2026-09-11T17:43:58.015Z: Verify half aborted: 28 of 70 Claude agents failed with 'You've hit your monthly spend limit' (weekly reset Sep 14 05:00 America/Los_Angeles). All 3 verifiers died on 7 findings (engine reports them as contested 0-0, they are UNVERIFIED), all 6 triage agents died (6 untriaged), and synthesis died (no reportMarkdown, no r3 review file written). The Codex FIND half succeeded: 54/54 reviewers, 0 failures, 21 findings at scratch harden-r3/findings.json (copied to ../harden-refactor-scratch/r3-findings.json). Re-run round 3's verify with resumeFromRunId wf_58a777ea-40c after the limit resets. (.planning/specs/reviews/2026-09-11-library-marketplace-refactor.codex-spec.r3.review.md)

## What the loop changed

One commit per pass; `git revert <sha>` undoes a pass. Nothing was pushed.

- pass 1 (full) — `f11a04a` — 1 mechanical + 7 clear
- pass 2 (full) — `09b89aa` — 0 mechanical + 7 clear

## Needs you

### Ambiguity / gap — fix or explicitly decline (6)

Never applied by the loop; the two-pass rule's own done-condition is that every one of these is fixed or explicitly declined by you. From the last counted pass.

- **#0 [GAP] Renaming an existing Global project leaves persisted project references dangling — adjudicated outside the loop in the follow-up commit** — .planning/specs/2026-09-11-library-marketplace-refactor.md §13 step 2, line 748 (the rename is authorised) with §13 step 5, line 751 and §3.4, line 218 (the two places that would have to carry the reference rewrite and do not)
- **#10 [NOTE] Machine teardown already clears pending rows — adjudicated outside the loop in the follow-up commit** — /Users/ryanliu/Documents/Terum/terum-codex/harden-refactor/.planning/specs/2026-09-11-library-marketplace-refactor.md §13 Migration (D3), line 755 — final paragraph, the two clauses after "or a crashed install leaves a row nothing can ever clear"
- **#12 [NOTE] The specified tree helper rejects the existing MutableTree type — adjudicated outside the loop in the follow-up commit** — .planning/specs/2026-09-11-library-marketplace-refactor.md:172 — §3.2 "The version vocabulary — one module", the `versionsInTree` declaration inside the ```ts block
- **#20 [AMBIGUITY] The incumbent algorithm conflicts with its mandatory test — adjudicated outside the loop in the follow-up commit** — .planning/specs/2026-09-11-library-marketplace-refactor.md §6.5 "The eval's incumbent arm", line 423, bullet 1, sentence 3 (the "fall back to the highest remaining digest-unequal `v<N>`" clause); contradicted at §14.1 line 800
- **#21 [GAP] Move and rename lack a recoverable multi-write contract — adjudicated outside the loop in the follow-up commit** — /Users/ryanliu/Documents/Terum/terum-codex/harden-refactor/.planning/specs/2026-09-11-library-marketplace-refactor.md §7.5 "D6 — delete, rename, move", lines 493 and 504–508 (ledger-ordering bullet at 506, false no-torn-state claim at 508); restated in §2 D18 line 126 and undercut by §1.5 line 78
- **#22 [GAP] Unpublished local evals have no specified skill_id representation — adjudicated outside the loop in the follow-up commit** — .planning/specs/2026-09-11-library-marketplace-refactor.md §6.1 lines 377–380 (schema-v2 bullet list — omits `skill_id`); co-located gaps at §5.1 step 9 line 337 ("Attach matching receipts", stamping undefined), §6.4 line 411 (consequence asserted, representation undefined), §3.4 table lines 206–211 (no `skill_id` row)

### Forks — run `/decision-walk .planning/specs/reviews/2026-09-11-library-marketplace-refactor.codex-spec.r2.review.md` (1)

Parked in the ledger, never resolved by the loop.

- **#8 Retire the sibling's mandatory publish receipt gate — resolved as D19 (ledger Decision 11) on the standing best-call authorization** — Primary: `.planning/specs/2026-09-04-eval-engine.md:3` (supersession head note scoped to §6.5 only) together with `.planning/specs/2026-09-11-library-marketplace-refactor.md` §16:824-832 (collision/supersession table omits the eval-engine spec). Contradicting text: target §12:729 and §12:737 vs sibling §6.1:294, §11:465-479, §16:645 and §16:648. (round 2) — Option 1 beats option 2 outright — same fit, more of the problem removed, and the sibling has already been annotated once at its own head, so the "never edit a sibling" objection does not hold here. The real fork is between option 1 and option 3, and it is a product question, not a wording question:

### Eligible items not applied — mechanical or clear, with the reason (0)

_none_

### Contested — panel split, needs your adjudication (4)

- **#7 [BLOCKER] Reconcile eval's candidate source and receipt writer (vote 2-1)**
- **#19 [BLOCKER] Receipt seeding requires a digest that migrated receipts never acquire (vote 1-2)**
- **#15 [DRIFT] Current catalog call count omits its existing team inventory read (vote 1-2)**
- **#16 [DRIFT] Reusing uninstallMany does not guarantee undoable Library deletion (vote 2-1)**

### Declined (0) — in `.planning/debug/harden/2026-09-11-library-marketplace-refactor.deferred.md`; delete an entry to re-raise it

_none_

### Unverified — beyond the verify cap (0)

_none_

### Untriaged (0)

_none_
