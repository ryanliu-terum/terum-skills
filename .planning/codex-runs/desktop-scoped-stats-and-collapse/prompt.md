Implement the spec below. Read AGENTS.md at the repo root FIRST, then desktop/AGENTS.md (follow both exactly). All work is under desktop/.

# desktop-scoped-stats-and-collapse — derived counts, a scoped overview, and the sidebar collapse states

**Status:** locked (Teddy, 2026-09-09: "make sure all numbers and other things are consistent" · "global and project stats should be scoped" · "make sure the collapse buttons work too"). Design side already applied on the canvas as patches AN, AN2 and AO (copies under `.planning/codex-runs/desktop-scoped-stats-and-collapse/`); the fixture in this tree (`src/fixtures/design.json`, `src/styles/tokens.css`) is ALREADY regenerated from that canvas by the orchestrator, and `tools/export-design.py` already exports the new `OVERVIEW_BY_SCOPE`. Do not touch those three files.

**Sources:** `desktop/AGENTS.md` (all eight invariants; 3, 5, 7 bite here), the design-strings walk ledger D9 (`.planning/decisions/2026-09-08-design-strings-decision-walk.md`: "chevrons and the collapse button get real states, and three new boards are drawn (sidebar hidden, Projects collapsed, Inbox collapsed)"), the S7q spec table (hidden controls), `e2e/routes/card-click.spec.ts` and `e2e/routes/scroll.spec.ts` for the route-test style.

## 1. What changed in the fixture (already in this tree; read it, do not edit it)

The sample used to declare a catalog of 30 skills while defining 17 (15 with cards). Every count is now derived from what exists:

| Field | Before | Now |
|---|---|---|
| `COUNTS` | Global 30 · Terum 22 · SSM 15 · MRF 32 | Global **15** · Terum **8** · SSM **3** · MRF **2** (Pushes 3 · Updates 3 · Alerts 8 unchanged) |
| `CATALOG_N` | 30 | **17** (= `CATALOG.length`) |
| `CATEGORIES` | ten typed counts summing to 30 | derived from `CATALOG`, most skills first, ten tiles: infra 4, docs 3, review 3, then seven with 1 |
| `PROJECTS[*].skills` / `.evaluated` | 22/19, 15/11, 32/27, 8/5 | Terum 8/7, SSM 3/3, MRF 2/2, Docs 3/2 |
| `LIBRARY_OVERVIEW` | typed Global tiles (30, 27 of 30, 148, 8) | = `OVERVIEW_BY_SCOPE.Global`: skills 15 · "7 endorsed to Global" · evaluated 13 of 15 (7 pass · 4 neutral · 2 fail) · installs 91 · attention 6 (2 failing evals, 2 updates available, 2 not evaluated) |
| `OVERVIEW_BY_SCOPE` (new) | — | one overview dict per scope, same shape as `LIBRARY_OVERVIEW`: Global, Terum (8 · "6 also on Global" · 7 of 8 · 56 · 5), SSM (3 · "0 also on Global" · 3 of 3 · 18 · 0 · lines `["All clear"]`), MRF (2 · 2 of 2 · 14 · 0 · `["All clear"]`) |
| `DERIVED.libraryTitles` | "30 skills" … | "15 skills", "8 skills", "3 skills", "2 skills" |
| receipts' text | "catalog of 30 skills" | "catalog of 17 skills" |
| `DERIVED.categoryRemaining` | non-zero | 0 for every category (the sample renders the whole catalog) |

The boards print exactly these values. Anything in `src/` or a test that still expects 30 / 22 / 32 / 148 / "27 of 30" / "of 30 skills" is now wrong and must follow the fixture. 90 unit tests currently fail on this tree for that reason (list in the prompt); update their expectations to the new board truth and declare every one in `testsModified`. Never delete a test or loosen an assertion to a weaker shape; a test that asserted a derived relationship (e.g. "attention = failing + updates + unscored") keeps asserting the relationship with the new numbers.

## 2. The Library header and the scoped overview

- **Title.** `Library.title` is the scope's own count: `"15 skills"` for Global, `"8 skills"` for Terum, exactly `DERIVED.libraryTitles[scope]` on the mock (drop the `"N of "` prefix the mock prepends today). `ViewHeader`'s subtitle prints it as is. `SearchRow`'s placeholder derives from it as today ("Search 15 skills"). Empty scenario stays `"0 skills"`.
- **Overview.** `Library.overview` is the scope's overview: the mock returns `design.OVERVIEW_BY_SCOPE[canonical]` (Global / Terum / SSM / MRF); for a scope that is not in the map (a project the fixture does not know) return the zero overview (`skills "0"` etc. with the `zero` copy), never Global's numbers. `Analytics` renders whatever it is handed; with `attention_lines` of `["All clear"]` and `attention "0"` it prints "0" and the one line (no link change).
- **Real adapter** (`src/backend/tauri/index.ts` `library()`): `title` becomes `` `${skills.length} skills` `` (the scope's own count; the "N of M" form is gone); `overview.skills_note` becomes `` `${endorsedToGlobal} endorsed to Global` `` for Global and `` `${alsoOnGlobal} also on Global` `` for a project, both counted from the inventory rows' `endorsement === 'global'`; `installs` stays the scope's sum; `evaluated`, the meter and `attention` keep today's honest placeholders (no receipts are served yet). One replay test on a recorded inventory asserts the two notes.
- **Sidebar counts** already come from `status.counts` (the fixture's derived `COUNTS` on the mock; `ls --local` on the real adapter). No change except the tests.

## 3. Settings ▸ Evals prints k

`SettingsContent` reads `d.K` but the `Settings` DTO omits it (`types.ts` `Pick<Design,…>`), so the mock prints "k = —" beside a hint that says `--k 3`. Add `K` to the DTO as `number | null`; the mock fills `design.K` (3); the real adapter fills `null` (the CLI keeps no default) and the screen keeps printing "—" for null. One unit test per backend.

## 4. The sidebar collapse controls (D9)

Three boards are drawn and will be locked by the orchestrator (entries added to `e2e/fidelity/boards.ts` and `FIDELITY.md` by the orchestrator, not by you):

| Board | Route | What it shows |
|---|---|---|
| `LibrarySidebarHidden` | `#/library/global?sidebar=hidden` | the sidebar is gone entirely (240 → 0; NOT an icon rail). The panel keeps its 8px inset on the left too (`margin: 0 8px 8px 8px`). The reopen control is the same 20×20 `panel-left` icon button (glyph 14, `--tk-text4`) that the Library section header carries, placed in the top bar's left block right after the Forward arrow, with the block's 8px gap. Everything else is the Library board. |
| `LibraryProjectsCollapsed` | `#/library/global?projects=collapsed` | the Projects row's chevron is `chevron-right` and the three project rows are gone; the rest of the sidebar closes up (the group is a flex column with `gap: 1px`, so nothing else moves). |
| `LibraryInboxCollapsed` | `#/library/global?inbox=collapsed` | the same for Inbox: chevron-right, the Pushes / Updates / Alerts rows gone. |

Behaviour:

- **Sidebar hide / show.** The Library section header's `panel-left` icon button becomes a real `<button>` (`aria-label="Hide sidebar"`, `aria-expanded`), toggling `useUiStore.sidebarCollapsed` (the field already exists; add `setSidebarCollapsed`). When collapsed the `Sidebar` is not rendered and `TopBar` renders the reopen button (`aria-label="Show sidebar"`) after Forward. Persisted like `railOpen`. The keyboard shortcut is out of scope (record in `openQuestions` if you think one is expected).
- **Section collapse.** The Projects and Inbox rows' chevron becomes a real `<button>` inside the row (`aria-label="Collapse Projects"` / `"Expand Projects"`, `aria-expanded`), stopping propagation so the row's link still navigates on a click elsewhere. Collapsed sections live in the store as `collapsedSections: string[]` (persisted). The Library and Team section headers' chevrons stay decorative, as drawn.
- **URL state** (invariant 7: every board state reachable from the URL): `?sidebar=hidden`, `?projects=collapsed`, `?inbox=collapsed` are read by `url-state.ts` exactly like `rail=` and `overview=` (applied to the view, NOT persisted to the store, so a pasted link never rewrites a preference — the same rule the theme param currently breaks; do not copy that). A control click writes the param the way `rail` does (`param('sidebar', collapsed ? 'hidden' : null)`) and the store.
- **Geometry** follows the boards: `NavRow`'s chevron slot keeps its size in both states; the reopen button in the top bar is `.icon-button` at 20×20 with a 14px glyph (see `SectionHeader`'s trailing element for the exact inline style). The sidebar hidden state must not change the top bar's left block width (it stays `SIDEBAR_W` wide, as drawn).
- **Real adapter:** identical (the shell is shared); no CLI involvement.

## 5. Tests

- Unit: store setters and persistence; `Sidebar` renders chevron-right and no nested rows for a collapsed section; `Shell` omits the sidebar and `TopBar` shows the reopen button when hidden; url-state reads the three params without writing the store; the mock `library()` title and overview per scope (Global, Terum, SSM, an unknown project → zero overview); real-adapter replay for the two notes; Settings `K` per backend.
- Routes (`e2e/routes/collapse.spec.ts`, in the style of `card-click.spec.ts`): (1) clicking the Library header's button hides the sidebar and shows the reopen button; clicking that restores it; the preference survives a reload of `#/library/global`; (2) the Projects chevron hides the three project rows and flips to `chevron-right`, and clicking the Projects label still navigates; (3) the same for Inbox; (4) `?sidebar=hidden`, `?projects=collapsed`, `?inbox=collapsed` each render their state on a fresh load and do not persist after navigating to `#/library/global` without the param; (5) `#/library/project/Terum` prints "8 skills" in the header and the Terum overview (8 · 7 of 8 · 56 · 5), and `#/library/global` prints "15 skills" and 15 · 13 of 15 · 91 · 6. Console errors asserted empty in every case.

## 6. Gates

Inside the sandbox, from `desktop/`: `npm run typecheck && npm run lint && npm test`, real counts. Outside (orchestrator): `npm run export:check` (must be clean on this tree), `npx playwright test e2e/routes --workers=2`, `npx playwright test e2e/fidelity --workers=2` — 91 boards after the orchestrator adds the three rows; every previously locked board still passes at scrollTop 0 (the sidebar counts changed on every board, and the oracle was re-rendered from the same canvas).

## 7. Out of scope (recorded so nobody widens this)

The Inbox digest item "deploy-check · a skill you wrote" (its author is ajay everywhere else) is a persona question for Teddy; the Marketplace filter popover's inert controls (audit D9); any change to `GAPS.md`, `FIDELITY.md`, `AGENTS.md`, `README.md`, `package.json`, the generated files or `e2e/fidelity/**` (maintainer files: describe in `openQuestions`).

## Standing constraints (orchestrator)

- Work only inside `desktop/`. The fixture (`src/fixtures/design.json`, `src/styles/tokens.css`), `tools/export-design.py`, `e2e/fidelity/**`, `FIDELITY.md`, `GAPS.md`, `AGENTS.md`, `README.md` and `package.json` are already in their final state for this batch: never edit them. Describe anything they would need in `openQuestions`.
- Start by running `npm test` from `desktop/`: 90 tests fail on this tree because the fixture's numbers changed (section 1). Bring every one to the new board truth without deleting a test or weakening an assertion; declare each file in `testsModified`.
- Gates you run, from `desktop/`: `npm run typecheck && npm run lint && npm test`, real counts. Playwright cannot launch in the sandbox: write `e2e/routes/collapse.spec.ts` in the exact style of `e2e/routes/card-click.spec.ts` and say in the report that you could not run it; never fake a result.
- No git commands of any kind (this is a worktree; git metadata is outside the writable root). Verify every write by reading the file back. Do not commit or push.
- If the spec is ambiguous, implement the most conservative reading and record the question in `openQuestions`. Never resolve a design fork yourself.
