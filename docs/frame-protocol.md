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
2. **Never use `sync --hook` over frames.** Its stdout is the Claude Code reload directive, not frames; the CLI refuses it with a `result` frame and exit 1. Call plain `sync` for an interactive workflow, or `sync --auto --fresh-ms 600000` for background synchronization.
3. **Never ask the CLI for `--help` or `--version` in frame mode.** Commander prints those as text.
4. **`cwd` is advisory; every write names its destination.** `install` asks `Install to` (or takes `--into`), `sync` refreshes every registered checkout from any cwd, `uninstall-skill` takes `--from`.
5. **`uninstall`: the consent inventory is the confirm's detail.** Render `ask.detail` verbatim in the danger dialog; answer false to cancel. Its result includes cleanup outcomes, `kept`, `record`, and CLI-generated `advice`.
6. **One run per verb.** Start the process, read frames until `result`, let it exit.

## Read sessions (`serve`)

`terum-skills --frames serve` starts one stdio session, advertising `features.serve: true`
in its single `hello`. Without `--frames`, `serve` immediately writes a result-shaped failure
(`ok:false`, `error:"serve requires --frames"`) and exits 1. This is an app-owned child, not a
network server or a daemon.

Send one JSON request per stdin line:

```json
{"t":"request","id":"r7","argv":["status","--team","acme"],"cwd":"/some/path"}
```

`id` is a non-empty string of at most 64 characters and must be unique among pending requests.
`argv` is an array of strings. `cwd` is an optional string; each request restores the process's
original cwd, including on failure. Requests run **one at a time, in arrival order**. cwd is
process-global, so even a cancelled invocation must unwind before the next one starts. A fresh
commander program, Execute sink, and frame Prompter are created for each request.

Only `status`, `ls`, `eval-report`, `search`, `validate`, and `update` are accepted. Any other
verb gets `ok:false` with `serve does not run <verb>; spawn it as its own process`, without
executing it. This is a transport allow-list; the accepted verbs retain their existing behavior
(including `update`'s release-advertisement probe and local release-state maintenance).

Every `print`, `ask`, `progress`, and `result` from a request carries its request `id`. A session
`ask` uses that same id for its answer; questions within a request are answered sequentially.
`hello` never has an id. Exactly one `result` settles each request, including a refused verb,
a usage error, or an exception. After it, the session keeps reading. **This is the one rule the
one-shot protocol states that `serve` deliberately breaks.** Rule 6 ("one run per verb")
continues to hold for every verb except `serve` itself.

- `{"t":"answer","id":"r7","value":true}` answers the pending ask for r7.
- `{"t":"cancel","id":"r7"}` abandons only r7, fails its pending question closed, and emits
  its failing result with `error:"cancelled"` and `declined:true`. Queued cancelled requests
  never execute. The session survives and suppresses late output from the abandoned request.
- `{"t":"cancel"}` ends the entire session immediately, drains nothing, runs the shutdown
  hooks, and exits 143, as in a one-shot run. No terminal results are guaranteed in that case.

Closing stdin finishes accepted requests (including the one in flight), fails unanswered
questions closed, and exits 0 after their results. Malformed lines, unknown frame types,
duplicate in-flight ids, and answers to unknown ids are diagnosed on stderr and ignored;
none may disturb a pending question or write unframed text to stdout.

Example (`>` is stdout, `<` is stdin):

```text
> {"t":"hello","protocol":1,"version":"0.13.0","verbs":["status","ls","serve"],"features":{"serve":true}}
< {"t":"request","id":"r1","argv":["status"]}
< {"t":"request","id":"r2","argv":["ls","--local"],"cwd":"/work/acme"}
> {"t":"print","id":"r1","level":"info","line":"terum-skills 0.13.0"}
> {"t":"result","id":"r1","verb":"status","ok":true,"exitCode":0,"value":{"teams":[]}}
> {"t":"result","id":"r2","verb":"ls","ok":true,"exitCode":0,"value":{"local":[]}}
< {"t":"request","id":"r3","argv":["install","example"]}
> {"t":"result","id":"r3","verb":"install","ok":false,"exitCode":1,"error":"serve does not run install; spawn it as its own process"}
```

The desktop learns support from an ordinary run's hello before starting a session; if
`hello.features.serve` is not true, every read uses the existing one-shot path. Sessions bind
to the app state's `entry`, `node`, and `version` and are retired when any changes. A child
failure fails pending reads; the next read may restart it once. A second failure disables
sessions for the rest of the app's life and records the reason. A child that has not produced
a hello within ten seconds is a startup failure. No request is automatically replayed after
failure. Mutations and long-running verbs retain their own one-shot processes.

Protocol stays **1** because every change is additive; one-shot frames retain their shapes
and question ids, with only the advertised verb and feature lists extended.

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

`hello.features` names `favorites`, `follow`, `roles`, `lastSeen`, `installScope`, `inviteScoping`, `disablePerMachine`, `projectMembers`, `liftOnCards`, `runEvalInApp`, `perCase`, `progress`, `memberRole`, `localIdentity`, `checkouts`, `projects`, `refresh`, `discover`, `appUpdate`, `autoSync`, and `serve`. `autoSync` advertises non-interactive `sync --auto`, its `--fresh-ms` option, progress frames, and phase timings. `memberRole` is the owner-written job label and is true; `roles` is the Admin/Member permission chip and is true — `status` emits a per-member `admin: boolean | null` derived from the repository's GitHub collaborator permissions via gh, and only when `status --permissions` is passed (null when the flag is absent, when gh is absent, or when the lookup fails or times out). `checkouts` is true and means the `checkout add`, `checkout remove`, and `checkout list` verbs and the `registered`/`detected` section fields exist. `projects` is true and means the `project create` verb exists: a shell may offer creating a team project (a name in `team.json projects` and the repository its skills place into), which is a different act from registering a local checkout folder. `installScope` is true: install destinations and destination-aware removal are available. `refresh` is true and means the `refresh` verb exists: a shell may fetch each team clone to `origin/main` in the background without running `sync`, so a teammate's committed work becomes visible to the read verbs. `discover` is true and means the `checkout discover` verb exists and `setup` offers to look for skill folders on this machine; a shell whose CLI reports it false hides the "find skills" control. `liftOnCards` is true and means `ls` carries the per-skill `receipt` limb described below, so a shell may show a skill's net lift on its card; a shell whose CLI reports it false shows the verdict-free "—" card instead. Lift on a card must be rendered with its receipt's provenance (`model`, `k`, `cc_version`, `runner_handle`, `timestamp`) reachable from the same element, and no skill list may be sorted or ranked by any receipt number.

`appUpdate` is true and means the `app-update` verb exists: a shell may check for, download and install a newer desktop app. A CLI that omits the key cannot, and a shell must render the honest read-only state instead of trying.

`hello.protocol` is `1`. `install`, `sync`, and `uninstall-skill` carry `detail` on their confirmation asks. `detail` is an additive optional field: protocol stays 1. Additive changes (new optional fields, new `features` keys, a verb starting to emit `progress`) do not bump it. A change that alters the meaning of an existing field does.

Each `ls` team skill carries `receipt`: the newest schema-valid committed receipt at that skill's own
current tree hash, reduced to the card's display facts — `{ run_id, verdict, execution_status,
expected_rows, scored_rows, comparisons, arm_scores, provenance: { model, k, cc_version, timestamp,
runner_handle } }` — under the receipt's own field names, or null when that version has no receipt
(the honest "—" state). `comparisons` and `arm_scores` are the receipt's own records, verbatim; a
shell reads `comparisons['candidate-vs-baseline']` for the card and never combines receipts. The limb
costs no extra process: `ls` has already resolved each skill's version. A receipt that is unreadable,
or whose `skill_id`/`version` disagrees with its path, is reported as that skill's problem and leaves
the limb null — it never fails the listing.

## What `status` reports about this machine

`status`'s result carries two architecture fields, on success and on a failing read alike:

- `hostArch` — the CPU this machine actually has.
- `processArch` — the architecture of the Node process running the CLI, i.e. `process.arch`.

They differ only under emulation. A `processArch` of `x64` with a `hostArch` of `arm64` means an x64 build
of Node is running on an ARM64 machine through Windows emulation, so the CLI, the desktop app it installs,
and every child that app spawns all pay the emulation tax. A shell should surface that rather than hide it.
Off Windows the two are always equal: the only signal read is `PROCESSOR_ARCHITEW6432`, which Windows sets
inside an emulated process and nowhere else. Both fields are plain strings and an unrecognised value passes
through unchanged, so never switch on them exhaustively.

`app` reports the same condition as `emulation`, either `"win32-arm64-on-x64"` or `null`, and prints one
line telling the person to install the ARM64 build of Node. It still installs the app: this is a warning,
not a refusal.

These are additive result fields; protocol stays 1.

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

Native-command amendment: `app_update_on_close({ version: string | null })` arms or disarms one detached installer. This additional command is necessary because the installer must outlive the WebView. The base actually has six commands including `quit`, so this is its seventh (the original decision's “five” count predates `quit`). On the last window's CloseRequested or ExitRequested, the shell consumes the arm once and invokes the recorded Node/CLI with `app-update --apply-now --release <version> --reason on-close`, plus `--await-pid <shell-pid>` to preserve the CLI's Windows wait. It uses a new process group on macOS and CREATE_NO_WINDOW | DETACHED_PROCESS on Windows and stays outside the bridge's child cleanup. The command follows the existing application-command registration, without a separate app ACL permission. Before spawning, the shell writes a waiting marker; a spawn failure replaces it with a failed marker. A child that dies before executing the CLI leaves the waiting marker visible as an unfinished install on the next launch. An unwritable marker is logged without preventing close. A manual or overnight handoff first disarms the close action to prevent two installers; a failed handoff restores the previous arm unless the policy changed in the meantime.

Update diagnostics are kept for the session by concern, so successful arming cannot erase a download or install failure. A failed preference flush is reported without disabling the hydrated policy. A cosmetic acknowledgement write cannot turn a successful check into a failure; the desktop DTO can carry `acknowledgementError` alongside that successful observation. The install reason has one desktop DTO home, `AppUpdateStatus.reason`, mapped from the wire marker.

The shared overnight hook resets idleness before handling activity. A timer more than one minute late is conservatively treated as a wake from suspension and requires another full idle period. Activity updates the idle timestamp without rescheduling on every pointer movement; the pending timer checks that timestamp before firing. Invalid clock readings are reported and retried with one pending timer. The chip carries a consumed `focus=app` navigation intent, so ordinary visits to Settings do not move keyboard focus.

### f-wizard

`eval --queue-list` returns `{ items }`, where each item has `team`, `skill`, `version`, `requestedAt`,
`window: "overnight" | "later"`, and an optional `lastError`. `eval --dequeue <team>/<skill>` removes all queued
versions of that team/skill and returns `{ items }` with the remaining queue. Missing queue state is empty;
malformed or unreadable state fails without replacing it.

`eval --drain [--parallel n] [--window overnight] [--max n]` returns `{ items, attempted, completed, failures }`.
`failures` contains `{ item, error }` entries. A failure returns `ok:false` with that partial value, retains the
item with `lastError`, and continues siblings up to the positive-integer attempt limit. The bounded pool defaults to four concurrent evals. Runs with committed receipts are removed even when their execution status is partial or failed; that status remains visible in output. Uncommitted runs and changed queued versions without receipts remain. After refresh, an existing receipt for the pinned version satisfies the queue item before any paid work.
Runs use ordinary eval preflight and consent; a drain never auto-answers a generated-asset confirmation.
Print and `progress` frames identify the current eval; no new verb or feature key is added.

Setup keeps the existing eval question string and uses a select with `Now`, `In batches`, `Overnight`, `Skip`
(default `Skip`). The cost line precedes that question and uses measured totals reconstructed from the current
team clone: sum each arm mean multiplied by `provenance.cases.length * provenance.k`, for both cost and duration. Receipts with null arm measurements do not qualify. With fewer than three eligible receipts,
the wizard explains that each eval bills the person's Claude account without inventing a number.
`steps.evals` additionally admits `queued` (Queued for overnight) and `batched` (Evaluated in batches).
A declined batch continuation queues the remaining skills for `later`; `eval --drain` includes those items.
Decorative banners, step headers, bullets and boxes are terminal-only and never enter the frame transcript.

The desktop drains overnight items through its visible, stoppable eval host, as one parallel batch, once per local night
between 01:00 and 05:00 after thirty minutes without pointer or keyboard activity. The app starts `eval --drain --parallel 4` once that night; Stop cancels that one process. Activity, the preference, and the window are checked before launch; an active batch may finish. This unfiltered drain includes later items too, as required by A1. The app must remain open. Closed-app scheduling is deferred; a person can run
`eval --drain` manually at any time. The overnight preference defaults to true.

A1–A3: setup runs all candidates four at a time for Now; In batches asks `How many at a time?`
(default 4), runs that many concurrently, and checks in between batches. Each eval gets a five-minute
clone-lock wait budget. Cases inside an eval stay sequential. No account rate limit is guessed; an agent
rate-limit error fails that eval and siblings continue. Cost scales by skill count; estimated elapsed time
scales by `ceil(count / parallel)`. The estimate before choosing a mode assumes the default parallelism.

Ask frames additionally accept optional `descriptions: string[]`, one per select choice. These pass through
to native radio options in the desktop prompt dialog. Malformed descriptions are omitted, preserving choice
positions. `detail` carries the estimate above the eval choices. Terminal options use typed numbers or Enter;
arrow-key/raw-mode handling, cursor animation and spinners are out of scope. In decorated setup only, titles
use unnumbered `> Title` headers, body text is indented, outcomes are colored, and Done prints a session box.
Plain output and frame question strings retain their existing wording.

Parallel batch output consists of contiguous `── skill ──` context blocks and `✓ skill` / `✗ skill: error`
settlement lines, including over frames. Questions and block flushes share one mutex. Only the batch emits
progress (`step: "evals"`, cumulative settled count, full candidate total); a check-in clears that progress display. Setup's queued
outcome is complete and reads `Queued`; batched reads `Done`. No protocol feature or verb key was added.

Review fixes: In batches prints one run-wide opening and summary; after a different width is chosen,
the estimate is repeated for that width. Historical-data I/O errors disclose the problem and leave the
eval offer available. Batch-size input is limited to three attempts. An empty drain prints `No queued evals.`;
a competing drain reports that another drain is already running. Buffered failures retain every remediation
line; completion observers cannot change a committed result. Decorated Welcome has no separate header,
and selects without defaults omit the Enter hint. Mock and real eval choices both default to Skip;
the overnight replay explicitly chooses Overnight. Radio descriptions are associated for assistive technology.
### f-auto-sync
`sync --auto --frames` never asks questions or prints ordinary notices; consent-dependent work is
returned in `deferred` for the Inbox. `notices` and team outcomes retain their existing meaning.
`--fresh-ms <n>` accepts a non-negative safe integer and requires `--auto`; default 0 always runs.
`--auto` cannot be combined with `--hook` or `--prune`. Automatic runs disable Git terminal prompts
and use the hook's short lock budget, but do not use its one-hour throttle.
Each attempted team emits a `progress` frame for `fetch`, `place`, `share`, and `orphans` as those
phases begin. `step` is `<team>: <phase>`; unchanged phases append `: skipped (unchanged)`.
The result adds `timings: { team, phase, ms }[]`, measured with a monotonic clock. A freshness or
lock skip has no phases; a failed fetch has only its fetch timing. Team results stay in config order.
Fetches run with concurrency at most four; teams sharing a URL transfer the fetched refs locally
instead of fetching that remote again in phase A. Subsequent `safeWrite` operations retain their
own fetch/retry protection. Placement and ledger writes stay sequential.
Successful teams write JSON `{head, at}` stamps; freshness readers still use mtime. Empty and ISO
legacy stamps remain valid for freshness but cannot establish an unchanged HEAD. Automatic and hook
runs skip placement fingerprinting when HEAD still matches the stamp after local sharing and eligible
ledger placements (and their SKILL.md files) exist, provided no pending intent remains. Sharing local
sources, restoring missing ledger entries, and orphan checks always run: their inputs can change
without a remote commit. Sharing precedes placement reconciliation so connected edits reach placed copies in the
same run. Shared and orphan ledgers are each scanned once; timings accumulate actual per-team work.
Stamps record the final HEAD, including this run’s pushes. Manual sync always reconciles.
Pending intent is replayed for every fetched team before auto-share and the top-level library-size
pass, preserving the count's observation point from interactive sync. Placement timings include both
pending replay and later placement reconciliation, with one progress frame when placement first begins.
Intent arriving after replay remains pending and withholds the team's stamp for a later run.
The top-level library-size pass also always runs before shared reconciliation. Its own count-only
commit directly atop the fetched HEAD does not invalidate unchanged placements; any intervening
commit still requires full reconciliation. Pending replay rechecks the live queue so matching intents
already completed by an earlier replay cannot place the same destination twice.
Teddy ratified launch/focus automatic sync on 2026-09-10, overriding the desktop's on-demand-only
rule. The app runs at most once per ten minutes, single-flight, with no polling; a workflow already
running skips that focus trigger; an unstarted launch sync retries when the workflow settles. The
ten-minute cooldown begins at completion; a native relaunch bypasses both the policy and stamp gates.
Manual sync waits for an automatic sync already in flight. Failed automatic outcomes retain CLI
notices beside their first error line. Cache-notification failures never change the sync outcome. Older CLIs retain the read-only launch/focus refresh policy.
