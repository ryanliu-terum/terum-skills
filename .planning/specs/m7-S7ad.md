# m7-S7ad: `app.json` carries the launch PATH and the join target (CLI + shell + adapter)

**Status:** LOCKED for implementation (M7 queue, batch 7 of tranche 1). Rows BM-11, BM-12, AD-19, AD-18. Approver named for information: Ryan (phase-1 spec §4.2; the `app` verb is his decision walk D1). Depends on S7af and S7ag (stack on `origin/codex/m7-S7ag` for `lib.rs` and `origin/codex/m7-S7af` for the adapter while either is unmerged).
**Sources:** the takeover ledger **D4 (LOCK): the recorded launch PATH**, written by `app` and `setup` on every launch, reused by the shell; a missing key falls back to the process PATH; no login-shell probe (Ryan's fork is decided; state it as decided in the PR body). Teddy's D-BM-3 = A with rider: the join target is whatever the invite's generated wizard command already carries (`setup <org>/<repo>`); a joiner never types or chooses the team and no new prompt asks for it. M7 document §4 S7ad, §10.2 BM-11 and BM-12 (paste-ready edits), §10.7 BM-11 correction, §10.8 AD-18/AD-19. Ledger D9: `lib.rs` keeps exactly five commands.
**Governing rules:** root `AGENTS.md`; `desktop/AGENTS.md`; `hello.protocol` stays 1 (`app.json` is not a frame); `app.json` is machine-local run state under §4.2, never an owner file.

## 0. What this batch is

Opened from the Dock the app hands the CLI the inherited GUI environment, so the CLI cannot find `git`, `gh` or the right `node` (blank-map bug 1); and a joiner who says yes to the app in `setup` is stranded because nothing carries the join target into the app. The CLI records the PATH it saw and the setup target in `run/app.json`; the shell replays PATH into every child; the adapter reads both and no longer memoises a broken state file for the whole session.

## 1. CLI half (`src/commands/app.ts`, `src/commands/setup.ts`, `.planning/specs/2026-09-02-phase-1-build.md` §4.2)

- `AppState` (`app.ts`, today exactly `{ schema, node, entry, version, writtenAt }`) gains `path: string | null` after `entry` (`process.env.PATH ?? null`; Node reads Windows `Path` case-insensitively; the string is replayed verbatim, `;`-delimited there) and `target?: string` (written only when set; a later plain `app` run omits it, so `writeState`'s rename-over-the-file clears it). `AppArgs` gains `path?` and `target?` test knobs. `setup.ts` passes `target: args.target` where it hands off to the app ("Continuing in the app. Join `<target>` there."). The read side (`app.ts`'s cast of the JSON) types `path?: string | null` so files older than this release still parse. `app` stays OUT of `FRAME_VERBS`.
- Spec: §4.2's local-state tree gains the `run/app.json` line (undocumented since PR #58) and one paragraph: the fields, that `path` is the PATH the writing process saw and refreshes on every `app`/`setup` run, the consume-once rule for `target` (the shell remembers the consumed `writtenAt` in its own prefs so a Dock relaunch a week later does not re-route a joined user into the wizard), and that a missing `path` means the shell uses its own environment. Do not touch §6.1 step 8's hand-off sentence (separate spec debt; say so).
- Tests: extend the pinned block in `src/commands/__tests__/app.test.ts` (`path` equals `process.env.PATH ?? null`; `target` present only when given; older files parse); `src/commands/__tests__/setup.test.ts` (`target` reaches `verbs.app`).

## 2. Shell half (`desktop/src-tauri/src/lib.rs`)

`cli_spawn` gains an optional `path: Option<String>` argument; when `Some` and non-empty it sets `command.env("PATH", path)`; when `None` the child inherits the process environment (the fallback D4 names). Nothing else changes in `lib.rs` (S7ag's lifecycle work is on the branch you stack on). `cargo check` is the gate (`CARGO_TARGET_DIR=/Users/ryanliu/Documents/Terum/.m7-cargo-target`, warm).

## 3. Adapter half (`desktop/src/backend/tauri/bridge.ts`, `index.ts`)

- **AD-19 (amended 2026-09-09):** Desktop launch state is `{ schema: 1, node, entry, path, version, writtenAt, target?, intent? }`. `appStateSchema` declares optional `path: z.string().nullable().optional()`, `target: z.string().optional()`, and `intent: z.literal('setup').optional()`; `writtenAt` is REQUIRED (the consume-once key). `spawn` passes `path: state.path ?? null` to `cli_spawn`. intent: 'setup' is written only when setup hands off to the app (creator or resume); a plain app launch omits and therefore clears both target and intent. The shell exposes the whole context as Backend.launchContext() (a valid file without target is a context, not null) and re-reads the file when the running app is reopened by a second open, replacing its cached node/entry/PATH as well; the successful-read memo (AD-18) is per launch request, not per process lifetime. Consumption stays once per writtenAt, recorded by S7r's routing only from the driven setup's outcome.
- **AD-18:** a truncated or unparseable `app.json` surfaces the `NO_STATE` guidance ("Run `terum-skills app` from a terminal once…") with the parse detail appended, never a raw `SyntaxError`; `readAppState` catches `JSON.parse` failures too. `index.ts` stops memoising a FAILED read for the session: `stateOnce` is kept only when the read succeeded; a failure is retried on the next call (a `terum-skills app` run rewrites the file).
- Tests: `bridge.test.ts` (new; fake `invoke`): truncated JSON → `NO_STATE` text; old file without `path` parses; `path` reaches `cli_spawn`'s payload; `run.test.ts`: a failed state read is retried on the next run, a successful one is memoised. Real-data proof (orchestrator): the fixture's `app.json` written by `node dist/index.js app --dry-run`-equivalent test knob shows `path` equal to the shell's PATH and `target` when `setup <target>` handed off.

## 4. Acceptance
Root: `npm run lint && npm run typecheck && npm test && npm run build`. Desktop: `npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test`; `cargo check`. No Playwright, no git, no network, no installs.

## 5. Out of scope
The onboarding route and the consume-once pref (S7r); any sixth Tauri command (D9); a login-shell PATH probe (rejected by D4); `open --args` (the webview cannot read argv).
