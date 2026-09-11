# SPEC — programme `w02b`: sub-second desktop actions

Three batches, dispatched 2026-09-11 against `origin/main` at `6711ec31`. The shared brief is first; each
batch section follows and names the files it owns.

---


**Baseline: `origin/main` = `6711ec310a8a4ba7183106f94ea80cd9a7645b35`** (package version `0.13.0`).
Every path, line number and quoted line below was read at that commit. If a line you open does not match a
quote here, STOP and report it — do not guess.

You are an implementation agent with no conversation context. Your own batch section is a separate document.
This brief is the shared background all batches need. Do not look for "the triage" or "what was discussed".

---

## 0. The ask, verbatim

> "The baseline latency should be heavily cut down to sub second at minimum"
> "This needs to include action such as install unistall, eval, share, switching tabs, loading, etc."

**What "sub-second" means here, precisely.** An eval runs a model; install, uninstall, share and sync do git
and network work. Those cannot be sub-second end to end and nothing in this programme pretends otherwise.
The target is the app's **own overhead**: the time between the click and the CLI beginning real work, plus
the time between the CLI finishing and the board being repainted. Everything that is irreducible (a network
round trip, a model call) must be *visible* — a progress surface that names the step — rather than hidden
inside a dead window.

Concretely, on the reporter's machine, with warm caches:

| surface | budget for app overhead |
|---|---|
| switch tab, inside the read-cache window | 0 ms (no process at all) |
| switch tab, cold | < 400 ms |
| open a skill, cold | < 600 ms |
| install / uninstall / share | < 300 ms before the first progress line appears; git and network time then shown |
| eval | < 300 ms before the run's first progress line; model time then shown |

---

## 1. What was actually measured (2026-09-11, this repository at the baseline commit)

### 1.1 The per-process floor is the whole bill

Linux/WSL2, node v24.15.0, against the bundled `dist/index.js` built from the baseline commit, with a real
configured team fixture (3 shared skills, 3 people, 1 local clone):

| verb | fresh `node dist/index.js <verb>` | same verb, warm, inside one already-booted process |
|---|---|---|
| `status` | 148 ms | 40 ms |
| `ls --local` | 131 ms | 21 ms |
| `ls --team acme` | 125 ms | 14 ms |
| `eval-report deploy-check` | 98 ms | 7 ms |

Supporting numbers from the same box: `node -e 0` is 20 ms; `node dist/index.js --version` — process boot plus
evaluating the 1.8 MB bundle, with no verb work at all — is 85 ms; constructing the whole commander program
(`buildProgram`) is 0.44 ms, i.e. negligible.

**Read that table as one fact: roughly 100–110 ms of every single call is process boot and module evaluation,
and none of it is the verb's work.** On the reporter's Windows box the same constant is several times larger
(Defender scan-on-open, a long replayed `PATH`, and — see §1.3 — x64 emulation on an ARM64 CPU).

### 1.2 The app pays that floor several times per action

`desktop/src/backend/tauri/run.ts` creates a new id and a new child per call; nothing is pooled. The only
reuse anywhere in the path is the adapter's 60-second argv-keyed result cache
(`READ_CACHE_TTL_MS`, `desktop/src/backend/tauri/index.ts`). After W-02's parallelism a cold skill page is
still 5 processes at chain depth 3, because `ls --team <name>` needs the team name that `status` returns.
`settings()`, `localSkill()`, `roster()` and `catalog()` keep 2–4-deep sequential chains.

Every mutation then calls `notify(...)`, which calls `clearReads()` — the **entire** cache, not the families
the mutation touched — so install, uninstall, share and sync are each followed by a full cold re-read of
every mounted board.

### 1.3 The reporter is not running the code we think he is

Verified against the GitHub release API on 2026-09-11:

| release | Windows installer downloads |
|---|---|
| 0.1.9 | x64 **1**, arm64 0 |
| 0.1.10 | x64 **2**, arm64 0 |
| 0.11.0, 0.12.0, 0.13.0 | x64 **0**, arm64 **0** |

`git tag --contains 1ba2a7e` (the W-02 commit) returns exactly `v0.13.0`, published 2026-09-11T02:53Z. So the
running app is **0.1.10**, and the installer ever taken is the **x64** one — on a Snapdragon ARM64 machine,
which means the shell and every `node.exe` child run under Prism emulation.

The cause of the wrong-architecture download is a real bug, fixed by batch `p-arch`:
`src/lib/platform.ts:16-19` picks the installer suffix from `process.arch`, which under emulation reports the
**emulated process** architecture, not the host CPU.

Also relevant: `desktop/src-tauri/src/lib.rs` sets `TERUM_SKILLS_NO_UPDATE_NOTIFIER=1` on every child, so a
CLI older than the app is invisible in the app forever. The app self-updates; the npm CLI does not.

### 1.4 The Rust bridge re-serialises the parallelism (batch `p-bridge`)

`cli_spawn` (`desktop/src-tauri/src/lib.rs:69`) takes `bridge.children.lock()` at :72 for admission control and
holds it across `command.spawn()` at :101, dropping it at :107. Every `Promise.all` burst in the adapter
therefore funnels through one critical section around `CreateProcess` — the single syscall Windows charges
most for. On Linux `fork`/`exec` holds the lock for microseconds, which is exactly why this never showed up in
W-02's measurements.

Separately, `cli_spawn`, `cli_write` and `cli_kill` are declared `fn`, not `async fn`, and carry no
`#[tauri::command(async)]`. Tauri v2 runs such commands on the main thread — the same thread that delivers
child stdout to the webview and paints the window. `cli_kill` then polls `try_wait` for up to 1,500 ms
(:196-:208) with `std::thread::sleep`, and on Unix sleeps a further 500 ms at :215.

---

## 2. Invariants every batch must hold

1. **`AGENTS.md` at the repository root governs.** Read it before writing code. Its top-8 invariants apply.
2. **Never weaken a test to make it pass.** If a test blocks you, the code is wrong or the test encodes a
   decision you must honour. A test you believe is wrong goes in `deviations`, unchanged.
3. **One pre-existing failure is expected on every branch**, and only this one:
   `src/__tests__/release-plan.test.ts` — "removing --observations fails closed because live git cannot be
   spawned". A gate run whose only failure is that test is GREEN for your purposes. Any other failure is yours.
4. **Imports use `.js`, never `.ts`.** The repository is ESM.
5. **No `git` commands.** The worktree is managed for you. Compare files by content, not with `git diff`.
6. **Writes go through `safeWrite`**; the `placements` ledger is the only source of deletable paths.
7. **Do not touch files another batch owns.** Ownership is stated in your batch section and is exhaustive.
8. **Every behaviour you add gets a test that fails without your change.** Performance work is not exempt:
   a structural claim ("this no longer spawns per call", "this no longer blocks the cap") is testable with the
   fake bridge and the existing replay fixtures, and must be tested that way.
9. **No silent catch.** Handle the error, rethrow it, or write one line saying why continuing is safe.
10. **Windows numbers are unverifiable here.** Never write a Windows timing as if it were measured. State the
    mechanism and the Linux measurement, and label any Windows figure a model.

## 3. Gates

**The no-git rule binds you, not the tooling.** `gates/run.sh` runs `git` internally to work out which
gates your change needs. That is expected and it is not your git usage: run the script anyway. The rule
exists so that you never stage, commit, rebase, reset or branch — the worktree is managed for you and a
git command from inside a batch is how work gets lost. Running a prescribed script that reads the repository
is not that.

Two things the script does that will otherwise look wrong to you. It selects the desktop JavaScript gates
whenever any path under `desktop/` changed, including a Rust-only change under `desktop/src-tauri/`; let them
run, they are fast and they will pass. And it points `TMPDIR` at `$HOME/.cache/terum-battery-tmp/<key>`,
deliberately, because the sandbox keeps recreating an empty `/tmp/.git` that makes `/tmp` look like a
repository root and corrupts the fixtures. If that directory is not writable for you, say so in the report
with the exact error rather than editing the script.

Run, from your worktree root, exactly:

```
bash /tmp/claude-1000/-home-teniroo-Projects-SSM/b15c974b-08a5-4694-ab68-506feb50eaf7/scratchpad/gates/run.sh <your-key>
```

It serialises against the other batches with a lock, picks root and/or desktop gates from what you changed,
and writes `gates/<key>.log`. Read the log. `overall=GREEN` (or RED with only the §2.3 failure) is the bar.
Do not run vitest or Playwright directly; the box cannot take two batteries at once.

---

# BATCH `p-arch` — the CLI must detect the *host* CPU, not the emulated one

Read `BRIEF.md` first. It is in the same directory and it is not optional.

## Files you own (exhaustive)

- `src/lib/platform.ts`
- `src/lib/__tests__/platform.test.ts` (create if absent)
- `src/commands/app.ts`
- `src/commands/appUpdate.ts`
- `src/commands/setup.ts` — **only** the `detectPlatform(...)` evidence call at line 172 and its imports
- `src/commands/status.ts`
- the `__tests__` files for each of the above
- `src/__tests__/cli.test.ts` — **only** to widen its `status` mock with the two new fields
- `docs/frame-protocol.md` — only the `status` result section, for the two new fields

Do not touch anything else. `src/cli.ts` is owned by batch `p-serve`; `desktop/**` is owned by other batches.

## The bug

`src/lib/platform.ts:16-19` decides the desktop installer from `evidence.arch`, which is `process.arch` —
the architecture of **the running Node process**, not of the CPU. On Windows on ARM, an x64 Node runs under
Prism emulation and reports `x64`. The CLI then downloads `..._x64-setup.exe`, the person installs an
emulated desktop app on an ARM64 machine, and every `node.exe` that app spawns is emulated too.

This is not hypothetical. Verified against the release API at the baseline commit: the only Windows installers
ever downloaded from this repository are `0.1.9_x64-setup.exe` (1) and `0.1.10_x64-setup.exe` (2). Every
`arm64-setup.exe` ever published has zero downloads.

## What to build

### A1 — host architecture in the evidence

Widen `PlatformEvidence` with one optional field:

```ts
/** Process environment, read only for the Windows host-architecture keys. Absent means "trust arch". */
env?: Readonly<Partial<Record<string, string>>>;
```

Add a pure exported helper beside `detectPlatform`:

```ts
/**
 * The CPU the machine actually has, as distinct from the architecture the current process reports.
 * A 32- or 64-bit x86 process running under Windows emulation (WOW64 on x64, Prism on ARM64) sees its own
 * emulated architecture in `process.arch`; Windows records the real one in PROCESSOR_ARCHITEW6432, which is
 * set only inside such a process. Off Windows, and in a native Windows process, there is nothing to correct.
 */
export function hostArch(evidence: PlatformEvidence): string
```

Rules, all of which need a test:

- Not `win32` → return `evidence.arch` unchanged. Never read the environment on macOS or Linux.
- `win32` and `PROCESSOR_ARCHITEW6432` is `ARM64` (case-insensitive) → `'arm64'`.
- `win32` and `PROCESSOR_ARCHITEW6432` is `AMD64` → `'x64'`.
- `win32` and `PROCESSOR_ARCHITEW6432` is absent, empty, or any other value → `evidence.arch` unchanged. An
  unrecognised value is not a reason to guess; fall back to what the process reports.
- `env` absent entirely → `evidence.arch` unchanged.

`detectPlatform` then uses `hostArch(evidence)` in the `win32` branch **only**. Leave `darwin` on
`evidence.arch`: Rosetta's `sysctl.proc_translated` is not an environment variable and is out of scope; add a
one-line comment saying so, naming this decision, so the asymmetry is not read later as an oversight.

### A2 — pass the environment in

All three call sites construct the evidence inline:

- `src/commands/app.ts:68`
- `src/commands/appUpdate.ts:54`
- `src/commands/setup.ts:172`

Each gains `env: process.env` in the object literal. Keep `args.evidence ?? {...}` exactly as it is — an
injected evidence object still wins, which is how the tests drive this.

### A3 — refuse to record an emulated Node

`src/commands/app.ts` writes `node: args.node ?? process.execPath` into `~/.terum/skills/run/app.json`
(line ~137), and the Rust bridge then spawns exactly that binary for the life of the install. If the host is
ARM64 and the running Node is x64, every child the app ever starts is emulated.

Before `writeState`, when `platform === 'win32-arm64'` and `evidence.arch === 'x64'` (i.e. `hostArch`
corrected it), print a warning — do not fail, do not refuse the install:

```
This machine has an ARM64 processor but you are running an x64 build of Node, so terum-skills and
everything the desktop app starts will run under emulation. Install the ARM64 build of Node from
nodejs.org, then run `<invocation app>` again to record it.
```

Use `invocation(args.form, 'app')` for the command, as `tail()` does. Add the same sentence to the
`AppResult` as a new optional field `emulation: 'win32-arm64-on-x64' | null` so the desktop app and the tests
can both see it without parsing prose. Default `null`.

### A4 — make the machine's real shape readable

`status` is how the app and a person both learn what this machine is. Add two fields to its result:

- `hostArch: string` — `hostArch(...)` of the live evidence.
- `processArch: string` — `process.arch`.

Two fields, not one: a reader must be able to see the *mismatch*, and a single "arch" field would hide
exactly the condition we are trying to surface. Both are plain strings; do not narrow them to a union, since
an unknown Windows value must pass through unchanged.

Document them in `docs/frame-protocol.md` under the `status` result, in the same style as the fields already
there, and say in one sentence that a `processArch` of `x64` with a `hostArch` of `arm64` means emulation.

## Tests

In `src/lib/__tests__/platform.test.ts`, one case per rule in A1 including every fallback branch, plus:
`detectPlatform({platform:'win32',arch:'x64',env:{PROCESSOR_ARCHITEW6432:'ARM64'}})` is `'win32-arm64'` and
`assetSuffix` of it is `'arm64-setup.exe'` — that pair is the bug, and it must fail without your change.

In `src/commands/__tests__/app.test.ts`, a case that the warning is printed and `emulation` is set for an
emulated ARM64 host, and a case that a native ARM64 host (arch `arm64`, no `PROCESSOR_ARCHITEW6432`) prints
nothing and reports `emulation: null`.

In the `status` tests, assert both new fields on a result.

## Report

Use the required schema. In `deviations`, say explicitly whether you were able to test the `darwin`
asymmetry, and name any call site of `detectPlatform` you found that this spec did not list.

---

# BATCH `p-bridge` — the Rust shell must stop re-serialising the spawns

Read `BRIEF.md` first. It is in the same directory and it is not optional. §1.4 is the evidence for this batch.

## Files you own (exhaustive)

- `desktop/src-tauri/src/lib.rs`
- `desktop/src-tauri/src/app_update.rs` — **only** if a command there needs the same `async` treatment; say so
  in the report if you change it.
- `desktop/src-tauri/Cargo.toml` and `desktop/src-tauri/Cargo.lock` — for the one dependency §3 needs
- `.github/workflows/desktop-ci.yml` — for the new Rust job in §4

Nothing else. No other TypeScript file in this repository is yours. If you believe a change here requires a
TypeScript change, stop and put it in `deviations` instead of making it — the `invoke` signatures are
unchanged by everything below, and that is a constraint, not an accident.

## 1. Problem 1 — `CreateProcess` runs inside the admission mutex

`cli_spawn` (line 69) locks `bridge.children` at :72 to check `contains_key` and `has_capacity`, then builds
the command and calls `command.spawn()` at :101 **still holding that guard**, dropping it only at :107.

Every concurrent spawn the adapter issues (`Promise.all` in `library()`, `skill()`, `catalog()`;
`mapWithConcurrency` at width 4 and 8) therefore queues on one critical section wrapped around the single
operation Windows charges most for. On Linux `fork`/`exec` holds it for microseconds, which is why this was
never visible in the W-02 measurements taken on Linux.

The comment at :71 states the requirement correctly — "keep admission and insertion under one lock so
concurrent spawns cannot exceed the cap" — and then implements it in the most expensive available way. The
cap only needs the **id reserved**, not the process created.

### What to build

Introduce a reservation so admission and insertion stay exact while `spawn()` runs unlocked:

1. Under the lock: reject a duplicate id, reject when at capacity, then record the id as reserved and drop
   the guard. Capacity must count reservations plus live handles, so two concurrent spawns cannot both pass a
   check that only one of them should.
2. Unlocked: build the `Command` (including every `cfg`-gated step, with the macOS `disclaim` call still the
   last mutation before `spawn`) and call `command.spawn()`.
3. Re-take the lock: on success replace the reservation with the `Handle`; on failure remove the reservation
   and return the same error string as today, `could not start {node}: {e}`.

Every early return between step 1 and step 3 must remove the reservation. A reservation that outlives its
spawn permanently consumes one of the eight slots, which is a worse bug than the one you are fixing — the
cap is what the adapter matches on by substring (`BRIEF` §1.2; `desktop/src/backend/tauri/concurrency.ts`
exports `BRIDGE_BUSY` for exactly that). Prefer a guard type whose `Drop` releases the reservation unless it
was committed, so no future edit can add a return path that leaks one.

`has_capacity` currently takes `&HashMap<String, T>`; whatever shape you choose, keep a pure function that the
existing unit test can still drive, and keep `MAX_CHILDREN = 8`.

The failure error string must not change: `desktop/src/backend/tauri/concurrency.ts` matches
`too many pending terum-skills processes` by substring, and a test asserts it.

## 2. Problem 2 — the bridge commands run on the UI thread

`cli_spawn` (:69), `cli_write` (:157) and `cli_kill` (:189) are declared `fn` with a bare
`#[tauri::command]`. Tauri v2 runs a synchronous command on the main thread — the same thread that delivers
each child's stdout to the webview and paints the window. So even with problem 1 fixed, two `cli_spawn`
calls cannot overlap, and the window cannot repaint while one runs.

`cli_kill` is the worst case: it polls `try_wait` in a loop to a 1,500 ms deadline with
`std::thread::sleep(25ms)` (:196-:208), then on Unix sleeps a further 500 ms at :215, and on Windows runs
`taskkill /T /F` to completion. That is up to two seconds of frozen window per cancellation.

### What to build

Make all three commands run off the main thread. The minimal, signature-compatible change is
`#[tauri::command(async)]`; `async fn` is also acceptable. Choose one, apply it to all three, and write one
comment above the first that says why (it is not obvious from the call site, and the next person will
otherwise "simplify" it back).

`read_app_state` and `host_platform` do blocking file and system work on the same thread; give them the same
treatment and say in the report that you did.

Then make `cli_kill` stop blocking whatever thread it lands on: replace the `std::thread::sleep` waits with
non-blocking waits (`tokio::time::sleep` in an `async fn`, awaited). Keep the deadlines exactly as they are —
1,500 ms before termination, 400 ms `CANCEL_GRACE_MS`, 500 ms between SIGTERM and SIGKILL. This batch changes
*where* the waiting happens, never *how long*.

`kill_all` (:233) runs on shutdown and its `std::thread::sleep` calls are correct there — the app is exiting
and must not race the children. Leave it alone, and add a one-line comment saying why it is exempt, so the
difference reads as deliberate.

## 3. The one dependency you need

`tokio::time::sleep` needs tokio as a **direct** dependency; today it reaches the crate only transitively
through tauri. `Cargo.lock` already pins `tokio 1.53.1`. Add to `[dependencies]` in
`desktop/src-tauri/Cargo.toml`:

```toml
tokio = { version = "1", features = ["time"] }
```

Nothing else, and no version bump to anything already there. Confirm `Cargo.lock` still resolves tokio to
`1.53.1` after your change; if the lock moves any other package, stop and report it rather than committing a
wider dependency change inside a performance batch.

## 4. Verification — read this before you plan the work

**There is no Rust toolchain on the default PATH of this box, and `cargo test` cannot run here at all.**
Both facts are verified, not guessed, and neither is a reason to skip verification.

A toolchain exists behind a probe environment. Source it in every shell that runs cargo:

```bash
source ~/.cache/tauri-build-probe/env.sh
```

That gives you `cargo 1.98.1` with the targets `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`,
`aarch64-apple-darwin` and `aarch64-unknown-linux-gnu` installed.

What works, verified at the baseline commit in this worktree:

| command | result |
|---|---|
| `cargo check --tests --target x86_64-pc-windows-msvc` | exit 0 |
| `cargo check --tests --target aarch64-pc-windows-msvc` | exit 0 |
| `cargo check --tests --target aarch64-apple-darwin` | exit 0 |
| `cargo test` on the host | fails in `gobject-sys`: no `pkg-config`, GTK development packages absent |

So: **your tests are written and type-checked here, and they execute in CI.** Run all three
`cargo check --tests` commands above and put each exit code in the report. Do not claim a test passed on
this box; none can.

### 4.1 Write the tests

`desktop/src-tauri/src/lib.rs` has unit tests today (`taskkill_args` is tested there). Add, in the same
style and in the same file:

- A capacity test over the reservation type alone: 8 reservations admit, the 9th is refused, releasing one
  re-admits exactly one. It must not need a running Tauri app or a real process.
- A test that a reservation dropped without being committed frees its slot.

### 4.2 Make them actually run, permanently

Rust in this repository is compiled by nothing but the release workflow, and tested by nothing at all:
`.github/workflows/ci.yml` and `desktop-ci.yml` contain no `cargo` invocation. That is why two blocking
serialisers sat in `cli_spawn` unnoticed. Close the hole while you are here.

Add one job to `.github/workflows/desktop-ci.yml`, alongside the existing `gates` job and independent of it,
that on an ubuntu runner:

1. installs the Linux Tauri prerequisites with apt (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
   `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`, `build-essential`, `pkg-config`),
2. installs a stable Rust toolchain with `clippy` and `rustfmt`,
3. runs `cargo test`, then `cargo clippy --all-targets -- -D warnings`, then
   `cargo fmt --check`, each from `desktop/src-tauri`,
4. caches the cargo registry and `target` directory so the job is not slow on every push.

If `clippy -D warnings` or `cargo fmt --check` fails on code you did not write, fix it — a new gate that is
red on arrival is a gate nobody will trust. If the fix is larger than a few lines, keep the job but drop
that one step, and say exactly which step you dropped and why in `deviations`.

You cannot run this job locally. Get it right by reading the existing `gates` job and matching its style,
then say in the report that the job is unverified until it runs on a pull request.

### 4.3 Then the usual battery

Run the gate battery as `BRIEF` §3 instructs. It will select the desktop JavaScript gates because you
changed a path under `desktop/`; that is expected, let them run, and they should pass untouched.

## 5. What you cannot verify, and must not claim

Every cost in this batch is a Windows cost. You are on Linux, where `fork`/`exec` is about a millisecond and
the mutex is invisible — 8 concurrent `ls --local` children measured 177 ms against 132 ms for one, which is
near-perfect overlap and proves nothing about Windows. Do not write a Windows timing anywhere. State the
mechanism, state that it is unmeasured here, and name the falsifier: time five concurrent spawns and watch
whether the window repaints while they run.

---

# BATCH `p-serve` — stop paying node startup on every read

Read `BRIEF.md` first. It is in the same directory and it is not optional. §1.1 and §1.2 are this batch's
evidence, and the measured table in §1.1 is the result this batch is expected to reproduce.

## Files you own (exhaustive)

CLI side:
- `src/index.ts`
- `src/cli.ts`
- `src/commands/serve.ts` (new) and `src/commands/__tests__/serve.test.ts` (new)
- `src/lib/frames.ts` and `src/lib/__tests__/frames.test.ts`
- `docs/frame-protocol.md`

Desktop side:
- `desktop/src/backend/tauri/bridge.ts`
- `desktop/src/backend/tauri/run.ts`
- `desktop/src/backend/tauri/session.ts` (new) and its tests
- `desktop/src/backend/tauri/index.ts` — **only** the `sharedRead` / `start` / `revalidate` / `cached`
  read path and the wiring that creates the session. Do not touch `notify`, `clearReads`, `markStale`,
  the auto-sync or refresh policies, or any model function: batch `p-adapter` owns those.
- `desktop/src/backend/tauri/__tests__/` — files for the above
- `desktop/src/backend/types.ts` — **only** to append `'serve'` to `FEATURE_KEYS`, nothing else in the file

Not yours: `desktop/src-tauri/**` (batch `p-bridge`), `src/lib/platform.ts`, `src/commands/app.ts`,
`src/commands/appUpdate.ts`, `src/commands/status.ts` (batch `p-arch`).

**You need no Rust change.** The existing bridge already does everything a long-lived child needs: `cli_spawn`
starts it with piped stdio, `cli_write` writes a line to its stdin, `cli:<id>` events deliver its stdout, and
`cli_kill` stops it. If you find yourself wanting to edit `lib.rs`, stop and put it in `deviations`.

## 1. What this batch changes, in one paragraph

Today every read is a fresh `node dist/index.js <verb>`: about 100–110 ms of process boot and module
evaluation on Linux before any work happens, and several times that on the reporter's Windows machine.
Add a `serve` verb: one long-lived CLI process the app starts once, which reads request lines on stdin and
writes the existing frames — tagged with the request id — on stdout. Route the app's **read** verbs through
it. Leave every mutating and long-running verb on the one-shot spawn path exactly as it is.

## 2. Why reads only

This is a deliberate boundary and it is not negotiable within this batch.

A long-lived process that also ran `install`, `sync`, `eval`, `connect`, `publish` or `uninstall` would have
to share one process across the clone writer lock, the shutdown hooks that release those locks, agent child
processes, `process.exit(143)` cancellation, and per-request working directories. Every one of those is
process-global today, and getting any of them wrong loses user data or strands a lock. Their latency is also
dominated by git, the network, or a model call, so the ~100 ms this saves is noise there.

Reads are the opposite: they take no lock, spawn no agent, ask nothing in practice, and they are what makes
switching a tab and opening a skill slow, because a cold board is 3–5 of them in a chain.

**Verbs `serve` accepts:** `status`, `ls`, `eval-report`, `search`, `validate`, `update`. Nothing else. A
request naming any other verb is answered with a `result` frame carrying
`serve does not run <verb>; spawn it as its own process` and `ok:false`, and must not execute anything.
Keep that allow-list in one exported constant so the adapter and the tests read the same list.

## 3. CLI side

### 3.1 The `serve` verb

`terum-skills --frames serve`. Refuse to run it without `--frames`: its entire output is frames, and a
person who runs it in a terminal must be told so, with a `result`-shaped failure, not a hang.

Behaviour:

- Write `hello` once on start, exactly as a one-shot frame run does, with a new feature key (§3.3).
- Read one JSON object per stdin line. The request frame is:
  `{"t":"request","id":"r7","argv":["status","--team","acme"],"cwd":"/some/path"}`.
  `id` is chosen by the caller, non-empty, at most 64 characters; `cwd` is optional.
- **Run one request at a time, in arrival order.** Queue the rest. This is what makes the batch safe:
  `process.chdir` is global, and a serialised queue means a request's cwd cannot change under another
  request. Three chained warm reads cost 40 + 21 + 14 ms on the measured fixture, so a queue is not the
  bottleneck and concurrency here would buy nothing worth its hazards. Say this in a comment.
- Per request: `chdir` to `cwd` when given (restore the process's original cwd afterwards, including on
  failure), build a fresh `Execute` sink and a fresh frame Prompter bound to this request's id, and run the
  verb through `buildProgram(...).parseAsync(argv, { from: 'user' })`. Build the program per request:
  measured at 0.44 ms, so there is no reason to share one and risk commander's per-parse state.
- Every frame a request produces — `print`, `ask`, `progress`, `result` — carries `"id"` set to that
  request's id. `hello` never does: it belongs to the session, not a request.
- Exactly one `result` per request, including on a usage error, a thrown verb, or a refused verb name.
  After it, the session keeps reading. This is the one rule the one-shot protocol states that `serve`
  deliberately breaks, and `docs/frame-protocol.md` must say so in those words.
- An inbound `{"t":"answer","id":...}` answers the pending `ask` with that id. An inbound
  `{"t":"cancel","id":"r7"}` abandons that one request (fails its pending question closed, emits its
  `result` with `cancelled`); an inbound `{"t":"cancel"}` with no id ends the session: drain nothing, run the
  shutdown hooks, exit 143, exactly as the one-shot path does today.
- End of stdin ends the session cleanly: finish the request in flight, emit its `result`, exit 0.
- A malformed line, an unknown `t`, a duplicate in-flight `id`, or an `answer` for an unknown id goes to
  stderr and is otherwise ignored — never to stdout, and never disturbing a pending question. This matches
  the existing rule and its test.
- One request must never take down the session. A verb that throws becomes that request's failing `result`
  and the loop continues. There is no catch anywhere in this file that only logs.

### 3.2 Where the code goes

`src/lib/frames.ts` owns the frame shapes and the channel. Add:

- `RequestFrame` and a `ServeCancelFrame` (a `cancel` with an optional `id`) to the inbound union, with
  type guards beside `isAnswer`/`isCancel` in the same style.
- An optional `id?: string` on `PrintFrame`, `AskFrame`, `ProgressFrame` and `ResultFrame`. Optional, so
  every existing one-shot run is byte-identical and no existing test changes.
- A way to make a per-request channel that stamps the id on what it writes and only accepts answers for it.
  Reuse the existing machinery rather than copying it; the one-shot path must keep going through exactly the
  code it goes through today.

`src/commands/serve.ts` owns the session loop and nothing else. It takes its streams and its
program-builder injected, the way the rest of the codebase does, so its tests drive it with in-memory
streams and never a real process.

`src/cli.ts` registers the verb. `src/index.ts` routes to it: `serve` must not go through the normal
one-shot `report()` path, because that writes a terminal `result` and stops reading stdin.

### 3.3 Advertising it

Add `serve: true` to `FRAME_FEATURES`. Append it at the end of the object, after `autoSync` — the feature
map's append order is asserted by `src/lib/__tests__/frames.test.ts` and by the desktop `FEATURE_KEYS`, and
both must be updated in the same order. Add `'serve'` to `FRAME_VERBS`.

Document the whole session protocol in `docs/frame-protocol.md`: a new section after "Rules a shell must
follow", the request frame, the id on response frames, the one-request-at-a-time rule, the allow-list, the
two cancel shapes, and an example transcript. State plainly that protocol stays `1` because every change is
additive, and that rule 6 ("one run per verb") continues to hold for every verb except `serve` itself.

### 3.4 Cold start, while you are in the bin

`src/index.ts` is yours, so make the remaining startup cheaper too. Call
`module.enableCompileCache()` (Node 22+, `node:module`) as the first statement of the bin, inside a
`try`/`catch` that ignores an unsupported runtime with a one-line comment saying why ignoring is safe (a
cache miss is a slower start, never a wrong answer). Measured on the baseline commit: `--version` goes from
80 ms to 60 ms once the cache is warm. This helps every one-shot spawn and the `serve` process's own boot.

## 4. Desktop side

### 4.1 `session.ts`

A new module owning the long-lived child, testable with the existing fake bridge and with no Tauri import.

- Starts lazily on the first read, not at construction.
- Spawns `['serve']` through `bridge.spawn`, keeps the id, and routes each inbound line by its `id` to the
  pending request.
- `request(argv, cwd)` returns the same `{ result, lines }` shape `start()` returns today, so the read path
  above it does not change shape.
- **Version binding.** The session is bound to the `AppState` it was started from. When the adapter's
  `state()` resolves to a state with a different `entry`, `node` or `version`, retire the session (kill the
  child) and start a new one on the next read. A CLI upgraded under a running app must not keep being served
  by the old process.
- **Failure policy, explicit.** If the child exits or errors, fail every pending request with the child's
  error, then restart at most once for the next request. If the restarted session also fails to produce a
  `hello`, mark the session unavailable for the rest of the app's life and let every read fall back to the
  one-shot path. Record why, and expose it so a test can assert it. Never retry in a loop.
- **Fallback is mandatory, not an optimisation.** If `hello.features.serve` is not `true` — an older CLI —
  the session never starts and every read uses today's one-shot path unchanged. The app must work against
  0.13.0 and earlier exactly as it does now.

### 4.2 The read path

In `index.ts`, `start(key, argv, at)` is the single place a read becomes a process. Change only that: ask
the session first, fall back to `read(run(...))` when the session is unavailable or the verb is not on the
allow-list. `sharedRead`, `revalidate`, `cached` and the cache entry shape stay as they are.

`cwd()` is already computed for the one-shot path; pass the same value as the request's `cwd`.

`bridge.ts` needs no interface change — `spawn`, `write`, `kill` already cover it. If you find it does,
say why in `deviations` before changing it.

## 5. Tests

These are the point of the batch; a green gate without them proves nothing.

CLI (`src/commands/__tests__/serve.test.ts`), driving in-memory streams:
- two requests on one session each get exactly one `result`, each stamped with its own id, in arrival order;
- a second request sent while the first is in flight runs after it, not during it (assert ordering, not timing);
- a verb not on the allow-list is refused with `ok:false` and executes nothing;
- a verb that throws yields a failing `result` and the session still answers the next request;
- an `ask` is stamped with the request id and an `answer` for that id unblocks it;
- `{"t":"cancel","id":...}` abandons one request and the session survives; a bare `{"t":"cancel"}` ends it;
- a malformed line writes to the diagnostic stream and nothing to stdout;
- end of stdin finishes the in-flight request and closes;
- `serve` without `--frames` fails with a message rather than hanging;
- `cwd` is restored after a request that set it, including when that request failed.

Desktop (`session.ts` tests, fake bridge):
- the second read of a different argv reuses the same child — assert `spawns.length` is 1 across two
  different reads, which is the whole claim of this batch and must fail without it;
- a CLI that does not advertise `serve` spawns per read exactly as today;
- a child that dies mid-request fails that request and the next read restarts it once;
- a second death marks the session unavailable and subsequent reads use the one-shot path;
- a changed `AppState` retires the old child and starts a new one.

Then re-run the measurement from `BRIEF` §1.1 yourself against your build, both ways, and put the numbers in
the report. Do not quote the brief's numbers as if they were yours.

## 6. What must not change

- The one-shot path's bytes on the wire. Every existing frame test must pass untouched.
- The protocol number. It stays `1`.
- Behaviour against a CLI without `serve`.
- `notify`, `clearReads`, `markStale`, the refresh and auto-sync policies, and every model function.
