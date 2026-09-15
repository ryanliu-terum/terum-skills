---
name: terum-skills
description: "Drive the terum-skills CLI from a Claude Code session: inspect the local Library or team Marketplace, fetch with sync, publish immutable skill versions, install the latest version into Global or an added project, evaluate local skills, and prepare terminal commands for project setup, skill move/rename/delete, pruning, and team administration. Use when the user wants to manage, evaluate, publish, or install skills; hand questions requiring a TTY to the user's terminal."
metadata:
  managed-by: terum-skills
---

Run one `terum-skills` verb on the user's behalf, or prepare it for them when the CLI would
ask a question the session cannot answer. This is a thin wrapper: the CLI is the product, the
skill only decides *whether* to run it here and *how* to show the result.

This file ships inside the `terum-skills` npm package and is placed at
`~/.claude/skills/terum-skills/` by `terum-skills setup`. The `metadata.managed-by` marker identifies
Terum's copy. Setup can refresh it; `sync --hook` also refreshes an outdated managed copy and
announces `Updated your /terum-skills manual for this CLI.` A foreign copy is left alone.

Setup also offers a Write/Edit hook, separately and with its own y/N. Where the user accepted it, a
note beginning *"You edited <name>, a skill in this machine's terum-skills Library"* appears after an
edit inside a `.claude/skills/` folder, once per skill per session. It is this tool talking, not the
user: treat it as the reminder it is, finish what you were asked to do first, and then offer the
publish hand-off it names. A skill edited and never published is a skill only that machine has.

## The one rule that shapes everything

Claude Code's Bash tool has no TTY. The terminal Prompter refuses a question with
`Cannot ask "…": this command needs an interactive terminal (stdin is not a TTY).`
A refusal does **not** prove nothing happened: a verb may already have cloned, recorded intent,
or completed a write before a later question. Read all output before reporting the outcome. So:

- Verbs that never ask run here.
- Verbs needing a human answer are prepared and handed to the user to run in a terminal.
- Verbs that ask only sometimes can run here; if the failure above appears, hand off with the
  output and any completed work clearly stated.

Never pipe `y` on stdin, invent flags, or drive the CLI through `expect` or `script`.
The user's terminal answers the CLI's questions; the skill answers none of them. Do not use
`--frames` to bypass this rule; it is the transport for a program with a human prompt renderer.

## Invocation

- Always `npx -y terum-skills@latest <verb> …` for a runnable command.
  Never a bare binary, checkout entry, or `node dist/index.js`.
- Run through Bash from the current working directory. Do not `cd`. Use absolute path arguments.
  The Library reads Global and explicitly added project roots; cwd does not add a project.
- Do not use the skill-file `` !`command` `` injection: a non-zero exit aborts the whole skill.
  `validate` exits 1 on error findings; warnings alone are not a failure.
- `$ARGUMENTS`: the command path can have multiple tokens (`skill move`, `team project create`).
  Pass the remaining arguments unchanged. With no arguments, ask which verb, defaulting to
  `status`. Explain the tables below briefly; ask for the user's intent before assembling flags.
- Use the grammar below. This CLI has no standalone refresh command; use `sync` for fetching.
  `team migrate` exists but is terminal-only (Table B); do not invent any other migration invocation.

## Table A: verbs that run here

| Verb | Before running | After running |
|---|---|---|
| `status` | nothing | show stdout; exit 0 means the query succeeded, not that setup is complete. Pending work needs the matching install or removal retried, not a fetch |
| `ls`, `ls member <h>`, `ls project <n>` | nothing | show the team inventory |
| `ls --local` | nothing | show the requested project section; summarise other roots and rejected/unreadable folders by count and reason unless asked for all. This inventory is local-only |
| `project add <abs-path>`, `project remove <abs-path>`, `project list` | confirm with the user before adding or forgetting a root | show stdout; removing a project leaves its files and placement ledger unchanged |
| `search <term> [--category <c>] [--author <a>] [--project <p>]` | nothing | show stdout; `No skills found.` is a result |
| `skill fix <abs-path>` | none; the folder is the user's own | show stdout; it applies the repairs with one right answer (quote a frontmatter value YAML refuses, `name` to the folder, `license` to team policy, strip invisible characters, clear an executable bit on a non-script) and prints `Still needs you` for the rest |
| `skill category <abs-path> --to <name>` | none; the folder is the user's own | show stdout; it rewrites `metadata.terum-category` locally and publishes nothing, so the team keeps showing the category its newest version carries until the user runs the `publish` the output prints. Any name is accepted; an off-list one gets the same advisory warning `publish` gives |
| `validate <abs-path or name> [--cwd <team-root>]` | requires team policy from the configured clone or explicit team root | show findings verbatim. Validation does not inject managed fields; an unpublished folder may fail strict frontmatter checks. Publish injects its managed fields before checking; local eval permits those fields to be absent |
| `update` | nothing | show the update command; the CLI never runs a package manager |
| `app` | confirm download/install and opening the desktop app | show stdout |
| `app-update --check` | nothing | show cached advertisement and installed/staged state; `--force` on this check requests a release probe |
| `app-update --stage [--release <version>]`, `app-update --apply [--release <version>] [--reason manual]` | confirm download or installation; on macOS quit the running app before terminal apply | staging verifies the download; apply hands installation to a detached process |
| `sync` | say it fetches and resets each disposable team clone to `origin/main`; it never uploads, places, or edits the user's skill folders | show stdout; disclose each team reported as not refreshed. A successful fetch records its time and HEAD. Use `run_in_background` for a slow fetch |
| `sync --hook` | do not run by hand; this is the SessionStart entry | stdout is the reload directive, notices go to stderr; only Terum's managed manual may be refreshed |
| `install <ref> [--into global\|<project root>]`, `install member <h> [--into global\|<project root>]`, `install project <n> [--into global\|<project root>]` | confirm the skill/list and destination: this places files and writes install records. Use an explicitly chosen `--into`; an unregistered project path refuses and needs `project add` first | installs the highest numbered version in the clone. A tool-grant question or replace question needs a terminal; report any completed work before handing off |
| `invite <github-login…>` | confirm with the user: sends GitHub collaborator invitations | show stdout and the teammate join block |
| `profile [--name <display>] [--bio <text>] [--role <role>] [--project <name>]… [--remove <skill>]` | confirm the profile changes; project membership names team projects; `--remove` takes one skill off the profile list | show stdout |
| `login --set <key=value>` | confirm the identity change; keys are `name`, `email`, `default-handle`; repeat the flag for multiple fields | show the identity notice; published versions keep their recorded author |
| `team workflow-update --print` | nothing | show the workflow scaffold and its manual migration instruction; this does not migrate the team's skill layout |
| `eval <skill> [--k <n>] [--triggers-only] [--execution-only] [--case <stem>] [--model <m>] [--judge-model <m>] [--no-gen]` | see the eval section | see the eval section |
| `eval <skill> <skill>… [--batch <n>] [--parallel <n>]`, `eval --pending` | confirm the paid runs: several skills run as one batch after one agent probe; `--pending` means every shared skill with no receipt for its current version; `--batch <n>` asks before each further batch | show ✓/✗ per skill and the `Evaluated X of N` line; a declined continuation queues the rest for later |
| `eval <skill…> --window overnight\|later`, `eval --pending --window overnight` | confirm queueing; nothing is paid for now | show the queued count; overnight items run in the desktop app between 01:00 and 05:00, later items wait for `eval --drain` |
| `eval-report <skill> [--team <team>]` | nothing | show committed receipts and local run history for a skill in the team clone; no fetch |
| `eval --queue-list` | nothing | show the local queue |
| `eval --dequeue <skill>` | confirm removal from the queue | show remaining items; a team-qualified selector is also accepted |
| `eval --drain [--parallel <n>] [--window overnight] [--max <n>]` | confirm paid runs, as below | show successes and failures; default parallelism is four |
| `serve` | do not run as a one-shot Bash command; it requires `--frames` and a request/answer client | accepts only `status`, `ls`, `eval-report`, `search`, `validate`, `update`; every write uses its own process |

Interactive install always asks `Install to`, offering Global and every added project, even if
Global is the only choice. Without a TTY, omitting `--into` defaults to Global only when no
projects are registered; otherwise it refuses. Previous-version skill refs are refused.

If a destination already contains that name, install asks before keeping the existing folder
at the targeted root's sibling `.claude/old-skills/<name>` and placing the new version. A project
copy stays under that project. If the kept-copy path already exists, the command refuses; move
that backup elsewhere yourself before retrying. Neither the Library nor `prune` cleans old-skills.
Install seeds local eval receipts under each receipt's own content digest, preserving the runner's
attribution. A receipt without a digest is skipped with a notice. Interactive install offers adding
the skill to your profile (default no); noninteractive install skips that offer unless the user
explicitly requests `--yes-profile`.

Output handling for every verb in Table A:

- Show stdout in a fenced code block, verbatim, subject to the inventory summarising rule above.
- Quote stderr failures and explain them in one sentence. Hook notices also use stderr.
- Exit 1 is a failed operation, not a broken wrapper. Do not automatically retry it, and do not
  claim earlier steps were rolled back. Publish can succeed even if its later profile write fails.
- No update-notice tail appears when stderr has no TTY.

## Table B: verbs that are handed to the user

These workflows need a terminal answer, or can write before their first question. Prepare the
exact command without treating a real run as a dry run. Say plainly: *run this in a terminal;
the CLI will ask you questions the session cannot answer.*

| Verb | Free dry run first | Command to hand over |
|---|---|---|
| `project add` (no path) | none | `npx -y terum-skills@latest project add` — asks for a folder |
| `publish <ref> [--project <p>] [--category <c>]` | none; confirm the local skill and team with the user | `npx -y terum-skills@latest publish <ref> --project <p> --category <c>` — omit optional flags the user has not chosen |
| `skill move <abs-path> --to global\|<project root>` | none | `npx -y terum-skills@latest skill move <abs-path> --to <destination>` |
| `skill copy <abs-path> --to global\|<project root>` | none | `npx -y terum-skills@latest skill copy <abs-path> --to <destination>` — the source folder stays where it is |
| `skill rename <abs-path> --to <new-name>` | none | `npx -y terum-skills@latest skill rename <abs-path> --to <new-name>` |
| `skill delete <abs-path>` | none | `npx -y terum-skills@latest skill delete <abs-path>` |
| `skill disable <abs-path>` | none | `npx -y terum-skills@latest skill disable <abs-path>` — writes `off` for the folder's name into Claude Code's own `skillOverrides` setting (the same key the `/skills` menu writes); the folder stays where it is |
| `skill enable <abs-path>` | none | `npx -y terum-skills@latest skill enable <abs-path>` — removes that `off` and nothing else |
| `prune` | none; an empty quarantine simply returns | `npx -y terum-skills@latest prune` |
| `uninstall-skill <ref> [--from global\|<project root>]` | none; the CLI previews before confirming | `npx -y terum-skills@latest uninstall-skill <ref> --from <destination>` — `member <h>` and `project <n>` selectors also exist |
| `uninstall` | none | `npx -y terum-skills@latest uninstall` — machine teardown, preserving recovery data and printing the package-manager step |
| `team leave <name>`, `team remove <handle>` | none | the same command with the supported npx prefix |
| `team move <org>/<repo> [--from <team>] [--yes]` | none; one confirmation, then leave + join + re-place | `npx -y terum-skills@latest team move <org>/<repo>` — when a team's repository was recreated elsewhere (`sync` reports it and offers this) |
| `team project create [name] [--remote <url>]` | none | `npx -y terum-skills@latest team project create <name> --remote <url>` |
| `team project delete [name] [--yes]` | none; the CLI confirms and names what survives | `npx -y terum-skills@latest team project delete <name>` — removes the list only; its skills stay in the marketplace |
| `team migrate [--team <name>]` | none | `npx -y terum-skills@latest team migrate` — once per team, from a terminal, only after the release carrying the new CLI has reached every teammate (an un-upgraded teammate cannot read a migrated repo); refuses under `--frames` |
| `setup [target]`, `team create`, `team join <target>`, `login` | none; setup/join can clone before asking | `npx -y terum-skills@latest setup` / `setup <org>/<repo>` / `team create` / `team join <target>` / `login` with the same npx prefix |

Publish writes the local folder as an immutable `skills/<name>/v<N>/` version directly to team
main and attaches matching local eval receipts. That version IS the team's marketplace copy — a
publish needs no project and asks for none. Identical bytes reuse the existing version;
`--project <name>` additionally lists the skill under a team project. This is not a
pull-request workflow.
Publish resolves category from the declared frontmatter first, then `--category`, then a model
suggestion, falling back to `misc`. A declared category makes no model call and prints no category
line. Otherwise the CLI discloses the source before writing. It writes managed frontmatter back
locally after its refusal-capable checks, then publishes, then records the skill on your profile
without asking — publishing is the endorsement (`profile --remove <name>` takes it back).
A failed team write can leave that frontmatter on disk. Do not treat publish as a dry run.

The three `skill` operations require a direct child of Global or an added project's skills root
and require typing its name. Move preserves local edits and keeps a destination collision in
old-skills. Rename changes the folder and readable frontmatter name; that changes the invocation
name, and publishing a new name starts a new lineage. Delete quarantines an untracked folder or
an edited placement, but removes an unmodified placement outright (reinstall to restore it).
Deleting a placement also removes its install bookkeeping. Uninstall leaves the curated profile
unchanged. `prune` permanently deletes confirmed quarantine contents only.

Whether Claude Code's shell mode has a TTY is unverified; do not promise it.
"A terminal" means a real terminal.

## eval

Eval targets a local Library folder and never publishes results. What it does, so the user knows
what they are buying:

1. Finds the local folder by name; it need not belong to a team. When configured, the team clone is fetched for
   policy and incumbent history, never the candidate bytes.
2. Runs hygiene on the local bytes, allowing absent managed fields. Errors stop before agent calls.
3. Preflight checks `claude --version` and a one-turn smoke task before paid trials.
4. Uses existing cases and triggers, generating only missing assets for the requested tiers. It
   prints the target path and content-change consequence before writing them into the local folder.
5. Runs trigger evals and execution cases, each `k` times (default 1). Execution compares the
   candidate with baseline and, when available, a digest-different published incumbent selected by
   receipt recency rather than highest version number.
6. Stores receipts and run artifacts under `~/.terum/skills/evals/local/<digest>/<run-id>/` and prints
   the report. Publish later attaches receipts whose digest matches the published bytes.

Rules:

- **Confirm with the user first**: trials and generation invoke their logged-in Claude Code and
  bill their account. Explain cases × k × arms, and suggest `--triggers-only` or `--case <stem>` for
  a first look. Missing assets can add generation calls.
- Use `run_in_background`; a full matrix takes minutes.
- **The report's last line may be the next step; act on it.** When the evaluated bytes are not a
  published version, the run ends with either *To share these results, publish the skill again:*
  and the command, or — on a FAIL verdict — the same command with the reason not to use it yet.
  Publishing is Table B: prepare that command for the user's terminal and say why it goes there.
  Offer it after a PASS or NEUTRAL; after the FAIL line, report the verdict and stop.
- `--no-gen` uses only existing assets. To regenerate cases, the user deletes `evals/cases/` and
  re-runs eval. Generating assets changes content identity and can mint a version on the next publish.
- Editing bytes changes the digest used for the Library's score. Installed receipts keep their
  original runner attribution; they are not proof this user ran the eval.
- Model flags pass through unchanged (`--model`, `--judge-model`; default `sonnet`).
- Several skills at once: `eval <a> <b>…` runs them as one batch after one preflight (`--parallel <n>`, default
  four); `--batch <n>` asks before each further batch, and a declined continuation queues the rest for later.
  `--window overnight|later` queues instead of running (no paid work) and `--pending` selects every shared skill
  with no receipt for its current version. Confirm the paid runs once for the whole batch, the same way.

## What this skill never does

- Answer a CLI question by any means.
- Run Table B workflows as supposed dry runs.
- Add consent-bypassing flags on the user's behalf.
- Call git to infer a project or register roots behind the user's back.
- Retry a verb that exited 1 with a failure line.
