# harden: m4-ship

**Lane:** code (hybrid-review — Claude finds, Codex verifies, Claude triages) · **shape:** two-pass — one full pass, then fix-scoped confirmation passes · **mode:** unattended · **cap:** 3 passes · **base:** `0e0c150`
**Started:** 2026-09-06T11:14:27.698Z · **finished:** 2026-09-06T15:24:28.080Z

**Verdict:** stop: converged — the confirm pass confirmed no critical + high findings

## Convergence

| Pass | Kind | Report | Confirmed | Top tier (critical + high) | Applied (mechanical / clear) | Gates | Commit |
|---|---|---|---|---|---|---|---|
| 1 | full | `.planning/reviews/m4-ship.hybrid.r1.review.md` | 22 | 4 | 11 / 10 | pass | `b2ec5727074b6c7a8d8894ce8c01b829f1f8d7f8` |
| 2 | confirm | `.planning/reviews/m4-ship.hybrid.r2.review.md` | 19 | 1 | 9 / 10 | pass | `67cee35559ab734335648ce69835b556f54513d0` |
| 3 | confirm | `.planning/reviews/m4-ship.hybrid.r3.review.md` | 14 | 0 | 7 / 5 | pass | `2ce4687e0c2c239da44d98a3adbd421c76cc5136` |

## What the loop changed

One commit per pass; `git revert <sha>` undoes a pass. Nothing was pushed.

- pass 1 (full) — `b2ec5727074b6c7a8d8894ce8c01b829f1f8d7f8` — 11 mechanical + 10 clear
- pass 2 (confirm) — `67cee35559ab734335648ce69835b556f54513d0` — 9 mechanical + 10 clear
- pass 3 (confirm) — `2ce4687e0c2c239da44d98a3adbd421c76cc5136` — 7 mechanical + 5 clear

## Needs you

### Mediums — fix or explicitly decline (2)

Never applied by the loop; the two-pass rule's own done-condition is that every one of these is fixed or explicitly declined by you. From the last counted pass.

- **`team leave`'s new §8 mutex only excludes hook syncs; an interactive `sync` still runs teardown over** — src/commands/leave.ts:42
- **The `blocked()` completeness rule was applied to the placement loop only; `reconcileShared`'s six undone-work exits still let the team be stamped "fully synced"** — src/commands/sync.ts:48

### Forks — run `/decision-walk .planning/reviews/m4-ship.hybrid.r3.review.md` (2)

Parked in the ledger, never resolved by the loop.

- **The hourly stamp is written after a partial (deferred) hook run, rate-limiting the deferred work into an hour of silence — contrary to §8** — src/commands/sync.ts:201 (round 1) — What run/<team>.stamp is allowed to mean: the spec says "this team is fully synced"; two close-out tests and search.ts's "may be stale" line read it as "the clone was refreshed". Option 1 (applied as the interim, recommended): per-team completion gate on the one file — a team with undone work is not stamped, so it fetches at every session start until an interactive sync clears the item, and search nags "may be stale" meanwhile. Option 2: a second, completion-only marker (run/<team>.synced) keeps both meanings, at the cost of one more run/ artifact, a leave cleanup line and a §8 sentence. Option 3: a whole-run gate on deferred.length lets one team's deferral withhold another's stamp.
- **`treeBetween`'s new one-pass read spawns one `git show` per changed skill folder with no concurrency bound, on git's blocking pre-push path** — src/commands/guardPush.ts:110 (round 3) — A scope call: bound the fan-out in the one confirmed place (option 1, applied as the interim: slices of eight), add a shared mapLimit and sweep ls/search's one-git-per-skill fan-outs too (option 2), or revert to the sequential loop (option 3). ls and search have the same shape at lower stakes.

### Eligible items not applied — mechanical or clear, with the reason (2)

- **`team leave`'s new §8 mutex only excludes hook syncs; an interactive `sync` still runs teardown over** — src/commands/leave.ts:42 (round 3) — behaviour change for every interactive sync (a second concurrent sync skips the team with a notice); left for Ryan with option 1 recommended
- **The `blocked()` completeness rule was applied to the placement loop only; `reconcileShared`'s six undone-work exits still let the team be stamped "fully synced"** — src/commands/sync.ts:48 (round 3) — threads the run's recorder into reconcileShared's eight exits — new behaviour in share.ts after the last panel; left for Ryan with option 1 recommended

### Contested — panel split, needs your adjudication (4)

- **Credential-scrub test only pins the message, not the git argv the r2 high was about** — src/commands/__tests__/guard-push.test.ts:97
- **Credential assertion in the guard-push refusal test is negative-only and does not pin which refusal ran** — src/commands/__tests__/guard-push.test.ts:97
- **Credential-scrub test covers only one of the three remoteLabel interpolation sites in the guard** — src/commands/__tests__/guard-push.test.ts:97
- **Mid-run mutation test keys off a global fetch counter instead of the file's existing cwd-keyed runner idiom** — src/commands/__tests__/sync.test.ts:701

### Declined (1) — in `.planning/debug/harden/m4-ship.deferred.md`; delete an entry to re-raise it

- [loop] **installPushGuard overwrites .git/hooks/pre-push and forces core.hooksPath, silently disabling machine-wide hooks in the clone** — src/lib/teamRepo.ts:349 — contested 2-1 low; the clone is the tool's own private directory and a global core.hooksPath would otherwise silently disable the D12 guard; chaining to a global hooks directory is a later enhancement

### Unverified — beyond the verify cap (0)

_none_

### Untriaged (0)

_none_
