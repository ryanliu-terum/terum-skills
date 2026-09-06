# harden: phase1-closeout-r2

**Lane:** code (hybrid-review — Claude finds, Codex verifies, Claude triages) · **shape:** two-pass — one full pass, then fix-scoped confirmation passes · **mode:** unattended · **cap:** 2 passes · **base:** `0e0c150`
**Started:** 2026-09-06T12:57:13.987Z · **finished:** 2026-09-06T18:29:05.768Z

**Verdict:** stop: converged — the confirm pass confirmed no critical + high findings

## Convergence

| Pass | Kind | Report | Confirmed | Top tier (critical + high) | Applied (mechanical / clear) | Gates | Commit |
|---|---|---|---|---|---|---|---|
| 1 | full | `.planning/reviews/phase1-closeout-r2.hybrid.r1.review.md` | 18 | 1 | 7 / 9 | pass | `2eb01ed197dd5e625506e65b38e07b50167ea8ab` |
| 2 | confirm | `.planning/reviews/phase1-closeout-r2.hybrid.r2.review.md` | 11 | 0 | 5 / 2 | pass | `465bd0ffc92b5f789a6c345a2b4a8c767d13ef48` |

## What the loop changed

One commit per pass; `git revert <sha>` undoes a pass. Nothing was pushed.

- pass 1 (full) — `2eb01ed197dd5e625506e65b38e07b50167ea8ab` — 7 mechanical + 9 clear
- pass 2 (confirm) — `465bd0ffc92b5f789a6c345a2b4a8c767d13ef48` — 5 mechanical + 2 clear

## Needs you

### Mediums — fix or explicitly decline (3)

Never applied by the loop; the two-pass rule's own done-condition is that every one of these is fixed or explicitly declined by you. From the last counted pass.

- **place() reports a placement that fully succeeded as a failure when only the displaced-copy cleanup fails, instead of using its own notices channel** — src/lib/placer.ts:82
- **latestTree-per-skill resilience fixed at 1 of 3 call sites; ls still dies whole on the same ghost folder** — src/commands/ls.ts:45
- **setup's hoisted clone guard reimplements a weaker copy of ensureClone's completeness predicate** — src/commands/setup.ts:134

### Forks — run `/decision-walk .planning/reviews/phase1-closeout-r2.hybrid.r2.review.md` (2)

Parked in the ledger, never resolved by the loop.

- **search's new batching spawns one unbounded `git rev-parse` child per hit, when an existing helper resolves every skill tree in a single `git ls-tree`** — src/commands/search.ts:41 (round 1) — A timing call: lift teamRepo's skillTrees into an exported latestTrees(runner, clone) — one `git ls-tree` per clone — and adopt it in search, ls and the Action's README path (option 1, recommended; touches shared code used by three commands and needs an empty-`skills/`-tree guard), or cap the per-hit fan-out with a small bounded map at search and ls (option 2; ~10 revert-safe lines, N git processes stay).
- **search now returns an untracked, unshared folder as a real hit, unlike the malformed-folder path four lines below which excludes it** — src/commands/search.ts:52 (round 2) — A product call: should a skill folder that sits in the clone on this machine but was never committed to the team repo appear in `search` at all? Keep the row and add `unresolved: boolean` to SearchHit so the phase-2 SPA can grey out Install without string-matching `—` (option 1, recommended, Depth 2 / Cost 0); report-and-skip it like a malformed folder (option 2, Depth 3 / Cost 1 — but a rejection is not proof of untrackedness: git not on PATH rejects the same way, so a machine without git would print N reasons then 'No skills found'); or teach latestTree to tell 'not in HEAD' from 'git broke' and skip only the former (option 3, Depth 4 / Cost 2 — do it with the parked latestTrees fork if option 2's rule is wanted).

### Eligible items not applied — mechanical or clear, with the reason (4)

- **place()'s new quarantineRoot is optional, but the undefined branch is reachable only from tests and strands the copy inside the skills root — the invariant the fix cites** — src/lib/placer.ts:89 (round 1) — low; making quarantineRoot required edits 14 test call sites; the misreport half (displacedExists) is applied — left for the next sweep
- **place() reports a placement that fully succeeded as a failure when only the displaced-copy cleanup fails, instead of using its own notices channel** — src/lib/placer.ts:82 (round 2) — changes place()'s contract (a landed swap whose cleanup failed returns with a notice instead of throwing) after the last panel; the control flow predates the close-out, only the wording is the close-out's — left for Ryan with option 1 recommended
- **latestTree-per-skill resilience fixed at 1 of 3 call sites; ls still dies whole on the same ghost folder** — src/commands/ls.ts:45 (round 2) — ls.ts is outside the reviewed diff and the change is behaviour (ls degrades one row instead of failing whole); left for Ryan with option 1 recommended, deletable under either outcome of the parked fan-out fork
- **setup's hoisted clone guard reimplements a weaker copy of ensureClone's completeness predicate** — src/commands/setup.ts:134 (round 2) — the guard's weakness predates the close-out (which hoisted it) and the fix changes what setup refuses, touching teamRepo.ts and team.ts; left for Ryan with option 1 recommended

### Contested — panel split, needs your adjudication (0)

_none_

### Declined (1) — in `.planning/debug/harden/phase1-closeout-r2.deferred.md`; delete an entry to re-raise it

- [loop] **Duplicate `rm(temporary)` — the catch-block copy is dead now that a finally does the same** — src/lib/placer.ts:72 — contested 1-2; the catch-block rm now carries a .catch so it cannot abort the recovery, and the finally repeats it — harmless, left as is

### Unverified — beyond the verify cap (0)

_none_

### Untriaged (0)

_none_
