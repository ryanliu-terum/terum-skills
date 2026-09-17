---
title: Publish run host decision walk
date: 2026-09-14
north_star: The app must never be hostage to a publish, and a publish must never be silently lost — including a backgrounded publish that finishes or fails while you are somewhere else.
status: complete
deferred:
  - what: ReconcileDialog's own publish loop still calls backend.publish directly, bypassing the run host (D1)
    gate: when the host lands and Reconcile's mixed install+publish loop next needs changing
  - what: Install and Remove still run inside the skill page and are cancelled by leaving it; moving them onto the publish run host would finish the 2026-09-10 one-operation-path decision (D4 option C)
    gate: when install or remove next needs changing, or when a second operation is reported lost on navigation
  - what: eval keeps the two holes publish is fixing — no force-abandon when a run ignores cancel, and no surfacing of a backgrounded run that finished or failed (D2, North Star clause 2)
    gate: when someone hits a wedged eval, or when the eval chip is next changed
---

# Publish Run Host — Decision Walk

**North Star:** The app must never be hostage to a publish, and a publish must never be
silently lost — including a backgrounded publish that finishes or fails while you are
somewhere else.

Ratified with an amendment. The handoff's original wording was the same first clause plus
"a publish must never be silently lost". Grounding the walk showed the eval pattern being
copied satisfies clause 1 and **breaks** clause 2: the top-bar chip renders only while
`state==='running'` (`TopBar.tsx:30`) and `dismiss()` keeps a running run alive while
closing its dialog (`EvalRunProvider.tsx:52`), so a backgrounded run that finishes — or
**fails** — surfaces nothing at all. Survivable for eval, where the score lands on the skill
card. Not survivable for publish, whose entire output is *which of three things happened*
(minted / identical-bytes / project-only, `publish-outcome.ts`), and whose failures would
otherwise be invisible. Clause 2 is therefore binding on the port.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Single publish routes through the host too | LOCK | Navigating away from a skill page already cancels a single publish silently — the defect is not bulk-only | — |
| 2 | What Stop means mid-queue | LOCK | Stop kills the row in flight, as it does today; a second Stop frees the app if the first is ignored | — |
| 3 | One publish at a time, not a queue | LOCK | Publishes cannot run side by side anyway, so a queue buys a saved trip and costs Stop its single meaning | — |
| 3b | Publish and eval may run together | LOCK | They share the team copy only per save, not for the whole run; blocking would stop publishing all night during the eval drain | — |
| 4 | Mid-publish, the skill page keeps its dismissible box | LOCK | Install and Remove keep their box open while working; publish leaving that shared promise would give one page two behaviours with no warning | — |

---

## Decision 1 — Does single-skill publish route through the background host, or only bulk?

**Verdict: LOCK — both single and bulk route through the host.**

### Plain English
- **What's at stake:** whether clicking away from a skill's page mid-publish kills the publish.
- **Why it's a fork:** bulk is the obvious victim because it is long. Single publish has the
  same defect but is less obvious, so "not worth a chip" is arguable — a chip for a
  twenty-second operation may be clutter.
- **Options:**
  - **A — Both.** One host, one chip, one set of rules. *(The difference that decides: single
    publish is cancelled by navigation today, so "bulk only" leaves the North Star violated on
    the path people use most.)*
  - **B — Bulk only.** Smaller change, no chip for short operations. *(The difference: keeps a
    known way to silently lose a publish.)*
- **Recommendation:** A — the defect is real, not hypothetical.
- **Zoom-out (does this serve the North Star?):** Directly. The chip becomes the single place
  any publish is visible, and routing single publish through it closes the
  navigation-cancels hole on the most-used path.
- **The call:** A. Both. Reconcile explicitly NOT folded in — recorded as a deferral.

### Technical
- **Files / code paths:** `SkillScreen.tsx:85` unmount effect cancels `activeRun`;
  `SkillScreen.tsx:142` re-keys `SkillPage` on `ref:mock:path:root`, so navigation unmounts
  and cancels. `closeDialog()` cancels as well. Single publish reports through a page-local
  `setNotice(...)`, which must move somewhere route-independent.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** `SkillScreen`'s publish path plus the new provider. Third
  publish call site — `ReconcileDialog.tsx:68` — stays outside the host by decision.
- **Grounding findings:** Terum standing decision (ryanliu, 2026-09-10) keeps
  install/uninstall/move/connect/publish on one shared app-level operation path, which
  supports A. `MachineRemovalProvider` is already a second instance of this host pattern, so
  the shape is established rather than novel.

---

## Decision 2 — What does Stop mean mid-queue?

**Verdict: LOCK — today's semantics, moved behind the chip; plus a second Stop that force-abandons.**

### Plain English
- **What's at stake:** eight skills publishing, four done, one in flight. You press Stop.
  Does the one in flight get killed, or does it land first?
- **Why it's a fork:** killing now is responsive but leaves one row in an "I don't know what
  happened" state. Letting it land gives every row a definite answer, but Stop itself then
  takes ten to thirty seconds — a small version of the hostage problem we are fixing.
- **Options:**
  - **A — Keep today's semantics.** Stop kills the active row; rows after it read "Not
    started"; finished rows keep their outcomes. *(The difference that decides: the ambiguity
    B protects against is already solved — if the publish landed before the kill, the row
    reports the real version rather than "Cancelled".)*
  - **B — Let the active row finish, then stop.** Every row ends definite. *(The difference:
    Stop is no longer immediate, and does nothing at all against a row that hangs.)*
  - **C — Two-stage Stop.** First press lets the row land and stops the queue; second press
    force-kills. *(The difference: solves both, at the cost of a button meaning two things.)*
- **Recommendation:** A.
- **Sub-fork — what gets you unstuck when Stop is ignored:** the port removes an escape hatch
  that exists today only by accident. Options were: a second Stop that makes the app let go;
  nothing, so you quit and reopen (what eval does today); or an automatic give-up after a
  wait we would have to invent.
- **Zoom-out (does this serve the North Star?):** Both halves do. Stop stays instant, so the
  app is never hostage to the row in flight; and the second press means a publish that
  refuses to quit can never wedge the app into refusing every later publish.
- **The call:** A, plus **a second Stop force-abandons** — the provider stops waiting on the
  run, marks the row cancelled, releases the single-flight lock, and refetches clone-backed
  reads.

### Technical
- **Files / code paths:** today's behaviour is `BulkPublishDialog.tsx:94-102` (cancel) and
  the loop's cancel handling at `:73-85`. The finished-before-cancel branch at `:74-80` must
  survive the refactor — it is what makes A's ambiguity a non-issue. The escape hatch being
  replaced is `:96-98` leaning on the unmount cleanup at `:40-47`.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** force-abandon is new behaviour with no precedent in the
  repo — eval has the same wedge and never addressed it. Fixing it here means publish and
  eval diverge on this one point until eval is brought along.
- **Grounding findings:** cancelling mid-row is safe by construction. The version write is a
  single `safeWrite` commit+push (`publish.ts:259`); the profile entry is a **second,
  independent** `safeWrite` running after it, whose failure is explicitly not reported as a
  failed publish (`publish.ts:380-392`). A kill therefore lands on one of two clean states,
  never a torn one.

---

## Decision 3 — One publish at a time, or a real queue?

**Verdict: LOCK — single-flight, refused with a sentence. And publish does NOT block on eval.**

### Plain English
- **What's at stake:** you are publishing eight skills; halfway through you open another skill
  and press Publish. What happens?
- **Why it's a fork:** refusing is honest and simple but a dead end — you have to remember to
  come back. Queuing is friendlier, but then Stop has to answer a harder question (stop this
  one, or stop everything?) and you can pile up work you have forgotten you asked for.
- **The fact that settles it:** publishes cannot actually run side by side. They all save into
  the same shared copy of the team repo, one at a time. A queue would not make anything
  faster — it would only save a trip back.
- **Options:**
  - **A — Refuse, naming what is already running.** *(The difference that decides: the only
    option where Stop keeps meaning exactly one thing.)*
  - **B — Queue it behind the current batch.** *(The difference: convenience, paid for with a
    two-meaning Stop and work you can lose track of.)*
- **Recommendation:** A, same as eval's `assertAvailable`.
- **Sub-fork — may a publish and an eval run at once?** Grounding reversed the expected
  answer. Because evals also write the team copy, and because `MachineRemovalProvider` refuses
  outright while an eval runs, the expectation was to refuse. The clone writer lock is
  acquired per `safeWrite` and released after the push — seconds, not the length of a run — so
  the two contend only briefly and with a bounded, reported wait. Refusing would mean the
  automatic overnight eval drain silently blocks every publish all night.
- **Zoom-out (does this serve the North Star?):** Yes, on both halves. Refusal is a sentence
  rather than a wedge, so the app is never hostage; and letting publish proceed during an eval
  avoids inventing a new way to be blocked. Nothing is lost silently — a refusal is visible by
  construction.
- **The call:** A, and publish and eval may run at the same time.

### Technical
- **Files / code paths:** mirror `EvalRunProvider.tsx:16` `assertAvailable` — an `inFlight`
  ref and a thrown sentence naming the running request. Do **not** copy
  `MachineRemovalProvider.tsx:17`'s refuse-while-eval-runs guard; that guard exists because
  uninstalling the machine mid-eval is meaningless, not because of lock contention, so the
  precedent does not transfer.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** small. The refusal sentence is the whole surface.
- **Grounding findings:** the per-clone writer lock is acquired inside `safeWrite`
  (`teamRepo.ts:187`) and released after the push, with contention bounded by `lockWaitMs` and
  surfaced as the `CloneBusy` message (`teamRepo.ts:653-661`). Eval writes receipts through
  the same `safeWrite` (`eval.ts:646`), so publish-vs-eval contention is per-write and
  self-reporting, not run-length.

---

## What this walk locks for the build spec

1. A `PublishRunProvider` mounted inside `PromptProvider`, outside the router, with **no
   unmount cleanup** — and a host mounted inside `HashRouter`, outside `RouteView`.
2. **Both** single and bulk publish route through it (D1). `ReconcileDialog` does not, by
   decision.
3. Queue state — rows, cursor, active run — moves out of the dialog's `useState` into the
   provider, or rows reset on dismiss and reopen.
4. Stop keeps today's semantics, including the finished-before-cancel branch; a **second**
   Stop force-abandons (D2).
5. Single-flight, refused with a sentence; no mutual exclusion with eval (D3, D3b).
6. The chip must surface a backgrounded publish that **finished or failed**, not only one
   that is running — the North Star's binding clause 2, and the one place a verbatim eval port
   would have been wrong.

## Decision 4 — What the skill page shows mid-publish

**Verdict: LOCK — publish keeps the confirmation box, and the box becomes dismissible.**

*Added 2026-09-14 after the first Codex implementation run. The build exposed a contract the
spec had not noticed, so this ledger reopened for one decision.*

### Plain English
- **What's at stake:** what you see on a skill's page while that skill is publishing.
- **Why it's a fork:** Install and Remove both keep their confirmation box open while they
  work — it shows the current step, greys the action button, leaves Cancel live, and closes
  when the run settles; on failure the box closes and the error lands on the page. Publish did
  exactly the same until this change handed it to the background host the instant you press it.
  These are not publish-specific tests: they are `it.each(['install','remove','publish'])`,
  one shared promise asserted across all three operations. Publish stepped out of a contract
  the other two still keep, and nothing warns you before you press.
- **Options:**
  - **A — Publish goes its own way** (what the first build did). *(The difference that decides:
    one page, two behaviours, no way to tell which you get.)*
  - **B — Publish keeps the box, and the box becomes dismissible.** Steps and Cancel exactly as
    Install and Remove, but dismissing drops the run into the chip rather than cancelling it.
    *(The difference: keeps all three telling one story AND still lets you walk away.)*
  - **C — Move Install and Remove onto the host too.** *(The difference: a much larger job than
    this change.)*
- **Recommendation:** B, with C recorded as the eventual destination.
- **Zoom-out (does this serve the North Star?):** On both clauses. The box is dismissible, so
  the app is never hostage to a publish; dismissing hands the run to the chip rather than
  killing it, so nothing is silently lost. And it does that without splitting one page into two
  behaviours.
- **The call:** B. C is declared as a deferral, not attempted here.

### Technical
- **Files / code paths:** the shared contract is `desktop/src/screens/skill/__tests__/progress.test.tsx:58`
  (CLI step in `role="status"`, primary disabled, Cancel enabled, dialog closes on settle) and
  `:92` (failure closes the dialog and exposes the page's error board with the CLI sentence).
  Both must keep passing for all three kinds.
- **The cost B carries:** the run would otherwise be drawn twice. The page's own publish dialog
  and `PublishRunDialogHost` must never both render — the host's `dialogOpen` has to be false
  while the page's dialog is up, and dismissing the page's dialog is what sets it true.
- **Effort / risk:** larger than A, which is already built. A's cheapness is exactly what hid
  the problem: it passes by splitting the `it.each` and dropping the shared promise.
- **Grounding findings:** the 2026-09-10 team ruling (ryanliu, via Terum) keeps
  install/uninstall/move/connect/publish on one shared app-level operation path. C *is* that
  ruling finished; B keeps faith with it without widening this change.
