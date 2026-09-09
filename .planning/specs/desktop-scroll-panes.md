# desktop-scroll-panes — the Library grid and the Skill detail column scroll

**Status:** locked (Teddy, 2026-09-09: "let me scroll"). Owner of the fork-free decisions below: Claude (orchestrator). No design fork is resolved here.

**Sources:** `desktop/AGENTS.md` invariants 4, 5, 7, 8; the existing scroller precedent `.market-home`, `.market-page-main`, `.inbox-rows`, `.inbox-pane`, `.share-table-wrap` (`overflow:auto;scrollbar-width:none`); the fidelity gate (`e2e/fidelity`, 88 locked boards, captured at scrollTop 0).

## Problem (verified 2026-09-09 on main `6eb5b1b`, mock backend, viewport 1440×900)

Two screens clip content that a user can never reach, on both the mock and the real adapter:

1. **Library** (`#/library/global`, `#/library/project/<name>`): `.library-grid` is `flex-grow:1;min-height:0` inside `main.panel{overflow:hidden}` with no `overflow` of its own. The Global grid holds 15 cards in 5 rows; only the first 3 rows are visible, the wheel moves nothing, and no element on the page has `scrollTop > 0` after a wheel of 1200 px. The header prints "15 of 30 skills" over a grid whose rows 4–5 cannot be seen.
2. **Skill detail** (`#/skill/<ref>` in the default rail-open mode): `.detail-main{overflow:hidden}`; `.evals-body{overflow:hidden;min-height:0}`. The SKILL.md tab's body and the Evals tab's report end below y = 900 and cannot be scrolled to. Only the `?full=1` variant (`.detail-body.full .detail-main{overflow:visible}`, the four `full`-class boards) shows everything, and that variant is a fidelity fixture, not the user's mode.

Every other pane already scrolls with a hidden scrollbar (see Sources). Settings uses `.settings-scroll`. Marketplace expanded pages use `.market-page-main`. These are not touched.

## Change (CSS only, plus one e2e spec)

The pattern is the repo's existing one: `overflow:auto;scrollbar-width:none` on the pane that owns the overflow, never on `.panel`.

- `desktop/src/screens/library/library.css`: `.library-grid` gains `overflow:auto;scrollbar-width:none`. Nothing else in the rule changes (`display:grid`, 3 columns, `gap:12px`, `padding:0 20px 16px`, `flex-grow:1`, `min-height:0`, `align-content:start` all stay). The view header, the Analytics overview and the search row stay pinned above the grid exactly where they are.
- `desktop/src/screens/skill/skill.css`: `.detail-main` becomes `overflow:auto;scrollbar-width:none` (box model, padding `20px 28px 0`, `box-sizing:content-box`, `gap:16px` unchanged). `.detail-body.full .detail-main{overflow:visible}` stays as is. The rail (`.detail-rail`) stays pinned; only the main column scrolls.
- Inside the scrolling `.detail-main`, the Evals tab must be reachable to its last line: `.evals-body{overflow:hidden;min-height:0}` currently constrains the report to the column's height. Relax it so the report's full height flows into the scroller in the non-`full` mode (for example `.evals-body{overflow:visible}` with `min-height:auto` when `.detail-body` is not `.full`; `.detail-body.full .evals-body{overflow:visible}` already exists). The History rail beside the report keeps its width; whether it scrolls with the report or stays pinned is not a fork: it scrolls with the report (the board draws it as part of the document).
- The SKILL.md tab (`.skill-md-tab`, `.skill-md-blocks`) and the Quality and Activity tabs need no rule if `.detail-main` scrolls; verify rather than assume (the e2e below asserts it).
- No `z-index`, no `scrollbar-gutter`, no change to `main.panel`, `.shell`, `.shell-row`, `ScreenFrame`, or any board geometry above the fold. Hidden scrollbars are the repo's existing choice (macOS overlay behaviour on every platform); do not introduce a visible scrollbar, it would shift the 3-column grid by the scrollbar width and break the locked boards.

## Invariants touched

- **4 / 5 (fidelity, pixels):** every one of the 88 locked boards is captured at scrollTop 0 and must not move by a pixel. `overflow:auto` with `scrollbar-width:none` changes no layout at scrollTop 0. If a board moves, the change is wrong, never the tolerance or the oracle.
- **7 (tests):** add `desktop/e2e/routes/scroll.spec.ts` in the style of `card-click.spec.ts` (`prepare(page, {...})` from `../fidelity/determinism`, console/pageerror/response/requestfailed collected and asserted empty). Cases:
  1. Library Global: the last `.skill-card` is not fully inside the viewport at load; after `wheel(0, 2000)` over the grid (or `scrollIntoViewIfNeeded` on the last card) it is inside the viewport; `.library-grid` has `scrollTop > 0`; the view header (`Global` title / `Connect` button) is still at its original y (pinned).
  2. Library project `Terum`: same assertion shape (8 cards, 3 rows; if all rows already fit at 1440×900, assert `scrollHeight === clientHeight` and skip the wheel, do not fake a scroll).
  3. Skill detail `#/skill/deploy-check` (rail open, default tab): the last element of `.skill-md-blocks` becomes visible after scrolling; `.detail-rail`'s bounding box does not move.
  4. Skill detail `#/skill/deploy-check?tab=evals`: the report's last section (the Coverage and provenance block, or the last row of the per-case table) becomes visible after scrolling; the `Latest receipt…` tab head scrolls away (it is part of the document, not pinned).
  5. Skill detail `?tab=evals&rail=closed&full=1`: unchanged behaviour, document height grows with content (`.detail-main` `overflow:visible`), no assertion on scrollTop.
- **8 (gates):** `npm run typecheck && npm run lint && npm test` inside the sandbox with real counts. The orchestrator runs `npm run export:check`, `npx playwright test e2e/routes --workers=2` and `npx playwright test e2e/fidelity --workers=2` with `TERUM_DESIGN_DIR=/home/teniroo/Projects/SSM/design/terum-skills` outside the sandbox: 88/88 boards locked, 0 differing pixels on Main and Light.

## Out of scope (recorded so nobody widens this)

- The sample-data counts (Global 30 vs 15 cards, project counts 22/15/32/8, sidebar Alerts 8 vs 4 alert items, Team installs 148 vs 106) are a design-side question for Teddy; not touched here.
- The narrow-window reflow (S7x) and any visible scrollbar treatment for Windows: separate decisions.
- Any change to `GAPS.md`, `FIDELITY.md`, `AGENTS.md`, `README.md`, `package.json`: maintainer files, describe in `openQuestions` instead.
