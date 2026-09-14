---
title: cross-mirror overlays review decision walk
date: 2026-09-13
north_star: Each screen tells you the truth about your copy versus the team's (installed, which version, how it scored), proven by identical bytes, never a name; nothing moves between the two unless you ask, except eval results. And an outside implementer can build M2 from the spec without inventing a contract.
status: complete
deferred:
  - what: A terminal flag for reconciling a single project by hand — the reconcile scan takes an in-process root only, passed by project add (D6)
    gate: the first request to reconcile one project from the terminal promotes root to a documented --root <path> flag
  - what: Nothing in this walk was checked against the team's shared record; the terum MCP refused auth again (HTTP 401), so check_decision never ran over D1–D8
    gate: the MCP endpoint accepts the configured Authorization header — re-run check_decision over every row of this ledger before the M1.1 build starts
---

# Cross-Mirror Overlays Review — Decision Walk

**North Star:** Each screen tells you the truth about your copy versus the team's, proven by identical bytes, never a name; nothing moves between the two unless you ask, except eval results. Plus, for the M2 half: an outside implementer can build M2 from the spec without inventing a contract.

Ratified by Ryan 2026-09-13. The first clause is the 2026-09-13 cross-mirror overlays walk's North Star, unchanged; the second was added for this walk because its M2 findings are build-readiness gaps, not behaviour forks.

**Why this batch exists.** `/codex-spec` ran over `.planning/specs/2026-09-13-cross-mirror-overlays.md` (M2 scope, dims reality + readiness; finders Codex `gpt-5.6-sol`, verifiers a 2-vote Claude panel) after M1 landed on `main` as `753efa4` (PR #199). Report: `.planning/specs/reviews/2026-09-13-cross-mirror-overlays.codex-spec.review.md`. 14 findings were confirmed and every one landed in the triage's "clear" bucket, but two of them (6 and 10) recommended opposite fixes to the same rule, and five others recommended changing the just-merged M1 code rather than the spec. Those are decisions, not edits, so they are walked here.

**Batch source:** the review above. Governing spec: `.planning/specs/2026-09-13-cross-mirror-overlays.md`. Parent ledger: `.planning/decisions/2026-09-13-cross-mirror-overlays-decision-walk.md` (D1–D5 LOCKED).

**Team-record check:** the `terum` MCP server refused auth this session (HTTP 401). Nothing here was checked against standing team decisions.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Library version when the install record and the bytes disagree | LOCK | The bytes win on both mirrors: a folder whose bytes are a published version shows that version, never the number the ledger remembers, and is not "edited" | — |
| 2 | Where Publish appears on a Marketplace card | LOCK | Only on "your copy differs" (on disk, never installed, matches no version); an edited install shows the check and Reinstall, and publishes from the Library | — |
| 2b | Label for an installed copy that was edited | LOCK | Marketplace "Version N · you have Version M (edited)" for both the behind and on-latest cases; Library "Version M (edited)" replaces "Edited from Version M"; same qualifier on both screens | — |
| 3 | Who is named on an eval line when your receipt and the team's are the same run | LOCK | A "did I run this" flag on both receipts, the team receipt wins a tie; a runner is named exactly when the flag says it was someone else | — |
| 4 | Version words and the green check as one wrap unit | LOCK | The check moves in with the version words ("Version 3 · installed ✓" never splits); the right side keeps actions and the enable switch | — |
| 4b | Card height and version wording (§11 gate 3) | LOCK | Cards keep a 148px minimum and grow when a label wraps; card version slots and card eval lines abbreviate "Version N" to "vN" so wrapping is rare; prose (terminal, dialogs, README) keeps the full word | — |
| 5 | `install --adopt` crash recovery | LOCK | Adopt writes the machine's record last (note, team record, machine record, clear note), so a crash leaves the folder visible to the scan and the cards true from the bytes; re-running adopt finishes it by the existing drain rule | — |
| 6 | Scoping the reconcile scan to a newly added project | GATE | An in-process `root` argument only `project add` passes, refused unless it is a registered project root after canonicalisation; one named desktop handler opens the dialog; no terminal flag | promote to `--root <path>` the first time someone asks to reconcile one project by hand |
| 7 | `install --adopt` argument shape | LOCK | Exactly one of a skill reference or an adopt path; adopt refuses destination flags; scope derived from which Library root the folder sits under; `ref` becomes optional in the desktop type | — |
| 8 | How the M1 code-side fixes ship | LOCK | A small M1.1 PR built inline before M2, after one spec revision; M2's build and its codex-spec re-run then see only M2 | — |
| 9 | The §7 copy as revised (spec §11 gate 1) | LOCK | Approved as written, 2026-09-14: `vN` on cards, `you have vM (edited)`, the D7 grammar refusals, the D6 root refusal, the name-only publish warning, `your copy differs` | a reworded card string is a one-line follow-up, not a spec change |
| 10 | Does `install --adopt` ask the `allowed-tools` consent question (spec §11 gate 2) | LOCK | Yes — adopt runs `ensureConsent` per adopted skill with grants; a consent row must mean a person read the grants when Terum started tracking the folder | — |
| 11 | How M2 is built | LOCK | `/codex-implement` against spec rev 2, in an isolated worktree off `origin/main`; the orchestrator re-runs every gate | — |

---

## Decision 1 — Which version does the Library show when the bytes and the install record disagree?

**Verdict: LOCK — A, the bytes win, on both mirrors.**

### Plain English
- **What's at stake:** Terum installed a skill as Version 2; later the folder's contents became byte-for-byte Version 1 (old files copied over it, or a project repo reverted). The merged M1 card says "Version 2" with an Edited chip for a folder that is exactly Version 1. The spec (§3.1 lines 128–130) claims the case cannot occur; the CLI test `ls-local-overlay.test.ts` proves it does, on purpose.
- **Why it's a fork:** the install record ("you installed Version 2") and the bytes ("this folder is Version 1") are both true. The spec's own statements point both ways (§3.1 row 1 keys on the byte match; §2 L-DECL, §7.4 and ledger D4 say "ledger first, then byte match"), and the review's two triage agents picked opposite sides, each citing the North Star.
- **Options:**
  - **A — the bytes win.** Card says "Version 1", no Edited chip, the team's score for Version 1 shows (it belongs to these exact bytes). Marketplace follows: "Version 3 · you have Version 1" with Reinstall. *(decides: "Version" always describes what is on disk; a folder holding a published version's bytes is never called edited)*
  - **B — the record wins the number; bytes only fill gaps.** Card says "Edited from Version 2", own runs only. Marketplace says "you have Version 2". *(decides: the line tells you what you installed and that it changed, not what it changed into)*
  - **C — keep what shipped.** "Version 2" plus the Edited chip; fix only the false sentence. *(decides: no code change; the card claims a version the bytes contradict)*
- **Recommendation:** A — the eval overlay (parent D1, D2) is already keyed on bytes, so B would hide a score the team holds for exactly these bytes; D4's "ledger first" was gap-filling for the no-match case, not a licence for the record to overrule the bytes; C is the one outcome the North Star forbids.
- **Zoom-out (does this serve the North Star?):** A is the only option where "Version" means the same thing on every card. Its cost is a code change to the M1 that just merged, on both mirrors, plus a fidelity re-record.
- **The call:** Ryan took A.

### Technical
- **Landed code (main `753efa4`):** `desktop/src/backend/tauri/index.ts` `libraryVersion` returns `placement.version ?? matchedVersion`; `libraryMatch` returns `'identical'` whenever `matchedVersion` is non-null; `presentation.ts` `libraryVersionLabel` prints the ledger number; `SkillCard.tsx` renders the Edited chip from `row.edited`. `inventoryCard` sets `installedVersion = ledgerVersion ?? (single matched version)`.
- **Change (M1.1, see Decision 8):** both derivations prefer `matchedVersion` when non-null and fall back to the ledger; the Edited chip is suppressed when `localMatch === 'identical'`. Spec: §3.1 row 1 gains "(K is the matched version even when the placement records another; the bytes decide)"; lines 128–130 are replaced by the true statement (`edited` measures against the placement's recorded fingerprint, `matchedVersion` against every committed version, so matched-and-edited is reachable and shows the matched version with no chip and no `problems[]` entry); §2 L-DECL (line 89) and §7.4 (line 100) read "from the byte match, else the placement ledger"; §3.2's `installedVersion` paragraph takes the same order; §8 gains the placed-at-v2-bytes-are-v1 row in `skill-card-versions.test.tsx` and the Marketplace twin.
- **Effort / risk / blast radius:** two adapter functions, one label builder, one chip condition, two test tables, one CLI overlay test title; the fidelity boards that draw a matched card re-record. The parent ledger's D4 Technical line ("`installedVersion = placement.version ?? matchedVersion`") is superseded by this row.
- **Grounding findings:** read directly — `tauri/index.ts:157-168`, `presentation.ts:37-56`, `SkillCard.css` version rules, review findings 6 and 10 with their triage.

---

## Decision 2 — Where does the Publish button appear on a Marketplace card?

**Verdict: LOCK — A, only in the "your copy differs" state.**

### Plain English
- **What's at stake:** the spec puts Publish in exactly one place — a folder on disk that Terum never installed and whose bytes match no published version. The merged M1 code shows Publish on every card whose copy differs, so an edited, out-of-date install reads "Version 3 · you have Version 2" with both Reinstall and Publish beside it.
- **Why it's a fork:** Reinstall throws your edits away and Publish pushes them to the team; two opposing write buttons on a glance card is a footgun. But that extra Publish is also the Marketplace's only hint that an installed copy was edited.
- **Options:**
  - **A — Publish only where the spec puts it.** Edited installs show the check, plus Reinstall if behind; edits are published from the Library, where the folder already reads "Edited from Version M". *(decides: one write action per card; the Marketplace is the team's mirror, the Library is where your edits live)*
  - **B — Publish wherever the copy differs, as shipped.** *(decides: the Marketplace surfaces your edits at the cost of two opposing buttons on one row)*
- **Recommendation:** A — parent D5 attached Publish to the unmatched present folder, and parent D3 made publishing a consented per-row act; the consent belongs where you can see what you are publishing.
- **Zoom-out (does this serve the North Star?):** A fits "nothing moves unless you ask" — the ask happens in the Library with the edited folder in view. The "edited" hint is a label question, walked as Decision 2b.
- **The call:** Ryan took A.

### Technical
- **Landed code:** `SkillCard.tsx` renders Publish when `skill.teamed && skill.localMatch === 'differs' && skill.path`; Marketplace `localMatch` is `'differs'` for any present, scanned row with no byte match, ledger entry or not.
- **Change (M1.1):** add `skill.installedVersion === null` to the condition. Spec: §3.2 heading gains "a row's right side renders only in that row's state"; the paragraph under the table states the Publish predicate once (present on disk, `installedVersion === null`, `localMatch === 'differs'`, `path !== null`); §5 M1.5 points at it; §8 `skill-card-actions.test.ts` gains "an edited install offers no Publish".
- **Effort / risk / blast radius:** one condition, one sentence, one test. Fidelity boards drawing an edited install re-record.
- **Grounding findings:** read directly — `SkillCard.tsx` Publish branch, `tauri/index.ts:250-253`; review findings 13 and 15 with their triage.

---

## Decision 2b — What does the label say when an installed copy has been edited?

**Verdict: LOCK — Marketplace "Version N · you have Version M (edited)"; Library "Version M (edited)".**

### Plain English
- **What's at stake:** you installed Version 2 and changed the files. The Library said "Edited from Version 2"; the Marketplace said "Version 3 · you have Version 2" (or "Version 3 · installed" when on the latest) with no sign of the edit — and after Decision 2 removed the stray Publish button, nothing on the Marketplace hinted at it.
- **Why it's a fork:** how to say it, under the twice-stated constraint that the version line wraps as one clean unit. Ryan asked what "Version 3 · edited from Version 2" would even mean: on the Marketplace, right after the team's "Version 3", those words read as the team's history ("3 was made by editing 2") — a plausible misreading of a line whose job is to prevent misreadings. The second clause must keep the "you have" frame so it is unmistakably about your copy.
- **Options (Marketplace):**
  - **A — "Version N · you have Version M (edited)"**, and "Version N · you have Version N (edited)" when on the latest. *(decides: the qualifier binds to "Version M"; one template for both cases; "installed" stays reserved for exact bytes)*
  - **B — "… you have Version M, edited".** *(decides: softer binding, reads as a list)*
  - **C — "… you have an edited Version M".** *(decides: prose, longest string)*
  - **Rejected — "Version N · edited from Version M".** *(the team-history misreading)*
- **Options (Library):**
  - **A — "Version M (edited)"**, replacing "Edited from Version M". *(decides: same qualifier as the Marketplace; after Decision 1 a bare "Version M" means exact bytes, and the bracket marks the deviation)*
  - **B — keep "Edited from Version M".** *(decides: two vocabularies for one fact)*
  - **C — "Version N · you have Version M (edited)" in the Library too.** *(decides: identical to the Marketplace, but the Library row does not carry the team's latest version — a new CLI row key, not copy)*
- **Recommendation:** A and A — Ryan's phrasing as the one template; the same word in the same brackets on both screens.
- **Zoom-out (does this serve the North Star?):** directly the truth clause — the card stops saying "installed" about bytes that are no longer the installed version. Longest string becomes "Version 10 · you have Version 2 (edited)", still one wrap unit.
- **The call:** Ryan took A for both.

### Technical
- **Landed code:** `presentation.ts` `marketplaceVersionLabel` never consults `localMatch` once a ledger version exists; `libraryVersionLabel` returns `Edited from ${versionLabel(version)}` for `localMatch === 'differs'` with a placed version.
- **Change (M1.1):** Marketplace — one branch before the installed-equals-latest check: `installed !== null && card.localMatch === 'differs'` → `${versionLabel(latest)} · you have ${versionLabel(installed)} (edited)`; Reinstall still renders when M < N. Library — the state-2 string becomes `${versionLabel(version)} (edited)`; states 3–5 ("Edited", "Unpublished", empty) unchanged. Spec: §3.1 row 2 slot, a new §3.2 row between states 3 and 4 (present, `installedVersion !== null`, `localMatch === 'differs'` → the new string, right side check + Reinstall when behind), §7 rows for both strings, the longest-string sentence in §5 M1.6. Tests: `skill-card-versions.test.tsx` state tables on both sides; `installed-state.test.tsx` if it asserts the old Library words. Docs/README lines quoting "Edited from Version" and their `invocation-catalog.ts` patterns.
- **Effort / risk / blast radius:** two label branches, one string rename, two test tables; fidelity boards drawing an edited card re-record.
- **Grounding findings:** none spawned — `presentation.ts:37-56` read directly.

---

## Decision 3 — Who gets named on the eval line when your run and the team's are the same receipt?

**Verdict: LOCK — A, the `mine` flag on both receipts, team receipt wins a tie.**

### Plain English
- **What's at stake:** an eval line may say "run by ajayw36 · Version 2" and must never say "run by you". Installing a skill copies the team's receipt into your own eval store, so the same run exists twice. The merged code breaks the tie toward your copy, which carries no "did I run this" flag, and falls back to a guess — so a version you installed whose committed eval you ran yourself can read "run by <your own handle>".
- **Why it's barely a fork:** every option shows the same thing in the everyday case; they differ in how completely the hole closes.
- **Options:**
  - **A — flag on both receipts, team wins ties.** *(decides: the rule is stated in a fact the CLI knows; the card can never name you for your own run)*
  - **B — tie-break only.** *(decides: no new row key; a seeded receipt you ran whose team you have since left still reads "run by you")*
  - **C — bless what shipped.** *(decides: no code change; forces an amendment to the parent spec's "null means the run was this machine's", which this spec declares unrevised)*
- **Recommendation:** A — the parent spec's sentence is only literally true under A.
- **Zoom-out (does this serve the North Star?):** "how it scored" is part of the truth clause, and who scored it is part of that. One boolean on a row contract that landed today is the cost.
- **The call:** Ryan took A.

### Technical
- **Landed code:** `tauri/index.ts` `libraryEval` picks `team.run_id > own.run_id ? team : own` (equal ids → own), and `own` has no `mine`, so attribution falls back to `pick.version ? runner_handle : null`. `src/commands/ls.ts` computes `mine` for `teamEval` only.
- **Change (M1.1):** CLI stamps `mine` on the own-store receipt too (`localEval.mine` or a `localEvalMine` row key), defined once as "`provenance.runner_handle` equals this machine's handle for the receipt's team; for a local-store receipt, for any configured binding". Desktop: tie goes to the team receipt (`>=`), and `runnerHandle` renders iff `mine === false`. Spec: §4.1 declares the flag on both receipts; §3.3 gets the tie rule and the evaluable predicate; §5 M1.2/M1.3 name the stamping and the reading; §8 gains a seeded-twin case and a you-ran-it case. `docs/frame-protocol.md` documents the key.
- **Effort / risk / blast radius:** one CLI field, one comparison, one predicate; the frame-protocol doc and its tripwire catalogue.
- **Grounding findings:** none spawned — `tauri/index.ts:150-156` read directly; review finding 11 with its triage.

---

## Decision 4 — Do the version words and the green check move as one unit?

**Verdict: LOCK — A, the check moves in with the words.**

### Plain English
- **What's at stake:** a Marketplace card's bottom row has the version words on the left and the actions plus the green "you have this" check on the right. At normal width they share a line; when the card narrows (the grids are `repeat(3–5, minmax(0,1fr))`, so there is no floor), the shipped M1 moves the whole right-hand group to a second row, leaving the check on a different row from the words it belongs to. Ryan's parent-D5 build constraint said the words and the check "wrap as a whole unit, never the check orphaned".
- **Why it's a fork:** the check does two jobs — the installed mark that belongs with the version words, and the element that swaps places with the enable switch, which belongs with the actions. Whichever side it lives on, one reading loses.
- **Options:**
  - **A — check moves in with the words, as the spec says.** "Version 3 · installed ✓" is one unbreakable piece on the left; the right side keeps actions and the switch. *(decides: the constraint honoured literally; the installed mark sits left as a check and right as a switch)*
  - **Gate on the narrow-card fidelity board** before choosing. *(decides: no guess, one more human step)*
  - **B — check stays with the actions; spec rewritten to match.** *(decides: the installed slot is always on the right; words and check may land on different rows)*
- **Recommendation:** A, with the caveat that it is a visual call the session could not render (the fidelity oracle runs only on Ryan's Mac).
- **Zoom-out (does this serve the North Star?):** "installed ✓" beside the version words is the truth statement read as one glance; a check on another row is a weaker claim.
- **The call:** Ryan took A.

### Technical
- **Landed code:** `SkillCard.tsx` renders `.card-installed` in the second bottom-row group, in the `else` branch of the enable switch; `.card-version-label` is `white-space:nowrap; flex-shrink:0`; `.skill-card-bottom` is `flex-wrap:wrap` with two child groups.
- **Change (M1.1):** a `.card-version` wrapper element in the first group holding the label span and the check (`display:inline-flex; white-space:nowrap; flex-shrink:0`); the check leaves the switch branch (the switch stays right when `disablePerMachine`). Spec §5 M1.6 names the wrapper element and its DOM position, and §3.2's "Right side" column moves the check into the version slot for states 2–5. Tests: `skill-card-versions.test.tsx` chip/check assertions; fidelity boards showing an installed card re-record.
- **Effort / risk / blast radius:** one markup move, one CSS rule, one test table; every card component shares the slot so it is one place.
- **Grounding findings:** none spawned — `SkillCard.tsx`, `SkillCard.css`, `library.css`, `marketplace.css` read directly; review findings 14 and 16.

---

## Decision 4b — May a card grow taller, and how long are the version words? (§11 gate 3)

**Verdict: LOCK — variable height, and "v" on cards.**

### Plain English
- **What's at stake:** cards were a fixed 148px tall; M1 made that a minimum, so a card and its grid row grow when the version words wrap. The alternative, a fixed height with the words cut off, is what the parent ledger forbids. Decision 2b made the longest string longer still ("Version 10 · you have Version 2 (edited)").
- **Why it's a fork:** a uniform grid versus never clipping, with string length as the lever between them.
- **Options:**
  - **A — variable height, as shipped.** *(decides: nothing ever clips; a row grows when one label wraps)*
  - **B — fixed height, abbreviate the words** so they always fit. *(decides: uniform grid; every card pays in shorter words)*
  - **Ryan's hybrid — variable height AND abbreviated words.** Growth stays as the safety net, and shorter words make it rare. Form: "v" everywhere on cards — `v10 · you have v2 (edited)`, `v2`, `v2 (edited)`, `run by ajayw36 · v2` — rather than mixing "Version 10 · you have v2" on one line. Scope: card version slots and card eval lines only; terminal questions ("Record decision-walk as installed (Version 4)?"), desktop dialogs, README and the frame-protocol doc keep the full word, because they have room and prose reads better.
- **Recommendation:** the hybrid as Ryan framed it, with "v" on every card string and full "Version" in prose.
- **Zoom-out (does this serve the North Star?):** the truth is stated in fewer characters and still never clipped. This amends parent D4's copy ("Version N") for card surfaces only.
- **The call:** Ryan took the hybrid — variable height, "v" everywhere on cards, cards only.

### Technical
- **Landed code:** `.skill-card{min-height:148px}`; `presentation.ts` `versionLabel` / `recordedVersionLabel` produce "Version N"; the eval line composes `run by {handle} · {recordedVersionLabel}`.
- **Change (M1.1):** a card-scoped formatter `vN` used by `marketplaceVersionLabel`, `libraryVersionLabel`, `evalVersionLabel`, `profileVersionLabel` and the eval line; the dialogs' and terminal copy keep `versionLabel`. Spec: §7 card rows switch to the "v" form and a sentence states the card/prose split; §5 M1.6's longest-string check becomes `v10 · you have v2 (edited)` + Reinstall; parent D4 copy amended in §2. Tests: both `skill-card-versions` tables, `installed-state`, any README line quoting card copy plus its `invocation-catalog.ts` pattern. Fidelity boards drawing a version line re-record.
- **Effort / risk / blast radius:** one formatter, five call sites, string-table tests, boards.
- **Grounding findings:** none spawned — grids read as `repeat(3–5, minmax(0,1fr))` (`library.css`, `marketplace.css`), so a card has no width floor.

---

## Decision 5 — What happens when `install --adopt` crashes halfway?

**Verdict: LOCK — B, write the machine's record last.**

### Plain English
- **What's at stake:** adopt records a folder you already have as installed, copying nothing. The spec ordered its writes as: work-in-progress note, your machine's install record, the team's record of who has the skill, clear the note — and refused any path already in the machine's record. Die between the second and third write and your machine says installed, the team knows nothing, adopt refuses to run again ("already recorded as installed"), and the reconcile scan hides the folder because it is "already in the ledger". Nothing can finish the job.
- **Why it's a fork:** make the half-done state resumable, or reorder the writes so the half-done state is benign.
- **Options:**
  - **A — resumable adopt.** Refuse only a finished record; a record with a leftover note is resumed, and the scan lists it. *(decides: keeps `install`'s write order; adds a three-case precondition, an exception to the "never listed" rule in four places, a resume string and a new error line)*
  - **B — write the machine's record last.** Order: note, team record, machine record, clear note. *(decides: a crash leaves the folder visible to the scan; the cards still read true because Decision 1 makes them read the bytes first; re-running adopt drains the note by the existing rule, the team write being idempotent; "team says yes, machine says no" is a state the app already handles)*
- **Recommendation:** first A, on the triage's fit score, which rested on a parent-ledger *technical* line saying adopt should reuse `installOne`'s tail in its existing order. Ryan asked why B was not recommended; on inspection that line is an implementation detail, not a decision, and the reason `install` writes the ledger first (a copied folder must be tracked before anything else can fail) does not apply to adopt, which copies nothing. Corrected recommendation: B — it gives the implementer less to invent and makes the failure benign instead of recoverable.
- **Zoom-out (does this serve the North Star?):** both beat the spec as written on the truth clause; B wins the second clause outright. Its one cost is a deliberate difference from `install`'s order that the spec must state and justify in a sentence, or a future reader will "fix" it back.
- **The call:** Ryan took B.

### Technical
- **Spec change:** §4.5 lines 240–244 reorder the effects — `ensureConsent`; `pending` entry `{ op:'install', destination, version:'v<K>' }`; `safeWrite` of `people/<handle>.json` `installed[]` (filter-then-push, as `install.ts:174-183`); ledger `placements[path] = { id, team, version, scope, placed_at, fingerprint }`; pending cleared — plus one sentence: adopt departs from `installOne`'s order on purpose because it has no `place()` step whose copied directory the ledger row must cover, so an interrupted adopt leaves at most a pending row and a people-file entry, never an untracked placement. Line 238's precondition ("not already in `config.placements`") and the four "ledgered folders are never listed" statements (§3.4, §5 M2.1, §7 refusal, §8) stay as written. §8 `install-adopt.test.ts` gains four interruption tests (kill after the pending write, after the people-file write, after the ledger write, after pending clear; each re-run ends with exactly one placement, exactly one `installed[]` row, zero pending rows) and one asserting the people file never gains a second row on replay.
- **Landed code touched by M2:** none yet; `install.ts:121` (pending self-drain) and `:174-185` (people-file write, pending clear) are the reused pieces.
- **Effort / risk / blast radius:** one paragraph reordered, one sentence, five test bullets; no sibling spec reads adopt's write order.
- **Grounding findings:** review finding 22 with both triage options; `install.ts` order read via the triage's citations (`:121`, `:150-185`).

---

## Decision 6 — How does `project add` scope its reconcile scan to the new project?

**Verdict: GATE — A, an internal root argument now; a terminal flag waits behind a request.**

### Plain English
- **What's at stake:** adding a project should check that folder's skills against the team, not re-offer every skill on the machine. The spec said "scoped to that root" (`--root <path>`) but never defined how the root is passed, what makes it valid, or which part of the app opens the dialog; its one test would pass even if global skills leaked in.
- **Why it's a fork:** an internal argument only `project add` uses, or a real flag anyone can type.
- **Options:**
  - **A — internal argument.** `project add` passes the root it just registered; no terminal flag; the root must equal a registered project root after path canonicalisation, else a plain refusal; one named desktop handler opens the dialog. *(decides: the smallest surface for the only caller)*
  - **B — a real `--root <path>` flag.** Same rules plus README, frame-protocol and CLI surface. *(decides: a feature nobody has asked for, three more surfaces to keep in step)*
- **Recommendation:** A with a tripwire.
- **Zoom-out (does this serve the North Star?):** the second clause — the contract is written once where its one caller lives.
- **The call:** Ryan took A.
- **Tripwire:** the first request to reconcile a single project from the terminal promotes `root` to a documented flag.

### Technical
- **Spec change:** §4.4 gains a `ReconcileArgs` block — `{ list?: boolean; team?: string; root?: string }` — with three rules: `root` is in-process only (not registered in `src/cli.ts`, not in `FRAME_VERBS` args); it is canonicalised with the same rule the Library roots use and refused unless it equals a configured project root; a scan with `root` set returns rows under that root only. §5 M2.4 names the desktop coordinator: the add-project handler that already receives `cliProjectAdded` opens `ReconcileDialog` when `reconcile` is non-empty. §8 `reconcile.test.ts` adds "global and other-project rows are excluded under `root`" and "`added:false` runs no scan"; `project.test.ts` asserts the result key.
- **Effort / risk / blast radius:** one interface, three sentences, three test bullets.
- **Grounding findings:** review finding 25 with its triage.

---

## Decision 7 — The `install --adopt` argument shape

**Verdict: LOCK — exactly one of a skill reference or an adopt path.**

### Plain English
- **What's at stake:** the desktop's install type requires a skill reference, so `install({ adopt: path })` as the spec writes it does not typecheck, and the terminal grammar `install <ref>` leaves no room for an adopt path. Half the review panel confirmed this; the other half called the rest of the finding a misread.
- **Why it's not a fork:** parent D3 locked adopt as an `install` mode, so only the grammar is open, and one shape is sensible.
- **The shape:** terminal `install [ref] [value] --adopt <path>`, refusing both-given and neither-given; adopt refuses `--into` and any destination flag because it copies nothing; team from `--team` or the single configured team as today; scope derived from the folder — global under the global Library, that project under a registered project root. Desktop `InstallArgs.ref` becomes optional with `adopt?: string` as a sibling and the "exactly one" rule stated once.
- **The call:** Ryan locked the shape.

### Technical
- **Spec change:** §4.5 gains the grammar and four refusal lines (both, neither, `--into` with adopt, path outside any Library root — the last already exists as "`{path} is not a folder in your Library.`"); §4.3/§6 note `InstallArgs.ref?: string; adopt?: string`; `src/cli.ts` install command grammar in §5 M2.2; §8 `install-adopt.test.ts` covers each refusal and the scope derivation for both root kinds.
- **Effort / risk / blast radius:** one type widening (every existing caller passes `ref`, so no churn), one Commander signature, four strings.
- **Grounding findings:** review finding 24 (contested 1-1) and the confirming verifier's citations `desktop/src/backend/types.ts:116`, `src/cli.ts:180`.

---

## Decision 8 — Do the code-side fixes ship as their own PR before M2, or fold into M2?

**Verdict: LOCK — A, a small M1.1 PR first.**

### Plain English
- **What's at stake:** Decisions 1, 2, 2b, 3, 4 and 4b each change the M1 code that merged today (which version wins, where Publish shows, the "(edited)" and "vN" wording, the eval-line tie, the check joining the words, the card formatter). None is M2 work.
- **Why it's a fork:** separate means two reviews and two fidelity re-records with each diff about one thing; folded means one bigger review where card wording and a new verb share a diff, and M2's outside implementer inherits fixes to code it did not write.
- **Options:**
  - **A — M1.1 first.** Spec revised once after this walk (M1 sections to the new rulings, M2 sections to Decisions 5–7), M1.1 built inline as M1 was, reviewed, merged; M2 starts from a spec whose M1 half matches the code exactly. *(decides: M2's diff is only M2)*
  - **B — fold into M2.** *(decides: fewer rounds, a mixed diff)*
- **Recommendation:** A — the reason M2 gets an outside reader is the identity rule; label fixes do not belong in that diff.
- **Zoom-out (does this serve the North Star?):** the second clause — the M2 spec the implementer reads describes code that exists as written.
- **The call:** Ryan took A.

### Technical
- **M1.1 scope:** `desktop/src/backend/tauri/index.ts` (`libraryVersion`, `libraryMatch`, `libraryEval` tie, `inventoryCard` version order), `presentation.ts` (both label builders, card `vN` formatter), `SkillCard.tsx` (Publish condition, `.card-version` wrapper with the check), `SkillCard.css`, `src/commands/ls.ts` (`mine` on the own receipt), tests `skill-card-versions.test.tsx`, `installed-state.test.tsx`, `skill-card-actions.test.ts`, `tauri/__tests__/index.test.ts`, `ls-local-overlay.test.ts`, docs `frame-protocol.md` + `invocation-catalog.ts` patterns, fidelity boards re-recorded on Ryan's Mac.
- **Spec sections revised for M1.1:** §2, §3.1, §3.2, §3.3, §4.1, §4.3, §5 M1.2–M1.7, §7, §8. For M2 (Decisions 5–7): §4.4, §4.5, §5 M2.2, M2.4, §8.
- **Order:** spec revision → M1.1 inline build → `/ultrareview` or `/hybrid-review` → merge → `/codex-spec` re-run on M2 → §11 gates 1 and 2 → M2 lock.
- **Grounding findings:** none — sequencing.

---

## Decision 9 — The §7 copy as revised (spec §11 gate 1)

**Verdict: LOCK — approved as written (Ryan, 2026-09-14, after M1.1 merged as `210c27e`).**

### Plain English
- **What's at stake:** the exact words on cards, in the terminal and in error lines. Cards say `v3`; every surface with room says `Version 3`. New in rev 2: `v10 · you have v2 (edited)` (also when on the latest), `v2 (edited)`, `run by ajayw36 · v3`, `from v3 · latest v10`, the three D7 grammar refusals, the D6 root refusal.
- **Strongest reason to push back:** `(edited)` after `you have v10` could be read as v10 itself being edited. The card form is already live on `main`, so a rewording is a one-line follow-up.
- **The call:** Ryan approved every §7 string as written.

### Technical
- Spec §11 gate 1 closed; no text changes. Tripwire: a reworded card string goes through `presentation.ts` and the `skill-card-versions` table, never through a spec revision.

---

## Decision 10 — Does `install --adopt` ask the `allowed-tools` consent question? (spec §11 gate 2)

**Verdict: LOCK — A, keep the question.**

### Plain English
- **What's at stake:** adopt records a folder you already have as installed, copying nothing. Install asks you to approve a skill's `allowed-tools` grants before placing it; adopt runs the same question per folder, so joining a team with eight matching skills that carry grants means eight extra yes/no prompts beside the eight "record as installed" ones.
- **Options:**
  - **A — keep the question** (spec as written). *(decides: the team record says you approved the grants because you were asked)*
  - **B — record approval silently**, because the folder is already on disk and active. *(decides: one question per folder on join; the consent row is written without a prompt)*
- **Recommendation:** A — `ensureConsent` is the only place a grant hash enters the people file, and adopt is the first path that writes an install record for bytes Terum never placed; a silent write makes the consent record claim something nobody did. The cost is bounded to the join.
- **The call:** Ryan took A.

### Technical
- Spec §4.5 effects order unchanged (`ensureConsent` first); §11 gate 2 closed. `install-adopt.test.ts` keeps its consent-refusal case.

---

## Decision 11 — How M2 is built

**Verdict: LOCK — `/codex-implement`.**

### Plain English
- **What's at stake:** M2 (the `reconcile` verb, `install --adopt`, the `existing` setup step, the `project add` hook, `ReconcileDialog`) is the half of the spec written for an outside implementer. Building it inline would never test that claim; handing it to Codex does, and the orchestrator re-runs every gate regardless.
- **The call:** Ryan chose `/codex-implement`, 2026-09-14.

### Technical
- Spec status set to locked for `/codex-implement`; worktree off `origin/main` (M1.1 = `210c27e`); the spec file lives on `feat/frame-mode`, so it is passed by its primary-checkout path. Codex's self-reported gates are hypotheses; the orchestrator runs lint/typecheck/test on both trees, reviews the diff, opens the PR.

---

## Non-fork spec corrections carried by this walk

Findings the review proved as plain wording errors, with no product decision inside them. Not ledger rows; listed so the spec revision (Decision 8, step 1) has one worklist. Ryan nodded these through as a batch on 2026-09-13.

1. **Parent revision pin** — §0/§2 cite the refactor spec at rev 3; it is at rev 10. Repin and re-check §2's amendment targets (D1, D4, L-DECL, §7.3, §8.3, §9 unchanged; rev 10's D2/D9 eval-asset override noted). *(review finding 0)*
2. **`localMatch` has four states** — §4.3 union becomes `'identical' | 'differs' | 'none' | null` with a per-mirror gloss; §3.1 gains the derivation sentence mapping table rows to the field. *(5, 9, 18)*
3. **Marketplace `installedVersion` multiplicity** — §3.2: the ledger version when every ledger entry for this uuid+team records the same version (not "exactly one entry"); fallback the one matched version shared by all on-disk rows. Order now byte match first per Decision 1. *(7, 12)*
4. **Mock coverage** — §5 M1.7 becomes a table mapping each §3.1 and §3.2 state to the mock row and `?__mock=` scenario that produces it. *(17)*
5. **`versionDigests` location** — §4.2 names `src/lib/version-digests.ts` (a `teamRepo.ts` placement closed an import cycle with `skills.ts`). *(2, 4)*
6. **`mine` on the row** — §4.1 declares it; superseded in scope by Decision 3 (both receipts). *(3, 8)*
7. **Ambiguity reason string** — §4.1: `identical bytes exist in more than one team; no version is shown`. *(1, contested cosmetic)*
8. **Invocation catalogue path** — §5 M1.8: `src/lib/__tests__/invocation-catalog.ts`. *(19)*
9. **Overlay-evaluated test location** — §8 cites `desktop/src/backend/tauri/__tests__/index.test.ts`. *(21)*
10. **`teamAuthor` source** — §4.4 names the byline lookup that already exists in `src/commands/ls.ts` (people `display_name <email>` → handle), falling back to `metadata.author` verbatim when no person matches. *(27, dropped as a gap but the citation belongs in the spec)*
11. **Digest wording predating PR #197** — §3.3/§4.2 still describe the digest before eval assets were excluded; parity holds and is tested, reword. *(handoff note)*

---

## Close

- **LOCKED, ready for the spec revision and the M1.1 build (D8):** D1 bytes win for the version number on both mirrors and a byte-matched folder is never "edited"; D2 Publish only on "your copy differs"; D2b "Version N · you have Version M (edited)" on the Marketplace and "Version M (edited)" in the Library; D3 `mine` on both receipts, team wins a tie; D4 the check joins the version words as one wrap unit; D4b cards keep a 148px minimum and grow, and card strings say "vN" while prose keeps "Version N"; D7 exactly one of a skill reference or an adopt path; D8 M1.1 ships first, inline, then M2.
- **LOCKED for the M2 half of the spec:** D5 adopt writes the machine's record last, with one sentence explaining the deliberate difference from `install` and five interruption tests; D7 as above.
- **GATED:** D6 the reconcile root is an in-process argument; a terminal flag waits for the first person who asks for it.
- **LOCKED 2026-09-14, after M1.1 (`210c27e`):** D9 the §7 copy as revised, approved as written; D10 adopt keeps the `allowed-tools` consent question; D11 M2 is built with `/codex-implement`.
- **DEFERRED:** the team-record check (MCP 401, third walk running).
- **Corrections carried:** the eleven wording items above, nodded through as a batch.
- **Amendments to the parent ledger (2026-09-13 cross-mirror overlays walk):** D4's "ledger first then byte match" Technical line and "Version N" card copy are superseded by D1 and D4b here; D5's "check stays" is honoured with the check inside the version unit (D4).
- **Done since:** spec rev 2 (`f72ebcb`, `c875cd2`, `58c6cb2`); M1.1 merged (PR #208 → `210c27e`); gates 1–2 walked (D9, D10). Ryan waived the second `/codex-spec` run on M2 (2026-09-13). **Next:** M2 via `/codex-implement` (D11).
