---
title: cross-mirror overlays decision walk
date: 2026-09-13
north_star: Each screen tells you the truth about your copy versus the team's (installed, which version, how it scored), proven by identical bytes, never a name. Nothing moves between the two unless you ask, except eval results, which reach the Library automatically through the background sync.
status: complete
deferred:
  - what: Nothing in this walk was checked against the team's shared record; the terum MCP refused auth all session (HTTP 401, "No authorization provided"), so check_decision never ran over these five LOCKs
    gate: the MCP endpoint accepts the configured Authorization header again — re-run check_decision over every LOCK in this ledger before the build spec is written
  - what: A folder renamed locally after install still carries the team's uuid under a different name; publish mints it as a new skill at v1, and the reconcile scan could report "renamed from <team name>" but the right offer was not decided (D3)
    gate: the first time the reconcile scan meets a folder whose uuid belongs to a team skill of a different name, or the first bug report of a renamed install becoming a duplicate skill
  - what: How the reconcile picker asks a multi-row question over frames — a confirm-per-row loop or a new `multiselect` ask kind — was raised and not decided (D3)
    gate: when the reconcile verb's picker is built; choose before the desktop dialog is drawn
---

# Cross-Mirror Overlays — Decision Walk

**North Star:** Each screen tells you the truth about your copy versus the team's (installed, which version, how it scored), proven by identical bytes, never a name. Nothing moves between the two unless you ask, except eval results, which reach the Library automatically through the background sync.

Ratified by Ryan 2026-09-13, as "truth from the bytes" plus one amendment: eval results are exempt from the consent rule and flow team → Library automatically via the sync that already runs on launch and window focus. Two alternatives were offered and not taken: reusing the 2026-09-11 North Star verbatim, and the narrower "never a false negative". Wording note: since the refactor, evals reach the team repo as direct commits on `main`, not pull requests, so "PR opened and merged" reads as "committed and fetched".

**Why this batch exists.** The 2026-09-11 refactor made the Library a mirror of disk and the Marketplace a mirror of the team clone, joined only by the path-keyed placements ledger and the skill uuid. Two pure mirrors can both be wrong about the same folder: a skill copied by hand, or pulled in with a project repo, shows "not installed" on the Marketplace and "not evaluated" in the Library even when its bytes are identical to a published version the team has already scored. L-DECL (§3.6) permits exactly one cross-mirror overlay today, the Marketplace's `installedVersion`. This walk decides whether and how that principle extends.

**Batch source:** this session's design discussion (2026-09-13), following the handoff at `.claude/handoff-library-marketplace.md`. Governing spec: `.planning/specs/2026-09-11-library-marketplace-refactor.md` (D4, D11, L-DECL §3.6, §7.3, §7.4, §8.3) and `.planning/decisions/2026-09-11-library-marketplace-refactor-decision-walk.md`.

**Team-record check:** the `terum` MCP server refused auth this session (HTTP 401, "No authorization provided"). Nothing here was checked against standing team decisions. Same condition as the 2026-09-10 and 2026-09-11 walks.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | How team evals reach the Library | LOCK | Match at draw time by content digest — the Library reads the clone's receipts the way the Marketplace reads the placements ledger; nothing is copied | — |
| 2 | Do overlay evals feed the Library's "evaluated" count | LOCK | Yes — the number means "folders with a score for their exact bytes", which is what D11 already made it; the card names the runner | — |
| 3 | First-run reconciliation of pre-existing local skills | LOCK + DEFER | One pop-up after the projects step: adopt identical folders without copying, publish differing ones per row with name-only matches defaulting off; a verb run by setup, project add and the Library. Renamed-folder case deferred | renamed-uuid case: first sighting in the wild |
| 4 | A version line on every card | LOCK | Every card fills the slot: "Version N" (also when not installed), "Version M" from ledger or byte match, "Edited from Version M", "Edited", "Unpublished"; must wrap cleanly on the desktop | — |
| 5 | Replacing the "Installed · on this machine" chip | LOCK | The version line supplies the words, the green check stays as the glanceable "you have this"; an unmatched present folder reads "your copy differs from Version N" with a Publish action; no strange wrapping | — |

---

## Decision 1 — How team evals reach the Library

**Verdict: LOCK — A, match when the screen is drawn.**

### Plain English
- **What's at stake:** a Library folder whose bytes equal a published version should show the team's score for those bytes, labelled with who ran it, without the user doing anything. Today it does only if `install` seeded the receipt before the run happened (D11).
- **Why it's a fork:** the Library was locked as "reads disk and nothing else" (§7, L-DECL). A team score has to cross that line at draw time, at sync time, inside the desktop, or not at all, and each place changes the meaning of an existing store.
- **Options:**
  - **A — match when drawn.** `ls --local` fingerprints each folder (it already does, for local runs) and also looks up the clone's receipts by that fingerprint. Nothing copied. *(decides: every store keeps one meaning; the join exists only on screen)*
  - **B — copy at sync time.** `sync` copies new receipts into the local eval store by fingerprint. *(decides: the local store stops meaning "runs from this machine"; `localRuns[].committed`, publish's attach step and uninstall's recovery-data rule all need copy-vs-original logic)*
  - **C — join in the desktop.** *(decides: `ls --team` carries one receipt per skill at the latest version, so a folder at an older version never matches; terminal `ls --local` gets nothing)*
  - **D — link only.** *(decides: no eval data crosses; ruled out by the amended North Star)*
- **Recommendation:** A — the exact mirror of the Marketplace's existing `installedVersion` overlay: one annotation, sourced from a fact that cannot be wrong, added after the catalogue is built, never a filter or sort input.
- **Zoom-out:** A and B both satisfy "evals reach the Library automatically through the background sync"; A by reading what sync fetched, B by making sync write more. A adds no new rules to existing stores.
- **The call:** Ryan took A.

### Technical
- **Files / code paths:** `src/commands/ls.ts` `showLocal` — one pass over `<clone>/evals/<uuid>/v<N>/*.json` per configured team, indexed by `content_digest`, attached as `teamEval` on the row. `desktop/src/backend/tauri/index.ts` `cliLocalRow` gains the field; `localCard` renders it through the existing `localEval` shape (`runnerHandle`, `version` already present). `SkillCard` unchanged.
- **Prerequisite proof — settled 2026-09-13 while writing the build spec:** at cc3a691 `canonicalDigest(root)` reads the folder and delegates to `skillContentDigest(files)` (`src/lib/skills.ts:134-162`), one implementation. The build spec keeps a parity assertion in `ls-local-overlay.test.ts` as a regression guard, not as an open question.
- **Spec impact:** D4, L-DECL §3.6, §7.3 — L-DECL becomes symmetric: each mirror's catalogue from its own source only; each may carry one overlay sourced by a provable identity (uuid for install state, content digest for evals), named as an overlay on the type, set after the catalogue is built. §7.4's "every team-derived field neutral" gets this one exception.
- **Effort / risk / blast radius:** one readdir tree of `evals/` per team per Library load, behind the read session's TTL. Edited folders still blank (digest differs), which §7.3 already calls correct.
- **Grounding findings:** none spawned; read directly — `install.ts:157-171` (D11 seeding), `ls.ts:261-330`, `receipt.ts:53-113`, `evalReport.ts:90-113`.

---

## Decision 2 — Do overlay evals feed the Library's "evaluated" count

**Verdict: LOCK — A, count them.**

### Plain English
- **What's at stake:** whether the Library overview's "evaluated" number includes cards whose score came from a teammate's run on identical bytes.
- **Why it's a fork:** L-DECL's Marketplace overlay is "never consulted by any filter, sort or count". Decision 1 makes L-DECL symmetric, so the Library overlay either inherits that clause or does not. Against inheriting it: D11 already counts a receipt copied at install, so the number has meant "trustworthy score for these bytes" since the refactor shipped.
- **Options:**
  - **A — count them.** Card carries "run by X". *(decides: one meaning for the number, consistent with D11)*
  - **B — only your own runs.** *(decides: overview contradicts its own cards; D11-seeded receipts would have to stop counting, and today they cannot be told apart)*
  - **C — two numbers.** *(decides: most information, one more figure on a quiet screen)*
- **Recommendation:** A.
- **Zoom-out:** "truth from the bytes" is indifferent to who ran the eval. The no-count clause protected the Marketplace catalogue from being reshaped by machine-local facts; a team score entering a count of your own folders flows the other way and reshapes no catalogue. The symmetric L-DECL keeps "never a filter or sort input" for both overlays and drops "count" for the Library's.
- **The call:** Ryan took A.

### Technical
- **Files / code paths:** `desktop/src/backend/tauri/index.ts` `library()` — `overview.evaluated` is `skills.filter(s => s.localEval !== null).length`; with `teamEval` folded into the `localEval` shape (runnerHandle set), the count follows Decision 1 with no further code.
- **Spec impact:** L-DECL symmetric text; §7.4 overview copy.
- **Effort / risk / blast radius:** none beyond Decision 1.
- **Grounding findings:** none — conceptual.

---

## Decision 3 — First-run reconciliation of pre-existing local skills

**Verdict: LOCK — R2 on top of R1. DEFER the renamed-folder sub-case.**

### Plain English
- **What's at stake:** joining a team, or adding a project later, when folders with the team's skill names are already on disk. Today the Marketplace says "not installed", the team never learns you have them, and a better local version stays private.
- **Why it's a fork:** Decisions 1 and 2 already make the screens honest with no writes. Making the *team's* records honest (install counts, profile, uninstall, a differing version) means writing to the team repo during onboarding, which the North Star says needs consent.
- **Options:**
  - **R1 — display only.** Overlays only; differing same-name folders get a "your copy differs from Version N" line and a Publish action on the card. *(decides: nothing written, team records never reflect pre-existing skills unless acted on card by card)*
  - **R2 — one pop-up, two groups, on top of R1.** After the projects step, scan Global plus added roots against the team. Identical bytes → adopt (record placement and people-file install, copy nothing). Same name, different bytes → publish per row; pre-checked only when the local folder carries the team's uuid for that name; name-only or different-author rows pre-unchecked with a rename hint. Declining falls back to R1. *(decides: team records match reality with one consent moment)*
  - **R3 — auto-publish.** *(decides: the deleted auto-share pass; ruled out)*
- **Recommendation:** R2 on R1, with three placement rules: after the projects step (unregistered roots are invisible to the scan); a verb, so `project add` and the Library run it too; adopt is a mode of `install` so there is one writer.
- **Zoom-out:** the pop-up is the ask; "proven by bytes, never a name" is why name-only matches default off.
- **The call:** Ryan took R2 on R1, all three placement rules included. "R2 setup-only" and "R1 only" were offered and not taken.
- **Deferred sub-fork:** a folder renamed locally after install still carries the team's uuid under a different name; `publish` treats it as a copied folder and mints a new skill at v1. The scan could report "renamed from `<team name>`" but the right offer is not obvious. Revisit on first sighting.

### Technical
- **Identity:** `publish.ts:128-140` — team skill found by folder name; the repository's uuid for that name wins; byte-identical → `identicalTo`, else `v<N+1>`; a declared uuid belonging to a different name → `randomUUID()`.
- **Adopt:** `install --adopt <path>` (name open) — digest the folder, require equality with some `v<K>` of the same-named team skill, then reuse `installOne`'s tail (`install.ts:150-185`: ledger write, `people/<handle>.json installed[]` via `safeWrite`), skipping `place()` and the old-skills move. D11 seeding is moot (bytes already match; Decision 1 shows the score).
- **Verb and call sites:** one write verb (working name `library reconcile`, never in `SERVE_READ_VERBS`) returning `{ identical, differing }` for the picker, then driving `install --adopt` and `publish` per accepted row. Called from `setup.ts` as a new step between `projects` and `evals` (`SETUP_STEP_KEYS` gains a key; desktop `Onboarding` steps follow), from `project add` in `src/commands/project.ts`, and on the seam for a Library action.
- **Ask frame:** `select` is single-choice; the picker needs either a confirm-per-row loop or a new `multiselect` ask kind (additive, no protocol bump per `docs/frame-protocol.md`).
- **Ordering:** publishing during onboarding precedes the evals step; those receipts stay local until the next identical publish attaches them (existing rule).
- **Spec impact:** §7.1/§7.2 verb list and `project add` hook; §9 setup steps; D13 unchanged (this step follows the single folder picker).
- **Effort / risk / blast radius:** scan reuses `showLocal` digests; new install mode; new setup step; picker frame. Risk is in the default-on rule — it must key on the team's uuid for that name, never the name alone.
- **Grounding findings:** none spawned; `setup.ts` step keys (`welcome, role, github, team, app, invite, projects, evals`) and `publish.ts` identity block read directly.

---

## Decision 4 — A version line on every card

**Verdict: LOCK — A, every card, with "Edited" alone for the no-number edge.**

### Plain English
- **What's at stake:** whether every card in both screens says which version it is. Today the Marketplace says nothing for an uninstalled skill and the Library never says a version outside an eval line.
- **Why it's a fork:** D1 allows only "Version N", and four states have no number: Marketplace not installed (§8.3 named two states), Library edited, Library never published, hand-copied folder matching no version.
- **Options:**
  - **A — one version line everywhere, five states.** Marketplace not installed → "Version N". Marketplace installed → unchanged. Library matching a version → "Version M", ledger first then byte match. Library edited → "Edited from Version M". Library never published → "Unpublished". *(decides: the slot is always filled, a blank never reads as missing data)*
  - **B — numbers only.** Slot empty where no number exists. *(decides: strict D1; empty beside filled reads as missing data)*
  - **C — Marketplace only.** *(decides: cheapest; leaves the hand-copied confusion in the Library)*
- **Recommendation:** A, with a one-line D1 ruling that the slot may carry the state words "Unpublished", "Edited from Version M" and "Edited".
- **Zoom-out:** "truth from the bytes" requires the Library version to come from the byte match as well as the ledger, or a hand-copied identical folder still shows no version.
- **The call:** Ryan took A, and for the hand-copied-then-edited edge (team uuid present, no ledger version, no byte match) chose **"Edited" alone** over a guessed "Edited from Version <latest>" and over "Unpublished".
- **Build constraint (Ryan):** the label must wrap and look right in the desktop app — no clipping, no overflow at the narrowest card width, in both themes.

### Technical
- **Files / code paths:** `desktop/src/components/domain/presentation.ts` `marketplaceVersionLabel` — add the branch `latest !== null && installed === null → versionLabel(latest)`; `SkillCard.tsx` already renders a non-null label. New `libraryVersionLabel(card)` → "Version M" | "Edited from Version M" | "Edited" | "Unpublished". `ls --local` rows gain `matchedVersion` from Decision 1's digest index (the `v<K>` whose committed bytes equal the folder); `localCard` sets `installedVersion = placement.version ?? matchedVersion` instead of the fixed null.
- **State table (Library):** ledger version or byte match, not edited → "Version M". ledger version, edited → "Edited from Version M". no ledger version, no match, team uuid in frontmatter → "Edited". no ledger, no match, no team uuid → "Unpublished".
- **Layout:** `.card-version-label` in the card's bottom row must allow wrapping (no `white-space: nowrap`, `min-width: 0` on the flex child); verify against the fidelity boards at the narrowest card width. Longest string is "Version 10 · you have Version 2" plus the Reinstall button.
- **Spec impact:** D1 (state words permitted in the version slot), §7.4 (Library builder no longer fixes `installedVersion`/`latestVersion` to null), §8.3 (third Marketplace state).
- **Effort / risk / blast radius:** two label functions, one row field, one CSS check. Every card component shares the slot, so the wrap fix is one place.
- **Grounding findings:** none spawned; `presentation.ts:20-50` and `SkillCard.tsx` read directly.

---

## Decision 5 — Replacing the "Installed · on this machine" chip

**Verdict: LOCK — A, the version line replaces the words and the check stays.**

### Plain English
- **What's at stake:** the grey chip with the green check on a Marketplace card. It appears only when the skill is on disk but Terum never placed it, so it knows the folder exists and nothing more. After Decisions 1 and 4 that case mostly resolves to a real version, and the chip's words duplicate the version line.
- **Why it's barely a fork:** the check mark is the only signal the chip adds beyond the version line.
- **Options:**
  - **A — version line replaces the words, check stays.** Unmatched present folders read "your copy differs from Version N" with the Publish action from Decision 3. *(decides: one fewer label, no lost signal)*
  - **B — drop the check too.** *(decides: cleaner; installed and uninstalled cards differ by one word at a glance)*
  - **C — keep the chip, add the line.** *(decides: two overlapping labels on a crowded row)*
- **Recommendation:** A.
- **Zoom-out:** "installed" becomes "installed at Version N", the precise truth-from-bytes claim.
- **The call:** Ryan took A.
- **Build constraint (Ryan):** the text must not wrap strangely as the current chip does — the version line and the check must sit on one line at normal card width, and wrap as a whole unit (never mid-label, never the check orphaned) when the card is narrow.

### Technical
- **Files / code paths:** `desktop/src/components/domain/SkillCard.tsx` — the `skill.onDiskOnly` branch drops the `Installed · on this machine` text and renders the check icon beside the Decision 4 version label; the `capabilities.disablePerMachine` switch branch is unchanged. `presentation.ts` `marketplaceVersionLabel` gains `present && installedVersion === null && matchedVersion === null → "your copy differs from Version N"`, which is also where the card's Publish action (Decision 3, R1 half) attaches.
- **Layout:** the label and check share one flex item with `white-space: nowrap` on the label text and `flex-wrap` on the bottom row, so the unit moves to the next row whole instead of breaking inside the words. Verify on the fidelity boards at the narrowest card width, both themes.
- **Fidelity:** boards that draw the chip re-record; any README line quoting the old wording needs its `pattern` updated in `invocation-catalog.ts` (memory: README rows are pinned by the tripwire catalogue).
- **Spec impact:** §8.3 card copy.
- **Effort / risk / blast radius:** one branch in one component, one label branch, one CSS rule; the mock boards are the cost.
- **Grounding findings:** none spawned; `SkillCard.tsx` render branch read directly.

---

## Close

- **LOCKED, ready for a build spec:** D1 (read-time digest overlay in `ls --local`, symmetric L-DECL), D2 (overlay evals count), D3 (reconcile verb: adopt + per-row publish, run from setup after the projects step, from `project add`, and from the Library; adopt as an `install` mode), D4 (version line on every card, five states, "Edited" for the no-number edge, must wrap cleanly), D5 (chip words → version line, check kept, no strange wrapping).
- **DEFERRED:** the renamed-folder case in the reconcile scan; the multi-row ask frame shape; the team-record check for all five.
- **Spec sections to revise:** D1, D4, L-DECL §3.6, §7.3, §7.4, §8.3, plus a new setup step and the reconcile verb in §7.1/§7.2 and §9.
- **Implementation prerequisite carried on D1:** resolved — the two digest entry points are one implementation at cc3a691 (see Decision 1 Technical). Build spec: `.planning/specs/2026-09-13-cross-mirror-overlays.md`.
