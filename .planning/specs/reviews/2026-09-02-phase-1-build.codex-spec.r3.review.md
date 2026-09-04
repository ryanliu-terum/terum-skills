# codex-spec review: 2026-09-02-phase-1-build.md

Target spec: /Users/ryanliu/Documents/Terum/skill-management-software/.planning/specs/2026-09-02-phase-1-build.md
Spec title: terum-skills — Phase 1 build spec (rev 4)
Findings were raised by **OpenAI Codex** (gpt-5.6-sol) and verified by a 2-vote Claude adversarial panel.

6 confirmed, 1 contested, 6 dropped, 0 unverified.

## Verdict

This review was run with **Codex (gpt-5.6-sol) as the finder and a 2-vote Claude panel as the verifiers** — a different panel from an `/ultraspec` run on the same spec, so finding counts and severities are not directly comparable across the two. Six findings survived adversarial verification, all unanimous 2-0. The three confirmed blockers are not stylistic: each describes a conforming implementation that does the wrong destructive thing. `sync`'s "re-place a recorded install that is missing" rule silently reverses a successful uninstall whose people-file write failed; the generic `safeWrite` algorithm (hard-reset to `origin/main`, commit, push) contradicts publish's PR gate and can push an endorsement straight to main; and `sync prune` deletes "orphaned" placements without ever defining orphan or Terum provenance, so a user's unrelated skill folder can be destroyed. The confirmed ambiguity and both gaps are all data-model or protocol holes that block implementation rather than merely risking it — scope is unrepresentable for project installs, the hook mutex has no acquisition/contention/stale-recovery semantics, and consent is defined on field presence in one section and on normalized grant set in another. Recommend clearing the three blockers and pinning the two gaps' data models before treating rev 4 as BUILD-READY; the contested managed-field normalization finding (one vote from confirmation) needs human adjudication alongside them.

## Severity counts (confirmed only)

| Severity | Count |
|---|---|
| BLOCKER | 3 |
| DRIFT | 0 |
| AMBIGUITY | 1 |
| GAP | 2 |
| NOTE | 0 |
| **Total** | **6** |

Contested (1) and unverified (0) findings are excluded from this table and listed separately below.

## Internal quality

- [ ] **BLOCKER — Failed uninstall is reconciled by reinstalling the skill**
  - **Location:** §6 lines 265–267; §12 line 350
  - **Evidence:** §6 line 266 requires: “Placer remove … + people-file update, in that order, reconciled by `sync` on partial failure exactly as `install` is.” But line 265 says sync handles a recorded install that is missing by “re-placing” it. If removal succeeds and the people-file safeWrite fails or the process stops between those steps, the record still exists, so sync reverses the requested uninstall. §12 line 350 nevertheless requires interrupted partial states to be reconciled.
  - **Suggested fix:** Persist a durable pending install/uninstall intent before changing placement, then have sync finish that operation. Add a specific test for interruption after successful removal but before the people-file update.
  - *Panel: vote 2-0; verifier concurs with severity BLOCKER.*

- [ ] **AMBIGUITY — Absent and explicitly empty allowed-tools have inconsistent consent semantics**
  - **Location:** §5.4 lines 200–204; §6 lines 262 and 269
  - **Evidence:** §5.4 line 202 makes absent and explicitly empty `allowed-tools` identical: both normalize to the hashable literal `none`, meaning “grants nothing.” Yet §6 line 269 bypasses approval only when a skill “declares no `allowed-tools` at all,” excluding an explicitly empty field, while line 262 says any hash lacking an approval requires y/N. Implementers can therefore either treat both `none` forms identically or prompt for an empty field—and can also disagree about whether an absent field on explicit install needs approval.
  - **Suggested fix:** Define consent in terms of the normalized grant set rather than field presence, and state expected prompt/auto-placement behavior for absent and explicitly empty values in install, join, interactive sync, and hook sync.
  - *Panel: vote 2-0; verifier concurs with severity AMBIGUITY.*

## Build-readiness

- [ ] **BLOCKER — PR-gated publish has no branch-aware safeWrite contract**
  - **Location:** §6.0 lines 218–228; §6 line 259
  - **Evidence:** §6.0 says “`teamRepo.safeWrite(mutate)` wraps every mutating verb,” hard-resets to `origin/main`, then performs “Commit, push.” But `publish` under the default policy instead requires “branch `publish/<name>`, `gh pr create`” and must never fall through to a direct push. The spec never defines safeWrite's destination ref, handling of an existing publish branch, or replay after that branch rejects a push. Implementing the generic algorithm literally can push the endorsement directly to main and bypass the required review gate.
  - **Suggested fix:** Define a branch-aware safeWrite mode with explicit base ref, destination refspec, branch-collision/retry behavior, and cleanup. Assert in `publish.test.ts` that PR mode never changes `origin/main`, including when `gh` is absent and when the publish branch already exists.
  - *Panel: vote 2-0; verifier suggests severity GAP (finder severity BLOCKER retained above).*

- [ ] **BLOCKER — sync prune lacks an ownership predicate for destructive deletion**
  - **Location:** §6 lines 263–265 and 281; §7 line 286
  - **Evidence:** The only deletion contract is: “Orphaned placements are moved aside and reported; only explicit `sync prune` deletes.” The spec never defines “orphaned” or how sync distinguishes a Terum-managed placement from another skill returned by the scope-wide Placer listing. Elsewhere, an untracked placement is merely offered for adoption and collisions may involve non-Terum folders. A conforming implementation could therefore classify and delete a user-owned, non-Terum skill.
  - **Suggested fix:** Define durable placement provenance and the exact orphan predicate. Limit prune to quarantined paths demonstrably created or moved by Terum, define confirmation and failure behavior, and add adversarial tests proving unrelated and declined-adoption folders survive prune.
  - *Panel: vote 2-0.*

- [ ] **GAP — Project install records do not encode enough scope to reconcile a placement**
  - **Location:** §5.2 lines 124–136; §6 lines 264–267; §7 line 286
  - **Evidence:** The only schema example stores `"scope": "global"`, while install records `{id, version, scope}` and project skills are placed “into the matching repo.” Project placement requires running from a product-repo root, but the spec never defines the project-scope value, whether commands operate only on the current worktree, or how sync/uninstall locate a prior placement across multiple projects or checkouts. The required Zod schema and reconciliation lookup cannot be implemented without choosing this data model.
  - **Suggested fix:** Define scope as a concrete discriminated schema and specify worktree discovery/persistence. State current-directory behavior for install, uninstall, interactive sync, and hook sync, then test two projects, two checkouts of one project, and invocation outside a matching repository.
  - *Panel: vote 2-0; verifier concurs with severity GAP.*

- [ ] **GAP — The session mutex and rate-limit protocol is unspecified and untested**
  - **Location:** §8 line 300; §12 lines 345 and 355
  - **Evidence:** The hook merely “takes the `run/<team>.lock` mutex” and “no-ops within an hour” of a stamp. It does not say how acquisition is atomic, whether a contender waits or exits, how a lock left by a crashed process is recovered, or whether the stamp is written before or only after successful sync. The required hook adversarial tests cover settings mutation only, despite the stated three-window concurrency scenario.
  - **Suggested fix:** Specify lock creation, ownership, contention, stale-lock recovery, release, and successful-stamp timing in `hook.ts`. Add collocated Vitest cases for concurrent hook processes, a crashed owner, failed sync, and independent teams.
  - *Panel: vote 2-0; verifier concurs with severity GAP.*

## Contested (split verdict — needs human adjudication)

- **BLOCKER — Managed-field normalization does not prevent three-way phantom conflicts** *(internal quality; panel split, one vote from confirmation)*
  - **Location:** §5.3 lines 156–172
  - **Evidence:** Lines 156–167 define `B` as the previously stored whole-tree digest and classify changes by comparing current `S` and `R` to `B`. Line 172 then claims managed-field re-injections applied “before digests are taken” mean the refresh “never counts as a user edit and cannot start a phantom conflict.” That conclusion is false because stored `B` is not re-normalized: rewriting the source makes `S != B`, and rewriting both copies makes both `S != B` and `R != B`. A concurrent genuine repository edit makes the source-only interpretation falsely enter the both-changed row as well.
  - **Suggested fix:** Define a canonical reconciliation digest that excludes managed fields, or persist enough baseline content to apply the same canonicalization to `B`. Explicitly specify which copies are rewritten and when the baseline advances.

## Unverified (not adversarially checked)

None — every finding raised fell within the verify cap and was adversarially checked.
