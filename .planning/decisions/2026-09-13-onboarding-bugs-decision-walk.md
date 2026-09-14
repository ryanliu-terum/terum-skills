---
title: onboarding bug batch decision walk
date: 2026-09-13
north_star: Onboarding never tells you something that isn't true.
status: complete
deferred:
  - what: The onboarding "Workspace name" field writes a preference nothing reads, and its helper text ("How the team appears here and in the sidebar") claims an effect it does not have (D2). GAPS.md:52 records the missing verb but NOT the misleading sentence
    gate: surfaces().onboarding flips to true in the Tauri backend -- at that point correct the copy or build RM-24, whichever ships first; the screen must not go live with that sentence
  - what: Nothing in this walk was checked against the team's shared record; the terum MCP (check_decision, get_standing_decisions, search_team_knowledge) is not connected in this session, so the incumbent record was reconstructed from the repo's own specs, costing research and GAPS.md
    gate: the terum MCP is reachable again -- re-run check_decision over D1, which deliberately overrides spec section 6.1
  - what: SURFACED, NOT WALKED -- driveRun routes `path` ask-frames through prompter.text, which rebuilds them as kind:'text', so PromptDialog never renders the "Choose folder..." button and the D13 folder chooser is unreachable from the setup wizard in the desktop app
    gate: anyone picks up the desktop prompt dialog or D13 folder-picker work -- verified by reading drive.ts and prompter.ts during this walk, never triaged
---

# Onboarding Bug Batch — Decision Walk

**North Star:** Onboarding never tells you something that isn't true.

Ratified by Ajay 2026-09-13, over two alternatives: "a first run always ends with a working
machine" (rejected as a yardstick because it forces an override of spec §6.1 on every path it
touches, buying completion at the cost of the recorded design) and "the recorded intent wins"
(rejected because it closes the batch having changed nothing, and the batch exists precisely
because some recorded behaviour reports untruthfully).

The batch was surfaced by a bug analysis of the onboarding flow on 2026-09-13. Seven findings
were mechanical and went straight to implementation; the decisions below are the three that
could not be resolved without a call.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| D1 | Invite failure policy in the setup wizard | LOCK | Re-ask when the mistake is fixable; when it does exit, say what already worked and that re-running finishes it | — |
| D2 | The onboarding "Workspace name" field | DEFER | An untrue sentence on a screen nobody can currently open is a dormant violation, not a live one | until `surfaces().onboarding` is true |
| D3 | Restarting a cancelled setup runs invisibly | LOCK | A restart must show the setup screen instead of bouncing to a Library that implies nothing is happening | — |

---

## Decision 1 — Invite failure policy in the setup wizard

**Verdict: LOCK** — option B (re-ask on a fixable mistake) **plus** option A (say where you got
to on the paths that still exit).

### Plain English

- **What's at stake:** Someone creating a team types their teammates' GitHub names. One typo —
  or writing `@carol`, which is how everybody writes a handle — and the wizard stops. The team
  is real and the good invites did go out, but the last four things setup does never happen:
  add a project, offer evals, install the Claude Code session hook, install the `/terum-skills`
  skill. What they see is an error and a failure exit. Nothing tells them the team exists, and
  nothing tells them that running `setup` again picks up where it stopped.
- **Why it's a fork:** Stopping is deliberate. `.planning/specs/2026-09-02-phase-1-build.md:461`
  (§6.1 Errors) decided it, two tests assert it, and two design rows were written around it. So
  the question was never "should it stop" — it was whether stopping *while saying nothing about
  what already worked* is acceptable.
- **Options:**
  - **A — Keep the stop, say where you got to.** Exit as today, but first print what's durable
    and how to finish. *(the difference that decides: removes the untruth without overriding
    anything recorded)*
  - **B — Re-ask when the mistake is fixable.** A leading `@` or an unknown username is a typo;
    re-prompt instead of exiting. A cap, permission refusal or auth failure still exits. *(the
    difference that decides: prevents the loss instead of explaining it — but overrides §6.1 for
    one class of failure)*
  - **C — Let a partial success continue.** If at least one invite landed, finish the wizard.
    *(the difference that decides: the most direct contradiction of §6.1's "never unwinds a
    completed step")*
- **Recommendation:** A — the untruth is the silence about what worked, and A removes it without
  overriding a recorded decision.
- **Zoom-out (does this serve the North Star?):** The user picked B. Raised directly that **B is
  not a superset of A**: B fixes the typo path, but a cap, 403 or auth refusal still exits, and
  on those paths the user still gets silence about the team that was created and the invites
  that landed — the exact untruth the North Star names. Also corrected two things about B's cost
  in the user's favour: `setup.test.ts:187`'s real property ("the batch is validated up front" —
  nothing is sent until every login parses) **survives B untouched**, so only its exit-tail is
  rewritten, a smaller override than first stated; and CP-31's terminal failure board still
  describes the cap and permission paths, so it is not invalidated.
- **The call:** B **and** A together. Re-ask on a fixable typo; and when setup genuinely exits,
  print what is durable and that re-running finishes it. This covers every failure path against
  the North Star rather than only the typo one.

### Technical

- **Files / code paths:** `src/commands/setup.ts:295-300` (the invite block),
  `src/commands/invite.ts:52` (the failure shape), `src/lib/schema.ts:36` (the invalid-login
  message — it recites the rule and never names the leading-`@` mistake).
- **Required API change (surfaced during the walk, not before):** to re-ask only on fixable
  mistakes, setup must tell a typo from a cap. Today `invite` returns a flat error string; a 404
  and a 403 are distinguishable only by matching message text, which is brittle.
  **`InviteResult.failed[]` must carry a machine-readable reason per login** (e.g.
  `'no-such-user' | 'cap' | 'forbidden' | 'auth'`). Record this as part of D1's build, not as a
  discovery at build time.
- **Preserve:** the up-front batch validation guarantee — nothing is sent until every login
  parses. B changes only what happens *after* validation fails.
- **A's half needs no new plumbing:** the failure Result already carries `value.invited`,
  `value.already` and `value.failed`, so setup can read it directly to write the closing line.
- **Deliberate override, recorded as such:** §6.1's "exits non-zero at that step" no longer holds
  for the fixable-typo class. `src/commands/__tests__/setup.test.ts:187`'s exit-tail is rewritten
  as a consequence; `:172` (the 403 path) is unaffected and keeps passing.
- **Desktop:** the re-ask arrives as another `ask` frame, which the prompt dialog already
  handles. A's closing line flows into `state.lines` and renders under "Setup output"; the
  "Couldn't finish setup" headline stays accurate on the paths that still exit.
- **Effort / risk / blast radius:** small-to-medium. Confined to `setup.ts`, `invite.ts`, one
  schema string, and the one test tail. No fidelity board is touched.
- **Grounding findings:** verified what actually reaches the screen today — stdout carries
  `Invited @bob.` and the failure line, but `src/lib/execute.ts:32` sends **only** `outcome.error`
  (the failures) to stderr with exit 1. The spec's recovery path ("the user re-runs setup") was
  confirmed to work — a re-run does re-offer the hook and wrapper — but is never stated anywhere
  in the output.

---

## Decision 2 — The onboarding "Workspace name" field

**Verdict: DEFER** — gated on `surfaces().onboarding` becoming true.

### Plain English

- **What's at stake:** The "Your workspace" screen has a Workspace name field, and underneath it
  the sentence *"How the team appears here and in the sidebar."* Typing in it does nothing. The
  value goes to a preference nothing reads. The name shown everywhere still comes from whatever
  the CLI bound when the team was created or joined.
- **Why it's a fork:** This is not sloppiness — `desktop/GAPS.md:52` records it and RM-24 costed
  the fix at MEDIUM. The screen was drawn ahead of the verb that would make it work. Two things
  complicate "just fix the text": the helper sentence is drawn into the **pixel-gated board** at
  `desktop/e2e/fidelity/boards.ts:626`, so the app and the board have to move together; and
  **nobody can reach this screen** — `desktop/src/backend/tauri/index.ts:665` sets
  `surfaces().onboarding = false`, so the shipped app redirects the whole flow to the Library.
- **Options:**
  - **A — Defer, gated on the screen becoming reachable.** *(the difference that decides: an
    untrue sentence nobody can read is not yet telling anyone anything)*
  - **B — Fix the copy now.** *(the difference that decides: cheapest permanently-honest state,
    but spends a board re-render and re-lock on a screen nobody sees)*
  - **C — Build the verb (RM-24).** *(the difference that decides: the only option that delivers
    the feature — MEDIUM effort, spent on an unreachable screen)*
- **Recommendation:** A — the violation is real but dormant, and a gated deferral is exactly the
  instrument for "must not ship live".
- **Zoom-out (does this serve the North Star?):** Yes, and this was the crux rather than an
  afterthought. The North Star says onboarding must never tell you something untrue. This screen
  currently tells *nobody* anything, because nobody can open it. Spending a board re-lock or a
  MEDIUM build on a dormant violation is not what the yardstick asks for; letting it ship live
  would be.
- **The call:** DEFER, with the trigger being `surfaces().onboarding` flipping to true.

### Technical

- **Files / code paths:** `desktop/src/screens/onboarding/OnboardingScreen.tsx:79` writes
  `onboarding:workspace`; no reader exists anywhere in `src` or `desktop/src` (both grepped).
- **Migration / schema:** none.
- **Effort / risk / blast radius:** zero now. When the gate trips: one string plus a board
  re-render and re-lock (option B), or RM-24 (MEDIUM, option C).
- **The trap this deferral closes:** `desktop/GAPS.md:52` records the *missing verb*, not the
  *misleading sentence*. Without an explicit deferral entry naming the copy, turning the surface
  on would ship it. That is why the `deferred:` entry names the sentence verbatim.
- **Grounding findings:** `RM-24` at
  `.planning/research/2026-09-07-desktop-app-gap-costing.md:239` (MEDIUM · app, CLOSED at
  b5c0507); catalogue row 45 pairs it with TJ-O1 and CP-D1.

---

## Decision 3 — Restarting a cancelled setup runs invisibly

**Verdict: LOCK** — option A: do not navigate away when the screen was explicitly restarted, and
delete the dead `cancelled` arm of the Retry branch.

### Plain English

- **What's at stake:** Stop a running setup, then use Settings ▸ "Start setup". The setup **does
  re-run** — but you are bounced straight to the Library and never see it. Prompt dialogs still
  appear, because they are rendered app-wide, but they pop over the Library with no surrounding
  context, no progress card, and the "Setup finished" screen never shows. The app presents a
  Library that implies nothing is happening while a wizard is actually running behind it.
- **Why it's a fork:** The original finding — "Retry after Stop is unreachable" — was framed
  wrongly. Stop is *designed* terminal (`setup-driver.test.tsx:104` asserts it both navigates
  away and writes `launch:consumedWrittenAt`), and Settings ▸ Start setup is the tested recovery
  (`:113`). So the fork is not "should Stop be reversible" but "why is the designed recovery
  broken", and the answer is a stale-outcome race nobody had covered.
- **Options:**
  - **A — Do not navigate away when the screen was explicitly restarted.** *(the difference that
    decides: fixes the invisible run at the smallest blast radius, keeping every assertion)*
  - **B — Make Stop a pause instead of an exit.** *(the difference that decides: overturns both
    assertions at `setup-driver.test.tsx:108` and `:110` — a product call, not a bug fix)*
- **Recommendation:** A.
- **Zoom-out (does this serve the North Star?):** Directly. The untruth was a Library screen
  implying nothing was happening while setup ran behind it; A removes exactly that and nothing
  else. B was offered and explicitly not taken, so Stop stays terminal.
- **The call:** A. LOCK.

### Technical

- **Files / code paths:** `desktop/src/screens/onboarding/SetupBoot.tsx:19` (the
  navigate-on-cancelled effect), `:40` (the dead `cancelled` arm of the Retry branch),
  `desktop/src/backend/setup-session.ts` `retry()` (the synchronous `update(initial(…))`).
- **Cause:** the effect reads the outcome captured at that render. On remount, `retry()` flips
  the session back to `running` synchronously, but the already-scheduled effect still fires with
  the stale `cancelled` and navigates away.
- **Coverage gap to close:** `setup-driver.test.tsx:113` (`manual Start setup works regardless of
  consumption`) only exercises a **fresh backend with no prior session**, which is why this was
  never caught. It must gain a case where a prior *cancelled* session exists for the same
  `writtenAt`.
- **Effort / risk / blast radius:** small. A touches no existing assertion.
- **Grounding findings:** reproduced directly during the walk — after Stop then Start setup,
  `attempts = 2` and `outcome = finished` while `hash` stayed `#/library/global` throughout, and
  the setup screen never rendered.
