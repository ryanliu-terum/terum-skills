---
title: design-side strings decision walk
date: 2026-09-08
north_star: Truthful and complete (re-ratified mid-walk). Every board says only what the CLI actually does at Ryan's main, so a user who copies a command or trusts a caption is never misled; and the canvas covers every real state the CLI has, so new boards are welcome and the gate grows past 87.
status: complete
deferred:
  - what: The role chip's menu is dropped; real roles in the team model wait on M7 (D1)
    gate: Ryan approves a team.json roles row and a role-change verb; the menu returns when the M7 roles batch merges
  - what: The project rail's Admin row is dropped; restoring it waits on real project membership (D2)
    gate: team.json projects gain a members list with an admin, approved by Ryan
  - what: Eleven design-routed rows with a cheap or metadata-shaped CLI route (CP-19, CP-30, CP-S4, RM-15, RM-37, TJ-12, CP-23, CP-S1, EV-01, PF-02, RM-13) leave this walk and are built in M7 so the boards stay as drawn (D0); CP-03 came back (D17)
    gate: the M7 milestone document places each of the twelve in a verified batch; any row M7 cannot place returns to this walk as a wording fix
---

# Design-side strings — Decision Walk

**North Star:** Truthful and complete. Every board says only what the CLI actually does at Ryan's main, so a user who copies a command or trusts a caption is never misled; and the canvas covers every real state the CLI has, so new boards are welcome and the gate grows past 87. *(Ratified as "truthful and shippable" at the start; re-ratified after D9 and D10 showed Teddy's picks favour completeness over fewest re-renders.)*

Source batch: gap costing §3.2 (57 design-side rows + 1 cut), grounded against the current `build.py` (post patches AA–AJ) and the CLI at Ryan's main `85cc276` (v0.1.5) on 2026-09-08. Closure of a LOCKed row = a canvas patch (`.patches/patch_*.py`, next letters after AJ), a single-board re-render (`./render.sh <Board>`, never the parallel batch), a Codex spec for the app's matching strings, and a re-lock through the fidelity gate. This file is untracked, like the research docs beside it.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| D0 | Twelve rows with a CLI route leave the walk and go to M7 | DELEGATE | Teddy's premise: metadata plus smarter sync makes them cheap; the boards then stay true as drawn | → M7 milestone document (follow-up batch after the M7 workflow lands) |
| D1 | TJ-02 role chip with a role menu | GATE | Roles are not in the team model; show the GitHub-derived role read-only now, the menu returns when M7's Ryan-gated roles model ships | tripwire: team.json roles + role-change verb approved by Ryan (M7) |
| D5 | CP-09 "approved 2 grants" in the team report | LOCK | Approvals stay on each machine; the line says only what is shared | — |
| D6 | RM-O1 "esc to go back" wizard hint | LOCK | The prompter has no back; the hint says what esc does and the specimen stops inheriting a false key | — |
| D7 | TJ-06 install-scope radios | LOCK | No per-install scope (deferred by the spec); the radios show only the scopes that exist for this skill, as a fact | — |
| D8 | TJ-09 "Approve and merge" / "Request changes" on the review item | LOCK | Teddy: "this does not need to exist just yet"; both actions come off and the card keeps no action at all (the terminal hint is the only affordance) | — |
| D9 | AC-09 sidebar collapse control with no collapsed state | LOCK | Wire it: chevrons and the collapse button get real states, and three new boards are drawn (sidebar hidden, Projects collapsed, Inbox collapsed) | extends the gate scope beyond 87; boards drawn with Teddy one at a time |
| D10 | AC-11 + CP-31 + TJ-07 new outcome boards | LOCK | Draw them now: validate (3) and run-eval (3+) outcomes, the post-invite result state, the remove-from-team dialog and its refusal states | about eight boards; extends the gate scope; drawn with Teddy one at a time |
| D11 | CP-O1 onboarding boot draws an unattended placement | LOCK | The boot follows a join that already asked: status rows, no "4 of 7" counter, a possible approve-updated-tools interruption drawn | — |
| D12 | CP-29 "How evals work" points nowhere | LOCK | Rename to "What an eval runs" and route to Settings ▸ Evals, which already explains the run | — |
| D13 | CP-S5 Settings error shows a made-up parse failure | LOCK | Show the CLI's real message, with the home directory shortened to a tilde under one app-wide rule | rule: the app abbreviates the home directory in every CLI message it renders |
| D14 | 28 mechanical wording/board rows (batch) | LOCK | Each takes the costing's verified fix; one patch series, single-board re-renders, one Codex spec, re-locks | — |
| D15 | CP-33 printed npx spelling; RM-26 project Library route | LOCK | Already settled by BRIEF.md:32 and :14/:48; no change to CP-33, two sidebar-selection edits for RM-26 | — |
| D16 | Order of the closure work | LOCK | Strings first (patch, re-render alone, Codex spec, re-lock), then the 11 new boards in design sessions with Teddy one at a time | — |
| D17 | CP-03 returns from M7 to the walk ('install project' precondition copy) | LOCK | M7 could not place it inside the cheap bar (a spec retraction plus a new write on the session-start sync path); the costing's three honest strings apply instead | — |
| D2 | TJ-03 per-project admin row in the project rail | GATE | Nothing in the team file names a project admin; drop the row now, bring it back if project membership ever lands | tripwire: team.json projects gain members/admin |
| D3 | TJ-01 invite scoping to a project | LOCK | invite takes GitHub logins only and places nothing; the scoping section goes | — |
| D4 | PF-05 "Last seen" on the roster | LOCK | Nothing committed records activity; relabel to "Last active" derived from the last change to the person's committed file | — |

## Split of the 58 rows (by the costing's CLI-side verdict)

| CLI-side verdict | Rows | In this walk? |
|---|---|---|
| CLOSED (CLI already right; board stale) | 23 | yes, wording |
| NA (no CLI route; canvas-only) | 15 | yes, wording or board |
| SIMPLE | 6 | no, M7 (D0) |
| MEDIUM | 6 | no, M7 (D0) |
| HARD | 6 | yes, as an M7-or-canvas fork each |
| DEFERRED | 2 | yes, as an M7-or-canvas fork each |

Forks to walk (8): CP-09, PF-05, RM-O1, TJ-01, TJ-02, TJ-03, TJ-06, TJ-09.
Wording and board rows to walk (38): AC-09, AC-11, CP-01, CP-04, CP-05, CP-06, CP-08, CP-10, CP-12, CP-17, CP-18, CP-22, CP-27, CP-29, CP-31, CP-32, CP-33, CP-34, CP-36, CP-42, CP-44, CP-45, CP-46, CP-O1, CP-O2, CP-O4, CP-S2, CP-S5, CP-S6, EV-20, EV-21, RM-14, RM-16, RM-26, RM-43, TJ-07, TJ-13, TJ-O2.

---

## Decision D0 — Twelve rows go to M7

**Verdict: DELEGATE**

### Plain English
- **What's at stake:** twelve boards draw something the CLI could carry as data with a small change. Fixing the wording would make them true today; teaching the CLI makes them true as drawn.
- **Why it's a fork:** the costing routed them to wording because that was cheapest at the time; Teddy's read is that metadata plus smarter sync makes the CLI route cheap too.
- **Options:** M7 builds them (boards unchanged) / wording changes now / only the six cheapest go to M7.
- **Recommendation:** M7 builds the six cheap ones and the six metadata ones.
- **Zoom-out:** serves the North Star directly: the boards become true without any re-render, which is the cheapest re-lockable path.
- **The call:** Teddy chose "the 12 SIMPLE and MEDIUM" (2026-09-08).

### Technical
- Rows: CP-19, CP-30, CP-S4, RM-15, RM-37, TJ-12 (costing CLI-side SIMPLE); CP-03, CP-23, CP-S1, EV-01, PF-02, RM-13 (CLI-side MEDIUM).
- The running M7 workflow placed none of them (it was told design-routed rows are Teddy's); a verified follow-up adds them to batches once the M7 document lands.
- If M7 cannot place one honestly (e.g. it needs a team.json row the SIMPLE bar refuses), that row returns here as a wording fix.

---

## Decision D2 — TJ-03 per-project admin in the project rail

**Verdict: GATE** (drop now; restore behind a tripwire)

### Plain English
- **What's at stake:** the project rail names an admin for each project. The team file has no project members or admins, so the name is invented.
- **Why it's a fork:** dropping it is free and true; keeping it means teaching the team file about project membership, which is a bigger change than the cheap bar allows and needs Ryan.
- **Options:** drop the row / add project members to the team model / drop now and restore if membership lands.
- **Recommendation:** drop the row.
- **Zoom-out:** the pick is truthful today and keeps the door open at zero cost; fits the North Star.
- **The call:** drop now, restore if membership lands (Teddy, 2026-09-08).

### Technical
- Costing TJ-03: two call sites, `project_rail`'s `person=("Admin", q["admin"])` and its sibling (current line numbers from the grounding deck). Patch: pass `person=None` at both sites; MarketplaceProject and MarketplaceProjects boards re-render and re-lock. App half: a Codex spec removing the admin row from the project rail component.
- Tripwire: `team.json` projects gain `members[]` with an admin (a team.json row; outside M7's SIMPLE bar; Ryan's call).

## Decision D3 — TJ-01 invite scoping to a project

**Verdict: LOCK**

### Plain English
- **What's at stake:** the Invite dialog lets you pick a project and says it will place that project's skills for the invitee. The CLI's invite only takes GitHub logins and places nothing, so the dialog promises something that never happens.
- **Why it's a fork:** honouring the scope would mean writing another person's file, which the CLI's guard forbids; so the only honest options are removing the section or rewording it.
- **Options:** remove the scoping section / make invite honour a project / keep rows, fix caption.
- **Recommendation:** remove the section.
- **Zoom-out:** removes a false promise with one board family re-rendered; the cheapest truthful path.
- **The call:** remove the scoping section (Teddy, 2026-09-08).

### Technical
- Costing TJ-01: `scoping_rows` and its call in `invite_dialog` come out, with the five ShareStates specimens; the 520 px dialog shrinks by one section. Boards: ShareInvite (and the ShareStates sheet, out of gate). App half: Codex spec removing the scope rows from the invite dialog; ShareInvite re-locks at its new height.

## Decision D4 — PF-05 "Last seen" on the roster

**Verdict: LOCK**

### Plain English
- **What's at stake:** the roster shows when each teammate was last seen. Nothing shared records that; the only stamp lives on your own machine, so the column would show guesses.
- **Why it's a fork:** a real stamp is possible (each person's own sync could write a date to their own file) but every sync would then create a commit unless a daily rule is added.
- **Options:** relabel to "Last active" from committed evidence / sync writes a dated stamp / drop the column.
- **Recommendation:** relabel and derive from committed evidence.
- **Zoom-out:** coarse but never false, and no CLI change; fits the North Star.
- **The call:** relabel to "Last active" from committed evidence (Teddy, 2026-09-08).

### Technical
- Costing PF-05: header relabels from "Last seen" to "Last active"; the MEMBER comment stops claiming the session hook; `last_seen_days` vocabulary becomes derived from the person's people-file last change (git log on `people/<handle>.json`, read at sync). Boards: Share, ShareStates. App half: the mock's `lastSeen` becomes `lastActive` with the same derivation described in the spec; M6's adapter reads git history for it.

---

## Decision D1 — TJ-02 roles (Admin / Member chip with a role menu)

**Verdict: GATE** (read-only chip now; menu returns with the roles model)

### Plain English
- **What's at stake:** the roster shows each member as Admin or Member with a menu arrow, as if roles could be changed here. The CLI has no roles; "admin" is only GitHub repo admin and is stored nowhere.
- **Why it's a fork:** a read-only chip is cheap and true; a real roles model is the useful thing but needs a team-file change, a verb, and Ryan.
- **Options:** read-only role from GitHub / real roles in the team model / drop the chip.
- **Recommendation:** read-only now.
- **Zoom-out:** Teddy first picked the roles model; the check was that an inert menu until it ships is a lie by the North Star. He took the gate: truthful at every step, and the roles model still gets built.
- **The call:** gate (Teddy, 2026-09-08).

### Technical
- Now: `role_chip` loses its chevron and gains an "unknown" state (offline, no gh, generic git, empty `github`); the role comes from the host's repo permission read at sync (M6 adapter; the mock keeps fixture roles). Boards: Share, ShareStates. App half: Codex spec.
- Later (M7, Ryan-gated): `team.json` roles row + a role-change verb; the menu returns. Carried in the M7 document as a gated batch.

## Decision D5 — CP-09 "approved 2 grants"

**Verdict: LOCK**

### Plain English
- **What's at stake:** the team report credits a teammate with approving two grants. Approvals happen on each person's own machine and are never shared, so the number cannot be known.
- **Options:** reword to what is shared / share approvals in M7 (a privacy decision).
- **The call:** reword (Teddy, 2026-09-08). Fits the North Star: one string, one board, no CLI change.

### Technical
- Costing CP-09: the fact string becomes "installed the global set" (drop the grants clause); a second frozen-snapshot string alongside. Boards: the Inbox team item and InboxPanes. App half: fixture string via the export.

## Decision D6 — RM-O1 "esc to go back"

**Verdict: LOCK**

### Plain English
- **What's at stake:** every onboarding step promises esc goes back; the prompter has no back.
- **Options:** change the hint to what esc does / add back to the prompter (HARD).
- **The call:** change the hint (Teddy, 2026-09-08). Fits: one board plus the specimen sheet, no CLI change.

### Technical
- Costing RM-O1: the generic "key hints" specimen cell splits into two labelled cells; the docstring and the per-step hint drop "back". Boards: every Onboarding board that prints the hint (count from the grounding deck). App half: Codex spec on the onboarding key-hint component.

## Decision D7 — TJ-06 install-scope radios

**Verdict: LOCK**

### Plain English
- **What's at stake:** the Install dialog offers four scopes on every skill, as a choice. The CLI has no per-install scope; a skill's scope is whichever team lists reference it, and the spec deferred per-install scope on purpose.
- **Options:** show only the scopes that exist, as a fact / add per-install scope in M7 (re-opens a spec decision) / drop the radios.
- **The call:** show only the scopes that exist (Teddy, 2026-09-08). Fits: truthful, no re-opened decision, one board.

### Technical
- Costing TJ-06: `skill_detail_install` stops offering three projects unconditionally: Global plus the projects whose list carries this skill, presented as a fact. Boards: SkillDetailInstall (and SkillDetailInstallLight, out of gate). App half: `InstallArgs` keeps no scope; the dialog derives scopes from the fixture's project lists.

---

## Decision D8 — TJ-09 review item actions

**Verdict: LOCK** (remove the PR-writing actions)

### Plain English
- **What's at stake:** the Inbox review card offers "Approve and merge" and "Request changes". No CLI verb writes to a pull request, and a merge from the app would skip the team's own guards.
- **Options:** one non-committing "Open pull request" action / keep both and add a guarded merge verb in M7.
- **The call:** Teddy: "This does not need to exist just yet." Confirmed reading: no action at all; the review card is informational and the terminal hint is its only affordance.

### Technical
- Departs from the costing's single-button shape: `"review": []` (no button), item state string "Review on GitHub", the terminal hint stays as the affordance. Boards: Inbox, InboxPanes, InboxStates. CLI side stays DEFERRED (the costing's HARD reasoning did not survive the pin: guards run inside safeWrite and the pre-push hook, so a future merge verb is not blocked by them).

## Decision D9 — AC-09 sidebar collapse

**Verdict: LOCK** (wire it; three new boards)

### Plain English
- **What's at stake:** the sidebar shows a collapse button and section chevrons, but no board shows what collapsed looks like, so the app has a control with no behaviour.
- **Options:** drop the controls (a subtraction) / wire it and draw three boards.
- **Zoom-out:** against "fewest re-renders" this is the dearer path: three boards beyond the 87 the gate covers, each needing a render, an oracle and a lock. Teddy chose completeness; recorded as his call.
- **The call:** wire it and draw three boards (Teddy, 2026-09-08).

### Technical
- Costing AC-09 (b): chevron-right branch in `nav_row` and `section_header` using the unused glyph; boards: sidebar hidden (240 → 0, not an icon rail), Projects collapsed, Inbox collapsed. The hidden-sidebar board needs a name other than LibraryCollapsed (taken by the tile-density board). Drawn with Teddy one screen at a time (his standing rule), then rendered alone and locked; FIDELITY.md gains three rows and the boards manifest test's count moves from 87.

## Decision D10 — AC-11, CP-31, TJ-07 new outcome boards

**Verdict: LOCK** (draw them now)

### Plain English
- **What's at stake:** validate and run-eval have no outcome screens, the Invite dialog has no post-invite state, and removing a teammate has no confirmation. The app has nowhere to show these outcomes.
- **Options:** defer all three / draw them now / draw only the remove dialog.
- **Zoom-out:** about eight boards beyond the gate's 87. Teddy chose completeness; recorded.
- **The call:** draw them now (Teddy, 2026-09-08).

### Technical
- AC-11: validate has three outcomes (passed clean, passed with N warnings, failed with N findings); run-eval failure is at least three (preflight refusal, completed-but-failed, commit failure after a successful run) plus success. CP-31: ShareInviteResult (invite_dialog gains `result=None`; primary "Done"; the same state on OnboardingTeam is terminal) and a mixed-outcome cell on the states sheets. TJ-07: ShareRemove in the `skill_detail_remove` idiom, titled with the CLI's own question, an `--archive-only` second state, refusal strings on ShareStates. All drawn with Teddy one at a time.

## Decision D11 — CP-O1 onboarding boot

**Verdict: LOCK**

### Plain English
- **What's at stake:** the boot screen shows the first sync placing the endorsed skills with no question asked; the CLI never places unattended.
- **Options:** boot follows a join that already asked / boot is the join.
- **The call:** boot follows a join that already asked (Teddy, 2026-09-08). Fits: a status screen that says what happened, with the one real interruption drawn.

### Technical
- Costing CP-O1 (a): boot_rows become "Team terum found on this machine / Fetched terum/team-skills / Nothing new to place / Recording the sync"; the `4 of 7` counter, ONBOARD_PLACED and the check_onboarding rule forcing `0 < ONBOARD_PLACED < len(GLOBAL_SET)` go; draw the "Approve updated tools for <skill>?" interruption as a possible row. Boards: OnboardingBoot (+ OnboardingStates). App half: Codex spec.

---

## Decision D12 — CP-29 "How evals work"

**Verdict: LOCK**

### Plain English
- **What's at stake:** the skill page's "How evals work" link goes nowhere; the app has no help surface.
- **Options:** rename and route to Settings ▸ Evals / remove the link.
- **The call:** rename and route (Teddy, 2026-09-08). Fits: one string, one route, no dead link.

### Technical
- Costing CP-29: the label becomes "What an eval runs", routed to the Settings evals section (board SettingsEvals). The row's claim that no explainer exists was struck as false at the snapshot (OnboardingEval and the Good-to-go card carry one). Boards: SkillDetailEvals (label only). App half: route change in the evals tab component.

## Decision D13 — CP-S5 Settings error string

**Verdict: LOCK** (with one app-wide rule)

### Plain English
- **What's at stake:** the Settings error state shows a failure message the CLI never produces. The real one starts with the absolute config path and ends with a line and column; the canvas writes every other path with a tilde.
- **Options:** the CLI's real line verbatim with the absolute path / tilde plus a written rule that the app shortens the home directory everywhere.
- **The call:** tilde with an app-wide home-abbreviation rule (Teddy, 2026-09-08). Fits: truthful content, consistent look, one rule to keep.

### Technical
- Board string: `Invalid ~/.terum/skills/config.json: Expected property name or '}' in JSON at position 412 (line 14 column 3)` (the modern V8 suffix; node >= 22.12). Rule for AGENTS.md: every CLI message the app renders passes through one home-abbreviation helper (absolute home prefix → `~`) before display; the mock and the M6 adapter both apply it. Board: SettingsError. App half: helper + test + the error-line component.

---

## Decision D14 — the 28 mechanical rows

**Verdict: LOCK** (batch; Teddy: "Lock all 28")

Each row takes the costing §3.2 fix as verified there (line numbers are pre-patch and must be re-grepped at patch time).

- **Verb and command spellings:** CP-01 (`uninstall-skill <ref>`; title "Remove deploy-check?"), CP-04 ("Runs on connect, publish, sync and in CI"; "passed on connect"), CP-05 (three join-block captions incl. the invitation paragraph from invite.ts), CP-06 (`install <ref>` placeholders; Share hint → `connect`), CP-O4 (four leftover `share` command sites → `connect`), RM-43 (the five strings the connect rename left behind, quoting as the CLI does), CP-08 (two inventory JSON notes; no board).
- **Counts, sorts, samples:** CP-10 ("15 of 30 skills" and sample labels), CP-12 (bucket sorted by installs, then categories by count; edit order matters), CP-27 (secret-scan category → security), CP-34 (delete `repo="mrf/team-skills"` on DETAIL_PARTIAL), CP-44 (`repo = s.get("repo") or TEAM_REPO`; byte-identical output), CP-46 (hoist SAMPLE_SKILL_ID / DEPLOY_CHECK_V / DEPLOY_CHECK_V40; identical output), CP-42 (one comment beside SETTINGS_NAV).
- **Evals wording:** CP-17 (`{w}W–{l}L–{ti}T`; width 56 → 76 px if it crowds), CP-45 ("Not evaluated" skill-scoped, "No receipt for <version> yet" version-scoped, Evaluated row "Never"), EV-20 (rail numbers on the showing row only; rows lose focus/hover; state "showing"; caption gains version scope), EV-21 (per-row decided_by with checks / judge / judge-split / opponent-run-failed specimens; the "12 settled by checks, 2 by judge" line goes).
- **Inbox and Share copy:** CP-18 (Invite on ShareError; `market_search(filter=False)` on Find members), CP-22 + CP-36 (InboxError and SettingsError: "Check your network and your git access to the repository, then try again"; drop "Open settings"; six strings), TJ-13 ("have installed this" tense at five sites; fix the stated invariant and comment), TJ-O2 (the two join captions use invite.ts:54's sentence; the states sheet gains the accept-the-invitation state).
- **Settings and onboarding copy:** CP-32 (release notice and probe subtitles), CP-S2 (the config.json paragraph), CP-S6 (five Leave bullets, bullet 1 conditional), CP-O2 (Done card mentions the session hook set up by setup), RM-16 (drop the "+9 this week" delta and sparkline; name both populations), RM-14 (card line = project membership; sample key `origin` → `project`; values unchanged).

Closure: patches after AJ in `.patches/`, one board per `./render.sh <Board>` call, Codex spec "S1d: board strings" for `desktop/`, rows re-locked through the fidelity gate.

## Decision D15 — already settled by the brief

**Verdict: LOCK** (no new call)

- CP-33: BRIEF.md:32 keeps `npx -y terum-skills@latest <verb>` on every board; no change.
- RM-26: BRIEF.md:14 and :48 make the project Library the filtered Library; only the two remaining items apply (three `nav_row` sites gain `selected=`; the count set is the project's list).

## Decision D16 — order of the closure work

**Verdict: LOCK**

Strings first: patch, re-render each board alone, one Codex spec for the app's strings, re-lock; then the 11 new boards (D9: 3, D10: about 8) in design sessions with Teddy one screen at a time, each rendered alone and locked before the next.

---

## Decision D17 — CP-03 returns to the walk

**Verdict: LOCK** (the costing's three strings)

The M7 amend step could not place CP-03 within the cheap bar: making the drawn copy true would retract a spec line and add a placement write on the session-start sync path (sync.ts skips a project placement with no matching root and any placement not in the person's installed list). So the three honest strings from costing §3.2 apply: the dialog body says the project's skills are added to your people file and placed when you next sync inside a checkout, and the two command boxes stay as they are. Boards: MarketplaceProjectInstall (+ its light variant). App half: fixture strings via the export. M7 also handed back three refused command strings from CP-19 (`share <path>`, bare `share`, `uninstall deploy-check`), which D14's spelling rows already cover.
