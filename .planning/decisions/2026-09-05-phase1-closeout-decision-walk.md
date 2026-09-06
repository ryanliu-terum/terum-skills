---
title: phase-1 close-out decision walk
date: 2026-09-05
north_star: fastest path to a shippable 0.1.0; a documented rough edge is acceptable unless it loses data, takes over someone's identity, or leaks a token
status: complete
deferred:
  - what: (D2) one branch per endorsement for publish, replacing the interim reuse-only-your-own-abandoned-attempt rule
    gate: a real team hits the already-exists-with-a-different-endorsement refusal more than once
  - what: (D4a) fold the three hand-rolled copies of the bind check in team.ts into the assertBindable helper
    gate: the next change that touches src/commands/team.ts
  - what: (D6) a Discord server as the community link instead of the repo Issues page
    gate: outside users need to talk to each other, not just to us
  - what: (D7) a second npm owner on terum-skills so the name survives a lost login
    gate: before the first external user, or when a second maintainer exists
---

# Phase 1 close-out — Decision Walk

**North Star:** fastest path to a shippable 0.1.0. A documented rough edge is acceptable unless it loses data, takes over someone's identity, or leaks a token. Ratified by Ryan 2026-09-05 (carried unchanged from the 2026-09-04 M1 hardening walk).

**Batch source:** `.claude/handoff-phase1-remainder.md`, the bodies of PR #1 (`m1-wave`) and PR #2 (`m3-publish-leave`) on `ryanliu-terum/terum-skills`, the deferred register `.planning/reviews/DEFERRED-2026-09-04-phase1-landing.md`, and the rev 9 build spec. These are the nine items that only Ryan can rule on; everything else in the close-out is mechanical.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Merge word, order, and method for PR #1 / PR #2 | LOCK | Both meet the bar; wave first so the smaller diff carries the rebase and two of PR #2's wrinkles vanish; merge commits keep the spec-move history | executes after this walk closes, once D2–D5 say what rides PR #2's rebase |
| 2 | `publish` branch-reuse rule (PR #2's high) | GATE | Keep the interim rule (reuse only your own abandoned attempt, refuse anything else): zero work, no gh needed, blocks the one harmful case | build one-branch-per-endorsement if a real team hits the "different endorsement" refusal more than once |
| 3 | `team leave` and the people file | LOCK | Leave writes nothing to the repo, as built: the offered flip records "declined" for every endorsed skill and wipes a second laptop's roster entry; an overstated install count is a documented rough edge | — |
| 4 | PR #1's four contested review items | LOCK + DEFER (split) | 4c keep the in-write twin-login guard and rename its test; 4d replace the PAT/token keyword scans with an exact question list; 4a fold the triplicated bind check when `team.ts` is next touched; 4b batch the per-skill pushes — built in D9's sweep | 4a: next `team.ts` change · 4b: LOCK via D9 |
| 5 | PR #2's two low M2-code items | LOCK | Fix both now (~1 h): a real skills-root check before any placement removal, and a shared fetch+hard-reset clone refresh for `publish` and `sync`; both failure modes are invisible to the person they hit | rides PR #2's rebase (publish side) + a small commit on main (sync side) |
| 6 | `COMMUNITY_URL`: Slack or Discord | GATE | Neither: point at the public repo's Issues page. Slack conflicts with the July single-channel-guest ruling; Discord is an empty room to monitor; Issues is where OSS feedback lands anyway | switch to a Discord server when outside users need to talk to each other, not just to us |
| 7 | npm 0.1.0 name reservation timing | LOCK | Placeholder 0.0.1 now (README, LICENSE, stub bin that says "not released yet"), real 0.1.0 at M4: losing the name costs a product rename, holding it costs ten minutes | needs Ryan's `! npm login` in-session; publish from Ryan's npm account |
| 8 | Second person for the §12 acceptance run | LOCK | A teammate only (Teddy or Ajay, whoever is free first), on their own laptop and GitHub account, no Claude rehearsal; the built-CLI walkthrough tests are the rehearsal, reschedule risk accepted | book when setup + hook + bootstrap exist |
| 9 | Register §B M2 spec gaps: in scope or amended out | LOCK | In scope, all of it, rename propagation included: the spec stays exactly as written and 0.1.0 meets it; ~a day and a half on one branch with one review, run in parallel with `setup` after the PRs land | own branch after PR #1/#2 merge; codex-implement candidate |

---

## Decision 1 — Merge word, order, and method for PR #1 / PR #2

**Verdict: LOCK**

### Plain English
- **What's at stake:** two finished, reviewed branches are waiting; until they land, `setup`, the register update, and M4 cannot start, and main keeps moving underneath them (five eval commits already).
- **Why it's a fork:** not whether to merge (both meet the bar Ryan set: green gates, one valid cross-model review, every confirmed high fixed) but which lands first, and whether the D2–D5 fork fixes go on-branch first or onto main afterwards.
- **Options:**
  - **A — wave first, publish/leave rebased on top.** *(decides: the smaller diff does the conflict work; the join-after-leave collision and the "no PAT threaded" finding both vanish once the wave is under it)*
  - **B — publish/leave first, wave rebased on top.** *(decides: publish usable hours sooner, but the 950-line wave carries the rebase and re-proves its reclaim tests)*
  - **C — hold both until D2–D5 are applied on-branch.** *(decides: one fewer follow-up commit, at the cost of blocking everything downstream a full cycle)*
- **Recommendation:** A, merge now, merge commits (PR #1's spec move rev 8 → rev 9 is its own commit; squash would lose it).
- **Zoom-out:** A is the shortest path to 0.1.0; every fork is small and reversible after the fact, so holding does not serve the goal.
- **The call:** A. Fork fixes are follow-up commits on main, except changes to `publish`/`team leave`, which ride PR #2's rebase. Claude runs `gh pr merge --merge` on each in order, after the rebase gates pass. Merge is authorized; execution waits until this walk closes so D2–D5 are known before PR #2 is rebased.

### Technical
- **Files / code paths:** rebase conflicts expected in `src/cli.ts` (take both registrations), `src/commands/team.ts` (Track B's self-removal string), `src/lib/teamRepo.ts` (take both; then point safeWrite's `lockfilePath` at the appended `cloneLockPath` so the formula lives once), `src/commands/uninstall.ts` (take both).
- **Migration / schema:** none.
- **Effort / risk / blast radius:** one rebase, three gates, one force-with-lease push; no re-review unless behaviour changed. Repo allows merge/squash/rebase, no branch protection, no CI.
- **Grounding findings:** PR heads unchanged since the handoff (`af0bce8`, `89dad8a`); `origin/main` moved by five commits, all under `src/lib/evals/` and eval planning docs, no overlap with either PR's files.

---

## Decision 2 — `publish` branch-reuse rule (PR #2's high)

**Verdict: GATE** — keep the interim rule; tripwire below.

### Plain English
- **What's at stake:** `publish` pushes a branch named after the skill alone and opens a PR from it. Two people endorsing the same skill (different scopes) want the same branch; before the fix the second push silently rewrote the first person's open PR under their name.
- **Why it's a fork:** the spec's "an existing branch is an abandoned attempt, reset it" was written for one person retrying and never considered two people. The review called it the branch's one high; the prior session shipped a middle rule and asked Ryan for the permanent one.
- **Options:**
  - **A — keep the interim rule:** reuse the branch only when it already carries exactly this endorsement (your own abandoned attempt); refuse anything else with the compare URL and the delete command. *(decides: zero further work, no gh needed, blocks the one harmful case; limit is that two different endorsements of one skill cannot be in flight at once)*
  - **B — refuse whenever the branch exists** (the review's pick). *(decides: simpler still, but your own retry needs a manual branch delete; stricter than the spec)*
  - **C — one branch per endorsement** (`publish/<handle>-<name>-<id8>`). *(decides: nobody waits, more branches/PRs, naming ripples through spec and tests; the Action's `publish/` trigger still matches)*
  - **D — refuse only when an open PR exists** (ask gh). *(decides: closest to the spec's convenience, but needs a logged-in gh, so refuses more on plain-git remotes and gh-less machines)*
- **Recommendation:** A as a GATE — costs nothing, and the harm it prevents sits at the North Star's "takes over someone's identity" line; C is the better long-term shape, hence a gate not a rejection.
- **Zoom-out:** the only zero-work option that closes the high; serves fastest-to-0.1.0.
- **The call:** A. **Tripwire:** a real team hits the "already exists with a different endorsement" refusal more than once → build C.

### Technical
- **Files / code paths:** `src/commands/publish.ts` (live `git ls-remote --heads` before the y/N; refusal text with compare URL + `git push origin --delete publish/<name>`); locked M3 spec `.planning/specs/2026-09-05-m3-publish-leave.md` §1.3 step 8a; `teamRepo.ts` keeps the `-2` fallback for a branch that moves *during* the write.
- **Migration / schema:** none. C would rename the branch in spec, tests, and the Action trigger.
- **Effort / risk / blast radius:** none now; C is a small rename later.
- **Grounding findings:** the rule is implemented and tested on `m3-publish-leave` @ `89dad8a` exactly as §8a describes.

---

## Decision 3 — `team leave` and the people file

**Verdict: LOCK**

### Plain English
- **What's at stake:** `team leave` removes a team from this machine (placements, clone, caches, config). Whether it also tells the shared roster "I no longer have these skills". Today it never touches the repo, so the people file overstates installs until rejoin or admin removal.
- **Why it's a fork:** the spec's "leaves no repo trace" was read literally; PR #2 offered a one-line flip to the uninstall helper for accurate counts. It looks free and is not.
- **Options:**
  - **A — writes nothing (as built).** *(decides: offline-safe, never speaks for you in the roster, a second laptop on the same handle is untouched; cost is an overstated install count)*
  - **B — flip to `uninstallOne` per placement.** *(decides: accurate counts, but needs a push so leave fails offline, and records `declined` for every endorsed skill you had, so a rejoin is never offered them again)*
  - **C — clear `installed` only, best effort.** *(decides: accurate when online, no declined entries, but new code and still wrong for the second laptop)*
- **Recommendation:** A. The flip writes a consent decision the user never made (the North Star's identity line), and the per-person `installed` list means leaving on laptop 1 would wipe laptop 2's roster entry, whose next sync then flags every skill as orphaned.
- **Zoom-out:** zero work, avoids the one option that silently misstates consent; fits.
- **The call:** A. Documented rough edge: the people file keeps listing skills this machine no longer has; `install member <you>` after a rejoin re-places them.

### Technical
- **Files / code paths:** `src/commands/leave.ts` (no git, no safeWrite; placements under the target lock, then clone/cache/stamp/config in one `store.update`); `uninstallOne` in `src/commands/uninstall.ts` appends to `declined` whenever the id is on a `team.json` endorsement list; `sync`'s `reconcileOrphans` prompts per orphaned placement interactively, defers under `--hook`.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** none now.
- **Grounding findings:** confirmed in code on `m3-publish-leave` @ `89dad8a`: `auto = endorsed.global.includes(id) || any project list includes(id)`; `declined` is appended when `auto`.

---

## Decision 4 — PR #1's four contested review items

**Verdict: LOCK (4c, 4d) + DEFER (4a, 4b)** — a split; none touches data, identity, or tokens.

### Plain English
- **What's at stake:** four code-quality items the review's verifiers split on, left for Ryan by the prior session.
- **Why it's a fork:** each is cheap to fix and cheap to leave; the question is whether any earns a slot before 0.1.0.
- **Sub-calls:**
  - **4a — the "can I bind this team?" check exists three times** (a helper plus hand-rolled copies in `create` and `join`; half the helper unreachable at `create`). *Fold now (~30 min) vs leave.* **Call: DEFER** — fold when `team.ts` is next touched; no user sees it.
  - **4b — bulk uninstall does one push per skill** (M2 code; twenty skills → twenty commit-and-push cycles; a refused push mid-way leaves a half-updated roster that self-heals on rerun). *Batch now vs leave.* **Call: DEFER** into D9's M2 sweep.
  - **4c — the twin-login refusal at `team remove` fires inside the write, after the y/N and four gh reads**, unlike sibling refusals which are preflights. Inside the write is the only place the roster is guaranteed fresh and the check re-runs on each retry. *Add an early check too vs keep.* **Call: LOCK keep as is; rename the test** so it stops claiming "before touching the host".
  - **4d — three tests assert "never asked for a token" by scanning prompts for /PAT|token/**, which no prompt can match, so they cannot fail. The real guarantee is structural (no `secret` on the Prompter). *Replace with an exact list of asked questions (~5 min) vs leave.* **Call: LOCK fix** — a test that cannot fail is the kind we agreed to stop writing.
- **Recommendation:** as called; ~15 minutes total in the follow-up commit.
- **Zoom-out:** nothing here touches the North Star's guards; fits.
- **The call:** 4a DEFER, 4b DEFER, 4c LOCK keep + rename, 4d LOCK fix.

### Technical
- **Files / code paths:** 4a `assertBindable` in `src/lib/auth.ts` and copies near `team.ts` 169/181/246 (vote 1-2). 4b `run()` in `src/commands/uninstall.ts` fanning out `uninstallOne` each with its own `safeWrite` (vote 2-1). 4c guard in `archiveMutation`, `team.ts` ~132; test `remove.test.ts:179` (vote 2-1). 4d `auth.test.ts:77,84,96` (vote 1-2).
- **Migration / schema:** none.
- **Effort / risk / blast radius:** 4c rename + 4d rewrite ≈ 15 min, test-only; 4a/4b deferred.
- **Grounding findings:** read from the contested section of `hybrid-branch-2026-09-05-m1-wave.review.md`.

---

## Decision 5 — PR #2's two low M2-code items

**Verdict: LOCK** (both fixed now)

### Plain English
- **What's at stake:** two "low" findings that sit under verbs shipping in 0.1.0, both with failure modes the affected person cannot see.
- **Why it's a fork:** neither is one of the three unforgivables, so the North Star would let both slide; the combined fix is under an hour.
- **Sub-calls:**
  - **5a — the "only delete inside the skills folder" check never runs.** Callers pass the path's own parent as the root, so containment is always true; the only protection is that every ledger path was written by `install`. `team leave` now walks every team placement unattended, so a bad ledger path (hand edit, future writer bug) would quarantine whatever folder it named. *Fix now (~30 min, rides PR #2's rebase) vs M2 sweep.* **Call: LOCK fix now.**
  - **5b — `publish` and `sync` refresh the clone with pull fast-forward-only, which wedges permanently on a clone that safeWrite would have healed** (process killed between commit and the finally reset). The hook then fails silently every session. *Shared fetch+hard-reset helper (~20 min) vs M2 sweep.* **Call: LOCK fix now.**
- **Recommendation:** fix both; a silently dead hook or a moved unrelated folder is the kind of surprise that ends a first team's trial.
- **Zoom-out:** a judgement call past the North Star's floor, taken because the cost is small and the failures are invisible; recorded as such.
- **The call:** both LOCK.

### Technical
- **Files / code paths:** 5a `removePlacements` in `src/commands/uninstall.ts` (root = `dirname(path)`), same pairing in `sync.ts` ~110; `placer.ts` 83–88 validates `dirname(destination) === root`. Fix: assert the root matches the phase-1 agent-path row (`.claude/skills`) before `placer.remove`; test that a bogus ledger path is refused and nothing moves. 5b `publish.ts:38` and `sync.ts:43` (identical `git pull --ff-only` + identical error string). Fix: one `refreshClone` helper doing `fetch origin` + `reset --hard origin/main`, matching `teamRepo.ts:100–101`; test a clone with a local-only commit on main recovers.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~1 h total; 5a touches the shared removal helper used by `uninstall`, `sync`, `leave`; 5b touches `publish` (PR #2) and `sync` (main).
- **Grounding findings:** both read from `hybrid-branch-2026-09-05-m3-publish-leave.review.md`; the credential-env half of 5b's finding is moot once the wave retires tokens.

---

## Decision 6 — `COMMUNITY_URL`: Slack or Discord

**Verdict: GATE** — repo Issues page now; Discord behind a tripwire.

### Plain English
- **What's at stake:** `setup` step 6 prints one line ("feedback and requests go here") and a link held in one constant; while empty the step is skipped. Spec §13 default 39 marked it OPEN for Ryan to pick Slack or Discord before M3 ends.
- **Why the framing was off:** the team record (2026-07-14) keeps outsiders out of the internal Terum Slack except as single-channel guests, one admin invite each; a public join link printed by an OSS installer would make strangers full members. Discord means an empty server to seed and monitor. The repo is already public with Issues enabled, which is where OSS feedback normally lands.
- **Options:**
  - **A — the repo's Issues page.** *(decides: zero new surface, zero moderation, already watched, stable forever; not chat)*
  - **B — a new Discord server.** *(decides: real-time chat and the OSS norm; an empty room from day one)*
  - **C — internal Slack shared invite.** *(decides: where the team lives, but conflicts with the July ruling)*
  - **D — leave empty for 0.1.0.** *(decides: zero work; the wizard's community step silently never runs)*
- **Recommendation:** A as a GATE.
- **Zoom-out:** the only option with no ongoing cost and no conflict with a standing decision; fits.
- **The call:** A. `COMMUNITY_URL = https://github.com/ryanliu-terum/terum-skills/issues`. **Tripwire:** outside users need to talk to each other (not just to us) → stand up Discord and swap the constant.

### Technical
- **Files / code paths:** one exported constant in the package, printed by `setup` step 6 (§6.1), never opened; ships with `setup`.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** one line.
- **Grounding findings:** `gh repo view`: PUBLIC, Issues enabled, Discussions disabled (enable is one click if that URL is preferred later). Terum record: 2026-07-14 Slack guest-scoping ruling; the 2026-08-20 Discord ledger is about ingesting Discord as a source, unrelated.

---

## Decision 7 — npm 0.1.0 name reservation timing

**Verdict: LOCK**

### Plain English
- **What's at stake:** `terum-skills` is free on npm today and every printed command in the product (README one-liners, invite block, share card) says `npx -y terum-skills@latest`; the public repo already advertises the name. Losing it means renaming the product.
- **Why it's a fork:** the spec reserves the name with the real 0.1.0 at the end of M4; npm has no reserve, only publish, so holding the name early means a placeholder is public before the tool is ready.
- **Options:**
  - **A — placeholder 0.0.1 now, real 0.1.0 at M4.** *(decides: the name is safe today for ten minutes; an early finder gets a clear "not yet")*
  - **B — wait for M4 as written.** *(decides: nothing public until it works, at the price of an open window on a distinctive, already-visible name)*
  - **C — publish the current build as 0.0.x.** *(decides: usable early, but without setup/hook/bootstrap, and it muddles what 0.1.0 means)*
- **Recommendation:** A; the risk is asymmetric.
- **Zoom-out:** the name is the identity of what ships; protecting it fits. C would make the first public impression the version we agreed is not done.
- **The call:** A. Placeholder = README, LICENSE, and a stub `bin` that prints "terum-skills 0.1.0 is not released yet; watch https://github.com/ryanliu-terum/terum-skills". Published from Ryan's npm account; a second owner can be added later with `npm owner add`. Needs Ryan to run `! npm login` in-session.

### Technical
- **Files / code paths:** the placeholder is a throwaway directory outside this repo, not the tree's `package.json`. The real publish (M4) still needs `repository`, `bugs`, `homepage`, `keywords` added; `name`, `license`, `bin`, `files`, and `prepack` build already exist.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** ~10 min plus the login.
- **Grounding findings:** `npm view terum-skills` → 404 (unclaimed); `npm whoami` → 401 (not logged in) on 2026-09-05.

---

## Decision 8 — Second person for the §12 acceptance run

**Verdict: LOCK**

### Plain English
- **What's at stake:** §12's headline is a live two-person run through `setup` on two machines with two GitHub accounts against a real private repo (create → invite → join → share ×2 → edit+sync → install pinned and latest → publish by PR → teammate prompted and accepts → project skill auto-places → README + Action reflect it → remove → rejoin). It is the onboarding a design partner would get, done for real once.
- **Why it's a fork:** it cannot start until setup, the hook, and the fresh-machine bootstrap exist; who the second person is decides whether it is a scheduled human session or something Claude can drive alone.
- **Options:**
  - **A — a teammate only** (Teddy or Ajay) on their own laptop and account. *(decides: the real thing, a second human on a machine Ryan did not set up; costs a scheduled hour)*
  - **B — Claude with a second GitHub account on a clean machine account.** *(decides: repeatable and unscheduled; proves mechanics, misses a second human's confusion)*
  - **C — B as rehearsal, then A once as sign-off.** *(decides: the teammate's hour lands on a run that already works)*
- **Recommendation:** C.
- **Zoom-out:** Ryan picked A. Named the mismatch once: with no rehearsal the first real run is also the first full run, so an M4 bug costs the teammate's hour and a reschedule. Offered a ten-minute solo dry run of the creator path as the cheap middle. Ryan kept A exactly as picked: the built-CLI walkthrough tests are the rehearsal, and the reschedule risk is accepted.
- **The call:** A, whoever of Teddy or Ajay is free first, booked once setup, hook, and bootstrap are built.

### Technical
- **Files / code paths:** needs no code; blocked on `setup` (§6.1), the session-start hook (§8), and `install`'s three-part-ref bootstrap (M4). The interrupt-and-rerun cases live in the setup suite; the walkthrough tests (`src/__tests__/m2-walkthrough.test.ts`, `m3-publish-walkthrough.test.ts`) script the second user.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** one teammate hour; a second GitHub account with access to a fresh private repo.
- **Grounding findings:** none — conceptual.

---

## Decision 9 — Register §B M2 spec gaps: in scope or amended out

**Verdict: LOCK** (all in scope, before 0.1.0)

### Plain English
- **What's at stake:** the register's §B lists places where built M2 code does not do what the spec says; D4 added the per-skill push. "Closed as written" means each is built, or the spec is changed to match, or 0.1.0 ships with it named. Nobody owned them.
- **The bucket, cheapest first:** `search` missing its version column (~15 min); `share` accepting a malformed `allowed-tools` line instead of naming it at share time (~30 min; placement still refuses it, so no unapproved grant ever auto-places); the review's missing tests (~1 h); the unclassified "placed copy newer than the clone's" sync case (~1 h); bulk uninstall's one push per skill (1–2 h); and **author-side rename propagation** (§5.3 says a rename keeps the skill's identity across the repo; today the repo copy keeps the old name and auto-update stops; `share --relocate` is the manual path) — the one real design item, half a day or more with tests.
- **Why it's a fork:** everything but the rename is ~half a day and clearly worth it; the rename is build-for-0.1.0 versus amend-the-spec-and-wait-for-a-real-rename.
- **Options:**
  - **A — sweep the cheap items, amend the spec on rename.** *(decides: ~half a day, and the spec stops promising what 0.1.0 does not do)*
  - **B — sweep everything including rename.** *(decides: the spec stays exactly as written, at a day or more for the one gap no author has hit)*
  - **C — carry all of §B forward as known gaps.** *(decides: zero work; the cheap items left undone read as neglect)*
- **Recommendation:** A.
- **Zoom-out:** Ryan picked B. Named the cost once: rename propagation is a repo-side folder move under the author's ownership, placement renames on every installer's next sync, and the guard's rename case, all with tests — roughly tripling the sweep to keep one paragraph true. Ryan kept B: the spec is met as written.
- **The call:** B. The sweep runs on its own branch with its own review, **in parallel with `setup`, after PR #1 and PR #2 land**; a codex-implement candidate as Track B was.

### Technical
- **Files / code paths:** `search.ts` (copy `latest: shortHash(...)` from `ls.ts`); `share.ts` (run the existing `allowed-tools` classifier at share, fail naming the line); `search.test.ts`, private-lock-dir helpers, `install.ts` scope compare; `sync.ts` blocked sub-case; `uninstall.ts` `run()` → one safeWrite for member/project removal; rename propagation → a safeWrite that moves `skills/<old>/` to `skills/<new>/` keeping `metadata.id`, guard row for "a rename that moves a file out of an owned folder", installer-side placement rename in `sync.ts` (already half-present), tests for each.
- **Migration / schema:** none; §5.3 and §6 text unchanged.
- **Effort / risk / blast radius:** ~1.5 days; touches share, sync, search, uninstall, guard. One review pass.
- **Grounding findings:** register §B on `origin/main`; spec §5.3 line "a changed name/dirname is a rename, not a new skill"; `ls.ts` already computes the version column; `share` carries `--relocate` and `--forget` flags.

---
