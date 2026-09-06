---
title: phase-1 hardening rulings — decision-walk batch
date: 2026-09-06
status: batch — the input to /decision-walk; the walk writes its own ledger beside this file
north_star_proposed: fastest path to a shippable 0.1.0; a documented rough edge is acceptable unless it loses data, takes over someone's identity, or leaks a token
---

# Phase-1 hardening rulings — batch for `/decision-walk`

> **Walked 2026-09-06.** Every ruling is resolved in `2026-09-06-phase1-rulings-decision-walk.md`; this file is the input it consumed.

**Run it:** `/decision-walk .planning/decisions/2026-09-06-phase1-rulings-batch.md` from a checkout of `docs/phase1-rulings-walk` (worktree `../terum-codex/rulings-walk`, off `main` @ `d294401`, everything from PRs #3–#9 landed). The walk ratifies the North Star first, then takes the rulings one at a time in the order below, and writes `.planning/decisions/2026-09-06-phase1-rulings-decision-walk.md`.

**North Star to ratify:** carried unchanged from the 2026-09-04 and 2026-09-05 walks — *fastest path to a shippable 0.1.0; a documented rough edge is acceptable unless it loses data, takes over someone's identity, or leaks a token.* Every recommendation below is measured against that sentence; where the review loop's recommendation and the North Star pull apart, both are stated.

**Sources:** the four harden ledgers (`.planning/debug/harden/{phase1-harden,phase1-closeout,phase1-closeout-r2,m4-ship}.deferred.md`), the harden end states (`.planning/harden/*.md`), the review reports they cite (`.planning/reviews/*.hybrid.r*.review.md` — each ruling names its report and the line of the triage entry), the bodies of PRs #6, #7, #8, and the landing register `.planning/reviews/DEFERRED-2026-09-04-phase1-landing.md`. Everything else those documents raised was fixed, or declined with a reason (§F lists the declines so the walk can overrule any of them in one line).

**Effort figures are estimates** by the assembling session, not measurements: hours of one person's build time, excluding the Astra review pass that follows the batch (about 1.5 h of wall-clock per pass, two passes for a fix branch under the two-pass rule).

---

## Order, and why

| # | Ruling | Why this position | Interim on `main` today | Loop's recommendation | Est. |
|---|---|---|---|---|---|
| R1 | A skill with no `metadata:` block crashes `share` — refuse or ask? | **Gates the acceptance run**: every off-the-shelf skill lacks the block; a teammate's first share crashes | none — still crashes (verified on `d294401`) | refuse (option 1) | 1 h refuse · 3 h ask |
| R2 | `publish`'s `-2` vet, its data-losing message, and the lease it should seed | Publish correctness before the first real publish; the message tells a user to delete a colleague's branch | vet in place; `branchLeases` NOT landed | keep the vet + seed the lease + reword | 2 h |
| R3 | A stolen target lock: honest error, rare wrong error, or silence | Install/sync/uninstall can still be killed by a library timer if a lock is stolen | none | option 1, the costliest | 4 h (opt 1) · 1.5 h (opt 2) |
| R4 | Every `sync` takes the §8 team mutex, or `team leave` races an interactive sync | A departed team can leave a live ledger row | none | option 1 | 1.5 h |
| R5 | `place()` when the swap landed but the old copy could not be removed | The tool reports a successful install as a failure, then quarantines its own copy | none (message false in that case) | option 1 | 2 h |
| R6 | `reconcileShared`'s undone work withholds the hourly stamp | A diverged shared skill is silenced for an hour | none | option 1 | 2 h |
| R7 | What `run/<team>.stamp` means | Already ruled once (Terum decision 2026-09-06); confirm or split | option 1 applied (spec-literal) | keep option 1 | 0 (confirm) |
| R8 | `setup` on a machine whose team clone is gone: re-clone, or fail fast | Wizard's promise vs. no network in a resumed step | option 2 applied (fail fast, names `team join`) | option 1 | 1.5 h (opt 1) · 0 (keep) |
| R9 | `setup`'s clone guard shares `team join`'s definition of "a complete clone" | A folder with `team.json` but no `.git` passes setup today | none | option 1 | 2 h (opt 1) · 0.5 h (opt 2) |
| R10 | The one-git-per-skill fan-out family: search, ls, the README path, the push guard | Scope call; nothing wrong for small teams | search + guard bounded to eight; ls unbounded; README serial | option 1 (shared helper) | 4 h (opt 1) · 0 (keep) |
| R11 | `ls` dies whole on one leftover folder | Same trigger as search's ghost test; three lines | none | option 1 | 0.5 h |
| R12 | Should `search` list a folder that is on disk but not in the team repo? | Product call; the phase-2 UI needs a machine-readable answer | row shown with `—` | option 1 (keep + flag) | 0.5 h |
| R13 | Patch the vendored fingerprint file for the same collision class as `canonicalDigest`? | Divergence-from-upstream policy; needs a crafted filename to matter | in-repo half applied; vendored half not | (no loop recommendation — Ryan's half) | 1 h (patch) · 0 (leave) |
| R14 | May repo text render as a clickable Markdown link in the generated README? | Product call; five lines if "no" | Skill cell escaped (`[]` and `<>`) | option 1 (escape everywhere) | 0.5 h |

**Suggested grouping for the build after the walk:** R1 + R2 + R3 as the first branch (they gate the acceptance run and the first publish; one Astra full pass + one confirmation); everything else LOCKED as a second branch, or riding the first if small. Total for the loop's recommended set: about 23 h of build across both branches; about 15 h if R3, R8 and R10 take their cheaper option.

---

## A. Blockers for the acceptance run and the first publish

### R1 — A SKILL.md with no `metadata:` block crashes `share`: refuse the skill, or ask for its category?

**Plain English — decide from this alone**
- **What's at stake:** every skill people already have (the off-the-shelf Claude ones) has no Terum `metadata:` block. Today `share` crashes on it with a message from the YAML library (`Expected YAML collection at metadata. Remaining path: id` — verified on `main` at `d294401`), and because the setup wizard's first step is a share, a brand-new teammate's very first run dead-ends. This is the first thing the acceptance run will hit.
- **Why it's a fork:** the crash itself is a one-line library fix nobody disputes, and it is needed either way. The question the code cannot settle is what happens next when the skill still has no `terum-category`: should the tool **refuse** and tell the author exactly which line to add, or **ask** them to pick a category from the team's list right there?
- **Options:**
  - **1 — Refuse, and name the missing line** *(Depth 3 / Cost 1)*: fix the library call; `share` checks for `metadata.terum-category` up front and says "add `metadata.terum-category: <one of: …>` to SKILL.md". Smaller; keeps the shared repo clean; matches the spec's description of share (injects exactly three fields, shows exactly three lines before the y/N). *The difference that decides:* an author hand-writes one line of Terum frontmatter once before sharing.
  - **2 — Ask for the category** *(Depth 3 / Cost 2, estimate)*: same library fix, then a prompt in `share` listing the team's categories; the wizard finishes on any folder. *The difference that decides:* "point it at any skill folder and it just works" becomes the promise, at the cost of a new prompt in share and in the wizard's first-skill step.
- **Loop's recommendation:** refuse for now — strictly smaller, a prerequisite of asking anyway, converts a crash into a directive error without committing the product to a new prompt.
- **North Star check:** for the acceptance run, "refuse" means the teammate edits one line and retries; that is a documented rough edge, not a blocker, provided the message is exact. If the acceptance run is meant to test the *no-hand-editing* onboarding story, ask is the only option that tests it.

**Technical**
- `src/lib/skills.ts` `injectManagedFields` — `document.set('metadata', {})` must become `document.set('metadata', document.createNode({}))` so the following `setIn` calls see a real YAML map (the closed-out `.planning/harden/phase1-harden.md` and `phase1-harden.hybrid.r1.review.md` line 866 give the verified edit); `src/commands/share.ts` `inspectSource` gains the category requirement (option 1) or a prompt (option 2); tests in `skills.test.ts` (no metadata, bare `metadata:`, scalar metadata) and `share.test.ts`.
- **Why the library fix was not applied alone:** by itself it lets a category-less SKILL.md into the team repo, where the strict frontmatter schema then rejects it and every later sync reports it missing. The fix and the policy ship together.
- Ledger: `.planning/debug/harden/phase1-harden.deferred.md` (fork 2). Report: `phase1-harden.hybrid.r1.review.md` lines 865–867.

### R2 — `publish`'s `-2` vet: keep the up-front check, fix its message, and seed the lease

**Plain English**
- **What's at stake:** when a publish's push loses a race it retries onto a fallback branch named `publish/<name>-2`. To keep that fallback from overwriting somebody else's branch, `publish` now vets both names before it starts. Two consequences: (1) if a teammate has an open PR for a skill that is literally named `<name>-2`, publishing `<name>` is refused — and the refusal tells the user to **delete the teammate's branch**, which would close their PR; (2) the vet and the push are two separate moments, so a branch that appears in between can still be force-overwritten (the review's "seed the lease" medium; `branchLeases` is **not** on `main`).
- **Why it's a fork:** the review panel split 1–2 on whether the refusal is a defect at all (refusing beats silently deleting). The message is wrong under every reading. The lease seeding is undisputed but was held back with this ruling.
- **Options:**
  - **A — Keep the up-front vet, seed the lease from it, and reword** *(Depth 4 / Cost 1)*: the vet returns the sha it saw, the push uses that as its lease (`branchLeases` on `SafeWriteOptions`), so a branch nobody approved can never be overwritten; the refusal names the *sibling PR* and never suggests deleting anything. *The difference that decides:* the rare `sample` / `sample-2` sibling pair still cannot publish concurrently, but nothing is ever lost.
  - **B — Vet the `-2` only when the push actually retargets to it** *(Depth 3 / Cost 2)*: move the fallback's vet inside the push loop as a per-target predicate, plus the same lease seeding. *The difference that decides:* the sibling pair publishes independently, at the cost of a publish-semantics seam inside the repo layer and a vet that runs while holding the writer lock.
- **Recommendation:** A. It closes the data-loss window for both branch names, and the sibling-pair refusal is a documented rough edge.

**Technical**
- `src/commands/publish.ts` line 53 (`assertBranchesReusable` over `[destination, destination-2]`), `src/lib/teamRepo.ts` `push()` lease map (line ~103 / 198) — add `branchLeases?: ReadonlyMap<string,string>` and seed from the vet; rewrite the doc block that claims the caller-side vet discharges the invariant (it does not). Race test mirroring `teamRepo.test.ts:304-333`.
- Report: `phase1-harden.hybrid.r2.review.md` lines 71–81 (the contested high) and 320–331 (the lease medium, options with depth/cost).

### R3 — A stolen target lock: honest error, rarely-wrong error, or silence?

**Plain English**
- **What's at stake:** `install`, `sync` and `uninstall` each lock the folder they are about to change. The lock library can decide a lock was *stolen* (another process reclaimed it as stale). The borrowed lock code has no handler for that, so the library's background timer can throw and kill the CLI mid-command. All three options stop the crash. They differ in what the user is told when it happens.
- **Why it's a fork:** churn versus honesty. The full fix rewrites how three commands take the lock, right before 0.1.0. The cheap fix stays inside one borrowed file but, on the rare occasion the command *also* failed for a real reason, reports "lost the lock" instead of that reason — a shape this codebase already ruled a serious bug twice and fixed. The cheapest fix hides the theft entirely: a user can be told an install succeeded on a folder another process owned.
- **Options:**
  - **1 — A `withTargetLock` wrapper, mirroring the clone lock** *(Depth 3 / Cost 2)*: the lock reports theft only after the body succeeded, so the real error always wins; install, sync, uninstall converted; tests that actually drive the theft. *Decides:* always the true cause; three commands edited.
  - **2 — Contain it in the borrowed file** *(Depth 2 / Cost 1)*: record the theft and throw from `release()`. *Decides:* zero command churn; a wrong message when theft and a real failure coincide.
  - **3 — Suppress, as the clone lock once did** *(Depth 1 / Cost 0)*: silent. *Decides:* two tokens; a silent lost update.
- **Loop's recommendation:** option 1 — the **costlier** one. Restated cost: about half a day and three command files touched before ship; option 2 is the ship-now compromise with a documented rare wrong message.
- **North Star check:** silence (option 3) can lose an install to another process without a word — that is the "loses data" exception, so it is out. Between 1 and 2 the North Star says 2 unless the wrong-message case is judged likely; theft needs a hung first process and a second one reclaiming a stale lock.

**Technical**
- `src/lib/placer/vendor/skillhub/skill-target-lock.ts` lines 21–31 (`onCompromised`, compromise-aware handle with `.catch` on release — required, since a compromised lock's release rejects ERELEASED); `src/lib/placer.ts` `withTargetLock` beside `lockTarget`, shaped like `withCloneLock` (`teamRepo.ts` ~352); call sites `install.ts`, `sync.ts`, `uninstall.ts`; `placer.test.ts:78-91` stops swallowing the displaced holder's release.
- Ledger: `phase1-harden.deferred.md` (fork 1). Report: `phase1-harden.hybrid.r1.review.md` lines 853–856.

## B. Data-integrity tails from M4 and the close-out

### R4 — Every `sync` takes the §8 team mutex, or `team leave` can race an interactive sync

**Plain English**
- **What's at stake:** `team leave` removes the team's placed skills. Today its mutex keeps only *background hook* syncs out. A `terum-skills sync` typed in another terminal can put a folder back seconds after leave removed it, leaving a ledger row that points at a team you are no longer in.
- **Why it's a fork:** the fix changes what an ordinary sync does when another sync is already running on the same team (it skips that team with a printed reason — the way it already behaves when another process holds the clone's writer lock). That is a behaviour change the last review panel did not see.
- **Options:** **1** every sync takes the team mutex, the hourly *stamp* stays hook-only, one spec §8 sentence *(recommended; ~1.5 h)* · **2** leave re-sweeps placements after the clone lock (self-healing; a resurrected folder can still remain on disk) · **3** accept the race for 0.1.0 and narrow the comment.
- **North Star check:** a live ledger row for a departed team is a documented rough edge only if it cannot delete anything; it points at a folder, and the next sync would treat it as that team's placement. Option 1 is cheap enough to just take.

**Technical:** `src/commands/leave.ts:42`, `src/commands/sync.ts` (the mutex acquisition currently gated on `--hook`), one `hook-mutex` test. Ledger: `m4-ship.deferred.md` (round 3). Report: `m4-ship.hybrid.r3.review.md`.

### R5 — `place()` when the new copy landed but the old one could not be removed

**Plain English**
- **What's at stake:** replacing a placed skill is: move the old copy aside, move the new one in, delete the old one. If only that last delete fails (a file open in an editor on Windows, a read-only subfolder), the new copy *is* correctly in place — but the tool throws, says the previous copy "could not be restored" (false), install exits non-zero with no ledger entry, and the next sync sees the tool's own fresh copy as a user edit and moves it to quarantine.
- **Why it's a fork:** the truthful fix changes `place()`'s contract: that case returns success with a warning line instead of throwing. Both callers already print such warnings (they do for a failed exclude write), so no new plumbing — but it is a control-flow change after the last panel.
- **Options:** **1** return the placement with a notice; quarantine the old copy; keep the throw only for a genuinely failed swap *(recommended; Depth 3 / Cost 1)* · **2** keep the throw, re-stamp the ledger from the callers *(Depth 1 / Cost 2; still reports a success as a failure)* · **3** fix the wording only *(Depth 0 / Cost 0)*.
- **North Star check:** option 1 — the ledger then records what is actually on disk; the alternative quarantines the user's correct copy on the next sync, which reads as data going missing even though it is recoverable.

**Technical:** `src/lib/placer.ts` lines ~67–69 and 82–83 (`displacedExists` cleared after the second rename; a `discardDisplaced` helper; the existing `result.notices` channel); `placer.test.ts:164` flips from a rejection to a resolved placement with the notice. Ledger: `phase1-closeout-r2.deferred.md` (round 2). Report: `phase1-closeout-r2.hybrid.r2.review.md`, Clear #2.

### R6 — `reconcileShared`'s undone work withholds the hourly stamp

**Plain English**
- **What's at stake:** the hourly stamp now means "this team completed a full sync" (R7). The placement loop honours that: blocked work withholds the stamp. The *shared-skill* loop does not: a shared skill that has diverged from its author's folder prints its remedy once, then the stamp silences it for an hour, and the hook's "N skills need review" line does not count it.
- **Options:** **1** hand `reconcileShared` the run's deferral recorder so its eight report-and-continue exits withhold the stamp and count toward the review line *(recommended; ~2 h)* · **2** return the unresolved team set and mark the team incomplete without touching the review count · **3** one team-attributed report channel for the whole run (forces the question of whether one teammate's malformed SKILL.md should withhold everyone's stamp).
- **North Star check:** option 1; it is the same rule R7 already locked, applied to the half of sync that missed it.

**Technical:** `src/commands/sync.ts:48` (`blocked()` / `defer()` helpers), `src/commands/share.ts` `reconcileShared`'s exits. Ledger: `m4-ship.deferred.md` (round 3).

### R7 — What `run/<team>.stamp` means (confirm)

**Plain English**
- **Already ruled** (Terum decision, Ryan, 2026-09-06): the stamp means the team completed a full sync; undone work prevents stamping so the next hook run retries. That is option 1, applied. The alternative — a second, completion-only marker so "clone refreshed" and "fully synced" stop sharing one file — costs about 15 lines and one more `run/` artifact. One consequence to confirm you accept: a team with human-only undone work fetches at every session start and `search` says "may be stale" until an interactive sync clears the item.
- **Recommendation:** confirm; take the split only if the "may be stale" nag on a team with a permanent deferral turns out to annoy.

**Technical:** `src/commands/sync.ts` stamp loop, `src/lib/hook.ts` `stampIsFresh`. Ledger: `m4-ship.deferred.md` (round 1). Report: `m4-ship.hybrid.r1.review.md` lines 718–720.

## C. Setup

### R8 — `setup` on a machine whose team clone is gone: re-clone, or fail fast?

**Plain English**
- **What's at stake:** setup's banner says "re-run it any time; finished steps are skipped". If the team folder has been deleted, the interim (applied) makes setup stop with "your team folder is missing — run `team join <remote>` to restore it". The alternative is for setup to quietly re-download the folder itself and carry on.
- **Why it's a fork:** re-cloning is network work inside a step the wizard calls "skipped", and it must also restore the git name/email the clone needs for later writes. Failing fast is honest and revert-safe but costs the user a second command.
- **Options:** **1** self-heal: re-clone and restore identity *(loop's recommendation; Depth 3 / Cost 1)* · **2** keep the interim: fail fast with the hint *(Cost 0)* · **3** route the repair through `team join` (re-asks the identity questions).
- **North Star check:** GATE on 2 — a one-command repair hint is a documented rough edge; flip to 1 if a real user hits it during the acceptance run or reports it.

**Technical:** `src/commands/setup.ts` ~lines 122–136; `ensureClone` / `requireGitConfig` in `team.ts` would need exporting. Ledger: `phase1-closeout.deferred.md`. Report: `phase1-closeout.hybrid.r1.review.md` lines 569–572.

### R9 — `setup`'s clone guard should share `team join`'s definition of "a complete clone"

**Plain English**
- **What's at stake:** setup decides "is the team folder complete?" with two file checks. `team join` decides the same thing with two file checks *plus* two git checks (is it a git repo at all; does it point at the right remote). So a folder that still has `team.json` but lost its `.git` (an interrupted `team leave`, a backup restore that skipped dotfiles), or a clone of the wrong remote, passes setup — which then prompts for a share, an invite and the hook, prints the roster and exits ok — and every later command fails.
- **Options:** **1** one shared `describeClone` predicate (absent / incomplete / foreign / ok) consumed by both `team join` and setup *(recommended; Depth 4 / Cost 1; two setup tests)* · **2** inline the two git checks into setup's guard only *(Cost 0; two hand-written copies that can drift again)*.
- **North Star check:** either closes the hole; 1 is the one the next person cannot break by editing one copy. Take 1 if R8 stays on fail-fast (both branches of R8 need this decision made the same way).

**Technical:** `src/commands/setup.ts:132-136`, `src/commands/team.ts:384-391` (`ensureClone`), `src/lib/teamRepo.ts:331` (`cloneOrigin`, already exported). Ledger: `phase1-closeout-r2.deferred.md` (round 2). Report: `phase1-closeout-r2.hybrid.r2.review.md`, Clear #5.

## D. The fan-out family, and what `search` should show

### R10 — One git child per skill: search, ls, the README path, and the push guard

**Plain English**
- **What's at stake:** four places resolve "the latest version of each skill" by asking git once per skill. Search and the push guard now do it eight at a time (interims applied); `ls` does it all at once; the README path does it one after another. On a team with a few dozen skills nothing is wrong. On a team with several hundred, `ls` and `search` get slow and the push guard sits on git's blocking pre-push path.
- **Why it's a fork:** the proper fix — one `git ls-tree` per clone through a shared helper, adopted at all four sites — touches code three commands and the GitHub Action depend on, and changes how the Action reacts to a broken checkout. A shared "at most eight at once" helper is ten lines per site and keeps N git processes. Leaving the interims costs nothing today.
- **Options:** **1** shared `latestTrees` helper (one `ls-tree` per clone) at search, ls, README *(loop's recommendation; Depth 4 / Cost 2)* · **2** shared bounded map, sweep ls and search *(~10 lines each)* · **3** keep the interims.
- **North Star check:** GATE on 3 — tripwire: the first team past about a hundred skills, or the acceptance run reporting a slow `ls`. Note R11 and R12 are independent of this call.

**Technical:** `src/commands/search.ts:44-45`, `src/commands/ls.ts:41-46`, `src/lib/readme.ts:129-136`, `src/commands/guardPush.ts:110` (`treeBetween`); `teamRepo.ts` `skillTrees` is the parser to lift. Ledgers: `phase1-closeout-r2.deferred.md` (round 1 fork), `m4-ship.deferred.md` (round 3 fork).

### R11 — `ls` dies whole on one leftover folder

**Plain English**
- **What's at stake:** a folder left in the clone by an interrupted write (real: a safeWrite that lost its lock skips its cleanup, and `reset --hard` never removes an untracked folder) makes `ls` print nothing at all — no roster, no skills — while `search` shows that one row with a dash and a reason line.
- **Options:** **1** the same three-line per-row treatment in `ls` *(recommended; deletable under any R10 outcome)* · **2** mirror search's eight-at-a-time loop in ls · **3** = R10 option 1.
- **North Star check:** LOCK 1; it is the cheapest item in the batch and it removes a "the tool shows nothing" failure a teammate could hit.

**Technical:** `src/commands/ls.ts:45` (`.catch` on the one `latestTree` await, printing `<name>: <reason>` and rendering `—`), one `ls.test.ts` case mirroring `search.test.ts`'s ghost test. Report: `phase1-closeout-r2.hybrid.r2.review.md`, Clear #4.

### R12 — Should `search` list a folder that is on disk but not committed to the team repo?

**Plain English**
- **What's at stake:** such a folder is shown today as a normal row with a dash for its version, and `install team/<name>` of it succeeds off the clone's disk with team provenance — though nobody else has it. The malformed-folder case four lines away is hidden, so the two kinds of junk are treated oppositely, and the phase-2 web UI has no way to tell the row apart except by the dash string.
- **Why it's a fork:** the code cannot tell "not committed" from "git itself would not run" — both reject the same way. Hiding the row therefore also hides every real skill on a machine where git is broken, and the user sees "No skills found".
- **Options:** **1** keep the row, add `unresolved: boolean` to the hit so the UI can grey out Install *(recommended; Depth 2 / Cost 0)* · **2** hide it like the malformed folder *(Depth 3 / Cost 1; false negatives when git is broken)* · **3** teach the helper to distinguish the two causes and hide only the truly uncommitted folder *(Depth 4 / Cost 2; do it with R10 option 1 if 2's rule is wanted)*.
- **North Star check:** LOCK 1 for 0.1.0; revisit with R10.

**Technical:** `src/commands/search.ts:12` (`SearchHit`), `:51`; `search.test.ts` ghost test asserts the flag. Ledger: `phase1-closeout-r2.deferred.md` (round 2 fork).

## E. Policy calls

### R13 — Patch the borrowed fingerprint file for the same collision class as `canonicalDigest`?

**Plain English**
- **What's at stake:** two different lists of files could in theory produce the same fingerprint if a filename contains a colon or a newline. The in-repo digest (what `share` compares) was fixed. The same record format lives in a file borrowed from skillhub, where it guards the check that catches a hand-edited installed copy: a colliding fingerprint there would make an edited copy look untouched and skip quarantine. It takes a deliberately crafted filename.
- **Why it's a fork:** patching the borrowed file pushes it further from upstream (it already carries one documented change) and means updating its header, the NOTICE and the spec sentence that calls it verbatim. That is a policy about how much the borrowed code may diverge, not a code question.
- **Options:** **1** apply the same encoding to the vendored aggregate; update header, NOTICE, spec *(Depth 3 / Cost 1)* · **2** leave it; document the crafted-filename caveat.
- **North Star check:** DEFER on 2 — tripwire: the next re-vendor from skillhub, or any real report of a fingerprint mismatch.

**Technical:** `src/lib/placer/vendor/skillhub/skill-fingerprint.ts:24`, spec §7 line ~358 and default 43. Ledger: `phase1-closeout.deferred.md`. Report: `phase1-closeout.hybrid.r1.review.md` lines 575–578.

### R14 — May text committed to a team repo render as a clickable link in the generated README?

**Plain English**
- **What's at stake:** the README the tool generates (and the Action's PR comment) prints skill names, descriptions, categories and authors straight from the repo. A teammate — or anyone whose PR is merged — could write a description that renders as a link labelled "Install v2" pointing anywhere. The Skill-name cell is already defanged (interim); the free-text columns still render Markdown.
- **Why it's a fork:** if the answer is "no link whose label can lie, anywhere the CLI writes Markdown", it is five lines and normal text looks identical. If someone may legitimately want `see [our docs](…)` in a description, leave it.
- **Options:** **1** escape `[` and `]` as the last step of both sanitizers — every cell, both headings, the roster line and the PR comment *(recommended; ~5 lines; a bare URL still auto-links, only the misleading label dies)* · **2** render a refused folder name in a code span *(inert, single cell)* · **3** keep the interim.
- **North Star check:** LOCK 1 — the "takes over someone's identity" exception is adjacent (a labelled link in a trusted team README is a phishing vector), and the cost is negligible.

**Technical:** `src/lib/readme.ts` `inlineText()` / `cell()` (escape must run after the backslash doubling — the report ran both orderings), `src/commands/readme.ts:28`. Ledger: `phase1-closeout.deferred.md`. Report: `phase1-closeout.hybrid.r1.review.md` lines 581–584.

---

## F. Declined by the loop with a reason — no ruling needed unless you overrule one

Each is settled in its ledger; delete the entry there to re-raise it in the next review.
- `installPushGuard` pins `core.hooksPath` to the clone, hiding a machine-wide hooks directory *in the tool's own clone only* — declined: a global hooksPath would otherwise silently disable the D12 guard; chaining to the global directory is a later enhancement. (`m4-ship.deferred.md`)
- The ~3.75 s contended-lock backoff per lock test — declined: it is the real retry budget on the real contended path; shortening it for tests needs a knob threaded through three commands for ~7 s per full run. (`phase1-harden.deferred.md`)
- `place()`'s `quarantineRoot` stays optional — declined: making it required edits 14 test call sites; both production callers pass it; the misreport half is fixed. (`phase1-closeout-r2.deferred.md`)
- The duplicate staging-folder `rm` in `place()` — declined as harmless; note R5's fix touches the same lines. (`phase1-closeout-r2.deferred.md`)
- Sync's no-op fast path reads config once more per placement — declined: the read is needed for the rename re-key; one lstat plus one small JSON parse. (`phase1-closeout.deferred.md`)
- Four test-quality items from M4 round 3 (one applied, three test-only tidies for the next sweep). (`m4-ship.deferred.md`)

## G. Register items closed while assembling this batch

From `.planning/reviews/DEFERRED-2026-09-04-phase1-landing.md`:
- **H (housekeeping)** — checked on `d294401`: the merged `skill-target-lock.ts` header reads `modified: yes` and the lock directory is `terum-skills-target-locks-<uid>`. Closed.
- **D (unreviewed merges)** — superseded: the whole-phase Astra pass over `phase1-harden` (PR #6) reviewed every file those merges touched. Closed.
- **C (M3 residuals)** — two doc lines remain: "org base permissions can still grant read" is undocumented for `team remove`, and the invite block's wording predates `setup`. Not a ruling; a five-minute docs commit on the fix branch.
- **E (scope)** — everything built except the Windows pass (parked, needs a Windows machine) and the acceptance run (D8, after R1).
