---
title: auto-share batching decision walk
date: 2026-09-10
north_star: It finishes, unattended — every skill on a machine reaches the team completely and promptly without anyone babysitting it.
status: complete
deferred:
  - what: Ajay's first-run review-screen item was closed as unnecessary rather than answered, without his input (D3, D4)
    gate: ajay's response once he is told; reopen if he objects
  - what: Repeated push failures rewrite the id line in every candidate's SKILL.md on each retry, because ids are re-minted per attempt (D2)
    gate: anyone reports id churn in their own files, or a pass is seen failing repeatedly
  - what: Raising the session-hook timeout above 60s for headroom was rejected in favour of a batch cap (D5)
    gate: the pass is measured above ~50 seconds in normal use
---

# Auto-share Batching — Decision Walk

**North Star:** It finishes, unattended — every skill on a machine reaches the team completely and promptly without anyone babysitting it.

Ratified by Ryan 2026-09-10, over the alternative framing ("nothing about the repository or your files changes in a way you can't later explain"). The completion frame is what makes the batched push worth its write-path risk.

**Why this batch exists.** Auto-share is a background pass that shares local skills to the team with no prompt, run from the session-start hook. Measured on this machine: 88 global skill folders, 87 of them candidates. Each skill costs its own two fetches and a push — measured at 0.85s and 1.1s against the real remote — so the pass needs about **4.3 minutes**. The hook is killed at **60 seconds**. The first mass upload has therefore never completed; it dribbles roughly 20 skills per session and re-tries on the next one.

**Team-record check:** `check_decision` timed out twice during this walk. Nothing was verified against the shared record — treat every decision here as unchecked against standing team decisions, not as cleared.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Per-skill commits vs one commit for the pass | LOCK | Keep a commit per skill, batch only the push — the push is what costs a second, the commit costs nothing | — |
| 2 | Write the user's file before or after the upload | LOCK | Keep today's order; an interrupted run then heals itself, and interruption is the normal case | — |
| 3 | A review screen before the first mass upload | LOCK | No screen; make the pass fast enough to finish unattended | ajay may object — see D4 |
| 4 | Does this need ajay's sign-off first | LOCK | Build it, tell ajay, let him object | notify ajay and record the supersede |
| 5 | Should the category classifier run in the pass | LOCK | Yes — measured at 37s for 88 skills, it fits the budget; cap the batch so a huge catalogue degrades instead of failing | — |

---

## Decision 1 — Per-skill commits, or one commit for the whole pass

**Verdict: LOCK** — keep a commit per skill; batch only the push.

### Plain English
- **What's at stake:** whether the team's history still records when each skill arrived and who brought it, once the pass stops uploading them one at a time.
- **Why it's a fork:** I first assumed speed meant giving up that history. It doesn't. The expensive part is the round trip to the server, not the commit — a commit takes milliseconds. But separating the two means changing the function that writes to the shared repository, which is the most safety-critical code in the project.
- **Options:**
  - **A — Keep per-skill commits, batch the push.** A second write function alongside the existing one: many changes, a commit each, one push at the end. *(the difference that decides: you keep the history and the speed, and pay in a second function that duplicates part of the first)*
  - **B — One commit for the whole pass.** Reuses the existing function untouched; 87 skills arrive as one entry. *(the difference that decides: looking up when a skill arrived stops working, permanently)*
  - **C — Change nothing, accept the 60-second kill.** *(the difference that decides: no risk, but the upload stays half-finished for days)*
- **Recommendation:** A.
- **Zoom-out:** A is both the fastest option and the one that keeps provenance; the only cost is a new function rather than a change to the working one.
- **The call:** A.

### Technical
- **Files / code paths:** `src/lib/teamRepo.ts` — a multi-mutation sibling of `safeWrite`: acquire the lock once, fetch and reset once, then per candidate build the tree, run the guard, apply, stage and commit; one push at the end; on a retryable rejection reset and redo every commit. README regeneration runs once at the end rather than per commit. `safeWrite` itself is left untouched so the interactive path cannot regress.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** the write path. The existing single-skill function is unchanged, which is the whole point of building alongside rather than refactoring.
- **Grounding findings:** `safeWrite` welds commit and push together inside one retry loop (lock → fetch → reset → one mutation → guard → commit → push). Measured against the live remote: fetch 0.85s, push 1.1s; `connectOne` does two fetches and one push per skill, so ~3s each, ~4.3 minutes for 87.

---

## Decision 2 — Write the user's file before or after the upload

**Verdict: LOCK** — keep today's order: local file first, then upload.

### Plain English
- **What's at stake:** sharing a skill both stamps an identifier into your own file and uploads a copy. Which happens first decides what state you are left in when the run is interrupted.
- **Why it's a fork:** I recommended flipping this the turn before, reasoning that a failed upload shouldn't leave 87 of your files modified. Checking the interrupted case reversed it. Because the pass is killed at 60 seconds as a matter of routine, interruption is the normal case, and the two orders fail very differently.
- **Options:**
  - **A — File first, then upload (today's order).** A failed upload leaves your file carrying an identifier the team doesn't know. The next pass sees an unrecognised identifier, mints a fresh one and uploads it. *(the difference that decides: an interrupted run always recovers by itself)*
  - **B — Upload first, then write the file.** Cleaner when the upload fails. But a death between the upload and the write leaves the team holding a skill your file doesn't know about, and the next pass sees a name that already exists, refuses it, and keeps refusing. *(the difference that decides: it trades a self-healing failure for one that wedges silently)*
- **Recommendation:** A, reversing my earlier advice.
- **Zoom-out:** self-healing is exactly the property an unattended pass needs; a state needing a human to unwedge it is the opposite of the North Star.
- **The call:** A.

### Technical
- **Files / code paths:** `src/commands/connect.ts` `connectOne` — the `source-mutated` phase keeps its position ahead of the write.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** none — this is a decision not to change something.
- **Sub-fork punted:** identifiers are re-minted per attempt, so a repeatedly failing push rewrites the id line in every candidate file each time. Noisy, not lossy. Declared as a deferral.

---

## Decision 3 — A review screen before the first mass upload

**Verdict: LOCK** — no review screen; make the pass fast enough to finish.

### Plain English
- **What's at stake:** on this machine the first run pushes 87 of your skills to the shared repository, stamped with your authorship and licence, and the first you hear of it is a one-line summary afterwards.
- **Why it's a fork:** ajay's spec has an unresolved item asking for a screen listing what is about to upload, "even under blanket consent" — agreeing in principle to mirroring is not agreeing to these 87 things right now. But the pass runs with nobody watching and is forbidden from asking questions, so there is nowhere to put a screen. Cutting the other way: the unattended first run has never completed, so "unattended" today means "never finishes", not "quietly works".
- **Options:**
  - **A — First run attended, steady state automatic.** The pass defers a large first batch and prints one line telling you to run it yourself. *(the difference that decides: the only version where the first upload finishes, and it answers ajay's item instead of overruling it)*
  - **B — No screen; make it fast.** The batched push brings the pass under the limit so it completes on the first try. *(the difference that decides: 87 skills reach the team with nobody having seen the list)*
  - **C — Screen in the desktop app only.** *(the difference that decides: someone else's work on someone else's schedule)*
- **Recommendation:** A.
- **Zoom-out:** B is the most direct expression of the ratified North Star — it is the option that makes the pass genuinely finish unattended. Its cost is that it closes ajay's open question by deciding it does not need answering.
- **The call:** B.

### Technical
- **Files / code paths:** none beyond D1's batching; this decision is that no new surface is built.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** the risk is social, not technical — it resolves a teammate's open question in his absence. Carried into D4.

---

## Decision 4 — Does this need ajay's sign-off first

**Verdict: LOCK** — build it, tell ajay, let him object.

### Plain English
- **What's at stake:** this is ajay's mechanism, ratified 2026-09-10. The batching changes how it writes, and D3 closed one of his open questions without him.
- **Why it's a fork:** every gate, filter and rule he specified is preserved exactly, so the batching really is an implementation detail beneath his design. Closing the review-screen question is not — that is a design call of his that someone else just made.
- **Options:**
  - **A — Spec it, get sign-off, then build.** *(the difference that decides: he may know why he wanted the screen)*
  - **B — Build it, tell him, let him object.** *(the difference that decides: faster and reversible, at the cost of re-deciding a teammate's mechanism unasked)*
  - **C — No sign-off; it is a performance fix.** *(the difference that decides: true of the batching, untrue of the review-screen ruling)*
- **Recommendation:** A.
- **Zoom-out:** B serves the North Star's urgency and the work is reversible, but it leaves a teammate to discover a closed question after the fact. The obligation to tell him is part of the decision, not a nicety.
- **The call:** B — with telling ajay recorded as a required follow-up, not an optional one.

### Technical
- **Files / code paths:** none.
- **Grounding findings:** `check_decision` timed out twice; nothing here was verified against the shared team record.

---

## Decision 5 — Should the category classifier run inside the pass

**Verdict: LOCK** — yes, one call per pass, with a size cap.

### Plain English
- **What's at stake:** whether skills shared by the background pass arrive with a real category or arrive as "misc" and wait for someone to fix them later. The pass is how most skills will reach the team, so this decides whether category browsing works at all.
- **Why it's a fork:** it looked impossible. I estimated classifying 87 skills at 60–90 seconds against a 60-second budget, and recommended keeping the model out of the pass entirely. Measuring it changed the answer: **88 skills in one call took 36.8 seconds**, answered every one, invented no categories, and cost about ten cents. Classification plus a batched push is roughly 40 seconds — inside the existing budget.
- **Options:**
  - **A — One call per pass, with a size cap.** Above the cap the overflow is stamped "misc" rather than blowing the budget. *(the difference that decides: your catalogue fits comfortably, and a far larger one degrades instead of failing)*
  - **B — Classify unconditionally, no cap.** *(the difference that decides: simpler, with no floor under a pathological catalogue)*
  - **C — Never classify in the pass.** *(the difference that decides: the recommendation I was about to make, now unjustified — the constraint it rested on turned out not to exist)*
- **Recommendation:** A.
- **Zoom-out:** A serves both this batch's North Star and the earlier one — the pass finishes, and every skill it shares arrives categorised, which was the original point of the whole effort.
- **The call:** A.

### Technical
- **Files / code paths:** the batched classifier from `.planning/specs/2026-09-10-auto-category.md` §4, called once from `autoShareRoots` before the write.
- **Sequencing that matters:** classify **before** taking the writer lock. The 37 seconds needs no lock; sequenced this way the lock is held only for the ~3-second push, better than today's 87 acquire-and-release cycles. Non-interactive callers give up on the lock after 4 seconds, and parallel sessions are normal here.
- **Default chosen here (veto cheap):** cap at 150 candidates per pass.
- **Effort / risk / blast radius:** small on top of D1.
- **Grounding findings:** 88 skills, 77,053 prompt characters, one call, 36.8s wall, $0.0963, 88/88 answered, zero out-of-list answers, all eight categories used (workflow 37, infra 14, review 8, misc 8, research 7, docs 6, testing 5, debugging 3). My earlier 60–90s estimate extrapolated from a 15-skill run and was wrong: cost scales with output, not input size.

---

## Consequence for the earlier walk

`.planning/decisions/2026-09-10-auto-category-decision-walk.md` gated a bulk re-label command behind a team with a real backlog. D5 does not open that gate: the pass now categorises everything it shares, so the only skills left on "misc" are the five already in the team repository, which that walk already resolved as a manual pass.
