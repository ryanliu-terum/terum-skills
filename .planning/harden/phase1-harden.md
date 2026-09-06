# harden: phase1-harden

**Lane:** code (hybrid-review — Claude finds, Codex verifies, Claude triages) · **shape:** two-pass — one full pass, then fix-scoped confirmation passes · **mode:** unattended · **cap:** 8 passes · **base:** `0619519`
**Started:** 2026-09-05T20:24:06.171Z · **finished:** 2026-09-06T00:19:28.002Z

**Verdict:** stop: converged — the confirm pass confirmed no critical + high findings

## Convergence

| Pass | Kind | Report | Confirmed | Top tier (critical + high) | Applied (mechanical / clear) | Gates | Commit |
|---|---|---|---|---|---|---|---|
| 1 | full | `.planning/reviews/phase1-harden.hybrid.r1.review.md` | 33 | 19 | 1 / 16 | pass | `978c7e34a0077ec62381e42f0eb31b09a511acb2` |
| 2 | confirm | `.planning/reviews/phase1-harden.hybrid.r2.review.md` | 12 | 0 | 0 / 0 | n/a | — |

## What the loop changed

One commit per pass; `git revert <sha>` undoes a pass. Nothing was pushed.

- pass 1 (full) — `978c7e34a0077ec62381e42f0eb31b09a511acb2` — 1 mechanical + 16 clear

## Needs you

### Mediums — fix or explicitly decline (12)

Never applied by the loop; the two-pass rule's own done-condition is that every one of these is fixed or explicitly declined by you. From the last counted pass.

- **[medium] share --keep-source pushes a managed-field commit before the new --allow-privileged gate, so a refused command still writes to the team repo** — src/commands/share.ts:184
- **[medium] inlineText() collapses \r\n and \n but not a bare CR, so a repo-controlled field still breaks out of its table row / list item / heading** — src/lib/readme.ts:163
- **[medium] PR-comment anchor-forgery fix has no adversarial test; the only prComment test passes with the fix reverted** — src/commands/__tests__/readme.test.ts:30
- **[low] publish's new byte-exact endorsement compare has no test that exercises it alone; the one case that reaches it also differs in formatting** — src/commands/__tests__/publish.test.ts:136
- **[medium] refreshClone's ELOCKED now aborts the entire sync run — all other teams, all pending replays, and the SessionStart hook** — src/lib/teamRepo.ts:356
- **[medium] sync quarantines a drifted placement before the new foreign-destination check, so a blocked rename leaves the skill only in quarantine and the ledger permanently wedged** — src/commands/sync.ts:126
- **[medium] JSON.stringify on unvalidated YAML can throw, replacing the malformed-allowed-tools consent prompt with a TypeError** — src/commands/install.ts:128
- **[medium] quarantineDrift() propagates every fs error, turning a single unreadable placement into a total sync failure** — src/lib/placer.ts:112
- **[medium] cell() does not escape backticks, so a repo-controlled skill name breaks out of the README install code span** — src/lib/readme.ts:72
- **[medium] Preflight `-2` vet does not actually protect the fallback push: the lease is read after safeWrite's own fetch** — src/commands/__tests__/publish.test.ts:191
- **[medium] readme test claims 'every interpolated field' but never poisons the Endorsed column** — src/lib/__tests__/readme.test.ts:68
- **[low] Two serial ls-remote network round trips where one multi-pattern call suffices** — src/commands/publish.ts:53

### Forks — run `/decision-walk .planning/reviews/phase1-harden.hybrid.r2.review.md` (2)

Parked in the ledger, never resolved by the loop.

- **Stale-lock test swallows the reclaimed holder's release, hiding that the vendored target lock has no onCompromised handler** — src/lib/__tests__/placer.test.ts:87 (round 1) — A genuine, decidable fork about churn versus honesty of the error message — not a technical unknown. All three options stop the CLI from being killed by a background timer, which is the actual danger. The cheap version (option 2) keeps the entire change inside one vendored file and touches no commands, but on the rare occasion when the install fails AND the lock was stolen, the user is told "lost the lock" instead of the real reason — and this codebase already decided that shape was a serious bug in two other places and fixed them. The recommended version (option 1) fixes that properly by wrapping the locked work in a helper the codebase already uses elsewhere for repo clones, at the price of rewriting how install, sync and uninstall take the lock right before 0.1.0. Option 3 is the cheapest and is what the team chose for one other lock, but it means a user can be told an install succeeded when another process owned the folder the whole time. The call is: is a rarely-wrong error message acceptable to keep the change small (option 2), or is it worth editing three commands to always report the true cause (option 1)?
- **injectManagedFields crashes on any SKILL.md without a `metadata:` mapping — the very branch written to handle it** — src/lib/skills.ts:93 (round 1) — Both options start with the same one-line library fix — that part is not in dispute and is needed either way. They diverge on a product question the code cannot settle: when someone tries to share a skill that carries no Terum category, should the tool refuse and tell them to add one, or should it ask them to pick one from the team's list? Refusing is cheaper, keeps the shared repository clean, and matches how the spec describes share today (it injects exactly three fields and shows exactly three lines before the y/N). Asking is what makes the onboarding wizard actually finish for a normal user: every off-the-shelf Claude skill lacks that field, the wizard's first-skill picker offers precisely those folders, and a failed share currently aborts the entire wizard — so under the refuse option a brand-new user's first run still dead-ends, only with a sentence they can act on. Pick refuse if you expect authors to hand-write a line of Terum frontmatter before sharing; pick ask if 'point it at any skill folder and it just works' is the promise. Recommending refuse for now because it is strictly smaller, is a prerequisite of the other option anyway, and converts a crash into a directive error without committing the product to a new prompt.

### Eligible items not applied — mechanical or clear, with the reason (0)

_none_

### Contested — panel split, needs your adjudication (4)

- **[high] Unconditional `publish/<name>-2` vetting blocks publishing `<name>` whenever a sibling skill `<name>-2` has an open endorsement PR — and the refusal tells the user to delete that PR's branch** — src/commands/__tests__/publish.test.ts:191
- **[medium] New EXDEV cp+rm fallback in moveToQuarantine has zero test coverage, and is duplicated verbatim in share.ts** — src/lib/placer.ts:127
- **[medium] refreshClone's new lock does not reuse safeWrite's compromised-lock check, so the rewind it was added to prevent is still reachable** — src/lib/teamRepo.ts:367
- **[low] Held-clone-lock setup copied to a third site, each copy costing ~3.75s of proper-lockfile retry backoff** — src/commands/__tests__/publish.test.ts:177

### Declined (0) — in `.planning/debug/harden/phase1-harden.deferred.md`; delete an entry to re-raise it

_none_

### Unverified — beyond the verify cap (0)

_none_

### Untriaged (0)

_none_
