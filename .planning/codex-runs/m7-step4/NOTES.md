# M7 Step 4: native verification on this Mac (2026-09-09 02:26-02:32 UTC, main a87bf46)

Build: `npm run tauri build --prefix desktop -- --bundles app` (rustup cargo, shared target dir); release profile in 1m 22s; one bundle, `Terum Skills.app`, ad-hoc signed, notarization skipped (no Apple credentials; expected for a local build). `tauri-build.summary.log`.

Launch 1 (fixture HOME, the S7b fixture team with a hand-written `run/app.json` carrying a `target`): up the full 45 s; `--frames status` and `--frames setup` spawned at t=3 s (the first-run route consumed the target and drove `setup`); `status` exited in a second; `setup` stayed blocked at "Use this identity?" for the human; SIGTERM ended the app in under 3 s and no CLI child survived (AD-12 on the real binary); zero stderr; native preferences created under `<HOME>/Library/Application Support/com.terum.skills/preferences.json` with `lastRoute: /onboarding/boot`. `launch-fixture.log`.

Launch 2 (Ryan's real team; `run/app.json` backed up, pointed at the worktree CLI for the run, restored after): up 45 s; `--frames ls --team …` at t=1 s and `--frames ls member …` at t=44 s (a second read well after the first settle), each exiting in a second; zero stderr; clean quit, no orphans; preferences migrated from the earlier webview state (`lastRoute: /marketplace`). `launch-real.log`.

Served DTOs: `status`, `ls --local`, `ls` recorded from the worktree CLI against the real team replayed through the adapter in a temporary vitest (frames kept outside the repo: they carry the maintainer's identity): status() = team Terum, 2 members, 4 skills, identity and tools present; settings() = 0 placements, 4 SHARED, PINNED_N 0; library() = the four real skills, none installed; no design constant in any DTO.

Not verifiable here: native pixels (Ryan's two-line check is in the status file); the child cap under load (never more than two children alive; Rust unit test only); the reader-join and bounded-cancel paths live (cargo test only); Windows (no host).
