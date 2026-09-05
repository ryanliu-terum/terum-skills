Run the review → fix → re-review loop: **up to N full rounds of `/hybrid-review` (code) or `/codex-spec` (spec), applying the triage-approved fixes between rounds, ending in a converged end state.**

Follow `.claude/skills/harden/SKILL.md` — it owns the full procedure (lane detection, the stable-base rule for code targets, the per-round validity check, the apply wave, the ledger, the computed stop verdict, and the end-state report). Do not re-derive those steps here.

`$ARGUMENTS` is `<target>` plus loop flags plus anything the underlying skill accepts:

- **Target:** a spec path (`.md` → spec lane), a PR number, `--working`, or nothing (current branch → code lane).
- **Loop flags:** `--rounds N` (cap, default 3) · `--confirm` (pause for one yes per mechanical batch and one yes per clear fix) · `--base <ref>` (code lane: the commit the work starts after; required when the work sits on `main`) · `--lane code|spec` (override).
- **Everything else passes through** to `/hybrid-review` or `/codex-spec` verbatim (presets, `--verify`, `--effort`, `--tier`, `--dims`, …). `--codex-verify` and `--no-logs` are forced on the code lane.

Examples: `.planning/specs/foo.md` · `.planning/specs/foo.md --rounds 2 --effort xhigh` · `123 --confirm` · `--working` · `--base abc1234 --in-depth`

Three things that are easy to get wrong and matter:

1. **Never count an invalid round.** `relayFailures > 0`, `panelValid: false`, or any `finderFailures` → record it as invalid and re-run the same round number via `resumeFromRunId`.
2. **The apply set is triage's mechanical + clear buckets, critical/high (code) or BLOCKER/DRIFT (spec) only.** Mediums, contested, unverified, forks and declines are never applied, in any mode.
3. **One commit per round, by explicit path.** Never `git add -A`, never push.
