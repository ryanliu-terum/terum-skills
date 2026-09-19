# Install terum-skills

There is one command. `npx` fetches the package on demand, so nothing has to be installed to run it. Setup itself does write to this machine: a team clone, a config file, and whatever hooks you accept. The table further down says exactly what and where.

```sh
npx -y terum-skills@latest setup
```

To join a team you were invited to, pass the repository:

```sh
npx -y terum-skills@latest setup <org>/<repo>
```

Bare `setup` cannot join. Choosing "Join an existing team" at the role question prints what to ask the owner for and writes nothing.

## What you need

| Requirement | Who needs it |
| --- | --- |
| git | Everyone. Every team read and write is a git operation on a clone. |
| A logged-in GitHub CLI (`gh`) | Only to create a team on GitHub, and afterwards for `invite`, `team remove`, and downloading or updating the app. Joining a team needs none of it: you can accept the invitation in a browser, and git access uses your configured Git credentials. |
| Node.js | The package declares `"engines": { "node": ">=22.12.0" }`. Nothing in the CLI checks the running version itself, so an older Node is your package manager's decision, not the CLI's. |
| Claude Code, logged in | Only for `eval`, which spawns `claude` for every arm. The rest of the CLI never calls a model, except the one category suggestion `publish` asks for. |

`gh` in two states matters. Installed but logged out is not the same as absent: setup offers "GitHub CLI is installed but logged out. Run `gh auth login` now?" and runs gh's own login for you when you say yes. Creating a team against a non-GitHub remote (`team create --remote <url>`) needs no `gh` at all. See [create a team](create-a-team.md).

## Platforms

| Platform | CLI | The app |
| --- | --- | --- |
| macOS (arm64, x64) | Yes | Yes. The bundle is placed at `~/Applications/Terum Skills.app`. |
| Windows (x64, ARM64) | Yes | Yes. A per-user installer runs silently under `%LOCALAPPDATA%\Terum Skills`, with no elevation. |
| Linux | Yes | No. `app` prints "There is no Linux desktop app yet; everything works from the terminal." and exits 0. |
| WSL | Yes | No. `app` prints "The desktop app runs on the Windows side of this machine, not inside WSL. Install terum-skills there and run this command from a Windows terminal; from here, everything works in the terminal." |

Where there is no app, setup skips the app step and runs the whole wizard in the terminal. Windows architecture is detected from the host CPU, not the Node process, so an x64 Node on an ARM64 box still gets the ARM64 installer and a warning that everything it starts runs under emulation. See [platforms](../reference/platforms.md).

## What setup does, in order

Setup is a wizard with named steps. Re-run it any time: it resumes the team this machine is on and offers whatever it did not finish.

1. **Welcome.** Three lines:

   ```
   Welcome to terum-skills.
   Your team's skills live in one private git repository the team controls; each member installs what they want and publishes local skills explicitly.
   This wizard helps you create a team, join one, invite teammates, and offer the session hook, the /terum-skills Claude Code skill and a reminder to publish a skill after Claude edits one; re-run it any time to continue, and leave the invitation question blank to skip it.
   ```

2. **The app, first.** On macOS and Windows, at an interactive terminal, setup does not ask. It downloads the app for this CLI version if needed, records where this CLI is, and opens it. When the app launches, setup prints `Continuing in the app.` (or `Continuing in the app. Join <org>/<repo> there.` when you passed a target) and returns. Everything below then happens in the app, not the terminal. If the hand-off fails, the failure is printed and the terminal wizard continues. `--no-app` keeps the whole wizard in the terminal.

3. **Role.** Only on a machine with no configured team and no target. Setup prints "Creating a new team creates a private GitHub repository under your account.", then asks:

   ```
   Create a team or join one?
     Create a new team      Creates a private GitHub repository under your account.
     Join an existing team  Uses an invitation from the team owner.
   ```

   Setup asks rather than guessing because the two answers are not symmetric: a wrong "create" leaves a private GitHub repository you did not want, while a wrong "join" costs a re-run. Choosing "Join an existing team" prints the hand-off and exits without writing anything: "Ask the team owner to invite you, then run the command they send you." A machine that already has a team prints "Resuming setup for team `<name>`. Terum Skills keeps one team per machine; to move this machine to another team run `npx -y terum-skills@latest team leave <name>` first."

4. **GitHub.** Setup probes `gh` and offers the login when it is installed but logged out. A creator without a logged-in `gh` stops here. A joiner gets one of three notices and continues: "GitHub: gh is logged in. For an owner/repository target, setup will try to accept a matching invitation; Git access uses your configured Git credentials.", "GitHub: gh is installed but logged out; you will be asked to accept the invitation in your browser.", or "GitHub: gh is not installed; you will be asked to accept the invitation in your browser."

5. **Team.** Creator: `team create`, which asks for the team name, your identity, and the GitHub repository name. Joiner: `team join <target>`, which accepts the invitation, clones, and asks for your handle. See [create a team](create-a-team.md) and [join a team](join-a-team.md). A configured team whose clone is missing is re-cloned here; a folder that exists but is not a complete clone of that remote is refused with the repair to run.

6. **Invite.** Creators on a GitHub remote only. The question is "Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)". Blank skips it. A login that does not exist is asked again, up to three attempts in total; a permission refusal or the daily cap ends the wizard after naming what is already durable.

7. **The cheat sheet.**

   ```
   Next, from any terminal:
     npx -y terum-skills@latest install <team>/<skill>   — install a shared skill (add @<version> to pin it)
     npx -y terum-skills@latest ls [--local]             — list members and shared skills; --local lists your own
     npx -y terum-skills@latest search <term>            — find a skill by name, description, or category
     npx -y terum-skills@latest sync                     — fetch the team clone
     npx -y terum-skills@latest publish <skill>          — publish a local skill explicitly
     npx -y terum-skills@latest eval <skill>             — evaluate a shared skill locally before publishing
   ```

   The `@<version>` hint in that first line is stale. `install` refuses a pin today: "Installing a previous version is not supported yet; install installs the latest version."

8. **A project.** Setup prints "Terum will track the skills in that project's .claude folder." and asks "Add a project?" (default No). Yes asks "Which folder?", defaulting to the nearest repository root at or above your working directory, and to the working directory itself when there is none. A registered project's `.claude/skills` becomes part of your Library. A failure here is printed and never fatal. `--no-projects` skips the offer.

9. **Your existing skills.** Setup runs `reconcile` over your Library: "Checking your library against the team…". A folder whose bytes match a shared version is offered as "Record `<name>` as installed (Version N)?". A folder with the same name and different bytes is offered as "Publish your version of `<name>` as Version N of the team's `<name>`?", followed by why it can: either "Your folder carries the team's id for `<name>`.", or, when it does not, a sentence naming who published the team's copy, warning that publishing makes your content the next version of their skill, and giving the `skill rename` command that keeps them separate. Rows are independent, and nothing is written unless you say yes. `--no-existing` skips it.

10. **Evals.** For every shared skill whose current version has no receipt, setup prints a cost line and asks. With three or more earlier receipts in the clone the line is measured ("Evaluating 6 skills, 4 at a time: about $9.00 and 6 min on this machine, from 8 earlier runs (median $1.50 · 3 min each)."); otherwise it says "no earlier runs to estimate from; each eval runs the skill's cases against a baseline on this machine and bills your Claude account."

    ```
    Evaluate the 6 shared skills that have no receipt yet? This runs Claude on each one and records results locally.
      Now          Runs all 6, 4 at a time, in this terminal.
      In batches   Asks how many at a time and checks in between batches.
      Overnight    Queues them; the app runs them between 01:00 and 05:00 while it is open and idle.
      Skip         Evaluate any skill later with `npx -y terum-skills@latest eval <skill>`.
    ```

    The default is Skip. "In batches" then asks "How many at a time?" (default 4). "Now" and "In batches" run one shared preflight probe of `claude` first and print "Skipping the evals: …" if it fails. "Overnight" queues and probes nothing. `--no-evals` skips the whole step. See [your first eval](first-eval.md).

11. **Community.** One line: `Feedback and requests: https://discord.gg/8tnRrxRM3Z`.

12. **Session hook.** "Install the Claude Code session-start hook so team skills sync automatically? (edits ~/.claude/settings.json)" (default No).

13. **The `/terum-skills` skill.** "Install the /terum-skills Claude Code skill so Claude can run terum-skills for you? (writes ~/.claude/skills/terum-skills)" (default No).

14. **Edit hook.** "Remind Claude Code to publish a skill after it edits one? (installs ~/.terum/skills/hooks/terum-skills-edit.mjs and a Write/Edit hook in ~/.claude/settings.json)" (default No).

    These are three separate questions on purpose. The session hook fetches on a schedule; the edit hook runs after every Write and Edit the agent makes and reads the path it touched. Folding the second into a yes already given would install something else. All three default to No, and declining any of them is remembered only in the sense that nothing was written: a later `sync --hook` never installs a copy you declined, it only refreshes one you accepted. A re-run does not ask again for one you already have. An installed session hook is reported rather than offered, and an out-of-date `/terum-skills` skill or edit-hook script of ours is refreshed without a question, because the consent was given when it was installed. Anything at either path that is not ours is named and left alone. The hook entry and the `/terum-skills` skill both name the copy of the CLI that wrote them rather than the registry's latest release, so a session runs the copy you installed; a later `sync --hook` re-points an entry written by an earlier release at the copy that is running and says so on stderr. See [Claude Code integration](../guides/claude-code-integration.md), and [security](../../SECURITY.md) for what runs on this machine and when.

15. **Done.** The members, the repository URL, and the team README URL.

### Setup flags

| Flag | Effect |
| --- | --- |
| `--no-app` | Keep the whole wizard in the terminal. Do not install or open the app. |
| `--no-projects` | Do not offer to add a project to your Library. |
| `--no-existing` | Do not check your existing Library folders against the team. |
| `--no-evals` | Do not offer to evaluate shared skills that have no receipt. |
| `--app` | Open the app. This is already the default wherever one exists. |

## What setup writes, and where

Windows spellings differ: `~` is `%USERPROFILE%`, so the state root is `%USERPROFILE%\.terum\skills` and the settings file is `%USERPROFILE%\.claude\settings.json`.

| Path | Written when | What it holds |
| --- | --- | --- |
| `~/.terum/skills/config.json` | Always, at `team create` or `team join` | Your team binding, your identity defaults, the placement ledger, tool-consent records, registered projects. Mode 0600. |
| `~/.terum/skills/teams/<team>/` | `team create`, `team join` | The clone of the team repo, on `main`, with a `pre-push` guard armed in `.git/hooks`. |
| `~/.terum/skills/run/` | Throughout | Machine-local run state: sync stamps and locks, the eval queue, the app's launch record. |
| `~/.claude/settings.json` | Only if you accept the session hook | A `hooks.SessionStart` entry with matcher `startup` that runs `sync --hook` through the copy of the CLI that installed it, in the same bare-or-npx form the CLI uses for the commands it prints: `terum-skills sync --hook` for a global install the CLI found on your PATH on macOS or Linux, otherwise `npx -y terum-skills@<version> sync --hook` pinned to the release that ran setup (`async`, 60 s timeout). See *Other ways to run it* below. |
| `~/.claude/settings.json` | Only if you accept the edit hook | A `hooks.PostToolUse` entry with matcher `Write\|Edit` running `node "<home>/.terum/skills/hooks/terum-skills-edit.mjs"` (10 s timeout, not async). |
| `~/.terum/skills/backups/settings.<stamp>.json` | Once ever, before the first settings write | A verbatim copy of your `~/.claude/settings.json`. |
| `~/.claude/skills/terum-skills/` | Only if you accept the `/terum-skills` skill | The bundled skill that teaches Claude Code which verbs it may run. Anything else already at that path is named and left alone. |
| `~/.terum/skills/hooks/terum-skills-edit.mjs` | Only if you accept the edit hook | The reminder script. It imports nothing from the package and reads no network. |
| `~/Applications/Terum Skills.app` (macOS) | App step | The app bundle, at a fixed path so a Dock pin survives updates. |
| `%LOCALAPPDATA%\Terum Skills\` (Windows) | App step | The per-user install the silent installer creates. |
| `~/.terum/skills/app/<version>/installed.json` | App step | The download record for that version. |
| `~/.terum/skills/run/app.json` | App step | The Node binary, CLI entry and PATH the app re-reads on every launch. |

The full inventory, including quarantine and eval run trees, is in [local state](../reference/local-state.md).

## Check the result

```sh
npx -y terum-skills@latest status
```

`status` is an offline read. It prints the CLI version, then for your team: your handle, the repository, the clone's state (with the command to restore it when it is missing, incomplete, or a clone of something else), the member count and the first five members, the number of shared skills, and how stale the clone is. A membership line appears only when your roster entry is archived or absent. With no team configured it prints the two get-started commands and still exits 0. It returns a failure only when a configured team's details could not be read.

## Other ways to run it

The `npx -y terum-skills@latest …` form resolves the registry's latest release on each run, so a command you type is always the newest release. The session hook and the `/terum-skills` skill are the exception: each is pinned to the copy that installed it, and re-running `setup` is what moves them.

Pin a version when you want one exact release, for example in a script:

```sh
npx -y terum-skills@0.20.1 setup
```

Install it globally when you would rather type less:

```sh
npm install -g terum-skills
terum-skills status
```

When you then run the bare command on macOS or Linux, the CLI prints its own commands in the bare form (`terum-skills ls`) rather than the npx form, so anything you copy out of its output already matches how you run it. On Windows, and whenever the CLI is launched through npm or npx, it keeps the npx form.

### How updates work

| How you run it | How it updates |
| --- | --- |
| `npx -y terum-skills@latest` | Each run requests the registry's latest release. Re-run `setup` to move the session hook and the `/terum-skills` skill onto it. |
| Global install | Run what `update` prints: `npm install -g terum-skills@latest`. Where the hook and the skill were written in the bare form they follow the new global install on their own; where they name a version, re-run `setup`, which is what `update` says. |
| Local dependency | Run what `update` prints: `npm install terum-skills@latest` (or `--save-dev`) in that project, then re-run `setup` to move the hook and the skill. |
| Source checkout | Update the checkout, then `npm run build`. |
| The app | It updates itself. See [the desktop app](../guides/desktop-app.md). |

```sh
npx -y terum-skills@latest update
```

`update` prints the running version, where this copy lives, the latest advertised release, and the command that would update this copy. Where that copy is a global install, an npx run, or one whose installation method could not be established, it also names the re-run of `setup` that moves the session hook and the `/terum-skills` skill onto the release you updated to. It never runs a package manager. The release advertisement comes from a `git ls-remote --tags` probe of this project's public repository, capped at once a day for the passive notice and forced when you run `update` yourself. A machine whose team remote is not on GitHub does not probe at all, and says so: "Release advertisements are not checked on this machine."

## Uninstalling

`npx -y terum-skills@latest uninstall` removes terum-skills from this machine after one confirmation that lists everything it is about to touch: your team binding, every placed skill folder, the team clone, the version cache and run files, the session hook and the Write/Edit entry in `~/.claude/settings.json`, the managed `/terum-skills` skill and the edit-hook script (a foreign file at either path is named and left alone), the app download records, and `config.json`. It keeps your quarantine folder when it holds anything, the `backups/` folder including a record of the uninstall, and `evals/` with its runs and transcripts, and it says so under `Kept:` before you answer. More can survive than that line names. At the end it removes `app/` outright, but removes `run/`, `cache/`, `teams/` and `quarantine/` only when they are already empty. So anything still under `run/`, such as the usage archive and the eval queue, stays behind and is reported as `Kept <path> (not empty)`, and a quarantine folder is reported with its item count. The state root `~/.terum/skills` itself is left in place whenever anything remains inside it, with no line at all. A clone holding uncommitted or unpushed work is moved to quarantine rather than deleted, and a placed folder you have edited is quarantined rather than deleted. Your membership and installed-skill records in the team repo are unchanged. On macOS the app bundle at `~/Applications/Terum Skills.app` is deleted; on Windows the app stays installed and you remove it from Windows Settings, Apps. The npm package itself is never removed by this command; the last line tells you how. Full detail, including what survives and why, is in [local state](../reference/local-state.md).
