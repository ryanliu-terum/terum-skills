---
title: phase-1 hardening rulings decision walk
date: 2026-09-06
north_star: fastest path to a shippable 0.1.0; a documented rough edge is acceptable unless it loses data, takes over someone's identity, or leaks a token
status: complete
deferred:
  - what: (R10) one git call per clone through a shared latestTrees helper at search, ls, the README path and the push guard, replacing the eight-at-a-time interims and ls's unbounded fan-out
    gate: the first team past about a hundred skills, or the acceptance run reporting a slow ls
  - what: (R12) distinguishing "not committed" from "git would not run" in the latest-tree helper so search can hide only the truly uncommitted folder
    gate: rides R10's helper when its gate trips
  - what: (R13) applying the prefix-free record encoding to the vendored skill-fingerprint aggregate as well as the in-repo digest
    gate: the next re-vendor from skillhub, or any real report of a fingerprint mismatch
  - what: (R7) a second, completion-only stamp marker so "clone refreshed" and "fully synced" stop sharing one file
    gate: the "may be stale" line on a team with a permanent deferral proves annoying in practice
---

# Phase-1 hardening rulings — Decision Walk

**North Star:** fastest path to a shippable 0.1.0. A documented rough edge is acceptable unless it loses data, takes over someone's identity, or leaks a token. Ratified by Ryan 2026-09-06, unchanged from the 2026-09-04 and 2026-09-05 walks.

**Batch source:** `.planning/decisions/2026-09-06-phase1-rulings-batch.md` — the fourteen rulings left for Ryan after PRs #3–#9 landed on `main` (`d294401`), assembled from the four harden ledgers, their reports and the PR bodies. R-numbers below match the batch.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| R1 | A skill with no Terum metadata block crashes `share` | LOCK | Fix the crash and auto-generate all four fields; a missing category defaults to `misc` and is shown as a fourth line before the y/N. No prompt, no hand-editing; the wizard and the acceptance run finish in one go | — |
| R2 | `publish`'s spare-branch vet, its message, and the lease | LOCK | One fresh branch and one fresh PR per publish, pushed create-only; a y/N note when another open PR endorses the same skill; GitHub's own conflict badge does the rest. Deletes the vet, the lease and the spare-name retry. Lifts D2's gate from the 2026-09-05 walk | — |
| R3 | A stolen target lock | LOCK | Record the theft inside the borrowed lock file and report it when the lock is released, so the CLI never dies from the library's timer; widen the expiry from 10 s to 60 s to match the clone lock so a nap is not a death. The rare double-failure message is accepted as permanent | — |
| R4 | Every `sync` takes the §8 team mutex | LOCK | Hook and interactive syncs alike take the per-team lock; a second concurrent sync prints a reason and skips the team, so `team leave` can never overlap a typed sync. Only the hourly shortcut stays hook-only | — |
| R5 | `place()` when the swap landed but cleanup failed | LOCK | Once the new copy is in, a failed delete of the old copy quarantines it and returns success with a warning naming the quarantine path; the throw stays only for a genuinely failed swap. Ledger matches disk, install exits zero, no phantom quarantine on the next sync | — |
| R6 | `reconcileShared` withholds the stamp | LOCK | Hand the shared-skill reconciler the run's deferral recorder so its report-and-continue exits withhold the team's stamp and count toward the hook's review line, the same rule the placement loop already follows | — |
| R7 | What the hourly stamp means | LOCK | Confirmed as ruled on 2026-09-06 and applied: the stamp means the team completed a full sync; undone work withholds it. The accepted consequence is a fetch every session start and a "may be stale" line until a human clears the item | — |
| R8 | `setup` on a missing clone | LOCK | Self-heal: a resumed setup re-clones a missing team folder from the remote on file and restores the git identity, so one run fixes the machine as the banner promises. Ryan's pick over the gated fail-fast interim | — |
| R9 | `setup`'s clone guard shares `describeClone` | LOCK | One exported predicate (absent / incomplete / wrong remote / ok) consumed by both `team join` and setup, so a folder with `team.json` but no `.git`, or a clone of the wrong remote, is refused the same way everywhere | — |
| R10 | The one-git-per-skill fan-out family | GATE | Keep the interims (search and the push guard eight at a time; ls unbounded; README serial); the shared one-call-per-clone helper waits | first team past ~100 skills, or a slow `ls` in the acceptance run |
| R11 | `ls` dies whole on one leftover folder | LOCK | The same per-row treatment search has: one dash, one reason line, every other row intact. Three lines, deletable under any R10 outcome | — |
| R12 | Should `search` list an uncommitted folder | LOCK | Keep the row and add an `unresolved` flag to the hit so the phase-2 UI can grey out Install; hiding it would also hide every real skill on a machine where git will not run | revisit with R10 |
| R13 | Patch the vendored fingerprint file | DEFER | Leave the borrowed skillhub file as it is and document the crafted-filename caveat; the same collision class was closed in the in-repo digest, and pushing the borrowed file further from upstream is a policy cost with no real report behind it | next re-vendor from skillhub, or a real fingerprint-mismatch report |
| R14 | Repo text rendering as a Markdown link | LOCK | No: escape the link brackets as the last step of both sanitizers, so no cell, heading, roster line or PR comment can render a link whose label lies; normal text is pixel-identical and a bare URL still auto-links | — |

---

## Decision R1 — A skill with no Terum metadata block crashes `share`

**Verdict: LOCK** — auto-generate all four fields; a missing `terum-category` defaults to `misc`.

### Plain English
- **What's at stake:** every off-the-shelf skill has no Terum metadata block. `share` crashes on it (verified on `d294401`: `Expected YAML collection at metadata. Remaining path: id`), and because the setup wizard's first-skill step is a share and a failed share ends the wizard (`setup.ts:151`), a new teammate's first run dead-ends before the invite and hook steps. First thing the acceptance run would hit.
- **Why it's a fork:** the crash is a one-line library fix. The batch framed the remainder as refuse-versus-ask for the one human-supplied field, `terum-category`. Ryan asked why share needs the category at all, and why the tool does not simply generate the metadata. Answer from the code and spec: the block exists because Claude Code packaging forbids custom top-level keys, so Terum's fields must nest under `metadata`; the tool already generates three of the four (`id` — the skill's identity across renames; `author` — the ownership rule the push guard enforces; `license` — from team policy) at share time, in place, shown before a y/N; only the category was left to a human because the spec treated it as a judgement. Nothing technical requires that, and the team's starter category list already contains `misc`.
- **Options:**
  - **A — Auto-generate all four; category defaults to `misc` when absent, shown as a fourth line before the y/N.** *(decides: no prompt, no editing; uncategorised skills land in the bucket that exists for them; ~1 h + one spec sentence)*
  - **B — Ask for the category from the team's list inside share.** *(decides: every skill deliberately categorised, at the cost of a prompt in share and in the wizard; ~3 h)*
  - **C — Refuse and name the exact line; the wizard prints it, skips the step, and still runs invite and hook.** *(decides: the author edits one line once; ~1.5 h)*
- **Recommendation:** A — cheapest, removes the rough edge rather than documenting it, and `search` still matches on name and description so a `misc` skill stays findable.
- **Zoom-out:** the refuse-versus-ask framing assumed the category must come from a human. With a default it need not, and the North Star says take the shorter path when nothing is lost or exposed. Why not stamp every folder at setup instead: the spec's consent rule — the tool never writes into a user's file without showing the change and taking a y/N — so share time, not init time, is where the block is written.
- **The call:** A. Ryan, after the reframing: "auto-generate all four, misc default".

### Technical
- **Files / code paths:** `src/lib/skills.ts` `injectManagedFields` — `document.set('metadata', {})` → `document.set('metadata', document.createNode({}))` so the following `setIn` calls see a real YAML map; the same function (or `share.ts`'s inject call) writes `terum-category: misc` when the key is absent; `src/commands/share.ts` shows four lines before the y/N when the category was defaulted; spec `.planning/specs/2026-09-02-phase-1-build.md` line ~180 ("shows the three added lines") gains one sentence. Tests: `skills.test.ts` (no metadata, bare `metadata:`, scalar metadata, category present vs defaulted — an existing category is never overwritten), `share.test.ts` (a name/description-only source shares and lands with `misc`), a setup walkthrough on an off-the-shelf skill.
- **Migration / schema:** none. `skillFrontmatterSchema` keeps `terum-category` required and strict; the default satisfies it. The category is ordinary content, not a managed field: it is written once at share time, is included in the canonical digest on both sides, and a later edit reconciles like any other change.
- **Effort / risk / blast radius:** ~1 h. Six `injectManagedFields` call sites in `share.ts` all become total. Consumers of the category (`search`, `ls`, README, `publish`'s printout) need no change.
- **Grounding findings:** crash reproduced against `d294401`'s `yaml` dependency; `setup.ts:151` returns `failed()` on a share error; `schema.ts:111` requires `terum-category`; `team.ts:480` seeds categories `debugging, testing, docs, workflow, research, infra, misc`; `share.ts` `inspectSource` never checks the category today, so a block without one would have pushed and then been rejected by every reader.

---

## Decision R2 — `publish`'s spare-branch vet, its message, and the lease

**Verdict: LOCK** — option C: one fresh branch and one fresh PR per publish; never push to an existing branch. Lifts the GATE on D2 of `2026-09-05-phase1-closeout-decision-walk.md` (its option C, one branch per endorsement).

### Plain English
- **What's at stake:** `publish` pushes a branch named after the skill and opens a PR from it. To survive two people pushing at once it force-pushes under a guard ("only if the branch is as I last saw it") and retries once onto a spare name, `publish/<name>-2`. Two flaws: the guard's snapshot is read inside the write, after a fresh fetch, not from the check that approved the push, so a branch that appears in between can be overwritten (the fix, `branchLeases`, never landed); and the refusal text tells the user to delete whichever branch tripped it, which for the spare name can be a teammate's open PR. That is the North Star's data-loss exception.
- **Why it's a fork:** the panel split 1–2 on whether refusing the rare `x` / `x-2` sibling pair is a defect; nobody disputed the message or the unseeded guard. Ryan asked why the tool does not simply open a PR and let GitHub flag conflicting PRs. Answer: it can — a PR lives on a branch, one PR per branch, and the PR follows the branch, so a fresh branch per publish is a fresh PR per publish, and never pushing to an existing branch is what keeps every existing PR untouched.
- **Options:**
  - **C — Fresh branch + fresh PR per publish.** Unique name (`publish/<name>-<handle>-<id8>`), create-only push, new PR every time; before pushing, a y/N note lists other open endorsement PRs (branches, on gh-less remotes) for the same skill; two competing PRs are two PRs and GitHub's conflict badge marks the loser once the first merges. Deletes the vet, the lease map and the spare-name retry; `team create` turns on delete-branch-on-merge. *(decides: no force-push on branches ever, so the hole cannot exist; more branches/PRs; a retry while your own PR is open points at it instead of refreshing it; ~3 h)*
  - **A — Keep the up-front vet of both names, seed the lease from it, fix the message.** *(decides: rare sibling pair still waits; nothing lost; ~2 h)*
  - **B — Vet the spare only at retarget time, plus the same seeding.** *(decides: sibling pair publishes independently; a publish rule inside the shared write layer; ~3 h)*
- **Recommendation:** C — the only option that removes the data-loss surface rather than patching it; smaller code; git and GitHub used as designed.
- **Zoom-out:** D2's gate assumed keeping the current mechanism was free; it is not (it needs A or B and keeps a force-push path). The premise changed, so lifting the gate early is consistent with the North Star. One extra hour over A buys the least to review.
- **The call:** C. Ryan: "fresh branch + fresh PR per publish".

### Technical
- **Files / code paths:** `src/commands/publish.ts` line 50 (branch name), 53 and 159–200 (delete `assertBranchesReusable` / `isExactlyThisEndorsement`; add the pre-flight `git ls-remote --heads origin 'refs/heads/publish/<name>-*'` and `gh pr list --head` when gh is present, then the y/N); `src/lib/teamRepo.ts` `push()` 197–216 — a non-main branch is pushed once with `--force-with-lease=refs/heads/<target>:` (empty expect = must not exist); the lease map and the `-2` loop go; the doc block at 186–196 rewritten. `src/commands/team.ts` create: `gh repo edit --delete-branch-on-merge` (skipped on file remotes). The Action trigger (`team.ts:533`, `startsWith(head_ref, 'publish/')`) still matches.
- **Migration / schema:** none in config. Spec `.planning/specs/2026-09-05-m3-publish-leave.md` steps 8, 8a, 9 and the §6.0 lease sentence; `2026-09-02-phase-1-build.md` §6 `publish` line. D2 in the 2026-09-05 ledger: note the lift.
- **Effort / risk / blast radius:** ~3 h. Tests rewritten: `publish.test.ts` 114, 188, 249; `teamRepo.test.ts` 205, 306 → "a second writer's branch always survives; a duplicate name is refused; a re-run while a PR is open is noted, not refreshed". Only publish passes a branch to `safeWrite` (grep: `publish.ts:78`), so nothing else changes.
- **Grounding findings:** `branchLeases` absent on `d294401`; `push()` reads the lease lazily from `refs/remotes/origin/<target>` after its own fetch (206–208); the refusal at `publish.ts:173` offers `push --no-verify origin --delete <branch>` for both names; the Action trigger is a prefix match.

---

## Decision R3 — A stolen target lock: honest error, rarely-wrong error, or silence?

**Verdict: LOCK** — option 2 (contain it in the borrowed file) plus a 60-second stale window.

### Plain English
- **What's at stake:** `install`, `sync` and `uninstall` lock the skill folder they change, because the session-start hook makes concurrent folder changes the normal case and placing a skill is a multi-step sequence that must not interleave. The lock is a dead man's switch: the holder touches the file every 3 s, and after 10 s untouched another process may take it over. A laptop sleeping, a suspended process or a long copy on a slow disk all look like death. When the switch fires, the borrowed lock code has no handler, and the library's default throws from its refresh timer — the CLI dies mid-command with a stack trace.
- **Why it's a fork:** every option stops the crash; they differ only in what the user is told when a theft coincides with the command failing for its own reason. Ryan asked why the lock exists, why it can be taken while the holder is alive, and what other tools do. Answers: it exists because two processes really do change the same folder (hook + interactive); it expires because a lock file that never expires locks a folder forever after a crash; other tools either never expire and tell the human (git's `index.lock`), use OS-level locks that die with the process (Cargo, Homebrew — needs a native add-on in Node, wrong for an `npx` tool), or expire with a heartbeat and have the holder check before writing (npm/pnpm, distributed leases — and this codebase's own clone lock, which uses a 60 s window).
- **Options:**
  - **2 — Contain it in the borrowed file, and widen the window to 60 s.** The lock records the theft and reports it from `release()`; nothing outside that file changes; theft now needs a genuinely dead process. *(decides: in a double failure — a holder that hung a full minute, woke, then failed for another reason — the user sees "lost the lock" instead of the real error; after a real crash the folder reports busy for up to a minute; ~1.5 h)*
  - **1 — A `withTargetLock` wrapper mirroring `withCloneLock`, plus the 60 s window.** Theft reported only after the body finished, so a real failure always wins; install, sync, uninstall converted. *(decides: the true cause always; three command files before ship; ~4 h — the loop's recommendation)*
  - **3 — Suppress.** *(decides: an install can report success on a folder another process now owns — the North Star's data-loss exception; out)*
- **Recommendation:** 2 + 60 s. With the wider window the double failure is rare enough that the wrapper's only benefit — message precedence — is not worth two and a half more hours before ship.
- **Zoom-out:** first proposed as a GATE with the wrapper on the books; Ryan asked why a gate. A tripwire nobody will check is bookkeeping without value, and if the message imperfection ever matters it returns as a fresh review finding. LOCK.
- **The call:** 2 + 60 s window, as a LOCK.

### Technical
- **Files / code paths:** `src/lib/placer/vendor/skillhub/skill-target-lock.ts` lines 18–32: `stale: 60_000` (update stays the library default, half the window), `let compromised = false`, `onCompromised: () => { compromised = true }`, and the returned release becomes `async () => { await release().catch(() => undefined); if (compromised) throw targetBusyError(rootDir, slug) }` — the `.catch` is required because a compromised lock's release rejects with ERELEASED. Header note updated (the file is already `modified: yes`). `src/lib/__tests__/placer.test.ts` 78–91 stops swallowing the displaced holder's release and gains a theft test (remove the lock file, wait past the update tick, assert a `TargetBusyError`-shaped failure and no unhandled rejection); the stale-reclaim test's timing adjusts to the new window.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~1.5 h, one vendored file plus one test file; the three call sites (`install.ts:103`, `sync.ts:178`, `uninstall.ts:127`) keep their `try { … } finally { await release() }` shape and gain the non-zero Result for free.
- **Grounding findings:** `acquireSkillTargetLock` has no `onCompromised` (stale 10 s, update 3 s, retries 0); `withCloneLock` in `teamRepo.ts` is the in-repo model (records the compromise, 60 s window, `assertHeld`).

---

## Decision R4 — Every `sync` takes the §8 team mutex

**Verdict: LOCK** — option 1.

### Plain English
- **What's at stake:** `team leave` removes the team's placed skills and its clone under a per-team lock, so a background hook sync cannot run underneath it. A `sync` typed in another terminal does not take that lock: it can re-place a folder seconds after leave removed it, and pull into a clone being deleted, leaving a ledger row that points at a departed team.
- **Why it's a fork:** the fix changes what an interactive sync does when another sync or a leave is already running on the same team — it skips that team with a printed reason, as it already does when another process holds the clone's writer lock. A behaviour change the last panel did not see.
- **Options:**
  - **1 — Every sync takes the team lock; only the hourly stamp shortcut stays hook-only.** *(decides: leave and sync can never overlap; familiar skip message; one spec §8 sentence; ~1.5 h)*
  - **2 — Leave re-sweeps placements after the clone lock.** *(decides: no sync change; a folder resurrected in the gap can remain on disk)*
  - **3 — Accept the race for 0.1.0.** *(decides: a hand-edited ledger row)*
- **Recommendation:** 1 — cheap, reuses the lock and the message that already exist.
- **Zoom-out:** not lost data, but a persistent confusing state only a hand edit clears; 1.5 h removes it. Fits the North Star.
- **The call:** 1.

### Technical
- **Files / code paths:** `src/commands/sync.ts:73` — the `acquireTeamLock` call sits inside `if (args.hook)`; lift the lock out of that branch, keep only `stampIsFresh` hook-gated, and on a null lock print the existing notice and `continue`. `src/commands/leave.ts:42` unchanged. One `hook-mutex` test: an interactive sync while leave holds the lock skips the team and defers nothing it did not examine. Spec `2026-09-02-phase-1-build.md` §8, one sentence.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~1.5 h; sync's team loop only.
- **Grounding findings:** `sync.ts` acquires the team lock in hook mode only (line 73); `leave.ts` takes it unconditionally; `hook.ts` exports `acquireTeamLock` / `lockPath` with a 10-minute stale window and a dead-pid check.

---

## Decision R5 — `place()` when the new copy landed but the old one could not be removed

**Verdict: LOCK** — option 1: return the placement with a notice; quarantine the old copy.

### Plain English
- **What's at stake:** replacing a placed skill is move-aside, move-in, delete-old. If only the delete fails (an open file on Windows, a read-only subfolder), the new copy is correctly in place, but `place()` throws a false "could not be restored", install exits non-zero with no ledger entry, sync reports Blocked and keeps the old fingerprint, and the next sync quarantines the tool's own fresh copy as a user edit.
- **Why it's a fork:** the truthful fix changes `place()`'s contract for that case — success with a warning instead of a throw — after the last panel. Both callers already print such warnings for a failed exclude write.
- **Options:**
  - **1 — Return success with a notice; quarantine the old copy; keep the throw only for a genuinely failed swap.** *(decides: ledger records what is on disk; install exits zero; next sync leaves the copy alone; ~2 h)*
  - **2 — Keep the throw; re-stamp the ledger from install and sync.** *(decides: no phantom quarantine, but a success is still reported as a failure, in two places)*
  - **3 — Wording only.** *(decides: the false sentence goes; nothing else changes)*
- **Recommendation:** 1 — the only option where the tool tells the truth and the ledger matches the disk.
- **Zoom-out:** the phantom quarantine is recoverable but reads to the user as their skill vanishing; under the North Star that is worth two hours. Fits.
- **The call:** 1.

### Technical
- **Files / code paths:** `src/lib/placer.ts` 67–69: set `displacedExists = false` immediately after `rename(temporary, destination)` succeeds; replace the bare `rm(displaced)` with a non-throwing `discardDisplaced(displaced, name, quarantineRoot)` that returns the stranded path on failure (quarantine, or the hidden path if quarantine also fails); after the result is built (line 71) push `Placed <destination> but the previous <name> could not be removed; it is at <stranded>` onto `result.notices`. Lines 82–83 keep the composed throw for the failed-swap case only. `placer.test.ts:164` asserts a resolved placement carrying the notice plus the same on-disk facts (destination v2, no `.terum-` leftovers, quarantined v1).
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~2 h; `install.ts:109` and `sync.ts:168` already drain `notices`. Sibling with the same shape: `share.ts:268-271` (`replaceDirectory`), to sweep in the same commit.
- **Grounding findings:** read in full during the last confirmation round (placer.ts 50–103 on `2eb01ed`, unchanged since apart from the guarded finally).

---

## Decision R6 — `reconcileShared`'s undone work withholds the hourly stamp

**Verdict: LOCK** — option 1.

### Plain English
- **What's at stake:** the stamp means "this team completed a full sync" (R7). The placement half of sync honours it; the shared-skill half does not — a diverged shared skill, a missing repo copy or a refused rename prints its remedy once, the stamp is written anyway, the message is silenced for an hour and the hook's review count never mentions it.
- **Why it's a fork:** three ways to plumb one rule; only the third raises a product question.
- **Options:**
  - **1 — Hand the reconciler the run's `defer` recorder; its exits withhold the stamp and count toward the review line.** *(decides: one rule for all of sync; ~2 h)*
  - **2 — Return the unresolved team set; mark incomplete only.** *(decides: stamp withheld, review count silent)*
  - **3 — One team-attributed report channel for the whole run.** *(decides: bigger refactor; forces the "whose broken file withholds whose stamp" question)*
- **Recommendation:** 1 — the rule R7 locked, applied to the half that missed it; the exits concern only the user's own shared skills.
- **Zoom-out:** a silenced divergence notice becomes a lost edit a week later; fits the North Star.
- **The call:** 1.

### Technical
- **Files / code paths:** `src/commands/share.ts` `reconcileShared(store, runner, io, skipped)` gains a `defer(team, label)` parameter; exits at lines 104, 105, 111, 126, 133 and the catch at 158 call it; `src/commands/sync.ts:119` passes the `defer` helper defined at line 38. One sync test: a diverged shared skill leaves the team unstamped and listed in `deferred`.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~2 h; `share.ts` and `sync.ts` only.
- **Grounding findings:** `sync.ts:119` passes `childIo` and `skipped` but no recorder; the seven exits are print-and-`continue`.

---

## Decision R7 — What `run/<team>.stamp` means

**Verdict: LOCK** — confirmed as already ruled (Terum decision, Ryan, 2026-09-06) and applied.

### Plain English
- **What's at stake:** whether the hourly stamp means "the clone was refreshed" or "this team completed a full sync". As applied it means the latter: blocked, deferred or otherwise undone work prevents stamping so the next hook run retries.
- **Why it came up again:** the loop recorded it as a product fork because a second, completion-only marker would keep both meanings in separate files (~15 lines, one more `run/` artifact).
- **Options:** keep the applied rule *(decides: a team with human-only undone work fetches every session start and `search` says "may be stale" until an interactive sync clears the item)* · split into two markers *(decides: the stale line stays truthful about refresh alone; one more file, one more leave cleanup line, one spec sentence)*.
- **Recommendation:** confirm; split only if the nag proves annoying in practice.
- **The call:** confirmed as is.

### Technical
- **Files / code paths:** `src/commands/sync.ts` stamp loop; `src/lib/hook.ts` `stampIsFresh`. Report `m4-ship.hybrid.r1.review.md` 718–720 for the split.
- **Grounding findings:** none needed — conceptual, and already applied.

---

## Decision R8 — `setup` on a machine whose team clone is gone

**Verdict: LOCK** — option 2: self-heal.

### Plain English
- **What's at stake:** setup's banner promises "re-run it any time; finished steps are skipped". With the team folder deleted, the applied interim stops with "your team folder is missing; run `team join <remote>`, then re-run setup". The alternative is for setup to re-download the folder itself and carry on.
- **Why it's a fork:** re-cloning is network work inside a step the wizard calls skipped, and must also restore the git name/email the clone needs for later writes; failing fast is honest and free but costs one extra command.
- **Options:**
  - **1 — Keep the interim (fail fast with the hint), as a GATE.** *(decides: nothing to build; one extra command in a rare case)* — the walk's recommendation
  - **2 — Self-heal: re-clone from the remote on file and restore identity.** *(decides: setup is the "fix my machine" wizard its banner suggests; ~1.5 h)* — the loop's recommendation
  - **3 — Route the repair through `team join`.** *(decides: one repair path; re-asks login, name, email)*
- **Recommendation:** 1 as a GATE (documented rough edge, zero cost).
- **Zoom-out:** Ryan chose 2. It fits the North Star: 1.5 h buys a first-run story where a broken machine is fixed by the command the user was already told to run, and the picks across R1, R2 and R8 consistently favour the tool repairing things itself — within budget, so no drift.
- **The call:** 2.

### Technical
- **Files / code paths:** `src/commands/setup.ts` ~132–137: on `describeClone(...) === absent` (R9), print `Re-cloning <team> from <remote>…`, call `ensureClone` and `requireGitConfig` (export both from `team.ts:384` / `:398`; identity only when both stored values are non-empty); `incomplete` and `foreign` keep the "move it aside" refusal. A failed clone propagates to the outer catch → non-zero exit. Tests: `setup.test.ts` — the interim's fail-fast test becomes "clone recreated, roster printed, ok"; add an unreachable-remote case asserting `ok: false`.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~1.5 h; setup only, plus two exports. Report `phase1-closeout.hybrid.r1.review.md` 569–572.
- **Grounding findings:** the interim's guard at `setup.ts:132-137` is two `exists` probes; `ensureClone`/`requireGitConfig` are module-private in `team.ts`.

---

## Decision R9 — `setup`'s clone guard shares `team join`'s definition of "a complete clone"

**Verdict: LOCK** — option 1.

### Plain English
- **What's at stake:** setup decides "is the folder complete?" with two file checks; `team join` uses those plus two git checks (is it a repository; does it point at the right remote). A folder with `team.json` but no `.git` (an interrupted `team leave`, a dotfile-skipping restore) or a clone of the wrong remote passes setup, which then prompts for a share, an invite and the hook and exits happily; every later command fails.
- **Why it's a fork:** close the hole in one place, or copy the two checks by hand.
- **Options:**
  - **1 — One exported `describeClone` predicate consumed by both.** *(decides: one definition nobody can drift by editing one copy; ~2 h, two setup tests)*
  - **2 — Inline the two git checks into setup's guard.** *(decides: ~30 min; two copies that can drift again)*
- **Recommendation:** 1; both branches of R8 need this decision made the same way, and R8's self-heal now keys on it.
- **Zoom-out:** fits — either closes the hole; 1 is the one the next editor cannot break.
- **The call:** 1.

### Technical
- **Files / code paths:** `src/lib/teamRepo.ts` beside `cloneOrigin` (line 331): `describeClone(clone, normalized, runner) → { state: 'absent' } | { state: 'incomplete' } | { state: 'foreign', origin } | { state: 'ok', origin }`; `src/commands/team.ts:384-391` `ensureClone` switches on it keeping its messages; `src/commands/setup.ts:132-137` consumes it (absent → R8's re-clone; incomplete/foreign → the refusal, foreign wording adds the origin). Tests: `.git` removed but `team.json` present; a clone of a second bare fixture while config names the first.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~2 h; the join path's existing tests cover the rewired helper.
- **Grounding findings:** per the last round's triage (Clear #5): `cloneOrigin` already exported; `runner` in scope at `setup.ts:74`; config holds the raw remote on the creator path and the normalized one on the join path, so setup passes `normalizeRemote(remote)`.

---

## Decision R10 — The one-git-per-skill fan-out family

**Verdict: GATE** — keep the interims; tripwire below.

### Plain English
- **What's at stake:** four places ask git once per skill for its latest version — search and the push guard eight at a time (interims applied), `ls` all at once, the README path one after another. Fine for a few dozen skills; slow for several hundred, and the push guard sits on git's blocking pre-push path.
- **Why it's a fork:** the proper fix (one `git ls-tree` per clone through a shared helper at all four sites) touches code three commands and the Action depend on; a shared bounded map is ten lines per site; the interims cost nothing today.
- **Options:**
  - **3 — Keep the interims.** *(decides: zero work now)*
  - **1 — Shared `latestTrees` helper at search, ls, README.** *(decides: one git call per clone; ~4 h; changes what the Action does with a malformed checkout)* — the loop's recommendation
  - **2 — Shared bounded map, sweep ls and search.** *(decides: ~10 lines per site; N processes stay)*
- **Recommendation:** 3 as a GATE.
- **Zoom-out:** fits — nothing is wrong for the teams 0.1.0 will meet.
- **The call:** 3, GATE. **Tripwire:** the first team past about a hundred skills, or the acceptance run reporting a slow `ls`.

### Technical
- **Files / code paths:** `src/commands/search.ts:44-45`, `src/commands/ls.ts:41-46`, `src/lib/readme.ts:129-136`, `src/commands/guardPush.ts:110` (`treeBetween`); `teamRepo.ts` `skillTrees` is the parser to lift when the gate trips.
- **Effort / risk / blast radius:** none now; ~4 h later. Ledgers: `phase1-closeout-r2.deferred.md` (round 1 fork), `m4-ship.deferred.md` (round 3 fork) — both entries stay, pointing here.
- **Grounding findings:** none — conceptual.

---

## Decision R11 — `ls` dies whole on one leftover folder

**Verdict: LOCK** — option 1.

### Plain English
- **What's at stake:** a folder left in the clone by an interrupted write makes `ls` print nothing — no roster, no skills — while `search` shows that one row with a dash and a reason. Same trigger, opposite behaviour.
- **Options:** **1** the same three-line per-row treatment in `ls` *(decides: ~30 min; deletable under any R10 outcome)* · **2** mirror search's eight-at-a-time loop *(pre-empts R10 option 2)* · **3** = R10 option 1.
- **Recommendation:** 1 — the cheapest item in the batch; removes a "the tool shows nothing" failure.
- **Zoom-out:** fits.
- **The call:** 1.

### Technical
- **Files / code paths:** `src/commands/ls.ts:45` — a `.catch` on the one `latestTree` await, printing `<name>: <reason>` through the prompter and returning `—` (`shortHash` and `format` already pass it through); thread `io` into `listSkills`. One `ls.test.ts` case mirroring search's ghost test.
- **Effort / risk / blast radius:** ~30 min. Report `phase1-closeout-r2.hybrid.r2.review.md`, Clear #4.

---

## Decision R12 — Should `search` list a folder that is on disk but never committed to the team repo?

**Verdict: LOCK** — option 1.

### Plain English
- **What's at stake:** such a folder shows as a normal row with a dash for its version, and `install` of it succeeds off the clone's disk with team provenance though nobody else has it. The malformed-folder case four lines away is hidden, so two kinds of junk are treated oppositely, and the phase-2 UI can only tell the row apart by the dash string.
- **Why it's a fork:** the code cannot tell "not committed" from "git would not run" — both reject the same way — so hiding the row would also hide every real skill on a machine with a broken git, showing "No skills found".
- **Options:** **1** keep the row; add `unresolved: boolean` to the hit *(decides: the UI can grey out Install; ~30 min)* · **2** hide it like a malformed folder *(decides: false negatives when git is broken)* · **3** teach the helper to tell the causes apart; hide only the truly uncommitted *(with R10 option 1)*.
- **Recommendation:** 1 for 0.1.0; revisit with R10.
- **Zoom-out:** fits.
- **The call:** 1.

### Technical
- **Files / code paths:** `src/commands/search.ts:12` (`SearchHit`), `:51` (`unresolved: settled.status === 'rejected'`); the ghost test asserts `unresolved: true` / `false`. `SearchHit` is used nowhere outside `search.ts`.
- **Effort / risk / blast radius:** ~30 min. Ledger `phase1-closeout-r2.deferred.md` (round 2 fork) stays, pointing here.

---

## Decision R13 — Patch the borrowed fingerprint file for the same collision class as `canonicalDigest`?

**Verdict: DEFER** — leave it; revisit trigger below.

### Plain English
- **What's at stake:** two different file lists could in theory produce the same fingerprint if a filename contains a colon or a newline. The in-repo digest (`share`'s comparison) was fixed. The same record format lives in a file borrowed from skillhub, where it guards the check that catches a hand-edited installed copy; a collision there would let an edited copy skip quarantine. It takes a deliberately crafted filename.
- **Why it's a fork:** patching the borrowed file pushes it further from upstream (already one documented change) and means updating its header, the NOTICE and the spec sentence that calls it verbatim — a policy about how far borrowed code may drift.
- **Options:** **1** apply the same encoding, update header/NOTICE/spec *(~1 h)* · **2** leave it; document the caveat.
- **Recommendation:** 2 as a DEFER.
- **Zoom-out:** fits — no real report, no lost data without a crafted name.
- **The call:** 2. **Revisit trigger:** the next re-vendor from skillhub, or any real report of a fingerprint mismatch.

### Technical
- **Files / code paths:** `src/lib/placer/vendor/skillhub/skill-fingerprint.ts:24`; spec §7 (~line 358) and default 43 if ever patched. Report `phase1-closeout.hybrid.r1.review.md` 575–578.
- **Grounding findings:** none — policy.

---

## Decision R14 — May text committed to a team repo render as a clickable link in the generated README?

**Verdict: LOCK** — option 1: no; escape link brackets everywhere.

### Plain English
- **What's at stake:** the generated README and the Action's PR comment print skill names, descriptions, categories and authors straight from the repo; a merged description could render as a link labelled "Install v2" pointing anywhere. The skill-name cell is already defanged; the free-text columns still render Markdown.
- **Why it's a fork:** a rule of "no link whose label can lie, anywhere the tool writes Markdown" costs five lines and changes nothing visible; if an intentional `see [our docs](…)` in a description is a wanted feature, leave it.
- **Options:** **1** escape `[` and `]` as the last step of both sanitizers — every cell, both headings, the roster line, the PR comment *(~30 min; a bare URL still auto-links, only the misleading label dies)* · **2** code span for a refused folder name only · **3** keep the interim.
- **Recommendation:** 1 — a labelled link in a trusted team README is a phishing vector next to the North Star's identity exception; negligible cost.
- **Zoom-out:** fits.
- **The call:** 1.

### Technical
- **Files / code paths:** `src/lib/readme.ts` `inlineText()` / `cell()` — the bracket escape runs after the backslash doubling (the report ran both orderings; escaping first yields a literal backslash and a live link); `src/commands/readme.ts:28` for the PR comment; tests extend `readme.test.ts:54` and the PR-comment test with `not.toContain('](https://evil.example')`.
- **Effort / risk / blast radius:** ~30 min; every generated README changes only where a bracket appears in repo text. Report 581–584.

---

## Close-out

**LOCKED, ready to build (12):** R1 auto-generate all four metadata fields with `misc` as the category default · R2 one fresh branch and one fresh PR per publish, create-only, with a y/N note on an existing open PR (lifts D2's gate) · R3 record a stolen target lock in the borrowed file and widen its expiry to 60 s · R4 every sync takes the team lock · R5 `place()` returns a landed swap with a warning · R6 the shared-skill reconciler withholds the stamp · R7 the stamp means "fully synced" (confirmed) · R8 setup re-clones a missing team folder · R9 one `describeClone` predicate for setup and `team join` · R11 `ls` degrades one row · R12 `search` marks an uncommitted row `unresolved` · R14 link brackets escaped everywhere.
**GATED (1):** R10 the fan-out family — interims stay until a team passes ~100 skills or the acceptance run reports a slow `ls`.
**DEFERRED (1):** R13 the vendored fingerprint encoding — until the next re-vendor or a real mismatch report.
**Estimated build of the locked set:** about 16 h (R1 1 · R2 3 · R3 1.5 · R4 1.5 · R5 2 · R6 2 · R8 1.5 · R9 2 · R11 0.5 · R12 0.5 · R14 0.5 · register §C doc lines 0.1), plus one Astra full pass and one fix-scoped confirmation under the two-pass rule. Suggested as one branch off `main` `d294401`, carrying this ledger, so the decisions and the code land in one PR; publish 0.1.0 after it lands; then the acceptance run (D8).
