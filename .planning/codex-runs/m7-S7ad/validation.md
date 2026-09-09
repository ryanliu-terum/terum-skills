# S7ad implementation record

PR body: Dock launches now replay the PATH recorded by the CLI; setup hands its invite target to the backend seam. D4 is decided: use the recorded launch PATH, fall back to the process environment when absent/null/empty, and never probe a login shell. Broken state reads carry terminal recovery guidance and are retried on the next call. Successful reads remain memoised. Routing and consume-once preferences belong to S7r.

## Verification

- Root lint and typecheck: passed. Full root suite: 71 files passed, 1 failed; 1,132 tests passed, 1 failed (1,133 total). The unchanged `src/lib/__tests__/runner.test.ts` sleeping-child cleanup assertion at line 73 observed a live child. No pre-change baseline was run; this is not claimed as an established baseline failure.
- Focused root rerun (app, setup, unchanged runner): 2 files passed, 1 failed; 59 tests passed, 1 failed. The same runner assertion failed again; app/setup passed.
- Root build: passed, run separately after the failing test gate prevented the chained build.
- Desktop typecheck and lint: passed. Desktop suite with `NODE_OPTIONS=--no-experimental-webstorage`: 46 files passed; 552 tests passed, 88 skipped (640 total). No tests were weakened or newly skipped.
- `cargo check --offline`: passed in 33.62 seconds with `CARGO_TARGET_DIR=/private/tmp/m7-S7ad-cargo-target`. The specified warm target was attempted first but the sandbox refused its `.cargo-build-lock` outside writable roots.
- Three built-CLI state captures: passed. `app.json` records the shell PATH with no target; `setup-app.json` records that same PATH and `acme/team` from the real setup-to-app hand-off; `plain-after-setup-app.json` confirms the next plain app launch clears the target. Each capture was read back and checked. These are state files, not protocol frames.
- Exactly five Tauri command registrations remain. `app` remains outside `FRAME_VERBS`; protocol remains 1.
- No Playwright, installs, network, commits, pushes, or git commands against this repository. The supplied fixture script used git only within its scratch fixture, as authorised. Scratch files were removed after their state snapshots were captured.

## Reproduce the state captures

From this worktree, run the root build. Run `bash <absolute-record-dir>/fixture.sh <absolute-record-dir>/fx`, then run `HOME=<absolute-record-dir>/fx/home node <absolute-record-dir>/prove-app-state.mjs` with working directory `<absolute-record-dir>/fx/repo/seed`. The copied fixture script points `CLI` at this worktree’s rebuilt `dist/index.js`.

The proof imports the built app/setup commands and uses the existing `open: false` test knob, with a fixture-only installation marker. External commands and unexpected prompts throw; no native app launch or download is attempted. The captured `entry` points to the rebuilt CLI. This proves persisted state and the hand-off, not native window behavior or a Windows runtime.

## Scope notes

Build spec §4.2 now documents desktop state. §6.1 step 8 remains unchanged; its hand-off sentence is separate spec debt. The adapter README’s older state-field list remains unchanged under the documentation-edit constraints. No PR was created; the proposed PR wording above records D4 as decided.
