# FIDELITY.md — Gate A status per board

One row per in-scope board (91: every canvas board except the nine *States/*Hovers/*Panes/SkillCard sheets, FigmaDark and MarketplaceNoHero). Status is `todo` | `in-progress` | `locked`; only `locked` rows are asserted by `e2e/fidelity`, and a row is set to `locked` only after its diff passed in the orchestrator's own run. The tolerance column is informational: the authoritative per-class map lives in `e2e/fidelity/tolerance.ts` (screen 0.0030, dialog 0.0035, empty/loading/error 0.0020, full-page 0.0025; Main and Light are exact at 0 differing pixels). Masks: none. A mask may be added only with a written reason in the note column, and a test never reads a tolerance or a mask from this file.

| Board | route+state | status | tolerance | note |
|---|---|---|---|---|
| Main | `#/frame` | locked | 0 | the bare shell (Global selected, empty panel); exact: 0 differing pixels |
| Light | `#/frame?theme=light` | locked | 0 | exact: 0 differing pixels |
| Library | `#/library/global` | in-progress | 0.0030 | hover: the update flag of the card at HOVER_INDEX (the card whose flags contain 'update'); its tooltip shows; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibraryLight | `#/library/global?theme=light` | in-progress | 0.0030 | same hover as Library; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibraryEmpty | `#/library/global?__mock=empty` | in-progress | 0.0020 | sidebar Global count 0; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibraryNoResults | `#/library/global?q=deploy%20prod` | in-progress | 0.0020 | DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibraryLoading | `#/library/global?__mock=loading` | in-progress | 0.0020 | sidebar counts hidden; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibraryCollapsed | `#/library/global?overview=0` | in-progress | 0.0030 | overview hidden; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibrarySidebarHidden | `#/library/global?sidebar=hidden` | in-progress | 0.0030 | D9: sidebar hidden (240 → 0), reopen button in the top bar; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibraryProjectsCollapsed | `#/library/global?projects=collapsed` | in-progress | 0.0030 | D9: Projects chevron-right, project rows folded; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibraryInboxCollapsed | `#/library/global?inbox=collapsed` | in-progress | 0.0030 | D9: Inbox chevron-right, Pushes / Updates / Alerts folded; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| LibraryError | `#/library/global?__mock=error` | in-progress | 0.0020 | sidebar counts hidden; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| SkillDetail | `#/skill/deploy-check` | locked | 0.0030 |  |
| SkillDetailLight | `#/skill/deploy-check?theme=light` | locked | 0.0030 |  |
| SkillDetailRailClosed | `#/skill/deploy-check?tab=evals&rail=closed` | locked | 0.0030 |  |
| SkillDetailUsesHover | `#/skill/deploy-check` | locked | 0.0030 | hover: the '12 teammates use this' facepile; its popover shows |
| SkillDetailEvals | `#/skill/deploy-check?tab=evals` | locked | 0.0030 |  |
| SkillDetailEvalsReport | `#/skill/deploy-check?tab=evals` | locked | 0.0025 | viewport 1440x1900 (the window stretched) |
| SkillDetailQuality | `#/skill/deploy-check?tab=quality` | locked | 0.0030 |  |
| SkillDetailActivity | `#/skill/deploy-check?tab=activity` | locked | 0.0030 |  |
| SkillDetailFiles | `#/skill/deploy-check?menu=files` | locked | 0.0030 | the SKILL.md tab's file menu open |
| SkillDetailNoReceipt | `#/skill/onboarding-tour?tab=evals` | locked | 0.0030 |  |
| SkillDetailPartial | `#/skill/migration-guard?tab=evals` | locked | 0.0030 |  |
| SkillDetailDisabled | `#/skill/deploy-check?__mock=disabled` | locked | 0.0030 | status switch off |
| SkillDetailNotInstalled | `#/skill/deploy-check?__mock=not-installed` | locked | 0.0030 | reached from Marketplace: crumb root Marketplace, sidebar Marketplace selected |
| SkillDetailInstall | `#/skill/deploy-check?__mock=not-installed&dialog=install` | locked | 0.0035 |  |
| SkillDetailInstallLight | `#/skill/deploy-check?__mock=not-installed&dialog=install&theme=light` | locked | 0.0035 | the 88th board, locked 2026-09-08 after the other 87 (63 differing pixels, 0.00005) |
| SkillDetailRemove | `#/skill/deploy-check?dialog=remove` | locked | 0.0035 |  |
| SkillDetailRunEval | `#/skill/deploy-check?tab=evals&dialog=run-eval` | locked | 0.0035 |  |
| SkillDetailLoading | `#/skill/deploy-check?__mock=loading` | locked | 0.0020 |  |
| SkillDetailError | `#/skill/deploy-check?__mock=error` | locked | 0.0020 |  |
| Inbox | `#/inbox` | locked | 0.0030 | first item selected (alert-missing-incident-triage) |
| InboxLight | `#/inbox?theme=light` | locked | 0.0030 |  |
| InboxUpdate | `#/inbox/update-pr-review` | locked | 0.0030 |  |
| InboxAlert | `#/inbox/alert-offtarget-deploy-check` | locked | 0.0030 |  |
| InboxEval | `#/inbox/eval-deploy-check` | locked | 0.0030 |  |
| InboxLoading | `#/inbox?__mock=loading` | locked | 0.0020 |  |
| InboxEmpty | `#/inbox?__mock=empty` | locked | 0.0020 |  |
| InboxError | `#/inbox?__mock=error` | locked | 0.0020 |  |
| Marketplace | `#/marketplace` | locked | 0.0030 |  |
| MarketplaceFilters | `#/marketplace?filters=open` | locked | 0.0030 | filters popover open, 4 facets active |
| MarketplaceLight | `#/marketplace?theme=light` | locked | 0.0030 |  |
| MarketplaceLoading | `#/marketplace?__mock=loading` | locked | 0.0020 | oracle re-shot 2026-09-08 (fallback-font shell), locked in the maintainers' own run |
| MarketplaceNoResults | `#/marketplace?q=deploy%20prod&active=2` | locked | 0.0020 | '2 filters on' |
| MarketplaceError | `#/marketplace?__mock=error` | in-progress | 0.0020 | DEVIATES from the locked canvas since 2026-09-09: interim honest error copy (see Deliberate deviations below); awaiting Teddy's final copy + canvas redraw + re-lock |
| MarketplaceFull | `#/marketplace` | locked | 0.0025 | viewport 1440x1080 |
| MarketplaceProject | `#/marketplace/projects/terum` | locked | 0.0030 |  |
| MarketplaceProjectNotInstalled | `#/marketplace/projects/docs` | in-progress | 0.0030 | DEVIATES from the locked canvas since 2026-09-09: the card's Install button and the marketplace install overlay were removed (see Deliberate deviations below); awaiting canvas redraw + re-lock (+528 px against the maintainers' own oracle run) |
| MarketplaceProjectInstall | `#/marketplace/projects/docs?dialog=install` | in-progress | 0.0035 | DEVIATES from the locked canvas since 2026-09-09: the card's Install button and the marketplace install overlay were removed (see Deliberate deviations below); awaiting canvas redraw + re-lock (+138 px against the maintainers' own oracle run) |
| MarketplacePerson | `#/marketplace/people/ryan` | locked | 0.0030 |  |
| MarketplacePersonNotInstalled | `#/marketplace/people/lena` | in-progress | 0.0030 | DEVIATES from the locked canvas since 2026-09-09: the card's Install button and the marketplace install overlay were removed (see Deliberate deviations below); awaiting canvas redraw + re-lock (+528 px against the maintainers' own oracle run) |
| MarketplaceSkills | `#/marketplace/skills` | in-progress | 0.0030 | DEVIATES from the locked canvas since 2026-09-09: the card's Install button and the marketplace install overlay were removed (see Deliberate deviations below); awaiting canvas redraw + re-lock (+352 px against the maintainers' own oracle run) |
| MarketplaceProjects | `#/marketplace/projects` | locked | 0.0030 |  |
| MarketplacePeople | `#/marketplace/people` | locked | 0.0030 |  |
| MarketplaceCategories | `#/marketplace/categories` | locked | 0.0030 |  |
| MarketplaceCategory | `#/marketplace/categories/infra` | in-progress | 0.0030 | DEVIATES from the locked canvas since 2026-09-09: the card's Install button and the marketplace install overlay were removed (see Deliberate deviations below); awaiting canvas redraw + re-lock (+176 px against the maintainers' own oracle run) |
| Share | `#/share` | locked | 0.0030 | hover: member row index 5 (the sixth row) |
| ShareInvite | `#/share?dialog=invite` | locked | 0.0035 |  |
| ShareLight | `#/share?theme=light` | locked | 0.0030 | same hover as Share |
| ShareLoading | `#/share?__mock=loading` | locked | 0.0020 |  |
| ShareEmpty | `#/share?__mock=empty` | locked | 0.0020 | a team of one |
| ShareError | `#/share?__mock=error` | locked | 0.0020 |  |
| Settings | `#/settings/account` | locked | 0.0030 |  |
| SettingsTeams | `#/settings/teams` | locked | 0.0025 | viewport 1440x1000 |
| SettingsMachine | `#/settings/machine` | locked | 0.0025 | viewport 1440x1340; hover: placement row index 1 |
| SettingsSync | `#/settings/sync` | locked | 0.0030 |  |
| SettingsUpdates | `#/settings/updates` | locked | 0.0030 |  |
| SettingsInbox | `#/settings/inbox` | locked | 0.0025 | viewport 1440x960 |
| SettingsEvals | `#/settings/evals` | locked | 0.0030 |  |
| SettingsSharing | `#/settings/sharing` | locked | 0.0030 |  |
| SettingsAppearance | `#/settings/appearance` | locked | 0.0030 |  |
| SettingsAdvanced | `#/settings/advanced` | locked | 0.0030 |  |
| SettingsAbout | `#/settings/about` | locked | 0.0030 |  |
| SettingsLight | `#/settings/account?theme=light` | locked | 0.0030 |  |
| SettingsLoading | `#/settings/account?__mock=loading` | locked | 0.0020 |  |
| SettingsError | `#/settings/account?__mock=error` | locked | 0.0020 |  |
| SettingsLeave | `#/settings/teams?dialog=leave` | locked | 0.0035 | viewport 1440x1000; Leave button pressed |
| SettingsPrune | `#/settings/machine?dialog=prune` | locked | 0.0035 | viewport 1440x1340; Prune button pressed |
| OnboardingBoot | `#/onboarding/boot` | locked | 0.0030 |  |
| OnboardingWelcome | `#/onboarding/welcome` | locked | 0.0030 |  |
| OnboardingStyle | `#/onboarding/style` | locked | 0.0030 | System picked |
| OnboardingManage | `#/onboarding/basics?tab=manage` | locked | 0.0030 |  |
| OnboardingEval | `#/onboarding/basics?tab=eval` | locked | 0.0030 |  |
| OnboardingShare | `#/onboarding/basics?tab=share` | locked | 0.0030 |  |
| OnboardingSearch | `#/onboarding/basics?tab=search` | locked | 0.0030 |  |
| OnboardingMore | `#/onboarding/basics?tab=more` | locked | 0.0030 |  |
| OnboardingTeam | `#/onboarding/team` | locked | 0.0030 |  |
| OnboardingFeedback | `#/onboarding/feedback` | locked | 0.0030 |  |
| OnboardingDone | `#/onboarding/done` | in-progress | 0.0030 | over the live Library; DEVIATES from the locked canvas since 2026-09-10: Connect CTA removed (see Deliberate deviations below); awaiting canvas redraw + re-lock |
| OnboardingLight | `#/onboarding/style?theme=light` | locked | 0.0030 | Light picked (the picked card is the current theme) |
| OnboardingError | `#/onboarding/boot?__mock=error` | locked | 0.0020 | the first sync failed |

Out of Gate A's scope (the canvas has 99 `.shots`; 88 have a row above): the nine specimen sheets (SkillCard, SkillDetailStates, SkillDetailHovers, InboxPanes, InboxStates, MarketplaceStates, ShareStates, SettingsStates, OnboardingStates), FigmaDark (a third token theme the app does not ship) and MarketplaceNoHero (no route draws the marketplace without its hero). None of the eleven is reachable from an app route, so none can be asserted by `e2e/fidelity`; they stay design-only. SkillDetailInstallLight joined the gate on 2026-09-08 once the other 87 were locked.

## Deliberate deviations after lock (2026-09-09; boards not re-locked)

- Card description text: the real adapter now derives card/detail descriptions from the first SKILL.md body paragraph (`src/lib/body-excerpt.ts`, frontmatter description fallback; teddyzheng's ratified 2026-09-08 decision). The gate renders the mock, which still serves the fixture's `desc`, so the locked pixels are unchanged — the real app's text intentionally differs from the boards.
- Install tri-state: a skill recorded in this user's people file but not on this machine renders "Reinstall" (title "Installed · not on this machine") instead of plain Install, on cards and on the detail actions/status rail. No board draws this state; 'placed' and 'absent' render exactly the drawn installed / not-installed UI. (The whole-card stretched title link itself landed earlier, in the card-click change, and is covered by `e2e/routes/card-click.spec.ts`.)
- The card Install affordances no longer navigate with `__mock=not-installed`; boards that put `__mock` in their own route (SkillDetailNotInstalled, SkillDetailInstall, SkillDetailInstallLight) still render identically — `readScenario` ignores `__mock` only inside the native shell, never in the browser gate.

## Oracle provenance (2026-09-08, the M7 takeover)

The 99 `.shots/*.png` were re-rendered on Ryan's Mac on 2026-09-08 through the canvas's `render-mac.mjs` (a Playwright renderer using the same Chromium channel, device scale, colour scheme, locale and timezone as `playwright.config.ts`) from the unchanged `.dc.html` boards. Teddy's original renders (snap Chromium on Linux, FreeType) differed from the macOS raster (CoreText) in glyph anti-aliasing only, about 3,700 pixels on every board, which alone exceeded the exact and `state` tolerances (85 of 87 locked boards failed here before the re-render; 87 of 87 passed after it, worst 0.00269). The tolerance map and the no-mask rule did not change. Consequence: the oracle is now a macOS raster; a Linux gate machine would have to re-render it there. Teddy's renders are kept beside the canvas as `.shots-linux-teddy-2026-09-08/`.

## Oracle defects found while locking (recorded; the oracle was re-shot, never worked around)

- MarketplaceLoading: the oracle PNG's shell text (top-bar placeholder "Search skills, people, projects", the sidebar's "Library" / "Global" labels) was rasterised in a wider fallback sans (DejaVu-like), not Inter: cropped at 2× it is visibly wider than the same strings in `Marketplace.png`, and an exact pixel comparison of the two oracles differs in the sidebar and top-bar bands (x < 200, y < 60: 4,608 + 337 + 1,923 px) where every other loading board's oracle is identical to its family's base board (InboxLoading vs Inbox: first differing column x = 209). The app renders that shell with Inter, byte-identical to the 80 locked boards, so the board sits at 4,259 differing pixels (0.00329) against a `state` allowance of 0.0020 (2,592 px) and cannot lock without substituting the fallback font on one route, loosening a tolerance, or masking — all three forbidden. Resolved 2026-09-08: the oracle was re-rendered alone (no parallel batch), its shell became pixel-identical to `Marketplace.png` and its content region unchanged; the row locked at the next run. Evidence (2× crops of both oracles) is kept with the maintainers’ run records outside this repository.

## Deliberate deviations after lock

A locked board asserts the app matches the canvas; when the app deliberately moves ahead of the canvas, the affected rows drop to `in-progress` (so the gate skips them instead of failing), the deviation is recorded here with its authority, and the rows re-lock only after the canvas is redrawn and its oracles re-rendered through the established procedure (render-mac.mjs on the maintainer's machine, per the oracle-provenance section above).

- 2026-09-09 — **Marketplace error board stops asserting an invented cause** (interim copy; the final wording is Teddy's design call — the board is not redrawn yet). The canvas board hard-codes "Couldn't reach the team repo" / "terum-skills could not pull terum/team-skills… Check your network and git credentials, then sync again", but the screen renders that text for every catalog failure (no team, parse error, CLI missing), asserting a cause the adapter never reported. PR #121 deliberately left the sentence pending a design answer; until it lands the app says "Couldn't read the marketplace" / "terum-skills could not read the team catalog, so this page shows nothing rather than a stale catalog. The message below is the CLI's own." and leads with the adapter's real error in the ErrorLine (the pattern of the skill-detail failure boards). Layout, actions (Sync now / Open settings) and the ErrorLine are unchanged. Affected row, flipped to `in-progress`: MarketplaceError.
- 2026-09-09 — **The card's Install button and the marketplace install overlay removed; install and uninstall live in the card's ⋯ menu** (Ryan, 2026-09-09, in session). `SkillCard` no longer draws a footer `Install` button and `market-components` no longer draws its `.market-card-install` overlay; both are now one state-dependent `Install…` / `Uninstall…` row in the card's ⋯ menu, beside the new `Move to…` and `Publish to team…` rows. Because the marketplace wrapper hid the card's own button with `visibility:hidden` while it still occupied the footer row, removing it also shifts the flag icons on any board that draws an uninstalled card. Affected rows, all flipped to `in-progress`: MarketplaceProjectNotInstalled, MarketplaceProjectInstall, MarketplacePersonNotInstalled, MarketplaceSkills, MarketplaceCategory. The Library rows already deviate for the Connect CTA and their fixture cards are all installed, so this change moves none of them further (measured: 0 px against the same oracle). Boards whose cards are all installed — Marketplace, MarketplaceLight, MarketplaceFull, MarketplaceProject, MarketplacePerson — are unchanged and stay locked. The five rows re-lock only after the canvas is redrawn and its oracles re-rendered through the established procedure; they join the same queue as the Connect CTA redraw below.
- 2026-09-10 — **Library Connect CTA removed; empty-state primary is Add project** (ratified override, ajay 2026-09-10, `.planning/specs/2026-09-10-library-mirror-id-sync.md`, overriding Terum 52d76c00/85c4ebd2 — Ryan to review). The header `Connect` button and the Library empty state's `Connect` primary are gone from `LibraryScreen`; the empty state's primary is now `Add project` (the native chooser + `checkout add` flow from #102), with `Open marketplace` as secondary. Affected rows, all flipped to `in-progress`: Library, LibraryLight, LibraryEmpty, LibraryNoResults, LibraryLoading, LibraryCollapsed, LibrarySidebarHidden, LibraryProjectsCollapsed, LibraryInboxCollapsed, LibraryError, OnboardingDone (it renders over the live Library). The canvas boards still draw the Connect CTA, so a re-render of the existing `.dc.html` files cannot re-lock these rows — the canvas needs the redraw first (same queue as the relabel item; spec sub-question 3). Connect itself remains drawn and real in Settings ▸ Sharing and the onboarding wizard's connect step; those boards are unchanged.
- 2026-09-10 — **Real-adapter Library subtitle now prints the count alone** (Bugs.pdf W-07 "Unnecessary text", Teddy 2026-09-10). `library()` on the real adapter returned `"N skill folders in <root.label>"` beside a `ViewHeader` title that is already `root.label`, so a checkout header read `teniroo · 32 skill folders in teniroo`; no board draws that shape. It now returns `"N skills"` (`plural(n,'skill')`, the same helper as the search placeholder) plus the ` · N shared with <team>` limb, matching the canvas, the mock (`library_title`) and `.planning/specs/desktop-scoped-stats-and-collapse.md:29`. Mock output is unchanged, so no board moved. The header `meta` slot (path · GitHub state, added deliberately by `dc74a85`) is kept and is not drawn by the canvas's `view_header`; it is part of why the Library rows and OnboardingDone stay `in-progress` until the canvas is redrawn.
