# harden: 2026-09-15-eval-purpose-suites

**Lane:** spec (codex-spec — Codex finds, Claude verifies and triages) · **shape:** full rounds — the whole spec every round · **mode:** unattended · **cap:** 1 passes
**Started:** 2026-09-16T06:55:55.980Z · **finished:** 2026-09-16T07:28:15.148Z

**Verdict:** stop: cap reached (1 passes) with 7 BLOCKER + DRIFT finding(s) still open

## Convergence

| Pass | Kind | Report | Confirmed | Top tier (BLOCKER + DRIFT) | Applied (mechanical / clear) | Gates | Commit |
|---|---|---|---|---|---|---|---|
| 1 | full | `.planning/specs/reviews/2026-09-15-eval-purpose-suites.codex-spec.r1.review.md` | 12 | 7 | 0 / 7 | pass | `a33b1015` |

## What the loop changed

One commit per pass; `git revert <sha>` undoes a pass. Nothing was pushed.

- pass 1 (full) — `a33b1015` — 0 mechanical + 7 clear

## Needs you

### Ambiguity / gap — fix or explicitly decline (5)

Never applied by the loop; the two-pass rule's own done-condition is that every one of these is fixed or explicitly declined by you. From the last counted pass.

- **[AMBIGUITY/GAP, not applied by the loop] Heavy mode has incompatible session semantics** — §5 lines 329–363; §10 lines 496–501
- **[AMBIGUITY/GAP, not applied by the loop] Dependency staging both includes and excludes sibling helpers** — §6.1 lines 390–397
- **[AMBIGUITY/GAP, not applied by the loop] Heavy-mode selection does not define an implementable state machine** — §5, lines 338–350; §10 item 5, lines 500–501
- **[AMBIGUITY/GAP, not applied by the loop] Suite rows lack a collision-free identity and an aggregation marker** — §3.2 lines 131–142; §3.5 lines 173–174; §7 lines 446–453
- **[AMBIGUITY/GAP, not applied by the loop] Generated suite write-back has no crash or rerun contract** — §4 lines 230–232 and §4.1 lines 314–319

### Forks — run `/decision-walk .planning/specs/reviews/2026-09-15-eval-purpose-suites.codex-spec.r1.review.md` (2)

Parked in the ledger, never resolved by the loop.

- **Unscored row: omitted from per_case (as built in PR A) vs kept visible with passed:null and no outcome for that comparison (#1) vs kept with outcome tie (#2/#12)** — §2.2, lines 97–99 (round 1) — three clear recommendations on the same §2.2 paragraph disagree; the loop applied only their common core (field rename per_case/case_runs)
- **Answer-key leak fix applied as a pathspec-exclusion variant of triage option 1 (key never committed, deleted before any arm) instead of an out-of-sandbox key directory** — §3.3 lines 146–148; §4.1 lines 299–307 (round 1) — same outcome as option 1 with bug risk 1 instead of 3 (no new suite field, no env plumbing); Ryan may prefer the literal option 1 or option 2 (.git/info/exclude)

### Eligible items not applied — mechanical or clear, with the reason (0)

_none_

### Contested — panel split, needs your adjudication (2)

- **Censoring candidate-caused failures can produce a false PASS** — North Star lines 9–11; §2.2 lines 82–99
- **The generator prompt gives impossible file-count rules for document and session-log suites** — §4.0 lines 187–205; §4 lines 207–214; §4.1 lines 253–275

### Declined (0) — in `.planning/debug/harden/2026-09-15-eval-purpose-suites.deferred.md`; delete an entry to re-raise it

_none_

### Unverified — beyond the verify cap (0)

_none_

### Untriaged (0)

_none_
