# S7k implementation notes

Status and Settings are served from offline status, ls --local, and host_platform. The frame recordings were regenerated from this worktree's rebuilt CLI using fixture.sh in this run directory; the fixture uses only scratch repositories.

## PR-body reading rules (verbatim)

the value is never rewritten (no skew correction); `null` does not mean "never synced" (`team leave` deletes the stamp); a non-empty `pending` beside an old `syncedAt` means the last run left work undone and the remedy is `sync`, not an error.

## Recorded presentation calls

The locked S7k spec maps `pr` to "Pull request", `push` to "Push", and `skill_license` to `license`. Categories are team.json strings; the real DTO's categoriesNote is "From team.json; an admin extends it by pull request." The mock supplies the existing board sentence through the same DTO. `misc` is the seventh scaffolded category.

## Forks / maintainer follow-up

- ghState currently probes auth status. S7k explicitly prohibits that probe: status uses a new presenceOnly option; existing authentication callers retain their behavior.
- Account's required presence-only labels replace the drawn signed-in claim on both backends. This conflicts with absolute mock pixel neutrality; no backend/platform branch was added to components. Maintainer confirmation requested.
- The machine DTO currently calls its display field name, while S7k names hostname. Both are carried, empty in the real backend pending S7r.
- Settings' Projects row formerly depended on catalog. TEAM_POLICY.projects now preserves mock names and carries null in the real adapter pending a real project read model.
- SHARED_SPECIMEN is a board example, not real data. It is nullable and null in the real adapter; the mock retains its specimen. Additional presentation-only arrays not supplied by this batch remain empty.
- GAPS.md and backend/tauri/README.md remain maintainer-owned. Retire their status/settings blanket-gap lines and re-anchor the remaining field gaps to S7f/S7g/S7l/S7s/S7e/S7r. No design canvas, route or pixel gate was run.
- Terum decision MCP tools were not available in this session. The locked supplied spec and local governing decisions were used.

## Verification history

- Desktop final full suite: 45 files passed; 546 tests passed, 88 skipped (634 total). Typecheck and lint passed.
- Root initial full suite: 1,148 passed, one source-literal catalog mismatch after extracting joinLines. Updated only the exact catalog entry; the tripwire then passed.
- Root second default-concurrency full suite: 1,148 passed, one unchanged safeWrite eight-writer test exhausted its deadline. That test passed in the initial full suite. Neither safeWrite nor its test/deadline was changed. An isolated replay and a full suite with four test workers follow to check whether contention is responsible.
- S7f's grants contract is a normalized string on LsSkill, not an array on LocalSection.rows. The Settings comparison consumes that declared string and hash; missing fields become null, and the current recorded ls --local payload produces no approval rows.
- The scratch fx directory was removed after recording; fixture.sh can recreate it. The two JSONL recordings remain self-contained replay inputs.

- Root isolated eight-writer test passed (1 passed, 34 filtered/skipped), 13.89 seconds inside the test.
- Root full suite with `npm test -- --maxWorkers=4`: 72 files passed, 1,149 tests passed, no skipped tests, 382.46 seconds. This caps concurrent test files only; the eight writers and their original deadline remain unchanged.
- No maintainer response to the Account copy fork was received during implementation. The presence-only requirement remains the conservative choice, and absolute mock pixel neutrality is not claimed.

- Final root lint, typecheck and build all exited 0 after the catalog update. Final desktop typecheck and lint also exited 0. No Playwright, installs, network operations, repository git operations, commits or pushes were performed.
