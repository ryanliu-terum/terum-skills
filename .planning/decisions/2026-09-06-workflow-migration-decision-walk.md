---
title: eval-integration CI and workflow-migration decision walk
date: 2026-09-06
north_star: Nothing — not even our own tool — can change what runs with the team's API key unless the guard has checked it; existing teams still get the new CI via a one-time step.
status: complete
deferred:
  - what: A guarded `team workflow-update` verb (Option 1 shape — through safeWrite, byte-exact template row, GitHub-admin-only) instead of manual migration (D1 gate tail)
    gate: the workflow template needs a second team-wide bump, or the count of existing team repos makes hand-migration unreasonable (roughly >10)
---

# Eval-integration workflow migration — Decision Walk

**North Star:** Nothing — not even our own tool — can change what runs with the team's
API key unless the guard has checked it; existing teams still get the new CI via a
one-time step. (Ratified in-session; the user proceeded to pick against it.)

**Source batch:** the Forks section of
`.planning/specs/reviews/2026-09-04-eval-integration.codex-spec.review.md` (second
codex-spec audit, 2026-09-06). Findings 2 and 14 are one underlying issue surfaced by
two dimensions; contested finding 21 dissolves with the same call.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | How existing team repos get the new CI workflow file | GATE | The tool never writes CI config — a human migrates each existing repo once by hand; the guard's refusal stays absolute with zero new machinery | Build the guarded verb only if the template needs a second team-wide bump or repo count outgrows hand-migration (~>10) |
| 2 | Whether CI runs model evals at all | LOCK | No — CI never runs a model and never holds an API key; every eval token anywhere is a member's own `claude -p` subscription. Hygiene stays blocking; the publish gate becomes a deterministic receipt check | — |

---

## Decision 1 — How existing team repos get the new CI workflow file

**Verdict: GATE** — manual migration now (Option 2); the guarded `team workflow-update`
verb (Option 1 shape) waits behind the named tripwire. Option 3 (a second write path
outside `safeWrite`) is rejected outright and is not the gated path.

### Plain English
- **What's at stake:** the CI workflow file is the most dangerous file in a team repo —
  whatever it says runs with the team's API key. Teams scaffolded before the eval CI
  existed need the new file somehow.
- **Why it's a fork:** the integration plan (rev 2) gave the tool a new command that
  writes this file while skipping the guarded write path — quietly breaking the locked
  "one exception ever" rule (M1-hardening Decision 3) and the AGENTS.md invariant. The
  audit flagged it; someone had to choose between building the write path properly,
  not building it at all, or formally widening the exception.
- **Options considered:**
  - **A (Option 1)** — build `team workflow-update` through `safeWrite`, with a new
    guard row (only the one workflow file, byte-identical to the shipped template) and
    a GitHub-admin-only predicate. *(Decides: worth it if migration recurs.)*
  - **B (Option 2, picked)** — no write verb. The CLI at most prints the current
    workflow YAML; a human with push access commits it via an ordinary PR, once per
    existing repo. The "CLI never writes `.github/workflows/**`" invariant stays
    absolute. *(Decides: cheapest and safest while existing repos number a handful.)*
  - **C (Option 3)** — keep the command outside `safeWrite` and record a second
    bounded exception everywhere. *(Rejected: reopens a LOCKed ledger row and leaves
    authorization enforced only by command-level code the guard doesn't back.)*
- **Recommendation given:** B now, A behind a tripwire — because the chore is one-time
  and tiny today, and the moment it stops being one-time is nameable in advance.
- **Zoom-out:** B is the strongest form of the North Star — the door stays the boss
  with zero new attack surface. Passes.
- **The call:** the user picked Option 2; recorded as GATE with the tripwire above.

### Technical
- **Spec edit implied (follow-up, not done in this walk):** rewrite
  `.planning/specs/2026-09-04-eval-integration.md` §1 IE4 "Migration for existing team
  repos" (the paragraph citing `team workflow-update` … "outside `safeWrite`"): the CLI
  gains only a read-only helper (`team workflow-update --print` or a docs snippet)
  printing the workflow YAML byte-identical to what `team create` scaffolds; the CLI
  never writes `.github/workflows/**`; no new `GuardAction`, no guard row, no
  `guardRawPush` change; phase-1 §6.0's single `safeWrite` exception is unchanged. §0
  gap-table row 7's "migration needed for existing team repos" becomes a manual,
  non-code step. Exit criteria gain: printed YAML byte-identical to the scaffold; a
  test asserts no verb stages a `.github/workflows/**` path.
- **What this dissolves:** confirmed findings 2 and 14 (the fork) and contested
  finding 21 (the missing admin predicate — moot, there is no write to authorize).
- **Standing decisions affected:** supersedes the operative shape of ajay's 2026-09-05
  "admin PR operation" call (its intent — no direct guarded writes to workflows —
  survives; its mechanism — a CLI verb outside `safeWrite` — does not). Leaves
  M1-hardening Decision 3 ("one write outside safeWrite") true as written, and
  `src/lib/__tests__/guard.test.ts`'s blanket workflow-refusal expectation untouched.
- **Effort / risk / blast radius:** near-zero code (a `--print` helper at most);
  removes a planned `GuardAction`, guard row, and adversarial auth suite from IE4's
  scope. No sibling spec edits needed.
- **Grounding findings:** none run — the audit's triage (2-vote confirmed, both
  forks) had already grounded the guard behavior (`src/lib/guard.ts:59-73`, guard
  test at `guard.test.ts:98`, §6.0 line 276, ledger Decision 3).

---

## Decision 2 — Whether CI runs model evals at all

**Verdict: LOCK** — the CI eval job is removed from the design. CI never runs a
model and never holds an API key.

### Plain English
- **What's at stake:** the planned CI had two robots — a free one that scans skill
  changes for dangerous content (secrets, hidden characters, bad licenses), and a
  paid one that ran full AI evaluations on every skill PR using an API key stored in
  the repo.
- **Why it's a fork:** the paid robot contradicted the project's own founding call.
  The eval engine was chosen precisely because it needs no raw API key — everyone
  runs evals through their own logged-in `claude -p` subscription. CI was the one
  place a raw key crept back in, because a CI robot has no personal login. Worse,
  the engine's own provenance rules (only same-model, same-CLI, same-environment
  numbers compare) mean CI verdicts would not be comparable to the locally-committed
  receipts everyone actually trusts — paid noise, structurally.
- **Options:** kill the eval job and keep hygiene (A); same, plus keep the publish
  regression gate as a deterministic receipt check (B); keep the design as specced (C).
- **Recommendation given:** B.
- **The call (Ryan):** "leave the hygiene check and take out the full eval." Recorded
  as: eval job removed; hygiene job stays blocking; **[default — veto cheap]** the
  publish gate survives as a receipt check — publish PRs must carry a fresh committed
  receipt (produced locally, candidate-vs-incumbent) that CI verifies exists, parses,
  and matches the skill's current version. Deterministic, key-free.
- **Zoom-out:** strengthens the North Star — the file that runs with the team's API
  key now never contains a key-bearing job at all.

### Technical
- **Specs touched:** `2026-09-04-eval-integration.md` §0 row 7 + §1 IE4 (eval job
  bullet removed, receipt check added, §3 Ryan column); `2026-09-04-eval-engine.md`
  §11 rewritten (rev 10) — the `ANTHROPIC_API_KEY`-from-repo-secrets path and the
  "neutral skip [provisional policy]" are deleted.
- **Supersedes:** the eval-job half of the CI-split decision (ajay, 2026-09-05); the
  skilldeck carry-over rule "CI runs on a repo-secret key"; eval spec §11's
  provisional skip policy. The hygiene-job half of the 2026-09-05 decision stands.
- **Dissolves:** contested audit finding 8 (whether CI commits receipts — CI no
  longer runs evals, so it commits nothing); shrinks finding 13's attack surface
  (raw finding, dropped by the panel) to nil — no key in CI to exfiltrate.
- **Effort / risk:** negative effort — deletes a job, a secret, and a skip-state
  from IE4's scope. The receipt check is a small deterministic script.
- **Grounding:** conceptual — grounded in the recorded engine decision (no raw key),
  the provenance comparability rules (eval spec §7/§12), and phase-2 OAuth findings.
