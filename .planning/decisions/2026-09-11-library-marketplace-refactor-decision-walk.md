---
title: library/marketplace refactor open questions decision walk
date: 2026-09-11
north_star: Nothing moves between your machine and the team unless you ask — and you can always see exactly what's on each.
status: complete
deferred:
  - what: Nothing in this walk was checked against the team's shared record; the terum MCP refused auth all session (HTTP 401, "No authorization provided"), so check_decision and get_standing_decisions never ran
    gate: the MCP endpoint accepts the configured Authorization header again — re-run check_decision over every LOCK in this ledger
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
