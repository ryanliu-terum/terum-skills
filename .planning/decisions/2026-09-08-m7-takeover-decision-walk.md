---
title: M7 takeover (open decisions before the queue runs) decision walk
date: 2026-09-08
north_star: A teammate who opens the desktop app sees only their team's real data on every visible surface, and nothing drawn on screen promises something the CLI cannot do yet.
status: complete
deferred:
  - what: Favorites heart and Follow as committed people-file fields with team-wide counts (D2); both controls hidden on the real adapter meanwhile
    gate: Ryan's written ruling that a team-visible favorites and following list is acceptable, or a teammate asking for either control
  - what: S7y, case-insensitive project-key resolution (D5); the app shows keys as spelled meanwhile
    gate: the first project key hand-written into any team.json
  - what: a sixth native Tauri command that stats config.json and run/<team>.stamp so the app notices background changes while focused (D9)
    gate: the end-to-end walk shows a focused board going stale after a terminal install or a hook sync
  - what: true reflow of the boards below 1200 px wide, the sixteen S7x reflow rules and the narrow icon-rail boards (D10); sideways scroll of the 1200-wide layout ships meanwhile
    gate: met 2026-09-08 (canvas arrived in terum-teammate-bundle); S7x runs last in the queue, after every surface serves real data
---

# M7 takeover — Decision Walk

**North Star:** A teammate who opens the desktop app sees only their team's real data on every visible surface, and nothing drawn on screen promises something the CLI cannot do yet.

Context: Ryan took over M7 from Teddy on 2026-09-08 (afternoon PT). Teddy's queue and its run state are not on this machine; his local artefacts (design canvas, blank-map review dir, `.planning/` tree) arrived at 14:20 PT as `~/Downloads/terum-teammate-bundle/` with a HANDOFF.md, after decisions 1 to 9 were walked. The canvas has 99 boards and shots, not the 87 the spec's fidelity lock names; the 12 newer boards are not yet locked in `desktop/e2e/fidelity`. The M7 spec (`m7-routing/2026-09-08-m7-close-the-canvas-gaps.md`, generated 18:09 UTC, pinned at f8557c4) left thirteen forks open or parked on Teddy; this walk resolves them so the batches can be specced and run here. Grounded against origin/main @ f8557c4 and Ryan's live team clone (`~/.terum/skills/teams/Terum`, zero projects) on 2026-09-08.

Ratified by Ryan: "Yes, ratify it."

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | What the `roles` switch means | LOCK | `roles` keeps meaning the Admin/Member permission chip (off until S7ab). The roster job label gets its own new switch, `memberRole`, that S7b turns on. No existing key changes meaning, so no protocol bump. | — |
| 2 | Favorites and Follow (S7t) | GATE | Both controls are hidden on the real app (no fake per-browser counts). The committed people-file fields are not built until Ryan rules that a team-visible favorites and following list is acceptable. S7t leaves the queue. | Ryan's written yes on team-visible favorites/following |
| 3 | Admin/Member roles (S7ab) | LOCK | Admin means repo admin on GitHub, read-only in the app, via `ls --host`. No team.json role field, no role-change verb, guard table stays closed. S7ab retired. | — |
| 4 | How the app finds git, gh and node from the Dock (S7ad) | LOCK | The CLI writes the PATH it saw into app.json on every run and the app reuses it. One mechanism on Mac and Windows; goes stale only until the next terminal use. | — |
| 5 | Project name matching regardless of capitals (S7y) | DEFER | Ryan's team has zero projects and no verb creates one (projects are hand-edited into team.json). Nothing to match yet. Rule recorded: the app shows project names exactly as the team file spells them. | first project written into a team file |
| 6 | How the CLI's capability switches reach the screens (S7q) | LOCK | The adapter reads the hello message and maps it app-side; the CLI's published key names stay as shipped in 0.1.6. | — |
| 7 | Team categories on status (S7k) | LOCK | Read only. Categories are shown from team.json; adding one is an admin hand edit, the guard table stays closed (follows D3). | — |
| 8 | A --cwd flag on install, uninstall-skill, sync (S7aa) | LOCK | Skipped as moot: the Rust bridge already starts the CLI inside the folder the app names (lib.rs:44-45). No flag. | — |
| 9 | How the app notices changes it did not make (S7w) | GATE | Refresh after the app's own actions and on window focus, plus a Sync now button. No native file check, no timer, never a polling sync. | the e2e walk shows a focused board going stale; then one read-only Rust command returning two files' mtimes |
| 10 | Smallest allowed window (S7x) | LOCK + DEFER | Minimum stays 960x600; boards keep their 1200-wide layout and scroll sideways inside the window (one CSS rule, honest at every size). True reflow at 960 waits for the canvas. | reflow: gate MET 2026-09-08 14:20 PT (Teddy's `terum-teammate-bundle` delivered the canvas, 99 boards); S7x now waits only on queue order, last in line |
| 11 | Who amends the eval-engine §12 rule (S7v) | LOCK | Ryan amends it himself as product owner; Ajay is informed in the PR body. S7m, S7n, S7u proceed on the same footing. | — |
| 12 | Who merges | LOCK | Implementers self-merge every M7 PR after green gates and CI (Teddy's rule kept). The queue's automated final reviewer and the per-batch real-data proof are the only human-free checks, so both stay mandatory. Ryan reviews after the fact. | — |
| 13 | The frames.ts file four batches edit | LOCK | S7d goes first and rewrites the all-false test into a snapshot of the switch map; S7b, S7ae and S7l then stack on the previous editor's branch and change one line each. | — |
| 14 | One team per machine (F1-F8; MC-07 cancelled) | LOCK | Refuse a second binding before side effects; leave then join. Clear consent on last leave; preserve legacy reads, syncs, leave and explicit writes. | Ryan, 2026-09-08/09 |

---

## Decision 1 — What the `roles` switch means

**Verdict: LOCK**

### Plain English
- **What's at stake:** On startup the CLI tells the app which drawn controls it can honour, as on/off switches. One is called `roles`. The canvas has two role things: a job label beside each roster member ("founder", "platform") and an Admin/Member permission chip on the Share screen. Nobody wrote down which one the switch governs; pick wrong and the app greys a label it could show, or lights a permission chip the CLI cannot back.
- **Why it's a fork:** The job label is one field per person file and ships in S7b. The permission role needs the closed team-file guard table reopened (S7ab). They are never ready together, so one switch cannot mean both.
- **Options:**
  - **A — `roles` = Admin/Member permission; new `memberRole` switch for the job label.** *(decides it: the existing switch keeps its existing meaning; adding a key is additive.)*
  - **B — `roles` = job label; new switch for the permission chip.** *(decides it: changes what an existing field means, which the protocol doc says bumps the protocol version.)*
- **Recommendation:** A — same screens either way, no protocol bump, and it is what the spec already instructs S7b to do.
- **Zoom-out:** Both serve the North Star; neither lights a control the CLI cannot back.
- **The call:** A.

### Technical
- **Files / code paths:** `src/lib/frames.ts:40` (`roles:false`); `docs/frame-protocol.md:63` (new `features` keys are additive); S7b adds `memberRole:true` and the reader line `role: person.role` on the `ls` roster literal; S7ab flips `roles` if it ever ships; S7h's read-only host-admin column must not key off `roles`.
- **Migration / schema:** none (a new boolean in a frozen map).
- **Effort / risk / blast radius:** one line plus a test-invariant rewrite in `frames.test.ts:31`; five batches edit `frames.ts` (see Decision 13).
- **Grounding findings:** `desktop/src/fixtures/design.json` ROSTER `role` values are job labels ("founder", "platform", "web"); the Admin/Member chip is a separate control on the Share screen. Confirms the ambiguity is real.

---

## Decision 2 — Favorites and Follow (S7t)

**Verdict: GATE** (hide now; committed fields behind a written ruling)

### Plain English
- **What's at stake:** The canvas draws a heart with a team-wide favorite count on every skill and a Follow button with a follower count on every person. The real app today fakes both from a per-browser setting, so the "count" is just the viewer. Making them real means two new lists in each person's file in the shared team repo, readable by everyone with repo access, every change a commit.
- **Why it's a fork:** Purely social cost. A following list is a public one-directional social graph inside the team. Favorites also adds a second "rated" signal beside the install count that D38 names as the one signal.
- **Options:**
  - **A — Build both in S7t.** *(decides it: install records are already committed and team-visible, so no new kind of exposure.)*
  - **B — Hide both on the real app.** *(decides it: zero exposure; two drawn controls stay dark on real data.)*
  - **C — Favorites only; Follow hidden.** *(decides it: splits off the social-graph question.)*
- **Recommendation:** A, with the Follow tooltip's "you'll hear when they publish" promise held until the Inbox exists.
- **Zoom-out:** B serves the North Star cleanly: no fake count ever reaches a teammate. The price is design, not honesty.
- **The call:** B. Hide both. Revisit only on Ryan's written ruling.

### Technical
- **Files / code paths:** the heart and Follow render from app-local prefs today (D20: ShareScreen Follow, the card heart); on the real adapter both are hidden or greyed under `favorites:false` / `follow:false` once S7q wires hello features; the mock keeps them so the 87 boards hold. Delete the per-viewer prefs on the real adapter rather than showing a count of one.
- **Migration / schema:** none now. If built later: `favorites`/`following` as `.optional()` arrays on `personSchema` (schema.ts:64), never `.default`; one D38 ledger sentence.
- **Effort / risk / blast radius:** S7t (PF-01, PF-02) removed from the queue; S7b's guard action string no longer shared with it.
- **Grounding findings:** none — conceptual.

---

## Decision 3 — Admin/Member permission roles (S7ab)

**Verdict: LOCK**

### Plain English
- **What's at stake:** The Share screen draws an Admin/Member chip per person and a menu to change it. The team file has no role field, and the write guard for that file admits exactly three kinds of change. GitHub already knows who administers the team repo.
- **Why it's a fork:** Two possible sources of truth for "admin": a field we invent, or the repo's real permissions. An invented field can disagree with what is enforced.
- **Options:**
  - **A — Admin = repo admin on GitHub, read-only; no field, no verb; S7ab retired.** *(decides it: one source of truth, the one with teeth.)*
  - **B — Build S7ab: field, fourth guard arm, role-change verb.** *(decides it: settable chip, but a label unless enforced.)*
  - **C — A now, S7ab kept as a draft.** *(decides it: keeps a door open at the cost of a permanently stale draft.)*
- **Recommendation:** A. A chip that says Member while the person can still push is exactly the promise the North Star forbids.
- **Zoom-out:** A is the only option where the chip never lies.
- **The call:** A.

### Technical
- **Files / code paths:** `src/lib/guard.ts:150-156` unchanged (rows c/d/e then throw). S7h's `ls --host` admin column becomes the model; its chip is read-only host truth and must not key off `roles` (Decision 1). The role menu loses its settable items; "Remove from team" stays. `desktop/GAPS.md:38` rewritten. S7ab removed from the queue.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** removes one draft PR and one Ryan gate; S7h scope unchanged.
- **Grounding findings:** guard table read at f8557c4; TJ-02 was SIMPLE·design, so it was already outside "M7 complete".

---

## Decision 4 — How the app finds git, gh and node when launched from the Dock (S7ad, BM-11)

**Verdict: LOCK**

### Plain English
- **What's at stake:** Opened from the Dock the app does not inherit the terminal's environment, so it cannot find `git`, `gh` or the right `node`; every screen fails (blank-map bug 1).
- **Why it's a fork:** A recorded PATH can go stale if the shell setup changes and the CLI is never run again; a live login-shell PATH is always current but spawns a shell on every start and has no Windows equivalent.
- **Options:**
  - **A — Recorded PATH.** The CLI already writes a state file on every launch, so the PATH refreshes on every terminal use. *(decides it: one mechanism on both platforms, no shell spawn.)*
  - **B — Login-shell PATH at spawn.** *(decides it: freshness, at the cost of a Windows branch and a shell per start.)*
- **Recommendation:** A. Staleness self-heals; Windows is the platform we can test least.
- **Zoom-out:** Serves the North Star by making real data reachable at all.
- **The call:** A.

### Technical
- **Files / code paths:** `app.json` gains `path` (BM-11) beside `target` (BM-12); `desktop/src/backend/tauri/bridge.ts:13` accepts both; `cli_spawn` sets `command.env("PATH", ...)` at `src-tauri/src/lib.rs:48`. Written by `app` and `setup` on every launch.
- **Migration / schema:** additive key on `appStateSchema`; a missing key falls back to the process PATH.
- **Effort / risk / blast radius:** four CLI lines, one Rust line, one §4.2 paragraph; S7ad also stacks on S7ag (both edit lib.rs).
- **Grounding findings:** none beyond the spec's pins — conceptual.

---

## Decision 5 — Project name matching regardless of capitals (S7y, RM-15)

**Verdict: DEFER**

### Plain English
- **What's at stake:** The canvas draws projects capitalised (Terum, SSM, MRF). If the real team file spelled them differently, lookups typed one way would miss the other.
- **Why it's not a fork yet:** Ryan's team file has zero projects. No CLI verb creates one: guard row c lets `publish` change a project's skill list but never add or rename a project, so projects come into existence only by an admin hand-editing team.json.
- **Options:**
  - **Defer** and record the rule "the app shows project names exactly as the team file spells them". *(decides it: nothing to match, nothing that writes names.)*
  - **Build S7y now** on speculation. *(decides it: only worth it if projects are about to be added and capitalisation must be forgiven from day one.)*
- **Recommendation:** Defer.
- **Zoom-out:** Neutral to the North Star; building it changes nothing a teammate sees today.
- **The call:** Defer.

### Technical
- **Files / code paths:** would touch every `Object.hasOwn(team.projects, name)` site (install.ts:57, :235; ls.ts:77; publish.ts:58, :170; search.ts:41; sync.ts:422; uninstall.ts:40; receiptCheck.ts:54) plus one §5.1 paragraph.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** S7y removed from the queue; S7h and S7j (its dependencies) unaffected.
- **Grounding findings:** `~/.terum/skills/teams/Terum/team.json` has `projects: {}`; `guard.ts:174` row c comment: project keys and remotes are untouchable.

---

## Decision 6 — How the app learns what the CLI can do (S7q)

**Verdict: LOCK**

### Plain English
- **What's at stake:** The CLI's first message lists twelve on/off switches for drawn controls. The app discards it and uses its own hard-coded eight, all off, with different names (one overlaps). Nothing on screen ever changes when the CLI gains an ability.
- **Why it's a fork:** Someone must make the names line up: the app reads and maps the CLI's, or the CLI renames to match the app.
- **Options:**
  - **A — App-side mapping; no CLI change.** *(decides it: the CLI names are published in 0.1.6, the app's are internal.)*
  - **B — CLI renames its keys.** *(decides it: touches a published protocol for a cosmetic gain.)*
- **Recommendation:** A.
- **Zoom-out:** Prerequisite for the North Star: without it no control can ever be un-greyed honestly.
- **The call:** A.

### Technical
- **Files / code paths:** `desktop/src/backend/tauri/run.ts:63` (`case 'hello': return;`) keeps the frame; `index.ts:58` stops hard-coding `Capabilities`. Keep the eight-key `Capabilities` (`disablePerMachine` straight across, `perCase` to `perCaseEvalTables`; `inboxEventLog`, `offtargetKind`, `machineRegistry` stay false, their mechanisms are cut) and add a `features` record carrying the CLI's twelve plus `memberRole` (D1). The mock declares every key so the 87 boards hold.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** S7q becomes the batch every un-grey depends on; order it before S7b (memberRole), S7ae (progress), S7u (perCase).
- **Grounding findings:** read at f8557c4: `run.ts:63`, `index.ts:58`, `types.ts` Capabilities (8 keys), `frames.ts:39-42` (12 keys).

---

## Decision 7 — Team categories on the status result (S7k, TJ-12)

**Verdict: LOCK**

### Plain English
- **What's at stake:** team.json already lists seven categories. The status screen wants them. Reading them is free; letting the app add one means widening the guarded team file.
- **Why it's a fork:** The spec left "categories widening" ambiguous between read and write.
- **Recommendation and call:** Read only. Follows D3: the guard table stays closed; adding a category is an admin hand edit like a project.

### Technical
- **Files / code paths:** `categories` onto `TeamStatus` (status.ts:17-22) from the parsed team; no guard change; `desktop` Settings/Marketplace read it. TJ-12's write route stays refused.
- **Grounding findings:** `~/.terum/skills/teams/Terum/team.json` categories = debugging, testing, docs, workflow, research, infra, misc.

---

## Decision 8 — A --cwd flag on three verbs (S7aa, MC-01)

**Verdict: LOCK** (skip as moot)

### Plain English
- **What's at stake:** Some verbs depend on which repo they run from; the app has no current folder. The spec proposed a flag, and instructed the implementer to first check whether the app can simply start the CLI inside that folder.
- **The check:** `cli_spawn` accepts `cwd` and calls `command.current_dir(dir)` (`desktop/src-tauri/src/lib.rs:44-45`). The flag buys nothing.
- **The call:** S7aa returns skipped, reason MOOT. The app passes the folder at spawn.

### Technical
- **Files / code paths:** none change. `InstallArgs.cwd`, `UninstallArgs.cwd`, `SyncArgs.cwd` already exist for library callers; the commander registrations stay absent.
- **Grounding findings:** lib.rs read at f8557c4.

---

## Decision 9 — How the app notices changes it did not make (S7w, RM-23)

**Verdict: GATE**

### Plain English
- **What's at stake:** A terminal install or a background hook sync changes the data and the app's boards go stale silently. The app cannot read files; its native powers are start/talk to/stop the CLI, read one state file, report the platform.
- **Why it's a fork:** A sixth native power widens the footprint; spawning the CLI on a timer is measured-expensive (10 node + 15 git children for three teams per cycle) and an app-initiated sync suppresses the real session hook for an hour; refreshing on focus is cheap and honest but misses changes while already looking.
- **Options:**
  - **A — Own-action + focus refresh now; explicit Sync now; native check only if staleness bites.** *(decides it: covers "did it in the terminal, then looked" with no new native surface.)*
  - **B — Add the narrow read-only mtime command now, polled slowly.** *(decides it: catches background change while focused, at the cost of native surface and a poll.)*
  - **C — Spawn the CLI on a timer.** Rejected: measured cost and the hook-suppression bug.
- **Recommendation:** A, gated.
- **Zoom-out:** Serves the North Star: a stale board is a previously true board and is refreshed the moment the person looks.
- **The call:** A.

### Technical
- **Files / code paths:** AD-05's `backend.subscribe` consumer in `providers.tsx`; revalidate-on-visible via the query client's focus policy (AD-02); a Sync now action. `lib.rs:137` stays at five commands; `capabilities/default.json` unchanged. If the gate fires: one `#[tauri::command] stat_state_files()` returning mtimes for `config.json` and each `run/<team>.stamp`, no general fs permission, debounce ≥250 ms, ignore `.lock` dirs and `config.json.<pid>.<uuid>.tmp`.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** S7w shrinks to RM-24 (driving setup) plus the focus policy; the native half is deferred.
- **Grounding findings:** lib.rs command list and capabilities read at f8557c4; the sync addendum's "never sync on a timer" rule stands.
- **Amendment (2026-09-10, W-08, spec `.planning/specs/2026-09-10-w08-refresh-receipts.md`):** (a) the CLI `refresh` verb closes the **remote** staleness case this decision did not consider — a teammate's commit reaches this machine only through a fetch, and the app now runs one on focus, throttled to a minute, never on a timer; (b) the deferred sixth native `stat_state_files()` command stays deferred and its gate is still unmet; (c) `lib.rs` stays at five commands.

---

## Decision 11 — Who amends the eval-engine §12 rule (S7v)

**Verdict: LOCK**

### Plain English
- **What's at stake:** One sentence in Ajay's eval-engine spec ("the UI never runs evals and never derives new statistics") blocks five drawn eval controls. Three other batches add eval fields the rule never forbade.
- **Why it's a fork:** Ajay owns that spec and is active this week; Ryan owns the product.
- **Options:**
  - **A — Split: additive batches now, the reversing paragraph goes to Ajay as a one-message ask.**
  - **B — Ryan amends it himself; Ajay informed in the PR body.**
  - **C — All eval work waits on Ajay.**
- **Recommendation:** A.
- **Zoom-out:** B serves the North Star: the five controls light from real receipt data, and no CLI change is faked. The precedent cost (spec ownership is nominal) is Ryan's to accept as owner.
- **The call:** B. Ryan writes the §12 paragraph; S7v, S7m, S7n, S7u all proceed with Ajay named in the PR body.

### Technical
- **Files / code paths:** `.planning/specs/2026-09-04-eval-engine.md:480` (the sentence) plus the paired display rule at §5.4 :251-252 and §12 :481-482, amended together; S7v ships the three app rules (suppress when arm model differs from `receipt.provenance.model`; render nothing on no-receipt; label the estimate as arm-run pricing).
- **Migration / schema:** none; receipt is passthrough.
- **Effort / risk / blast radius:** one spec paragraph; EV-01, EV-02, EV-09, EV-16, EV-19 unblock; `liftOnCards` and `runEvalInApp` switches flip in S7v.
- **Grounding findings:** Terum record shows Ajay active on eval work 2026-09-05 to 2026-09-08.

---

## Decision 12 — Who merges

**Verdict: LOCK**

### Plain English
- **What's at stake:** Teddy's rule let the automated implementer merge its own PR the moment gates and CI were green, unread by a human. Ryan is now the addressee of those PRs.
- **Why it's a fork:** Speed versus eyes on the shared contracts; Codex gate reports have been wrong before.
- **Options:**
  - **A — Tiered: field-only and app-only self-merge; contract batches (S7b, S7d, S7ae, S7k, S7ag, S7ad) wait for Ryan.**
  - **B — Self-merge everywhere; Ryan reviews after the fact.**
  - **C — Ryan reviews every PR.**
- **Recommendation:** A.
- **Zoom-out:** B is a throughput call, not a data-honesty one, so it does not cut against the North Star. Its one real exposure is that the queue's automated final reviewer and the per-batch real-data proof become the only checks between a bad batch and main.
- **The call:** B, with the rider that the final reviewer and the real-data proof are mandatory and non-skippable for every batch.

### Technical
- **Files / code paths:** queue script merge step unchanged (merge commit after green CI, never a draft, never a hook bypass); `no-verify-guard.js` stays; the real-data proof vitest under `<wt>/.planning/codex-runs/m7-<id>/` is a merge precondition.
- **Effort / risk / blast radius:** every batch; a bad merge is unwound by revert on main.
- **Grounding findings:** none — process.

---

## Decision 13 — The frames.ts file four batches edit

**Verdict: LOCK** (obvious; stated, not asked)

### Plain English
- **What's at stake:** After D2 (S7t gone) and D6 (S7q app-side), four batches still edit the CLI's frames file: S7d (channel fixes), S7b (`memberRole`), S7l (`hook` verb), S7ae (progress). Two rewrite the same test line asserting every switch is off.
- **The rule:** S7d first, and it rewrites that test into a snapshot of the whole switch map. S7b, S7ae, S7l then stack on the previous editor's branch and each change one line.

### Technical
- **Files / code paths:** `src/lib/frames.ts:39-42` (map), `:23` (`ProgressFrame`), `FRAME_VERBS` at `:30`; `src/lib/__tests__/frames.test.ts:31` (the all-false invariant). Queue `dependsOn`: S7b ← S7d; S7ae ← S7b; S7l ← S7ae.
- **Grounding findings:** frames.ts read at f8557c4.

---

## Decision 10 — Smallest allowed window (S7x, AC-04)

**Verdict: LOCK + DEFER** (scroll rule locked; true reflow deferred)

### Plain English
- **What's at stake:** The boards are drawn at 1440x900. The shipped app shrinks to 960x600, where panels overlap and tables clip. The sixteen rules for how boards should reflow were never written and need narrow boards drawn on the canvas, which is not on this machine.
- **Why it's a fork:** Small laptops want a small window; honest boards need 1200 px; real reflow is blocked on the canvas handover.
- **Options:**
  - **A — Raise the minimum to 1200x720.** *(decides it: two config numbers, boards always fit, small windows impossible.)*
  - **B — Keep 960x600 with real reflow.** *(decides it: blocked until the canvas arrives.)*
  - **C — Keep 960x600; the content keeps its 1200-wide layout and scrolls sideways inside the window.** *(decides it: one CSS rule, honest at every size, no canvas needed; reflow can replace it later.)*
- **Recommendation:** C, after Ryan's first pick (B) was checked against the North Star: at 960 with no reflow rules the screen is wrong, and the rules cannot be written here.
- **Zoom-out:** C serves the North Star at every window size: nothing overlaps, nothing is clipped, the boards are exactly as drawn.
- **The call:** C now; B's reflow deferred behind the canvas. Post-script: the canvas arrived the same afternoon (terum-teammate-bundle), so the deferral's gate is met and S7x is simply last in queue order.

### Technical
- **Files / code paths:** `desktop/src-tauri/tauri.conf.json:18-19` unchanged (960/600); the shell's main panel gets `min-width: 1200px` on its content wrapper with `overflow-x: auto` on the panel (`desktop/src/components/domain/Shell.tsx`), pixel-neutral at 1440x900 so the 87 boards hold. S7r's AC-04 D-W1 clause (min 1200x720) is superseded by this rule; the work-area clamp and window-state persistence stay.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** one rule plus one Playwright assertion at 960 that nothing overflows its container; S7x's sixteen reflow rules and second baseline stay deferred.
- **Grounding findings:** `tauri.conf.json` read at f8557c4: width 1440, height 900, minWidth 960, minHeight 600.

---


**2026-09-09 — Ryan, first run in the app (LOCK).** B with A-fallback: the app drives target-less setup for an `intent:'setup'` hand-off or a zero-team machine, with the honest no-team Library board as fallback. The footer identifies the GitHub login. One team per machine is the model to follow in its own batch. A joiner never types a target in the app (Teddy's D-BM-3 rider).

---

## Decision 14 — One team per machine (F1-F8; MC-07 cancelled)

**Verdict: LOCK** (Ryan, 2026-09-08/09)

### Plain English

- **F1:** One team per machine.
- **F2:** REFUSE model: a second binding is refused before any side effect, never auto-left or switched. Leave the current team, then join.
- **F3:** Leaving the last team clears every `approvals` record, so the next team asks again for tool permissions.
- **F4:** No forced sync on leave.
- **F5:** Legacy 2+ machines retain reads, syncs and leave with a hint; only new bindings are refused. Writes naming a team explicitly also keep working, as the locked ruling specifies.
- **F6:** `--team` and `--as` are hidden but accepted and validated.
- **F7:** The `teams` record stays; no migration.
- **F8:** The session hook is unchanged.

MC-07 (`--team` everywhere as a product feature) is cancelled; its argv half remains as S7af AD-06.

### Technical

`src/lib/auth.ts` owns `refuseSecondTeam`, the locked `assertBindable`/`bindTeam` check, and normalized matching through `teamByRemote`. `src/lib/result.ts` adds `RefusedError`; `src/lib/frames.ts` carries `refused` without a protocol bump, and `src/lib/execute.ts` forwards it. Setup, team create/join and install call the shared pre-flight before side effects; setup and install preserve child typed outcomes. Leave clears approvals on the last team and removes the hook inside the team mutex. `src/cli.ts` uses `hideHelp()` for the accepted overrides. Config selection, connect/publish/uninstall hints, README, the bundled skill, frame documentation and regression tests follow the one-team wording. The desktop half is a separate PR.

## Amendments

- 2026-09-10 amendment (D9, f-update-policy): the shell gains a seventh native command, `app_update_on_close`. D9 caps the native surface because every command is a hole in the WebView boundary; this one is allowed because it is the only way an installer can outlive the window that asks for it — by the time it runs, the WebView is gone. It takes a version string and nothing else, is reachable only from the last-window-close and exit-requested handlers, and runs at most once per session. Authority: Teddy, 2026-09-10, "auto update overnight or upon app close".
