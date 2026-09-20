---
name: terum-skills
description: "Drive the terum-skills CLI from a Claude Code or Codex session: run any verb with --format md and show its board — inspect the Library or the team Marketplace, search, fetch with sync, validate or fix a local skill, install the latest version into Global or an added project, publish a local skill as an immutable version, manage the eval queue — and prepare the verbs that belong in a terminal (project setup, skill move/copy/rename/delete, prune, reconcile, machine uninstall, team administration). Use when the user wants to manage, evaluate, publish or install skills and no narrower terum-skills skill fits."
metadata:
  managed-by: terum-skills
  short-description: "Run any terum-skills verb from a session"
---

Run one `terum-skills` verb on the user's behalf and show its board, or prepare the verb for a
terminal when the CLI would ask a question the session cannot answer. This is a thin wrapper: the
CLI is the product, the skill only decides *whether* to run it here and *how* to show the result.

**When the request maps to a named skill, use that skill's command instead**: list-skills (your
Library and the team Marketplace), skill-info (one skill in full, with its eval report), search-skills,
eval (with the cost confirmation), eval-report, skill-status (`status` then `update`), sync-skills.
Everything else is here.

This file ships inside the `terum-skills` npm package with those seven skills. Setup places them at
`~/.claude/skills/<name>/` for Claude Code and `~/.codex/skills/<name>/` for Codex; the
`metadata.managed-by` marker identifies Terum's copies. Setup refreshes them on a re-run, and
`sync --hook` refreshes or adds them in a root that already holds one, announcing
`Updated your terum-skills skills for this CLI.` A foreign folder at one of those names is left alone.
Each placed copy is written in this machine's command spelling — the bare binary of a global install,
or npx pinned to the version that placed it — so a session runs the copy the user installed, never the
registry's newest release.

Setup also offers a Write/Edit hook, separately and with its own y/N. Where the user accepted it, a
note beginning *"You edited <name>, a skill in this machine's terum-skills Library"* appears after an
edit inside a `.claude/skills/` folder, once per skill per session. It is this tool talking, not the
user: treat it as the reminder it is, finish what you were asked to do first, and then offer to run
the `publish` it names here. A skill edited and never published is a skill only that machine has.

Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS"). The command
path can have several tokens (`skill move`, `team project create`); pass the remaining arguments
unchanged. With no arguments, ask which verb, defaulting to `status`. Explain the tables below
briefly and ask for the user's intent before assembling flags.

## The one rule that shapes everything

Your shell tool has no TTY. The CLI refuses a question with
`Cannot ask "…": this command needs an interactive terminal (stdin is not a TTY).` and, under
`--format md`, shows that refusal as the board's failure block. A refusal does **not** prove nothing
happened: a verb may already have cloned, recorded intent, or completed a write before a later
question, and the completed work is listed in the board's **Notes**. Read the whole board before
reporting the outcome. So:

- Verbs that never ask run here (Table A).
- Verbs needing a human answer are prepared and handed to the user to run in a terminal (Table B).
- Verbs that ask only sometimes can run here; if the refusal appears, hand off with the board and
  any completed work clearly stated.

## Invocation

- Always `npx -y terum-skills@latest ls --format md`-shaped — exactly that spelling, a real verb, `--format md` last — for a runnable command.
  Never another spelling, a checkout entry, or the built entry point under `dist/`. `--format md` renders
  the result as a Markdown board; verbs without a board show their printed lines in a fenced block,
  which you show as is.
- Run from the current working directory; do not `cd`; use absolute path arguments. The Library
  reads Global and explicitly added project roots; the working directory does not add a project.
- An italic board line `_Resolved: …_` says which skill answered a prefix, a case-insensitive match,
  or a bare invocation from inside a skill folder; keep it. A failure naming several candidates
  (`Ambiguous skill name …`) is a result: show it and ask which one.
- Add `--rows all` when the user asks for every row of a capped table.
- This CLI has no standalone refresh command; `sync` fetches. `team migrate` exists but is
  terminal-only (Table B); do not invent any other migration invocation.

## Table A: verbs that run here

| Verb | Before running | After running |
|---|---|---|
| `status` | nothing | show the board; exit 0 means the query succeeded, not that setup is complete. Pending work needs the matching install or removal retried, not a fetch |
| `ls`, `ls --local`, `ls member <h>`, `ls project <n>`, `ls skill <name>` | nothing | show the board (the list-skills and skill-info skills exist for the common cases) |
| `project add <abs-path>`, `project remove <abs-path>`, `project list` | confirm with the user before adding or forgetting a root | show the board; removing a project leaves its files and placement ledger unchanged |
| `search <term> [--category <c>] [--author <a>] [--project <p>]` | nothing | show the board; `No skills found.` is a result |
| `skill fix <abs-path>` | confirm with the user, as for install: it rewrites the folder's SKILL.md | it applies the repairs with one right answer (quote a frontmatter value YAML refuses, `name` to the folder, `license` to team policy, strip invisible characters, clear an executable bit on a non-script) and prints `Still needs you` for the rest; show the fenced block |
| `skill category <abs-path> --to <name>` | confirm with the user: it rewrites the folder's category | show the board; it rewrites `metadata.terum-category` locally and publishes nothing, so the team keeps showing the category its newest version carries until the user runs the `publish` the output prints. Any name is accepted; an off-list one gets the same advisory warning `publish` gives |
| `validate <abs-path or name> [--cwd <team-root>]` | requires team policy from the configured clone or an explicit team root | show the board's findings verbatim. Validation does not inject managed fields; an unpublished folder may fail strict frontmatter checks. Publish injects its managed fields before checking; local eval permits those fields to be absent |
| `update` | nothing | show the board; the CLI never runs a package manager, and the command it prints is for the user's terminal |
| `app` | confirm download/install and opening the desktop app | show the fenced block |
| `app-update --check` | nothing | show cached advertisement and installed/staged state; `--force` on this check requests a release probe |
| `app-update --stage [--release <version>]`, `app-update --apply [--release <version>] [--reason manual]` | confirm download or installation; on macOS quit the running app before terminal apply | staging verifies the download; apply hands installation to a detached process |
| `sync` | say it fetches and resets each disposable team clone to `origin/main`; it never uploads, places, or edits the user's skill folders | show the board; disclose each team reported as not refreshed. Run it in the background when your shell tool can |
| `sync --hook` | do not run by hand; this is the SessionStart entry and refuses `--format` | stdout is the reload directive, notices go to stderr; only Terum's managed skills may be refreshed |
| `install <ref> [--into global\|<project root>]`, `install member <h> [--into global\|<project root>]`, `install project <n> [--into global\|<project root>]` | confirm the skill/list and destination: this places files and writes install records. Use an explicitly chosen `--into`; an unregistered project path refuses and needs `project add` first | installs the highest numbered version in the clone. A tool-grant question or replace question needs a terminal; report any completed work from the board's **Notes** before handing off |
| `publish <ref> [--project <p>] [--category <c>]` | confirm the local skill, the team when more than one is configured, and any `--project` or `--category` the user chose; say that it rewrites the folder's managed frontmatter and writes an immutable version to team main. Omit optional flags the user has not chosen | show the fenced block, including the version line and any category disclosure. Its only question is a confirm when the latest local eval of these exact bytes failed; without a TTY that refuses before the local write-back or the team write, so quote the refusal and hand the same command to a terminal |
| `invite <github-login…>` | confirm with the user: sends GitHub collaborator invitations | show the fenced block and the teammate join line |
| `profile [--name <display>] [--bio <text>] [--role <role>] [--project <name>]… [--remove <skill>]` | confirm the profile changes; project membership names team projects; `--remove` takes one skill off the profile list | show the fenced block |
| `login --set <key=value>` | confirm the identity change; keys are `name`, `email`, `default-handle`; repeat the flag for multiple fields | show the identity notice; published versions keep their recorded author |
| `team workflow-update --print` | nothing | show the workflow scaffold and its manual migration instruction; this does not migrate the team's skill layout |
| `eval <skill> [flags]` | use the eval skill: it confirms the cost first | the eval skill shows the board |
| `eval <skill> <skill>… [--batch <n>] [--parallel <n>]`, `eval --pending` | confirm the paid runs once for the whole batch: several skills run as one batch after one agent probe; `--pending` means every shared skill with no receipt for its current version; `--batch <n>` asks before each further batch (a question — hand it to a terminal, or run without `--batch`) | show the batch board (`Evaluated X of N`); a declined continuation queues the rest for later |
| `eval <skill…> --window overnight\|later`, `eval --pending --window overnight` | confirm queueing; nothing is paid for now | show the queued board; overnight items run in the desktop app between 01:00 and 05:00, later items wait for `eval --drain` |
| `eval-report <skill> [--team <team>]` | nothing | show the board: committed receipts and local run history for a skill in the team clone; no fetch |
| `eval --queue-list` | nothing | show the queue board |
| `eval --dequeue <skill>` | confirm removal from the queue | show the remaining items; a team-qualified selector is also accepted |
| `eval --drain [--parallel <n>] [--window overnight] [--max <n>]` | confirm paid runs, as the eval skill does | show the drain board's successes and failures; default parallelism is four |
| `uninstall-skill <ref> [--from global\|<project root>]` | confirm the removal; `member <h>` and `project <n>` selectors also exist | it asks once before removing, so expect the refusal block: hand the command over |
| `serve` | do not run as a one-shot command; it requires `--frames` and a request/answer client, and refuses `--format` | accepts only `status`, `ls`, `eval-report`, `search`, `validate`, `update`; every write uses its own process |

Interactive install always asks `Install to`, offering Global and every added project, even if
Global is the only choice. Without a TTY, omitting `--into` defaults to Global only when no
projects are registered; otherwise it refuses. Previous-version skill refs are refused.

If a destination already contains that name, install asks before keeping the existing folder
at the targeted root's sibling `.claude/old-skills/<name>` and placing the new version. A project
copy stays under that project. If the kept-copy path already exists, the command refuses; move
that backup elsewhere yourself before retrying. Neither the Library nor `prune` cleans old-skills.
Install seeds local eval receipts under each receipt's own content digest, preserving the runner's
attribution. A receipt without a digest is skipped with a notice. Install adds the skill to your
profile with no question, interactive or not; `profile --remove <name>` takes it off again.

Output handling for every verb in Table A:

- Show the board verbatim as the answer; do not re-summarise unless asked. Offer its **Next:** line.
- A **Notes** block holds the lines the board did not draw (problems, notices, completed work);
  show it. A failure block (`❌ …`) ends a failed verb; `(partial result above)` means the board
  above it is real work that stands.
- Quote stderr failures and explain them in one sentence. Hook notices also use stderr.
- Exit 1 is a failed operation, not a broken wrapper. Do not retry it automatically, and do not
  claim earlier steps were rolled back. Publish can succeed even if its later profile write fails.
- **The report's last line may be the next step; act on it.** When the evaluated bytes are not a
  published version, the run ends with either *To share these results, publish the skill again:*
  and the command, or — on a FAIL verdict — the same command with the reason not to use it yet.
  Publishing is Table A: after a PASS or NEUTRAL, offer to run that command here and run it once the
  user agrees. After the FAIL line, report the verdict and stop; running it would only reach the
  regression confirm, which needs a terminal.
- No update-notice tail appears when stderr has no TTY.

## Table B: verbs that are handed to the user

These workflows need a terminal answer, or can write before their first question. Prepare the
exact command without treating a real run as a dry run. Say plainly: *run this in a terminal;
the CLI will ask you questions the session cannot answer.*

| Verb | Free dry run first | Command to hand over |
|---|---|---|
| `project add` (no path) | none | `npx -y terum-skills@latest project add` — asks for a folder |
| `unpublish <skill> [--yes]` | none; confirm the skill and team with the user | `npx -y terum-skills@latest unpublish <skill>` — it asks the user to type the skill's name; use `--yes` only after an explicit confirmation |
| `skill move <abs-path> --to global\|<project root>` | none | `npx -y terum-skills@latest skill move <abs-path> --to <destination>` |
| `skill copy <abs-path> --to global\|<project root>` | none | `npx -y terum-skills@latest skill copy <abs-path> --to <destination>` — the source folder stays where it is |
| `skill rename <abs-path> --to <new-name>` | none | `npx -y terum-skills@latest skill rename <abs-path> --to <new-name>` |
| `skill delete <abs-path>` | none | `npx -y terum-skills@latest skill delete <abs-path>` |
| `skill disable <abs-path>` | none | `npx -y terum-skills@latest skill disable <abs-path>` — writes `off` for the folder's name into Claude Code's own `skillOverrides` setting (the same key the `/skills` menu writes); the folder stays where it is |
| `skill enable <abs-path>` | none | `npx -y terum-skills@latest skill enable <abs-path>` — removes that `off` and nothing else |
| `prune` | none; an empty quarantine simply returns | `npx -y terum-skills@latest prune` |
| `uninstall` | none | `npx -y terum-skills@latest uninstall` — machine teardown, preserving recovery data and printing the package-manager step |
| `team leave <name>`, `team remove <handle>` | none | the same command with the supported npx prefix |
| `team move <org>/<repo> [--from <team>] [--yes]` | none; one confirmation, then leave + join + re-place | `npx -y terum-skills@latest team move <org>/<repo>` — when a team's repository was recreated elsewhere (`sync` reports it and offers this) |
| `team project create [name] [--remote <url>]` | none | `npx -y terum-skills@latest team project create <name> --remote <url>` |
| `team project delete [name] [--yes]` | none; the CLI confirms and names what survives | `npx -y terum-skills@latest team project delete <name>` — removes the list only; its skills stay in the marketplace |
| `team migrate [--team <name>]` | none | `npx -y terum-skills@latest team migrate` — once per team, from a terminal, only after the release carrying the new CLI has reached every teammate (an un-upgraded teammate cannot read a migrated repo); refuses under `--frames` |
| `reconcile [--list]` | `--list` lists matches without asking or writing | `npx -y terum-skills@latest reconcile` — it asks before recording a Library folder as an installed team skill |
| `setup [target]`, `team create`, `team join <target>`, `login` | none; setup/join can clone before asking | `npx -y terum-skills@latest setup` / `setup <org>/<repo>` / `team create` / `team join <target>` / `login` with the same npx prefix |

Publish writes the local folder as an immutable `skills/<name>/v<N>/` version directly to team
main and attaches matching local eval receipts. That version IS the team's marketplace copy — a
publish needs no project and asks for none. Identical bytes reuse the existing version;
`--project <name>` additionally lists the skill under a team project. This is not a pull-request
workflow. Publish resolves category from the declared frontmatter first, then `--category`, then a
model suggestion, falling back to `misc`. A declared category makes no model call and prints no
category line. Otherwise the CLI discloses the source before writing. It writes managed frontmatter
back locally after its refusal-capable checks, then publishes, then records the skill on your profile
without asking — publishing is the endorsement (`profile --remove <name>` takes it back). A failed
team write can leave that frontmatter on disk. Do not treat publish as a dry run.

The `skill` folder operations require a direct child of Global or an added project's skills root.
Only `delete` asks you to type the folder's name; move, copy and rename ask nothing, because each
is undone by running the verb the other way and none overwrites anything. Move preserves local edits
and keeps a destination collision in old-skills. Rename changes the folder and readable frontmatter
name; that changes the invocation name, and publishing a new name starts a new lineage. Delete
quarantines an untracked folder or an edited placement, but removes an unmodified placement outright
(reinstall to restore it). Deleting a placement also removes its install bookkeeping. Uninstall leaves
the curated profile unchanged. `prune` permanently deletes confirmed quarantine contents only.

Unpublish removes every version, its eval assets and receipts, and drops the skill from project lists
and member profiles. Anyone in the team may unpublish any skill; there is no ownership check. The git
history is not rewritten, and installed copies keep working until each machine syncs, which then
reports the skill as removed from the team. Republishing starts again at Version 1 under a new id.

Whether your shell tool has a TTY is unverified; do not promise it. "A terminal" means a real terminal.

## Rules

- No TTY: never pipe `y`, never drive the CLI with `expect`, never add `--frames` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file `` !`command` `` injection; run every command with your shell tool and read its output.
- Do not `cd`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.

## Sandbox

When `CODEX_SANDBOX_NETWORK_DISABLED=1` is set and the command starts with `npx`, add `--prefer-offline` after `npx` so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — `sync`, `install`, `publish`, `invite`, `eval`, and `update`'s release probe — are handed to a terminal with the reason.

## What this skill never does

- Answer a CLI question by any means.
- Run Table B workflows as supposed dry runs.
- Add consent-bypassing flags on the user's behalf.
- Call git to infer a project or register roots behind the user's back.
- Retry a verb that exited 1 with a failure block.
