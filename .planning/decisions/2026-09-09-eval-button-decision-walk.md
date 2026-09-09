---
title: Eval button (the 0.1.7 Skill screen Eval affordance) decision walk
date: 2026-09-09
north_star: The desktop app is the place where a team member does everything they'd otherwise type into a terminal, using their own Claude login and their own money, without ever being handed a command to go run somewhere else, and without the app ever spending that money on their behalf without them saying yes.
status: complete
deferred:
  - what: A determinate progress bar for in-app eval runs; the CLI emits no progress frames today, so the running state is lines plus a busy indicator (sub-fork of D1)
    gate: when the CLI's execution.ts emits io.progress frames and features.progress flips (S7ae)
  - what: Card lift/verdict chip on the real adapter (D4) — the drawn Not-evaluated suggestion is invisible on cards until liftOnCards flips
    gate: S7v ships the liftOnCards flip and estimate labelling
---

# Eval button — Decision Walk

**North Star:** The desktop app is the place where a team member does everything they'd otherwise type into a terminal, using their own Claude login and their own money, without ever being handed a command to go run somewhere else, and without the app ever spending that money on their behalf without them saying yes.

Context: surfaced by the 2026-09-09 investigation of the 0.1.7 Skill screen Eval affordance (Ryan clicked Eval and got a terminal command). The in-app path exists end to end (`Backend.eval`, the tauri adapter's `run(['eval', …])`, the run-eval dialog, the `execute` handler, the mock test) and is gated by `FRAME_FEATURES.runEvalInApp:false` in `src/lib/frames.ts:42`, honoured by `SkillScreen.tsx:43` and `SkillCard.tsx:15`; batch S7v (tranche 2) owns the flip. Two further defects survive a bare flip: the global `PrintContext` (`app/providers.tsx:23`) drops every eval print line, and the real adapter never reads eval receipts (`tauri/index.ts:72-73` `receipt:null`, `:290` receipts gap). The eval verb needs a team clone, network, and a logged-in `claude` on PATH; it has no API key of its own; it runs tens of minutes; it emits print frames only (no ask, no progress); cancel kills the process group. Grounded against origin/main @ 279830d on 2026-09-09.

Ratified by Ryan 2026-09-09 (North Star).

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | §12 wording: which sentence governs the Eval button | LOCK | Ryan's D11 draft governs: the UI hands the run to the CLI through the Prompter over `--frames`. Driving the CLI is the standing 2026-09-08 rule for every verb and is not spawning an agent in-process (the CLI still spawns `claude`). PR #68 clause (b) is the terminal hand-off the North Star forbids; it is amended in review, not merged as written. The Eval batch ships the flag flip with a streaming WorkflowDialog and an adapter receipt reader. | — |
| 2 | "Commit the receipt to the team" default in the run dialog | LOCK | Default on, with a visible checkbox. Matches the drawn command (`eval deploy-check --k 3 --commit`); the receipt is the shared unit of truth; the checkbox keeps the team-visible push visible before the click. | — |
| 3 | Cost gate when no prior receipt exists to price from | LOCK | One dialog with an honest no-estimate line ("No previous run to estimate from. This uses your Claude account and can take a while."); yes runs it; Cancel and Stop stay available. No invented numbers, no second confirm, no fall-back to the terminal. | — |
| 4 | Evals at install time | LOCK | Team receipt as the default (D) with the non-blocking suggestion (C). Receipts are committed per skill version and publish CI refuses an endorsed skill without one, so after #83 an installer sees the team's verdict with zero spend; the drawn "Not evaluated" chip and the Evals empty-state Run eval are the only nudge, and only when no receipt exists for the current version. No auto-run, no blocking prompt: the North Star forbids spending without a yes and §12 forbids the UI running evals itself. | — |

---

## Decision 1 — §12 wording: which sentence governs the Eval button

**Verdict: LOCK**

### Plain English
- **What's at stake:** The eval-engine spec's display rule (§12) is the sentence the Eval batch builds from. Two drafts disagree about what happens when a teammate presses Eval in the app: one says the app runs the eval itself by driving the CLI; the other says the app writes out the command and sends the person to a terminal. Ryan pressed the button in 0.1.7 and got the terminal command, which is the experience the North Star says must never happen.
- **Why it's a fork:** Two live texts, two authors. Ryan's D11 draft (`.planning/decisions/2026-09-08-eval-engine-s12-display-rule-draft.md`) says "the UI may hand a run off to the CLI through the Prompter". Ajay's open PR #68 (rev 17, clause (b), branch `spec/eval-engine-rev17-s7v`) says the UI composes the command and hands the user to a terminal. Both were written in good faith against different readings of the "no agent in-process" rule; only one can be the sentence S7v implements.
- **Options:**
  - **A — Ryan's D11 draft governs: the UI hands the run to the CLI through the Prompter.** *(decides it: the app drives `terum-skills eval` over `--frames`, the same way it drives every other verb; the person never leaves the app.)*
  - **B — PR #68 clause (b) governs: the UI composes the command and hands the user to a terminal.** *(decides it: the app never runs an eval; the button becomes a copy-the-command affordance.)*
  - **Defer until Ajay weighs in.** *(decides it: the button stays as shipped in 0.1.7, a terminal command, until the two authors reconcile.)*
- **Recommendation:** A. Driving the CLI over `--frames` is the standing 2026-09-08 decision for every verb, and it is not "spawning an agent in-process": the CLI still spawns `claude`; the app only relays its output and its questions. B is exactly the step the North Star forbids, and it is what Ryan rejected as a user when he pressed the button. Deferring leaves the forbidden experience shipping.
- **Zoom-out:** A is the only option where a teammate does in the app what they would otherwise type into a terminal. B hands them a command to go run somewhere else. Deferring is B by default.
- **The call:** A. Consequence: PR #68 clause (b) is amended in review, not merged as written; the Eval batch ships the `runEvalInApp` flip together with a WorkflowDialog that streams print lines and an adapter receipt reader; eval-engine spec §12 rev 16 line 480 is amended per the D11 draft.

### Technical
- **Files / code paths:** `src/lib/frames.ts:42` (`runEvalInApp:false`, flipped by the Eval batch); `desktop/src/screens/skill/SkillScreen.tsx:41` (`execute` already calls `backend.eval({ref, team})` and drives the run through `driveRun`) and `:43` (the Run eval primary, the dialog, and the `TerminalHint` all key off `features?.runEvalInApp`); `desktop/src/components/domain/SkillCard.tsx:15` (same switch on the card); `desktop/src/backend/tauri/index.ts:39,333` (`cliEval` widened to carry `runDir` / `receiptPath` so the app knows where the run wrote); `:66-73` (`receipt:null` in `inventoryDetail`) and `:290` (`receipts: async () => gap('Eval receipts')`) become a receipt read model that parses the committed receipt from the team clone or the local run dir. The running state reuses the `useWorkflow` / `WorkflowDialog` pattern from the Settings batch: the dialog subscribes to the run's print frames instead of the global `PrintContext` (`desktop/app/providers.tsx:23`), which today drops every eval line. `features.progress` is still false (no `io.progress` frames from `execution.ts`), so the running state is streamed lines plus a busy indicator; a determinate bar is deferred (see frontmatter).
- **Migration / schema:** none in the CLI; the eval verb, its receipt format and its frames are unchanged. Spec text: §12 rev 16 line 480 and PR #68 clause (b) amended to the D11 sentence.
- **Effort / risk / blast radius:** one switch flip, one dialog, one adapter reader, one spec amendment; footnote only. The risk is a run that streams nothing (the PrintContext defect) or finishes with no receipt on screen (the reader gap); both are in the batch, neither survives it.
- **Grounding findings:** `SkillScreen.tsx:41-43` on origin/main confirms the end-to-end path exists behind the switch (`backend.eval` in `execute`, `Run eval` primary and dialog gated on `features?.runEvalInApp`, `TerminalHint` with `s.evalCommand` shown meanwhile). `tauri/index.ts:66-73` sets `receipt: null`, `history: []`, `evalEstimateText: ''`; `:290` returns the `gap('Eval receipts')` result. Terum record: driving every verb over `--frames` is the 2026-09-08 desktop-app CLI decision.

---

## Decision 2 — "Commit the receipt to the team" default in the run dialog

**Verdict: LOCK**

### Plain English
- **What's at stake:** When an eval finishes, its receipt can be committed to the team repo so every teammate sees the score, or it can stay on the machine that ran it. The run dialog has to pick a default and decide whether the person sees the choice. Today the dialog text promises "The receipt is committed to the team repo when it completes" but the app never sends the commit flag, so the promise is false.
- **Why it's a fork:** A committed receipt is a team-visible push made with the person's credentials; an uncommitted one leaves the team's score stale and the run's money spent for one machine only. The canvas draws the command with `--commit`, so the design already leans one way, but the person still has to be able to say no.
- **Options:**
  - **A — Default on, visible checkbox.** *(decides it: the dialog matches the drawn command `eval deploy-check --k 3 --commit`, canvas `build.py:1633-1637`; the push is visible before the click and can be unticked.)*
  - **B — Default off, visible checkbox.** *(decides it: nothing leaves the machine unless asked; the team's score is stale by default and the drawn command is not what the dialog does.)*
  - **C — Always commit, no checkbox.** *(decides it: simplest; the person never sees that a push is part of the run.)*
- **Recommendation:** A. It matches the drawn command, the receipt is the shared unit of truth (a score nobody else can see does the team no good), and the checkbox keeps the team-visible push in view before the person says yes.
- **Zoom-out:** All three respect "their own login, their own money"; only A and B keep the push visible before the click, and only A keeps the dialog honest against the canvas. C hides an action the person is taking with their own credentials.
- **The call:** A.

### Technical
- **Files / code paths:** `desktop/src/backend/types.ts:77` (`EvalArgs {team?, ref, commit?, cases?}`; `commit` already exists); `SkillScreen.tsx:41` never sets it today, while the dialog copy at `:43` promises a commit it does not send; the Eval batch adds the checkbox (default checked) and passes `commit` through. In the CLI, `--commit` needs a joined handle and pushes one receipt via `safeWrite`. The adapter receipt reader (D1) must handle both a committed receipt in the team clone and an uncommitted local run (read from the `runDir` / `receiptPath` the widened `cliEval` returns).
- **Migration / schema:** none; receipt is passthrough.
- **Effort / risk / blast radius:** one checkbox and one boolean on an existing arg; footnote only. Risk is the unticked case leaving a receipt the Evals tab cannot find, which the two-source reader covers.
- **Grounding findings:** `types.ts:77` on origin/main declares `commit?:boolean`; `SkillScreen.tsx:41` calls `backend.eval({ref, ...team})` with no `commit`; `:43` dialog description ends "The receipt is committed to the team repo when it completes."

---

## Decision 3 — Cost gate when no prior receipt exists to price from

**Verdict: LOCK**

### Plain English
- **What's at stake:** An eval spends the person's own Claude money and takes tens of minutes. The dialog prices the run from the previous receipt (D11 rule 2). The first run on a skill has no receipt, so there is nothing honest to price from. The North Star says the app never spends that money without a yes; the question is what the yes looks like when the app cannot say how much.
- **Why it's a fork:** Consent needs real information. With no receipt the app can say nothing about cost, invent a number, ask twice, or refuse. Each is a different reading of "without them saying yes".
- **Options:**
  - **A — One dialog with an honest no-estimate line.** *(decides it: the copy reads "No previous run to estimate from. This uses your Claude account and can take a while."; Run eval is the yes; Cancel before and Stop during stay available.)*
  - **B — A second confirm for unpriced runs.** *(decides it: an extra step the canvas does not draw, asking the same question twice.)*
  - **C — Refuse in-app until a receipt exists.** *(decides it: the first run on every skill goes back to the terminal.)*
- **Recommendation:** A. Explicit consent with real information and no invented numbers. C reintroduces the terminal step the North Star forbids, and on every skill's first run. B adds friction the canvas does not draw without adding information.
- **Zoom-out:** A is a single honest yes; B is the same yes twice; C is a no that hands the person a command. Only A serves both halves of the North Star.
- **The call:** A.

### Technical
- **Files / code paths:** D11 rule 2 (no estimate without a receipt) already governs the display; the change is one sentence of dialog copy for the empty case in `SkillScreen.tsx:43` (`s.evalEstimateText` is `''` on the real adapter today, `tauri/index.ts:73`, so the dialog opens with a bare commit promise and no cost line). The CLI keeps no cost confirm of its own; the app's dialog is the single yes. The cancel path already kills the process group (`desktop/src-tauri/src/lib.rs:125-152`), so Stop during a run is real.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** one string; footnote only.
- **Grounding findings:** `tauri/index.ts:73` sets `evalEstimate: null, evalEstimateText: '', evalEstimateTip: ''` on the real adapter; the eval verb has no API key of its own and relies on a logged-in `claude` on PATH, so the money is the person's.

---

## Decision 4 — Evals at install time

**Verdict: LOCK**

Context: raised by Ryan on 2026-09-09 ("should evals be auto suggested and ran upon installation?") and answered by the 0.1.7 gap audit of the same day.

### Plain English
- **What's at stake:** Whether installing a team skill should start an eval (tens of minutes of the member's own Claude budget, with no cost confirm in the CLI) or prompt for one. An eval is the most expensive thing the app can do with a person's money, and install is the moment they have thought least about it.
- **Why it's a fork:** The North Star forbids spending without a yes, but a skill nobody has scored looks unfinished. Both halves pull: silence leaves the installer with an unscored skill; a nudge at install solicits a spend before the person knows whether the team already answered the question.
- **Options:**
  - **A — Auto-run after install.** *(decides it: every install spends the installer's Claude budget with no yes; §12 forbids the UI running evals itself; the run duplicates the team's shared receipt. Never.)*
  - **B — Blocking "Run an eval now?" after install.** *(decides it: a dialog the canvas does not draw, soliciting a spend before the person sees the team's verdict.)*
  - **C — Non-blocking suggestion only.** *(decides it: the drawn "Not evaluated" card chip, lit by S7v's `liftOnCards` flip, and the Evals tab empty state with Run eval, lit by #83; nothing runs, nothing blocks.)*
  - **D — Team receipt as the default.** *(decides it: receipts are committed per skill version and publish CI refuses an endorsed skill without one; after #83 the app reads the receipt for the team's current version, so an installer sees the verdict with zero spend; suggest only when no receipt exists for the current version; when the receipt's model differs from the installer's, show provenance rather than a re-run nudge.)*
- **Recommendation:** D with C. D means the common case costs the installer nothing: the publisher already had to produce a receipt to publish, so the verdict is there to read. C covers the gap where no receipt exists for the current version, and does it with the affordances the canvas already draws rather than a new dialog. A spends with no yes and B asks for one before the person has the information a yes needs.
- **Zoom-out:** D satisfies both halves of the North Star: the installer does in the app what they would otherwise do in a terminal (see the score), and the app spends nothing on their behalf. A stronger nudge belongs with the publisher, who already needs a receipt to publish, not the installer.
- **The call:** D with C, confirmed by Ryan 2026-09-09.

### Technical
- **Files / code paths:** eval-engine spec §12 as amended by D1 of this ledger governs (the UI drives the CLI over `--frames`; it never runs an eval itself, and never without the dialog's yes). Canvas `build.py:604-625` draws the card chip ("Not evaluated") and `:1430-1432` draws the Evals tab empty state with Run eval; both are the C suggestion and both already exist in the design. The `FRAME_FEATURES.liftOnCards` flip that makes the chip visible on the real adapter belongs to S7v; the Evals empty state lights when #83 lands the adapter receipt reader (D1). The receipt-check CI that makes D hold is on scaffolded team repos; older repos need `team workflow-update` to pick it up. No `install.ts` change; no new dialog.
- **Migration / schema:** none; receipts are already committed per skill version.
- **Effort / risk / blast radius:** nothing new to build in this batch; the pieces are S7v's flip, #83's reader, and existing CI. Footnote only. The risk is a team repo scaffolded before the receipt check, where an endorsed skill can be current with no receipt; there the C suggestion is the only nudge, which is the intended fallback.
- **Grounding findings:** 2026-09-09 gap audit, section 3.

---
