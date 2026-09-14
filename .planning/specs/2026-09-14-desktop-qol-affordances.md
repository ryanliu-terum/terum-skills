# Desktop quality-of-life affordances (2026-09-14)

Teddy, 2026-09-14: "Go through all of the settings subcards upon click and make sure all of those are also up to par in fidelity, depth, and quality (icons, formatting, etc. when needed). Also crawl through the app in general for any basic quality of life updates (easy copy, click, drag, right click, etc.)"

Branch `feat/desktop-qol` (worktree `~/Projects/terum-skills-codex/w-qol`, based on `feat/desktop-ui-polish` e52da15). Every change below is pixel-neutral on every board: measured by rendering the 16 Settings boards plus Main, Light, Library, LibraryLight, SkillDetail, SkillDetailLight, SkillDetailFiles, SkillDetailInstallLight, Inbox, InboxLight, Share, ShareLight, Marketplace, MarketplaceLight and MarketplacePerson at the base commit and on the branch (`FIDELITY_ALL=1`, port 1421) and comparing `diffPixels` per row, all equal.

## 1. What the Settings audit found

The 15 Settings boards with an oracle were rendered against the canvas (`e2e/out/fidelity/rows`). Every red region is a ratified deviation the canvas has not redrawn yet (Updates policy, Evals overnight row, Sync auto-fetch copy, one-team-per-machine Team card, D22 inbox kinds, B6 Advanced copy): FIDELITY.md already records each. Two facts worth stating:

- The Machine board's prune hint prints `npx -y terum-skills@latest prune`; the canvas prints `sync --prune`. The CLI's verb is `prune` (`src/cli.ts`), so the app is right and the canvas is stale.
- `SettingsPublishing` has no oracle: the canvas still ships `SettingsSharing.png`. The fidelity spec throws ENOENT on that row under `FIDELITY_ALL`; the locked gate never reaches it. The canvas owes the rename.

On the real adapter the sections are shallower than the mock by design of the CLI's `status` payload: `QUARANTINE` is null ("not reported by this terum-skills version"), `STORAGE` sizes and counts are `—`, `AGENT_CLI` is `—`, `CLI_LATEST` is null and `FOLLOWING` is empty. Those are CLI asks (a `status --json` that reports quarantine entries, cache/evals byte sizes, and the `claude` CLI version), not app work; recorded in GAPS.md.

What was wrong in the app itself, and is fixed here:

- Settings ▸ Appearance ▸ Keyboard printed `⌘K`, `⌘,`, `⌘R`, `⌘[ · ⌘]` on Windows and Linux hosts (the real adapter copies `SHORTCUTS` verbatim). `chordLabel(windowChrome, chord)` spells them `Ctrl+K` etc. when the seam reports `native`.
- Every "Show in Finder" button and menu row said Finder on Windows. `revealLabel(machine.os)` returns "Show in Explorer" on Windows, "Show in Finder" on macOS (and when the host is unknown), "Show in file manager" elsewhere. Sites: Settings (Local state, Run trees), the machine-removal result dialog, and every new menu row.

## 2. Right-click menus (app-wide)

`src/components/domain/ContextMenu.tsx` (`ContextMenuProvider`, `CopyValue`) and `src/components/domain/context-menu.ts` (`useContextMenu`, `useContextMenuFor`, `useCopy`, `useHostReveal`, `suppressesNativeMenu`). One document `contextmenu` listener resolves the click to the nearest registered ancestor and opens a Base UI menu (`.floating-panel.context-menu`) anchored at the pointer; Shift+F10 / the Menu key anchor at the target. Disabled rows carry their reason exactly like the card's ⋯ menu; `Delete…` is red (`data-danger`). Where nothing is registered: a text field or a live selection keeps the host's own menu; otherwise, inside the Tauri shell only (`windowChrome !== 'cosmetic'`), the webview's Back/Reload/Save-as menu is suppressed so the app never shows a browser menu. The browser mock keeps it so dev tools stay reachable.

Targets:

| Where | Rows |
|---|---|
| Skill card (Library, Marketplace) | the ⋯ actions, then Copy name · Copy path · Show in Finder · Open in editor (path rows only when the card has a folder; editor only when `capabilities.openInEditor`) |
| Skill detail title | Copy name · Copy install command · Copy path · Show in Finder · Open in editor |
| Sidebar Global row | Show in Finder · Copy path |
| Sidebar project row | Show in Finder · Copy path · Manage projects… (→ `#/settings/machine`) |
| Every `TerminalHint` and `CliBox` | Copy command |
| Settings ▸ Team card | team row: Copy remote; Clone row: Show in Finder · Copy path |
| Settings ▸ This machine | placement rows: Open <skill> · Show in Finder · Copy path; approval rows: Open <skill>; quarantine rows: Show in Finder · Copy path (`~/.terum/skills/quarantine/<when>/<name>`); project rows: Show in Finder · Copy path |
| Settings ▸ Evals ▸ Run trees, Advanced ▸ Local state / Pinned checkouts / Eval runs | Show in Finder · Copy path |
| Settings ▸ About ▸ every Versions row | Copy all versions (the block a bug report needs: app, CLI (+ available), agent CLI, platform) |
| Inbox item | Open <skill> · Copy skill name |
| Members row | Open profile · Copy handle · Copy name |

Copy outcomes show in a transient toast (`.copy-toast`, `role=status`, 1.6 s; the seam's error as `role=alert`, 4 s). The toast is `position:fixed` and never on a board.

## 3. One-click copy and clickable rows

- `Value mono` in Settings (paths, handles, hashes, `--setting-sources project`) and `LockedValue` render through `CopyValue`: the same span with `role=button`, `title="Click to copy"`, `cursor:copy`, Enter/Space; the About versions and the detail rail's Version copy the same way. A span, not a `<button>`, because the rows style their value through `span` selectors; a button moved ~900 px on the SkillDetail boards and was reverted to a span.
- Placement rows (Settings ▸ This machine) open their skill on click, Enter or Space (`tabIndex=0`, `aria-label="<skill> at <path>"`, `cursor:pointer`, the existing hover tint). The path cell's tooltip is now `<skill> · <full path>` (it was the skill name alone, so a truncated path could not be read).

## 4. Text selection

`.shell` keeps `user-select:none` for the chrome, controls and card frames. Prose and values are selectable again (`app.css`, one rule): SKILL.md tab, detail description and rail values, error lines, terminal hints and CLI boxes, every Settings value/title/description/note, placement cells, prune list, card descriptions, inbox document/fields/subject/row content, member identity, marketplace project/person lines, search rows, centered-state bodies, `pre`/`code`. Dragging selected text is the browser's own.

## 5. Drop a folder to add a project

Seam: `Backend.onFileDrop(listener): Subscription` with `FileDropEvent = {kind:'enter',paths} | {kind:'leave'} | {kind:'drop',paths}`. The Tauri adapter forwards `getCurrentWebview().onDragDropEvent` (Tauri keeps `dragDropEnabled`, so OS drops never reach HTML5 handlers); outside the shell the subscription is inert. The mock folds window `dragenter/dragover/dragleave/drop` and reads `text/plain` lines as paths (a browser never exposes a dropped folder's real path; `dropPathsFrom` is exported and tested).

Library screen: subscribed only while `features.libraryProjects` is true. `enter` draws a dashed overlay ("Drop a folder to add it as a project", `position:fixed`, `pointer-events:none`); `leave` clears it; `drop` runs `projects.add` per path in order through the same `useWorkflow.run` the chooser uses, then the Library's status line says `Added N projects` (+ `· M failed`) and the error line names the first refusal; an empty drop says "Nothing to add: the drop carried no folder path."

## 6. Tests and gates

New: `src/lib/platform-labels.test.ts` (4), `src/components/domain/ContextMenu.test.tsx` (6), `src/screens/settings/qol.test.tsx` (6), `src/components/domain/context-targets.test.tsx` (6), `src/screens/library/file-drop.test.tsx` (3), `src/backend/mock/file-drop.test.ts` (2), `src/backend/tauri/__tests__/file-drop.test.ts` (2). Gates run on the branch: `tsc --noEmit` (clean except `e2e/routes/chip-icon.spec.ts` TS2345, pre-existing on e52da15), `eslint --max-warnings 0` clean, `vitest run --maxWorkers=4` 152 files / 2285 passed / 91 skipped, `playwright test e2e/routes` 158 passed, fidelity subset as above.

Invariants touched: 1 (the seam gains `onFileDrop`; only `src/backend/tauri` imports `@tauri-apps/api/webview`), 5 (no pixel moved; measured), 7 (no test weakened; `Value` gained a `copy` prop and `SettingRow` a `menu` prop).

## 7. Not done here (recorded)

- CLI depth for the real adapter's Settings (quarantine list, storage sizes, agent CLI version, latest CLI): `status --json` fields, Ryan's side.
- Canvas: rename `SettingsSharing.png` → `SettingsPublishing.png`; the prune hint spelling; the ratified Settings redraws already listed in FIDELITY.md.
- Marketplace project/person cards and search rows have no right-click menu yet (the card grid and the members list do).

## 8. Settings ▸ Publishing, comprehensive (Teddy, 2026-09-14: "The publish settings page should be more comprehensive with more options." — "Yes" to all four groups including the dialog changes)

Every row maps onto something the CLI really does; no invented switch. `src/screens/skill/publish-defaults.ts` owns the two preferences and the pure helpers; `PublishOptions.tsx` draws them inside both publish dialogs.

- **Defaults** (per-machine prefs, `publish:target` / `publish:category`): *Publish to* = Ask each time · Global · each team project (`TEAM_POLICY.projects`; a stored project the team no longer has falls back to Ask). *Category* = Model suggests · Ask before publishing. *Eval receipts* is a read-only "Attached automatically" row (publish attaches every local receipt of the exact bytes).
- **Dialogs**: the skill page's publish dialog always draws a *Publish to* choice (starting on the Settings default, or Global when the default is Ask) and, under Ask-before-publishing, a *Category* field with the team's categories as suggestions (empty = the model suggests). The app therefore sends `--project` always and `--category` when typed, so the CLI's own "Which project?" question never appears; the terminal hint shows the exact command. The bulk dialog draws the target once for every row and no category field (categories stay per skill), and says so.
- **Seam**: `PublishArgs.category` → `--category` in the Tauri adapter (index.test.ts argv case). The mock accepts it.
- **Shared from this machine**: the Global Library read (same query key as the Library screen) listed by name with path, the state from the card's own fields (`sharedState`: Not shared · In sync · Edited since publish · Not published yet · — when the CLI predates the byte match) and a *Publish…* button where one is due (disabled with the card's own reason). Loading draws two skeleton rows; a failed read shows the CLI's error line. Right-click: Open · Show in Finder · Copy path.
- **Rules** (read-only, verified against `src/commands/publish.ts`): frontmatter injection, hygiene refusal (folder left byte-identical), the FAIL-receipt gate (a confirm), identical bytes mint nothing, later edits stay local.
- **Nothing automatic**: sync only fetches; publish is the only way out. (Auto-share was removed from the CLI — `team migrate` refers to "the release removing auto-share" — so the GAPS 2026-09-10 auto-share entry no longer describes `sync`.)
- **Not drawn, on purpose**: an opt-out of install records (PF-08, ratified HARD) and a version note (`publish` has no message flag).
- **Fix dialog**: `SkillFixDialog` takes a `publishOptions` slot; while *Republish after fixing* is ticked it draws the same *Publish to* / *Category* controls, so a fix-and-republish asks what the publish dialog asks instead of silently sending the default (merged after #211, which added the dialog).
- **Tests**: `publish-defaults.test.ts` (4), `publishing.test.tsx` (6: the four groups, the folder list and Publish action, the error scenario, the skill dialog with a fixed target + typed category, the Ask default, the bulk dialog); the exact-args publish expectations in `bulk-publish.test.tsx`, `installed-screens.test.tsx` and `skill-detail-screens.test.tsx` now include `project: 'Global'` (declared: the dialog's target is always sent), and the fix test asserts the *Publish to* control.
- **Pixels**: `SettingsPublishing` has no oracle (see FIDELITY.md), and no board in `boards.ts` draws a publish dialog, so nothing measured moves.
