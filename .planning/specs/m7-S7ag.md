# m7-S7ag: the Rust child lifecycle (app-only, src-tauri)

**Status:** LOCKED for implementation (M7 queue, batch 2 of tranche 1). Rows AD-11, AD-12, AD-13. Approver named for information: Ryan (src-tauri is his). Depends on: nothing; S7ad stacks on this branch (both edit lib.rs).
**Sources:** M7 document §4 S7ag and §10.8 AD-11..13; the blank-map review bugs 5, 6, 7 (`.planning/research/2026-09-08-m7-close-the-canvas-gaps.md`; the review's REPORT.md section 4). Ledger D9: `lib.rs` stays at FIVE commands (`cli_spawn`, `cli_write`, `cli_kill`, `read_app_state`, `host_platform`); no sixth command, no file watching, no timer.
**Governing rules:** `desktop/AGENTS.md` invariants 1 and 8 (the seam: only `src/backend/tauri/**` imports `@tauri-apps/*`; no git, no network, no installs, no Playwright in the sandbox). Rust: `cargo check` is the gate you can run (`CARGO_TARGET_DIR=/Users/ryanliu/Documents/Terum/.m7-cargo-target cargo check --manifest-path desktop/src-tauri/Cargo.toml`; the target dir is warm); `cargo test` too if you add unit tests. You cannot launch the app; say so in the report, never fake a lifecycle observation.

## 0. What this batch is

No CLI change, no seam DTO change. Three defects in `desktop/src-tauri/src/lib.rs` (the CLI bridge) and their TypeScript halves in `desktop/src/backend/tauri/run.ts` and `bridge.ts`: a successful run can be reported as "exited before reporting a result" because `Exit` can be emitted before the last stdout lines are delivered; cancel kills only node and orphans its `git clone`; and there is no cap on concurrent children.

## 1. AD-11: join the readers before `Exit` (lib.rs `cli_spawn`, run.ts, bridge.ts)

Today `cli_spawn` spawns three threads: a stdout reader (`for line in BufReader::new(stdout).lines()`), a stderr reader, and a waiter that polls `try_wait()` every 25 ms and emits `LineEvent::Exit` the moment the process is gone, discarding both reader `JoinHandle`s. The last `result` frame can therefore arrive after `Exit`.

- Keep the two reader `JoinHandle`s (`let out = std::thread::spawn(...)`, `let err = ...`) and move them into the waiter thread; after `try_wait()` returns `Some(status)`, `let _ = out.join(); let _ = err.join();` and only then emit `Exit { code }` and remove the child from the map. Readers end when the pipes close, which happens when the process exits, so the join is bounded.
- `run.ts`: the `onEvent` handler starts with `if (finished) return;`, which drops every event after the first settle. Keep that guard for `stdout`/`stderr` (a settled run needs no more frames) but the `result` frame itself must settle before `exit`: with the Rust fix the order is guaranteed, so the TypeScript change is to make the `exit` handler's "exited before reporting a result" message the only path that fires when NO result frame arrived, and to record in `stderr[]` any stdout line that arrives after settle instead of silently dropping it (a diagnostic, not a frame). Add a test: stdout `result` then `exit` settles ok; `exit` then a late stdout `result` (the old race, kept as a regression test of the TS side) still settles once and does not throw.
- `bridge.ts` `spawn`: stop calling `unlisten()` inside the event callback on `exit`. Instead unlisten when the adapter is done with the run: return the `unlisten` function from `spawn` (extend the `Bridge` interface: `spawn(...): Promise<() => void>`), and have `run.ts` call it after `finish()` on the exit event (or on `cancel()`). The fake Bridge in the tests returns a no-op.

## 2. AD-12: a real cancel path (lib.rs `cli_kill`)

Today `cli_kill` drops stdin and immediately calls `try_wait()`, so the documented "closing stdin is cancel" path never gets a chance and `kill()` always fires, killing only the `node` process and leaving a `git clone` child running while the app says "Cancelled."

- After `guard.stdin.take()`, release the handle lock and poll `try_wait()` every 25 ms for up to 1,500 ms (the CLI's cancel handling ends the run with a `result` frame on stdin close); if the process is still alive, kill the whole process group: on Unix send `SIGTERM` to `-pid` via `libc::kill(-(pid as i32), libc::SIGTERM)` (add `libc` as a Unix-only dependency in `Cargo.toml` under `[target.'cfg(unix)'.dependencies]`; and make the child a group leader with `std::os::unix::process::CommandExt::process_group(0)` at spawn) then after another 500 ms `SIGKILL`; on Windows call `child.kill()` (no process groups; document it). Never take the handle lock across a sleep (the waiter thread needs it).
- Emit nothing new: the waiter thread still emits `Exit` when the process is gone; the TypeScript side already settles `Cancelled.`.
- Test (TS): `cancel()` writes the cancel frame, calls `kill`, settles `Cancelled.`, and a later `exit` event is ignored (already covered; keep).

## 3. AD-13: a child cap (lib.rs `Bridge`)

- `Bridge` gains `const MAX_CHILDREN: usize = 8;`. `cli_spawn` refuses with `Err("too many pending terum-skills processes (8); wait for one to finish")` when the map already holds 8 live children. The TypeScript `cliRun` turns a rejected `spawn` into `{ ok:false, error: 'Could not start terum-skills: …' }` today; keep that, and make `read()` in `index.ts` surface it unchanged (no retry loop in this batch).
- The map entry is removed by the waiter thread after `Exit`, so a finished child frees its slot; a child that never exits holds its slot (that is the cap's purpose). Pairs with BM-08 (one git child per listing) in S7f.
- Rust unit test if the crate has a test target (it has none today: add `#[cfg(test)] mod tests` with a test of the cap predicate on a `HashMap` of the right length; do not spawn processes in a unit test).

## 4. Tests

- `desktop/src/backend/tauri/__tests__/run.test.ts`: the two AD-11 cases above; the fake Bridge's `spawn` returns an unlisten spy and the test asserts it is called exactly once after exit.
- `desktop/src/backend/tauri/__tests__/index.test.ts` (exists after S7af; if S7af is unmerged when you start, stack on `origin/codex/m7-S7af` as the orchestrator instructs): a spawn rejection surfaces as `ok:false` with the bridge's message.
- Rust: `cargo check` green; `cargo test` green if you added the unit test.

## 5. Acceptance

`npm run typecheck && npm run lint && NODE_OPTIONS=--no-experimental-webstorage npm test` in `desktop/` (report real counts); `cargo check --manifest-path desktop/src-tauri/Cargo.toml` (report the warning count). No git, no network, no installs, no Playwright. Report the lifecycle itself as NOT reproduced (no packaged app in the sandbox); the orchestrator verifies what it can in Step 4 of the launch runbook.

## 6. Out of scope

`app.json` fields and `command.env("PATH", …)` (S7ad, which stacks on this branch); any new `#[tauri::command]` (Ledger D9); `capabilities/default.json`; the adapter's read models.
