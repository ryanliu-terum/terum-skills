Run the review → fix → confirm loop: **one full `/hybrid-review` pass, the triage-approved fixes, then fix-scoped confirmation passes over only the fix diff until no critical/high remain (code); full `/codex-spec` rounds until no BLOCKER/DRIFT remain (spec); cap 3 passes; ending in a converged end state.**

Follow `.claude/skills/harden/SKILL.md` — it owns the full procedure (lane detection, the stable-base rule for code targets, the per-round validity check, the apply wave, the ledger, the computed stop verdict, and the end-state report). Do not re-derive those steps here.

`$ARGUMENTS` is `<target>` plus loop flags plus anything the underlying skill accepts:

- **Target:** a spec path (`.md` → spec lane), a PR number, `--working`, or nothing (current branch → code lane).
- **Loop flags:** `--rounds N` (cap on passes, default 3; `--rounds 1` = one review plus the apply wave, no confirmation) · `--confirm` (pause for one yes per mechanical batch and one yes per clear fix) · `--base <ref>` (code lane: the commit the work starts after; required when the work sits on `main`) · `--lane code|spec` (override).
- **Everything else passes through** to `/hybrid-review` or `/codex-spec` verbatim (presets, `--verify`, `--effort`, `--tier`, `--dims`, …). `--codex-verify` and `--no-logs` are forced on the code lane.

Examples: `.planning/specs/foo.md` · `.planning/specs/foo.md --rounds 2 --effort xhigh` · `123 --confirm` · `--working` · `--base abc1234 --in-depth`

Three things that are easy to get wrong and matter:

1. **Never count an invalid pass.** `relayFailures > 0`, `panelValid: false`, or any `finderFailures` → record it as invalid and re-run the same round number via `resumeFromRunId`.
2. **The apply set is triage's mechanical + clear buckets, critical/high (code) or BLOCKER/DRIFT (spec) only.** Mediums, contested, unverified, forks and declines are never applied, in any mode.
3. **One commit per pass, by explicit path.** Never `git add -A`, never push. On the code lane, record `git rev-parse HEAD` before committing a pass — that sha is the next confirmation pass's `--base`; a confirmation pass never widens to the whole tree.
