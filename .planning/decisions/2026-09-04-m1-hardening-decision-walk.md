---
title: M1 hardening decision walk
date: 2026-09-04
north_star: Fastest path to M2 — unblock share, install, and sync; documented rough edges in M1 are acceptable unless they lose data
status: complete
deferred:
  - what: Fix the vendored skill-fingerprint backslash rewrite, flip its header to modified, update NOTICE (D7)
    gate: Delegated to the m2-loop session; verify it landed when M2 merges to main
  - what: The M1 hardening wave itself — Decisions 1, 2, 4, 5 and the pass 2 mechanical list (D10)
    gate: Both m2-loop and m3-team-layer are on origin/main; revisit the order if either slips past a week
  - what: Retire the per-team PAT path (D2) is part of that wave, so the token field and secret prompt stay in main until then
    gate: Same as D10
---

# M1 Hardening — Decision Walk

**North Star:** Fastest path to M2. Unblock `share`, `install`, and `sync`; a documented rough edge in M1 is acceptable as long as it cannot lose data, take over someone's identity, or leak a token.

Source: the nine open decisions left by two `/hybrid-review` passes over the M1 plumbing (commit `56b651a`), reports at `.planning/reviews/hybrid-working-2026-09-04-pass1.review.md` and `-pass2.review.md`.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | Who may reclaim a live people file | LOCK | A matching non-empty GitHub login or email reclaims your own file when this laptop has no record; fixes the second laptop and the interrupted rerun in one line | — |
| 2 | PAT path: keep or retire | LOCK | Retire now, per Ajay's 2026-09-03 ruling; gh is the credential, generic-git uses ambient credentials; removes the class of findings that dominated both review passes | — |
| 3 | Bootstrap commit outside safeWrite | LOCK | The first commit into an empty repo has no origin/main to be safe against; accept as the one documented exception, one sentence in §6.0 rev 9 | — |
| 4 | `login` shape and scope | LOCK | Bare `login`: gh check, gh offer, identity; it writes no team entry, so the early-binding bug class disappears with it | — |
| 5 | Team name welded to repo name | LOCK | `team create` asks two questions, team name then repository name (default: the team name), and re-asks the repository name when GitHub says it is taken | — |
| 6 | Three spec updates for rev 9 | LOCK | Empty permissions line means "asks for nothing"; GitHub names ignore capitalisation; the Prompter carries `interactive`. Recorded as spec updates, not exceptions | — |
| 7 | Vendored fingerprint backslash bug | DELEGATE | The file's consumer is being written in the m2-loop worktree now; that run applies the one-line fix, flips the header to modified, and updates NOTICE | → m2-loop session (instruction below) |
| 8 | Review artifacts committed in the repo | LOCK | Keep the two review reports, delete the two proposed-patches files (never applied, already stale); same rule for pass 2 | — |
| 9 | Placeholder Action in every team repo | LOCK | Leave it; the M3 worktree is replacing it with the README generator and M3's review owns its permissions | — |
| 10 | Sequencing the M1 wave against in-flight M2/M3 | GATE | M2 and M3 land first, then the M1 wave as one change; only the remote.ts security fixes and the `--` separators go on main now | M1 wave starts when M2 and M3 are on main |

---

## Decision 1 — Who may reclaim a live people file

**Verdict: LOCK (A)**

### Plain English
- **What's at stake:** joining from a second laptop as yourself, and rerunning a join that was interrupted after the roster write. Today both are told the handle is taken and pushed to `<handle>-2`, splitting the roster entry.
- **Why it's a fork:** the only proof of identity is what the joiner types (GitHub login, email). The code trusts that alone for an archived handle but not for a live one.
- **Options:**
  - **A —** a matching, non-empty GitHub login or email reclaims the file when this laptop has no binding yet. *(decides: one line, fixes both cases; no weaker than the rejoin path that already ships)*
  - **B —** keep requiring this laptop's binding. *(decides: safe, but no second laptop and reruns collide)*
  - **C —** invitation-style proof. *(decides: needs a design session)*
- **Recommendation:** A.
- **Zoom-out:** A serves fastest-to-M2 directly and is not data-loss; B leaves M2's two-person walkthrough a rough edge; C costs a session.
- **The call:** A.

### Technical
- **Files / code paths:** `src/commands/team.ts` `joinMutation` — `samePerson` with non-empty operands, accepted when `boundHandle` is undefined or equal; `src/lib/auth.ts` `collectIdentity` validates the login format when given. `join.test.ts` gains a fresh-config reclaim case and a blank-login collision case.
- **Migration / schema:** none. Spec §5.4 gets one sentence in rev 9: an unbound machine may reclaim a live file whose GitHub login or email matches.
- **Effort / risk / blast radius:** minutes; risk is the known one (anyone who knows your email could claim your slot), already accepted for rejoin.
- **Grounding findings:** pass 2 confirmed (3-0) the empty-login equality and the interrupted-join non-idempotence; the second-laptop case was contested 1-2 and is resolved by this same rule.

---

## Decision 2 — PAT path: keep or retire

**Verdict: LOCK (B — retire now)**

### Plain English
- **What's at stake:** whether an admin whose gh is logged out or missing can still create or administer a GitHub team with a pasted token.
- **Why it's a fork:** the path works and is tested, but it is the only place a token is handled, it drew the largest share of findings in both review passes, and Ajay's standing decision (2026-09-03, https://app.terum.ai/#/decisions/c59790ae-1583-4601-9cb2-245466e635c1) retires it because gh covers everything a PAT cannot (invitations).
- **Options:**
  - **A —** keep as built, revisit at M4. *(decides: costs nothing now)*
  - **B —** retire now per Ajay. *(decides: half a day, deletes the whole credential surface)*
  - **C —** keep, frozen. *(decides: no new surface, still carried)*
- **Recommendation:** A was recommended on the fastest-to-M2 yardstick; B was chosen.
- **Zoom-out:** B spends a half day before M2, but it removes the class of findings rather than the instances, and it aligns the code with the team ruling that rev 8 missed. Not data-loss. Fits.
- **The call:** B.

### Technical
- **Files / code paths:** delete `secret` from the Prompter, `gitAuthEnv`, `probeToken`, the PAT branch of `authenticateCreator`, the `token` plumbing through `openTeamRepo`/`cloneTeam`/bootstrap, `teams.<name>.token` from the config schema (keep the key nullable for one release or drop it — drop it; nothing wrote a real token outside tests); `login` becomes gh detection + offer + identity. Tests: remove the PAT cases in auth/create/login suites, keep the "joiner is never asked for a PAT" case as a regression guard against re-adding a token prompt.
- **Migration / schema:** `config.json` loses `teams.<name>.token`; the schema is `passthrough`, so an existing key is preserved and ignored.
- **Effort / risk / blast radius:** ~40 product lines and ~10 tests; one review pass. Risk is low; the generic-git path never used a token.
- **Grounding findings:** none — conceptual; the shipped implementation was verified in pass 2.

---

## Decision 3 — Bootstrap commit outside safeWrite

**Verdict: LOCK (A)**

### Plain English
- **What's at stake:** `team create` makes the first commit in an empty repository; the safe-write loop cannot fetch and reset to a `main` that does not exist.
- **Why it is barely a fork:** nobody can race an empty repo you just created; the exception is real and bounded to one push.
- **Options:** **A —** accept and document. **B —** an empty-remote mode inside `safeWrite`, same behaviour, more code.
- **Recommendation:** A. **Zoom-out:** zero work. **The call:** A.

### Technical
- **Files / code paths:** `bootstrap()` in `src/commands/team.ts` stays as is. Spec §6.0 rev 9 gains: "The scaffold commit at `team create` is the one write outside `safeWrite`: the remote is empty, so there is no `origin/main` to reset to; the staging repo that pushed it becomes the clone."
- **Migration / schema:** none. **Effort / risk / blast radius:** none. **Grounding findings:** Codex's own `openQuestions` raised it; both review passes accepted the shape and only flagged the failure message (a mechanical fix).

---

## Decision 4 — `login` shape and scope

**Verdict: LOCK (A — bare `login`)**

### Plain English
- **What's at stake:** the admin's first command. With the PAT retired (Decision 2) it can only check gh, offer gh's own login, and collect name, email, and default handle.
- **Why it's a fork:** the shipped `login --team --remote` writes a team entry before anything is created or joined; that early entry produced three confirmed findings (unverified handle, stale remote, duplicate entry).
- **Options:** **A —** bare `login`, no team entry; teams enter config only through `create` and `join`. **B —** keep the flags and the guards around them.
- **Recommendation:** A. **Zoom-out:** a deletion that removes a bug class; M3's `setup` needs only the detection half. **The call:** A.

### Technical
- **Files / code paths:** `src/commands/login.ts` drops `team`/`remote` args, `teamByRemote`, `hostOperationAllowed`, and the under-lock re-check; it calls `detectOrOfferGh` + `collectIdentity` and `setIdentity` under `store.update`. `src/cli.ts` drops the two required options. `login.test.ts` keeps the gh-offer and identity cases. Spec §6 `login` already reads this way; rev 9 removes the PAT sentence (Decision 2).
- **Migration / schema:** none beyond Decision 2's token removal. **Effort / risk / blast radius:** minutes. **Grounding findings:** pass 1 highs on `login` (handle binding, PAT for any remote) and pass 2 medium (half re-check under lock) all vanish with the entry write.

---

## Decision 5 — Team name welded to repo name

**Verdict: LOCK (two questions, re-ask on collision)**

### Plain English
- **What's at stake:** whether a taken GitHub repository name forces you to rename the team, or only the repository. Today `team create acme` needs a repo called `acme`; a collision makes you pick another team name, which everyone then sees.
- **Why it's a fork:** decoupling is small, but the first framing (a `--repo` flag) was the wrong shape for a Prompter-first CLI whose every verb already asks questions.
- **Options:** a `--repo` flag; two questions with re-ask on collision; two questions but fail on collision; keep coupled.
- **Recommendation and call:** two questions. `team create` takes or asks the team name, then asks "GitHub repository name [<team name>]"; when GitHub reports the name taken it prints that and re-asks the repository name, up to three times. `--org` stays an option. Both values are plain fields on the library call so the M3 wizard can pass them.
- **Zoom-out:** minutes of work; removes a naming scar from the first real team; consistent with the wizard's step 3.

### Technical
- **Files / code paths:** `create` in `src/commands/team.ts`: `CreateArgs` gains `repo?: string`; the spec string becomes `org ? org/repo : repo` with `repo` defaulting to the prompted answer; the `gh repo create` call sits in an `askUntilValid`-style loop keyed on gh's "already exists" message (MAX 3). `src/cli.ts`: `<name>` optional, `--repo` and `--org` as overrides. `team.json.name` stays the team name. Joiners default their local name to the repo basename; `--as` already exists.
- **Migration / schema:** none. Spec §6 `team create` rev 9 gains the repository question.
- **Effort / risk / blast radius:** small; one create test for the collision re-ask. **Grounding findings:** none — conceptual.

---

## Decision 6 — Three spec updates for rev 9

**Verdict: LOCK (all three ratified)**

### Plain English
- **What's at stake:** three places where the code knowingly differs from the letter of rev 8. The house rule is that the build spec is authoritative, so each needed your sign-off rather than mine. Two of the four originally listed disappeared with Decisions 2 and 4 (`secret` went with the PAT; the nullable per-team handle is unnecessary once only `create`/`join` write team entries).
- **(1) Empty permissions line.** A present-but-valueless `allowed-tools:` line is treated like a missing one ("asks for nothing"), not as unreadable. A real judgment about which way to fail; accepted.
- **(2) GitHub names ignore capitalisation.** `Acme/Team` and `acme/team` are one repository and one team; other hosts stay case-sensitive. A correction to how the spec described GitHub; accepted.
- **(3) The channel knows whether a person is present.** The Prompter gains one flag, `interactive`; the phase 2 web channel sets it to true. A small contract extension the UI team must honour; accepted.
- **Zoom-out:** all three are one sentence each in rev 9 and none is data-loss. **The call:** ratify all three.

### Technical
- **Files / code paths:** already shipped — `allowedTools(null)` in `src/lib/schema.ts`; `CASE_INSENSITIVE_HOSTS` in `src/lib/remote.ts`; `Prompter.interactive` in `src/lib/prompt.ts`. Rev 9 edits: §5.4 (bare line is empty), §5.1 (github.com is case-insensitive in owner/repo), §3 (the flag as part of the channel contract; `secret` removed per Decision 2). Follow-up from Decision 4: `teams.<name>.handle` returns to non-nullable in the schema.
- **Migration / schema:** none. **Effort / risk / blast radius:** spec text only. **Grounding findings:** pass 1 unverified and pass 2 confirmed (case) findings; the empty-line reading was an M1 open question.

---

## Decision 7 — Vendored fingerprint backslash bug

**Verdict: DELEGATE → the m2-loop session**

### Plain English
- **What's at stake:** the borrowed checksum code turns backslashes in file names into slashes, right on Windows, wrong on Mac and Linux. Nothing in M1 calls it; the M2 Placer does, and M2 is being built now in `../terum-codex/m2-loop`.
- **Why it moved from DEFER to DELEGATE:** the consumer exists today, in another session, which already has to edit the sibling vendored file's header per §3.
- **The call:** delegate. Instruction to paste into the m2-loop session:

> In `src/lib/placer/vendor/skillhub/skill-fingerprint.ts`, `listSkillFiles` rewrites every backslash in a relative path to `/`. Gate that on the platform separator: `const rel = relative(root, absolute); files.push(sep === '\\' ? rel.split('\\').join('/') : rel);` (import `sep` from `node:path`). Flip the attribution header to `modified: yes`, add one line under it saying what changed, and add "(modified: path separator handling)" after the file's entry in NOTICE. Add a test with a file literally named `docs\\readme.md` on POSIX asserting the snapshot key resolves and its content is hashed.

### Technical
- **Files / code paths:** `src/lib/placer/vendor/skillhub/skill-fingerprint.ts:51`, its header, `NOTICE`. **Migration / schema:** none. **Effort / risk / blast radius:** minutes inside M2. **Grounding findings:** pass 2 confirmed 3-0; verified by reading upstream at 61aa957.

---

## Decision 10 — Sequencing the M1 wave against in-flight M2 and M3

**Verdict: GATE (A)**

### Plain English
- **What's at stake:** three worktrees branch from the M1 commit `56b651a`: `m2-loop` (share/install/uninstall/sync/search, uncommitted) and `m3-team-layer` (invite/ls/remove/README, uncommitted, under hybrid review at the time of this walk). Decisions 1, 2, 4, and 5 rewrite `auth.ts`, `login.ts`, `team.ts`, `cli.ts`, and the config schema, which those runs also edit; M2's install and sync read the token field Decision 2 removes.
- **Why it's a fork:** land M1 first and both runs rebase across conflicts and re-review; land it after and it is one clean pass over the wider tree.
- **Options:** **A —** M2 and M3 first, then the M1 wave; carve out the `remote.ts` security fixes and the four `--` separators to go on main now. **B —** M1 wave now, others rebase. **C —** fold the M1 decisions into the running sessions.
- **Recommendation and call:** A. **Zoom-out:** this is the fastest-to-M2 pick by construction; the carve-out keeps the two argument-injection and credential findings from waiting behind two merges.

### Technical
- **Carve-out now (small branch off main, own review):** `normalizeRemote`/`remoteToGitUrl` reject a leading `-` and `<helper>::` forms and strip userinfo; `--` before the remote at `teamRepo.ts` (`git clone`), `team.ts` (`ls-remote`, `remote add`), `auth.ts` (`ls-remote` probe, until Decision 2 deletes it); redact remotes in messages; tests in `remote.test.ts`. Files M2/M3 do not modify, apart from two call-site hunks in `team.ts` that merge cleanly.
- **After M2 and M3 land (the M1 wave):** Decisions 1, 2, 4, 5, the rest of the pass 2 mechanical list, and the rev 9 spec text from Decisions 3 and 6.
- **Tripwire:** the wave starts the day both `m2-loop` and `m3-team-layer` are on `origin/main`. If either slips past a week, revisit whether the wave should go first after all.
- **Grounding findings:** `git worktree list` and per-worktree status on 2026-09-04; hybrid-review relay processes for `m3-team-layer` were live during this walk.

---

## Decision 8 — Review artifacts committed in the repo

**Verdict: LOCK (A)**

### Plain English
- **What's at stake:** commit `56b651a` carries four files under `.planning/reviews/`: two reports and two "proposed patches" files that were never applied and are already wrong against the code. Pass 2 spent three findings arguing with the patches.
- **Options:** keep reports, drop patches; drop all four; keep everything. **The call:** keep reports, drop patches; the pass 2 patches file is not committed (removed from the worktree in this walk), the pass 2 report is kept.
- **Zoom-out:** removes reviewer noise at zero product risk.

### Technical
- **Files:** delete `.planning/reviews/working-2026-09-04.patches.md` and `.planning/reviews/hybrid-working-2026-09-04-pass1.patches.md` on main, in the same small branch as the Decision 10 carve-out. Keep `working-2026-09-04.review.md`, `hybrid-working-2026-09-04-pass1.review.md`, and add `hybrid-working-2026-09-04-pass2.review.md`. Future `/hybrid-review` runs on this repo should exclude `.planning/reviews/` from the manifest (the reviewed diff should be code and specs, not prior reviews).

---

## Decision 9 — Placeholder Action in every team repo

**Verdict: LOCK (leave it)**

### Plain English
- **What's at stake:** every team repo gets a workflow that runs a do-nothing job on each push and PR, on billed minutes, until M3 ships the README generator.
- **Why it stopped being a fork:** the `m3-team-layer` worktree is replacing that workflow now, and M3's own hybrid review is already checking the new file's permissions.
- **The call:** leave it; M3 replaces it.

### Technical
- **Files:** `WORKFLOW` constant in `src/commands/team.ts` — owned by the M3 change. **Note for M3's review:** the finding about `contents: write` inherited by the PR job is the one that matters; the placeholder's cost is moot once it lands.

---
