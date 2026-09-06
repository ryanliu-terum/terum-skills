# Phase 1 landing — deferred issues register (2026-09-04)

Everything built for phase 1 was merged to `main` on Ryan's instruction to ship what exists so phase 2 and phase 3 can start in parallel. **Every known issue below is deferred, not fixed.** Fix forward in follow-up PRs; nothing here was silently dropped. Pointers name the report that holds the evidence and the fix.

> **Update 2026-09-05:** PR #1 (`m1-wave`, merged `121e95a`) and PR #2 (`m3-publish-leave`, merged `765032c`) landed. Sections A, C (critical), F, and G are CLOSED below; E loses `publish` and `team leave`; B keeps its spec gaps, now scheduled as one sweep. Every item that needed Ryan is ruled in `.planning/decisions/2026-09-05-phase1-closeout-decision-walk.md`.
>
> **Update 2026-09-06:** the D9 sweep (PR #4, `fde2613`), `setup` + the §8 hook installer (PR #5, `988f26d`), the close-out walk follow-ups (PR #3, `d26925f`) and the Astra harden loop over all of it (PR #6, `81bf9a6`: 17 high fixes, two passes, converged — `.planning/harden/phase1-harden.md`) are open and mergeable; the close-out that fixes every medium, gap and contested item the loop left is PR #7 (`.planning/harden/phase1-closeout.md`). Section B is CLOSED below; E is reduced to M4 and the acceptance run. Still Ryan's: the two harden forks, the contested `publish/<name>-2` vet (all three in `.planning/debug/harden/phase1-harden.deferred.md` and the harden end state), the merges, and the npm placeholder.

## A. Security carve-out (`d219e0a`) — CLOSED 2026-09-05: all seven landed in PR #1 (`af0bce8`; local-path remotes keep `.git`, §5.1 rev 9)
Report: `hybrid-working-2026-09-04-carve-out-pass2.review.md` (dispositions + recommended fixes at the top).
- **HIGH** `redact()` cannot cross a `/`, so a pasted password containing `/` is echoed in the "Unsupported remote" error. One-line greedy-regex fix + a `/`-bearing secret in the test `SECRETS`.
- **MEDIUM** `team create` strips before it validates: an option-shaped `--remote` containing `user:pass@` can be rewritten into a valid remote. Validate `args.remote` first, as `team join` does.
- **MEDIUM** file branch not idempotent (`/tmp/.git` → `file:/tmp/`).
- **MEDIUM** vacuous `remoteToGitUrl` assertion in the rejection loop; `teamRepo.ts` redaction untested.
- **LOW** option-shaped ssh login / scp path re-emitted; `remoteName` splits on `:` unconditionally.
- Contested: ssh login dropped for single-label hosts (2-1); `login --remote` has no credential notice (1-2, moot once Decision 4 lands).

## B. M2 the loop (`9d1cdf2`) — CLOSED 2026-09-06: the D9 sweep landed on branch `m2-sweep` (PR #4, `fde2613`); the two test-hygiene leftovers landed in the close-out (PR #7)
**Scheduled (D9, 2026-09-05) and built:** the whole section — spec gaps, hygiene items, rename propagation (§5.3), plus `uninstall member|project` in one write (PR #1 contested 4b) — went as one sweep on its own branch, in parallel with `setup`, then through the Astra harden loop with everything else (PR #6).
Report: `hybrid-working-2026-09-04-m2-loop.review.md` + `.triage.md`. All 11 critical/high were fixed before landing; the 46 lower findings that were never verified there were re-found or superseded by the whole-phase harden pass (`phase1-harden.hybrid.r1.review.md`) and closed in PR #7.
- ~~`share` does not reject a skill with malformed `allowed-tools` and name the line (§5.4)~~ (PR #4: `inspectSource` refuses and names the line; PR #7 makes the message total via `describeRaw`).
- ~~`search` output omits the latest short version column (§6)~~ (PR #4).
- ~~Author-side rename of a shared skill is not propagated (§5.3); the "blocked: placed version newer than the clone's" sub-case is unclassified (§6)~~ (PR #4; PR #7 orders the rename's foreign-destination check before quarantine).
- ~~`placer.remove()` root guard is tautological at `uninstall.ts` / `sync.ts`~~ (CLOSED: `remove()` refuses any root that is not a skills directory, PR #2 `c09fdb4`, D5a); ~~`search.test.ts` asserts neither installs nor endorsed~~ (PR #4); ~~private-lock-dir helpers untested~~ (PR #7: `skill-target-lock.test.ts`); ~~`install.ts` compares scope by `JSON.stringify` once~~ (PR #4: `sameScope`).

## C. M3 team layer (`83c430d`) — residuals
Report: `hybrid-working-2026-09-04-m3-team-layer.review.md` (pre-fix snapshot; fixes verified in code, but the report has no relayFailures/panelValid line).
- **CRITICAL sub-case — CLOSED in PR #1 (`assertLoginUnclaimed` inside the archive write; its placement after the y/N is D4c, kept):** `team remove` revokes GitHub access using the target's self-declared `github` login without checking that another ACTIVE member does not claim the same login (`assertLoginUnclaimed` from the review's patch #1c is absent). Today only the y/N that names `@login` stands in the way.
- "Org base permissions can still grant read" is undocumented (§6 `team remove`); the invite block advertises `setup`, which does not exist yet.

## D. Unreviewed merges
`2ede68c` (M3 into M2), `62c05d5` (sync hook-stdout fix), and the landing merge itself resolved conflicts by hand in `cli.ts`, `cli.test.ts`, `team.ts`, `teamRepo.ts`, `remote.test.ts` with no review pass. Gates were green at every step.

## E. Phase-1 scope NOT built (spec §2 In, §11)
- **M3 remainder:** ~~`publish` (both policies), `team leave`~~ (landed in PR #2, `765032c`; the branch-reuse rule is D2, implemented exactly in PR #6); ~~the eight-step `setup` wizard (§6.1) with its interrupt-and-rerun cases~~ (PR #5, `988f26d`, via `/codex-implement`, adversarially fixed in PR #6) — `COMMUNITY_URL` = `https://github.com/ryanliu-terum/terum-skills/issues` (D6).
- **M4:** ~~settings.json install of the session-start hook (§8 `hook.ts`)~~ (PR #5); ~~hourly stamp~~ (`run/<team>.stamp`, PR #1); ~~the `sync --hook` mutex (`run/<team>.lock`, §8) and the hourly no-op~~ (PR #8, `hook.ts` + `sync.ts`, §12 "hook mutex" suite); ~~the pre-push guard hook in the clone (D12)~~ (PR #8: `installPushGuard` on every clone, hidden `guard-push` verb, `guardRawPush` in `guard.ts`); ~~npm metadata + publish dry-run at 0.1.0~~ (PR #8: `package.json` 0.1.0, dry run packs 94 files / 143 kB — the publish itself is Ryan's, D7); ~~the fresh-machine three-part-ref bootstrap~~ (PR #8: `install <org>/<repo>/<skill>` on a machine with no team runs `setup` quietly, then installs); ~~the V8 measurement~~ (PR #8: `2026-09-06-v8-reload-measurement.md` — absent in the triggering turn, present next session; the live-session half is still open). **Parked:** the Windows pass (needs a Windows machine; the placer and lock code paths are the same, `it.skipIf(win32)` marks the POSIX-only assertions).
- **§12 acceptance:** the two-person E2E through `setup` on two machines (D8: a teammate, whoever is free first, no Claude rehearsal), the rejoin flow through `setup`, the `hook` / `setup` named suites (`publish` landed with PR #2). **§13 default 39:** decided (D6) — the repo Issues URL; Discord gated on outside users needing each other.

## F. M1 hardening wave — CLOSED 2026-09-05: landed in PR #1 (merge `121e95a`); four contested review items ruled in D4 (4c/4d fixed in the follow-up PR, 4a deferred to the next `team.ts` change, 4b into the §B sweep)
Ledger: `.planning/decisions/2026-09-04-m1-hardening-decision-walk.md`. Decisions 1 (identity reclaim), 2 (retire the PAT path), 4 (bare `login`), 5 (two-question `team create`) plus the pass-2 mechanical list recorded in the ledger and in `.claude/handoff-m1-hardening.md`.

## G. Spec
CLOSED: rev 9 is the spec (PR #1 `6b340b0`, `git mv` over rev 8). D5b amended the §6 `sync` line on 2026-09-05 (clone refresh is fetch + hard reset, shared with `publish`).

## H. Housekeeping
- The M1 tree's vendored `skill-target-lock.ts` said `modified: no` with skillhub's lock-dir name; M2's modified copy superseded it at merge — confirm the merged file carries M2's header and `terum-skills-target-locks-<uid>`.
- Terum's `check_decision` timed out and its token expired during the landing session; the decisions above were taken from the committed ledger, not re-read from Terum.
