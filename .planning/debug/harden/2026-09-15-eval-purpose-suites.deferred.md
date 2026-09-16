# harden deferrals — 2026-09-15-eval-purpose-suites

Findings the /harden loop settled WITHOUT a fix. The review engines tell their verify and triage
agents to treat entries in `.planning/debug/**/*.deferred.md` as settled deferrals, so a later
round does not spend verify budget re-confirming them. `declined` = a cited reason it is not a
defect; `fork` = parked for `/decision-walk`, NOT resolved. Overrule by deleting the entry.

- [fork] **Unscored row: omitted from per_case (as built in PR A) vs kept visible with passed:null and no outcome for that comparison (#1) vs kept with outcome tie (#2/#12)** — §2.2, lines 97–99 (round 1) — pending /decision-walk; do not re-raise
  reason: three clear recommendations on the same §2.2 paragraph disagree; the loop applied only their common core (field rename per_case/case_runs)
- [fork] **Answer-key leak fix applied as a pathspec-exclusion variant of triage option 1 (key never committed, deleted before any arm) instead of an out-of-sandbox key directory** — §3.3 lines 146–148; §4.1 lines 299–307 (round 1) — pending /decision-walk; do not re-raise
  reason: same outcome as option 1 with bug risk 1 instead of 3 (no new suite field, no env plumbing); Ryan may prefer the literal option 1 or option 2 (.git/info/exclude)
