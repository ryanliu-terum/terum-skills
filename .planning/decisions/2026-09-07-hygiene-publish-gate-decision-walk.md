---
title: hygiene predicate and publish gate decision walk
date: 2026-09-07
north_star: The hygiene gate blocks smuggled instructions and secrets without ever blocking a teammate's legitimate skill — and the publish gate blocks regressions without ever blocking a first, honest publish.
status: complete
deferred: []
---

# Hygiene predicate & publish gate — Decision Walk

**North Star:** The hygiene gate blocks smuggled instructions and secrets without ever
blocking a teammate's legitimate skill — and the publish gate blocks regressions without
ever blocking a first, honest publish. (Ratified in-session.)

**Source batch:** round-3 codex-spec audit of the eval-integration plan
(`.planning/specs/reviews/2026-09-04-eval-integration.round3.codex-spec.review.md`):
the one triage fork (finding 22) plus the four contested findings (7, 12, 15, 6).
The nine clear findings were not walked — they carry drafted, judgment-free fixes.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Mixed-script rule (HYG2) | LOCK | One alphabet per word (digits/punctuation always fine) — catches the hidden look-alike-letter trick with a simple rule; honest multilingual text mixes alphabets between words, not inside them | — |
| 2 | Publish receipt-gate predicate | LOCK | Receipt always required at exact version; incumbent comparison present → must be not-FAIL; absent → CI verifies no prior version exists and allows the first publish. Contested 7 = duplicate of confirmed 25 | — |
| 3 | Stale publish tests in phase-1 spec | LOCK | The sibling's test/acceptance rows still demand branch reuse + `-2` fallback the R2 ruling and landed code replaced; rewrite them to the create-only `publish/<name>-<handle>-<id8>` contract | — |
| 4 | Publish inspection race | LOCK | Hygiene moves inside the replayed publish mutation, running against each attempt's fresh tree, with a race regression test — a same-skill edit landing mid-publish can no longer be endorsed uninspected | — |

---

## Decision 1 — Mixed-script rule (HYG2)

**Verdict: LOCK — Option A (single script per token).**

### Plain English
- **What's at stake:** the scanner must catch letters from another alphabet that look
  identical to ours (a Russian "а" inside "pаyment") — the classic way to smuggle
  hidden instructions past a human reviewer. Yesterday's rule said two opposite things.
- **Options:** A — no alphabet-mixing inside a single word (digits/punctuation always
  fine); B — flag only known look-alike characters (needs Unicode's confusables table
  vendored and maintained); C — allow one foreign alphabet per word (the attack passes;
  fails the gate's purpose).
- **Recommendation:** A — the only option both implementable this week and effective.
- **The call (Ryan):** A.
- **Zoom-out:** serves both halves of the North Star — the trick is blocked; honest
  multilingual prose passes because it mixes alphabets between words, not within them.

### Technical
- HYG2 in eval spec §9 (rev 12 → 13): per whitespace-delimited token, all letters share
  one Unicode Script value; Common/Inherited always permitted. Implementable with
  `\p{Script=…}` regexes, no data tables. Resolves the self-contradiction toward the
  homoglyph-fails clause. Known honest casualty: hyphenated cross-script tokens
  ("GitHub-репозиторий") — rewritable by the author on a clear error message.
- Grounding: none — `hygiene.ts` is unbuilt; this defines it.

## Decision 2 — Publish receipt-gate predicate

**Verdict: LOCK** — contested finding 7 upheld as duplicate of confirmed finding 25.

### Plain English
- As written, the gate blocked every brand-new skill (no previous version → the
  required old-vs-new comparison cannot exist) while admitting a skill whose own
  receipt says the new version LOST — backwards on both ends.
- **The predicate:** a current, schema-valid committed receipt at the skill's exact
  version is always required; when it carries a candidate-vs-incumbent comparison,
  that comparison must be not-FAIL; when it carries none, CI verifies no prior
  version of the skill exists and the first publish proceeds.
- **The call (Ryan):** LOCK as stated.

### Technical
- Applied via confirmed finding 25's drafted fix (IE4 receipt-check paragraph +
  eval spec §6.1/§11). Requires pinning a deterministic incumbent rule (unverified
  finding 24) — done in the same apply pass as a veto-cheap default: incumbent = the
  most recent receipted tree-hash for the skill id excluding the candidate's own,
  by run-id order; none → first-publish path.

## Decision 3 — Stale publish tests in the phase-1 spec

**Verdict: LOCK** — contested findings 12 and 6 upheld (one defect, two citations).

### Plain English
- The phase-1 spec still tells testers to verify branch-reuse and "-2 fallback"
  behavior that the R2 ruling and the landed code deliberately replaced with fresh,
  create-only branches. Testing behavior the product no longer has helps no one.
- **The call (Ryan):** rewrite the sibling's §1.4/§1.5 test rows and the acceptance
  row to the create-only `publish/<name>-<handle>-<id8>` contract (no reuse, no
  fallback, multiple independent endorsement branches).

### Technical
- Sibling: `.planning/specs/2026-09-02-phase-1-build.md` (its rev counter bumps).
  Live shape verified in `src/commands/publish.ts` (destination at `:55`; the vet
  at `:155-163` checks legacy forms only to avoid collisions). Consistent with the
  R2 ruling in `.planning/decisions/2026-09-06-phase1-rulings-batch.md`.

## Decision 4 — Publish inspection race

**Verdict: LOCK** — contested finding 15 upheld.

### Plain English
- Publish checks the skill, then writes — but the write machinery re-syncs to the
  team's latest state and retries, so a teammate's edit to the same skill landing in
  that gap gets endorsed without anyone having scanned it. A secret pasted in that
  window sails through.
- **The call (Ryan):** the safety scan runs inside the retried write itself, against
  whatever content that attempt actually endorses; a test proves the race is closed.

### Technical
- IE1's publish bullet (integration spec): `inspectHygiene` moves into the mutation
  replayed by `safeWrite` (`src/lib/teamRepo.ts` fetch/reset/replay), against the
  fresh clone tree per attempt; exit criteria gain a race test (skill gains a secret
  between preflight and `safeWrite` → publish refuses). CI's hygiene job cannot
  cover this — publish PRs touch only `team.json`.
