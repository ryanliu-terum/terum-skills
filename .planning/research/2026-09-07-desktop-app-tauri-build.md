# The Tauri build: where it happens, and who needs a Mac

**Status:** RESEARCH (2026-09-07T10:25Z). Not a spec. Answers Teddy's question verbatim: "we need to figure out the tauri build (if I should do it here or hand it off to someone with a mac)."
**Inputs:** seven probe reports written today (copied to `~/Projects/SSM/design/terum-skills/.review/2026-09-07-tauri-build/`, see the Appendix), fourteen adversarial refuter passes over seven claims K1 to K7 (thirteen reports exist; `refute-K6-practice.md` was lost to the session limit, VD header), and the existing research: `~/Projects/SSM/design/terum-skills/.review/2026-09-07-desktop-spec/tauri-feasibility.md` (TF), `.../frontend-stack.md` (FS), `~/Projects/SSM/terum-skills/.planning/research/2026-09-07-desktop-app-investigation.md` (INV). CLI HEAD `8bf12a8`, npm `terum-skills@0.1.3`, both as of the snapshot HO:58 records (2026-09-07 09:11 UTC), and HO:58 adds its own caveat verbatim: "origin/main moved three times during this session, re-pull before trusting any line number". No conclusion here rests on the hash or the npm version (`~/Projects/SSM/.claude/handoff-desktop-spec.md:58`, abbrev. HO).
**Citation shorthand:** TE = `toolchain-experiment.md`, MC = `web-macos-build-and-ci.md`, AP = `web-actions-pricing.md`, GS = `web-gatekeeper-signing.md`, WW = `web-wsl-and-windows-arm.md`, LB = `local-box-and-windows-host.md`, RH = `repo-and-house-facts.md`, VD = `verdicts-digest.md`. Every number below carries one of these plus a section, or a `file:line`.
**Standing rule, and it survived every probe:** nothing in this document claims that anything "works in Tauri" from this box. Nothing was run on macOS this session (GS §0, §9 item 9).

---

## 0. The answer in five lines

1. You do not need a Mac to *make* the app, and you do need one to *look* at it. Those are two different jobs and the research had been treating them as one.
2. What was actually checked here is a scaffolded Tauri shell (`tauri init --app-name tauri-probe`) with all six M5 plugins registered in `Cargo.toml`/`lib.rs` and their capability permissions resolving, and the macOS chrome keys set in `tauri.conf.json` (TE §1.4, §2 steps 5 and 6). No app code exists yet. That scaffold type-checks for macOS arm64 and both Windows targets with sub-second edit feedback (TE §2 steps b4/c4/d4, 6b, §5.1 to §5.4), except the sidecar and any `invoke` round trip, neither of which was exercised (TE §5.4, §5.7).
3. GitHub Actions on a **public** repo builds the real `.app` (arm64 and, until the Mac's architecture is known, x86_64 too) and an arm64 NSIS Windows installer for $0.00, unlimited, with zero Apple credentials, on a macOS 26 arm64 runner (3-core M1, 7 GB RAM, 14 GB SSD: AP §3, MC §3.3) (AP §2, §6a; MC §3.1 to §3.3, §4).
4. What still needs a person on a Mac is the seventeen-row look at the macOS chrome (RH §3.3, C1 to C17), because `tauri-driver` is Windows and Linux only and there is no macOS UI automation (RH §4.4, TF R8).
5. Recommendation: **E, the hybrid.** Author and `cargo check` here, let CI build both flavours, hand a Mac owner a one-page checklist and the tarball matching their architecture. That is not "hand off M5"; it is hand off the last hour of M5.

---

## 1. What "the Tauri build" actually is

It is not one job. It is five, and they have different hardware requirements. Conflating them is why "M5 happens on the Mac" (INV §10) reads as a bigger blocker than it is.

| # | Job | What it produces | Needs a Mac? | Needs CI? | This box? |
|---|---|---|---|---|---|
| J1 | Author the Rust glue and config: `main.rs`/`lib.rs`, the `Builder` chain, plugin registration, capability files, `tauri.conf.json` including the macOS chrome keys | source | No | No | **Yes, proven** (TE §5.1, §5.4) |
| J2 | Type-check it per target | a green `cargo check` for `aarch64-apple-darwin`, `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc` | No | No | **Yes, proven and genuinely per-target** (TE §2 step 6b) |
| J3 | Produce a `.app` / `.app.tar.gz` / `.dmg` and the Windows installers | the artifacts a person installs | A macOS **host**, which a runner is | Yes, or a Mac | **No, and silently so** (MC §1.3) |
| J4 | Run it and look at the window, especially the macOS chrome | a verdict on C1 to C17 | **Yes, a human on a Mac** | No | No (RH §4.4) |
| J5 | Sign and distribute | something a teammate can open without a ritual | Only to *mint* the Developer ID cert (GS §3.2) | CI can *use* the cert | No |

J3's failure mode is the one to internalise. `tauri-bundler` compiles its `macos` module only under `#[cfg(target_os = "macos")]` on the **host**, so on Linux `MacOsBundle` and `Dmg` fall through to the catch-all arm, log `"ignoring app"`, and the build **exits 0 having produced nothing** (MC §1.3, `crates/tauri-bundler/src/bundle.rs:8-11,166-198`). It is not an error you would notice.

---

## 2. What this box can and cannot do, measured

Everything in this section was run today, not reasoned about.

**Can: type-check the real targets.** `cargo check` passes for all three real triples with `tauri 2.11.5`, `tauri-build 2.6.3`, `wry 0.55.1`, a 544-package graph, all six M5 plugins (shell, opener, store, window-state, clipboard-manager, dialog) with their `*:default` permissions resolving, and the `titleBarStyle: "Overlay"` / `hiddenTitle` / `trafficLightPosition` window keys (TE §2 steps b4, c4, d4, 6). It is **genuinely per-target**: a deliberate `E0308` inside a `#[cfg(target_os = "macos")]` block calling `WebviewWindow::ns_window()` is caught by the darwin target and correctly ignored by the Windows target (TE §2 step 6b, errors e3/e4). `tauri.conf.json` is validated at check time by `tauri-build`'s build script; a misspelled `trafficLightPositon` fails with the full list of accepted keys (TE §3.4). Cold 52 to 75 s per target; a real edit to `src/lib.rs` re-checks in under 0.5 s; worst peak RSS 2.1 GB against ~3.6 GiB available (TE §2 steps 4c, 4d). That 3.6 GiB and the ~3.8 GiB quoted two paragraphs down are two separate measurements taken minutes apart (TE §2 4d, LB §4), and LB §4 records the headroom as shared with running Claude sessions, so neither is a stable ceiling.

**The setup cost is higher than "install rustup".** rustup alone **fails** for `aarch64-apple-darwin` at `objc2-exception-helper`, because host gcc rejects `-arch` (TE §2 step 4b row b; VD K4/evidence, K4/practice). It also needs `clang-21` and `llvm-21` fetched with `apt-get download` (no root) and unpacked with `dpkg-deb -x` into a private 268 MB prefix, wired in through `env.sh` (`CC`, `RC=llvm-rc`, `CFLAGS_aarch64_apple_darwin=--target=arm64-apple-darwin`, `AR_aarch64_apple_darwin`) (TE §1.6, §1.7). No sudo, no system package, no touched dotfile. Anyone handed "just install rustup" hits an opaque build-script failure. **One latent root dependency, though.** `apt-get download` needs no root only because a usable package index is already on disk; `apt update` refreshes that index and needs root, and it was not run this session. The base `resolute` InRelease is dated 2026-04-23, `-updates` 2026-09-05 (LB §1). So re-resolving `clang-21`/`llvm-21` after the index goes stale is a `sudo apt update` away (VD K4/practice, which states the dependency in those terms). Recorded as §8 item 21 so it is not buried in an effort footnote.

**Cannot: link, bundle, or run.** Linking was measured, not assumed: a plain `fn main(){}` fails for all three targets (Apple SDK missing, `link.exe` missing, and with `rust-lld` forced in, `could not open 'kernel32.lib'`) (TE §2 step 7, §5.2). No `.app`, `.dmg`, `.msi`, `.exe` or NSIS output is reachable here. Docker is unusable and unfixable without sudo (no `newuidmap`/`newgidmap`), and a macOS VM is closed off by an absent `/dev/kvm` and no qemu (VD K1/practice). Cross-compiling to a Windows NSIS installer from Linux is documented but explicitly discouraged by Tauri, "only as a last resort if local VMs or CI solutions like GitHub Actions don't work for you" (MC §1.1; WW §B2.5 item 4).

**`tauri dev` here is two sudo commands away, and then degraded.** An apt simulation resolves to **219 newly installed packages, ~128.4 MB** across 230 `.deb` files (LB §1). WSLg does display real windows: a Tk toplevel was created, mapped by weston and logged with a window id (LB §2). But GL here is **measured** as `llvmpipe (LLVM 21.1.8)`, pure CPU rasterisation, caused by a DRI3 failure on the Xwayland path rather than by the missing `/dev/dri` (WW §A0). That is exactly the configuration in which WebKitGTK paints a blank window with no error, no warning and no log line, until `WEBKIT_DISABLE_COMPOSITING_MODE=1` (then `WEBKIT_DISABLE_DMABUF_RENDERER=1`) is set, ideally in `main()` rather than the shell (WW §A1.1 tauri#15936, open; §A1.5). Whether that variable is sufficient **on this box** is itself NOT VERIFIED (§8 item 17). Upstream still has no diagnostic: tauri#15937 closed unmerged, wry#1827 open (WW §A1.1). No report of Tauri v2 under WSLg on **aarch64** exists anywhere upstream (WW §A1.4). RAM is tight: 7.5 GiB total, ~3.8 GiB available, 2 GiB swap already 435 MB used, shared with Claude sessions (LB §4). Known WSL rendering defects are open: border-radius artefacts (#14756) and dead wheel-scroll (#14427) (WW §A1.2). And none of it exercises the macOS chrome, which is a macOS-only code path (LB §5 item 2). The third-party `"icon": []` workaround claim is **refuted as a mechanism**: `find_icon` falls back to `icons/icon.png` on an empty list, so the same PNG is embedded anyway; the real cause is a non-RGBA PNG on the Linux window-icon path (WW §A4).

**The Windows host is a better local machine than the WSL side, with one hole.** It is a Qualcomm Snapdragon **ARM64** Windows 11 laptop (build 26200.9168), with WebView2 152.0.4191.66 ARM64-native carrying arm64/x64/x86 back-ends, VS Build Tools 2026 (MSVC 14.50.35717) but **x64/x86 toolsets only**, the 10.0.26100.0 SDK including full arm64 `um`/`ucrt` libs, Node 22.12.0, Git 2.51.2, gh 2.92.0 (LB §3; **not logged in and with no config**, VD K7/practice, which also notes the consequence: an interactive GitHub login on the host is needed the moment the app repo stops being public), VS Code, and **no Rust at all** (LB §3, F5). So it can build `x86_64-pc-windows-msvc` today (running under emulation, backed by `EBWebView/x64`) and `aarch64-pc-windows-msvc` after **one VS Installer action at a UAC prompt** to add the MSVC ARM64 component and CRT (LB §3, F6; VD K7/practice). WSL2 NAT localhost forwarding is **proven on this machine**: a server bound to `127.0.0.1:1420` inside WSL answered HTTP 200 to `curl.exe` from the Windows host at both `localhost:1420` and `127.0.0.1:1420`, with no port-proxy and no firewall change (WW §B4). Vite HMR across that boundary, WebView2's loopback behaviour and `beforeDevCommand` across the split are all **NOT VERIFIED**, and `src-tauri` would need a native Windows checkout (WW §B4). A CI-built arm64 NSIS installer sidesteps all of that: it would let Teddy run the Windows flavour on that laptop with no local toolchain at all.

---

## 3. Options

**What it is.** Choosing which machine or machines produce and verify the Tauri shell (M5), and as a consequence which signing path, which transport, which installer formats and which repo the app lives in.

**Why it is a real fork.** Three things collided today. First, the investigation's machines table (INV §1.4) has exactly three columns, three physical boxes, and **no CI column** (RH §6 item 3), so the option set it framed was never complete. Second, this box turned out to be able to do far more of M5 than "M5 on the Mac" implies (TE §5, "what it means for the build order"). Third, the Windows host turned out to be ARM64, which nobody had probed (LB F4), so any matrix assuming `windows-latest` means x64 would ship an emulated binary to its own author's laptop.

**Fit** is 0 to 4 against the governing decisions: the no-server premise (RH §4.4, TF R12), the import seam (the rule that nothing outside the seam directory imports `@tauri-apps/*`: INV:304, INV:311 and TF R6, via RH §4.4), the "no second source of truth" rule D20 (quoted at RH §4.2, in the store-plugin row) and the packaging rule D21 ("the CLI serves the UI", quoted at RH §1.1 via FS D-F9), the **M0 to M6** build order (INV §10, lines 299-305; RH §4.1), and the design's macOS chrome (RH §3.1 to §3.3). D23 is in the decision ledger (HO:52) but no report in this set quotes it. **Depth** is 0 to 4: how much of M5 the option actually retires. They are never summed. Effort is a footnote and never decides.

### A. Build and run under WSLg here, with your sudo

Two sudo commands (`apt update`, `apt install` of the nine documented deps), then rustup in user space, then `WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 CARGO_BUILD_JOBS=4 npm run tauri dev` (LB §5).

- **Fit 1.** Respects the seam, but the artifact is `aarch64-unknown-linux-gnu` and runs on neither real target (RH §6 item 4, TF §2.5 "Is a Linux aarch64 bundle here worth anything? No"). It exercises zero of the design's macOS chrome.
- **Depth 1.** It proves the Rust side links and the plugins load on *a* platform. It retires nothing on the checklist.
- **Wins if** you want a fast local window to iterate the non-chrome parts of the shell and are willing to absorb a blank-window debugging session with no upstream diagnostic.
- Effort footnote: two sudo prompts and ~128 MB, then an unbounded amount of llvmpipe debugging with no aarch64 WSLg precedent to lean on.

### B. Hand all of M5 to a Mac owner

They run `tauri init`, write the Rust, build, and look. This is what INV §10 currently implies.

- **Fit 3.** Matches the design's macOS chrome exactly, because the person writing it can see it. Costs nothing in the seam.
- **Depth 4.** Retires all of M5 in one place.
- **Cannot prove.** No Windows artifact at all, so no arm64 Windows verification (the author's own laptop is ARM64 Windows, LB F4), and nothing about CI reproducibility.
- **Wins if** there is a named Mac owner with real availability and you would rather buy simplicity than parallelism.
- Effort footnote: the whole M5 milestone lands on one person, and their inner loop is the only loop, so every config typo costs a round trip. Note the guard rails that make this cheap here (per-target `cargo check`, config-key validation) are exactly what you would be giving away.

### C. GitHub Actions builds on a public repo; a Mac owner only opens and looks

`tauri-action@v1` on `macos-latest` plus `windows-11-vs2026-arm`, Release assets, no Apple credentials.

- **Fit 3.** Produces the real artifacts for the real targets and keeps the chrome verification with a human eye where it has to be. Silent on who authors the Rust.
- **Depth 3.** Retires J3 and J5 outright. Leaves J1/J2 unassigned and J4 with the Mac owner.
- **Wins if** the app repo is public and you want the build to be reproducible by anyone, not tied to a laptop.
- Effort footnote: one workflow file, plus the repo-visibility decision. Free and unlimited on a public repo; on a private repo a macOS job bills $0.062/min against 2,000 included minutes on Free, which at AP §5's 8-to-15-minute planning band is roughly 13 to 25 single-target builds a month (AP §1, §3, §6b).

### D. Use the Windows ARM laptop natively for the Windows flavour

Install Rust, add the MSVC ARM64 component at a UAC prompt, build `aarch64-pc-windows-msvc` on the host, point `devUrl` at the Vite server inside WSL.

- **Fit 2.** Gives a genuine WebView2 window on real hardware, which proves the bundle renders, the plugins load and the seam holds. But it shows Windows chrome, never the macOS `Overlay` / `trafficLightPosition` chrome the design is about (VD K7/practice).
- **Depth 2.** Retires the Windows half of M5 and the "does it run at all" question. Nothing on C1 to C17.
- **Wins if** you want one real window today without waiting on anyone, and you accept that the Windows flavour is the one you get.
- Effort footnote: one UAC prompt you have to click, plus a second native Windows checkout of `src-tauri` and a git round trip per Rust edit; HMR across the boundary is unverified (WW §B4).

### E. The hybrid

Author and `cargo check` here (J1, J2). CI builds both flavours on a public repo (J3). A Mac owner opens the tarball and walks C1 to C17 (J4). The Windows laptop is a second pair of eyes on a CI-built arm64 NSIS installer, with no local toolchain.

- **Fit 4.** Every job lands on the machine that can actually do it. The import seam (INV:304, INV:311, TF R6 via RH §4.4) is what makes it cheap: because nothing outside `src/backend/tauri/` imports `@tauri-apps/*`, the shell can be wrapped around M1's shell before M2 to M4 exist (LB F8).
- **Depth 4.** Retires all of M5 except the one hour of looking that no machine can do.
- **Cannot prove.** The sidecar `externalBin` packaging and any `#[tauri::command]` / `invoke` round trip are untested here and stay untested under E (TE §5.4, §5.7). And the Mac owner opens an artifact nobody has run.
- **Wins if** you want M5 de-risked now rather than scheduled later, and you can get a Mac owner for an hour rather than a week.
- Effort footnote: the same workflow file as C, plus copying `env.sh` verbatim into the M5 setup doc including the `apt-get download` step (VD K4/evidence §6).

---

## 4. What the refuters overturned or narrowed

Fourteen adversarial reports over seven claims. Six of seven claims did not survive as worded. This table is the corrected set; the amended wording is what the rest of this document uses.

| # | Original claim | Status | Amended wording (one sentence) | Report |
|---|---|---|---|---|
| K1 | Nothing shippable can be produced from this box | **REFUTED as worded** | This box cannot itself bundle macOS, but a shippable macOS artifact IS reachable *from* it: the two gates that were checkable are open (`teniroo` has push, not admin, on the public `ryanliu-terum/terum-skills`; the `gh` token carries the `workflow` scope). Branch protection and any org or repo-level allowed-actions policy were not testable and are NOT VERIFIED. | VD K1/evidence, K1/practice |
| K2 | A public repo's CI builds macOS for free with no Apple credentials | **HOLDS** (high) | Confirmed empirically as well as from docs: the public repo `formulahendry/acp-ui` runs `tauri-action` on `macos-latest` with `GITHUB_TOKEN` only, zero `APPLE_*` env vars, and ships an aarch64 `.dmg` plus `.app.tar.gz`. | VD K2/evidence, K2/practice |
| K3 | An unsigned build opens via Open Anyway | **REFUTED in mechanism** | It needs `signingIdentity: "-"` **plus** a tarball transport; for a *fully* unsigned build it is NOT VERIFIED that Open Anyway appears at all, since that dialog offers only Move to Trash and Done. | VD K3/evidence, K3/practice |
| K4 | rustup alone type-checks the macOS target here | **REFUTED** | rustup alone fails at `objc2-exception-helper`; it also needs the `apt-get download` clang-21 prefix and the `env.sh` wiring. | VD K4/evidence, K4/practice |
| K5 | `tauri dev` is runnable here | **HOLDS in conclusion, mechanism corrected** | Two sudo commands gate it, and the blank-window risk is caused by measured **llvmpipe software GL** from a DRI3 failure, not by the missing `/dev/dri`. | VD K5/evidence, K5/practice |
| K6 | Only M1 config changes follow from the build-location choice | **NARROWED** | The choice also fixes the macOS signing path, the download transport, which installer formats exist (no WiX on the arm64 image, so NSIS not MSI), and, if CI runs inside the CLI repo, repo visibility and runner policy. | VD K6/evidence (evidence lens only; K6/practice was killed by the session limit) |
| K7 | The Windows host is viable natively | **REFUTED as "today"** | It is the best local candidate, but it has no Rust and no MSVC ARM64 toolset, so the native build is blocked behind a VS Installer component only Teddy can add. | VD K7/evidence, K7/practice |

---

## 5. Recommendation

**Take E.** Author and `cargo check` the Rust half here; CI on a public repo builds `.app.tar.gz` for `aarch64-apple-darwin` and an arm64 NSIS `-setup.exe`; a Mac owner opens the tarball and walks C1 to C17; the Windows laptop installs the NSIS build as a second pair of eyes. One clause on the Windows deliverable, because it is easy to over-read: the app binary is native arm64, but the NSIS installer stub itself is x86 and runs under WoA emulation on the ARM machine. Tauri's Windows-installer page says it verbatim: "the NSIS installer itself will still be x86 running on the ARM machine via emulation. The app itself will be a native ARM64 binary" (WW §B2.5 item 1). Pair that with the arm64 WebView2 rule in §8 item 8: use the default `downloadBootstrapper` mode, never `offlineInstaller`. The reason is not cost, it is that E is the only option where each of the five jobs in §1 lands on a machine that has been shown to do it. B is the honest alternative and the one to pick if a Mac owner is genuinely available and you would rather not run two loops.

**The recommended macOS artifact is arm64-only, and the Mac's architecture is unknown.** §8 item 4 and RH §7 mark Apple Silicon versus Intel NOT VERIFIED, and no report establishes the machine exists at all. If the Mac owner is on Intel, an arm64-only hand-off produces nothing they can run and E fails on its first attempt. The free mitigation is MC §2.1's own recommended matrix: run both `--target aarch64-apple-darwin` and `--target x86_64-apple-darwin` on `macos-latest`, which on a public repo costs $0.00 for the second row too (AP §2). Build both until the architecture is known, and note that the Intel row is a cross-compile: `macos-latest` is a 3-core M1 arm64 host (MC §3.1, AP §3), and AP §3 states that "Intel builds (`x86_64-apple-darwin`) and universal builds cross-compile from the same host". The hand-off is therefore **two artifacts**, not one: the Release carries an arm64 `.app.tar.gz` and an x86_64 `.app.tar.gz`, and the hand-off page must tell the Mac owner which to fetch (Apple menu, About This Mac; Apple Silicon takes the arm64 file).

**No workflow was run for this app this session.** Every CI timing quoted below is other public repos' warm-cache builds (AP §5) on a 3-core M1 / 7 GB / 14 GB SSD runner (AP §3, MC §3.3); the first build here will be cold and should be expected at the top of the range. And the observed zero-credential proof, the public repo `formulahendry/acp-ui`, ran `tauri-action@v0` (VD K2/practice) while this document recommends `@v1`, whose v1.0.0 breaking changes (MC §2.7) no observed run covers.

**The strongest reason E is the wrong move.** E hands the Mac owner an artifact they did not build, from a toolchain they cannot inspect locally, and then asks them to judge seventeen visual rows against a design they did not draw. If C1 fails, if the `Overlay` bar height differs from the drawn 40 px, if the lights land at the wrong inset, the fix loop is: they report, someone edits here, CI rebuilds in 8 to 15 minutes (AP §5's planning band for a small real app; see "Time expectation" below), they re-download, they re-open, and on macOS each new version may need the Privacy and Security ritual again (NOT VERIFIED whether an Open Anyway exception survives a version bump, GS §9.3). Under B, that loop is one `cargo run` on their machine. If the chrome needs more than about three iterations, B was the cheaper choice and E will have cost more than it saved.

There is a blunter way the first hand-off returns nothing. tauri#15517, "[macOS 26 Tahoe] tao 0.35.3 panics in `did_finish_launching`, Tauri 2.11.2 GUI window opens blank", is **open** against exactly the 2.11.x line this experiment pinned, with severity on 2.11.5 unknown (MC R-C), and `macos-latest` is macOS 26 (MC §3.1). Under E the Mac owner opens a CI-built 2.11.5 bundle on macOS 26 and may get a blank window with C1 to C17 unanswerable. tauri#15801 (Tahoe AMFI 16 KB page-size rejection, single unconfirmed report, GS §2.1) is the second candidate. B does not avoid either, but it lets the Mac owner debug them in place rather than through a CI round trip.

The mitigation is to make the first hand-off as complete as possible, which is what follows.

### The hand-off package for the Mac owner

**What they receive.** A tag, a GitHub Release, and one page.

1. A git tag on the app repo, and a Release with **both** CI-built `.app.tar.gz` files, arm64 and x86_64, until the Mac's architecture is known (MC §2.1's recommended matrix; AP §2 for why the second row is still $0.00; AP §3 for the Intel row being a cross-compile on the same arm64 runner). The literal asset name is not fixed yet: it derives from `releaseAssetNamePattern` and its `[name] [mainBinaryName] [version] [platform] [arch] [ext] [bundle]` variables (MC §2.5), and v1.0.0 added the version to `.app.tar.gz` (MC §2.7), so the name follows from config that does not exist yet. A Release asset downloads anonymously with no GitHub account; a workflow artifact returns 401 without a login (AP §7). Never hand over a workflow artifact.
2. **`HANDOFF-M5.md`** in the repo root: the two-line install below, the C1 to C17 table reproduced there, and what they may change.
3. Do **not** ship a `.dmg`. Quarantine survives the drag to `/Applications` (GS §1.4, Apple forum 767612), and the CI dmg step is flaky and needs `retryAttempts` (GS §2.3, tauri#13804).
4. **An "if the window is blank" note.** Without it a Mac owner acting from the package alone reads a known upstream bug as a broken build. Two named candidates: tauri#15517 (open, macOS 26 Tahoe, tao 0.35.3, blank GUI window on the 2.11.x line, severity on 2.11.5 unknown, MC R-C) and tauri#15801 (Tahoe AMFI 16 KB page-size rejection, a single unconfirmed report, mitigation `--pagesize=4096`, GS §2.1). The instruction is: report the exact macOS version and stop, do not debug. C1 to C17 are unanswerable in that state, so a blank window is a finding in itself, not a failed checklist.

**The two-line install.** Apple states each half separately: that `curl` and `scp` do not quarantine what they download, and that `tar` and `unzip` do not propagate quarantine to what they unpack (GS §1.4, Apple DTS thread 706442). **The combined end-to-end path was never observed on a Mac**. GS §5 R1 says so in those words ("inferred from two Apple statements, not observed. Confidence: high, but NOT VERIFIED on a Mac"), and GS §9 item 9 records that no Mac was reachable at all. So, with that caveat:

```sh
curl -L -o terum-skills.app.tar.gz "<release asset URL>"
tar -xzf terum-skills.app.tar.gz && mv "<the .app the tarball contains>" /Applications/
```

Two things are read off the artifacts rather than assumed. Which asset URL to use: the arm64 one on Apple Silicon, the x86_64 one on Intel, since both are published until the architecture is known. And the bundle name inside the tarball, which follows from `productName` in `tauri.conf.json`, a file that does not exist yet.

Warn them explicitly: if they download it in Safari and double-click it in Finder instead, Archive Utility **does** propagate quarantine and they land in the five-step ritual (GS §5 R1). That ritual, on Sequoia and Tahoe, is: double-click, get blocked, System Settings, Privacy and Security, scroll, Open Anyway (available only for about an hour after the failed launch), confirm, then type their login password (GS §1.1). Control-click and Open is gone (GS §1.1). Their escape hatch either way is `xattr -dr com.apple.quarantine "/Applications/<the app>"` (GS §5 R3); whether that needs `sudo` for a bundle the user copied themselves is ownership-dependent and NOT VERIFIED (GS §9 item 4).

**Three setup commands, only if they want a local loop.** Not required for the checklist.

```sh
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install && npm run tauri dev
```

The macOS runner has Xcode 26.6 plus Command Line Tools, Rust 1.98 with rustup, and Node 24.20 preinstalled (MC §3.2), which is the evidence that this is the right shape of prerequisite list. Tauri's prerequisites page **was** fetched this session (MC appendix lists `src/content/docs/start/prerequisites.mdx` at 200; LB §1 records `curl -sL https://v2.tauri.app/start/prerequisites/ -> http=200 bytes=161243`; WW §A3 greps the same page's stripped text), but no report extracted its macOS tab, so this three-command list is inferred from the `macos-latest` runner inventory (MC §3.2), not read off Tauri's macOS prerequisites. **NOT VERIFIED** that it is complete.

**What they may change, and what they may not.** May: `tauri.conf.json` window values (`trafficLightPosition` x and y, `minWidth`/`minHeight`, `hiddenTitle`), and the placement of `data-tauri-drag-region` on the top bar. May not, without coming back: `titleBarStyle` or `decorations`, because C1 is the whole point (see §6), and anything under `src/` outside the seam directory. The seam path itself is unsettled: TF R6 prescribes the grep against `src/api/tauri/` while INV uses `src/backend/tauri/` (RH §4.4). The lint rule and the grep both depend on which M1 picks; this document writes `src/backend/tauri/` throughout only because INV does.

**The checklist.** C1 to C17 is derived from the drawing, not invented: 12 px dots with a 0.5 px inset ring, 8 px gap, 16 px left inset, centres at x 22 / 42 / 62 and y 20 in a 40 px bar, the Terum mark's 24x24 box beginning at x 76, and a natural minimum width of 960 px (240 + 480 + 240) (`build.py:172-173`, `:212-213`, `:220-227`; RH §3.1). Two rows, C4 and C5, are measure-then-record rather than pass/fail, because the **native** macOS light diameter and pitch were not established from an Apple source today (RH §7). `def traffic_light` is now at **`build.py:212`** and the red/yellow/green triple at **`build.py:224`**, inside `top_bar` (which opens at `:220`); TF §6 cites 204 and 216, an eight-line drift and stale (RH §3.1).

The seventeen rows, reproduced from RH §3.3 so this document stands alone:

| # | Check | Pass condition | Source |
|---|---|---|---|
| C1 | macOS window has `titleBarStyle: "Overlay"` **and** `decorations: true` | both present; not `decorations: false` | TF:608, :617, R13 TF:886 |
| C2 | `trafficLightPosition` is set in **logical** px | `{ x: 16, y: 14 }` puts the group's top-left where the drawing does | RH §3.1 derived; TF:637 |
| C3 | Lights land at the drawn inset | leftmost light's left edge 16 px from the window's left; group centred on y = 20 px in a 40 px bar | `build.py:223`, `:173` |
| C4 | Light diameter vs the drawing | drawn dots are 12 px; measure the OS-drawn ones and record the delta (native size NOT VERIFIED) | `build.py:213` |
| C5 | Light spacing vs the drawing | drawn pitch is 20 px (12 + 8); measure the OS pitch, record the delta | `build.py:224` |
| C6 | Nothing collides with the lights | the Terum mark's 24x24 box begins at x = 76 px; nothing paints left of it on macOS | `build.py:223-225` |
| C7 | Overlay bar height vs the drawn bar | drawn bar is 40 px; `Overlay` has OS-dependent height variations, so record the actual height and whether the row still centres the search field | `build.py:173`; TF:615 |
| C8 | Hidden title | `hiddenTitle: true`; the design draws no window title anywhere | TF:607; `build.py:220-234` |
| C9 | Drag region works on the bar background | dragging the empty area of the bar moves the window | TF:619 |
| C10 | Drag region does not silently fail on children | back/forward, the 480 px search field and the bell are each explicitly drag-enabled or explicitly interactive; no dead element | TF:619, R14 TF:887 |
| C11 | Double-click-to-zoom | double-clicking the bar background zooms/unzooms; under `Overlay` plus a custom drag region this is hand-implemented via `startDragging()` | TF:619 |
| C12 | Dragging while unfocused | click-drag on an unfocused window still moves it, or the limitation is accepted and written down | TF:615 |
| C13 | Min size | `minWidth`/`minHeight` set; at minimum the 240 + 480 + 240 = 960 px clusters do not overlap | TF:635; `build.py:223,229,233` |
| C14 | Full-screen | entering full screen keeps the lights positioned and leaves no gap; leaving restores | NOT VERIFIED, an observation task |
| C15 | Light and dark theme | both render the same hard-coded light fills against the theme's `chrome` background; check contrast in Light | `build.py:224`, `:301` |
| C16 | Three-mode header component | macOS OS lights plus reserved gutter; Windows/Linux drawn controls with `decorations: false`; browser/mock the cosmetic drawn lights | TF:639; INV:290 |
| C17 | Undecorated resize (Windows/Linux leg) | resizing an undecorated window is smooth; 2.11.4 shipped resize fixes for undecorated windows, so test it | TF:639 |

**Acceptance: unset, and it is M1's to define.** No source in this evidence set states an acceptance tolerance for a native macOS window. What RH §6 does carry, quoting INV:67-75, is the browser-side baseline: Playwright with Chromium 153 "renders the design at 0 px difference" (INV §1.4 via RH §6). That is a browser gate, not a gate on a `.app`, and nothing here converts one into the other.

**Time expectation.** Honest answer: unmeasured for this app. What is measured is the machine half, and it needs stating in two numbers because this document uses both. The **observed spread** across five public repos is roughly 3 to 11 minutes per macOS CI build, but its low end is tauri-action's own `--debug` template runs (2m25s to 4m12s) and acp-ui (2m49s to 4m55s), not a real app. AP §5's verdict therefore takes **8 to 15 minutes** as the planning band for a small real app (dockit CI, 8m04s to 11m27s; piano-trainer, 6m30s to 8m51s), and 8 to 15 is what the private-repo quota arithmetic in AP §6b uses. A full signed and notarized release is 26 to 35 minutes (AP §5, three dockit runs). The human half is seventeen rows of looking with no automation available, because `tauri-driver` is Windows and Linux only (RH §4.4, TF R8). Budget one sitting, not one sprint, and expect at least one round trip.

**Who the Mac owner is: NOT VERIFIED.** The name `teddy-mbp` in this research comes from the design's footer sample data and was carried into the machines table (INV §1.4); RH §6 and §7 record that its architecture, Apple Silicon versus Intel, is NOT VERIFIED, and no report establishes that the machine exists. Teddy's own question ("hand it off to someone with a mac") implies no Mac in hand. Read every "Mac owner" above as **a Mac owner (you or a teammate)**, unresolved.

---

## 6. What M1 must set regardless of who builds M5

These belong in M1 (INV §10), not M5, because getting them wrong is only discovered on the Mac. All from RH §5 unless noted.

- **Dev port 1420 in BOTH `vite.config.ts` `server.port` and `tauri.conf.json` `devUrl`.** FS §8 says 1420 (the Tauri React template default); TF §2 quotes the docs example, 5173. The rule that actually binds is TF's: the two files must carry the same number. 1420 is the default taken here, because FS's reason (no per-machine edit) is the only stated reason either way.
- `server.strictPort: true`; `server.host` from `process.env.TAURI_DEV_HOST`; `server.watch.ignored` excludes `src-tauri`; `envPrefix: ['VITE_', 'TAURI_ENV_*']`.
- **`build.target`: `'chrome105'` on Windows, `'safari13'` elsewhere, keyed to the target platform and not to the build host** (TF §2; VD K6/evidence makes the host-versus-target point explicitly). `safari13` is a conservative transpile floor because macOS uses WKWebView and Linux WebKitGTK, not Chromium.
- **`HashRouter`** (`react-router@8.3.1`; do not install `react-router-dom`, v8 removed it). It is the only history that works unchanged in a Vite dev server, a CLI-served localhost, and a Tauri custom protocol with no SPA fallback (FS §8, INV §3).
- **A three-mode header component**: macOS uses OS-drawn lights with a reserved gutter; Windows and Linux use drawn controls with `decorations: false`; browser and mock mode uses the cosmetic drawn lights the design already has (RH §3.3 C16).
- **The macOS chrome config is `titleBarStyle: "Overlay"` plus `decorations: true` plus `trafficLightPosition`.** FS §8 prescribes the opposite (`decorations: false`), and that configuration silently loses the design's lights on macOS. TF §6 and INV §9.3 win; they are the side that read the config field docs (RH §3.2, R13). This box has verified the *keys* are accepted at check time (TE §3.4); the runtime requirement that `trafficLightPosition` needs `Overlay` and `decorations: true` is a macOS runtime behaviour and remains NOT VERIFIED (TE §3.4).
- **The share card needs a decision that M5 currently does not name.** Either `clipboard-manager.writeImage` (frontend-only, no scope, no Rust) or `dialog.save()` plus `fs.writeFile` plus an explicit scope (Rust side, and without an `allow` scope the call fails at runtime with `forbidden path` even though the permission is enabled) (RH §4.3). Whether the PNG card is in phase-1 scope at all is still open.

**Build-order note, offered as a default [veto cheap], not a decision.** M5 can wrap M1's shell **before** M2 to M4 exist. Nothing in M1 to M4 needs Rust, a Mac, or CI (VD K6/evidence), and the seam is what makes pulling M5 forward cheap rather than disruptive (LB F8). Pulling it forward buys the checklist verdict early, while the chrome is still cheap to change. Leaving it at position five is also fine; it just moves the risk later.

---

## 7. The one question for Teddy

> **Do you want E (you author and `cargo check` the Rust half here, CI on a public repo builds both flavours, and a Mac owner only opens the tarball and walks C1 to C17), or B (hand all of M5 to a Mac owner and let them build it too)?**

Everything else is a default I will take unless you veto it, all **[veto cheap]**:

- **A public sibling repo `terum-skills-app`.** Public because that is what makes macOS and Windows runners free and unlimited (AP §2, §6a; MC R-B). Sibling because inside the CLI repo the app inherits Ryan's `permissions: {}` hardening, ubuntu-latest-only workflows, the single `release` concurrency group and its drift audit, pinned actionlint, and a public/private choice that is Ryan's to make since `teniroo` has push but not admin (RH §1.1, §1.2; VD K1/practice). Note the house has never run a macOS or Windows runner and has no Electron or Tauri precedent anywhere; this is the first desktop-bundling CI in the house (RH §2). The other side, so you know what you are vetoing: FS D-F9 leans `terum-skills/ui/` on the D21 packaging argument ("the CLI serves the UI" is much simpler when the UI builds in the same repo) while explicitly saying it is not the document that should decide (RH §1.1, FS:719); and the sibling's cost, which nobody else states, is two version numbers, two npm caches, and a cross-repo build step for D21 (RH §1.2).
- **Ad-hoc signing plus tarball transport.** `signingIdentity: "-"`, free, one config line. Without it Tauri never calls `codesign` at all, the binary carries only the linker's ad-hoc signature with `Sealed Resources=none`, and a downloaded bundle produces the "damaged, Move to Trash" verdict with no documented way forward (GS §2.2, §2.3, §6). What ad-hoc does **not** buy, in Tauri's own words: "Ad-hoc code signing does not prevent MacOS from requiring users to whitelist the installation in their Privacy & Security settings" (GS §2.3). It moves the artifact from the damaged verdict into the whitelistable family; it does not remove the Privacy and Security step.
- **Gate the workflow on an artifact actually existing.** This is the single cheapest guard against the failure mode §1 describes: a Linux host logs `"ignoring app"` and exits 0 having bundled nothing, so the run is green and the Release is empty. MC R-A states the mitigation directly: "assert on the presence of `.app`/`.dmg` paths, or use tauri-action's `artifactPaths` output as a gate". `artifactPaths` is a documented output of `action.yml` (MC §2.5). E's whole premise is that CI produces something a Mac owner can open, so a run that uploads nothing must fail loudly rather than quietly.
- **`windows-11-vs2026-arm` for the native Windows flavour, and NSIS not MSI.** The `windows-11-arm` label swaps to the VS2026 image in September 2026, so pin the explicit label; and the arm64 image has no WiX, so do not promise a `.msi` there (MC §3.1, §5.2, R-D, R-E). Two arm64-installer facts travel with this default: the NSIS stub itself is x86 and runs under emulation on the ARM machine while the app binary is native arm64 (WW §B2.5 item 1, quoting Tauri's docs), and WebView2 must use the default `downloadBootstrapper` mode because the offline-installer path has no arm64 URL (§8 item 8).
- **Developer ID deferred.** $99/yr plus mandatory notarization (5 to 15 minutes, cap 75/day), and the certificate must be minted **on a Mac by the Account Holder** before CI can use it (GS §3.1 to §3.4). It buys the double-click experience and is a distribution decision, not an M5 prerequisite (VD K3/evidence). Windows unsigned is two clicks, More info then Run anyway, so defer Windows signing too (GS §4.1).
- **`uploadUpdaterJson: false` in the workflow, for now.** It defaults to **true** in tauri-action v1.0.0 (MC §2.6), so the recommended workflow would publish a `latest.json` and silently make GitHub Releases the app's updater endpoint. TF R12 reserves exactly that for you: the updater needs an HTTPS endpoint the no-server premise never budgeted, and it is "a decision for Teddy, not an implementation detail" (RH §4.4).
- **M5 pulled forward** to wrap M1's shell, per §6.

**Still unanswered from earlier sessions, unchanged by this document.** The **capability-flags versus spec-clean** question is carried by HO twice: HO:19 describes the mechanism and marks it "**Recommended to Teddy, not yet confirmed**", and HO:72 is Open Decision 1, verbatim "**§9.1 as drawn behind capability flags vs spec-clean.** Leaning as drawn ... The one-line confirmation settles it". The remaining items, your reaction to Settings round 1, the hero, Done versus Invite, and the pending design findings, are carried by no report in this evidence set and by no line of HO that was checked, so they are reproduced from session memory without a citation and no count is given.

---

## 8. NOT VERIFIED and open items

Collected from every report. Anything a decision leans on is marked where it is used.

1. **Runtime behaviour of the macOS chrome.** That `trafficLightPosition` requires `Overlay` plus `decorations: true` is a runtime claim; only the config keys were validated here (TE §3.4). Full-screen behaviour with `Overlay` was never documented or observed (RH §3.3 C14).
2. **Native macOS traffic-light diameter and pitch**, to compare against the drawn 12 px and 20 px. No Apple source fetched (RH §7). C4 and C5 are measure-then-record.
3. **Whether an Open Anyway exception survives a version bump**, and whether Open Anyway appears at all for the damaged verdict (GS §9.2, §9.3). macOS also caches negative Gatekeeper verdicts (GS §1.3).
4. **The Mac owner and the Mac.** Whether one exists, and whether it is Apple Silicon or Intel (RH §7). Apple Silicon is where the "must be at least ad-hoc signed" kernel rule bites (GS §2.1).
5. **Two open macOS bugs to read before M5.** tauri#15517 (macOS 26 blank window on tauri 2.11.x, open, severity on 2.11.5 unknown) and tauri#15801 (Tahoe AMFI 16 KB page-size rejection, single unconfirmed report, mitigation `--pagesize=4096`) (MC R-C; GS §2.1).
6. **Vite HMR, WebView2 loopback, and `beforeDevCommand` across the WSL-to-Windows boundary.** Only the transport was proven (WW §B4).
7. **An ARM64 `.msi` building end to end**, and `cargo-xwin --target aarch64-pc-windows-msvc` from here. Both stay NOT VERIFIED (WW §B2.5). The third leg WW lists with them, `tauri-action` uploading **non-default targets**, is partly retired on the macOS side: the public repo `formulahendry/acp-ui` runs `tauri-action` on `macos-latest` with `--target aarch64-apple-darwin` and ships `acp-ui_0.1.16_aarch64.dmg` plus `acp-ui_aarch64.app.tar.gz` as Release assets (VD K2/practice). That is an empirical demonstration on the recommended path, though tauri-action#243's own status was not re-checked (WW §B2.5 item 5).
8. **The WebView2 offline-installer gap on arm64**: `arch == "arm64"` silently falls through to the x86 offline installer URL in the bundler. Use the default `downloadBootstrapper` mode. Read from source, never observed, no upstream issue (WW §B2.5 item 2).
9. **Sidecar `externalBin` packaging and any `#[tauri::command]` / `invoke` round trip** were never exercised on this box (TE §5.4, §5.7).
10. **`cargo check` skips code generation**, so codegen and post-monomorphization errors are not caught here (VD K4/practice).
11. **Whether the quota debits at 10x, 10.33x or in dollars** on a private repo; GitHub no longer publishes a multiplier table. Spread under 4%, changes no conclusion (AP §10). `teniroo`'s plan is `null` (AP §10).
12. **macOS runner queue latency** for free accounts; GitHub publishes a 5-concurrent-macOS-jobs limit on Free, Pro and Team alike, but no queue SLA (AP §8, §10).
13. **`window-state` and `store` on-disk file locations** are not stated in the Tauri docs (RH §7).
14. **Whether the PNG share card is in phase-1 scope at all** is recorded as "No" in the gap-5 in-scope column and is unresolved (RH §4.3).
15. **Tauri's own CI docs carry at least two stale statements**: the auto-initialization sentence (removed in tauri-action v1.0.0) and an "only available in public repos" comment on `ubuntu-22.04-arm` (MC R-F). Diff the docs page against the `action-v1.0.0` README, do not copy it.
16. **tauri-action v1.0.0 renames to carry over**: `includeUpdaterJson` became `uploadUpdaterJson`, `assetNamePattern` became `releaseAssetNamePattern`, and `includeRelease`/`includeDebug`/`updaterJsonKeepUniversal` are gone (MC §2.7).
17. **Whether `WEBKIT_DISABLE_COMPOSITING_MODE=1` actually fixes the blank window on this aarch64 box.** The evidence is an x86_64 Debian/Xvfb report in the same software-GL configuration; there is no aarch64 WSLg datapoint anywhere (WW consolidated item 3). Option A's effort footnote depends on this.
18. **Whether the curl-plus-tar install path actually avoids quarantine end to end.** Apple states each half; the combined path was never observed on a Mac (GS §5 R1), and no Mac was reachable this session (GS §9 item 9). Also NOT VERIFIED: whether `xattr -dr` needs `sudo` for a bundle the user copied themselves (GS §9 item 4).
19. **Whether pushing a workflow file to `ryanliu-terum/terum-skills` would trip branch protection or a required review.** Untestable: `admin: false` means the protection settings cannot be read, and mutating git is out of bounds (VD K1/practice).
20. **Whether Actions has an org or repo-level allowed-actions policy** that would block `tauri-apps/tauri-action`. Not checked (VD K1/practice).
21. **The `apt-get download` step in `env.sh` has a latent root dependency.** It resolves only against the package index already on disk; refreshing that index is `apt update`, which needs root and was not run (LB §1: base `resolute` InRelease dated 2026-04-23, `-updates` 2026-09-05). VD K4/practice states it in those terms. Consequence: whoever writes the M5 setup doc must expect that re-resolving `clang-21`/`llvm-21` on a stale index needs one `sudo apt update`, which makes it the one instruction in option E that may need Teddy's password later. Untested, because no root was used this session.

---

## 9. Experiment footprint and cleanup

The toolchain experiment left **4.1 GB** under `/home/teniroo/.cache/tauri-build-probe`: rustup with four targets 1014 MB, the cargo registry 602 MB, one target dir 2.2 GB, the extracted LLVM prefix 268 MB, the four downloaded `.deb` files 60 MB (TE §4). Disk went from 937 GB free to 933 GB, 0.4% of the volume. Everything is left in place for inspection, including `env.sh` (the reproducible recipe), the full run logs, and the deliberately broken `tauri.conf.json.typo`.

To remove all of it:

```sh
rm -rf /home/teniroo/.cache/tauri-build-probe
```

`env.sh`, `run-check.sh`, `tauri-info.txt`, the run logs and the final probe config are already copied to `.review/2026-09-07-tauri-build/probe/` (Appendix), so the cleanup does not lose option E's setup recipe (VD K4/evidence §6 calls `env.sh` the thing a "just install rustup" doc gets wrong).

One loose end, reported rather than tidied away. An **empty** directory `/home/teniroo/.rustup` exists, created 2026-09-07 02:59:45, where a sibling agent's report had independently recorded both `~/.cargo` and `~/.rustup` as absent at 02:50 (LB §1 toolchain re-check). It is empty (4.0K, nothing inside), nothing was installed into it, and every probe command exported `RUSTUP_HOME` into the probe dir. **Attribution is NOT VERIFIED** and it was deliberately not deleted (TE §6). `rmdir /home/teniroo/.rustup` finishes the cleanup, and is safe precisely because it is empty; check no concurrent agent is mid-install first.

---

## Appendix. The reports behind this document

All seven were written today in a session scratchpad and then copied, with the thirteen refuter reports, the verdicts digest, and the probe's own artefacts (`env.sh`, `run-check.sh`, `tauri-info.txt`, the run logs, the final `Cargo.toml` / `lib.rs` / `tauri.conf.json` / capability file), to **`~/Projects/SSM/design/terum-skills/.review/2026-09-07-tauri-build/`** (the design folder's review convention, outside git; the probe artefacts are under `probe/`). Every TE / MC / AP / GS / WW / LB / RH / VD citation in this document resolves there. The one artefact the recommendation turns on, the C1 to C17 checklist, is reproduced inline in §5 as well.

| File | What it establishes | Classes of source it fetched |
|---|---|---|
| `toolchain-experiment.md` | The rustup + clang + `cargo check` experiment on this box: results table §2, errors §3, footprint §4, proven versus not proven §5, the empty `~/.rustup` loose end §6, cleanup §7 | commands run on this box; `rustup.rs`; Ubuntu archive `.deb`s; crate sources read on disk |
| `web-macos-build-and-ci.md` | The bundler cfg gate, tauri-action v1.0.0, runner images, cost, unsigned builds, Windows ARM runners, risks R-A to R-J | `tauri-apps/tauri-docs` raw mdx; `tauri-apps/tauri` `dev` crate sources; `tauri-apps/tauri-action` at `action-v1.0.0`; `actions/runner-images` readmes; docs.github.com; `gh api` searches |
| `web-actions-pricing.md` | Plans, the public-repo free rule, $0.062/min macOS, measured build times, artifacts versus releases, concurrency limits | docs.github.com billing and limits pages; github.blog changelog; `gh api` job timings across five public repos; live curl auth tests |
| `web-gatekeeper-signing.md` | The Sequoia/Tahoe Open Anyway ritual, the damaged verdict, quarantine and curl/tar, ad-hoc `signingIdentity "-"`, $99/yr, notarization, Windows SmartScreen, decision table §6, recipes §5 | support.apple.com; developer.apple.com forums and DocC JSON; Tauri docs and bundler sources; `gh api` on five issues; learn.microsoft.com; the Azure retail price API |
| `web-wsl-and-windows-arm.md` | llvmpipe measured, tauri#15936 blank window, the env-var ladder, the `icon: []` claim refuted, Windows-on-ARM first-class, WSL to Windows localhost forwarding proven | commands run on this box and through interop; `gh api` issue and code searches; v2.tauri.app; doc.rust-lang.org; blog.rust-lang.org; nodejs.org and npm registry; learn.microsoft.com |
| `local-box-and-windows-host.md` | apt simulation (219 packages, 128 MB), WSLg Tk window proven, the Windows host inventory, RAM headroom, the two sudo commands | `apt-get -s`, `dpkg`, `free`, `df`, WSLg logs; `cmd.exe`/`where`/`reg query`/`vswhere` through interop; v2.tauri.app prerequisites |
| `repo-and-house-facts.md` | The repo placement conflict, house CI precedent, checklist C1 to C17 with derived geometry, M5 plugins and the share-card point, the Vite/Tauri config facts for M1, the machines-table gap | read-only `file:line` over the CLI repo workflows, `AGENTS.md`, `build.py`, INV, TF, FS, the gap-5 report and the handoff |
| `verdicts-digest.md` | The adversarial layer: five structured verdicts plus amended claims from 13 of 14 refuter reports | the refuter reports themselves, plus each refuter's own re-checks |
