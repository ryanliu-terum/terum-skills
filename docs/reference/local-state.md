# Local state

Everything terum-skills writes on your machine, who writes it, and what survives removal.

There are three places: its own state root at `~/.terum/skills`, a small number of Claude Code files under `~/.claude` and inside your project checkouts, and the desktop app. The only other thing it writes is a lock or scratch directory in the system temporary directory, described below.

On Windows, `~` is `%USERPROFILE%`, so the state root is `%USERPROFILE%\.terum\skills` and Claude Code's settings file is `%USERPROFILE%\.claude\settings.json`. The desktop app is the one thing whose location genuinely differs, and it is called out below.

## The state root

```
~/.terum/skills/
├── config.json                        the only file that names your teams, identity and placements
├── config.json.lock/                  held while config.json is being rewritten
├── teams/
│   ├── <team>/                        a full git clone of the team repository
│   └── .<team>.safewrite.lock/        held while that clone is fetched, written or pushed
├── run/                               machine-local mutable state
│   ├── <team>.stamp                   when this clone last fetched cleanly
│   ├── <team>.lock                    the teardown mutex for that team (team leave, uninstall)
│   ├── <team>.lock.stale-<uuid>       a reclaim killed mid-move; swept later
│   ├── <team>.successors.json         cached "where did this repository go" lookup
│   ├── eval-queue.json                evals queued for overnight or later
│   ├── eval-queue.json.state.lock/    held while the queue file is rewritten
│   ├── eval-queue.json.drain.lock/    held for the whole of a drain
│   ├── usage-events.jsonl             the append-only skill-firing archive
│   ├── app.json                       how the desktop app starts this CLI
│   ├── latest-version.json            the release-advertisement cache
│   ├── latest-version.json.lock/      held while that cache is rewritten
│   ├── app-update.json                the last desktop app install attempt
│   ├── edit-hints/                    one file per Claude Code session the edit hook spoke in
│   └── skill-files/                   crash-recovery journals for skill move/copy/rename/delete
├── evals/
│   └── local/<digest>/<runId>/        one eval run: receipt, rows, transcripts, sandboxes
├── hooks/
│   └── terum-skills-edit.mjs          the PostToolUse edit hook script
├── app/
│   ├── <version>/installed.json       what was installed, and when
│   ├── <version>/staged.json          what was downloaded but not installed
│   └── .download-*/                   in-progress downloads; swept after an hour
├── quarantine/
│   └── <ISO stamp>/<name>             folders moved aside instead of deleted
├── backups/
│   ├── settings.<ISO stamp>.json      one copy of ~/.claude/settings.json, taken once ever
│   └── uninstall.<ISO stamp>.json     your config as it was at machine uninstall
└── cache/                             legacy; nothing writes it any more
```

The directories terum-skills creates under the state root are 0700 and the JSON files it writes there are 0600; inside a team clone, git's own umask applies. The helper most of those directories go through refuses a path that is a symbolic link, is not a directory, or is owned by another user. It also tightens a pre-existing directory whose mode is looser. On Windows the mode work is skipped, because Windows synthesizes mode bits; the shape and owner checks still apply. Two things sit outside the rule, both under the 0700 root: the directory `install` creates to seed a committed receipt under `evals/local/`, and the files an eval run writes into its own run directory, which take your umask.

The root itself is created by the first command that needs it, not by installing the package.

### config.json

Written only by the configuration store, which reads, mutates and writes it under `config.json.lock` and replaces it atomically (temp file, fsync, rename) at mode 0600. It is deleted only by `uninstall`. Unknown keys are preserved. `login --set`, `project add` and `project remove` ask for a preserving write, which rewrites only the bytes of the values they change, so hand formatting survives there; every other write re-serializes the whole file.

The shape:

```json
{
  "teams": { "<team>": { "remote": "github.com/org/repo", "handle": "you" } },
  "approvals": { "<skill id>": { "grants": "<hash>", "approved_at": "2026-09-16" } },
  "pending": [ { "op": "install", "id": "<skill id>", "team": "<team>", "scope": { "kind": "global" }, "destination": { "kind": "global" }, "started": "<iso>" } ],
  "placements": { "<absolute path>": { "id": "<skill id>", "team": "<team>", "version": "v3", "scope": { "kind": "global" }, "placed_at": "2026-09-16", "fingerprint": "<hash>" } },
  "projects": [ { "root": "/abs/path", "label": "web", "added_at": "2026-09-16" } ],
  "app": { "choice": "opted-in", "at": "<iso>" },
  "default_handle": "you",
  "display_name": "Your Name",
  "email": "you@example.com",
  "github": "yourlogin"
}
```

`teams`, `approvals`, `pending` and `placements` are always present. The rest are optional.

- `teams` is written only by `team create` and `team join`, always with the handle they proved against the roster. One remote maps to one team name and one name to one remote, checked again under the lock immediately before binding.
- `approvals` remembers a tool-grant consent by the hash of the skill's `allowed-tools`, so `install` does not ask again while the content is unchanged. `team leave` clears it when the last team goes.
- `pending` is an intent note written before a placement or removal and cleared after, so an interrupted run can be finished.
- `placements` is the authority for every path this tool may delete. A row exists only for a folder terum-skills copied from a team version, and only directly under a `.claude/skills` root. `fingerprint` is what was on disk when it was placed, which is how a hand-edited copy is recognised later.
- `projects` is your library project registry, written only by `project add` and `project remove`. Labels are derived across the whole set, so adding one project can relabel another.
- `app` records that you ran `app`.
- The four identity fields are written by `login` and by `team create`/`team join`. `profile --name` writes `display_name` on its own.

Three migrations run on read: an old `checkouts: string[]` becomes `projects[]`, a 40-hex tree hash in a placement's `version` becomes `null` (meaning placed before versioning), and a team entry with no handle is dropped, as is a stale `token` field.

### teams/&lt;team&gt;/

A full git clone of the team repository, on branch `main`. `team join` clones it. `team create` builds it in a staging repository at `teams/<team>.bootstrap-<uuid>`, pushes it, and renames that into place, removing the staging copy if anything fails. A missing clone is restored only by re-running `setup` or `team join`. `sync` fetches the clone and hard-resets it to `origin/main`; it never repairs and never re-clones.

Two things are written into the clone's own git directory: `.git/hooks/pre-push` at mode 0700, which runs the hidden `guard-push` verb, and `core.hooksPath=.git/hooks`, set so a machine-wide hooks path cannot hide it. `team join` and `team migrate` re-arm both, so an interrupted arming is repaired by re-running.

The writer lock for one clone sits beside it rather than inside it, at `~/.terum/skills/teams/.<team>.safewrite.lock`. Every fetch, reset, commit and push takes it. A second process waits, then fails with `Another terum-skills operation holds the write lock on <team>; retry when it finishes.` rather than racing.

For what the repository itself contains, see [the team repository reference](team-repo.md).

### run/

Machine-local and mutable. Nothing here is shared, and nothing here is the source of truth for anything.

`<team>.stamp` is written by `sync` after a fetch that fully succeeded: `{"head":"<sha>","at":"<iso>"}` at 0600. It is the only thing that makes a session-hook run a fast no-op: a clone stamped within the last hour is reported fresh and left alone. `status` and `search` read its file timestamp for their staleness line. A stamp dated well into the future is not treated as evidence of a recent sync.

`<team>.lock` is the teardown mutex, created with an exclusive open at 0600, holding `{"pid","host","token","started"}`. `team leave` and `uninstall` take it while they tear a team down, and fail rather than wait when another holder has it. The session hook does not take it: `sync --hook` queues on the clone's writer lock above, and a run that cannot get that lock within four seconds reports `<team>: not refreshed (busy)` on stderr and exits 0. A lock is stale after ten minutes, or immediately when it names a dead process on this host, and is then reclaimed once. A reclaim that is killed mid-move can leave `<team>.lock.stale-<uuid>` behind; `team leave` and `uninstall` sweep those along with the stamp.

`<team>.successors.json` is the cached answer to "where did this repository go", written by `sync` when a GitHub remote answers "repository not found": `{"remote":"…","at":<ms>,"search":{…}}` at 0600, valid for ten minutes. A person at a terminal always gets a fresh lookup.

`eval-queue.json` holds evals you queued instead of running:

```json
{ "schema": 2, "items": [
  { "skill": "deploy", "path": "/abs/path", "contentHash": "sha256:…",
    "requestedAt": "<iso>", "window": "overnight", "team": "<team>", "lastError": "…" } ] }
```

An item is keyed on the bytes it was queued against, not on a version number, so editing the folder after queueing makes the drain refuse that item by name rather than evaluate something else. `team` is optional, because a folder belonging to no team is still evaluable. An item that fails the schema (every item queued before the current shape) is dropped on read, and the CLI says how many and which. Two locks guard it: `eval-queue.json.state.lock` for a rewrite and `eval-queue.json.drain.lock` for a whole drain, so enqueueing stays possible while a paid run is in flight.

`usage-events.jsonl` is written by `usage`, and by `usage` alone, as an append of whole lines. Each line has exactly four fields: `{"kind":"D1","skill":"deploy","ts":"<iso>","entrypoint":"cli"}`. The tuple is its own deduplication key, so no session id, file path or cursor is ever stored, and a rescan over transcripts already seen adds nothing. It is off the report's read path: deleting it changes no number today's default 30-day window prints. It exists only so a window reaching past Claude Code's transcript retention has anything to answer from.

`app.json` is written by `app`, at 0600: `{"schema":1,"node":"…","entry":"…","path":"<PATH>","version":"…","writtenAt":"<iso>","target":"…","intent":"setup"}`. It is how the desktop app finds Node and this CLI on every launch, which is why reopening the app from the Dock a week later still works. Run `app` once on a machine or the app has nothing to drive.

`latest-version.json` is the release-advertisement cache, written under its own lock at 0600:

```json
{ "schema": 1, "package": "terum-skills", "upstream": "…",
  "running": { "version": "…", "at": "<iso>", "entry": "…" },
  "registry": { "version": "…", "at": "<iso>", "source": "npx-latest-cache", "entry": "…" },
  "advertisement": { "version": "…", "at": "<iso>", "source": "git-tags" },
  "attempt": { "at": "<iso>", "ok": true, "error": null },
  "ack": { "version": "…", "at": "<iso>" } }
```

State that is corrupt, or that names a different upstream, is invisible to readers and is never overwritten, so you can delete this file but the CLI will not silently replace one it does not recognise.

`app-update.json` records the last desktop app install attempt: `{"schema":1,"version":"…","phase":"waiting|installing|launched|failed","at":"<iso>","error":null,"reason":"on-close|overnight|manual"}`.

`edit-hints/<base64url session id>.json` is written by the edit hook script, not by the CLI, and holds `{"1":["<skill folder>", …]}` at 0600. It is how the hook says a thing once per skill per session. Files older than seven days are swept on the next write.

`skill-files/<sha256>.json` is the crash-recovery journal for `skill move`, `skill copy`, `skill rename` and `skill delete`. It records the source, destination, ledger row, fingerprint, any kept copy, and whether the operation finished, so an interrupted run resumes on the folder the first run resolved rather than the names you typed.

### evals/

`evals/local/<content digest>/<run id>/` is one eval run, keyed on the digest of the skill folder's bytes rather than on a team or a version, which is what lets a skill belonging to no team be evaluated at all. A run directory holds:

- `receipt.json`, the run's verdict, comparisons, arm scores and provenance
- `run.jsonl`, one `_meta` line then one line per comparison, arm sample and trigger block
- `transcripts/`, the agent transcripts
- `sandboxes/`, the scratch directories the arms ran in
- `generated/` with `cases/` and `triggers.yaml`, when that run generated the eval assets, kept as the run's own copy of what it wrote into your skill folder

The run id is a UTC timestamp, so lexicographic order is chronological.

`install` also seeds this tree: for each receipt the team has committed for the version it has placed, it copies the file to `evals/local/<digest>/<runId>/receipt.json`. A receipt this client cannot read, or one written before content digests existed, is skipped with a printed line rather than aborting the install.

An older layout, `evals/<team>/<skill id>/<run id>/`, is still read by `eval-report` and merged into its local-runs list. Nothing writes it any more, and nothing migrates it.

### hooks/

`hooks/terum-skills-edit.mjs` is the PostToolUse edit-hook script, written at 0600 by an atomic temp-and-rename. It begins with the marker `// terum-skills managed hook`; anything at that path without it is left alone and named as foreign. The copy shipped inside the package is the source, and `sync --hook` rewrites this file when it is an outdated copy of the CLI's own, never when it is absent (which means you declined it) and never when it is foreign.

The script itself reads the hook payload on stdin, returns immediately unless the edited path is strictly inside a folder under a `.claude/skills` directory, reads `config.json` and returns if terum-skills has no team here, deduplicates through `run/edit-hints/`, and writes an `additionalContext` note naming the skill, whether it is an installed placement of a team version, and the `publish` and `eval` commands. It imports nothing from the package and makes no network call, and any failure is silence.

### app/

`app/<version>/installed.json` is `{"schema":1,"version":"…","platform":"…","bundle":"…","installedAt":"<iso>"}`, and `app/<version>/staged.json` is the same with `stagedAt` in place of `installedAt`, plus `installer` (the Windows setup file, `null` on macOS). The whole staging directory is renamed into place in one move, so `<version>/` only ever exists complete. `app/.download-*` directories are in-progress downloads; any older than an hour is swept on the next run. `app-update --apply-now` prunes old version directories, keeping the newest two plus the version it installed plus the CLI's own.

These are records. The application itself lives outside the state root.

### quarantine/

`quarantine/<ISO stamp>/<name>` is where terum-skills puts a folder instead of deleting it. Three things land here:

- a placed copy whose bytes no longer match its ledger fingerprint, when `uninstall-skill`, `skill delete`, `team leave` or `uninstall` removes it
- a folder deleted with `skill delete` that was not a recorded placement
- a team clone holding uncommitted or unpushed work at `team leave` or `uninstall`, as `quarantine/<stamp>/teams-<team>`

`prune` is the only command that empties it.

### backups/

`backups/settings.<ISO stamp>.json` is one verbatim copy of `~/.claude/settings.json`, taken once ever, immediately before the first time terum-skills writes to that file. If any `settings.*.json` already exists here, no further backup is taken.

`backups/uninstall.<ISO stamp>.json` is the whole of `config.json` as it was, written by `uninstall` before it removes anything.

Both are 0600. Neither is ever removed by terum-skills.

### cache/

A legacy directory. Nothing writes it. `team leave` and `uninstall` remove `cache/<team>` and the directory itself, which is the only reason it is still named anywhere.

### Locks outside the state root

One more lock lives in the system temporary directory, because it protects a destination folder that may be anywhere: `<tmpdir>/terum-skills-target-locks-<uid>/<sha256 of the target path>.lock`. Every local lifecycle mutation for one skill destination takes it, it goes stale after a minute, and the directory is forced to 0700 and refused if another user owns it. An eval also uses that directory twice: `terum-evals-preflight-*` for the preflight agent run, and `terum-eval-gen-*` while it generates execution cases, which it removes when the generation finishes.

## Claude Code files

These are the only files terum-skills writes outside its own state root. Setup offers the two hook entries and the `/terum-skills` skill separately, each with its own question, and each can be declined.

### ~/.claude/settings.json

Two entries, each added only if you say yes. Under `hooks.SessionStart`:

```json
{
  "matcher": "startup",
  "hooks": [
    { "type": "command", "command": "npx -y terum-skills@latest sync --hook", "async": true, "timeout": 60 }
  ]
}
```

Under `hooks.PostToolUse`:

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    { "type": "command", "command": "node \"<home>/.terum/skills/hooks/terum-skills-edit.mjs\"", "timeout": 10 }
  ]
}
```

The session hook is `async` because a fetch must not hold up your session. The edit hook is not, because its reminder has to reach the model's next turn, and its first act is a path test that costs nothing.

Writes to this file are atomic (temp file, fsync, rename), at 0600, preserving the original file's mode, and are preceded by the one-time backup described above. Re-installing strips every existing terum-skills command from the file first, so there is never a duplicate; a hook group holding other people's commands as well keeps those commands and loses only ours.

terum-skills refuses to edit this file at all when it is not valid JSON, or when `hooks`, `hooks.SessionStart` or `hooks.PostToolUse` is the wrong shape. The message is `Cannot edit <path>: it is not valid JSON. Fix it by hand or move it aside, then re-run.`

This file also holds `skillOverrides` for Global skills. See below.

### ~/.claude/skills/terum-skills/

The `/terum-skills` Claude Code skill, a single `SKILL.md` copied byte for byte from the package. Its managed marker is two fields in its own frontmatter: `name: terum-skills` and `metadata.managed-by: terum-skills`. Anything else at that path, including a symbolic link, a file, a folder with no `SKILL.md`, or a different skill, is judged foreign: it is named and never written to or removed.

It tells Claude Code how to run terum-skills on your behalf: that the Bash tool has no TTY, to invoke the CLI as `npx -y terum-skills@latest <verb>`, which verbs it may run in-session, which verbs it must hand to your terminal because they ask questions, and what an eval costs.

A copy of terum-skills' own that this CLI has moved past is refreshed without a second question, both by `setup` and by `sync --hook` at every session start. A copy that is absent is never installed by anything but `setup`, because absent means you said no.

The discovery scan also refuses this folder by name, so it can never be published as a team skill.

### Placed skill folders

An installed skill is an ordinary folder. Global placements go to `~/.claude/skills/<name>`; project placements go to `<checkout>/.claude/skills/<name>`. The folder is staged in a sibling directory and renamed into place, so a partial folder is never visible.

For a project placement, `install` appends `.claude/skills/<name>` to that checkout's `.git/info/exclude`, so the copy does not show up as an untracked change in your repository.

terum-skills will only remove a folder that has a `placements` row in `config.json` and sits directly under a `.claude/skills` root. Anything else is refused by construction.

### &lt;root-parent&gt;/old-skills/&lt;name&gt;

When something would displace a folder you already have, the old folder is kept rather than overwritten. The keep path is `old-skills` beside the skills root: `~/.claude/old-skills/<name>` for Global, `<checkout>/.claude/old-skills/<name>` for a project. Two commands use it, `install` when you accept `Replace it with Version <N>?` and `skill move`/`skill copy` when the destination is occupied. Both refuse outright when that keep path already exists, so a second run cannot overwrite the first run's rescue. Both add `.claude/old-skills/` to the checkout's `.git/info/exclude`.

Nothing ever cleans `old-skills` up. It is yours to delete.

### skillOverrides

Enabled and disabled are not terum-skills concepts. They are Claude Code's own `skillOverrides` setting, the same key the `/skills` menu writes, which maps a skill name to `on`, `name-only`, `user-invocable-only` or `off`. terum-skills reads that key and writes exactly one value into it, `off`, and keeps no state of its own, so the app's switch and Claude's menu cannot disagree. A `name-only` or `user-invocable-only` set by hand reads as enabled and is never removed.

Which file a change goes to follows Claude Code's own precedence. A Global folder is governed by `~/.claude/settings.json` alone. A folder in a project checkout is read from user, then `<checkout>/.claude/settings.json`, then `<checkout>/.claude/settings.local.json`, and written to the last of those, which is where the `/skills` menu saves too:

```json
{ "skillOverrides": { "deploy": "off" } }
```

When terum-skills creates `<checkout>/.claude/settings.local.json` for the first time, it appends `.claude/settings.local.json` to that checkout's `.git/info/exclude`. A checkout without git keeps the setting and is told why the exclude was skipped.

`skill disable` writes the entry, `skill enable` removes it, `skill move` and `skill rename` carry it to the new path, and `skill delete` and `uninstall-skill` clear it so a folder written again under that name is not born disabled.

## The desktop app

The application is installed outside the state root, in the place the platform expects.

On macOS it is `~/Applications/Terum Skills.app`. The path is fixed so a Dock pin survives updates: an update renames the existing bundle aside, moves the new one in, and removes the aside last, so a failure in the middle puts the old bundle back.

On Windows it is a per-user install under `%LOCALAPPDATA%\Terum Skills`, from an NSIS installer run with `/S`, which needs no elevation. The executable is `%LOCALAPPDATA%\Terum Skills\terum-skills-desktop.exe`.

There is no Linux or WSL build. `app` says so and exits 0.

The app keeps its own preferences (theme, layout, and its update policy) in `preferences.json` in the config directory the OS gives an application with the bundle identifier `com.terum.skills`. Tauri resolves that to `~/Library/Application Support/com.terum.skills` on macOS and `%APPDATA%\com.terum.skills` on Windows. terum-skills never reads or writes that file, and `uninstall` says out loud that it was not touched.

The app needs `~/.terum/skills/run/app.json` to drive the CLI. Run `app` once on a machine and it is written.

## What uninstall removes, and what it keeps

`uninstall` asks once, with a full inventory as the detail of the question, and then works through it in order.

It removes:

- the SessionStart hook entry from `~/.claude/settings.json`
- `~/.claude/skills/terum-skills/`, but only a copy carrying the managed marker
- the PostToolUse entry and then `~/.terum/skills/hooks/terum-skills-edit.mjs`, in that order, so an entry never names a deleted script
- every configured team, one at a time: every placed skill folder, the clone, `cache/<team>`, that team's run artifacts, and its `config.json` entry
- `~/.terum/skills/config.json`
- `~/.terum/skills/run/app.json` and `~/.terum/skills/run/latest-version.json`
- `~/Applications/Terum Skills.app`, on macOS only
- `~/.terum/skills/app/` and everything in it, then `run/`, `cache/`, `teams/`, `quarantine/` and the root itself, each with a plain directory removal

That last step is the one to understand. Those four directories and the root are removed with `rmdir`, not a recursive delete, so any of them that still holds something is kept and reported as `Kept <path> (not empty).`, or, for the quarantine, as `Kept <path> (N items).` Because `backups/` is always kept, `~/.terum/skills` itself always survives an uninstall. The root is the one path whose non-emptiness is passed over without a line of its own.

It keeps, always:

- `~/.terum/skills/backups/`, including the settings backup and the record of this uninstall
- `~/.terum/skills/evals/`, every local eval run and transcript
- `~/.terum/skills/quarantine/`, whenever it holds anything. An empty quarantine directory is removed.
- `~/.terum/skills/run/`, whenever anything is left in it. In practice that means `usage-events.jsonl`, `eval-queue.json`, `edit-hints/`, `skill-files/`, `<team>.successors.json` and `app-update.json` all survive an uninstall, including the archive of which skills fired on this machine.
- `~/.terum/skills/hooks/`, which is removed only when the edit-hook script was ours to delete and nothing else is in it
- anything at the wrapper or edit-hook path that is not ours. It is named in the inventory as "left alone".
- your membership and installed-skill records in the team repository. Rejoining does not place skills again; `install member <handle>` does.
- the npm package. The last lines of the run tell you the command for the way this copy was installed.
- on Windows, the desktop app: `The desktop app under %LOCALAPPDATA%\Terum Skills stays installed; remove it from Windows Settings ▸ Apps. Only its download record under <root>\app was removed.`
- the desktop app's own preferences, on every platform.

If the config file is kept because something is still configured, the run fails and says what: `Kept <path>: still configured — teams: …`.

## What team leave removes

`team leave <name>` is the single-team version of the same teardown, and it never touches the team repository.

It removes every skill folder placed from that team (quarantining any whose bytes have drifted), the clone (quarantining it instead if it holds uncommitted or unpushed work), `cache/<team>`, that team's `run/` stamp and stale-lock leftovers, and the team's entry and pending operations in `config.json`. When it was the last team on the machine it also clears `approvals` and removes the session hook.

It does not remove: the `/terum-skills` Claude Code skill, the edit hook, the quarantine, the backups, the local eval runs, the usage archive, the eval queue, the desktop app, or anything in the team repository. Your membership stands until an admin runs `team remove <handle>`.
