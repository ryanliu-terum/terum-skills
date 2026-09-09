Update returns installation-specific advice as data for the desktop app. Machine uninstall discloses retained eval runs and removes downloaded app bundles after consent; onboarding hints use setup and the community link points to Discord.

Ryan: review the root README coverage and the eval-ban removal together in phase-1 build spec §§2, 6.1, 12 and 13 default 41. These four edits document shipped setup behaviour and add no eval implementation.

MC-06 applies to every app-spawned child, including tauri dev: piped stderr, --frames forcing noUpdateCheck, TERUM_SKILLS_NO_UPDATE_NOTIFIER=1, and update registered notices:false. No Rust lifecycle change is needed.

Review notes:

- The report's description reuses the printed release-status lines; latest uses describeUpdate's existing highest valid advertisement/registry observation. No new description wording was specified.
- Show update command uses the existing dialog wrapper at ?dialog=update and preserves advice whitespace. Existing board CSS and generated assets are unchanged; no Playwright gate was run, as required by the batch.
- Native settings/status remain their existing typed gaps on this branch; only surfaces.update is flipped. The maintainer-owned desktop documentation still lists the older adapter gaps.
- The copied fixture uses a local bare remote for the offline recording, so update cannot perform a network probe. Both recorded results succeeded, and update's seven print frames exactly match value.lines; its four advice lines are nonempty and its latest/observation are null/unknown.
- CP-37 also required changing the zero-team expectation in invocation-hints.test.ts for both invocation forms; all other remedies are preserved.
- Gate workers were bounded because host load exceeded 100. Test assertions, timeouts, and skip conditions were not weakened.

Validation:

- Root: npm run lint and npm run typecheck passed; npm test -- --maxWorkers=4 passed 72 files / 1,144 tests; npm run build passed.
- Desktop: npm run typecheck and npm run lint passed; NODE_OPTIONS=--no-experimental-webstorage npm test -- --maxWorkers=1 passed 46 files / 548 tests, with 88 existing conditional skips (636 total).
- Earlier runs exposed the additional CP-37 assertions and timing failures in unchanged dialog/process-cleanup tests. The corrected hint test and unchanged runner test passed together (22 tests); both final full suites passed without changing timeouts or skip conditions.
- No Playwright, network, installs, repository git operations, commits, or pushes. Direct git commands were confined to the authorized local scratch fixture, which was removed after recording; the tests use their own scratch repositories.
