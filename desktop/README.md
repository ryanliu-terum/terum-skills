# terum-skills desktop

The desktop frontend for terum-skills: a Vite + React + TypeScript app that runs in a browser on a mock
backend today and gets its Tauri shell in a later milestone. Every screen is held pixel-faithful to a private
design canvas; the gate that enforces that runs only where the canvas is present.

Status: preview. Every screen renders on fixture data behind the `src/backend/` seam; nothing calls the CLI
yet. `GAPS.md` lists what the drawn screens need from the CLI that it does not have.

Run: `npm install`, `npm run dev` (port 1420), open `http://localhost:1420/#/library/global`. Node 24 or newer.

Gates:

- `npm run check` = typecheck, lint, vitest and the route smokes (`e2e/routes`, Playwright). Runs anywhere.
- `npm run check:design` adds the two design-dependent gates: `export:check` (the generated
  `src/styles/tokens.css` and `src/fixtures/design.json` are current) and `e2e:fidelity` (pixel diffs against
  the read-only `.shots/<Board>.png` renders). Both need `TERUM_DESIGN_DIR=<path to the design canvas>`;
  without it they skip or fail with a one-line message. `FIDELITY.md` lists every in-scope board and its
  lock status; only `locked` rows are asserted.

Layout, the seam, generated files and the stack pins: `AGENTS.md`. Keep every gate green before opening a PR.
