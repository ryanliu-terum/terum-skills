# terum-skills desktop

The desktop frontend for terum-skills: a Vite + React + TypeScript app that runs in a browser on a mock
backend, and inside its Tauri shell (`src-tauri/`) drives the real `terum-skills` CLI over frames (`src/backend/tauri/`). Every screen is held pixel-faithful to a private
design canvas; the gate that enforces that runs only where the canvas is present.

Status: preview. In a browser every screen renders on fixture data behind the `src/backend/` seam. In the shell the
long verbs (install, connect, sync, publish, invite, team, setup, eval) and `search`/`validate` run the real CLI;
the read models the CLI has no verb for yet render their error boards (`src/backend/tauri/README.md` lists them).
`GAPS.md` lists what the drawn screens need from the CLI that it does not have.

Run: `npm install`, `npm run dev` (port 1420), open `http://localhost:1420/#/library/global`. Node 24 (Node 25's
built-in `localStorage` shadows jsdom's in the tests; run them with `NODE_OPTIONS=--no-experimental-webstorage` there).
Shell: `npm run tauri dev` (needs rustup and the Tauri prerequisites); `npm run tauri build --bundles app` makes the
ad-hoc-signed `.app` the release workflow ships. The app expects `terum-skills app` to have recorded the CLI's
location in `~/.terum/skills/run/app.json`.

Gates:

- `npm run check` = typecheck, lint, vitest and the route smokes (`e2e/routes`, Playwright). Runs anywhere.
- `npm run check:design` adds the two design-dependent gates: `export:check` (the generated
  `src/styles/tokens.css` and `src/fixtures/design.json` are current) and `e2e:fidelity` (pixel diffs against
  the read-only `.shots/<Board>.png` renders). Both need `TERUM_DESIGN_DIR=<path to the design canvas>`;
  without it they skip or fail with a one-line message. `FIDELITY.md` lists every in-scope board and its
  lock status; only `locked` rows are asserted.

Layout, the seam, generated files and the stack pins: `AGENTS.md`. Keep every gate green before opening a PR.
