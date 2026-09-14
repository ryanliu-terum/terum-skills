# error-cards-2026-09-13 — run record

**Ask:** Teddy, 2026-09-13 — "Go through all error cards on the desktop and fix their fidelity and rendering."

**Boards:** InboxError, LibraryError, MarketplaceError, ShareError, SettingsError, SkillDetailError (all `in-progress`
since 2026-09-10) and OnboardingError (locked, unchanged).

## What was actually off (measured before any change, desktop at feat/desktop-ui-polish d0bd951, oracle of 2026-09-08)

The cards themselves were already right: InboxError had 0 differing pixels outside the sidebar. Everything else was
the canvas lagging decisions the app had already ratified — the sidebar spacing (AP, written 2026-09-10 but never
applied), the Members relabel, the removed Connect and filter buttons, the honest Share/Marketplace error copy, the
Settings nav relabel, the Add project row, and the skill read-failure header's fabricated `terum / infra` crumbs.

## Canvas side (maintainer)

Four anchor-asserting patches, in order, from the canvas checkout (`~/Projects/SSM/design/terum-skills`):

    cp patch_aq.py patch_aq2.py patch_ar.py .patches/     # AP already sits in .planning/codex-runs/sidebar-spacing/
    python3 .patches/patch_ap.py "$PWD" && python3 .patches/patch_aq.py && python3 .patches/patch_aq2.py && python3 .patches/patch_ar.py
    python3 build.py && python3 fit_check.py
    ./render.sh            # or one board at a time: for b in …; do ./render.sh $b; done

`patchlib.py` (house style) aborts before any write when an anchor is stale. On this box `render.sh`'s four parallel
Chromiums were OOM-killed mid-run (7.7 GB, three other sessions running batteries); a killed run deletes the PNGs it
had started, so re-run `render.sh` with no arguments — it re-renders every missing or stale board.

`fit_check.py` reports four boards over their declared height (OnboardingStates 1606/1360, SettingsLeave 1008/1000,
SettingsPrune 1348/1340, SkillDetailHovers 1159/1060). None of them is an error board, none draws anything AP–AR
touch except the sidebar, and a control measurement with AP's five numbers reverted could not complete under the
load; recorded, not fixed.

## App side

- `desktop/src/components/domain/Primitives.css`: `.board-error-line` gains `white-space: pre-wrap`. The real adapter
  joins several CLI failures with `\n` (`backend/tauri/index.ts` lines ~600 and ~674; `src/commands/status.ts:147`,
  `search.ts:78`, `invite.ts:52`); without the rule the browser collapsed them into one run-on paragraph. Pixel-neutral
  on every mock board (single-line errors), proved by the 0-pixel rows.
- `desktop/src/components/domain/error-line.test.tsx` pins the rule as text and the newline in the DOM.
- `desktop/src/fixtures/design.json` + `tokens.css`: `npm run export` after the patches; the only content change is
  `SETTINGS_NAV` (Team, Publishing), which now agrees with `settings-data.ts`. The md5 stamp is this machine's.

## Fidelity

`FIDELITY_ALL=1 TERUM_DESIGN_DIR=… npx playwright test e2e/fidelity -g Error --workers=2` (port 1421, own config):
InboxError 0, LibraryError 0, MarketplaceError 0, ShareError 0, SkillDetailError 0, SettingsError 512 (0.00040),
OnboardingError 38 (0.00003). Six rows flipped to `locked`.

Every other sidebar board also moved and its oracle was re-rendered; those rows stay `in-progress` until measured.
