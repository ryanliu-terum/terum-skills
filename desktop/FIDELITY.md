# FIDELITY.md — Gate A status per board

One row per in-scope board (87: every canvas board except the nine *States/*Hovers/*Panes/SkillCard sheets, FigmaDark and MarketplaceNoHero). Status is `todo` | `in-progress` | `locked`; only `locked` rows are asserted by `e2e/fidelity`, and a row is set to `locked` only after its diff passed in the orchestrator's own run. The tolerance column is informational: the authoritative per-class map lives in `e2e/fidelity/tolerance.ts` (screen 0.0030, dialog 0.0035, empty/loading/error 0.0020, full-page 0.0025; Main and Light are exact at 0 differing pixels). Masks: none. A mask may be added only with a written reason in the note column, and a test never reads a tolerance or a mask from this file.

| Board | route+state | status | tolerance | note |
|---|---|---|---|---|
| Main | `#/frame` | locked | 0 | the bare shell (Global selected, empty panel); exact: 0 differing pixels |
| Light | `#/frame?theme=light` | locked | 0 | exact: 0 differing pixels |
| Library | `#/library/global` | locked | 0.0030 | hover: the update flag of the card at HOVER_INDEX (the card whose flags contain 'update'); its tooltip shows |
| LibraryLight | `#/library/global?theme=light` | locked | 0.0030 | same hover as Library |
| LibraryEmpty | `#/library/global?__mock=empty` | locked | 0.0020 | sidebar Global count 0 |
| LibraryNoResults | `#/library/global?q=deploy%20prod` | locked | 0.0020 |  |
| LibraryLoading | `#/library/global?__mock=loading` | locked | 0.0020 | sidebar counts hidden |
| LibraryCollapsed | `#/library/global?overview=0` | locked | 0.0030 | overview hidden |
| LibraryError | `#/library/global?__mock=error` | locked | 0.0020 | sidebar counts hidden |
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
| SkillDetailInstallLight | `#/skill/deploy-check?__mock=not-installed&dialog=install&theme=light` | in-progress | 0.0035 | the 88th board: every other row was locked first (the rule below); locks in the maintainers' own run |
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
| MarketplaceError | `#/marketplace?__mock=error` | locked | 0.0020 |  |
| MarketplaceFull | `#/marketplace` | locked | 0.0025 | viewport 1440x1080 |
| MarketplaceProject | `#/marketplace/projects/terum` | locked | 0.0030 |  |
| MarketplaceProjectNotInstalled | `#/marketplace/projects/docs` | locked | 0.0030 |  |
| MarketplaceProjectInstall | `#/marketplace/projects/docs?dialog=install` | locked | 0.0035 |  |
| MarketplacePerson | `#/marketplace/people/ryan` | locked | 0.0030 |  |
| MarketplacePersonNotInstalled | `#/marketplace/people/lena` | locked | 0.0030 |  |
| MarketplaceSkills | `#/marketplace/skills` | locked | 0.0030 |  |
| MarketplaceProjects | `#/marketplace/projects` | locked | 0.0030 |  |
| MarketplacePeople | `#/marketplace/people` | locked | 0.0030 |  |
| MarketplaceCategories | `#/marketplace/categories` | locked | 0.0030 |  |
| MarketplaceCategory | `#/marketplace/categories/infra` | locked | 0.0030 |  |
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
| OnboardingDone | `#/onboarding/done` | locked | 0.0030 | over the live Library |
| OnboardingLight | `#/onboarding/style?theme=light` | locked | 0.0030 | Light picked (the picked card is the current theme) |
| OnboardingError | `#/onboarding/boot?__mock=error` | locked | 0.0020 | the first sync failed |

Out of Gate A's scope (the canvas has 99 `.shots`; 88 have a row above): the nine specimen sheets (SkillCard, SkillDetailStates, SkillDetailHovers, InboxPanes, InboxStates, MarketplaceStates, ShareStates, SettingsStates, OnboardingStates), FigmaDark (a third token theme the app does not ship) and MarketplaceNoHero (no route draws the marketplace without its hero). None of the eleven is reachable from an app route, so none can be asserted by `e2e/fidelity`; they stay design-only. SkillDetailInstallLight joined the gate on 2026-09-08 once the other 87 were locked.

## Oracle provenance (2026-09-08, the M7 takeover)

The 99 `.shots/*.png` were re-rendered on Ryan's Mac on 2026-09-08 through the canvas's `render-mac.mjs` (a Playwright renderer using the same Chromium channel, device scale, colour scheme, locale and timezone as `playwright.config.ts`) from the unchanged `.dc.html` boards. Teddy's original renders (snap Chromium on Linux, FreeType) differed from the macOS raster (CoreText) in glyph anti-aliasing only, about 3,700 pixels on every board, which alone exceeded the exact and `state` tolerances (85 of 87 locked boards failed here before the re-render; 87 of 87 passed after it, worst 0.00269). The tolerance map and the no-mask rule did not change. Consequence: the oracle is now a macOS raster; a Linux gate machine would have to re-render it there. Teddy's renders are kept beside the canvas as `.shots-linux-teddy-2026-09-08/`.

## Oracle defects found while locking (recorded; the oracle was re-shot, never worked around)

- MarketplaceLoading: the oracle PNG's shell text (top-bar placeholder "Search skills, people, projects", the sidebar's "Library" / "Global" labels) was rasterised in a wider fallback sans (DejaVu-like), not Inter: cropped at 2× it is visibly wider than the same strings in `Marketplace.png`, and an exact pixel comparison of the two oracles differs in the sidebar and top-bar bands (x < 200, y < 60: 4,608 + 337 + 1,923 px) where every other loading board's oracle is identical to its family's base board (InboxLoading vs Inbox: first differing column x = 209). The app renders that shell with Inter, byte-identical to the 80 locked boards, so the board sits at 4,259 differing pixels (0.00329) against a `state` allowance of 0.0020 (2,592 px) and cannot lock without substituting the fallback font on one route, loosening a tolerance, or masking — all three forbidden. Resolved 2026-09-08: the oracle was re-rendered alone (no parallel batch), its shell became pixel-identical to `Marketplace.png` and its content region unchanged; the row locked at the next run. Evidence (2× crops of both oracles) is kept with the maintainers’ run records outside this repository.
