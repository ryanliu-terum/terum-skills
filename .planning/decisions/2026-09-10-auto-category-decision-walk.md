---
title: auto-populate category decision walk
date: 2026-09-10
north_star: Browse actually works — someone scanning a teammate's catalogue finds the right skill without reading every description.
status: complete
deferred:
  - what: A re-label verb (`terum-skills categorize`) that recategorises a whole existing catalogue (D1)
    gate: a team turns up with more than ~15 already-connected skills still on `misc`, or a taxonomy change forces a catalogue-wide relabel
  - what: Desktop legibility for hygiene warnings — the Tauri validate schema carries a count, not the text, so HYG7 renders as an uninformative "1 warning" (D3)
    gate: Teddy widens `cliValidate` in desktop/src/backend/tauri/index.ts to carry warning messages
  - what: The desktop mock fixture still shows the design-10 category list against a hypothetical catalogue, while the real backend derives facets from live skills (D3)
    gate: Teddy refreshes design.json CATEGORIES and the MarketplaceCategories board to the shipped 8
---

# Auto-populate Category — Decision Walk

**North Star:** Browse actually works — someone scanning a teammate's catalogue finds the right skill without reading every description.

Ratified by Ryan 2026-09-10, over the narrower alternative ("every newly shared skill gets a real category"). The broader frame is what puts the back-fill of existing skills and the desktop's facet list inside this batch rather than outside it.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Back-fill the five skills already stamped `misc` | GATE | Five skills is smaller than the command that would fix them; run the classifier over them by hand once it exists | build the verb when a team has >~15 stale skills, or a taxonomy change forces a relabel |
| 2 | Does the confirmation line say the model was consulted? | LOCK | A silent fallback is how the catalogue drifts back to all-`misc` without anyone noticing | — |
| 3 | Is `team.json.categories` the authority for a hand-written category? | LOCK + DEFER | Warn, don't refuse — browse stops fragmenting without blocking a good reason; the desktop half waits on Teddy | desktop: widen the validate schema to carry warning text |

---

## Already settled before this walk

Carried in as context, not re-litigated. These are the build inputs the three decisions above complete.

- **Approach A** — a constrained Haiku call through the existing `askJson` seam at `connect` time, validated against the team's list, silent fallback to `misc`. Graded on 15 real SKILL.md files: 11 clearly right, 4 contestable, 0 wrong, 0 invented categories.
- **The 8-category taxonomy** — the shipping 7 plus `review`. Measured 15/15 stable across order reversal, largest bucket 33%, against 53% for the 7 and a 10/15 stability failure plus forced-fit errors for the desktop design's 10. Overrode teddyzheng's 28-category seed decision `d15d09a6`; recorded as `2e21eae8`. Shipped: `team.ts:42`, guard row h, and `terum-shared-skills` commit `15c57cb`.
- **`misc` stays** — measured, not preferred: strip the escape hatch and the model forces confidently wrong answers rather than admitting no fit.
- **Bulk connect batches** — ~~one call for 15 skills gave identical answers at 26s / $0.028 against $0.137 and ~74s serial~~. **Corrected 2026-09-10 while writing the build spec:** this rested on a misreading of `connect`. Its no-path mode is an interactive one-at-a-time menu (`connect.ts:117-127`), not a loop over every local skill, so there is no bulk path to batch — one call per deliberate connect, ~5s before the y/N. The measurement stands and belongs to D1's gated re-label verb, which does have a real batch to process.
- **R1 preserved** — generated never prompted, shown in the existing y/N, a declared category always wins, plus a `--category <name>` override.

---

## Decision 1 — Back-fill the skills already stamped `misc`

**Verdict: GATE**

### Plain English
- **What's at stake:** the classifier only runs when a skill is first shared. Every skill already in the team keeps the label it has, which today is `misc` for all of them. If nothing relabels them, the browse screen stays useless for the catalogue that actually exists, and only improves for skills shared from now on.
- **Why it's a fork:** you could build a proper "relabel everything" command so any team can fix its back catalogue, or you could fix the handful you have by hand and build the command the day someone needs it. Five skills is small enough that the command is more code than the problem — but the same problem returns for every team that adopts this later with a catalogue already in place.
- **Options:**
  - **A — Hand-fix the five, gate the verb.** When the classifier lands, run it across the five and push the results. *(the difference that decides: at five skills a command is more code than the problem)*
  - **B — Build the verb now.** Ships with the classifier; every future team is covered on day one. *(the difference that decides: you pay for it now, for a problem no team currently has)*
  - **C — New shares only.** The five stay `misc` forever. *(the difference that decides: browse stays broken for your real catalogue, possibly permanently)*
- **Recommendation:** A — it gets the North Star outcome for the catalogue that exists, at the cost of one manual pass.
- **Zoom-out (does this serve the North Star?):** yes. Browse working means *your* five stop being one undifferentiated bucket; whether a command did it or a person did it is invisible to the person browsing. C fails the North Star outright.
- **The call:** A. Hand-fix the five; gate the verb.

### Technical
- **Files / code paths:** none now. The manual pass edits `skills/<name>/SKILL.md` in the team clone at `~/.terum/skills/teams/terum-shared-skills` and pushes.
- **Migration / schema:** none. The category is ordinary content and is part of the canonical digest, so a relabel reconciles like any other edit.
- **Effort / risk / blast radius:** minutes. Zero product surface.
- **Grounding findings:** the live catalogue is 5 skills — `decision-walk`, `handoff`, `spec-readable`, `state`, `tdd` — all authored by `ryanliu-terum`, so push-guard row a permits editing them directly. `config.shared` is empty on this machine, so none of the five is source-tracked here; the "edit the source, let sync carry it" path is unavailable and the edit must happen in the clone.

---

## Decision 2 — Does the confirmation line say the model was consulted?

**Verdict: LOCK**

### Plain English
- **What's at stake:** when the model can't be reached — offline, not logged in, timed out — connect stamps `misc` and carries on, because it must never block the share. The question is whether you find out that happened.
- **Why it's a fork:** the wording itself is trivial. What isn't trivial is that a classifier which silently stops working looks exactly like a classifier that ran and chose `misc`. Nobody investigates a line that reads normal, so the catalogue quietly returns to the state this whole effort exists to fix.
- **Options:**
  - **A — Distinguish the two.** Success reads `(suggested from your SKILL.md; edit any time)`; failure reads `(couldn't reach the model; edit any time)`. *(the difference that decides: a broken classifier announces itself, at the moment you are already looking at a y/N)*
  - **B — One line either way.** Always `(no category was set; edit SKILL.md any time)`. *(the difference that decides: nothing ever tells you the classifier stopped working)*
- **Recommendation:** A.
- **Zoom-out (does this serve the North Star?):** yes, though indirectly. Browse works only if the classifier keeps working; A is the only cheap detector that a silent failure has set in.
- **The call:** A. Two distinct lines.

### Technical
- **Files / code paths:** `src/commands/connect.ts` — the `categoryLine` at :198 becomes three-state (declared → no line; suggested → suggestion text; fallback → failure text). `src/lib/categorize.ts` returns `{ category, suggested }` so the caller can tell the cases apart without inspecting the error.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** under an hour including tests. Six `injectManagedFields` call sites already exist in the connect path and none of them change shape.
- **Grounding findings:** none — conceptual, on code already read this session.

---

## Decision 3 — Is `team.json.categories` the authority for a hand-written category?

**Verdict: LOCK (warn) + DEFER (desktop legibility)**

### Plain English
- **What's at stake:** the team's category list is currently enforced by nothing. The classifier would pick from it, but a person hand-writing frontmatter can type anything, and browse renders whatever it finds. Over time that fragments the catalogue into one-off buckets — which is the same failure as everything being `misc`, arrived at from the other direction.
- **Why it's a fork:** tightening it protects browse but adds a gate on a legitimate edge case — someone who genuinely needs a bucket the team hasn't added yet. And the enforcement point matters: a warning is only useful where a person will read it.
- **Options:**
  - **A — Warn on an off-list category.** A deterministic check flags it; nothing is blocked. *(the difference that decides: browse stops fragmenting without a hard stop on anyone with a good reason)*
  - **B — Refuse an off-list category.** Adding a bucket means adding it to `team.json` first, which the new guard row now permits. *(the difference that decides: the list becomes genuinely authoritative, at the cost of a hard stop)*
  - **C — Advisory only.** The list stays a seed and a classifier input. *(the difference that decides: nothing to build, no protection against drift)*
- **Recommendation:** A — the well-meaning-user frame in CLAUDE.md says warn rather than refuse, and a warning printed one line above the y/N is read at exactly the moment it can be acted on.
- **Zoom-out (does this serve the North Star?):** half of it does. In the terminal the warning lands where a person will act on it. In the desktop it currently cannot: the Tauri backend parses validate as `{ name, findings, warnings }` — a count, not the text — so HYG7 would render as an uninformative "1 warning". Against a browse-focused North Star that half is the half that matters most, and it is not mine to build.
- **The call:** A, recorded as a split — the warning is LOCKED, the desktop's ability to show it is DEFERRED to Teddy.

### Technical
- **Files / code paths:** `src/lib/evals/hygiene.ts` — new `HYG7` code (HYG1 emits only errors today, so the new finding gets its own code rather than overloading one); `HygieneInput` gains the team's `categories`, which means changing `assessHygiene`'s signature and all four call sites — `validate.ts:42`, `eval.ts:98`, `publish.ts:64` and `:118`, and connect's call. `cli.ts:114`'s help text enumerates HYG1–HYG6 and gains a line. Desktop half: `cliValidate` in `desktop/src/backend/tauri/index.ts:52`.
- **Migration / schema:** none in the repo. The check must no-op when the list is unknown — `validate <path>` on a folder that was never connected has no `team.json` to compare against.
- **Effort / risk / blast radius:** about half a day, mostly signature-threading and tests. Blast radius is every hygiene caller, which is why the no-op-on-unknown case needs a test of its own.
- **Grounding findings:** nothing in `src/` reads `team.json.categories` today — the only code touching that array is the guard predicate added this session. The real desktop backend derives its facet list by grouping live skills (`tauri/index.ts:312-313`), *not* from a fixed list, so there is no second source of truth to reconcile in the shipped app; the design-10 exists only in the mock fixture and on the canvas boards.
