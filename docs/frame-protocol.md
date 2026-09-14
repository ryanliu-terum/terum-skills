# Frame mode: driving terum-skills from a program

`terum-skills --frames <verb> [options]` runs any verb with a program, not a person, on the other end. Every line the CLI writes to stdout is one JSON object (a frame); every line it reads from stdin is one JSON object. Nothing else is on stdout. Diagnostics about the channel itself go to stderr. Without `--frames`, nothing changes.

This is the Prompter serialised (`src/lib/prompt.ts`): the CLI already funnels every question it asks a human through one interface, and frame mode is a second implementation of that interface (`src/lib/frames.ts`). Verbs do not know which one they have. The desktop app's `src/backend/tauri/` speaks this protocol; so can a script.

The flag is position-independent before the first `--` (`--frames status` and `status --frames` are the same) and is removed before the verb's own options are parsed.

## Frames the CLI writes (stdout)

One per line, in this order: `hello` once, then any number of `print` and `ask`, then exactly one `result`, including on a usage error, unless the run is cancelled by terminating the process.

| Frame | Shape | Meaning |
|---|---|---|
| `hello` | `{"t":"hello","protocol":1,"version":"0.14.0","verbs":[...],"features":{...}}` | Always first. `verbs` is every public verb as it may be invoked. `features` maps drawn affordances the desktop design assumes to whether this CLI version supports them; a `false` means hide or grey the control. Read it instead of hard-coding what the CLI can do. |
| `print` | `{"t":"print","level":"info"\|"warn"\|"error","line":"..."}` | Text the verb would have printed. Render it where the verb's output belongs. |
| `ask` | `{"t":"ask","id":"q1","kind":"confirm"\|"text"\|"select"\|"path","question":"...","default":"...","choices":[...],"detail":["..."]}` | The verb is blocked until an `answer` with the same `id` arrives. `default` appears for `text`, `path`, and `select` when the verb offers one; `choices` only for `select`. `path` is `text` whose answer is a filesystem path: a shell may offer a folder chooser beside the field, a terminal reads a line as usual, and the answer is a string either way — a shell that treats `path` as `text` is correct, just less convenient. `detail` is optional and carries the lines the person needs in order to answer (for example the identity line, or a skill's requested allowed-tools); render it with the question, as the dialog's description, not in the transcript; absent means none. |
| `progress` | `{"t":"progress","step":"...","current":n,"total":n}` | Coarse step reporting for a long verb. `install` and eval batches (including setup’s `evals` step) emit it. `step` names the step (`evals`, or `install`'s four phases); `current` counts what is done so far and `total` appears only when the verb knows it. `features.progress` is `true`. Never required, never ordered against `ask`; a shell that ignores it is unaffected. |
| `result` | `{"t":"result","verb":"install","ok":true,"exitCode":0,"value":{...}}` | Always last. `verb` is the invoked verb. `value` is the verb's own result object when it has one. A failing result may also carry `value`, the verb's partial result (for example, `eval` after a partially failed queue drain). On failure: `ok:false`, `exitCode:1`, `error` is the one-line message, and `declined:true` when set by the CLI's typed decline (the person said no) rather than by matching the error text, and `refused:true` when the CLI refused the operation before any side effect (one team per machine); a refusal is not a decline. After `result` the CLI stops reading stdin and exits. |

The process exit code matches `result.exitCode`. The failure line is also written to stderr, exactly as without the flag, so a shell that only watches the exit code and stderr still works.

## Frames the shell writes (stdin)

| Frame | Shape | Meaning |
|---|---|---|
| `answer` | `{"t":"answer","id":"q1","value":...}` | Answers the `ask` with that `id`. For `confirm`: a boolean, or one of `y`, `yes`, `true` (anything else is no). For `text` and `path`: a string; empty means take the default. For `select`: the 1-based index as a number, or the exact choice string; an empty or absent answer takes the offered default. An invalid `select` answer gets a `print` warn frame and the same question is asked again with a new `id`, up to three times, then the verb fails. |
| `cancel` | `{"t":"cancel"}` | Abandons the run. Every pending question fails closed and the bin runs its shutdown hooks and exits 143 — killing its live agent children with SIGKILL first, and releasing any file lock it holds. A terminal `result` frame is not guaranteed after cancellation. |

Closing stdin fails pending questions closed; it does not invoke the bin’s cancellation hook. Send `cancel` to stop work that does not ask questions. Malformed lines and answers to unknown ids are reported on stderr and ignored; they never disturb a pending question.

## Rules a shell must follow

1. **The `gh auth login` offer never arrives over frames.** When `gh` is installed but logged out, the CLI in frame mode prints `GitHub CLI is installed but logged out. Run \`gh auth login\` in a terminal, then try again.` instead of asking (it would otherwise hand its stdio to `gh`, which here means the frame pipes). Likewise `setup` never asks the desktop-app opt-in question over frames. If a shell ever does see that confirm, the CLI is older than 0.1.6: answer `false`.
2. **Never use `sync --hook` over frames.** Its stdout is the Claude Code reload directive, not frames; the CLI refuses it with a `result` frame and exit 1. Call plain `sync` for both foreground and background use: it fetches and changes nothing on this machine (see `f-sync`).
3. **Never ask the CLI for `--help` or `--version` in frame mode.** Commander prints those as text.
4. **`cwd` is advisory; every write names its destination.** `install` asks `Install to` (or takes `--into`), `sync` fetches every team clone from any cwd, `uninstall-skill` takes `--from`.
5. **`uninstall`: the consent inventory is the confirm's detail.** Render `ask.detail` verbatim in the danger dialog; answer false to cancel. Its result includes cleanup outcomes, `kept`, `record`, and CLI-generated `advice`.
6. **One run per verb.** Start the process, read frames until `result`, let it exit.

## Read sessions (`serve`)

`terum-skills --frames serve` starts one stdio session, advertising `features.serve: true`
in its single `hello`. Without `--frames`, `serve` immediately fails
with the error `serve requires --frames` and exits 1. This is an app-owned child, not a
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

Abbreviated example (`>` is stdout, `<` is stdin; the complete hello inventory is below):

```text
> {"t":"hello","protocol":1,"version":"0.14.0","verbs":["status","ls","serve"],"features":{"serve":true}}
< {"t":"request","id":"r1","argv":["status"]}
< {"t":"request","id":"r2","argv":["ls","--local"],"cwd":"/work/acme"}
> {"t":"print","id":"r1","level":"info","line":"terum-skills 0.14.0"}
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
{"t":"hello","protocol":1,"version":"0.14.0","verbs":["login","setup",...],"features":{"favorites":false,...}}
{"t":"print","level":"info","line":"terum-skills 0.14.0"}
{"t":"print","level":"info","line":"Get started:"}
...
{"t":"result","verb":"status","ok":true,"exitCode":0,"value":{"version":"0.14.0","teams":[]}}
```

An `install` whose tool grants are declined:

```
> {"t":"ask","id":"q1","kind":"confirm","question":"Approve these tools for tdd?"}
< {"t":"answer","id":"q1","value":false}
> {"t":"result","verb":"install","ok":false,"exitCode":1,"error":"Consent was declined for tdd.","declined":true}
```

A second-team binding refused before any side effect:

```json
{"t":"result","verb":"setup","ok":false,"exitCode":1,"error":"One team per machine: …","refused":true}
```

## Versioning

The current package reports version `0.15.0`, protocol `1`. The re-recorded 0.14.0
hello lines under `.planning/codex-runs/*/frames/` precede B5's three skill verbs;
`src/lib/frames.ts` now advertises this complete verb list:

```json
["skill move","skill rename","skill delete","skill fix","project add","project remove","project list","login","setup","team create","team join","team remove","team leave","team move","team workflow-update","team project create","invite","ls","status","publish","validate","eval","eval-report","install","uninstall-skill","uninstall","sync","prune","search","update","app","profile","app-update","serve"]
```

`team migrate` is registered but terminal-only: under `--frames` it fails before doing any work and tells the
caller to run it from a terminal (D24). The refresh feature is true, but there is no standalone refresh
command: use `sync`. Neither belongs in the advertised verb list.

`hello.features` names `libraryProjects`, `projects`, `memberRole`, `localIdentity`, `roles`, `favorites`, `follow`, `lastSeen`, `installScope`, `inviteScoping`, `disablePerMachine`, `projectMembers`, `liftOnCards`, `runEvalInApp`, `perCase`, `progress`, `refresh`, `appUpdate`, and `serve`.

True: `libraryProjects`, `projects`, `memberRole`, `localIdentity`, `roles`, `installScope`,
`liftOnCards`, `runEvalInApp`, `progress`, `refresh`, `appUpdate`, `serve`.
False: `favorites`, `follow`, `lastSeen`, `inviteScoping`, `disablePerMachine`, `projectMembers`, `perCase`.

`libraryProjects` is the explicit local registry (`project add`, `project remove`, `project list`);
`projects` is team grouping (`team project create`). `memberRole` is the owner-written job label;
`roles` supports GitHub Admin/Member permissions from `status --permissions` (otherwise unknown).
`installScope` supports destinations and destination-aware removal. `appUpdate` and `serve`
advertise their respective verbs. Read feature values rather than assuming a control is available.

`localIdentity` covers `skillId` on local rows and rejected entries, and `placed` on rows.
Local inventory is a scan of Global and explicitly registered project roots; it reads no clone.
Team `ls` includes `people` with automatic `installed` records and curated `profile` entries.

Each team skill's `latestVersion` is its highest `v<N>` folder; `versionCount` counts versions.
The `receipt` limb contains one receipt's display facts — `{ run_id, verdict, execution_status,
expected_rows, scored_rows, comparisons, arm_scores, provenance: { model, k, cc_version, timestamp,
runner_handle } }` — or null. `comparisons` and `arm_scores` retain the receipt's own records.
The reader tries versions in descending numeric order, taking each version's newest receipt;
an invalid or misfiled newest receipt is reported and that version is skipped. `evalVersion`
identifies the selected version and `latestEvalState` is `ok`, `none`, or `invalid` for the latest
version. An older receipt must be labelled as such, including when the latest is unreadable.
Render runner/model/k/time provenance with the score; do not combine receipts or rank by their numbers.

`detail` on asks is optional and additive; protocol remains 1. Install's grant and replacement
questions, and removal inventories, carry the information needed to answer in that field.
Sync has no consent question and does not place skills.

### Install, publish, and Library writes

`install <ref> [--into global|<project root>]` installs the highest numbered version in the clone,
including its eval assets. `install member <handle>` and `install project <name>` use the same
placement path for a list. Version-suffixed skill refs are refused. An unregistered project path
is refused with a `project add` hint; install never registers a root itself.

Without `--into`, frames are interactive: the CLI emits a `select` ask named `Install to`, even
when Global is the only choice. Choices are `Global (~/.claude/skills)` and each registered
`<label> · <root>`. Global is the default unless a team project's remotes match exactly one local
project, which becomes the default; multiple matches offer no default. An explicit destination
skips this ask. A noninteractive terminal invocation defaults to Global only with no registered projects.

After any tool-grant consent, a collision emits this ask (paths and Version N come from the run):

```json
{"t":"ask","id":"q2","kind":"confirm","question":"Replace it with Version 4?","detail":["You already have a skill named deploy-check.","Your copy is kept at /work/web/.claude/old-skills/deploy-check."]}
```

Only an affirmative answer moves the existing folder to old-skills and places the new copy.
A pre-existing kept copy causes a refusal; it is never overwritten. Old-skills is a sibling of
the targeted skills root, is excluded locally for a project, and is neither scanned nor pruned.
The optional profile confirm follows placement and the install-record write; `--yes-profile`
pre-answers only that offer. Install seeds receipts under their own `content_digest`, preserving
runner attribution. A receipt lacking a digest is skipped with `Skipped <runId>: no content digest (pre-migration receipt).`
Pending intent may already exist when replacement is declined; retry the matching install to drain it.
The result is an array of `{ id, team, path, version, profiled }`.

`publish <ref> [--project <name>] [--category <name>]` resolves a local Library folder, checks
injected frontmatter, writes it back locally, and publishes directly to main as an immutable version.
Identical bytes reuse the existing version and can still attach receipts or add project membership.
A local FAIL receipt can trigger a confirm; multiple projects without `--project` trigger a
`Which project?` select defaulting to Global. There is no unconditional publish confirmation.
The profile offer follows the team write. A failed team write can leave injected local frontmatter;
a failed profile offer does not undo publication.

Category precedence is declared frontmatter, `--category`, model suggestion, then `misc`.
A declared category makes no model call and emits no line. Otherwise a `print` frame precedes
any subsequent question and write, with exactly one of:

```text
metadata.terum-category: X (from --category; edit SKILL.md any time)
metadata.terum-category: X (suggested from your SKILL.md; edit any time)
metadata.terum-category: misc (couldn't reach the model; edit SKILL.md any time)
```

Off-list categories produce an HYG7 warning at publish. Eval and validate do not supply a category
list. The publish result is `{ team, id, name, project, version, created, identicalTo, attachedEvals,
profileAdded, projectAdded }`; `version` is null on identical content and `identicalTo` names that version.

`skill move <path> --to global|<project root>`, `skill rename <path> --to <new-name>`, and
`skill delete <path>` are one-shot frame writes. Their `text` ask is `Type <name> to <operation> this folder`.
They require a direct child of a Library root and refuse symlinks. Move preserves local bytes;
a destination collision is kept in that root's old-skills (an existing backup refuses). Rename
rewrites readable frontmatter to match the new folder name; publishing under a new name starts
a new lineage. Delete removes an unmodified placement outright, quarantines an edited placement,
and quarantines a folder not tracked as a placement. Placement deletion also updates install records.
The result is `{ kind, path, destination, quarantined, installed, notices }`.

`skill fix <path>` is a one-shot frame write with no ask. It applies every repair whose outcome is
fixed by an authority other than the author's typing: quoting a bare frontmatter value that holds `: `
(the `ls --local` `invalid-yaml` reason), setting `name` to the folder name, setting `license` to the
team policy, removing HYG2's invisible characters, and clearing an executable mode on a non-script.
It then runs the same inspection and hygiene gate as `ls --local` and `validate` and prints what still
needs a person under `Still needs you (N):`. When it repaired nothing and findings remain, the run
fails with that list; when nothing remains it says hygiene passes. The result is the same
`{ kind: 'fix', path, destination: null, quarantined: null, installed, notices }` shape as the other
three, and `validate`'s result carries `repairable`, the count of changes `skill fix` would make.

`prune` lists quarantine paths and asks `Delete <n> quarantined item(s)?`; empty quarantine asks
nothing. Its result is `{ deleted, declined }`. It does not clean old-skills.

Neither `skill` nor `project` is in `SERVE_READ_VERBS`: serve gates on the first argv token, so
even `project list` needs its own process. The six accepted read verbs are unchanged.

## What `status` reports about this machine

`status`'s result carries two architecture fields, on success and on a failing read alike:

- `hostArch` — the CPU this machine actually has.
- `processArch` — the architecture of the Node process running the CLI, i.e. `process.arch`.

They differ only under emulation. A `processArch` of `x64` with a `hostArch` of `arm64` means an x64 build
of Node is running on an ARM64 machine through Windows emulation, so the CLI, the desktop app it installs,
and every child that app spawns all pay the emulation tax. A shell should surface that rather than hide it.
Off Windows the two are always equal and the environment is not read. On Windows three signals are read, in
this order: `PROCESSOR_ARCHITEW6432` (set by WOW64 inside a 32-bit emulated process, and trusted first), then a
`PROCESSOR_ARCHITECTURE` of `ARM64` or a `PROCESSOR_IDENTIFIER` that starts with `ARM`, either of which names
an ARM64 machine. The last two exist because Prism, the x64-on-ARM64 emulator, sets no
`PROCESSOR_ARCHITEW6432` at all: an x64 Node there sees `PROCESSOR_ARCHITECTURE=AMD64` and only the identifier
(`ARMv8 (64-bit) Family 8 …, Qualcomm …`) still names the silicon; until this was read, such a machine was
served the x64 installer on every download. Both fields are plain strings and an unrecognised value passes
through unchanged, so never switch on them exhaustively.

`app` reports the same condition as `emulation`, either `"win32-arm64-on-x64"` or `null`, and prints one
line telling the person to install the ARM64 build of Node. It still installs the app: this is a warning,
not a refusal.

These are additive result fields; protocol stays 1.

## Verbs added for the desktop app

`eval-report <skill> [--team <team>]` is read-only: it reads the local clone and this machine's run tree without fetching, networking, or prompting. `result.value` is an `EvalReport`:

- `skill: { id, name }` and `versions: { placed, teamCurrent, evaluated }`; versions are `v<N>` strings or null.
- `latest`: the newest committed receipt for `teamCurrent`, verbatim with an absolute `path`, or null; `latestState` is `ok`, `none`, or `invalid`. When the current version has no receipt, history can supply one and `fallbackFrom` names its version. An invalid newest receipt produces a warning and blocks this report’s fallback, unlike the team-list card reader.
- `history`: schema-valid committed receipts across version directories, sorted by numeric version descending, then `run_id` descending, as `{ version, run_id, verdict, execution_status, model, cc_version, runner_handle, timestamp, comparison, committed: true }` rows. `runner_handle` and `timestamp` come verbatim from provenance; `comparison` is the receipt's `candidate-vs-baseline` comparison (`win`, `loss`, `tie`, `net_lift`, `sign_p`), or null.
- `localRuns`: merged from the current local folder’s digest-keyed store and legacy per-team run trees; only directories containing `run.jsonl` are included, newest first, as `{ run_id, run_dir, execution_status, committed, receipt }` rows. `run_dir` is absolute; `receipt` is the schema-valid local `receipt.json` with an absolute `path`, or null. Status comes from that receipt or is `unknown`; `committed` indicates a matching run ID in history. No statistics are derived from the log.

`sync [--team <team>]` fetches and resets the disposable clone under its writer lock and records
a fetch stamp. It neither places skills nor replays pending work. See `f-sync` for the result
shape and per-team failures. Over frames it emits hello and result; there is no separate refresh verb.

`project add [path]` · `project remove <path>` · `project list` are the Library's local project registry. `add` asks `Which folder?` as a `path` ask when no argument is given (default: the nearest git repository above the cwd) and returns `{ path, label, added }`; `remove` returns `{ path, placementsRemaining }` and forgets the path only — nothing on disk changes; `list` returns `{ projects: { path, label, rootState, skillFolders }[] }`. A project is added only by an explicit act: no verb registers one as a side effect, and `install --into <path>` refuses a path that is not already a project rather than adding it.

### App updates

`app-update --check` (the default) reads the cached release advertisement and local staged/installed versions, and keeps that advertisement fresh by itself: when the last probe is missing or a day old it probes release tags under the same GitHub-team policy and 10 s deadline as `update` (`probe: 'ok' | 'failed'`, at most once a day), otherwise it serves the cache (`probe: 'cached'`, or `'failed'` while the day's attempt failed). `--check --force` probes regardless of the cap. A check never touches the app or the CLI; its only write is the CLI's own release state in `run/latest-version.json` (the advertisement, the attempt, and the running observation every `sync` used to record). Checks always succeed, reporting probe failures as data. Until 0.15.0 the check was read-only and the advertisement was filled by the old sync; after the fetch-only sync collapse (§10) nothing on the app's path probed, so the app could never learn about a newer version by itself — the check owns the probe now.

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

The desktop checks once at launch; that check refreshes the advertisement at most once a day (App updates above) and displays the advertised version in its top-bar update chip. Settings ▸ Updates uses `updates:app:policy`: `ask` (manual download/install), `on-close` (the default), or `overnight` (01:00–05:00 local after 30 idle minutes). The old boolean migrates once: false → ask, true → on-close. Successful install markers display “Updated to {version}”, adding “when you quit” or “overnight”; `updates:app:lastShown` acknowledges the marker across launches while the current session retains it. Failure markers remain visible.

Native-command amendment: `app_update_on_close({ version: string | null })` arms or disarms one detached installer. This additional command is necessary because the installer must outlive the WebView. The base actually has six commands including `quit`, so this is its seventh (the original decision's “five” count predates `quit`). On the last window's CloseRequested or ExitRequested, the shell consumes the arm once and invokes the recorded Node/CLI with `app-update --apply-now --release <version> --reason on-close`, plus `--await-pid <shell-pid>` to preserve the CLI's Windows wait. It uses a new process group on macOS and CREATE_NO_WINDOW | DETACHED_PROCESS on Windows and stays outside the bridge's child cleanup. The command follows the existing application-command registration, without a separate app ACL permission. Before spawning, the shell writes a waiting marker; a spawn failure replaces it with a failed marker. A child that dies before executing the CLI leaves the waiting marker visible as an unfinished install on the next launch. An unwritable marker is logged without preventing close. A manual or overnight handoff first disarms the close action to prevent two installers; a failed handoff restores the previous arm unless the policy changed in the meantime.

Update diagnostics are kept for the session by concern, so successful arming cannot erase a download or install failure. A failed preference flush is reported without disabling the hydrated policy. A cosmetic acknowledgement write cannot turn a successful check into a failure; the desktop DTO can carry `acknowledgementError` alongside that successful observation. The install reason has one desktop DTO home, `AppUpdateStatus.reason`, mapped from the wire marker.

The shared overnight hook resets idleness before handling activity. A timer more than one minute late is conservatively treated as a wake from suspension and requires another full idle period. Activity updates the idle timestamp without rescheduling on every pointer movement; the pending timer checks that timestamp before firing. Invalid clock readings are reported and retried with one pending timer. The chip carries a consumed `focus=app` navigation intent, so ordinary visits to Settings do not move keyboard focus.

### f-wizard

`eval --queue-list` returns `{ items }`, where each item has `skill`, `path`, `contentHash`, `requestedAt`, optional `team`,
`window: "overnight" | "later"`, and an optional `lastError`. `eval --dequeue <team>/<skill>` removes all queued
items of that team/skill and returns `{ items }` with the remaining queue. A bare skill selector is also accepted. Missing queue state is empty;
invalid legacy items are dropped with a notice, while malformed or unreadable queue files fail without replacement.

`eval --drain [--parallel n] [--window overnight] [--max n]` returns `{ items, attempted, completed, failures }`.
`failures` contains `{ item, error }` entries. A failure returns `ok:false` with that partial value, retains the
item with `lastError`, and continues siblings up to the positive-integer attempt limit. The bounded pool defaults to four concurrent evals. A successful eval result removes its queue item, including a successful result reporting partial
or failed execution. Changed queued bytes fail without paid work and remain queued with an error. An existing local receipt for
the queued digest satisfies the item before paid work. A failing result retains the item with its error.
Generation only fills missing local assets and prints its disclosure before writing.
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
### f-sync
`sync` fetches each configured team clone and hard-resets it to `origin/main`, one team at a time,
under the clone lock. **Nothing on this machine is changed by it: no placement, no upload, no edit to
a local skill.** It never repairs and never re-clones — a clone that is missing or foreign is reported
as `no-clone` and skipped — because it runs unattended.

The result is `{ changed, teams, notices }`. Each attempted team reports `team`, its own `changed`,
the `head` it ended on (or null when HEAD could not be read), a
`state` of `refreshed` | `busy` | `unreachable` | `no-clone` | `error`, and a `detail` line for any
state other than `refreshed`. Top-level `changed` is true when any team moved; a tracked tree that was
dirty and got reset counts as moved, because the read verbs now see something different.

A successful fetch writes a JSON `{head, at}` stamp, which means *this clone was fetched at this time*
— never *these skills were reconciled*. A team whose HEAD could not be read is deliberately left
unstamped. A fetch that outruns the deadline is killed, so a background
caller never wedges, and Git terminal prompts are disabled for the whole run.

`--hook` is the session-start entry and must never be driven over frames (rule 2). It is also the one
carve-out from "nothing on this machine is changed": it may replace Terum's own bundled
`/terum-skills` manual when that copy is outdated, and nothing else.

Work recorded in `pending` is drained by re-running the matching `install` or `uninstall-skill`, never
by `sync`.
