# Platforms

The CLI runs anywhere Node runs. The desktop app is built for macOS and Windows only. This page is what differs per platform, what each one needs installed, and what to expect from the parts that are slow.

For what the app does once it is running, see [the desktop app](../guides/desktop-app.md).

## Requirements

| Thing | Needed for | Checked how |
| --- | --- | --- |
| Node | Everything | The package declares `"engines": { "node": ">=22.12.0" }` and the shipped bundle targets Node 22. There is no runtime version gate: npm and npx print an `EBADENGINE` warning on an older runtime and run it anyway unless you have set `engine-strict`. |
| `git` | Everything repository-shaped: cloning, `sync`, publish, install | Probed for `status`'s report and otherwise never gated. A command that needs git and cannot find it fails with git's own message. |
| `gh` | Creating a GitHub team, `invite`, access-revoking `team remove`, the admin chips behind `status --permissions`, and downloading the desktop app and its updates | Presence and login are distinct states. `status` reports presence only and never runs `gh auth status`. |
| Claude Code (`claude` on your PATH, logged in) | Eval runs, and the category suggestion publish asks for when your folder declares none | The eval preflight runs `claude --version` in a temporary directory with a 15-second timeout, then one real one-turn task. Point `TERUM_SKILLS_AGENT_CMD` at a different binary to override the name. |

Who needs `gh` logged in, by role:

| Role | `gh` |
| --- | --- |
| Creating a team on GitHub | Logged in. |
| Creating a team on any other remote, with `team create <name> --remote <url>` | Not needed at all. Ambient git credentials do the work. |
| Joining a team | Not needed. With `gh` logged in, join accepts a pending invitation for you; without it, you are given the invitation URL to accept in a browser. |
| Inviting someone, or removing a member with access revocation | Logged in, and GitHub must grant you repository admin. |
| Installing or updating the desktop app | Logged in. Every download goes through `gh release download`; there is no HTTP client in the CLI. |

The desktop app matrix:

| Platform | Release asset | Installed to |
| --- | --- | --- |
| macOS, Apple Silicon | `terum-skills-desktop_<version>_aarch64.app.tar.gz` | `~/Applications/Terum Skills.app` |
| macOS, Intel | `terum-skills-desktop_<version>_x64.app.tar.gz` | `~/Applications/Terum Skills.app` |
| Windows, ARM64 | `terum-skills-desktop_<version>_arm64-setup.exe` | `%LOCALAPPDATA%\Terum Skills\terum-skills-desktop.exe` |
| Windows, x64 | `terum-skills-desktop_<version>_x64-setup.exe` | `%LOCALAPPDATA%\Terum Skills\terum-skills-desktop.exe` |
| Linux | None | |
| WSL | None | |

Every asset ships with a `.sha256` beside it, and the CLI verifies the checksum before it installs anything. A mismatch discards the download.

## macOS

Install the app from a terminal:

```sh
npx -y terum-skills@latest app
```

That downloads the archive for this CLI's own version from the `ryanliu-terum/terum-skills` releases through `gh`, verifies its checksum, unpacks it, and moves the bundle onto `~/Applications/Terum Skills.app`. The path is fixed on purpose: it is visible, Spotlight indexes it, and it stays the same across updates, so a Dock pin survives them. The bundle already there is renamed aside first and removed last, so a failure halfway through puts the old one back rather than leaving you with no app. Then the CLI runs `open` on it.

`~/Applications` is the per-user folder, so nothing here needs admin rights.

### Signing, and the "damaged" trap

The macOS bundle is ad-hoc signed and never notarized. Its minimum system version is macOS 11.0. The release workflow asserts the signature verifies and is ad-hoc, because an ad-hoc signature that does not verify makes Gatekeeper say the app is damaged rather than that it could not be verified.

An ad-hoc signature is enough to open the app, as long as the file does not carry macOS's quarantine attribute. Files written by `gh` do not carry it, which is why the `app` path opens without a Gatekeeper dialog.

Downloading `terum-skills-desktop_<version>_aarch64.app.tar.gz` from the GitHub Releases page in a browser is a different matter. The browser sets the quarantine attribute, and Gatekeeper then reports the unpacked bundle as damaged and offers to move it to the Trash. Use the `app` verb instead. It is the supported path, and it is the only one the product tests.

### Updates and uninstall

`app` never downgrades. If the app has updated itself past your CLI's version, running `app` opens the newer bundle rather than replacing it. On every other platform the check is whether this version has an install record and a locatable executable.

`npx -y terum-skills@latest uninstall` deletes `~/Applications/Terum Skills.app`. This is the one platform where uninstall removes the app. A copy that is running keeps running until you quit it, and it cannot be reopened from the Dock afterwards; `app` downloads it again.

## Windows

```sh
npx -y terum-skills@latest app
```

downloads the NSIS installer for your architecture and runs it with `/S`, which installs silently, per user, under `%LOCALAPPDATA%\Terum Skills`, with no elevation prompt. The executable is `%LOCALAPPDATA%\Terum Skills\terum-skills-desktop.exe`, and the CLI then starts it detached so your terminal is not held until you quit the app.

The app's webview is Microsoft's WebView2. The installer uses the download bootstrapper, so a machine without WebView2 fetches it during install.

### Signing and SmartScreen

The Windows installer is unsigned. There is no certificate configured and no signing step in the release workflow. Running the `-setup.exe` by hand, after downloading it from the Releases page, trips SmartScreen's unknown-publisher prompt. The `app` path runs the same installer silently and does not surface that dialog.

### x64 and ARM64

Both architectures have a build. Which one the CLI downloads depends on the CPU your machine actually has, not on the architecture the running Node process reports, because an x64 Node under emulation reports x64.

The detection reads three environment values in order and stops at the first that answers:

1. `PROCESSOR_ARCHITEW6432`, which WOW64 sets inside an emulated process. `ARM64` means ARM64, `AMD64` means x64.
2. `PROCESSOR_ARCHITECTURE` equal to `ARM64`, which a native ARM64 process reports.
3. `PROCESSOR_IDENTIFIER` starting with `ARM`.

The third rule exists because Prism, which runs x64 code on Windows on ARM64, sets no `PROCESSOR_ARCHITEW6432` at all. An emulated process there sees `PROCESSOR_ARCHITECTURE=AMD64` and only `PROCESSOR_IDENTIFIER` still names the silicon. None of this environment reading happens off Windows.

If your CPU is ARM64 but you are running an x64 build of Node, `app` prints:

```
This machine has an ARM64 processor but you are running an x64 build of Node, so terum-skills and everything the desktop app starts will run under emulation. Install the ARM64 build of Node from nodejs.org, then run `npx -y terum-skills@latest app` again to record it.
```

It warns and continues; it does not refuse. Take the warning seriously anyway, because it is durable. `app` records the absolute path of the Node binary that ran it into `~/.terum/skills/run/app.json`, and the app then spawns exactly that binary for every command it runs, for the life of the install. An x64 Node recorded once means every child the app ever starts is emulated. Install ARM64 Node and run `app` again to re-record it.

`status` reports both `hostArch` and `processArch`. Two fields, not one, so you can see a mismatch.

### Paths

| Thing | Path |
| --- | --- |
| Local state, including config | `%USERPROFILE%\.terum\skills` |
| Team clone | `%USERPROFILE%\.terum\skills\teams\<team>` |
| Global skills | `%USERPROFILE%\.claude\skills` |
| Claude Code settings the session hook edits | `%USERPROFILE%\.claude\settings.json` |
| Desktop app | `%LOCALAPPDATA%\Terum Skills` |

The full inventory is in [machine-local state](local-state.md).

### WSL folders as Library projects

A path such as `\\wsl.localhost\Ubuntu\home\you\project` works, and you can register it with `project add`. It is also the slowest configuration the product supports. That share is a 9P filesystem over a virtual socket, and every single filesystem operation pays its round trip, so a command whose cost is "one operation per skill folder" becomes "one network round trip per skill folder".

If `ls --local` or the app's Library feels slow, a `\\wsl.localhost` root is the first thing to check. Working from a folder on the Windows filesystem removes that cost entirely.

Windows Defender adds a second, smaller tax: it scans files on open. That is why the CLI ships as one bundled file rather than the module tree it compiles from. The per-file half of process startup is the part Defender charges hardest for.

### Claude Code installed through an npm shim

Node cannot spawn a `.cmd` or `.bat` file without a shell, and a shell would mangle the multi-line prompts an eval passes as a single argument. So when `claude` resolves to a batch shim on Windows, the CLI bypasses the shim and runs what it points at, arguments untouched.

It walks your `PATH` in `PATHEXT` order, restricted to `.com`, `.exe`, `.bat` and `.cmd`. A `.exe` or `.com` is spawned as it is. A `.cmd` or `.bat` is resolved four ways, in order:

1. The conventional `node_modules\@anthropic-ai\claude-code\cli.js` beside the shim, run on the current Node.
2. Failing that, the shim's own text is read for a `%~dp0`-anchored target ending in `.js`, `.cjs`, `.mjs`, `.exe` or `.com`. A script runs on the current Node; a native binary runs as it is.
3. Failing that, `%USERPROFILE%\.local\bin\claude.exe`, which is where Claude Code's native Windows installer puts it.
4. Failing that, it gives up and names the shim:

```
`claude` resolves to the batch shim <path>, which cannot be launched without a shell. <what it looked for> Install Claude Code with the native Windows installer, or point TERUM_SKILLS_AGENT_CMD at claude.exe.
```

This exists because layouts differ: npm, pnpm, Volta, nvm4w and Claude Code's own installer all place the package differently, and a shim under nvm4w was the case the conventional path alone could not resolve.

### Files held open after they are run

Windows holds a file open for a moment after executing or writing it, between the launcher's handle, Defender's post-execution scan and the search indexer. A rename or delete that touches such a file fails with `EPERM`, `EBUSY` or `EACCES`, and removing its directory fails with `ENOTEMPTY` while the delete inside is still pending. The hold is short and outlasts the installer's own process: measured after running an NSIS installer on Windows 11 ARM64, the `EPERM` lasted about 200 milliseconds, then the same call succeeded.

So on Windows the CLI retries those four codes with a bounded backoff, nine waits totalling about five and a half seconds, before giving up. The ladder is deliberately longer than the hold and short enough that a lock a person actually holds still surfaces as an error. Off Windows the same codes are real answers and the operation runs exactly once. If the download folder is still held after the retries, the install is recorded anyway and the folder is swept on a later run, because the app is already on the machine by then.

### Uninstall

`npx -y terum-skills@latest uninstall` does not remove the desktop app on Windows. It says so:

```
The desktop app under %LOCALAPPDATA%\Terum Skills stays installed; remove it from Windows Settings ▸ Apps. Only its download record under <root>\app was removed.
```

Remove the app itself from Windows Settings ▸ Apps.

## Linux and WSL

There is no desktop app. `app` prints one honest line and exits 0, because nothing failed.

On plain Linux:

```
There is no Linux desktop app yet; everything works from the terminal.
```

Inside WSL:

```
The desktop app runs on the Windows side of this machine, not inside WSL. Install terum-skills there and run this command from a Windows terminal; from here, everything works in the terminal.
```

WSL is detected by reading `/proc/version` for `microsoft`, which is only read on Linux.

`setup` skips its app step entirely on both, so the wizard creates or joins the team in the terminal rather than handing off to the app. Everything else is identical: publish, install, eval, sync, the team repository, the session hook, the `/terum-skills` Claude Code skill, and the edit hook all work exactly as they do elsewhere.

If you work in WSL but want the app, install terum-skills on the Windows side and run `app` from a Windows terminal. Note that the two sides have separate state: `~/.terum/skills` inside WSL and `%USERPROFILE%\.terum\skills` on Windows are different machines as far as the product is concerned.

## Performance

The CLI's cost model is simple. Almost every verb is one short-lived Node process, and for a fast verb, process startup is most of the wall time. The desktop app's cost is the same thing several times over, because each board it draws is a chain of those processes.

### Process startup

The shipped CLI is bundled into a single `dist/index.js` with its dependencies inlined, and that is the file `bin` points at. Before the bundle, starting it meant the ESM loader resolving and opening one file per module on every single run, which is precisely the work a Windows filesystem and Defender charge most for.

The bin also enables Node's compile cache as its first statement, inside a try/catch so an older runtime degrades to a slower start rather than an error. That call caches modules loaded after it, which is the unbundled tree the tests and a linked checkout run; it cannot cache the one-file bundle, because V8 has already compiled that by the time the line executes. Measured on Node 24 over 15 runs, `--version` takes 86 milliseconds with the call in place.

Windows is slower per process for the reasons above. This page publishes no Windows timing, because the product's own performance specs treat every Windows figure they carry as a model rather than a measurement.

### Where the app spends its time

The app never uses `npx` and never resolves a version. It runs the exact Node binary and CLI entry that `app` recorded in `~/.terum/skills/run/app.json`.

Three things bound how often it pays the startup cost:

- A read result is cached per command line for 60 seconds, so switching back to a board inside that window costs no process at all.
- On a CLI that advertises the `serve` feature, reads go through one long-lived child rather than one process per read. A fixed allow-list of seven verbs is eligible: `status`, `ls`, `eval-report`, `search`, `validate`, `update` and `usage`. Six of those write nothing. `usage` is the deliberate exception: it appends to a machine-local log and never takes the team clone's writer lock, which is what the list protects. Every other verb gets its own process.
- The bridge caps concurrent CLI children at 8 and refuses the ninth, so a screen that fans out cannot start an unbounded number of processes.

Background fetches are throttled to at most once a minute, run one at a time, and never while one of the app's own write commands is running.

### What git costs

Every write to the team repository is one `git fetch` plus one `git push`, and a verb that refreshes the clone first (publish, `sync`) adds another fetch. A write that loses a race repeats the fetch and the push.

Those round trips dominate. A credential helper runs per connection and adds to each one, which is why a publish on Windows feels much slower than the same publish on a machine with an SSH key and no helper. There is nothing in the CLI to tune here; it is git's own cost.

`sync` gives its fetch a 20-second deadline and then kills it, so an unreachable remote costs you 20 seconds, not a hang. Per-team failures are reported and never fail the whole run.

### What `ls --local` costs

`ls --local` is a filesystem scan of your Global root plus each registered project root. It fetches nothing and spawns nothing except one `git remote get-url origin` per registered project root; the Global root is not a checkout, so it costs no child at all. Folder scans run 8 at a time, and fingerprints and health checks run 8 at a time.

Two things make it more expensive: latency per operation, which is what a `\\wsl.localhost` root adds, and placements. A folder recorded in the placement ledger is re-fingerprinted, which means reading its whole contents and hashing them, so a Library where most folders are installed copies does substantially more I/O than one where most are not.

### What evals cost

Evals are model-bound and are measured in minutes, not milliseconds. Each arm is a real Claude Code session on your own login, and the default is one repetition per case. Nothing in this product caps spend; the estimate printed before a run is the only guard.

The estimate is reconstructed from receipts already in your team clone, and with fewer than three eligible receipts the wizard explains that each eval bills your Claude account rather than inventing a number.

## Known limits

- No Linux desktop app, and none is built. The release matrix is macOS arm64 and x64, and Windows arm64 and x64.
- The macOS bundle is ad-hoc signed and not notarized, and the Windows installer is unsigned. Install both through the `app` verb; downloading them from the Releases page by hand runs into Gatekeeper and SmartScreen respectively.
- The app needs `~/.terum/skills/run/app.json` to exist. Opening the bundle from the Dock or Spotlight on a machine where `app` has never run makes every board fail with a message telling you to run `terum-skills app` from a terminal once. Running `app` writes it.
- Installing and updating the app both require `gh` to be logged in. A machine without it can use everything else.
- `uninstall` removes the app bundle on macOS only. On Windows the app stays and you remove it from Settings ▸ Apps.
- On Windows a hung `git` or `gh` child is not group-killed, because the process-group kill is Unix-only.
- Rosetta is not detected. On macOS the CLI trusts the architecture the process reports, because Rosetta's marker is not an environment variable.
- Old Node runs without complaint. `engines` is metadata; nothing checks the runtime version.
