# m7-S7q: the hello-features wiring and the nine no-CLI rows (app-only)

**Status:** LOCKED for implementation (M7 queue, batch 3 of tranche 1; every later un-grey depends on it). Rows AC-06, AC-07, AC-08, CP-13, CP-14, IB-08, RM-27, RM-45, RM-47. Approver: none for the CLI (there is no CLI change: Ledger D6 LOCKS the app-side mapping, no CLI key rename). Depends on S7af (stack on `origin/codex/m7-S7af` while it is unmerged).
**Sources:** Ledger D6 (app-side mapping), D1 (`roles` = permission chip, stays false; `memberRole` is S7b's new key), D2 (favorites/follow hidden on the real adapter), D9 (no sixth Tauri command), D10 (window minimum 960x600 stays; sideways scroll is S7x's). M7 document §4 S7q with its verifier corrections A to K (authoritative over the batch text). `desktop/AGENTS.md` invariants; in particular invariant 2 changes meaning here (the flags gain consumers), and GAPS.md/AGENTS.md are maintainer files: describe the needed GAPS.md:28-32 rewrite in `openQuestions`, do not edit them.

## 0. What this batch is

The CLI's `hello` frame publishes twelve capability switches (`FRAME_FEATURES`, `src/lib/frames.ts`: favorites, follow, roles, lastSeen, installScope, inviteScoping, disablePerMachine, projectMembers, liftOnCards, runEvalInApp, perCase, progress), all `false` at 0.1.6. The adapter throws the frame away (`run.ts`: `case 'hello': return;`) and hard-codes its own eight `Capabilities`, so nothing on screen ever changes when the CLI gains an ability, and five of the eight flags have no reader anywhere in `desktop/src` (only `windowChrome` is consumed). This batch makes the app read the hello frame, exposes the CLI's switches on the seam, and gives every flag a consumer that hides or greys the drawn control when the CLI says `false`, while the mock keeps every switch `true` so the 88 locked boards do not move. It also records two refusals (AC-07, CP-14) and fixes the platform-seam leaks the verifier found (AC-08).

## 1. The seam (`desktop/src/backend/types.ts`, `Backend.ts`)

- Keep the eight-key `Capabilities` (D6): `disablePerMachine` straight across from the hello frame; `perCaseEvalTables` from the hello key `perCase`; `inboxEventLog`, `offtargetKind`, `machineRegistry` stay `false` on the real adapter (their mechanisms are cut; the mock keeps `true`); `windowChrome`, `openInEditor`, `clipboard` unchanged.
- Add `features: Readonly<Record<FeatureKey, boolean>>` to the seam as `Backend.features(): Promise<Features>` where `FeatureKey` is the CLI's twelve names plus `memberRole` (D1; `false` until S7b's CLI ships it, and `false` when the hello frame omits a key). The mock declares every key `true`. The real adapter fills it from the hello frame of a cheap read (`--frames status` is the first process every session runs; cache the hello frame from ANY run in the session: `run.ts` gets an `onHello(frame)` option and the adapter memoises the last hello it saw; before any run has happened, `features()` runs `status` once). A key absent from the frame maps to `false` (`?? false`), never `undefined`.
- `run.ts`: `case 'hello'` stops returning; it calls `options.onHello?.(frame)` and still emits no seam frame (the shell never draws hello).

## 2. Every flag gets a consumer (the un-grey rule; pixel-neutral when `true`)

Each drawn control below reads its switch through `useQuery(['features'])` (and `['capabilities']`) and, when the switch is `false`, is HIDDEN (not disabled, not stubbed: Ledger D2 and the North Star) unless the row below says "greyed". The `true` branch renders exactly today's markup, so the mock's boards are byte-identical. Add one test per flag: `false` renders the documented degraded surface, `true` renders the same DOM as before (snapshot-neutral).

| switch | control(s) | when false |
|---|---|---|
| `favorites` | the card heart with count (SkillCard), the detail Favorite button, MarketplaceProject's heart | hidden; the per-viewer `favorite` pref is not read on the real adapter (D2: never a count of one) |
| `follow` | Follow button and follower count on MarketplacePerson / MarketplacePeople cards | hidden |
| `roles` | the Admin/Member permission chip and its menu on Share (ShareScreen member row) | hidden (D1: this key is the PERMISSION chip; S7h will draw the read-only host-admin column from `ls --host`, which must NOT key off `roles`) |
| `memberRole` | the roster job label ("founder", "platform") on Share and Marketplace people cards | hidden (lights in S7b) |
| `lastSeen` | the Last active column on Share | column present, cell renders `—` (the header stays for geometry) |
| `installScope` | the scope radios in the Install dialog | the radio group is replaced by one static line naming the scope the CLI will use ("Global"); the dialog keeps its height |
| `inviteScoping` | the Invite scoping section | hidden (the dialog's height shrinks; the mock is unaffected) |
| `disablePerMachine` | the per-skill enable Switch on the card and the rail status card | hidden; the status card shows "Loaded in every session" for installed skills |
| `projectMembers` | project member facepiles, the Teams column on Share, "N teammates use this project" | hidden / `—` |
| `liftOnCards` | the lift figure and verdict chip on Library and Marketplace cards | the figure slot renders `—` and the chip is hidden |
| `runEvalInApp` | the Run eval button and dialog on the Evals tab and Onboarding Basics ▸ Eval | hidden; the terminal hint stays |
| `perCase` → `perCaseEvalTables` | Table 1 and the per-case rows on the Evals report and InboxEval | hidden with the board's "per-case rows are not in the committed receipt" line (one `Small`) |
| `progress` | the Onboarding boot card's live progress phases (S7r's consumer) | S7r's; here only expose the key |
| `inboxEventLog` (capability) | the Inbox nav group and screens | already hidden by S7af's `surfaces.inbox`; nothing more |
| `offtargetKind` | the off-target alert kind and Settings ▸ Inbox's kind row | kind row hidden |
| `machineRegistry` | "your other machines", the footer machine name | hidden / `—` |

## 3. The nine rows

- **AC-06 (window chrome, verifier corrections C and D):** decide decorations per platform FIRST, in `tauri.conf.json`: macOS keeps `decorations:true` + `titleBarStyle: Overlay` + `hiddenTitle` + `trafficLightPosition {x:16,y:14}`; Windows gets `decorations:true` and NO drawn window controls (delete the three decorative `window-controls` spans TopBar renders for `drawn-controls`: they duplicate the native title bar and inset one end block, which the design forbids). `windowChrome` becomes `'mac-overlay' | 'native' | 'cosmetic'`; `'native'` draws neither lights nor controls. Fix the mac-overlay spacer: `TopBar.tsx` substitutes `<div style={{width:78}}/>` for the 52 px TrafficLights, moving the mark 26 px right; make it 52 so the mark stays at x 76 as drawn. Dragging: add `data-tauri-drag-region` to the top bar's empty regions (it does not inherit), and hand-build double-click-to-maximise via `getCurrentWindow().toggleMaximize()` under `core:window:allow-internal-toggle-maximize` (already granted), in `src/backend/tauri/` behind a seam method `windowAction('toggle-maximize'|'start-drag')`. No resize targets (decorations stay true). Record in the PR body: the fidelity gate runs browser mode (cosmetic), so the two platform headers are untested by it; write one vitest per mode asserting the TopBar's left-block geometry (mark at x 76 in cosmetic and mac-overlay, x 16 in native). Window minimum stays 960x600 (D10).
- **AC-07 (category icons in team.json): REFUSED, recorded.** Cover-note text for the PR body: `guardTeam` admits exactly rows c/d/e (`src/lib/guard.ts:153-156`) and `categories` is written once, at scaffold time (`src/commands/team.ts` `const team: Team = { …, categories: CATEGORIES, … }`); the app maps category → icon app-side from a fixed table with a neutral fallback icon (`iconName()` must never throw on an unknown category: return `'tag'`).
- **AC-08 (four calls behind one seam, corrections E and F):** add `Backend.openUrl(url)` (adapter: `openUrl` from `@tauri-apps/plugin-opener`; add `opener:allow-open-url` to `capabilities/default.json` scoped to `https://github.com/*`; mock/browser: `window.open(url, '_blank', 'noopener')`) and `Backend.revealPath(path)` (adapter: `revealItemInDir`, permission already granted; mock: no-op ok). Route EVERY external anchor through `openUrl`: `SkillScreen`'s repo link becomes a computed deep link `https://github.com/<repo>/tree/<version_full>/skills/<name>/` (never the bare repo root), `market-components.tsx`'s hard-coded `https://github.com/terum/team-skills` anchor is computed from the project's `remote`, Settings' Show in Finder uses `revealPath`. `copyImage` stays as shipped (name its owner: this batch). `user-select: none` on `.shell` and `.onboarding-frame` is confirmed and stays.
- **CP-13, CP-14:** CP-14 (project metadata verbs) REFUSED, recorded with the same cover-note reasoning; the project description/icon fields stay hand-maintained in team.json (S7p documents them). CP-13: the "New skill" CTA is relabelled "Connect" (A3, RM-37 MOOT) wherever the app draws it, and it opens the connect picker (`backend.connect({})`) through the Prompter.
- **IB-08 (one definition for the three counters):** `LIBRARY_OVERVIEW.attention` (8 = 2 failing evals + 3 updates + 3 not evaluated) already contains the 3 updates the sidebar counts separately. Define, in `src/backend/mock/derive.ts` and as a seam comment, `attention = failingEvals + updatesAvailable + notEvaluated` and `counts.Alerts = attention`, `counts.Updates = updatesAvailable`; assert the identity in a test against the fixture (8 = 2+3+3, Updates 3, Alerts 8). The real adapter serves these only when `status` carries them (S7k); until then they are omitted (S7af rule).
- **RM-27 (correction H):** the app never receives the gh-login question; it must render the CLI's PRINT frame `GitHub CLI is installed but logged out. Run \`gh auth login\` in a terminal, then try again.` inside the workflow popup as a highlighted line, not lose it. Test with a recorded print frame.
- **RM-45:** the app never offers to change credential configuration, probe access or retry with other credentials (phase-1 spec :338). Every error board's remedy copy is checked against that: none may say "sign in" or "change the token"; the Account gh row's "Sign in" hands off to the terminal (`openInEditor`-style) and says so.
- **RM-47 (correction I):** the six clone states (`absent`, `incomplete{not-a-repository|no-team-json|unverifiable}`, `foreign`, `ok`, and ok-but-unreadable) each get one sentence in a `cloneStateCopy()` helper in `src/backend/mock/derive.ts` (Teddy still owns the final wording; use the CLI's own `describeClone` lines verbatim where they exist) consumed by Settings ▸ Teams and the footer; `absent` never says "another window left this team".

## 4. Tests

`seam.test.ts` must keep passing unchanged. Add the per-flag pair tests (§2), the TopBar geometry tests (AC-06), `openUrl`/`revealPath` mock tests, the IB-08 identity test, the RM-27 print-frame test, an adapter test that `features()` reads a recorded hello frame (`.planning/codex-runs/m7-S7q/frames/status.jsonl`) and maps every key (`perCase` → `perCaseEvalTables`, absent `memberRole` → `false`).

## 5. Acceptance

`npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` in `desktop/`; `cargo check` is not needed (no Rust edit) unless you touch `tauri.conf.json`, in which case run it (`tauri-build` validates the config). No Playwright, no git, no network. The orchestrator runs the 88-board fidelity gate: every branch must be a no-op in the `true` state the mock reports.

## 6. Out of scope

Any edit under `src/` (the CLI) incl. `frames.ts`; `GAPS.md`/`AGENTS.md` (describe the five-line rewrite in `openQuestions`); the Inbox feed; `memberRole`'s CLI side (S7b); the sideways-scroll CSS (S7x); a sixth Tauri command (D9).
