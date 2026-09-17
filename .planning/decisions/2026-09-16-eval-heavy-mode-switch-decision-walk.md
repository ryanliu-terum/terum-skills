---
title: Eval heavy-mode switch decision walk
date: 2026-09-16
north_star: For a skill that spawns subagents, the eval says plainly what it will run and roughly what it costs, asks only when the answer changes what runs, and never stalls a run nobody is watching.
status: in-progress
deferred: []
---

# Eval Heavy-Mode Switch — Decision Walk

**North Star:** For a skill that spawns subagents, the eval says plainly
what it will run and roughly what it costs, asks only when the answer changes what runs, and
never stalls a run nobody is watching.

**Context.** The 0.20.1 release check (session 185b9241, 2026-09-16) found that the eval's
"Use the one-session heavy evaluation mode?" question changes nothing: its answer is only
logged (`src/commands/eval.ts:195-200`, used at `:360`). It refuses in-session `/eval` on 8 of
12 harness skills and parks the desktop overnight queue on a dialog. Spec
`2026-09-15-eval-purpose-suites.md` §5 + §10.5 never defined what yes/no run — the spec harden
r1 raised it twice ("Heavy mode has incompatible session semantics", "Heavy-mode selection does
not define an implementable state machine") and PR #269 note 5 left it for this walk. Ryan chose
to define and build the switch in the 0.21.0 fix PR (`fix/eval-staging-heavy-switch`,
worktree `terum-codex/rel-fix-0210`) rather than stop asking.

Facts the walk rests on (7179ad4d):
- A skill with `evals/suite.yaml` and `evals/cases/*.yaml` runs **both** today (§3.2).
- `k` is `--k ?? 1` for every skill, heavy or not (`eval.ts:111`).
- The generator returned `cases` on 15 of 15 live calls; no skill gets a generated suite today.
- hybrid-review has only a suite; no team skill carries both assets.
- The frames channel (desktop) is `interactive: true` (`frames.ts:192`), so a desktop run shows
  the question as a dialog; the terminal refuses when stdin is not a TTY (`prompt.ts:61`).

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | What the heavy question chooses | LOCK | It picks which kind of test runs (suite vs cases) and is asked only when a skill has both | — |
| 2 | An explicit flag that asks for a missing asset | — | — | — |
| 3 | No one to answer (terminal without TTY, overnight drain) | — | — | — |
| 4 | How "heavy" is detected | — | — | — |
| 5 | Notice wording | — | — | — |

---

## Decision 1 — What the heavy question chooses

**Verdict: LOCK**

### Plain English
- **What’s at stake:** when you evaluate an expensive skill, the yes/no should change what actually runs.
- **Why it’s a fork:** today there is usually nothing to switch between — a skill has either one
  "suite" test (one session, many checks) or several per-task "case" tests, rarely both, and
  every skill already runs each test once by default.
- **Options:**
  - **A — the question picks which kind of test runs, asked only when a skill has both** (yes = the
    one-session suite only, no = the per-task cases only; a single-kind skill just runs what it has
    and shows the notice as information). *(Decides: honest and never costs extra; today nobody sees
    it because no skill has both.)*
  - **B — the question picks how many passes** (yes = one pass, no = three), asked for every heavy
    skill. *(Decides: always meaningful and matches "to reduce variance", but no triples the cost
    and duplicates `--k 3`.)*
  - **C — both** (yes = suite once, no = cases three times). *(Decides: two changes in one answer.)*
- **Recommendation:** A — it is what §10.5 already says ("the checkbox is per-case mode with the
  skill’s cases"), and repetition has its own flag.
- **Zoom-out:** A serves the North Star directly — the question exists only where its answer changes
  what runs.
- **The call:** A (Ryan, 2026-09-16).

### Technical
- **Files / code paths:** `src/commands/eval.ts` ≈303–350 — when both a suite (authored or generated)
  and cases exist, `heavy` selects `suite` (true) or `selected` cases (false); `expectedRows` and
  `provenance.cases` count only what ran; the question is asked only when both exist. `k` stays
  `--k ?? 1` in every mode.
- **Migration / schema:** none (receipt fields already describe what ran).
- **Effort / risk / blast radius:** small; bug risk 1 (row counts and `sign_p` must follow the asset
  that actually ran — `suiteRan` already drives `sign_p`). Spec §5 and §10.5 rewritten in the same PR.
- **Grounding findings:** both assets run today (§3.2, `eval.ts:303-350`); `k` defaults to 1 for all
  (`eval.ts:111`); no team skill carries both assets.

