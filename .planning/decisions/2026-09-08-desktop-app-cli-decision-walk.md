---
title: desktop app CLI side (issues 49-51) decision walk
date: 2026-09-08
north_star: A teammate who has never heard of terum-skills gets from an invite message to looking at their team's skills in the desktop app with one npm install and one command, and never hits a security dialog, a dead end, or a terminal step they did not choose.
status: complete
deferred:
  - what: Linux row in the release matrix and Linux download in `terum-skills app` (D3); the .deb/.AppImage build is trivial, opening it is unverified
    gate: the first Linux-desktop teammate, or Teddy having a Linux desktop (not WSLg) to walk C16 and C17 on
  - what: PR order for issues 51, 49, 50 and the release-workflow desktop matrix (D9); resolved 2026-09-08 once #54 landed, kept here only until the PRs merge
    gate: PRs #53 to #59 merged in the order the overnight handoff lists
---

# Desktop app CLI side (issues 49-51) — Decision Walk

**North Star:** A teammate who has never heard of terum-skills gets from an invite message to looking at their team's skills in the desktop app with one npm install and one command, and never hits a security dialog, a dead end, or a terminal step they did not choose.

Context: Ryan decided on 2026-09-08 (Terum) that the app ships npm-first, `setup` fetches and opens the app from the GitHub release matching the CLI version, the app runs the global CLI as a separate process over the frame protocol (PR #53), and Linux waits for the second CI run. The forks below are what those decisions left open inside the CLI. Grounded against `feat/frame-mode` on 2026-09-08 by a read-only pass over `src/`.

Ratified by Ryan: "that's the right thing to be optimizing for."

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | How the app finds Node and the CLI | LOCK | The tool writes a small state file on every launch; the app reads it on every start, so reopening from the Dock works. Launch args are only a fast path. | — |
| 2 | Where the app build lives and how it reaches the release | LOCK | The desktop app lives under `desktop/` in this repo (Teddy, 2026-09-08). The release workflow builds it on Mac and Windows runners and uploads the assets before the npm approval, so a version can never ship without its app. | — |
| 3 | Linux and WSL in `terum-skills app` | GATE | Linux stays out of the first release matrix; `app` prints a clean one-liner on Linux and WSL (exit 0) and WSL is told the Windows app is available. | Linux row added when a Linux desktop teammate appears or Teddy has a Linux desktop to open it on |
| 4 | What "remember the answer" means after a no | LOCK | A yes is remembered forever and never re-asked; a no is recorded but setup asks again on its next run (default no). No other verb ever asks. | — |
| 5 | Terminal-only questions when a program is driving the CLI | LOCK | With `--frames` on, the CLI itself skips the two questions that need a human at a terminal: the app opt-in and the `gh auth login` offer (it prints the command instead). The protocol doc rule stays as belt-and-braces. | — |
| 6 | What issue 51 is, given join already accepts invitations | LOCK | Two message fixes: join says when no invitation was found and what that means; invite says "no GitHub user named X" on a 404 instead of blaming the invitation cap. Auto-accept already exists. | — |
| 7 | What `app` says when the download fails | LOCK | Distinct wording per cause (offline, GitHub/auth, checksum mismatch, asset missing), each ending with the same two actions: use the terminal now, run `terum-skills app` later. Half-downloaded or corrupt files are deleted. Download goes through `gh release download`, keeping the only-git-and-gh rule. | — |
| 8 | Launching after download, including Windows | LOCK | Mac: open the app. Windows: run the per-user NSIS installer silently the first time, then launch the installed app. Already running: bring to front. Windows leg is built blind until Teddy's laptop runs it. | — |
| 9 | Order of work and what ships together | DEFER → resolved the same night | Teddy's push (#54) landed at 01:30; everything then landed as stacked PRs the same night. Merge order: #53, #54, #55, #56, #57, #58, then #59 (0.1.6 bump). | `.claude/handoff-desktop-overnight.md` |

---

## Decision 1 — How the app finds Node and the CLI

**Verdict: LOCK**

### Plain English
- **What's at stake:** A Mac app launched from the Dock does not inherit the terminal's PATH. If it guesses where Node and the CLI are, every button fails on nvm and Homebrew machines.
- **Why it's a fork:** The CLI knows both paths when it launches the app; the question is how to hand them over and whether they survive a later relaunch without a terminal.
- **Options:**
  - **A —** the CLI writes `~/.terum/skills/app.json` (node path, package root, CLI version) on every launch; the app reads it on every start. *(decides: works from the Dock a week later)*
  - **B —** launch arguments or environment variables only. *(decides: lost on any relaunch not performed by the CLI)*
  - **C —** the app searches PATH, Homebrew, nvm, fnm itself. *(decides: a guessing game the CLI does not need to play; breaks on the next version manager)*
- **Recommendation:** A, with launch arguments as an override for the launch `setup` itself performs.
- **Zoom-out:** the "no dead end" half of the North Star; B passes the demo and fails the first Dock relaunch.
- **The call:** A. Ryan: "A".

### Technical
- **Files / code paths:** new `src/commands/app.ts` computes package root as `dirname(dirname(launch.path))` for a global launch and Node as `process.execPath`; new state file beside `run/latest-version.json`, own zod schema in the style of `src/lib/update.ts:19-27`, mode 0600, atomic write. No change to `src/lib/launch.ts`.
- **Migration / schema:** none to `config.json`; a new sibling state file.
- **Effort / risk / blast radius:** small. Risk is a stale file after `npm update -g` relocates the package; mitigated by rewriting on every launch and the app re-reading on every start.
- **Grounding findings:** `Launch` for kind `global` carries only `path` (`src/lib/launch.ts:4-11`); `process.execPath` is already read in `localPushGuardLauncher()` (`src/lib/teamRepo.ts:365-368`); the per-machine state-file precedent is `update.ts:36-37`.

---

## Decision 2 — Where the app build lives and how it reaches the release

**Verdict: LOCK**

Supersedes the section 7 default "public sibling repo `terum-skills-app`" accepted earlier on 2026-09-08. Teddy decided the same day to co-locate the desktop app under `desktop/` in `ryanliu-terum/terum-skills` because the CLI and app need coordinated seam types, packaging, and CI, and the npm `files` whitelist (`dist`, `LICENSE`, `NOTICE`, `README.md`) keeps `desktop/` out of the package. Ryan confirmed: "the package will live in the terum-skills repo in a /desktop folder". The repo is already public, so macOS and Windows runners are free.

### Plain English
- **What's at stake:** `terum-skills app` downloads the app for its own version from the GitHub release the CLI release already creates. If the app is not on that page, the one command yields nothing.
- **Why it's a fork:** the release workflow is deliberately tight (Linux only, manual dispatch, human approval, one at a time); adding Mac and Windows builds slows it and touches a hardened pipeline.
- **Options:**
  - **A —** one release: the workflow builds the app on Mac and Windows runners, uploads assets, then reaches the npm approval; any app build failure blocks the publish. *(decides: drift impossible by construction; about ten minutes slower)*
  - **B —** two workflows: the CLI releases as today; a desktop workflow on the same tag uploads afterwards; a drift check fails loudly when a version lacks app assets. *(decides: a window where the tool is out and the app is not; the check is a tripwire, not a guarantee)*
  - **C —** separate `desktop-v*` tags. *(decides: two version numbers for one product)*
- **Recommendation:** A.
- **Zoom-out:** the only option where "one command" cannot be broken by a release mistake.
- **The call:** A. Ryan: "A".

### Technical
- **Files / code paths:** `.github/workflows/release.yml` gains a `desktop` job matrix (macOS arm64, macOS x64 cross-compiled, Windows arm64 NSIS on `windows-11-vs2026-arm`) between `validate` and the npm-environment approval, uploading to a draft release that the finalize step publishes; `contents: write` scoped to that job. Template: the scratch workflow proven green on 2026-09-08 in `ryanliu-terum/terum-tauri-ci-probe` (ad-hoc signing, codesign verify, artifact-exists gate, no updater JSON).
- `app` downloads from `ryanliu-terum/terum-skills` release `v<version>`; asset names `terum-skills-desktop_<version>_{aarch64.app.tar.gz,x64.app.tar.gz,arm64-setup.exe}` each with `.sha256`. Verified before unpack.
- `.github/workflows/release-drift.yml` gains one assertion as a safety net: every published npm version has app assets on its release.
- **Effort / risk / blast radius:** medium; the risk is the release pipeline itself, mitigated by dry-run mode (`dry_run` defaults true) exercising the desktop jobs without publishing.
- **Grounding findings:** repo visibility PUBLIC; `release.yml` is `workflow_dispatch` only, `permissions: {}`, `concurrency: release`, `gh release create` at line 272; `files` whitelist at `package.json`.

---

## Decision 3 — Linux and WSL in `terum-skills app`

**Verdict: GATE**

### Plain English
- **What's at stake:** the first place a teammate can hit a wall; Teddy on WSL is that teammate.
- **Why it's a fork:** building a Linux app is one matrix row on a free runner; opening one has never been done, and the only Linux desktop the team owns is WSLg, the least reliable place to open a Tauri window.
- **Options (after the reframe):**
  - **A —** Linux in the release matrix from the first run; `app` downloads it on Linux; WSL gets a message. *(decides: the asset exists before anyone can open it)*
  - **B —** Linux waits for a later run; `app` prints a clean one-liner on Linux and WSL and exits 0; WSL is told the Windows app is available from the Windows side. *(decides: smaller first release)*
- **Recommendation:** A, on the grounds that the earlier "second run" call was scratch-repo sequencing, not a product reason.
- **Zoom-out:** the North Star names no Linux teammate; B leaves no dead end because the message is honest and the terminal path is complete.
- **The call:** B. Ryan: "B". The 2026-09-08 Terum decision "Linux in the second CI run" stands.

### Technical
- **Files / code paths:** new `src/lib/platform.ts` (pure): `process.platform` + `process.arch` + `/proc/version` containing `microsoft` → `'darwin-arm64' | 'darwin-x64' | 'win32-arm64' | 'linux' | 'wsl'`, injected for tests. Shared by `app` and `setup`.
- **Effort / risk / blast radius:** tiny. Setup has no platform detection today (`src/commands/setup.ts`); the only OS check in the CLI is `win32` in `src/lib/invocation.ts:24`.
- **Grounding findings:** as above; no browser/URL-opening helper exists anywhere in `src/`.

---

## Decision 4 — What "remember the answer" means after a no

**Verdict: LOCK**

### Plain English
- **What's at stake:** nagging versus a second chance for someone who said no to the app once.
- **Why it's a fork:** both are defensible; it turns on whether the terminal user is the default person or the exception.
- **Options:**
  - **A —** ask once in setup, remember either answer, never ask again; the way back is `terum-skills app`, mentioned once in setup's closing hints. *(decides: zero nagging)*
  - **B —** remember a yes forever; after a no, setup asks again on its next run, default no. *(decides: a second chance without a new command to learn, one repeated question for people who always say no)*
  - **C —** remember nothing. *(decides: simplest, most annoying)*
- **Recommendation:** A.
- **Zoom-out:** setup is rare and the default is no, so B costs one Enter per setup run and never touches any other verb; it does not add a step the person did not choose.
- **The call:** B. Ryan: "B".

### Technical
- **Files / code paths:** new optional field on `configSchema` (`src/lib/schema.ts:91-104`): `app: { choice: 'opted-in' | 'declined', at: <iso> }`; outer schema is `.passthrough()` so older CLIs survive it. Setup (`src/commands/setup.ts`, after the welcome print at :91, before the role fork at :99) reads it: `opted-in` → skip the question and hand off to `app`; `declined` or absent → ask, default no. `--app` / `--no-app` override without asking or writing. `terum-skills app` run explicitly writes `opted-in`.
- **Migration / schema:** additive optional field; no migration.
- **Effort / risk / blast radius:** small in product code; every scripted-answer sequence in `src/commands/__tests__/setup.test.ts` shifts by one and the `steps` `toEqual` assertions (e.g. :463) gain a key.
- **Grounding findings:** machine-wide field precedent `default_handle`, `email`, `display_name`, `github` written by `setIdentity()` (`src/lib/auth.ts:174-179`); writes only via `ConfigStore.update()` (`src/lib/config.ts:70-79`).

---

## Decision 5 — Terminal-only questions when a program is driving the CLI

**Verdict: LOCK**

### Plain English
- **What's at stake:** two of the CLI's questions make no sense when the desktop app is the caller: "download and open the app?" (the app is asking) and "run `gh auth login` now?" (that login needs a real terminal and would seize the app's pipes).
- **Why it's a fork:** barely one. PR #53 put the rule in `docs/frame-protocol.md` ("answer that confirm with false") because the CLI side was written before this came up. The only cost of moving it into code is widening the Prompter interface by one optional field.
- **Options:**
  - **A —** the CLI knows it is in frame mode and skips both itself; for gh it prints the copyable command. *(decides: the app, and any future shell, cannot get it wrong)*
  - **B —** leave it to the app per the doc. *(decides: two lines less code, one more rule every shell author must know)*
- **Recommendation:** A.
- **Zoom-out:** a hang inside the app with no visible cause is the worst kind of dead end; A makes it impossible rather than documented.
- **The call:** A, after Ryan asked why anyone would pick B; recorded as not a genuine fork.

### Technical
- **Files / code paths:** `Prompter` gains `readonly channel?: 'terminal' | 'frames'` (`src/lib/prompt.ts:14-20`; `NonInteractivePrompter` unaffected); `frameChannel` sets `'frames'` (`src/lib/frames.ts`); `detectOrOfferGh` (`src/lib/auth.ts:42`) skips the offer when `io.channel === 'frames'` and prints `Run \`gh auth login\` in a terminal, then retry.`; setup skips the app question on the same test. `docs/frame-protocol.md` rule 1 reworded: the CLI never offers this over frames from 0.1.6.
- **Effort / risk / blast radius:** tiny; one test each in `auth.test.ts`, `setup.test.ts`, `frames.test.ts`.
- **Grounding findings:** `io.interactive` is read at `src/lib/auth.ts:42`, `src/commands/connect.ts:108`, `src/commands/sync.ts:50,97,106`; none of those should change, since frame mode is interactive in the sense they test.

---

## Decision 6 — What issue 51 is, given join already accepts invitations

**Verdict: LOCK**

### Plain English
- **What's at stake:** the "repository not found with no cause" dead end. Grounding found `team join` already lists and accepts a pending invitation when gh is logged in, and shows the invitations URL and asks to continue when it is not.
- **Why it's a fork:** what remains is two messages, one of them in a different command. Join is silent when no invitation matches; invite misreports a nonexistent GitHub username as a 404 and blames the daily invitation cap.
- **Options:**
  - **A —** fix both messages. *(decides: both ends of a failed join get a sentence naming the real cause)*
  - **B —** join side only. *(decides: inviters keep typing wrong usernames unknowingly)*
  - **C —** close 51 as done. *(decides: the generic three-cause explainer stands)*
- **Recommendation:** A.
- **Zoom-out:** the cheapest change in the batch, and the invite fix prevents the dead end instead of explaining it afterwards.
- **The call:** A. Ryan: "A".

### Technical
- **Files / code paths:** `src/commands/team.ts:500` (`acceptOrDirect`, silent no-match) gains one `io.print`: no pending invitation for this account; if the clone fails next, the inviter has not added you yet. `src/commands/invite.ts:38-40` branches on `httpStatus === 404` to `No GitHub user named @<login>.` and drops the cap sentence for that case. `src/commands/__tests__/invite.test.ts` gains the 404 shape (existing: 201/204/422/403 at :16-18, :34-41).
- **Migration / schema:** none.
- **Effort / risk / blast radius:** tiny. The Terum decision "auto-accept pending invitations on join" (2026-09-08) describes behaviour that already existed at `team.ts:490-503`; annotate rather than build.
- **Grounding findings:** `explainGitAccessFailure` (`src/lib/remote.ts:204-245`) already lists "an invitation that still needs acceptance"; `cloneTeam` (`src/lib/teamRepo.ts:346-354`) does no cleanup and git removes its own partial directory; the invite block (`invite.ts:53-55`) carries no inviter identity, so the join message cannot name the inviter.

---

## Decision 7 — What `app` says when the download fails

**Verdict: LOCK**

### Plain English
- **What's at stake:** ordinary download failures (offline, proxy, GitHub outage, corrupt file) after the person typed one command.
- **Why it's a fork:** reuse the shared "could not reach GitHub" explainer with one app line, or write wording per cause.
- **Options:**
  - **A —** shared explainer plus one app-specific line; delete partial files. *(decides: one voice for network trouble)*
  - **B —** distinct wording per failure kind: offline, GitHub or auth problem, checksum mismatch, asset missing for this version. *(decides: more precise; more strings; same next action)*
- **Recommendation:** A.
- **Zoom-out:** B still serves the North Star provided every message ends with the two actions the person can take; the precision helps someone tell "offline" from "blocked by proxy".
- **The call:** B. Ryan: "B". Every message ends with the same tail: everything works from the terminal; run `terum-skills app` later to try again.
- **Sub-pick (unopposed):** download through `gh release download`, not a built-in HTTP client, so the AGENTS.md invariant "shell out only to git and gh, no HTTP client" holds. If `gh` is missing the message says so and points at the terminal.

### Technical
- **Files / code paths:** new `src/commands/app.ts`: `gh release download v<version> --repo ryanliu-terum/terum-skills --pattern <asset> --pattern <asset>.sha256 --dir <tmp under ~/.terum/skills/app/>`, sha256 verified, `tar -xzf` (macOS) into `<version>/` by atomic rename; any failure removes the temp directory so `<version>/` only ever exists complete. Failure kinds mapped from `gh` exit and stderr: not logged in / no gh → `explainGhFailure` (`src/lib/auth.ts:157-162`) wording; network → offline line; release or asset absent → "no app published for version X" line (should be impossible after D2; kept as a guard); sha mismatch → corrupt-download line.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** small. `tar` is a third shell-out; on macOS and Linux it is system-provided, on Windows the asset is an installer and is run rather than unpacked, so no tar there. Note this in AGENTS.md alongside git and gh, or unpack in-process with Node's zlib plus a minimal tar reader; decide at build time, default to system `tar` on POSIX.
- **Grounding findings:** no `gh api` or HTTP helper exists (`src/lib/runner.ts:8-10` is the only abstraction: `run('git' | 'gh', args)`), so the `Runner` type must admit `'tar'` or the unpack stays in-process.

---

## Decision 8 — Launching after download, including Windows

**Verdict: LOCK**

### Plain English
- **What's at stake:** getting from a verified file on disk to a running app. Trivial on a Mac; on Windows the download is an installer, so there is a step in between.
- **Why it's a fork:** running an installer silently on someone's machine is a bigger action than opening an app.
- **Options:**
  - **A —** Mac: open. Windows: silent per-user install the first time, then launch. Already running: bring to front. *(decides: one command reaches a running app on both platforms; per-user means no admin prompt)*
  - **B —** Windows: visible installer wizard. *(decides: a step the person did not ask for)*
  - **C —** Windows: download only, print the path. *(decides: a dead end by our definition)*
- **Recommendation:** A.
- **Zoom-out:** the only option that keeps "one command" true on Windows.
- **The call:** A. Ryan: "A".

### Technical
- **Files / code paths:** `src/commands/app.ts`: macOS `open <version>/<Product>.app` after writing the D1 state file (`open` activates an already-running bundle id). Windows: `<installer> /S` (NSIS silent; `installMode: currentUser` from the proven config installs under `%LOCALAPPDATA%` without elevation), then launch the installed exe; skip the installer when that version is already installed. Second and later runs of `app` skip download and install and only launch.
- **Migration / schema:** none.
- **Effort / risk / blast radius:** small on macOS, medium on Windows because nothing on Windows can be run from this Mac; Teddy's Windows laptop is the first tester. `open` and the installer are further shell-outs beyond git and gh; the AGENTS.md invariant needs one sentence naming the `app` command's platform launchers as the exception, alongside D7's `tar`.
- **Grounding findings:** no launcher or URL-opening helper exists in `src/`; `Runner.run` is typed to `'git' | 'gh'` (`src/lib/runner.ts:8-10`) and must widen or a sibling launcher seam must be added.

---

## Decision 9 — Order of work and what ships together

**Verdict: DEFER**

### Plain English
- **What's at stake:** how the eight decisions land as PRs, and how soon a teammate can run the one command.
- **Why it's a fork:** `app` is useless until the release workflow publishes app assets, and that workflow has nothing to build until Teddy's `desktop/` folder exists. The CLI side can land dark or wait.
- **Options:**
  - **A —** land the CLI side dark in order 51, 49, 50, one PR each; the release-workflow change lands with `desktop/`. *(decides: nothing waits on Teddy except the piece that cannot run without him)*
  - **B —** hold everything on one branch until `desktop/` exists. *(decides: one big review; the CLI side rots against main)*
- **Recommendation:** A.
- **Zoom-out:** Teddy's push is imminent, which changes the order question: if it lands within the hour, M5 (the `src-tauri` shell and the release matrix) comes first because the North Star is gated on the first app release, and the CLI PRs follow. Ryan asked to defer; M5 and M6 both live inside `desktop/` and cannot start before the push, so the only work unblocked meanwhile is the CLI side.
- **The call:** DEFER until the push lands. Ryan: "is it okay to defer this decision and do m5 and m6 while we wait for teddy to publish?" Interim: start issue 51 (an hour, independent of the order), switch to M5 when `desktop/` appears.

### Technical
- **Files / code paths:** as listed under D1 to D8. Version carrying all of it: 0.1.6.
- **Effort:** 51 about an hour; 49 an evening; 50 an hour plus `setup.test.ts` sequence shifts; release-workflow PR an hour once `desktop/src-tauri` exists.
- **Grounding findings:** none beyond D1 to D8.

---

## Close

- **LOCKED, ready to build:** D1 state file for Node and package paths; D2 desktop under `desktop/`, built inside `release.yml` before the npm approval; D4 remember a yes, re-ask after a no in setup only; D5 the CLI skips the app question and the `gh auth login` offer in frame mode; D6 two message fixes for 51; D7 per-cause download failure wording with a shared tail, download via `gh release download`, partial files deleted; D8 open on Mac, silent per-user NSIS then launch on Windows.
- **GATED:** D3 Linux in the release matrix, on the first Linux-desktop teammate or a Linux desktop to test on.
- **DEFERRED:** D9 PR order, until Teddy's `desktop/` push lands. Resolved later the same night: the push landed as #54; M5 and M6 (#55), issue 51 (#56), issue 49 (#57), issue 50 (#58) and the 0.1.6 bump (#59) were opened as stacked PRs; the merge order is in `.claude/handoff-desktop-overnight.md`.
- **DELEGATED:** none.
- **Supersedes:** the section 7 default "public sibling repo `terum-skills-app`" (replaced by `desktop/` in this repo per Teddy, 2026-09-08). The earlier Terum decision "auto-accept pending invitations on join" describes behaviour that already existed; D6 narrows 51 to messages.
- **Outside this batch, surfaced along the way:** the decision-walk skill and CONVENTIONS pointer in this repo describe a DEFERRED-INDEX hook that does not exist here (already noted in `.claude/handoff-harden-forks-walk.md:61`).
