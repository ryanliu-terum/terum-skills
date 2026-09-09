# S7q review notes

The adapter caches the last hello from any CLI run. A concurrent first features/capabilities read shares one status process; missing keys are false. S7af's unavailable read surfaces stay unavailable, including status counters and clone-state data until their owning batches provide them.

## Cover notes for the maintainer's PR

- AC-07 is refused: `guardTeam` admits exactly rows c/d/e, and `categories` is written once at scaffold time (`const team: Team = { …, categories: CATEGORIES, … }`). Category icons remain an app-side fixed table with a neutral `tag` fallback. The fallback is separate from the 53 verbatim canvas paths.
- CP-14 is refused for the same ownership reason. Project description/icon fields stay hand-maintained in team.json; S7p documents them. No CLI or team metadata mutation was added.
- The fidelity gate runs browser mode (`cosmetic`), so it does not test the two platform headers. Vitest checks the CSS box-model inputs for mark-slot x=76 in cosmetic/mac-overlay and x=16 in native, not rendered native pixels.
- `tauri.conf.json` already has decorations=true and the required macOS-only Overlay/hiddenTitle/trafficLightPosition fields. Windows therefore keeps its native title bar. Minimum dimensions remain 960×600. No configuration or Rust source edit was needed.
- The installed public `getCurrentWindow().toggleMaximize()` invokes `toggle_maximize`, which requires `core:window:allow-toggle-maximize`; the spec names the different internal permission. Both permissions are retained. Explicit mouse handlers stop propagation so Tauri's built-in drag handler does not maximize a second time.
- The installed `opener:default` includes unrestricted default URL schemes. It was removed in favor of the explicit GitHub-only open-url scope; the separately granted open-path and reveal permissions remain.
- AC-08: S7q owns `copyImage`; its shipped implementation is unchanged. `.shell` and `.onboarding-frame` retain `user-select:none`.

## Maintainer-owned documentation and conservative readings

GAPS.md lines 28–32 and desktop/AGENTS.md invariant 2 need to explain that hello-backed features now have UI consumers: `disablePerMachine` maps directly, `perCase` maps to `perCaseEvalTables`, missing switches are false, and inboxEventLog/offtargetKind/machineRegistry remain hard false on native. Mock flags remain true. No maintainer-owned document was edited.

Settings currently draws one combined Alert kind row (missing/off-target/local/regression), not a separate off-target row. The combined Settings row and off-target Inbox rows are hidden when offtargetKind is false; splitting it would require a new design. Share's current header is “Last seen,” so that header is preserved while unsupported cells show a dash.

Onboarding Basics → Eval already contains only the committed-receipt illustration, with no Run eval button or dialog. It is preserved, including its terminal hint. Progress is exposed for S7r, with no S7r consumer implemented here.

The clone-state requirement names “six” states but enumerates seven cases if all three incomplete reasons and ok-but-unreadable are counted. All seven are tested. `describeClone` itself returns structured states; wording comes from the CLI status renderer. The two ordinary incomplete reasons share the CLI's sentence. Optional cloneState/readable fields carry future status data to Settings and the footer without fabricating a native read model; absent fixture state preserves the boards.

Catalog repository identity is now explicit and nullable, supplied by the mock from its team fixture. The project external URL comes from project.remote; the label retains the catalog's team-repository identity. The person rail uses that same repository identity. Unsupported hosts have no fabricated GitHub target.

Account's logged-out branch now hands off through an explicit terminal-command popup with a Copy button. The existing openInEditor adapter is a file opener; sending it `gh auth login` would fail, and no terminal-launch seam is specified. The command is not executed by the app, and credentials are neither probed nor changed. This conservative reading was asked about during implementation and is recorded pending an answer.

## Verification limits

No git, network, dependency installation, or Playwright commands were run. The existing tauri.conf.json was read and asserted, not modified, so cargo check is not required by S7q. Native execution and the 88-board fidelity gate remain maintainer checks.

Final desktop gates: `npm run typecheck` passed; `npm run lint` passed with zero warnings; `NODE_OPTIONS=--no-experimental-webstorage npm test` passed 50 files, 606 tests passed and 88 skipped (694 total). Baseline was 45 files, 537 passed and 88 skipped (625 total). `seam.test.ts` is unchanged. One intermediate full run timed out in the unchanged Dialog test; it passed in isolation and subsequent full runs.

CP-13 explicitly changes the visible “New skill” CTA to “Connect,” including mock mode. Feature true-state markup is otherwise preserved; a maintainer must reconcile this requested copy change with the locked-board oracle.
