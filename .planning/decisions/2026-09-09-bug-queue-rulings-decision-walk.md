---
title: bug-queue rulings decision walk
date: 2026-09-09
north_star: Every control in the app and CLI does exactly what it says or is not shown, and no ordinary action loses a teammate's work.
status: complete
deferred:
  - what: Bug 21 A′ — move the combined search into the adapter's search() so mock and real agree on kinds (D8)
    gate: when a consumer needs Backend.search or the mock/real kinds mismatch bites a test
  - what: Bug 15 SkillDetailRemove board re-lock and Bug 18 SettingsEvals re-lock after the rows change (D1, D4, D5)
    gate: Teddy's canvas edit + re-shoot on the Mac oracle
  - what: Search and SearchNoResults boards for the ⌘K screen shipped unlocked (D8)
    gate: Teddy draws them; then lock the screen in FIDELITY.md
  - what: Bug 20 desktop consumption PR and Bug 18/19 batches stacked behind the #88 rebuild (D4–D7)
    gate: the #88 rebuild READY line and merge
  - what: PR #92 folded #87's per-copy selection into bulk uninstall (select per skill, then one confirm) — whether bulk verbs should instead take every copy without selecting
    gate: Ryan's read of PR #92's uninstall.ts selectCopies() note
---

# Bug-queue rulings — Decision Walk

**North Star:** Every control in the app and CLI does exactly what it says or is not shown, and no ordinary action loses a teammate's work. (ratified by Ryan, 2026-09-09)

Context: the 0.1.7 bug queue (`.claude/handoff-bug-queue.md`) produced six rulings only Ryan can make; each has a converged spec in this session's scratchpad waiting on the answer. Walked 2026-09-09 ~08:45 UTC against origin/main 67f1f57.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Bug 15 — skill page single Remove: one question or two | LOCK | The one question shown is the CLI's true one; Teddy re-locks SkillDetailRemove | → follow-up on fix/bulk-remove-confirm; Teddy re-lock |
| 2 | Bug 16 — connecting a folder you already installed (A convert vs C keep both) | LOCK | Connecting converts the placed copy into the source; no lying record, no lost edit | → CLI PR on main after #92 and #89 |
| 3 | Bug 16 sub-forks — uninstall-skill on a source, install --force onto a source, baseline rule for edited folders | LOCK | Refuse uninstall-skill on a source, refuse install --force onto a source, unset baseline for an edited folder | same PR as D2 |
| 4 | Bug 18 F1 — who owns the Evals k / model / judge defaults | LOCK | App owns eval k/model/judge and passes them on argv; one S7r sentence | after the #88 rebuild |
| 5 | Bug 18 F2 — the global "Commit receipts" switch vs D2 | LOCK | D2 stands; the global Commit receipts switch is removed | after the #88 rebuild; SettingsEvals re-lock once |
| 6 | Bug 19 — About wording "available" vs "advertised", and the CLI probe field | LOCK | About keeps "X available"; a typed probe field makes the failed-check states honest | after the #88 rebuild |
| 7 | Bug 20 — Files count: path for not-installed skills, Size in the same PR, mock nulls | LOCK | Clone folder as path for not-installed skills; Size in the same change; mock cards null | 3 PRs: app keys → CLI emission → consumption after #88 |
| 8 | Bug 21 — ⌘K search: ship undrawn, team scope, screen vs adapter ownership | LOCK | Ship ⌘K unlocked over the served catalog, team scope; A′ deferred | main now; Teddy draws Search boards |

---

## Decision 1 — Bug 15: the skill page's single Remove asks once, with the CLI's own question

**Verdict: LOCK — A**

### Plain English
- **What's at stake:** The bulk-remove fix makes the CLI ask "Remove these folders?" listing the exact folders before it deletes anything. The skill page's Remove button already opens a drawn dialog. Without a ruling a person is asked twice for one click.
- **Why it's a fork:** The drawn dialog is a locked board; making the CLI's question be the dialog means Teddy re-locks it. Keeping the drawn dialog means two questions, or pre-answering a question the user never saw.
- **Options:**
  - **A — The CLI's question becomes the dialog.** Drawn look, body = the CLI's folder list, one question. *(decides it: the one question shown is the true one; one board re-lock)*
  - **B — Drawn dialog, then the CLI asks as a second dialog.** *(decides it: two questions for one click)*
  - **C — Drawn dialog, auto-answer the CLI.** *(decides it: pre-answers something the user never saw; forbidden by the pre-answer rule)*
- **Recommendation:** A — the only option where the single question is the honest one.
- **Zoom-out:** A serves the North Star directly; B is honest but clumsy; C fails "does what it says".
- **The call:** A.

### Technical
- **Files / code paths:** `desktop/src/screens/skill/SkillScreen.tsx` (~:41, the Remove trigger and its pre-answer), the prompt provider's dialog rendering (`desktop/src/app/providers.tsx`), the mock's uninstall ask detail so the SkillDetailRemove board keeps its drawn body apart from the folder lines. Spec: bulk-remove `spec-bulk-remove-confirm.md` (cc2cc192 scratchpad, audit-bulk-remove) — the SkillScreen exclusion is lifted by this ruling.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** one component, one mock fixture, one canvas edit + re-shoot (Teddy). Footnote only.
- **Grounding findings:** none — conceptual; the bulk-remove spec and its Astra review already established the double-ask.
- **Stacking:** a follow-up on the bulk-remove PR (`fix/bulk-remove-confirm`) after it merges; the board re-lock is a Teddy task.

## Decision 2 — Bug 16: connecting a folder you already installed converts it into your source

**Verdict: LOCK — A**

### Plain English
- **What's at stake:** Install a team skill (the tool places a copy and records "generated, replaceable"), then connect that folder as your authoring source. Both records stay today, so the next sync pushes your edit as a source and then, as the placement loop, quarantines the folder as drift and writes a fresh copy over it. A deferred push leaves the edit only in quarantine, which `sync --prune` deletes on one confirm.
- **Why it's a fork:** the phase-1 spec (:374) says a folder "may be both" and also that an installed copy is replaceable output; one folder cannot honour both.
- **Options:**
  - **A — Connecting converts it.** Drop the placement key when the shared record is written; the folder is the source from then on. *(decides it: one record, one rule; sync, uninstall-skill, ls and leave need no per-consumer patch)*
  - **C — Keep both, teach everyone.** Skip-if-also-a-source checks in sync's refresh, rename and orphan passes and in uninstall-skill; the Library keeps showing a placement sync never refreshes. *(decides it: literal spec text preserved at the price of a record the tool no longer honours)*
  - B (refuse the connect) was excluded by the review: it deletes the folder the person is trying to adopt.
- **Recommendation:** A. Codex leaned C on the literal text; the wrapper and the investigator land on A because C keeps a lying record.
- **Zoom-out:** A serves both halves of the North Star (no lie, no loss).
- **The call:** A.

### Technical
- **Files / code paths:** `src/commands/connect.ts` adoption branch (~:192-204) and mint branch (~:208), `src/lib/schema.ts:109` (baseline optional), `sync.ts` reconcile → placement-loop order (~:207 → :267/:283/:287), `uninstall.ts:112-135`, `install.ts:107/:119-121`. Spec: `converge-16/spec-connect-adoption.md` (this session's scratchpad), sections A.1–A.7, tests T1–T7; adds one sentence to `.planning/specs/2026-09-02-phase-1-build.md:374`.
- **Migration / schema:** none on the wire; optional legacy-record migration (A.7) is moot — no released CLI carries #82's adoption.
- **Effort / risk / blast radius:** one CLI PR on main; desktop rail follow-ups after the #88 rebuild (hide "Manage with Terum" on connected rows, fix the ":45 publishes reconcile" copy). Footnote only.
- **Grounding findings:** investigator + Astra review + wrapper spot-checks on 67f1f57; the data-loss chain is confirmed statically, not executed (T4 is the executable proof).

## Decision 3 — Bug 16 sub-forks: refuse uninstall-skill on a source, refuse install --force onto a source, diverged-asks baseline

**Verdict: LOCK — refuse / refuse / unset-baseline**

### Plain English
- **What's at stake:** three doors into the same double state, or into deleting authored work, once decision 2 converts a placed folder into a source.
- **Why it's a fork:** each has a lenient reading (do the destructive thing but tell the team file) and a strict one (refuse and name the command that does what the person meant).
- **Options and the call:**
  - **3a `uninstall-skill` on a folder that is now a source:** refuse and point at `connect --forget` *(chosen)*, vs "count me out" (keep folder, edit the people file only). A remove that silently keeps the folder does not do what it says.
  - **3b `install --force` onto a connected source:** refuse regardless of the flag and clear the pending intent *(chosen)*, vs drop the shared record and place over it. Force forces a placement, not an un-sourcing.
  - **3c baseline on connect:** set the baseline only when the folder still equals the placed copy or the repo; otherwise leave it unset so the next sync reports diverged and asks *(chosen)*, vs trust the folder as-is (today: the repo is pulled over a pre-connect edit). Applies to non-placed adoption too; one #82 test expectation flips by ruling.
- **Zoom-out:** all three are the "no lost work" half of the North Star.
- **The call:** all three as recommended.

### Technical
- **Files / code paths:** `src/commands/uninstall.ts:112-135`; `src/commands/install.ts:107` (pending intent) and `:119-121` (ownership refusal); `src/commands/connect.ts:199` (baseline) and `:201` (re-adoption refuses with a `--relocate` pointer); `connect.test.ts:1221`. Same CLI PR as decision 2; tests T1–T6 in `converge-16/spec-connect-adoption.md`.
- **Migration / schema:** none (`schema.ts:109` already allows an unset baseline).
- **Effort / risk / blast radius:** three guards + one rule; footnote. Risk: a refusal message must name the remedy verb each time.
- **Grounding findings:** Astra review found the baseline hazard and the reverse door; wrapper confirmed statically on 67f1f57.

## Decision 4 — Bug 18 F1: the app owns the Evals k / model / judge defaults and passes them on the eval argv

**Verdict: LOCK — (a)**

### Plain English
- **What's at stake:** Settings ▸ Evals draws three selectors that promise to set the flags the app passes to `eval`. On a real machine the write is rejected (red error) and the argv never carried the values; the CLI's own defaults are k = 3, one model, judge = model.
- **Why it's a fork:** S7r says the app store holds only per-machine chrome; eval defaults are not chrome, so honouring the selectors means widening that rule or deleting them from a locked board.
- **Options:**
  - **(a) — App-owned argv defaults.** One sentence in S7r names the three keys as per-machine settings; the argv gains `--k --model --judge-model`. *(decides it: k = 10 from the app works; caveat: only k does work until a second model exists)*
  - **(b) — Remove the three selectors.** Read-only note; canvas edit + SettingsEvals re-lock. *(decides it: honest, but k ≠ 3 is back to the terminal)*
  - **(c) — CLI config verb.** *(decides it: contradicts phase 1's no-user-defaults stance; uncosted verb)*
- **Recommendation:** (a).
- **Zoom-out:** (a) and (b) both satisfy "does what it says or is not shown"; (a) also serves the app's purpose.
- **The call:** (a).

### Technical
- **Files / code paths:** `desktop/src/backend/prefs.ts:6-8` allowlist (+ `eval:k`, `eval:model`, `eval:judge`), `desktop/src/backend/tauri/index.ts` eval argv (~:398), `SettingsContent.tsx:81-82` (k description reads the pref, not `d.K`), `.planning/specs/m7-S7r.md` §1 (+1 sentence). Spec: `converge-18/spec-settings-prefs.md` (ruling-independent batch first) + `forks-for-ryan.md` F1(a) delta.
- **Migration / schema:** none; three new preference keys.
- **Effort / risk / blast radius:** allowlist, argv, one spec sentence, tests. Footnote. Stacks after the #88 rebuild (SettingsContent overlap).
- **Grounding findings:** tier-2 Astra review + wrapper verdict + converge on 67f1f57.

## Decision 5 — Bug 18 F2: keep D2, remove the global "Commit receipts" switch

**Verdict: LOCK — (a)**

### Plain English
- **What's at stake:** the run dialog's "Commit the receipt to the team" checkbox is locked by D2 (eval walk) as visible every run, default on. Settings ▸ Evals also draws a global "Commit receipts" switch that writes a key nothing reads and errors on a real machine. Two controls for one choice; one lies.
- **Why it's a fork:** the switch is on a locked board; making it true means a remembered global default changes what the checkbox opens as — the "default off" reading D2 rejected.
- **Options:**
  - **(a) — Keep D2, remove the switch.** Per-run checkbox is the only control; the Settings row becomes a read-only line ("Asked on every run; the receipt is committed after secret redaction"). *(decides it: the push stays visible before every click)*
  - **(b) — Amend D2 so the switch seeds the checkbox.** *(decides it: whoever flipped it once has "default off" silently)*
- **Recommendation:** (a).
- **Zoom-out:** (a) is the North Star exactly; (b) undoes a decision made the same day for a reason that still holds.
- **The call:** (a).

### Technical
- **Files / code paths:** `SettingsContent.tsx:83` (row → read-only line), `desktop/src/backend/prefs.ts` (`eval:commit` retired), canvas `build.py` SettingsEvals rows edited together with decision 4's change so the board is re-locked once (Teddy/Ajay approver per CP-S4). `RunEvalDialog.tsx:14` unchanged (`useState(true)`).
- **Migration / schema:** none.
- **Effort / risk / blast radius:** one row + one canvas edit + re-shoot. Footnote. Stacks after the #88 rebuild with decision 4.
- **Grounding findings:** `forks-for-ryan.md` F2; D2 at `.planning/decisions/2026-09-09-eval-button-decision-walk.md`.

## Decision 6 — Bug 19: About keeps "X available" and the CLI update report gains a typed probe field

**Verdict: LOCK — option 1**

### Plain English
- **What's at stake:** Settings ▸ About shows "— available" today because the settings read never runs the update check. The fix runs the existing check when About opens and writes one sentence. The check reads the team repo's tag list, so the CLI knows a version was announced, not that npm can hand it out.
- **Why it's a fork:** the drawn string is "0.1.8 available" (locked board); "advertised" is more precise but moves the board and differs from the terminal's own wording. Separately, "check failed but an older answer is remembered" is only expressible in prose today, and the app may not parse prose.
- **Options:**
  - **1 — Keep "available", add a typed probe field (ok / failed / skipped) to the update report.** All nine states honest; board stays locked. *(decides it: matches the CLI's word, no re-shoot, failed-check rows stay honest)*
  - **2 — Keep "available", app-only.** A stale remembered version can read as a fresh "available". *(decides it: one honest row lost)*
  - **3 — "advertised" + probe field.** More precise; SettingsAbout re-shot; app and CLI wording differ.
- **Recommendation:** 1.
- **Zoom-out:** 1 satisfies "does what it says" in every state; 2 has one lying state; 3 is precision at the price of two words for one fact.
- **The call:** option 1.

### Technical
- **Files / code paths:** `src/commands/update.ts:11,:40` (`UpdateReport.probe`), `src/lib/update.ts:88-90,:144,:152,:159-164` (probe outcomes), adapter `cliUpdate` strict schema declares `probe`, `SettingsScreen.tsx:23,:29` (query enabled for updates||about), `SettingsContent.tsx` About row → pure `releaseDesc()` in `settings-data.ts` with the ten-row copy table in `converge-19/spec-adapter-joins.md` §5.2. Mock still renders `0.1.3 available`.
- **Migration / schema:** one additive field on the update report (S7e RM-08 amended by one line; protocol stays 1).
- **Effort / risk / blast radius:** CLI 3 tests, adapter 11, screens 7 (spec §6). Footnote. Stacks after the #88 rebuild with the rest of bug 19 (A1 Sharing rows).
- **Grounding findings:** tier-2 Astra review + wrapper + converge on 67f1f57.

## Decision 7 — Bug 20: real file inventory; clone folder as path for not-installed skills; Size in the same change; mock cards go null

**Verdict: LOCK — all three as recommended**

### Plain English
- **What's at stake:** the skill page's Files row and the drawn file menu (locked board SkillDetailFiles) read a fixed one-file list on real machines, so every skill says "Files 1" and the menu is unreachable. The CLI already walks each placed folder and discards the list; team skills are not walked at all.
- **Why it's a fork:** three details of the fix are product calls: where a not-installed skill's files open from, whether Size ships now, and what the un-drawn mock cards claim.
- **Options and the call:**
  - **7a** serve the team-clone folder as the skill's path so the menu opens the real file *(chosen)*, vs keep the menu inert until installed.
  - **7b** Size from the same walk, decimal kilobytes to match the drawn "21.4 kB" *(chosen; 1024 is a one-line flip)*, vs leave Size a dash.
  - **7c** ordinary mock cards → null, the honest mock of an un-upgraded CLI *(chosen)*, vs keep the one-file claim.
- **Zoom-out:** all three make a drawn control true; none moves a locked board.
- **The call:** all three.

### Technical
- **Files / code paths:** `src/commands/ls.ts` (local rows + team rows gain optional `files`, `bytes`, `lines`, `directory`; list-only walker exported from `src/lib/placer/vendor/skillhub/skill-fingerprint.ts:41-61`, never the read+sha snapshot), `desktop/src/backend/tauri/index.ts:45,:49,:76` (optional zod keys; `inventoryDetail` takes files/path/bytes from one row), `desktop/src/backend/tauri/bytes.ts` (new `formatBytes`, decimal), `SkillScreen.tsx:27,:29,:45` (null-safe; SKILL.md by name; `?menu=files` with null renders nothing), `mock/data.ts:23` (null), `data.test.ts:4` flips. Spec: `converge-20/spec-files-inventory.md`.
- **Migration / schema:** additive optional fields; protocol stays 1; no feature flag (frame-protocol.md:73).
- **Effort / risk / blast radius:** three PRs in order — A desktop accepts the keys (main now, after the in-flight adapter PRs land), B CLI emission (main), C desktop consumption (after the #88 rebuild). Risk: walk cost on large teams unmeasured; `ls member` reads skip the walk.
- **Grounding findings:** investigator, Astra review (app-first landing, list-only walker, no flag), converge on 67f1f57.

## Decision 8 — Bug 21: ship the ⌘K search unlocked, team content only, combined in the screen over the served catalog

**Verdict: LOCK — ship unlocked / team scope / option A; A′ DEFERRED**

### Plain English
- **What's at stake:** the top-bar box and ⌘K land on "Search is coming". The Library and Marketplace search rows already work; the combined "skills, people, projects" search the box promises is the only stub, and the app already holds the team catalog with all three.
- **Why it's a fork:** no results board is drawn; the tour's three-row list is the only drawn shape. The Library ruling separates machine folders from team packages. The unused `Backend.search` seam could own the combining instead of the screen.
- **Options and the call:**
  - **8a** ship now, unlocked, reusing the tour's row component; Teddy draws `Search`/`SearchNoResults` boards to lock later *(chosen)*, vs hold until drawn.
  - **8b** team content only (catalog skills, people, projects) *(chosen)*, vs also local folders (would blur the Library ruling; the Library has its own row).
  - **8c** option A, combine in the screen over the react-query catalog; the seam stays a CLI-parity hook *(chosen)*, vs A′, combine inside the adapter's `search()` so mock and real agree on kinds at the cost of a CLI spawn per query — deferred, seven-step delta in the spec.
- **Zoom-out:** a box that says "coming" fails "does what it says"; A ships the promise with no new process per keystroke.
- **The call:** all three as recommended.

### Technical
- **Files / code paths:** `desktop/src/screens/search/SearchScreen.tsx` (real screen bound to `?q=`), `desktop/src/lib/search-match.ts` (shared matcher; MarketplaceScreen, ShareScreen and the new screen move now, LibraryScreen and both adapters' `catalog(q)` after #88), `SearchResults` extracted from `OnboardingBasics.tsx:13` with `hovered` prop and `kind:ref` keys, `App.tsx:20` ⌘K focus policy, `routes.spec.ts:15`. Skill rows link `#/skill/<name>?root=marketplace`; person meta `handle · role` when `features.memberRole`. No-team routes to the Library's "No team on this machine" board (real-adapter fake-bridge test). Spec: `converge-21/spec-search.md`.
- **Migration / schema:** none; `Backend.search` untouched.
- **Effort / risk / blast radius:** one screen + one shared module + one extracted component; the OnboardingSearch lock is proven only by the Mac fidelity run at ≤0.0030. Branches from main now; files owned by the #88 rebuild (mock/index.ts, types.ts, Backend.ts, routes.tsx, Shell.tsx, invalidation.ts) are do-not-touch.
- **Grounding findings:** investigator, Astra review (refetchOnMount 'always' refetches the catalog fan-out on every mount — accepted, same convention as Marketplace), converge on 67f1f57.
