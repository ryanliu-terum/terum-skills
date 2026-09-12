---
title: library/marketplace refactor open questions decision walk
date: 2026-09-11
north_star: Nothing moves between your machine and the team unless you ask — and you can always see exactly what's on each.
status: complete
deferred:
  - what: Nothing in this walk was checked against the team's shared record; the terum MCP refused auth all session (HTTP 401, "No authorization provided"), so check_decision and get_standing_decisions never ran
    gate: the MCP endpoint accepts the configured Authorization header again — re-run check_decision over every LOCK in this ledger
  - what: The category suggestion at publish and HYG7 are pulled out of B3 and become their own batch B9 (D28); until it lands, publish stamps `misc` on every skill that declares nothing, exactly as today
    gate: B5 is merged — B9 is the next batch after it, and browse-by-category stays broken until then
  - what: auto-category §6's caller list still names `connect.ts`, `publish.ts:64/:118`, `eval.ts:98` and `validate.ts:42`, all written against pre-B1 files (D28)
    gate: B9 is picked up — rewrite the list to publish-only before building from it
  - what: Repeated replacement of the same skill in one root overwrites the previous kept copy in `.claude/old-skills/`; a timestamp suffix was raised and not decided (D4)
    gate: anyone loses a backup by replacing the same skill twice, or the first bug report of a missing old-skills copy
  - what: Nothing ever empties `.claude/old-skills/`, and the Library deliberately does not show it, so Finder is the only cleanup route; whether `prune` should cover it was not decided (D4)
    gate: an old-skills folder is reported as large or confusing, or `prune` is next touched for any reason
  - what: `eval --generate` must now write cases into the user's local skill folder, which mints a new version on the next publish; the churn was accepted but not measured (D1)
    gate: anyone reports version churn they did not expect after regenerating eval cases
---

# Library/Marketplace Refactor — Open Questions Decision Walk

**North Star:** Nothing moves between your machine and the team unless you ask — and you can always see exactly what's on each.

Ratified by Ryan 2026-09-11, over two alternatives: "cheaper to change" (the maintenance half of his trigger sentence) and "keep the mechanism pure" (the two-mirror framing itself). The purity framing was rejected as a yardstick because it answers Q2 and Q3 before they are asked and contradicts the L-DECL exception already locked in the spec's §3.6.

**Why this North Star, concretely.** Measured on Ryan's machine during the walk: 88 local global skill folders; 17 skills in the team repo, 7 of them authored by Ryan; `config.shared` records **3**. `handoff`, `decision-walk`, `state` and `spec-readable` are published to the team with no local record that they were shared. No screen in the product would have told him, and none tells him now. That is the failure the refactor exists to fix — not "two sections should mirror two sources", which is the fix, not the problem.

**Batch source:** `.planning/specs/2026-09-11-library-marketplace-refactor.md` (rev 2) §15 Q1–Q6 and §16's in-flight PR call.

**Team-record check:** the `terum` MCP server refused auth for the entire session (HTTP 401). Nothing here was verified against standing team decisions — treat every decision as unchecked, not as cleared. Same condition as the 2026-09-10 auto-share walk, which recorded the same caveat.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Are eval cases part of a skill? | LOCK | Yes — a skill folder carries its own tests, so it is self-contained on disk and nothing is fetched mid-eval | — |
| 2 | Executable bit in scope | LOCK | Fix it properly in M1 — publish becomes the only way bytes travel, so bytes must arrive intact | — |
| 3 | Seed the local eval store on install | LOCK | Yes, with the runner named — the digest proves the score describes your exact bytes | — |
| 4 | Replace-on-install, and where drift detection goes | LOCK | One rule for every collision: keep the old copy in `.claude/old-skills/`, install the new one, say so. The Library keeps only the local half of the drift check | — |
| 5 | Onboarding projects step | LOCK | One folder picker; the Library button adds the rest. No new ask-frame kind, and `discover` dies with it | — |
| 6 | PR #173 and PR #167 | LOCK | Close #173 — nothing in it survives. Lift `install-destinations.ts` from #167 and close it | — |

---

## Decision 1 — Are eval cases part of a skill?

**Verdict: LOCK — A, cases are part of the skill.**

### Plain English
- **What's at stake:** whether the test cases that grade a skill travel *with* the skill — onto your machine when you install it, into the team repo when you publish it.
- **Why it's a fork:** cases are generated, not hand-written, so they feel like test scaffolding rather than part of the product. But an eval now runs locally against the folder on your disk, so if the cases are not in that folder, evaluating an installed skill means reaching back into the team's copy — the cross-mirror reach this refactor exists to stop.
- **Grounding changed the question.** The spec framed this as "versioned or unversioned". That was wrong. Measured: Ryan's 88 local skill folders contain **zero** `evals/` directories — his local `decision-walk` is one file, `SKILL.md` — while the team repo's `decision-walk` carries `evals/triggers.yaml` and three `evals/cases/*.yaml`. Cases are generated by the eval run and written *straight into the team repo*; they have never been on his disk. The spec deletes both routes that put them there, so as written, nothing produces eval cases anywhere.
- **Options:**
  - **A — part of the skill.** Generated into the local folder, digested as content identity, published inside `v<N>/`, copied on install. *(the difference that decides: the skill folder is self-contained — everything needed to run and grade it is in one visible place)*
  - **B — test scaffolding.** Cases live at `evals/<uuid>/cases/`, keyed to the skill but outside every version, never installed. *(the difference that decides: regenerating cases never mints a version)*
  - **C — what rev 2 says.** `skills/<name>/evals/`, a sibling of the version folders. *(the difference that decides: belongs to no version so install never copies it, and not under `evals/` so the eval store does not own it — an orphan)*
- **Recommendation:** A — a skill that carries its own tests is one thing you can look at, move and reason about. B splits it across two places and forces a marketplace read in the middle of a local eval. C is what the spec author wrote and is the worst of the three.
- **Zoom-out (does this serve the North Star?):** A is the only option where "you can always see exactly what's on each" is literally true of a skill folder. B and C both create files that exist on the team side and never on yours — a smaller version of the `handoff`/`state`/`spec-readable` problem that motivated the refactor.
- **The call:** Ryan took A.
- **Accepted cost:** regenerating cases mints a new version of the skill. Judged correct rather than a wart — the test suite changed, so the artifact changed — and bounded, because generating and publishing are both deliberate acts.

### Technical
- **Files / code paths:** `src/lib/evals/generate.ts` already produces both artifacts and `saveGeneratedAssets(shared.source, …)` already writes them to a local path, so A reuses machinery that exists. `src/commands/eval.ts:194-215` holds the two current upload routes (connected-source mirror via `reconcileShared`; direct commit via the `eval-assets` guard row) — both deleted.
- **Spec impact:** guard row h (`EVAL_ASSET_PATH`) is **deleted outright** rather than re-pointed — cases become ordinary version bytes. §3.1's `skills/<name>/evals/` line, §4.2's row a″, §5.1's two-map read (`versioned` + `evalAssets`) and §14.1's row-a″ test all collapse back into the single `versioned` map. `evals/**` comes **out** of D2's ignore list, so cases are digested.
- **Migration:** existing repos carry `skills/<name>/evals/**`; §13 step 1 moves it into `v1/` with the rest of the skill, which it already does by moving "current contents".
- **Effort / risk / blast radius:** net **simplification** — one map instead of two, one fewer guard row, one fewer test. Risk is version churn on regeneration, accepted above.
- **Grounding findings:** 0 local `evals/` folders across 88 skills; team repo `decision-walk` has 4 eval asset files; `eval.ts:200-215` confirms the two upload routes.

---

## Decision 2 — Is the executable bit in scope?

**Verdict: LOCK — B, fix it now, in M1.**

### Plain English
- **What's at stake:** if you publish a skill containing a runnable script, the "runnable" part is silently lost. Whoever installs it gets a file that will not execute, with nothing saying why.
- **Why it's a fork:** a genuine silent-corruption bug, which is exactly what this North Star says to fix — but nobody has ever shipped an executable file, and fixing it properly means surgery on `MutableTree`, the write path every team-repo write goes through, during the same refactor that already rewrites it.
- **Grounding:** the team repo has **zero** `100755` files; Ryan's 88 local skill folders have **zero** executable files. The only "script" in the repo is `prod-health-probe.sql` at `100644`. Skills reference scripts and Claude runs them with `bash foo.sh`, which needs no `+x`. So the mechanism is genuinely broken and has never once fired.
- **Options:**
  - **A — GATE: warn, do not fix.** Publish names the file and says the bit will be lost; does not block. *(the difference that decides: the failure stops being silent, for about an hour of work)*
  - **B — fix it now.** Executables survive the round trip. *(the difference that decides: nothing is lost, rather than loss being announced)*
  - **C — out of scope, say nothing.** *(the difference that decides: nothing to build, bug stays invisible)*
- **Recommendation was A** (GATE, tripwire = the first time anyone sees the warning). **Ryan took B.**
- **Zoom-out (does this serve the North Star?):** B fits it *better* than the recommendation did. A satisfies "nothing silent" — you are told the bit was lost. B satisfies "you can always see exactly what's on each" literally: what is on the team and what is on your machine are the same bytes with the same modes. The recommendation was the cheaper compromise, not the more aligned answer, and the argument that zero skills ship executables is partly demand suppressed by the feature being broken.
- **The call:** Ryan took B after the cost below was restated. Recorded as LOCK.

### Technical
- **Files / code paths:** `MutableTree.setExecutable(path, boolean)` on the interface (`teamRepo.ts:24-31`); a `modes` overlay in `makeTree` (`:305`); `treePaths` (`:333`) must stop requiring `tracked.has(path)` for overlay entries, or a newly-`set()` path can never be reported executable; `executablePaths` (`:331`) follows; a chmod after `writeFile` in `applyTree` (`:399-405`). Detection on the read side already exists — `src/lib/skill-source.ts:86` does `lstat(next).mode & 0o111`.
- **The fifth touch point, and the reason this is bigger than it looks:** `changedPaths` (`:321`) compares **content only** (`sameContent`), but `git diff --cached --name-only` reports a mode-only change. So a chmod of a file whose bytes did not change stages a path `changedPaths` does not list, and `safeWrite`'s staged-diff equality proof (`:220-223`) throws `Staged diff [...] does not match the mutation [...]`. B must therefore teach `changedPaths` about modes — touching `safeWrite`'s core invariant, not just the writer. This cannot fire for publish itself (a version folder is add-only, so every path is already in `changedPaths`) but `applyTree` is shared by every write path.
- **Migration / schema:** none. Mode is **not** part of content identity (Ryan's earlier D2 ruling normalises it), so version identity is untouched by this decision.
- **Effort / risk / blast radius:** five touch points in the one file every team-repo write funnels through. Mitigated by landing it in M1, which §4.4 already modifies `applyTree` for (removals-before-writes ordering) — one visit to the function, not two.
- **Test:** publish a skill containing a `0755` file, re-read from a fresh clone, assert `git ls-tree` reports `100755`; plus a mode-only-change case asserting the staged-diff proof does not throw.
- **Grounding findings:** 0 × `100755` in the team repo; 0 executable files across 88 local skill folders.

---

## Decision 3 — Should install seed your local eval store?

**Verdict: LOCK — A, seed it and name the runner.**

### Plain English
- **What's at stake:** you install a skill whose marketplace card showed a score, open your Library, and the same skill reads "Not evaluated" — because your local eval store is empty and evals are keyed to the bytes on your disk.
- **Why it's a fork:** the score is real and provably describes the exact bytes you installed (the receipt carries the content digest of that version, and install copies the version verbatim). But somebody else ran it, and putting their run into a store the Library calls "evals you have run locally" makes the app say something slightly untrue.
- **Options:**
  - **A — seed it, name who ran it.** The card shows the score and "run by ajayw36". *(the difference that decides: you see a true score for your exact bytes, and you are told it is not yours)*
  - **B — leave it blank, explain why.** *(the difference that decides: "local" keeps its plain meaning with no asterisk)*
  - **C — seed silently.** *(the difference that decides: the Library starts claiming you ran something you did not)*
- **Recommendation:** A. `provenance.runner_handle` already exists in every receipt — the live repo has one reading `"runner_handle": "ajayw36"` — and it is already inside the display subset the card reads, so attribution costs nothing. B is honest but hides a fact the user has every right to see. C is the only option that actually lies.
- **Zoom-out (does this serve the North Star?):** this is the question the rejected "keep the mechanism pure" framing would have answered *no* to without asking. Against the ratified North Star, A wins on the second clause — *you can always see exactly what's on each* — precisely because the digest makes the claim provable rather than approximate. The first clause is untouched: seeding moves no bytes, it copies a JSON file already present in the clone.
- **The call:** Ryan took A.

### Technical
- **Files / code paths:** install already reads the version folder and knows its digest; seeding is a file copy into `~/.terum/skills/evals/local/<digest>/<runId>/receipt.json`. No schema change — `receipt.version` is already `v<N>` and `provenance.runner_handle` already exists.
- **Card impact:** the Library card's eval lookup is unchanged — it digests the folder and reads that directory; a seeded receipt is indistinguishable in shape from a locally-run one, which is why the runner attribution must be rendered, not merely stored.
- **Consequence to write into the copy:** §7.3's "editing a skill blanks its score" now also means "editing an installed skill blanks a teammate's score". Correct behaviour, but the empty state must say so rather than reading as a bug.
- **Effort / risk / blast radius:** small and additive; one copy step in install plus one line of card copy.
- **Grounding findings:** live receipt at `evals/2365dd19-…/cb797acd…/20260910T060851Z.json` carries `runner_handle: "ajayw36"`, confirming a teammate's run is already in Ryan's clone today.

---

## Decision 4 — Replace-on-install, and where drift detection goes

**Verdict: LOCK — (a) one replace rule, old copy kept at `<root>/.claude/old-skills/<name>`; (b) the Library card keeps the local drift leg only.**

Walked as one decision because Ryan's counter-proposal replaced the framing. The spec asked "what still notices you edited an installed skill, now that sync does not?" — which assumed quarantine survives. It does not.

### Plain English

**(a) The replace rule.**
- **What's at stake:** what happens when you install a skill and something is already sitting at that name.
- **Why the original framing was wrong:** today install does three different things depending on whether Terum placed the folder (`config.placements` has an entry for that exact path), whether you edited it, and whether you passed `--force`. Under a Finder-mirror Library that distinction is meaningless — Ryan's `config.placements` is `{}`, so **all 88 of his skills are "foreign"**. The `owned`/`foreign` split is a distinction about Terum's bookkeeping, not about the user's files.
- **Ryan's rule, adopted:** one behaviour for every case. Something is already there → tell the user, keep their copy, install the new one. No `--force`, no quarantine on the install path, no owned/foreign branch.
- **Where the kept copy goes:** `<root>/.claude/old-skills/<name>` — a **sibling of the `skills/` root that was targeted**, so a project install's replaced copy stays in that project rather than landing in the home directory.
- **Options considered for the kept copy's name and location:**
  - `deploy-check.old` beside the original — *rejected*: a folder in a skills root is not inert. `deploy-check.old/SKILL.md` still declares `name: deploy-check`, so two folders claim one skill name and Claude Code's behaviour there is unknown (verified: 88 local skills, all flat, no nested `SKILL.md` anywhere to infer the scan rule from). terum's own scanner would also reject it on the folder-name/frontmatter-name mismatch.
  - `.deploy-check.old` dot-prefixed — workable, but hidden in Finder too, which loses the point.
  - `<root>/.claude/old-skills/<name>` — **taken.** Hyphen rather than Ryan's original "old skills" so no printed path ever needs shell quoting.
- **Why it is better than quarantine:** quarantine moves your work to `~/.terum/skills/quarantine/<timestamp>/` — outside the skills root, invisible in Finder unless you go looking, invisible in the app, emptied only by `prune`. `old-skills` keeps it one level up from where it lived.
- **Zoom-out (does this serve the North Star?):** strongly, on both clauses. Nothing is destroyed and nothing is hidden — and critically, **both invisibilities are structural rather than remembered**. It is invisible to Claude Code because it is not under `skills/`; it is invisible to the Library because `localSkillRoots` only ever resolves `<x>/.claude/skills` (`AGENT_PATHS`), so a sibling is never scanned. No filter code exists that could forget to hide it.

**(b) The drift badge.**
- `healthOf` (`src/commands/ls.ts:212-225`) already computes five states, but with a **three-way** comparison: the folder now, the fingerprint recorded at install, and the team repo's current fingerprint. Only `local-changed` is local-vs-local; `update-available`, `both` and `gone-from-repo` all need the clone.
- **Locked:** keep the local leg on the Library card ("edited since install"); the clone-dependent legs move to the Marketplace card, where §8.3 already puts the version comparison. This is a **deletion, not new work** — the local leg exists and already runs.

### Technical
- **Files / code paths:** `src/commands/install.ts:131-141` — delete the `collision.kind === 'foreign'` refusal, the `--force` flag, the `collision.kind === 'ours' && entry` branch and its `quarantineDrift` call; replace with one move to `<skillsRoot>/../old-skills/<name>` and one notice. `inspect()` (`placer.ts:29`) loses its `owned` parameter. `place()`'s `replace` option is always false now — the destination is always empty by the time it runs.
- **New rule to write down:** for a project root, add `.claude/old-skills/` to `.git/info/exclude` via the existing `appendExclude()` (`placer.ts:194`), which already does exactly this for `.claude/skills/<name>`. Local-only, never committed.
- **healthOf:** the `snapshots` map and the `gone-from-repo` / `update-available` branches go; the `placed !== entry.placementFingerprint` comparison stays. `LocalHealth` narrows from five states to two plus `unknown`. Cost is one `snapshotSkillDirectory` per **placed** skill per library load — already paid today, proportional to installed skills, not to all 88.
- **`quarantineDrift` and `moveToQuarantine` survive** in `placer.ts` for `placer.remove()` and `uninstall`; only install stops calling them. `prune` still owns the quarantine directory.
- **Effort / risk / blast radius:** net deletion on the install path. The `old-skills` move is a `moveDirectory()` call, which already handles the cross-volume case.
- **Grounding findings:** `AGENT_PATHS` resolves every skills root to `<x>/.claude/skills`, so a sibling folder is unreachable by the scanner; `appendExclude` writes `.git/info/exclude`, not a tracked file; `place()`'s own `quarantineRoot` option is a failure-path tidy-up (the displaced copy is normally **deleted**), never drift protection.

### Sub-forks punted
- Repeated replacement of the same skill in the same root overwrites the previous backup. A timestamp suffix was raised and not decided.
- Nothing ever empties `old-skills`. Since the Library deliberately does not show it, Finder is the only cleanup route. Whether `prune` should cover it was raised and not decided.

---

## Decision 5 — How does onboarding ask for your projects?

**Verdict: LOCK — A, one folder picker.**

### Plain English
- **What's at stake:** the new onboarding step where you tell the app which projects to track — a scan-and-checklist, or a single folder pick.
- **Why it's a fork:** a checklist is nicer with several repos, but the CLI has no multi-select. Every question it can ask is a confirm, a text answer or a single choice, so a checklist means adding a question type to the frame protocol that the terminal and the desktop must both learn — for one step.
- **Options:**
  - **A — one folder picker, Library does the rest.** *(the difference that decides: no protocol change, and it matches what a first run is — you have one project in mind)*
  - **B — a real checklist.** New `kind: 'multi'` ask frame plus two renderers and a protocol doc. *(the difference that decides: six repos in one pass)*
  - **C — ask one at a time.** *(the difference that decides: no protocol change, grim at ten candidates)*
- **Recommendation:** A. The step's job is to get you started, not to be the project manager. The Library needs an "Add project" affordance regardless, so B builds a second way to do the same thing — which root `CLAUDE.md` explicitly warns against.
- **Zoom-out (does this serve the North Star?):** it barely engages — nothing moves and nothing is hidden either way. So this is a cost call, and A is the one that does not add protocol surface for a one-time screen.
- **The call:** Ryan took A.

### Technical
- **Files / code paths:** needs only `AskOptions.path` (`src/lib/prompt.ts`) and `AskKind: 'path'` (`src/lib/frames.ts`), both already specified in §9.2, plus the `Choose folder…` button in `desktop/src/components/domain/WorkflowControls.tsx` calling `backend.pickFolder()`.
- **Consequence — `discover` dies.** §7.1 kept `src/lib/discover.ts` alive as a read-only lister specifically to feed this step's candidate list. Under A nothing consumes it, so it is deleted outright: `discoverSkillRoots`, `DiscoverCandidate`, `DiscoverResult`, the `kind: 'discover'` verb arm, `backend.projects.discover` on the seam, and the `discover` CLI subcommand. **This reverses §7.1's "discover survives as a read-only lister" and §15's earlier recommendation to keep it.**
- **Effort / risk / blast radius:** net deletion. No protocol change, one new button.
- **Grounding findings:** none — conceptual.

---

## Decision 6 — The two open PRs

**Verdict: LOCK — close #173; lift `install-destinations.ts` from #167 and close it.**

### Plain English
- **What's at stake:** work already written that this refactor either throws away or needs.
- **#173, batched endorsement (+450/−258, open, non-draft).** Builds the thing this refactor deletes. Endorsement is "add a skill's ID to a project list without moving any bytes"; publish now moves the bytes and *is* the only way in. It adds 376 lines to `publish.ts` — the file §5 rewrites end to end — and rewrites `AddSkillsDialog.tsx`, which §11.6 deletes. There is no merge order that saves any of it.
  - **Options:** close · merge-then-revert · leave open. **Ryan took close.**
  - Merge-then-revert was rejected as putting a subsystem into `main` that M2 immediately deletes. Leaving it open was rejected because an open non-draft Codex branch invites a rebase or an extension while the refactor is in flight, and it conflicts harder every week.
- **#167, bulk install destination (+250/−24, open, marked DO NOT MERGE).** Adds `desktop/src/screens/marketplace/install-destinations.ts` — exactly the destination-list builder §9.1 needs, since install now always asks where. Its blocker is not code: the project dialog's description still says skills go into "this repo's `.claude/skills`" while the picker can send them anywhere, a known-false string owned by Teddy.
  - **Options:** land it first (wait on Teddy) · lift the file · close and rewrite. **Ryan took lift the file.**
  - Decisive: **D4 made that copy more wrong, not less** — the destination now also determines where a replaced copy lands in `old-skills/` — and §9.1 rewrites the dialog regardless. Waiting on Teddy is waiting for a sentence this refactor replaces.
- **Zoom-out (does this serve the North Star?):** neither engages it; this is sequencing, and both calls are about not carrying dead weight into a refactor that already has a hard release ordering (§16.1).

### Technical
- **#173 touches:** `publish.ts`, `ls.ts`, `cli.ts`, `backend/types.ts`, `tauri/index.ts`, `mock/*`, `fixtures/design.json`, `AddSkillsDialog.tsx`, `marketplace.test.tsx` — every one rewritten or deleted by M2 / M5 / §11.6. Salvage: none.
- **#167 lift:** cherry-pick `install-destinations.ts` and `install-destinations.test.ts` onto the refactor branch. Drop `MarketplaceScreen.tsx`, `tauri/index.ts`, `types.ts`, `marketplace.css` and its four test files — M5 and M6 rewrite all of them.
- **Execution:** both closures are outward actions and were **not** performed as part of this walk; they are the first item in the handoff below.
- **Grounding findings:** both PRs confirmed open at 2026-09-11T05:12Z (#173) and 04:16Z (#167); #167's blocking gate read from its PR body.

---

## Close-out

**Six decisions, six LOCKs.** No gates, no deferrals of a whole fork, no delegations. Three sub-forks were punted inside write-ups and are declared in the frontmatter.

**Two decisions reversed the spec author's recommendation**, both deliberately:
- **D2** — Ryan took the full executable-bit fix over the cheaper warn-and-GATE. On review the pick is *more* North-Star-aligned than the recommendation was: a warning announces a loss, the fix means nothing is lost.
- **D4** — Ryan replaced the framing outright. The spec asked where drift detection goes assuming quarantine survives; his replace rule removes quarantine from the install path altogether and collapses three collision behaviours into one.

**Three rulings change the spec's locked sections**, not just its open questions:
- **D1** deletes guard row h, removes `evals/**` from the content-digest ignore list, and collapses §5.1's two-map read back to one.
- **D4** deletes the `owned`/`foreign` split, the `--force` flag and `quarantineDrift` from the install path, and narrows `LocalHealth` from five states to two.
- **D5** deletes `src/lib/discover.ts` outright, reversing §7.1's decision to keep it as a read-only lister.

---

## Rev-4 additions — 2026-09-11, the four forks raised by the unadjudicated rev-2 findings

**Resolved by the harden session on Ryan's standing "best call" authorization (handoff of 2026-09-11), not by Ryan in person.** Each is recorded here so it can be overturned with the reasoning in view; the spec carries them as D15–D18. Like everything above, these are unchecked against the team's shared record — the `terum` MCP refused auth again this session (HTTP 401). The 53 findings themselves are in `.planning/reviews/2026-09-11-refactor-spec-unadjudicated.md`; of them 30 were applied in rev 4, 15 were already present in rev 3, 4 were stale under D9/D13, and these 4 were forks.

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 7 | What may a raw `git push` do with `skills/**` once the author-ownership row is gone? (M10, M47) | LOCK | Refuse it, naming `publish`; delete `ownsSkill` and the author-identity plumbing with it | spec D15, §4.2 |
| 8 | Does the Library show folders the scanner rejects? (M21) | LOCK | Yes — every direct child folder is a card, with its reason; only eval and publish are withheld | spec D16, §7.4 |
| 9 | How does the rewritten `/terum-skills` manual reach a machine that already has the old one? (M29) | LOCK | `sync --hook` refreshes the marker-gated managed copy and prints one line — the single carve-out from "sync touches nothing" | spec D17, §11.1 |
| 10 | Two Moves: the install-then-uninstall re-place vs `skill move` (M44) | LOCK | `skill move` is the only Move and lives in the Library; the 2026-09-09 "placed twice rather than nowhere" ruling is superseded | spec D18, §7.5, §11.4 |

### Decision 7 — A raw `git push` of skill bytes

**Verdict: LOCK — C, refuse every `skills/**` path on a raw push, naming `publish`.**

- **What's at stake:** the pre-push hook is the last line against an accidental hand push into the team repo. Today it admits a skill folder when the pusher is its author (`ownsSkill`, reading `skills/<name>/SKILL.md`). Under layout 3 that path no longer exists, and §4.2 deletes row a and the `'connect'` action the hook passes — so the hook has no rule for `skills/**` and a compile error where it calls `ownsSkill`.
- **Options:** **A** keep author ownership, re-pointed at the latest pre-image `v<max>/SKILL.md` plus the add-only `v<N>` shape — the raw path stays stricter than `publish` (which under row a′ has no ownership gate at all), an asymmetry nothing justifies, and ~40 lines of author-identity plumbing survive for one caller. **B** mirror row a′ exactly: admit add-only `v<N>` paths with no author check — a hand-minted folder skips the identical-digest refusal, the project list and the receipt attach, so the marketplace would show a version the product's own rules say cannot exist. **C** refuse `skills/**` outright with a message naming `terum-skills publish`; delete the author machinery.
- **The call:** C. **Zoom-out:** the only option under which "you can always see exactly what's on each" stays true of a version folder. `safeWrite` pushes `--no-verify` (`teamRepo.ts:285`), so the hook only ever sees hand pushes — a hand push of skill bytes is exactly the accident it exists to catch, and the bypass stays attributed.
- **Technical:** `guard.ts:117` (the `{ action: 'connect' }` call), `:116` (the no-identity refusal), `:142-160` (`ownsSkill`), `authorOf`, `GuardContext.author`/`previousAuthor`, `skills.ts:152` (`canonicalSkillDigest`, sole caller `ownsSkill`) — all deleted. `evals/**` stays refused on a raw push, as today. Test in §14.1.

### Decision 8 — Folders the scanner rejects

**Verdict: LOCK — A, every direct child folder of a Library root is a card.**

- **What's at stake:** the prompt's most literal sentence — "a 1:1 copy of your local files" — against a scanner that classifies folders as `candidate` / `rejected` / `failed`. Grounded: `rejected` folders already reach the Library as `notOffered` cards (`ls.ts:266`, `notOfferedCard`); `failed` inspections never become a row, and the sidebar count admits only candidates plus frontmatter-problem rejects (`local-skills.ts:192-194`), so the count and the grid can disagree.
- **Options:** **A** every folder is a card and is counted; `rejected`/`failed` show the reason, withheld only from eval and publish. **B** keep today's filter. **C** show all, count candidates only.
- **The call:** A. **Zoom-out:** the North Star is visibility; D6 lets the user delete, rename and move folders Terum never placed, and cannot act on a folder it hides. Cost is one predicate plus routing `failed` through the existing `notOffered` path.

### Decision 9 — Refreshing the bundled `/terum-skills` manual

**Verdict: LOCK — A, `sync --hook` refreshes the managed copy, marker-gated, with a printed line.**

- **What's at stake:** §11.1 rewrites the operator manual Claude Code reads, but the only path that refreshes an existing machine's copy is `setup`'s `wrapper` step. Until the user happens to re-run setup, every Claude Code session is told to run `connect`, `checkout add` and `sync --prune` — verbs this refactor deletes. `wrapper.ts:82-108` already reports a `managed` copy as `outdated` and replaces it in place; only the trigger is missing.
- **Why it is a fork:** §10's new promise is "nothing on this machine is changed", and the manual sits in `~/.claude/skills/`, a folder the Library shows.
- **Options:** **A** `sync --hook` refreshes when `wrapperState() === 'outdated'`, never touches a `foreign` copy, prints one line; §10 carries the carve-out. **B** no silent refresh — `sync`/`status` print "run `terum-skills setup`". **C** refresh from the first run of any verb, silently.
- **The call:** A. **Zoom-out:** the manual is not team content — it moves between the npm package the hook already upgrades and the machine — the marker gate means no user-authored folder is ever touched, and the printed line keeps the visibility half honest. B leaves the product driving deleted verbs until the user notices; C fails the visibility half.

### Decision 10 — Two Moves

**Verdict: LOCK — `skill move` is the only Move; it lives in the Library; the 2026-09-09 re-place ruling is superseded.**

- **What's at stake:** the card menu and detail page already have a Move that is deliberately not a file move — install into the destination, then uninstall from the old scope, "so a failure leaves the skill placed twice rather than nowhere" (`SkillScreen.tsx:85-87`, Ryan 2026-09-09). §7.5's `skill move` is a `moveDirectory()` rename plus a ledger update. Rev 3 left both alive under one label.
- **Options:** **1** `skill move` replaces the re-place on both surfaces. **2** keep both under different labels. **3** Move lives only in the Library; the marketplace card and the detail page lose it.
- **The call:** 3 (1's substance, scoped to the surface D6 names). **Zoom-out:** a re-place moves bytes team→machine without the user asking for an install, and hides what is on the machine (a local edit vanishes into quarantine); a filesystem move moves nothing between machine and team and cannot leave the skill placed twice or nowhere — which is what the superseded ruling guarded against. D6 deliberately put the file actions in the Library.
- **Technical:** delete `moveTo()` and `dialog=move` (`SkillScreen.tsx:85-87`); `moveAction` is pushed for Library cards only (`skill-card-actions.ts:24`) and routes to `backend.skill.move`.

### Decision 11 — The publish regression gate (harden round 2, fork #8)

**Verdict: LOCK — relocated into `publish`, not retired (spec D19).**

- **What's at stake:** today the team repo refuses a skill whose own eval says it got worse — the eval-engine spec's publish-PR receipt check. §12 deletes PR creation, and with it that check, and nothing in the spec said whether the refusal was meant to die with the mechanism.
- **Options:** **0** record the gate as retired on both sides (eval scores become information only) and log an override of the two walks that ruled a gate should exist. **1** the same, but annotate only the target spec. **2** keep the refusal, moved client-side: publish asks before publishing bytes whose newest local receipt is a FAIL, with `--allow-regression` as the override; absence of a receipt never blocks.
- **The call:** 2. **Zoom-out:** the North Star is silent on blocking bad skills, so it does not decide this; the prior rulings (the 2026-09-06 publish-gate ruling and the 2026-09-07 hygiene/publish-gate walk) do, and overriding a Ryan ruling to tidy text is not a best-call authorization. Option 2 keeps their substance without GitHub in the loop, reads only the local store (nothing moves), and is asked rather than silently enforced — "prompts over flags". Recorded as `| .planning/specs/2026-09-04-eval-engine.md | locked, partly superseded |` in §16.
- **Technical:** §5.1 step 6a; `PublishResult` unchanged; test in §14.1. The `receipt-check` verb stays a no-op-with-notice shim for one major (§12).

### Decisions 12–16 — the five unplaced items (harden round 2's batch analysis, rev 7)

**Resolved on Ryan's standing best-call authorization**, recorded as spec D20–D24. Each is something
earlier revisions left with no home: an implementer would have had to invent an answer, and Codex is
instructed to stop and record an `openQuestion` rather than do that — so leaving them would have
stalled a batch.

| # | Decision | Verdict | Rationale (plain) | Pointer |
|---|---|---|---|---|
| 12 | Setup's `actions` step after `connect` dies | LOCK — delete it; setup is twelve steps | Its only body offered to publish local skills. Under the North Star the Library's publish button *is* the ask; an onboarding step that offers to upload your skills is auto-share with a confirm on it | D20, §9.2 |
| 13 | `readme --pr-comment`, which reads `team.global` and runs on PR events the product no longer creates | LOCK — no-op-with-notice shim for one major | Same rule §12 already applies to `receipt-check`: the committed Action is un-updatable, so a verb it invokes cannot simply vanish | D21, §11.5 |
| 14 | The Inbox's `update` and `review` item kinds (§11.5 left this explicitly open) | LOCK — delete both; the surface stays dark | They encode the two mechanisms this refactor removes. `surfaces.inbox` is already false and the route redirects, so the cheapest correct answer is also the honest one | D22, §11.5 |
| 15 | `policy.publish` in the byte-locked desktop fixture schema | LOCK — loosen the schema, record the deviation | `design.json` cannot be hand-edited (`export:check` byte-locks it) but `fixtures/schema.ts` can; making the field optional is the only edit available | D23, §11.5 |
| 16 | Which new verbs are `FRAME_VERBS` | LOCK — `prune` and `skill *` yes, `team migrate` no | Each of the first two has a seam the app drives; the migration is run once per team by a human from a terminal, never from the app, and the inventory tests force the decision either way | D24, §7.5, §13 |

**Also recorded in rev 7, and not a fork:** §16.1's build order was replaced. The milestone order it
stated (M1 → M2 → M3, M7 "same commit as M2 or before") is not executable as green batches — deleting
`src/lib/version.ts` and dropping `global`/`policy.publish` from `teamSchema` break `eval.ts`,
`evalReport.ts`, `install.ts`, `publish.ts`, `status.ts`, `readme.ts`, `team.ts` and `guard.ts` at
once, and `skillRecords` reading `v<N>/SKILL.md` invalidates ~34 test fixtures. The eight-batch order
puts M7 first (so the guard-action call sites are gone before `guard.ts` is rewritten) and fuses
M1+M2+M3. This is a correction of fact, not a product decision; the evidence is in
`.planning/reviews/2026-09-11-refactor-implementation-batches.md`.

---

## B1 implementation additions — 2026-09-11, the two batch-boundary calls the first Codex run forced

**Resolved on Ryan's standing best-call authorization (handoff of 2026-09-11), not by Ryan in person.**
Both surfaced while filling the B1 prompt and neither had an answer anywhere in rev 7: an implementer
reaching them would have had to invent one, and Codex is instructed to record an `openQuestion` rather
than do that — which would have stalled the batch on its first file. They are recorded here in advance
of the diff; the spec will carry them as **D25–D26** in the rev-8 pass that follows B1's verification,
so that revision describes what actually landed rather than what was predicted. Unchecked against the
team's shared record like everything above — the `terum` MCP refused auth again this session (HTTP 401).

| # | Decision | Verdict | Rationale (plain) | Pointer |
|---|---|---|---|---|
| 17 | `eval --working` and `eval --save`, which the spec names nowhere | LOCK — delete both in B1 | Both dereference `config.shared`, the thing §12 deletes. Keeping a flag whose only job is to point at a concept the release removes is a dead control that lies about what the product can do | rev-8 D25, §6.3, §12 |
| 18 | `saveGeneratedAssets` has no caller left after D25 and the `--commit` deletion | LOCK — keep it, caller-less, until B3 | §6.3 re-wires it as the single generate destination two batches later. Deleting and re-adding the same function is churn that shows up in two diffs as a false rewrite | rev-8 D26, §6.3, OF-5 |

### Decision 17 — `eval --working` and `eval --save`

**Verdict: LOCK — delete both flags, their registrations and their guards, in B1.**

- **What's at stake:** the batch plan flagged these as coupling 7 — "named nowhere in the spec" — and B1
  is the batch that deletes the state they read. `--working` resolves eval's candidate directory out of
  `config.shared[record.id].source` (`eval.ts:118-122`) and refuses when the skill is not a connected
  local source; `--save` refuses unless `--working` is present (`eval.ts:79`) and writes generated assets
  to that same connected source (`:186-188`). §12 deletes `config.shared` and every reader of it. So the
  flags do not merely lose a feature — they lose the object they dereference.
- **Options:** **A** delete both with `config.shared`. **B** keep `--working` and re-point it at the local
  skill folder — but §6.3 makes the local folder the *only* eval target one batch later, so `--working`
  would become a flag that selects the sole available option, and `--save` a flag that opts into the write
  D9 makes unconditional. **C** leave them registered as no-op-with-notice shims, the way D21 treats
  `readme --pr-comment` and §12 treats `receipt-check`.
- **The call:** A. **Zoom-out:** the visibility half of the North Star is about seeing what is true on
  each side, and a registered flag is a claim about what the product can do. `--working` claims there are
  two things to evaluate — your copy and the team's — which is precisely the distinction this refactor
  spends 890 lines removing. B revives it as a vestige; C is the shim rule applied where its reason does
  not hold: `receipt-check` and `readme --pr-comment` survive as shims because a **committed GitHub Action
  the product cannot update** invokes them by name, and nothing invokes `eval --working` but a human.
- **Technical:** delete the two `EvalArgs` fields, both commander `.option()` registrations
  (`cli.ts:157`), the `--save is only available with --working` guard (`eval.ts:79`), the
  `--working --commit is refused` guard (`:361`), the `args.working` candidate branch (`:118-122`), the
  `!args.working` argument threaded into `assessHygiene` (`:131`), the `args.save` write (`:186-188`), and
  the mentions in the queue-mode per-skill-selection-flags guard (`:563`). The candidate stays the
  materialized committed tree for B1 — §6.3's local-folder resolve is B3's.

### Decision 18 — `saveGeneratedAssets` with no caller

**Verdict: LOCK — keep the function unmodified through B1; B3 re-wires it.**

- **What's at stake:** rule 0.2 ("one active path per behaviour") and the instinct to delete dead code.
  After D25 and §6.3's `--commit` deletion, both of `saveGeneratedAssets`' call sites are gone
  (`eval.ts:186-188` was `--save`; `:200-207` was the confirm-commit branch, which §6.3 deletes by name).
- **Options:** **A** keep it caller-less for one batch. **B** delete it in B1 and re-create it in B3.
- **The call:** A. **Zoom-out:** this is the same allowance §16.1 already makes for the guard rows of the
  actions B1 deletes — they sit with zero callers for exactly one batch, which the spec calls "dead code,
  not a second active path". The precedent is in the spec; applying it twice is consistency, not
  laxity. B also costs a real thing: the function's refusal contract is the subject of an open finding
  (**OF-5**, "`saveGeneratedAssets` refuses regeneration", blocking B3), and deleting it would hand B3 a
  blank page instead of the code that finding was written against.
- **Cost accepted:** its two `--save refused:` messages name a flag D25 deletes. No user can reach them
  with the flag gone, and §6.3 rewrites them in B3. Noted so a reviewer reading B1's diff does not file it.

### Also recorded, and not a fork: how §11.5's eight bullets split across B1 and B3

Rev 7's §16.1 assigns "§11.5" to B1 wholesale, while the batch plan's B3 row claims part of it
(`status.ts:26,113`, `cliSearch`/`SearchHit`). The spec settles its own conflict: §11.5's
`policy.publish` bullet requires the field to leave `status.ts`, `teamSchema` **and** the desktop's
non-passthrough `status` mirror *"in one change"*, and `teamSchema` is §4.1 — B3. So the whole
`policy.publish` cluster is B3's, and with it D21 (`readme --pr-comment` reads `team.global`, also §4.1)
and D23 (the fixture schema loosens *because* `policy.publish` leaves). `cliSearch`/`SearchHit` need
§4.1's `unresolved` deletion, so they are B3's too.

**B1 takes four bullets:** the `login.ts:42` identity notice, `status`'s pending-work guidance and the
*fetched*-not-*synced* wording, the Inbox kinds (D22), and `decline`'s six surviving desktop declarations
plus the two CLI-side names §12's `CliVerbs.decline` does not cover (`frames.ts`'s `'decline'` entry and
the `cli.ts` registration). This is a reading of the spec against itself, not a decision — recorded
because a reviewer comparing B1's diff to §16.1's one-line scope would otherwise read the four
untouched bullets as omissions.

---

## Decisions 19–27 — the calls B1's implementation forced (2026-09-11, second session)

**Resolved on Ryan's standing best-call authorization** ("resolve forks yourself against the North Star
and record the call in the ledger; do not stop to ask"). Every one was forced by making B1 green, and
each is a place where the spec is silent or where Codex's output had to be adjudicated rather than
accepted. The full technical write-up of each is in
`harden-refactor-scratch/b1-review-findings.md`.

| # | Decision | Verdict | Rationale (plain) | Pointer |
|---|---|---|---|---|
| 19 | Finish B1's remaining screens work in a fourth Codex stage, or in the orchestrator? (the handoff's Open Decision) | **LOCK — orchestrator** | The 212 failures collapsed to 29 by one diagnosis costing no Codex budget, and what was left was adjudication — *is this test obsolete, or is the app wrong?* — which is exactly the category where all three prior Codex defects landed (an assertion rewritten into something false, two silently dropped catalogue entries, sixteen tests commented out rather than deleted). The cross-model property is worth its cost on generation, not on adjudication | Open Decision in the handoff; Codex window was at 77% against an 80% gate |
| 20 | Seven more frame-set recordings still carried keys §10/§12 delete. Re-record them all, or strip exactly the dead keys? | **LOCK — strip the dead keys** | Re-recording `personal-library` worked because those verbs are drivable with no team; `installed-state` and `mock-vs-real` encode a populated team repo, a roster, projects and installs that no longer exist anywhere, so re-recording would have rebuilt scenarios from scratch and changed hundreds of unrelated recorded values. The strip is byte-identical apart from the dead keys, round-trip verified line by line before applying, and the *shape* it produces was then checked against a freshly driven CLI | §10.1, §12; 22 files, 44 keys |
| 21 | The desktop's background fetch spawned `['refresh']`, a verb B1 deletes | **LOCK — spawn `['sync']`** | The collapse is what makes an unattended call safe: §10 guarantees a fetch changes nothing on this machine, which is the entire reason the old code needed a separate verb. Keeping a second fetch-only verb alive purely for the app would recreate the two-paths problem §16.1 forbids | finding 8 |
| 22 | `cliSync` and `cliRefresh` now mirror the same DTO | **LOCK — one mirror: `cliRefresh`** | `cliSync` described the deleted reconciler (`timings`, and the per-team reason as `message` where the CLI emits `detail`), so the sync popup rendered failed teams with no reason at all. Two mirrors for one DTO is the same defect class as two active code paths | finding 9; CLAUDE.md "never leave two active paths" |
| 23 | What a fetch-only sync invalidates | **LOCK — `catalog`, `skill`, `roster`, `receipts`; never `library`** | A fetch brings in teammates' people files and their committed receipts — the adapter's own W-08 comment says the fetch exists *so that a teammate's receipt reaches this machine*. `library` is excluded on principle: under the two-mirror model the Library is local files, which a fetch cannot touch. Visibility is the North Star's second half, so a read model that a fetch can change must be invalidated | finding 10 |
| 24 | `SetupArgs.offerConnect`, never in argv and with no CLI counterpart after D20 | **LOCK — delete it and its eight test pins** | A parameter the adapter accepts and silently ignores tells the next reader that setup still has a connect offer to suppress | finding 11 |
| 25 | The Inbox `alert`/`missing` and `alert`/`local` primaries ("Re-place from team", "Restore team version") call `backend.sync({})`, which now places nothing | **DEFER — record as OF-20, do not rewire in B1** | The honest fix is `install` (the second with `--force`), but §11.5's ruling deliberately stops at deleting the two kinds *because the surface stays dark* (`surfaces.inbox` is false on the real adapter). Inventing install semantics for a dark surface inside a deletion batch is scope the spec declined. Gate: whoever lights the Inbox | OF-20; §11.5, §13 |
| 26 | The sidebar's nested `Updates` row survives D22 | **LOCK — leave it, record the debt** | It renders only when `surfaces.inbox` is true, and removing it would move every sidebar fidelity board — 78 rows — for a surface nobody can reach. Recorded in `desktop/FIDELITY.md` so it is not rediscovered as a bug | D22; FIDELITY.md deviations |
| 27 | `design.json`'s `INBOX_KIND_TEXT` still carries copy for the two deleted kinds, and `fixtures.test.ts` asserts the parse loses no source field | **LOCK — make the two keys optional, record the deviation** | Exactly D23's precedent for `TEAM_POLICY.publish`: the byte-locked fixture keeps its bytes, the schema stops requiring what the CLI can no longer emit, and the real adapter is not forced to fabricate copy for a kind that does not exist | D22, D23, §11.5 |

**Two things in B1's diff are deliberate and would be broken by "fixing" them.** The five re-recorded
`personal-library` captures are hand-edited twice over — once for the dead keys, once to drop `autoSync`
from their `hello` after the CLI stopped advertising it — and that is the orchestrator's file to own, not
Codex's. And `docs/frame-protocol.md`'s `### f-auto-sync` section is *replaced*, not trimmed: every
sentence in it described `sync --auto`, placement reconciliation, sharing and pending replay. B7's final
protocol pass inherits the rest of the doc, not this section.

---

## Decisions 28–29 — the two rulings that blocked B3 (2026-09-11, walked with Ryan)

Both were surfaced by `harden-refactor-scratch/of-checks-verified.md` as OF-1 and OF-5 and explicitly
marked "needs a human ruling, not just an edit". Ryan decided both in session. The other three B3
blockers (OF-2, OF-3, OF-4) are mechanical spec edits with determined fix shapes and are not walked here.

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 28 | Who builds the category suggestion at publish, and HYG7 with it (OF-1) | **LOCK + DEFER** — B3 ships without them; auto-category becomes its own batch **B9**, after B5 | The suggestion is a feature with a model call in it, serving a *different* North Star ("browse actually works"); loading it into the keystone batch spends this refactor's risk budget on someone else's objective. Nothing regresses meanwhile — publish stamps `misc` exactly as it does today | B9, gated on B5 merging |
| 29 | What `eval --generate` does when the skill already has eval cases (OF-5) | **LOCK** — delete `--gen`; eval uses the cases that are there and generates only what is missing, per asset; no overwrite path exists | The fork existed only because one flag forced generation over existing files. Removing the flag dissolves it: nothing can be overwritten, so there is no prompt to design and no generated-vs-authored provenance to invent. Regenerating is deleting the folder and re-running — which fits a Library that *is* your local files | — |

---

## Decision 28 — Who builds the category suggestion at publish, and HYG7 with it

**Verdict: LOCK (B3's scope) + DEFER (the suggestion and HYG7 → batch B9, after B5).**

### Plain English

- **What's at stake:** when you publish a skill for the first time, the tool stamps a category on it —
  the label that makes browsing a teammate's catalogue work. Rev 7 says publish should read the skill and
  *suggest* one. That suggesting code has never been written and no batch builds it, so B3 as planned
  calls a function that does not exist. HYG7 — the warning when you type a category your team does not
  use — is unbuilt and unowned for the same reason.
- **The filed question was the smaller half.** OF-1 asked who owns HYG7. Grounding showed the whole
  auto-category build is unowned: `suggestCategory`, `src/lib/categorize.ts` and `askJson settingSources`
  do not exist, and `hygiene.ts` stops at HYG6. `DEFAULT_CATEGORY = 'misc'` is the only piece that is real.
- **Why it's a fork:** the suggestion is a feature with a model call in it (~$0.009 and ~5s per skill,
  graded 11 clearly right / 4 contestable / 0 wrong over 15 real SKILL.md files). B3 already fuses three
  milestones and is the batch everything downstream waits on. Putting a network-dependent path inside the
  keystone makes the keystone riskier; leaving it out means publish keeps stamping `misc` on everything,
  which is the dead-field problem auto-category was written to fix.
- **Options:**
  - **A —** B3 builds only what exists: precedence degrades to *declared › `--category` › `misc`*, no
    model; the suggestion and HYG7 land in their own batch B9 after B5. *(The difference that decides:
    B3 stays a refactor instead of a refactor-plus-feature, and nothing in it can fail on a model call.)*
  - **B —** B3 absorbs auto-category whole. *(The difference: browse works the day publish ships, paid
    for by adding a network-dependent path to the riskiest batch in the plan.)*
  - **C —** build auto-category first, before B3. *(The difference: B3's step 4 compiles as written, but
    it puts a feature ahead of the deletion work everything is blocked on — and auto-category's caller
    list is written against files B1 deleted, so it needs a rewrite pass either way.)*
- **Recommendation:** A — the category feature serves a different North Star, so it should not be paid
  for out of this refactor's risk budget.
- **Zoom-out (does this serve the North Star?):** yes, and that is exactly why. This batch's North Star is
  about *what moves and what you can see on each side*; how well the catalogue is grouped is the
  auto-category walk's objective, not this one's. Under A nothing regresses — publish stamps `misc` today
  and still will — so the cost is a delay to an improvement, not a loss of one.
- **The call:** **A** (Ryan, 2026-09-11, in session).
- **Sub-fork, decided with it: HYG7 is kept, not dropped.** Once the suggestion exists, a suggested
  category is on-list by construction, so HYG7 only ever fires on a category a human typed. It is a list
  comparison — no model, no network — it warns and gates nothing, and it is the only thing that tells the
  author their catalogue is about to grow a one-off bucket.

### Technical

- **Files / code paths:** `src/lib/evals/hygiene.ts` — `HygieneCode` is `'HYG1'…'HYG6'`;
  `assessHygiene(name, input, license, allowExecutable = false)` has no fifth `categories?` parameter.
  Refactor spec §5.1 **step 4** calls `suggestCategory(raw, team.categories, agent)`; **step 5** freezes
  `assessHygiene(name, { files, executable }, policy.skill_license)` at three arguments — so even after
  HYG7 exists, publish, the one caller holding both a category and the team's list, would skip it.
- **Follow-on spec edits this ruling forces (mechanical, no further ruling):**
  1. §5.1 step 4 — state the B3 precedence as *declared › `--category` › `DEFAULT_CATEGORY`*, with the
     `suggestCategory` limb marked as arriving in B9.
  2. §5.1 step 5 — note that the `categories` argument joins the call in B9, so the three-argument form
     is not read as final.
  3. The batch plan gains **B9 — auto-category** (after B5): `src/lib/categorize.ts`, `askJson
     settingSources`, `--category` on publish, HYG7 plus the fifth parameter, and the rewrite of
     auto-category §6's caller list from `connect.ts` to publish-only.
  4. §16's auto-category row keeps "locked, amended" and gains the batch pointer.
- **Migration / schema:** none. `metadata.terum-category` is written today and keeps being written.
- **Effort / risk / blast radius (a footnote that decided nothing):** A is two spec edits plus a later
  batch; B adds ~300 lines and a model path to an XL batch; C reorders the build plan.
- **Grounding findings:** verified directly in the B1 tree — `categorize.ts` absent, `suggestCategory`
  and `settingSources` absent, `DEFAULT_CATEGORY` present at `src/lib/skills.ts:157`, hygiene codes
  HYG1–HYG6 at `src/lib/evals/hygiene.ts:6`, the three-argument call frozen at spec §5.1 step 5.

---

## Decision 29 — What `eval --generate` does when the skill already has eval cases

**Verdict: LOCK — delete `--gen`. Eval uses the cases that are there and generates only what is missing,
per asset. There is no overwrite path, so there is nothing to refuse and nothing to prompt.**

### Plain English

- **What's at stake:** `eval --generate` writes test cases for a skill. Under D9 those cases live *inside*
  the skill folder — they are part of the skill, they change its content fingerprint, and they reach the
  team at the next publish. The question was what happens the second time you run it, when
  `evals/cases/` already has files: today the code refuses flatly, while D9 explicitly anticipates
  regenerating and accepts the version churn. The spec described a path the code could not take.
- **Why it looked like a fork:** the obviously-nice rule — overwrite what the tool generated, never touch
  what you wrote by hand — is **not implementable**. Nothing on disk records which is which, and the
  distinction cannot be added cheaply: under D2/D9 everything in the folder is content identity, so any
  marker file becomes part of the skill and is published to the team.
- **Options as first framed:** **A** ask before overwriting (prompt, default No). **B** overwrite
  silently. **C** keep refusing, with an actionable message.
- **Ryan's reframe, which replaced all three:** `--generate` should do nothing. Without it, eval looks
  for cases and uses them if found, generates them if not. With it — the same. **This is already the
  default:** `plannedGeneration` (`eval.ts:262`) generates only when no authored cases exist, *except*
  for the `Boolean(args.gen) ||` limb, whose sole job is to force generation over existing files. That
  limb is the entire reason this finding exists.
- **Why it beats every option offered:** it dissolves the fork instead of resolving it. With the flag
  gone, `saveGeneratedAssets` can never be asked to overwrite, so there is no prompt to design, no
  provenance scheme to invent, and the `--save refused:` strings — which already name a flag B1 deleted —
  become unreachable code to delete rather than text to rewrite.
- **What it costs, plainly:** regenerating means deleting `evals/cases/` and re-running. That is the only
  path, and it belongs in the miss message for anyone who goes looking for the flag.
- **Zoom-out (does this serve the North Star?):** yes, more directly than the prompt did. Under the
  two-mirror model the Library *is* your local files, so managing them is yours, in Finder or an editor;
  a second CLI route that mutates them was against the grain. And nothing here moves toward the team —
  publish still asks before any byte leaves.
- **The call:** Ryan's reframe, 2026-09-11, in session, confirmed with three riders:
  1. **`--no-gen` survives** — "use what's there, spend no model call" is the honest opposite now that the
     positive flag is gone.
  2. **Per asset, not all-or-nothing** — a folder with cases but no `triggers.yaml` generates only the
     triggers. Cases and triggers are already decided independently; the spec must say so, so nobody
     re-reads the rule as a single switch.
  3. **The disclosure line matters more, not less** — with no flag, the first eval of a skill quietly
     writes into that skill's folder, changing its content fingerprint, so the next publish mints a new
     version and the current eval score blanks. §6.3 already requires saying so before the write; under
     this rule that line is the only signal the user gets. It stays a **printed line naming the path and
     the consequence, not a prompt**: publish already asks before anything leaves the machine, and
     publish already writes into the same folder (§5.1 step 5), so a prompt here would be friction on the
     happy path.

### Technical

- **Delete:** the `Boolean(args.gen) ||` limb in both lines of `plannedGeneration`
  (`src/commands/eval.ts:262-263`), the `--gen` option in `src/cli.ts:155`, `EvalArgs.gen`
  (`eval.ts:42`), its conflict guard against `--case` (`:75`) and its rejection in queue modes (`:441`),
  and both `pathExists` refusals in `saveGeneratedAssets` (`:315-316`) — unreachable once no caller can
  present an asset that already exists. The `--save refused:` strings name a flag deleted in B1
  (Decision 17), which is why they read as dead text today.
- **Keep:** `--no-gen`, `writeGeneratedAssets`, the per-asset shape of `GeneratedAssets` (only the
  generated half is ever written), and `saveGeneratedAssets` itself — §6.3 makes it the sole route
  (`saveGeneratedAssets(<the local skill folder>, generated)`), and D26 kept it callerless for exactly
  this.
- **Unchanged:** generation still runs into `runDir/generated` for the run itself; only the write-back
  into the skill folder is governed here.
- **Spec edits this forces:** §6.3's "`saveGeneratedAssets(<the local skill folder>, generated)`, full
  stop" gains the rule (use what's there, generate what's missing, per asset), the removal of `--gen`,
  the delete-and-re-run answer for regeneration, and the disclosure line as a print. `cli.ts:155`'s help
  text loses one option. `src/commands/__tests__/eval.test.ts` loses its `--gen` cases and gains one:
  a folder with cases and no triggers generates only triggers.
- **Effort / risk / blast radius (a footnote that decided nothing):** strictly subtractive — one flag,
  two guards, two refusals; no new code path and no desktop change (`EvalArgs` on the desktop never
  carried `gen`).
- **Grounding findings:** verified in the B1 tree — `plannedGeneration` at `eval.ts:262-263`;
  `--gen`/`--no-gen` registered at `cli.ts:155`; the two refusals at `eval.ts:315-316`; `--save` and
  `--working` absent from the whole tree after B1; no desktop caller of `gen`.

---

## Decision 30 — Does B2 go to Codex, or straight to the orchestrator?

**Verdict: LOCK — orchestrator throughout. Not on the shape of the work; on the quota arithmetic.**

**Resolved on Ryan's standing best-call authorization (handoff of 2026-09-11), not by Ryan in person.**
The handoff left this open and leaned weakly toward a Codex stage for the mechanical rename half. The
free diagnosis it asked for first has now run, and it moves the answer.

### Plain English

- **What's at stake:** who writes B2's `checkouts` → `projects` rename — a Codex run adjudicated by the
  orchestrator (as B1), or the orchestrator directly.
- **The argument for Codex is intact and was not defeated.** The rename is genuinely large — **85 files,
  507 occurrences** of `checkout`/`Checkout` across `src/`, `desktop/src/`, `e2e/` and `docs/` — and it is
  exactly the enumerable, mechanical shape every counted-target B1 run completed cleanly. It also
  preserves the cross-model property that is the point of running a Claude-written spec through
  `codex-implement`.
- **What defeats it is the budget, measured rather than assumed.** Codex's weekly window is at **77.0%**
  used and the `codex-implement` preflight stops at **≥80%**. B1's runs on 2026-09-11 took the same
  window from **62% → 77%** across the day, i.e. **4–5 points per substantial run**. One B2 rename stage
  therefore crosses the gate *during* the run, not before it — and the contract's own rule is that a
  quota kill mid-run is worse than a delayed start (it is how B1 run 3 died on 2026-07-23). The window
  does not reset until **Mon Sep 14 18:30 PDT**, three days out; B2 is not worth stalling three days.
- **The call:** (b), orchestrator throughout. Recorded so it can be overturned cheaply — if the window
  resets before B3, the argument for a Codex stage returns unchanged, because nothing about the *shape*
  of this work counted against it.

### Technical — the capture diagnosis that was supposed to settle it, and what it actually found

The handoff predicted B2 would re-run B1's stale-recording class ("expect exactly this class again").
It will not. Across **105 recordings** under `.planning/codex-runs/*/frames/*.jsonl`, all of which carry a
`hello` frame:

| what B2 moves | recordings affected | how it fails |
| --- | --- | --- |
| `FRAME_FEATURES.checkouts` → `libraryProjects` | **26** (21 + the 5 hand-edited `personal-library`) | **silently** |
| `FRAME_VERBS` `checkout add\|remove\|list` → `project …` | the same 26 | silently |
| `features.discover` dropped, `checkout discover`, `project create` | 5 (`personal-library` only) | silently |
| setup step `discover` → `projects`, `actions` deleted (§9.2, D20) | **0** | — |

**The staleness is silent, which is the inverse of B1's and the more dangerous direction.** B1's captures
failed loudly because `cliLocalRow` is `.strict()`. The `hello` frame has no such guard: the desktop
parses `features` as a bare cast (`desktop/src/backend/tauri/frames.ts:29`,
`features: f['features'] as Record<string, boolean>`) and reads it as
`hello?.features[key] ?? false` (`tauri/index.ts:618`). So after the rename, all 26 recordings yield
`libraryProjects: false`, the sidebar's **Add project** button vanishes, and **no test goes red** — §7.1's
"reads `false` forever" hazard, realised. This is a fourth instance of B1's gate-green/app-broken class.

Two consequences, both inside B2:

1. **The 26 recordings are re-keyed in-batch**, mechanically and round-trip-verified (the
   `scratchpad/strip-dead-keys.py` pattern: parse every line, assert byte-exact round-trip, rewrite only
   the dead keys). No re-record is needed — the rename is a key name, not a shape.
2. **No setup recording moves at all**, so §9.2's step rename is a pure typecheck exercise
   (`SETUP_STEP_TO_BOARD` is `satisfies Record<SetupStep, string>`), which is the loud direction.

**Filed, not taken — a `FEATURE_KEYS` ↔ `FRAME_FEATURES` set-equality tripwire.** It is the countermeasure
the silent failure above argues for, and it is the same class of thing as the mirror type-test the handoff
reserved for Ryan: new permanent cross-tree test infrastructure. It is therefore **not built here**, and
joins the mirror type-test as a proposal. B2 closes its own instance by re-keying the recordings.

---

## Decisions 31–37 — the calls B2's implementation forced (2026-09-11, third session)

**Resolved on Ryan's standing best-call authorization (handoff of 2026-09-11), not by Ryan in person.**
Each surfaced while building B2 and had no answer in rev 8: an implementer reaching them would have had
to invent one. Recorded here with the reasoning in view so any can be overturned cheaply. Unchecked
against the team's shared record — the `terum` MCP refused auth again (HTTP 401), a seventh session.

| # | Decision | Verdict | Rationale (plain) |
|---|---|---|---|
| 31 | `LocalRoot.detected` after §7.2 deletes both its producers | LOCK — delete it end to end | Nothing can set it once the cwd root and `extraRoots` are gone. It gated two "Add" buttons (the sidebar's per-row `+ Add`, Settings' Add-on-a-detected-row) that the real app could then never show — the dead-control-that-lies class D25 used to delete `eval --working`. The `detected-root` mock scenario went with it; no fidelity board used it |
| 32 | `added_at` on a project migrated from `checkouts` | LOCK — optional, and the migration omits it | The old shape never recorded when a root was registered. Stamping today's date would put a fact on the Library that is simply false, against "you can always see exactly what's on each". `addLibraryProject` always sets it going forward |
| 33 | Whose label changes when two project basenames collide | LOCK — relabel the whole set, not just the newcomer | §3.6 gives the rule but not its scope. Labelling `/b/web` as `web (b)` while `/a/web` stays `web` leaves the pair unreadable in exactly the way the rule exists to prevent. `projectLabels()` is positional and pure: basename, parent-qualified on collision, whole root if even that collides |
| 34 | `destinationSchema`'s `kind: 'checkout'` discriminant | LOCK — leave it; it is B6's | §7.1's naming table does not name it, and it is a **persisted** value (`config.pending[].destination`), so renaming it needs a migration nobody has specified. §9.1 rewrites the destination picker in B6; that is where it belongs, if anywhere |
| 35 | What an unreadable project root does now | LOCK — stays visible, reports `unreadable` | The old pre-scan permission probe existed only to decide whether to admit an *undetected* cwd root, and it dropped the root and printed a problem line instead. A root the user added must not vanish from the Library because it briefly cannot be read — that would make the Library disagree with `project list`. The scan itself now supplies the state |
| 36 | B2's projects onboarding fidelity board | LOCK — **owed, not added** | `boards.test.ts` asserts a read-only oracle for **every** `BOARDS` row regardless of status, gated only on `TERUM_DESIGN_DIR`. A row with no artboard passes here (no design dir) and fails on the maintainer's Mac — the worst outcome. The artboard is Teddy's, and the step's only surface is a prompt dialog no route renders. Recorded in `desktop/FIDELITY.md` with what it needs, in order. The 90-row pin is untouched |
| 37 | Where the `path` ask actually renders | Correction of fact, not a fork | §9.2 names `desktop/src/components/domain/WorkflowControls.tsx`. That file is a 21-line popup shell and renders no ask kinds; the ask renderer is `PromptDialog` in `desktop/src/app/providers.tsx`. Built there: the existing `.prompt-field` input plus a `Choose folder…` button calling `backend.pickFolder()`, in a `.prompt-path` flex row. The typed value stays the answer, so a shell without a chooser is still a working prompt — which is what the protocol promises anyone treating `path` as `text` |

**Also settled by building it, and not a fork:** §9.2's step body needs no "no folder chosen" branch.
A blank answer to a text question takes the offered default (`frames.ts`'s `answer || defaultValue || ''`),
and the step always offers one, so the branch was unreachable. Declining is the confirm — the **Skip**
half of §9.2's drawn control — and that is the only way to leave the step without a project.
