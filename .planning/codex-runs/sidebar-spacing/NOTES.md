# sidebar-spacing — run record

**Ask:** Teddy, 2026-09-10 — "adopt the spacing of the realistic mock to the application".
**Oracle:** the single-file realistic build `terum-skills-mock-realistic.html` (2026-09-09, mock backend, throwaway
worktree, nothing committed). Its inlined CSS carries exactly five sidebar deltas, all of which are now in
`desktop/src/styles/app.css`:

| rule | before | after |
|---|---|---|
| `.nav-row` | `height:28px` | `height:34px` |
| `.nav-group` | `gap:1px` | `gap:4px` |
| `.sidebar-inner` | `gap:16px` | `gap:26px` |
| `.sidebar-inner` | `padding:4px 8px 0 8px` | `padding:28px 8px 0 8px` |
| `.sidebar-inner>.nav-group:nth-child(2)` | (absent) | `margin-top:56px` |

The oracle's README and the oracle's own bytes agree on all five numbers. The `nth-child(2)` form is the oracle's own;
`.sidebar-inner` has exactly two possible children (the Library group and the Team group), so it names the Team group
and nothing else.

## Design side (maintainer, not the implementing agent)

`patch_ap.py` beside this file moves the same five numbers into the canvas's `build.py`. It does NOT change `ROW_H`
(shared with `settings_nav_row`, and exported into the generated `desktop/src/fixtures/design.json` LAYOUT block); it
adds `SIDEBAR_ROW_H, SIDEBAR_GROUP_GAP, SIDEBAR_STACK_GAP, SIDEBAR_TOP_PAD, TEAM_GROUP_GAP = 34, 4, 26, 28, 56`.

Sequence:

1. `python3 patch_ap.py <design dir>` (anchor-asserting; a stale anchor aborts before any write).
2. `python3 build.py`
3. `python3 fit_check.py --all` — the sidebar grew 84px; the fullest 900px board measures 576px of 808px available, so
   nothing should clip, but measure rather than assume.
4. Oracles: `.shots/*.png` must be re-rendered on the maintainer's Mac through `render-mac.mjs`, not through the
   canvas's Linux `render.sh` — `desktop/FIDELITY.md` ("Oracle provenance", 2026-09-08) records that a Linux raster
   differs from the macOS one by ~3,700 px on every board, which alone exceeds the exact and `state` tolerances.
5. `cd desktop && npm run export:check` — expected to stay green: the new constants are not in
   `tools/export-design.py`'s `LAYOUT` list, so `design.json` and `tokens.css` do not change.
6. Re-lock the flipped `FIDELITY.md` rows only after `npx playwright test e2e/fidelity --workers=2` passes.

## Fidelity

62 locked rows draw the sidebar and move; the orchestrator flips them to `in-progress` with the note
"sidebar spacing adopted from the realistic mock (Teddy 2026-09-10); awaiting canvas patch + re-render". 16 rows that
draw the sidebar are already `in-progress` for other reasons and only gain the note. 13 rows do not draw the sidebar
(LibrarySidebarHidden and the twelve Onboarding boards) and are untouched. The list is in the spec, §11.

## Not in this batch (recorded, not done)

- The mock labels the sidebar row **Members**; the repo and the canvas both say **Share**. Teddy's call.
- The mock also flips `features.favorites=false`, `features.follow=false`, `surfaces.inbox=false`. Those are CLI-reported
  runtime switches, not CSS.
- `.sidebar-inner` still has no `overflow-y`. A machine with many registered checkouts could overflow it; adding a
  scroller would move pixels the oracle does not have.
