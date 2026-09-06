# harden: phase1-closeout

**Lane:** code (hybrid-review — Claude finds, Codex verifies, Claude triages) · **shape:** two-pass — one full pass, then fix-scoped confirmation passes · **mode:** unattended · **cap:** 3 passes · **base:** `81bf9a6`
**Started:** 2026-09-06T09:38:57.181Z · **finished:** 2026-09-06T11:26:11.958Z

**Verdict:** stop: converged — the full pass confirmed no critical + high findings

## Convergence

| Pass | Kind | Report | Confirmed | Top tier (critical + high) | Applied (mechanical / clear) | Gates | Commit |
|---|---|---|---|---|---|---|---|
| 1 | full | `.planning/reviews/phase1-closeout.hybrid.r1.review.md` | 23 | 0 | 7 / 13 | pass | `775e2230456c8ac38aafd806e9b92f6c62aabd5a` |

## What the loop changed

One commit per pass; `git revert <sha>` undoes a pass. Nothing was pushed.

- pass 1 (full) — `775e2230456c8ac38aafd806e9b92f6c62aabd5a` — 7 mechanical + 13 clear

## Needs you

### Mediums — fix or explicitly decline (0)

Never applied by the loop; the two-pass rule's own done-condition is that every one of these is fixed or explicitly declined by you. From the last counted pass.

_none_

### Forks — run `/decision-walk .planning/reviews/phase1-closeout.hybrid.r1.review.md` (3)

Parked in the ledger, never resolved by the loop.

- **setup now reports success on a machine whose team clone is gone, and never re-clones it** — src/commands/setup.ts:183 (round 1) — Fork - a product call, not a code call. Everyone agrees the current behaviour is wrong: the wizard says it finished on a machine where the team folder is gone, and sync, ls, install and publish then all fail. The question is what setup should do instead. Option 1: quietly re-download the team folder from the address it already has on file, so the machine works after that one command (a little network work in a step the wizard calls "skipped", and it must also restore the name/email git needs for later writes). Option 2: stop and say "your team folder is missing - run team join <remote> to restore it"; smallest change, simply puts back the old non-zero exit, but leaves the user to run a second command. Option 3: hand the repair to the existing join command, reusing one blessed path but re-asking the login/name/email questions. Pick Option 1 if setup is the "fix my machine" wizard; pick Op
- **canonicalDigest still concatenates path and hash without domain separation, so the collision class the new test targets is only half-closed** — src/lib/skills.ts:73 (round 1) — Fixing the in-repo digest (option 1) is uncontroversial and nearly free — a few lines, and every ordinary skill folder keeps exactly the digest it has today. The open question is whether to also patch the copied-in file borrowed from another project (option 2). That same one-line record format lives there too, and there it guards the check that catches a hand-edited installed copy, so patching it closes the same hole in a second place. The price is that our copy of the borrowed file drifts further from the original, which means updating the attribution notes and the spec sentence that still calls it a verbatim copy, and a little more friction the next time that file is re-copied from upstream. That is a project-policy call about how much divergence from borrowed code is acceptable — the code cannot settle it — and there is precedent both ways, since the file already carries one documente
- **Hardened install cell blocks the backtick but the same hostile name still renders as a live link in the Skill cell** — src/lib/readme.ts:74 (round 1) — This hinges on a product call the code cannot settle, and the previous review already flagged it without deciding: should text that someone commits into a team repo (a skill's description, category, author, or folder name) be allowed to show up as a clickable link in the README the tool generates? If the answer is no, option 1 is the cheap and complete answer — it costs about five lines, normal text looks exactly the same to a reader, and it also covers the bot comment the Action posts on publish PRs, which this commit left alone. If the answer is yes (someone may legitimately want "see [our docs](…)" in a skill description), then option 3 is right: defang only the folder name the CLI itself would refuse to create, and leave the free-text columns as the earlier review deliberately left them. Option 2 is the strongest treatment of the single cell in the finding — a refused name is printed

### Eligible items not applied — mechanical or clear, with the reason (0)

_none_

### Contested — panel split, needs your adjudication (3)

- **reconcileOrphans is not gated by the new `busy` set: a busy team's stale clone yields false orphans, and answering the prompt can write a bogus `declined` (or fail the whole run)** — src/commands/sync.ts:182
- **Hoisting the foreign-collision inspect() moves a full config.json read + lstat into the no-op fast path of every sync** — /Users/ryanliu/Documents/Terum/terum-codex/phase1-closeout/src/commands/sync.ts:130
- **search.ts recomputes the install count with a full roster scan per hit while `installCounts()` builds the map once** — src/commands/search.ts:42

### Declined (1) — in `.planning/debug/harden/phase1-closeout.deferred.md`; delete an entry to re-raise it

- [loop] **Hoisting the foreign-collision inspect() moves a full config.json read + lstat into the no-op fast path of every sync** — src/commands/sync.ts:130 — contested 2-1; the collision reading must precede quarantineDrift and now sits inside the target lock; the per-placement config read is what the rename re-key needs; one lstat + one small parse per placement

### Unverified — beyond the verify cap (0)

_none_

### Untriaged (0)

_none_
