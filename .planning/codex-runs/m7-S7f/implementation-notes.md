# §6 amendment — S7f

Spec owner and approver: Ryan. Changes remain unstaged; no commit or PR was created, per the standing constraints.

Library and Skill detail now read CLI inventory through the existing bridge. The payload contains verbatim descriptions, normalized grants and their hashes, per-record installers, committed dates, bodies, project registry entries, and member declined IDs. The README reader remains fail-closed. A malformed people file removes its roster row and its contribution to install counts; those historical installs are absent, not an assertion of zero. The returned problems identify these omissions.

## Conservative readings pending clarification

- The read seam previously supplied neither a team argument nor a selected-team store. Library and skill now accept an optional team; team-qualified skill references work too. With no explicit team, the adapter discovers teams through the non-prompting status verb, accepts exactly one, and refuses multiple teams. Every subsequent team-specific read passes --team. This bootstrap status call is the sole unscoped team read.
- The requested payload includes the parsed body but no raw frontmatter or license. The real SKILL.md tab renders that body as Markdown and hides the unavailable frontmatter, rather than synthesizing source bytes. The mock retains its drawn frontmatter and body blocks.
- git ls-tree reports the same missing-object text for an invalid ref and a valid ref lacking skills/. The wrapper uses one child normally and verifies the ref with a second read-only child only on that ambiguous failure. This preserves both empty-tree behavior and genuine git errors; concurrency remains bounded.
- S7g owns structured placement fields. For now installed/path mapping accepts only the explicit, unambiguous placement-recorded sentence in ls --local for the selected team and name. Untracked, connected-source-only, other-team, and conflicting rows are not assumed to be installed.
- Recently updated remains the board's static control: dates are returned, but no sorting or new design behavior is implemented.
- The real adapter has no scope-selection command contract or project-folder registry. The sample scope paths are retained only in the mock; real install confirmation leaves that selector empty and lets the CLI select its target. Tool approval is never pre-answered; the CLI's actual consent question is presented after the initial install dialog closes.
- Favorites and line counts are null when unavailable. The full version hash and eval report numbers are likewise null; a short hash is not represented as a full version. Missing repository data is null. No sample eval statistics or provenance caption is used.

The tauri README still describes Library and Skill detail as unavailable. It is maintainer-owned for this task and was not changed. GAPS.md/FIDELITY.md and generated design files were not edited. No Playwright, network access, dependency installs, repository git commands, commits, or pushes were run. The supplied fixture script ran git only inside its scratch fixture.

## Validation

The CLI was rebuilt and status, ls, ls --local, ls project terum, ls member mira, search, and validate deploy-check frames were re-recorded from the supplied fixture against this worktree. Replay tests exercise Library, Skill detail, project/installed scopes, and actual rendered screens. The final JSON report records the required gate counts; the 88 design-dependent Vitest cases skip without the external design canvas, and no pixel result is claimed.

Final required gates: root lint and typecheck passed; root tests 72 files / 1,147 passed; root build passed. Desktop typecheck and lint passed; desktop tests 46 files / 549 passed, 88 design-dependent skipped (637 total). The 3 recorded-data screen tests and 4 frame replay tests passed within that suite. Scratch fixture removed after re-recording; fixture.sh recreates it.
