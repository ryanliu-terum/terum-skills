# src/backend/tauri — the real adapter (M6)

Nothing else in `src/` may import `@tauri-apps/*`; this directory is the whole native surface.

- `detect.ts`: `isNativeShell()`, the one probe `src/backend/index.ts` uses to pick this adapter over the mock. No Tauri import.
- `bridge.ts`: the shell's five commands (`cli_spawn`, `cli_write`, `cli_kill`, `read_app_state`, `host_platform`, all in `src-tauri/src/lib.rs`) behind a `Bridge` interface, so the adapter is unit-tested with a fake.
- `frames.ts`: the CLI's frame protocol as read here (`terum-skills docs/frame-protocol.md`, protocol 1). The CLI owns its wire shapes; the seam owns `../types`; `run.ts` maps one to the other.
- `run.ts`: one `terum-skills --frames <verb>` process as a seam `Run<T>`: buffered frames, answers forwarded to stdin, `done` settled from the `result` frame, cancel = cancel frame then kill.
- `index.ts`: `createTauriBackend()`. Every long verb is a process. Read models the CLI has no verb for return `ok:false` naming `GAPS.md`, so the drawn error boards render and nothing is invented.

How the adapter finds the CLI: `~/.terum/skills/run/app.json` (`{schema:1, node, entry, version}`), written by `terum-skills app` on every launch (decision walk 2026-09-08, D1). Without it every call fails with one sentence telling the person to run `terum-skills app` once.

Honest gaps in this first adapter (each is a seam ask, not a bug to paper over):
- `library` and `skill` are served from `ls`, `ls --local`, `status` and `validate` (S7f); `status` and `settings` from `status`, `ls --local` and `host_platform()` (S7k, a failing status with a value still serves its teams beside the error): every field the CLI does not return is `null` or `—`, never a design constant. `update` is served from `update` (S7e: the report validated strictly, the advice verbatim). `onboarding`, `receipts`, `inbox`, `catalog`, `roster` still fail with a GAPS.md message and are hidden by `surfaces()`; each closes in the batch that first serves it (S7b roster/catalog, S7n receipts, S7r inbox/onboarding).
- `sync` returns empty `placed`/`removed` lists: the CLI returns counts, the seam wants names. The run's `print` frames carry the story.
- `publish.version` is the PR URL or branch; `eval.receipt` is null (the CLI writes receipts to the repo, it does not return them).
- `install.scope`, `invite.scope`/`role`, `connect.keepSource`/`keepRepo`/`relocate`/`forget` are not passed: the CLI has no such options or wants ids the seam does not carry (GAPS.md).
- Preferences live in the webview's localStorage (same keys as the mock), not the store plugin, so a preference set in browser mode reads in the shell.
