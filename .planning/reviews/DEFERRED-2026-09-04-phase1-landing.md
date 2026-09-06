# Phase 1 landing — deferred issues register (2026-09-04)

Everything built for phase 1 was merged to `main` on Ryan's instruction to ship what exists so phase 2 and phase 3 can start in parallel. **Every known issue below is deferred, not fixed.** Fix forward in follow-up PRs; nothing here was silently dropped. Pointers name the report that holds the evidence and the fix.

## A. Security carve-out (`d219e0a`) — 7 open findings from its second review
Report: `hybrid-working-2026-09-04-carve-out-pass2.review.md` (dispositions + recommended fixes at the top).
- **HIGH** `redact()` cannot cross a `/`, so a pasted password containing `/` is echoed in the "Unsupported remote" error. One-line greedy-regex fix + a `/`-bearing secret in the test `SECRETS`.
- **MEDIUM** `team create` strips before it validates: an option-shaped `--remote` containing `user:pass@` can be rewritten into a valid remote. Validate `args.remote` first, as `team join` does.
- **MEDIUM** file branch not idempotent (`/tmp/.git` → `file:/tmp/`).
- **MEDIUM** vacuous `remoteToGitUrl` assertion in the rejection loop; `teamRepo.ts` redaction untested.
- **LOW** option-shaped ssh login / scp path re-emitted; `remoteName` splits on `:` unconditionally.
- Contested: ssh login dropped for single-label hosts (2-1); `login --remote` has no credential notice (1-2, moot once Decision 4 lands).

## B. M2 the loop (`9d1cdf2`) — spec gaps and open mediums
Report: `hybrid-working-2026-09-04-m2-loop.review.md` + `.triage.md`. All 11 critical/high were fixed before landing; 46 lower findings were never verified (efficient mode).
- `share` does not reject a skill with malformed `allowed-tools` and name the line (§5.4); it surfaces later as an unapproved grant.
- `search` output omits the latest short version column (§6).
- Author-side rename of a shared skill is not propagated (§5.3); the "blocked: placed version newer than the clone's" sub-case is unclassified (§6).
- `placer.remove()` root guard is tautological at `uninstall.ts` / `sync.ts`; `search.test.ts` asserts neither installs nor endorsed; private-lock-dir helpers untested; `install.ts` compares scope by `JSON.stringify` once.

## C. M3 team layer (`83c430d`) — residuals
Report: `hybrid-working-2026-09-04-m3-team-layer.review.md` (pre-fix snapshot; fixes verified in code, but the report has no relayFailures/panelValid line).
- **CRITICAL sub-case still open:** `team remove` revokes GitHub access using the target's self-declared `github` login without checking that another ACTIVE member does not claim the same login (`assertLoginUnclaimed` from the review's patch #1c is absent). Today only the y/N that names `@login` stands in the way.
- "Org base permissions can still grant read" is undocumented (§6 `team remove`); the invite block advertises `setup`, which does not exist yet.

## D. Unreviewed merges
`2ede68c` (M3 into M2), `62c05d5` (sync hook-stdout fix), and the landing merge itself resolved conflicts by hand in `cli.ts`, `cli.test.ts`, `team.ts`, `teamRepo.ts`, `remote.test.ts` with no review pass. Gates were green at every step.

## E. Phase-1 scope NOT built (spec §2 In, §11)
- **M3 remainder:** `publish` (both policies; safeWrite branch plumbing exists, the verb does not), `team leave`, the eight-step `setup` wizard (§6.1) with its interrupt-and-rerun cases.
- **M4 entirely:** session-start hook (§8: `hook.ts`, settings.json install, mutex, hourly stamp), the pre-push guard hook in the clone (§6.0), the Windows pass, npm metadata + publish dry-run + name reservation at 0.1.0 (`terum-skills` was unclaimed on npm on 2026-09-05 UTC), the fresh-machine three-part-ref bootstrap (`install` currently says "run team join first").
- **§12 acceptance:** the two-person E2E through `setup` on two machines, the rejoin flow through `setup`, the `hook` / `publish` / `setup` named suites. **§13 default 39:** `COMMUNITY_URL` is still empty (Slack vs Discord undecided).

## F. M1 hardening wave — not started; its gate (M2 and M3 on main) is now open
Ledger: `.planning/decisions/2026-09-04-m1-hardening-decision-walk.md`. Decisions 1 (identity reclaim), 2 (retire the PAT path), 4 (bare `login`), 5 (two-question `team create`) plus the pass-2 mechanical list recorded in the ledger and in `.claude/handoff-m1-hardening.md`.

## G. Spec
`.planning/specs/2026-09-02-phase-1-build.md` still says rev 8. Rev 9 (Decisions 1–6 + the §5.1 remote rules) is committed as a DRAFT at `.planning/specs/2026-09-02-phase-1-build.rev9-draft.md`, unreviewed by Ryan; move it over the spec once read.

## H. Housekeeping
- The M1 tree's vendored `skill-target-lock.ts` said `modified: no` with skillhub's lock-dir name; M2's modified copy superseded it at merge — confirm the merged file carries M2's header and `terum-skills-target-locks-<uid>`.
- Terum's `check_decision` timed out and its token expired during the landing session; the decisions above were taken from the committed ledger, not re-read from Terum.
