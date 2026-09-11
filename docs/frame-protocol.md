# Frame mode: driving terum-skills from a program

`terum-skills --frames <verb> [options]` runs any verb with a program, not a person, on the other end. Every line the CLI writes to stdout is one JSON object (a frame); every line it reads from stdin is one JSON object. Nothing else is on stdout. Diagnostics about the channel itself go to stderr. Without `--frames`, nothing changes.

This is the Prompter serialised (`src/lib/prompt.ts`): the CLI already funnels every question it asks a human through one interface, and frame mode is a second implementation of that interface (`src/lib/frames.ts`). Verbs do not know which one they have. The desktop app's `src/backend/tauri/` speaks this protocol; so can a script.

The flag is position-independent before the first `--` (`--frames status` and `status --frames` are the same) and is removed before the verb's own options are parsed.

## Frames the CLI writes (stdout)

One per line, in this order: `hello` once, then any number of `print` and `ask`, then exactly one `result`, including on a usage error, unless the run is cancelled by terminating the process.

| Frame | Shape | Meaning |
|---|---|---|
| `hello` | `{"t":"hello","protocol":1,"version":"0.1.5","verbs":[...],"features":{...}}` | Always first. `verbs` is every public verb as it may be invoked. `features` maps drawn affordances the desktop design assumes to whether this CLI version supports them; a `false` means hide or grey the control. Read it instead of hard-coding what the CLI can do. |
| `print` | `{"t":"print","level":"info"\|"warn"\|"error","line":"..."}` | Text the verb would have printed. Render it where the verb's output belongs. |
| `ask` | `{"t":"ask","id":"q1","kind":"confirm"\|"text"\|"select","question":"...","default":"...","choices":[...],"detail":["..."]}` | The verb is blocked until an `answer` with the same `id` arrives. `default` appears only for `text` when the verb offers one; `choices` only for `select`. `detail` is optional and carries the lines the person needs in order to answer (for example the identity line, or a skill's requested allowed-tools); render it with the question, as the dialog's description, not in the transcript; absent means none. |
| `progress` | `{"t":"progress","step":"...","current":n,"total":n}` | Coarse step reporting for a long verb. `install`, `checkout discover` and `setup`'s `discover` and `evals` steps emit it; every other verb is silent. `step` names the step (`discover`, `evals`, or `install`'s four phases); `current` counts what is done so far and `total` appears only when the verb knows it. `features.progress` is `true`. Never required, never ordered against `ask`; a shell that ignores it is unaffected. |
| `result` | `{"t":"result","verb":"install","ok":true,"exitCode":0,"value":{...}}` | Always last. `verb` is the invoked verb. `value` is the verb's own result object when it has one. A failing result may also carry `value`, the verb's partial result (for example, `eval` after a completed evaluation whose receipt commit failed). On failure: `ok:false`, `exitCode:1`, `error` is the one-line message, and `declined:true` when set by the CLI's typed decline (the person said no) rather than by matching the error text, and `refused:true` when the CLI refused the operation before any side effect (one team per machine); a refusal is not a decline. After `result` the CLI stops reading stdin and exits. |

The process exit code matches `result.exitCode`. The failure line is also written to stderr, exactly as without the flag, so a shell that only watches the exit code and stderr still works.

## Frames the shell writes (stdin)

| Frame | Shape | Meaning |
|---|---|---|
| `answer` | `{"t":"answer","id":"q1","value":...}` | Answers the `ask` with that `id`. For `confirm`: a boolean, or one of `y`, `yes`, `true` (anything else is no). For `text`: a string; empty means take the default. For `select`: the 1-based index as a number, or the exact choice string. An invalid `select` answer gets a `print` warn frame and the same question is asked again with a new `id`, up to three times, then the verb fails. |
| `cancel` | `{"t":"cancel"}` | Abandons the run. Every pending question fails closed and the bin runs its shutdown hooks and exits 143 — killing its live agent children with SIGKILL first, and releasing any file lock it holds. A terminal `result` frame is not guaranteed after cancellation. |

Closing stdin fails pending questions closed; it does not invoke the bin’s cancellation hook. Send `cancel` to stop work that does not ask questions. Malformed lines and answers to unknown ids are reported on stderr and ignored; they never disturb a pending question.

## Rules a shell must follow

1. **The `gh auth login` offer never arrives over frames.** When `gh` is installed but logged out, the CLI in frame mode prints `GitHub CLI is installed but logged out. Run \`gh auth login\` in a terminal, then try again.` instead of asking (it would otherwise hand its stdio to `gh`, which here means the frame pipes). Likewise `setup` never asks the desktop-app opt-in question over frames. If a shell ever does see that confirm, the CLI is older than 0.1.6: answer `false`.
2. **Never use `sync --hook` over frames.** Its stdout is the Claude Code reload directive, not frames; the CLI refuses it with a `result` frame and exit 1. Call plain `sync`.
3. **Never ask the CLI for `--help` or `--version` in frame mode.** Commander prints those as text.
4. **`cwd` is advisory; every write names its destination.** `install` asks `Install to` (or takes `--into`), `sync` refreshes every registered checkout from any cwd, `uninstall-skill` takes `--from`.
5. **`uninstall`: the consent inventory is the confirm's detail.** Render `ask.detail` verbatim in the danger dialog; answer false to cancel. Its result includes cleanup outcomes, `kept`, `record`, and CLI-generated `advice`.
6. **One run per verb.** Start the process, read frames until `result`, let it exit.

## Example

```
$ printf '' | terum-skills --frames status
{"t":"hello","protocol":1,"version":"0.1.5","verbs":["login","setup",...],"features":{"favorites":false,...}}
{"t":"print","level":"info","line":"terum-skills 0.1.5"}
{"t":"print","level":"info","line":"Get started:"}
...
{"t":"result","verb":"status","ok":true,"exitCode":0,"value":{"version":"0.1.5","teams":[]}}
```

A `connect` that asks:

```
> {"t":"ask","id":"q1","kind":"select","question":"Which skill?","choices":["diagnose (global)","tdd (project)"]}
< {"t":"answer","id":"q1","value":2}
> {"t":"ask","id":"q2","kind":"confirm","question":"Connect tdd to team terum? Adds license, id and author to its SKILL.md."}
< {"t":"answer","id":"q2","value":false}
> {"t":"result","verb":"connect","ok":false,"exitCode":1,"error":"Connect was declined.","declined":true}
```

A second-team binding refused before any side effect:

```json
{"t":"result","verb":"setup","ok":false,"exitCode":1,"error":"One team per machine: …","refused":true}
```

## Versioning

Protocol stays 1. `hello.features.localIdentity` advertises the additive `ls --local` identity fields: every row and `notOffered` entry carries `skillId` (UUID or null), and every row carries independent `placed` and `connected` booleans. The app declares these keys optional while keeping local rows strict, so older CLIs remain readable; presence joins require the feature. `ls member` adds `member.installed` records (`id`, `scope`, `since`), and `connect` may return `adopted: true` after consent to record an existing identity. These are additive result fields. `ls --local` additionally carries `remote` on every section (`{url, slug}` or `null`, where `slug` is owner/repo on GitHub and null on every other host); the app declares it optional so an older CLI reads as "not connected".

`hello.features` names `favorites`, `follow`, `roles`, `lastSeen`, `installScope`, `inviteScoping`, `disablePerMachine`, `projectMembers`, `liftOnCards`, `runEvalInApp`, `perCase`, `progress`, `memberRole`, `localIdentity`, `checkouts`, `projects`, `refresh`, `discover`, and `appUpdate`. `memberRole` is the owner-written job label and is true; `roles` is the Admin/Member permission chip and is true — `status` emits a per-member `admin: boolean | null` derived from the repository's GitHub collaborator permissions via gh, and only when `status --permissions` is passed (null when the flag is absent, when gh is absent, or when the lookup fails or times out). `checkouts` is true and means the `checkout add`, `checkout remove`, and `checkout list` verbs and the `registered`/`detected` section fields exist. `projects` is true and means the `project create` verb exists: a shell may offer creating a team project (a name in `team.json projects` and the repository its skills place into), which is a different act from registering a local checkout folder. `installScope` is true: install destinations and destination-aware removal are available. `refresh` is true and means the `refresh` verb exists: a shell may fetch each team clone to `origin/main` in the background without running `sync`, so a teammate's committed work becomes visible to the read verbs. `discover` is true and means the `checkout discover` verb exists and `setup` offers to look for skill folders on this machine; a shell whose CLI reports it false hides the "find skills" control.

`appUpdate` is true and means the `app-update` verb exists: a shell may check for, download and install a newer desktop app. A CLI that omits the key cannot, and a shell must render the honest read-only state instead of trying.

`hello.protocol` is `1`. `install`, `sync`, and `uninstall-skill` carry `detail` on their confirmation asks. `detail` is an additive optional field: protocol stays 1. Additive changes (new optional fields, new `features` keys, a verb starting to emit `progress`) do not bump it. A change that alters the meaning of an existing field does.

## Verbs added for the desktop app

`eval-report <skill> [--team <team>]` is read-only: it reads the local clone and this machine's run tree without fetching, networking, or prompting. `result.value` is an `EvalReport`:

- `skill: { id, name }` and `versions: { placed, teamCurrent, evaluated }`; versions are full tree hashes, with `placed` and `evaluated` nullable.
- `latest`: the newest committed receipt for `teamCurrent`, verbatim with an absolute `path`, or null; `latestState` is `ok`, `none`, or `invalid`. An invalid newest receipt produces one warning and is never replaced by an older receipt.
- `history`: schema-valid committed receipts across version directories, newest first by `run_id`, as `{ version, run_id, verdict, execution_status, model, cc_version, runner_handle, timestamp, comparison, committed: true }` rows. `runner_handle` and `timestamp` come verbatim from provenance; `comparison` is the receipt's `candidate-vs-baseline` comparison (`win`, `loss`, `tie`, `net_lift`, `sign_p`), or null.
- `localRuns`: directories containing `run.jsonl`, newest first, as `{ run_id, run_dir, execution_status, committed, receipt }` rows. `run_dir` is absolute; `receipt` is the schema-valid local `receipt.json` with an absolute `path`, or null. Status comes from that receipt or is `unknown`; `committed` indicates a matching run ID in history. No statistics are derived from the log.

`refresh [--team <team>]` moves each configured team clone to `origin/main` — `git fetch origin` then
`git reset --hard origin/main`, under the same per-clone writer lock every write verb takes — and does nothing
else: no placement, no pending replay, no auto-share, no push, no question, and **no `run/<team>.stamp` write**
(the stamp means "fully synced" and still belongs to `sync` alone). The clone is disposable state, so a local
commit in it is discarded by the reset. `result.value` is:

- `changed: boolean` — true when at least one clone moved.
- `teams`: one row per team as `{ team, state, changed, head, detail? }`. `state` is `refreshed` (the fetch and
  reset ran), `busy` (another process holds that clone's writer lock — that process is itself fetching),
  `unreachable` (a recognised remote access failure), `no-clone` (nothing at the path, an incomplete clone, or a
  clone of a different remote — never repaired here), or `error`. `head` is HEAD after the attempt or null;
  `detail` is this CLI's own explanation for any state other than `refreshed`.

Exit code is 0 whenever the query ran: a per-team failure is reported in its row, never as a process failure.
Over frames the verb emits only `hello` and `result`.

`checkout discover [--under <dir>…] [--depth <n>] [--budget-ms <n>] [--register]` looks for folders that hold `.claude/skills`. `result.value` is `{ candidates: { path, skillFolders, registered, repoRoot }[], scanned, truncated, problems: { path, reason }[] }`. It follows no symlinks, probes `.claude` without entering other dot-directories, never descends into `~/.terum`, and never offers the home folder itself. Unreadable folders land in `problems`; a run that hits its time budget sets `truncated`. `--register` adds every candidate that is not registered yet and sets its `registered` to true in the result. While it runs it emits `progress` frames with `step: "discover"` and `current` = folders scanned.

### App updates

`app-update --check` (the default) reads the cached release advertisement and local staged/installed versions without network calls or writes. `--check --force` probes release tags under the same GitHub-team policy as `update`. Checks always succeed, reporting probe failures as data.

`app-update --stage [--release <version>]` downloads the selected release through `gh`, verifies its published SHA-256, and stages it without installing. The default release is this CLI's version. An advertised tag with missing release assets returns `ok: true, notPublished: true, staged: false`; the shell stays quiet and retries on the next launch.

`app-update --apply [--release <version>] [--reason on-close|overnight|manual]` hands a staged install to a detached process. The public result values are:

```ts
export interface AppUpdateCheck {
  mode: 'check'; platform: AppPlatform; supported: boolean;
  cliVersion: string | null; latest: string | null; latestAt: string | null;
  probe: 'ok' | 'skipped' | 'cached' | 'failed'; probeError: string | null;
  staged: string | null; installed: string[];
  lastApply: AppUpdateMarker | null; ppid: number;
}
export interface AppUpdateStage {
  mode: 'stage'; version: string; platform: AppPlatform;
  staged: boolean; notPublished: boolean; alreadyStaged: boolean;
  asset: string; bytes: number; path: string | null;
}
export interface AppUpdateApply { mode: 'apply'; version: string; platform: AppPlatform; awaitPid: number | null; handedOff: true }
```

`AppPlatform` is the existing desktop platform name. `lastApply` has `{schema:1, version:string, phase:'waiting'|'installing'|'launched'|'failed', at:string, error:string|null, reason?:'on-close'|'overnight'|'manual'}`. `ppid` is the CLI's parent process ID, available for verifying the app handoff.

`app-update --apply` returns as soon as the background installer process exists. The shell must then quit; it is the shell's job to quit and the CLI never kills it. `--apply` watches the CLI's parent process only in frame mode, where that parent is the shell itself; from a terminal it installs immediately.

On macOS, quit the running app before applying from a terminal: `open` without `-n` would otherwise bring the old instance to front. On Windows, the silent installer handles an existing running copy. The hidden detached install leg never uses `--frames`; it records its phases in `run/app-update.json`, never rewrites `run/app.json`, and does not update the CLI.

### f-md-parity

`ls` skill rows add `frontmatter: string | null` beside `body`; `ls --local` rows and `notOffered` entries also include the raw fenced frontmatter when readable (otherwise null), without adding body text to local inventory; key order, quoting, and internal line endings are preserved, and older CLIs may omit the field.
### f-update-policy

`app-update --reason on-close|overnight|manual` records the install reason in every apply marker and forwards it from `--apply` to `--apply-now`. Omission remains compatible with old callers and displays the manual wording. No CLI verb or feature key is added.

The desktop checks once at launch and displays the cached advertised version in its top-bar update chip. Settings ▸ Updates uses `updates:app:policy`: `ask` (manual download/install), `on-close` (the default), or `overnight` (01:00–05:00 local after 30 idle minutes). The old boolean migrates once: false → ask, true → on-close. Successful install markers display “Updated to {version}”, adding “when you quit” or “overnight”; `updates:app:lastShown` acknowledges the marker across launches while the current session retains it. Failure markers remain visible.

Native-command amendment: `app_update_on_close({ version: string | null })` arms or disarms one detached installer. This additional command is necessary because the installer must outlive the WebView. The base actually has six commands including `quit`, so this is its seventh (the original decision's “five” count predates `quit`). On the last window's CloseRequested or ExitRequested, the shell consumes the arm once and invokes the recorded Node/CLI with `app-update --apply-now --release <version> --reason on-close`, plus `--await-pid <shell-pid>` to preserve the CLI's Windows wait. It uses a new process group on macOS and CREATE_NO_WINDOW | DETACHED_PROCESS on Windows and stays outside the bridge's child cleanup. A spawn failure records a failed marker; an unwritable marker is logged without preventing close. A manual or overnight handoff first disarms the close action to prevent two installers.
