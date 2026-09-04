---
name: decision-walk
description: Walk a batch of already-surfaced decisions/forks to recorded resolutions, one at a time, with the user making the genuine fork calls. Each decision is presented plain-English-first then technical; every pick is checked against the batch's overarching objective (the North Star); resolutions are LOCK / GATE / DEFER / DELEGATE. Produces a committed decision ledger. Use when a prior session produced a list of decisions that now need deciding — NOT for discovering decisions or implementing them.
---

You are walking a batch of decisions that have **already been surfaced** — by a scale
review, a spec audit, a design session, or a prior conversation. Your job is to take each
one to a **recorded resolution**, with the user making the real fork calls, and to write it
all down in a durable **decision ledger**.

You are NOT discovering the decisions (that already happened) and you are NOT implementing
anything (that's a later step). You resolve, and you record.

Precedent for the shape of the output: `project_foundation_first_decision_walk` and
`project_reliability_batch_decision_walk`.

---

## Principle 0 — Plain English, always, first

This is the most important rule in the skill. **Everything the user reads to make a
decision is in plain, everyday language — the way you'd explain it to a smart friend who
doesn't know this codebase.** No jargon in the decision layer. The technical detail comes
*after*, and only to back up what the plain-English part already said.

The test: the user must be able to choose from the plain-English lines **alone**, without
reading a single technical word. If they'd have to understand the technical part to decide,
the plain-English part isn't done yet.

This applies to the zoom-out, the options, the recommendation — all of it.

---

## Entry — where the decision list comes from

Find the batch of decisions in this order:

1. **Conversation context** (default) — a prior message this session surfaced the forks.
2. **A file** — `/decision-walk <path>` to a review, fork-list, or spec that lists them.
3. **Inline** — the user pasted the decisions with the invocation.
4. **Resume** — `/decision-walk <ledger-path>` points at an existing
   `.planning/decisions/*-decision-walk.md`. Re-open it and continue from the first
   unresolved decision. (Decision walks span sessions; the ledger file is the resume
   point. Do NOT re-litigate already-resolved decisions unless asked.)

If you can't find a clear list of decisions, STOP and ask the user what batch they want
walked. Do not invent decisions.

---

## Phase 1 — Establish the North Star

Before walking any decision, name the **one overarching objective the whole batch serves**,
in plain English, and get the user to ratify it.

This is not a restatement of the task — it's the actual *purpose*. Examples from real walks:
- "A safe place to test against real data without risking prod or real users."
- "Reliability at 50 users — cost is explicitly out of scope."
- "Least-privilege, read-only ingest."

Say it in one sentence and ask: "Is this the right thing to be optimising for?" Record the
ratified North Star at the top of the ledger. **It is the yardstick every decision is
measured against for the rest of the walk.**

If the user can't confidently state the objective, that's a sign the batch isn't ready to
walk — help them name it before proceeding.

---

## Phase 2 — Walk each decision (the loop)

Do the decisions **one at a time**. For each one:

### Step A — Ground it (only if needed)

If deciding well depends on how the code *actually behaves today* and you're not sure,
dispatch 1-2 `Explore` agents to check current behaviour and whether each option is even
feasible, BEFORE presenting options. Conceptual or obvious decisions skip this — don't
spawn agents for a decision you can already frame correctly. Grounding findings are
hypotheses; read the load-bearing code yourself before stating anything as fact.

### Step B — Present the decision (plain English first)

> **PLAIN ENGLISH — you can decide from this alone**
>
> - **What's at stake** — what this changes for a person using the product, or for the
>   system. No jargon.
> - **Why it's a fork** — the real tension, in plain terms. Why isn't the answer obvious?
> - **Options** (1-3, best first) — for each: **what it actually does and how that plays
>   out** in plain terms, plus **the one difference that decides between it and the others.**
> - **Recommendation** — which one, and the single reason it wins.
>
> **TECHNICAL — backs up the above, read if you want specifics**
>
> - Files / functions / code paths touched.
> - Migration or schema impact.
> - Effort · risk · blast radius (siblings that share the pattern).
> - What the grounding agents found (if any ran).

### Step C — Zoom out (direct, but not combative)

Before you lock anything in, step back and check the decision against the North Star, in
plain English. **Be direct:** if a pick looks like it doesn't serve the goal, say so clearly
and give a *real recommendation* — you have a spine here, don't soften it into a vague
question. But it stays the user's call: once they've heard the check and decided, record
their pick and move on. You name the tension and recommend; you don't badger, and you don't
refuse to move.

Two checks:

1. **Do the options even serve the goal?** Sometimes the *question itself* is wrong. If an
   option (or the whole framing) doesn't move the North Star, say so and reframe with a
   recommendation. Example: "We're asking how to fix this endpoint — but nothing uses it
   anymore, and the goal is a smaller failure surface. Fixing it doesn't help; removing it
   does. I'd delete it — any objection?"

2. **After the user picks — don't rubber-stamp it.** Run their pick against the North Star
   and land in one of three places:
   - **Pick fits the goal** → say *why* it fits, in one plain sentence, then record it.
     (Not silent agreement — an explicit "this gets us the safe-testing thing because…")
   - **Pick looks off** → name the mismatch directly and give a clear recommendation with
     the reason, then hand the call back. *"Hold on — let's line this up with what we're
     after: a safe place to test without touching real users. A separate setup does that,
     but so does a simpler shared one, with less to maintain. I'd go shared unless you
     specifically need it to mirror prod for release-testing. What's driving the split?"*
     Then take the user's decision.
   - **Pick reveals the goal was wrong** → the objective itself may be off. Step back,
     restate a corrected North Star, get it re-ratified, and re-check the decision against
     it.

**Goal-drift check (across decisions):** if the user's picks over several decisions keep
favouring a *different* objective than the ratified North Star, pause and say so plainly:
"Your last few calls point more at B than the A we locked at the start — should we update
what we're aiming for?" Better to catch a stale frame early than after three decisions
built on it.

**Tone rule:** direct, not combative. Name the mismatch and give a real recommendation —
don't hide behind a soft question. But you don't hold a line: when the user has heard the
check and still wants their pick, record it and move on.

### Step D — Record the resolution

Every decision ends as exactly one of these four verbs:

| Verdict | When it comes up | Carries |
|---|---|---|
| **LOCK** | Decided, build it now, no caveats. Most decisions. | — |
| **GATE** | Build the small version now; the bigger/expensive version waits behind a **named tripwire**. | the tripwire (e.g. "alert if >120s or >5k rows") |
| **DEFER** | Can't or shouldn't decide yet (missing data, unbuilt dependency, premature). No path chosen. | a revisit trigger |
| **DELEGATE** | Too big to resolve inline without derailing the batch — hand to its own session. | a pointer to that session/spec |

Quick test: *Build it now, no caveats?* → LOCK. *Small now, big only if evidence demands?*
→ GATE. *Can't decide yet?* → DEFER. *Needs its own session?* → DELEGATE.

A decision may carry a **split** — e.g. LOCK the core and DEFER the tail — when one fork
genuinely has a decide-now part and a wait part. Record both; it's not a new verb.

Write the decision (plain-English write-up + technical + verdict + rationale) into the
ledger immediately, then move to the next one. Writing as you go makes the walk resumable.

---

## Phase 3 — Close the walk

1. **Finish the ledger.** Ensure the §Decision Ledger table and every decision write-up are
   complete. Ledger location: `.planning/decisions/YYYY-MM-DD-<topic>-decision-walk.md`.

2. **Declare the deferrals in frontmatter.** For every decision that resolved **GATE**,
   **DEFER**, or **DELEGATE** — plus the deferred half of any **LOCK+DEFER split**, and any
   sub-fork punted inside a write-up (those are real deferrals even though they aren't ledger
   rows) — add an entry to the ledger's `deferred:` frontmatter block:

   ```yaml
   deferred:
     - what: <the fork that was punted, plain English, one line — cite the decision id, e.g. (D5)>
       gate: <the trigger that should make us revisit or unblock it>
   ```

   This is what feeds `.planning/DEFERRED-INDEX.md`, the single view of everything the team has
   consciously punted on. **Write it now, in the same pass as the decisions** — the index only
   ever collects what is explicitly declared, so an undeclared deferral is simply invisible, and
   nobody will remember to add it later. Do NOT add entries for LOCK (a decided call is not a
   deferral) or for rejected options. Avoid a literal `": "` inside a value so the block stays
   valid YAML. Full convention: `.planning/decisions/CONVENTIONS.md`.

3. **Commit it.** Stage only the ledger (and this walk's artifacts) — never `git add -A`.
   Commit message: `docs(decisions): <topic> decision walk`. No Co-Authored-By.
   (The pre-commit hook regenerates `DEFERRED-INDEX.md` and stages it alongside; if it warns
   that this walk declares no `deferred:` entry, you skipped step 2.)

4. **Summarise** in plain English: what's **LOCKED and ready to build**, what's **GATED**
   (and on what tripwire), what's **DEFERRED** (and waiting on what), what's **DELEGATED**
   (and to where).

5. **Optional handoff.** The LOCKED set is exactly what a build spec or the `writing-plans`
   skill consumes next. Offer it — don't force it.

6. **Optional memory pointer.** If this walk is a durable milestone, offer to add a
   `project_*_decision_walk` memory entry (+ MEMORY.md line), like the two existing ones.

---

## Ledger format

```markdown
---
title: <topic> decision walk
date: YYYY-MM-DD
north_star: <the one overarching objective, plain English>
status: in-progress | complete
deferred:                    # every GATE / DEFER / DELEGATE + split tails + sub-forks (Phase 3.2)
  - what: <the fork that was punted, plain English — cite the decision id, e.g. (D5)>
    gate: <the trigger to revisit or unblock it>
---

# <Topic> — Decision Walk

**North Star:** <the one plain-English sentence the whole batch is optimising for>

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | <short title> | LOCK | <one plain line> | — |
| 2 | <short title> | GATE | <one plain line> | alert if >120s |
| 3 | <short title> | DEFER | <one plain line> | until first team's data |
| 4 | <short title> | DELEGATE | <one plain line> | → its own session |

---

## Decision 1 — <title>

**Verdict: LOCK**

### Plain English
- **What's at stake:** …
- **Why it's a fork:** …
- **Options:**
  - **A —** … *(the difference that decides: …)*
  - **B —** … *(the difference that decides: …)*
- **Recommendation:** … — because …
- **Zoom-out (does this serve the North Star?):** … *(gentle, plain)*
- **The call:** … *(what the user decided, after the zoom-out)*

### Technical
- **Files / code paths:** …
- **Migration / schema:** …
- **Effort / risk / blast radius:** …
- **Grounding findings:** … *(or "none — conceptual")*

---

## Decision 2 — <title>
…
```

---

## Notes

- **One decision at a time.** Never dump the whole batch at once — the value is the focused
  back-and-forth per fork.
- **Don't fake forks.** If a decision is obvious, say what you'd pick and why in plain
  English and move on — don't manufacture options to look thorough (per the user's
  `explain-options` guidance).
- **Grounding findings are hypotheses.** Verify against live code before asserting.
- **Stay in your lane.** This skill resolves and records. It does not write feature code.
