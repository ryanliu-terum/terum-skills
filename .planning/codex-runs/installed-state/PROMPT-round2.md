# Follow-up round 2: SCOPE CHANGE (revert §5), spec addendum §9.2, two review fixes, gate fixes

You already implemented §1–§8 of the installed-state spec in this working tree (read
`.planning/codex-runs/installed-state/PROMPT.md` for the full spec, the standing constraints and the pre-resolved
decisions; every rule there still applies: read `AGENTS.md`, `CLAUDE.md`, `desktop/AGENTS.md` first; no git, no
network, no `npm install`, no Playwright; keep every locked board pixel-identical on the mock; never weaken a test
except where this prompt tells you to DELETE tests that belong to the reverted §5; final answer is the JSON report
matching the output schema). Do NOT redo §1–§4, §6, §7. Build on the tree as it is.

## A. Scope change from Ryan (2026-09-09): §5 is OUT — revert it completely

Ryan re-ruled the Library/project model (the Library becomes the member's personal library built from local disk;
checkout registration and install destinations will be defined by a follow-up spec). For this batch: **§5 (the
`machine:projectRoot` pref, the Settings ▸ This machine "Project checkout" row, the `Surfaces.projectRoot` flag,
the `Settings.projectRoot` field, the invalidation subscription, the read/write cwd split) is removed from scope.**
Keep today's cwd behaviour exactly as on origin/main and do NOT add a pref.

Revert every §5 hunk, restoring the origin/main text where that is what remains:

1. `desktop/src/backend/prefs.ts`: remove `'machine:projectRoot'` from `isChromePreference`.
2. `desktop/src/backend/tauri/run.ts`: restore `cwd?: string | undefined` (no Promise) and the original spawn
   sequence (`started = true; unlisten = await bridge.spawn(id, resolved, argv, options.cwd, onEvent);`).
3. `desktop/src/backend/tauri/index.ts`:
   - restore `const cwd = () => backend.prefs.get<string>('workspace', '') || undefined;` and the original
     `run(argv, schema, map, touches = ['config', 'placed'])` signature that passes `cwd: cwd()`; drop `scanCwd`
     and every `{ cwd: home().then(...) }` / `{cwd:scanCwd()}` argument at every call site (restore the original
     four-argument / three-argument calls, including the default `touches` for install/uninstallSkill/uninstallMachine);
   - drop the `machine:projectRoot` subscription block (`previousProjectRoot` / `backend.prefs.subscribe`);
   - `surfaces()` no longer returns `projectRoot`;
   - `settingsModel` returns to its three-parameter form (no `pref`, no `lines`, no `projectRoot` field);
     `readModels` and `read()` return to their original signatures (no `lines` collection);
   - keep everything from §3/§4/§6 (`onDisk`, `inventoryCard` with `placed`/`onDiskOnly`/`paths`/`projectRoots`/
     `connectedSources`, `inventoryDetail`, `catalogModel` with `scanned`, `installable`, `cliLocalRow`'s three
     optional keys, `cliLs.member.installed`, `notOffered.skillId`, `cliConnectResult.adopted`, `cliLocal.repoRoot`).
4. `desktop/src/backend/types.ts`: remove `projectRoot` from `Surfaces` and from `Settings`. Keep `localIdentity`
   in `FEATURE_KEYS`, the `SkillCard`/`Person`/`Catalog`/`Library`/`ConnectResult` additions.
5. `desktop/src/backend/mock/index.ts`: remove `projectRoot:false` from `surfaces()` and `projectRoot:null` from
   `settings()`. Keep the `on-disk-only` scenario and `scanned:null`.
6. `desktop/src/screens/settings/SettingsContent.tsx` and `SettingsScreen.tsx`: remove the `projectRootEnabled`
   prop, the `projectDraft`/`projectError` state, `saveProjectRoot`, and the "Project checkout" Group. Restore
   the `Props` type and the `case 'machine'` block to origin/main.
7. Tests: delete the §5-only tests and expectations — `run.test.ts`'s "known-home cwd coverage" cases,
   `index.test.ts`'s `projectRoot` surface expectation and any `machine:projectRoot` / scan-cwd / install-cwd
   cases, `mock.test.ts`'s `projectRoot:false` / `projectRoot:null` expectations. Restore those files' original
   expectations where the §5 change was the only edit. Declare each deletion in `testsModified` with the reason
   "§5 removed from scope by Ryan's 2026-09-09 ruling".
8. `desktop/GAPS.md`: replace the sentence you added about `machine:projectRoot` and the read/write cwd rule with:
   "Checkout registration (which local checkouts the app scans, and which folder an install lands in) is owned by
   the follow-up batch implementing Ryan's 2026-09-09 Library-model ruling; until then the real adapter inherits
   the CLI's cwd and reads only the roots `ls --local` discovers from it." Keep the notOffered-with-id sentence.
9. `desktop/src/components/domain/ScanCoverage.tsx`: the "Add a project checkout" link pointed at the removed
   Settings row — drop the link (keep "Scanned: <roots>" and the on-this-machine/placed counts).

§9.1 (sidebar counts from the scan) is ALSO out of scope — do not implement it.

## B. Spec addendum §9.2 — path-true strings (IN scope)

- `desktop/src/screens/skill/SkillScreen.tsx`: the SKILL.md meta line ("… · read from …") today prints the literal
  `~/.claude/skills/${s.name}` for an installed skill; make it read from the resolved occurrence path — the
  detail's `path` (the placed row's path, else the first present row's path, per §3), home-abbreviated with the
  existing `abbreviateHome` helper in `desktop/src/backend/paths.ts` (the adapter already abbreviates; the screen
  must not re-derive a literal). Never print `~/.claude/skills/<name>` unless that is the resolved path.
- The Remove button's aria-label and the Remove dialog copy (`"Remove from Global"` today) say
  `"Remove from <scope>"` from the placed row's scope (`Global` for a global placement, the project scope label
  otherwise — use the detail's `scope` field), and stay hidden for present-only copies (§1, already done).
- `desktop/src/screens/library/LibraryScreen.tsx`: the scope resolver `['Global','Terum','SSM','MRF'].find(...)`
  drops the fixture names and resolves only `Global` / `installed` / the names in `data.projects` (falling back to
  the route scope as typed). Verify the mock boards do not change: the mock's `library()` returns the drawn
  project names in `data.projects`? — check `desktop/src/backend/mock/index.ts` `library:`; if the mock's Library
  DTO carries no `projects`, add `projects` to the mock's library value from `design.PROJECTS` (name/skills/remotes)
  so `Terum`/`SSM`/`MRF` still resolve on the mock and the `LibraryScreen` boards render as before.
- Tests: a skill detail whose only occurrence is in a project root shows the repo path in the meta line (screen
  test with a stubbed backend, like your `installed-screens.test.tsx`); fixture names do not resolve as scopes on
  the real backend (a resolver unit test or a screen test with `projects: []`).

## C. Two review findings from the orchestrator's read of your round-1 diff (fix both)

1. `desktop/src/screens/marketplace/MarketplaceScreen.tsx` `DetailPage`: you wrote
   `const installed = (q ? q.installed : !!p && c.scanned===null && personStatus(p)[0] === 'Installed');`.
   The `c.scanned===null` clause makes the person page never reach the installed state on the real adapter
   (where `scanned` is always an array), contradicting the rail that says "Installed". Drop the
   `c.scanned===null` clause: `installed = q ? q.installed : !!p && personStatus(p)[0] === 'Installed'`. If a
   mock board changes because of it, say exactly which and why in `deviations` rather than restoring the clause.
2. `desktop/src/components/domain/ScanCoverage.tsx` — covered by A.9 above (drop the dead link).

## D. Gate fixes from the orchestrator's own round-1 gate run

(Appended below this line if any test failed; if nothing is appended, round 1's lint/typecheck were green and the
test suites were still running — re-run the desktop suite yourself after this round and report real counts.)

Round-1 gate results (orchestrator): root lint/typecheck/build green; desktop lint/typecheck green; desktop vitest 941 passed, 88 skipped, 0 failed; root vitest 1269 passed, 1 failed — `src/lib/__tests__/teamRepo.test.ts` "lands eight barrier-released writers within the deadline" (a timing-bound safeWrite test in a file you did not touch, run under CPU contention; the orchestrator is re-running it in isolation). Nothing to fix from the gates.
