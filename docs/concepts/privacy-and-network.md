# Privacy and network

An inventory, not a reassurance. There is no telemetry and no account with Terum, and there is still traffic: to your team's git host, to GitHub's API, to Anthropic through your own Claude Code login, and once a day to the repository this tool is released from. This page lists all of it.

## What leaves your machine, and to whom

| Action | Destination | What is sent | How to avoid it |
| --- | --- | --- | --- |
| Any verb that writes to the team repository: `publish`, `unpublish`, `install`, `uninstall-skill`, `profile`, `team remove`, `team project create`, `team project delete`, `team migrate` | Your team's git remote | A `git fetch`, then a `git push` of one commit. Its content is whatever the verb owns: version bytes, receipts, your people file, `team.json`. Git also sends your git credentials for that remote. | Do not run the verb. There is no local-only mode for a write: the repository is where team state lives. |
| `team create`, `team join`, `team move` | Your team's git remote | `team create --remote <url>` runs `git ls-remote --heads` to prove the repository is empty, then pushes one scaffold commit carrying `team.json`, your people file and the workflow. `team join` runs `git clone` of the whole repository, then adds your people file through the fetch-and-push above. `team move` is a local teardown followed by a join against the new remote and one install per skill it is putting back. | Nothing binds a machine to a team without reaching that team's remote. `team leave` is the exception in the other direction: it changes nothing in the repository and never pushes. |
| `sync`, and the app's background refresh at launch and on window focus | Your team's git remote | A `git fetch` only, for every configured team. Nothing is pushed. | Do not run `sync`, and turn off the app's automatic refresh by not using the app. The read verbs never fetch, so a clone you never refresh stays where it is. |
| The session hook, if you installed it | Your team's git remote | The same `git fetch`, at every Claude Code session start, rate-limited to at most once an hour per team. The entry runs the copy of the CLI that installed it, pinned to that copy, so a session start fetches no newer CLI. | Decline the hook at setup, or remove the `SessionStart` entry from `~/.claude/settings.json`. |
| `eval`, on a machine that has a team | Your team's git remote | A `git fetch` before the run, so the incumbent arm reads a current clone. Then, when the evaluated bytes are already a published version, a `git push` of the receipt for that run as one committed file. | `eval --no-commit` stops the push. The fetch runs whenever a team is configured. |
| `invite <login>` | GitHub API, through `gh` | `PUT repos/<owner>/<repo>/collaborators/<login>`: the repository slug and each login you typed, under your gh credentials. | Add collaborators on GitHub yourself. `invite` has no team-repo write path, so skipping it costs nothing else. |
| `team remove <handle>` | GitHub API, through `gh` | An admin probe of `repos/<owner>/<repo>`, then the repository's collaborator and invitation lists, then a `DELETE` of that person's collaborator entry or pending invitation. | `team remove --archive-only`, which archives the handle in `team.json` and touches no host API. |
| `status --permissions` | GitHub API, through `gh` | `repos/<owner>/<repo>/collaborators?permission=admin`, to mark which members are repository admins. The flag is real but hidden from `status --help`. | Run plain `status`. Without the flag the lookup does not happen and the admin column reads as unknown. |
| `sync`, when a GitHub team's repository answers "not found" | GitHub API, through `gh` | `user/repository_invitations`, then `user/repos?affiliation=collaborator,organization_member,owner`, then `repos/<owner>/<repo>/contents/team.json` for up to eight of that owner's repositories you can already reach, newest push first. That last read is what tells a candidate repository from a team repository. Cached for ten minutes. | Only runs for a GitHub remote, only after the repository is already gone, and never in session-hook mode. |
| `team join` and `setup <org>/<repo>` | GitHub API, through `gh` | `user/repository_invitations` to find the matching invitation, a `PATCH` to accept it, and `repos/<owner>/<repo>` to check whether you already have access. | Accept the invitation in the browser first. Without a logged-in `gh`, joining prints the invitation URL and waits instead of calling the API. |
| Identity collection at setup | GitHub API, through `gh` | `gh api user -q .login`, to suggest your handle. | Answer the handle question yourself, or run without `gh` installed. |
| `login`, `setup`, and `team create`, where they check the GitHub CLI | GitHub API, through `gh` | `gh auth status`. This tool reads its exit code and nothing else, and never sees a token; what that command sends is gh's own. `gh --version` runs locally and sends nothing. At a terminal, a logged-out `gh` is offered `gh auth login`, which is gh's own flow. | Run without `gh` installed. Every GitHub-only operation then refuses and says it needs `gh`. |
| `team create` on GitHub | GitHub API, through `gh` | `gh repo create <owner>/<repo> --private`, then a read of its `nameWithOwner`, then `--delete-branch-on-merge`. | `team create <name> --remote <url>` against a repository you made yourself. That path calls no repository API. It still asks a logged-in `gh` for your login to default the handle question, and running without `gh` installed stops that too. |
| `eval`, execution arms | Anthropic, through your Claude Code login | One `claude -p` session per arm, run in a sandbox directory. The task text, the staged skill folder, and whatever files the case stages. The agent runs with Bash, Read, Write, Edit, Glob, Grep, Task and Workflow available inside that sandbox. | Do not run `eval`. There is no offline arm. |
| `eval`, trigger cases | Anthropic, through your Claude Code login | For each trigger prompt: the prompt, plus the name and description of every skill folder in the same Library root as the skill under test. The whole point of the test is whether the model picks your skill out of that catalogue. | `eval --execution-only`, or run the skill from a Library root that holds nothing you would rather not name. |
| `eval`, generating missing eval assets | Anthropic, through your Claude Code login | The full `SKILL.md` and the names of the other files in the folder, never their contents. A trigger generation also sends the same catalogue; a case generation does not. | `eval --no-gen`, and author `evals/cases/` and `evals/triggers.yaml` by hand. |
| `eval`, the judge | Anthropic, through your Claude Code login | The task, the rubric, and the last 6,000 characters of each of the two transcripts. | Not separable from an execution run; a comparison has to be judged. A case with no `judge` rubric is decided by its checks alone and makes no judge call; `--triggers-only` runs no arms at all. |
| `misses` | Anthropic, through your Claude Code login | Each harvested prompt with its system-reminder blocks stripped, up to three preceding turns trimmed to their last 1,000 characters, and the name and description of every placed skill dated at or before that prompt, in batches of ten to `claude -p --max-turns 1 --disallowedTools '*'` on `sonnet`. | Do not run `misses`. It has no offline mode, and nothing else runs it: the app has no surface for it and `serve` refuses it. |
| `publish`, choosing a category | Anthropic, through your Claude Code login | The first 2,000 characters of your `SKILL.md` and the team's category list, to `claude --model haiku`. | Declare `metadata.terum-category` in the file, or pass `--category <name>`. Either one skips the call entirely. Offline, the call fails and the category falls back to `misc`. |
| `update`, and `app-update` (which the app runs at launch and on window focus) | `github.com/ryanliu-terum/terum-skills` | `git ls-remote --tags` against the public release repository, at most once a day. It asks for the tag list and nothing else: it sends no version of yours, no identity and no query. Git supplies whatever it would normally send to github.com, your credential helper included. It runs only when a team on this machine has a GitHub remote. | Use a non-GitHub team remote, and the probe never runs. Otherwise it is one tag listing per day. |
| `app`, and applying an app update | `github.com/ryanliu-terum/terum-skills` | `gh release download v<version>` for the platform asset and its checksum, then `gh attestation verify <asset> --repo ryanliu-terum/terum-skills`, which asks GitHub for the build-provenance attestation recorded for exactly those bytes. Both run under your gh credentials. The download sends the release tag and the asset name; the verify step sends this repository slug and the SHA-256 of the bytes already on your disk, and nothing about you or your team. | Do not install the desktop app. The CLI is complete without it, and there is no Linux app to download in any case. |
| Sending a teammate the join instructions | Nothing, on its own | The block `invite` prints contains an optional global install line, a `setup <org>/<repo>` line, its bare `team join` equivalent, one sentence about invitations, and your repository slug. Nothing else: no token, no handle, no member list, no skill names. You paste it wherever you like. | It is already inert; treat the repository slug as the one fact it discloses. |

The desktop app adds no destinations of its own. It has no HTTP client, its webview may open only `https://github.com/*` and `https://discord.gg/*` links, and every network operation above happens inside the CLI child process it spawns.

## What the team repo records about you

Joining writes `people/<handle>.json`, and your teammates can read all of it.

| Field | What it holds |
| --- | --- |
| `handle` | Your handle in this team. Handles are per team, so it need not match anything else. |
| `display_name` | Your name, defaulted from `git config --global user.name`. |
| `email` | Your email, defaulted from `git config --global user.email`. It is also half of `metadata.author` on every skill you publish, which is how authorship is derived. |
| `github` | Your GitHub login, or empty. Present so `team remove` can put it in a REST path. |
| `bio`, `role`, `projects` | Self-described, written only by `profile`. Job labels and registry membership, not permissions. |
| `installed[]` | One entry per install: the skill's uuid, its version, its scope (Global, or a named team project), and the date. Not the folder path: the committed record names the project, never a filesystem path. |
| `profile[]` | What you endorse: the skill's uuid, its name, the version, the date, and whether it arrived via publish or install. |
| `local_skills` | A single number: how many skill folders your machine held across your Global root and your registered projects, counted the last time `install` or `profile` wrote your people file. Not names, not paths. It is a self-report, and it is absent rather than zero when no count has been made. |

Receipts you commit carry your handle as `runner_handle`, along with the skill's name, uuid and version, the digest of the bytes evaluated, the verdict, the per-case and per-check scores, the trigger scores, the model aliases you asked for, `k`, the Claude Code version, the run timestamp, the case names, and the list of skill names Claude Code resolved in each arm's session.

Three fields say more about your machine and your account than the rest. `efficiency` records each arm's turn count, duration and `cost_usd`, so a reader can tell what the run cost you. `environment_skips` records the names of the host tools a case asked for and did not find. `dropped_cases` records why a case never started. Free text in a receipt (the attribution line, check names, and a dropped case's detail) is scrubbed for credential-shaped strings before the receipt exists.

Git records the rest, as git does: every commit carries the name and email in your clone's `user.name` and `user.email`, and the history is permanent unless someone force-pushes.

## What stays local

| Thing | Where |
| --- | --- |
| Eval runs in full: `transcripts/`, `sandboxes/`, `run.jsonl`, and `generated/` as that run produced it | `~/.terum/skills/evals/local/<digest>/<runId>/`. Of this tree only the receipt is ever shared, and only when you publish it. |
| Local receipts | The same directory, keyed by content digest. Never sent anywhere by themselves. |
| The usage event archive | `~/.terum/skills/run/usage-events.jsonl`, append-only, with exactly four fields per line: the skill name, a timestamp, which kind of firing it was, and the entrypoint. No session id, no path, no free text. It is read by `usage` and by nothing else, and it never leaves the machine. |
| Your config | `~/.terum/skills/config.json`, mode 0600: your teams and their remotes, your identity, your registered projects, your approvals, and every path this tool has placed a skill at. |
| Quarantine | `~/.terum/skills/quarantine/<timestamp>/<name>`, where an edited copy goes instead of being deleted. Only `prune` empties it, after listing every path and asking. |
| Backups | `~/.terum/skills/backups/`: one copy of `~/.claude/settings.json`, taken once ever before this tool's first edit to it, and one copy of `config.json` at machine uninstall. |

One item on that list has a second copy that does not stay local. When `eval` generates missing assets it also writes them into the skill folder itself, at `evals/cases/` or `evals/suite.yaml`, and `evals/triggers.yaml`, and `publish` writes a skill's eval assets to the team on every publish. The copy under the run directory stays here; the copy in your folder is part of the skill you share.

## What is never collected

No telemetry. No analytics SDK, in the CLI or the app. No crash reporting. No account with Terum, no login to Terum, and no service of ours that your machine talks to. Nothing reports which skills you have, which you ran, or that you exist.

## The update notice, and what silences it

After a verb, when stderr is a terminal, the CLI may print one line on stderr saying a newer release is advertised. Any of these environment variables suppresses that line:

| Variable | Effect |
| --- | --- |
| `CI` | Any non-empty value. |
| `NO_UPDATE_NOTIFIER` | The conventional variable, honoured as-is. |
| `TERUM_SKILLS_NO_UPDATE_NOTIFIER` | This tool's own, for when you want the others left alone. |

Running with `--frames` suppresses it too, so the app never sees it.

What they do not silence is everything else. They do not stop `update` or `app-update` from probing the release repository, they do not stop the app's launch-time update check, and they do not stop a single `git`, `gh` or `claude` call any verb makes. They are about one printed line.

## See also

- [Local state reference](../reference/local-state.md), for every file this tool writes on your machine.
- [Team repository reference](../reference/team-repo.md), for the exact shape of everything it writes to the team.
- [Security](../../SECURITY.md), for what runs on your machine and when, how a release is built, and how a download is checked.
