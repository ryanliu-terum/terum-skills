# How it works

## The model

A team is one private git repository. Everything the team shares lives in it, and nothing lives anywhere else.

Inside that repository:

| Thing | What it is |
| --- | --- |
| A skill | A folder. Its name is the folder name, and it holds a `SKILL.md` plus whatever else you put beside it. |
| A published version | An immutable folder `skills/<name>/v<N>/`. Publishing appends a new one. Nothing rewrites a committed one. |
| A skill's eval assets | `skills/<name>/evals/`, beside the version folders rather than inside one, so editing a case does not mint a version. |
| A person | One JSON file, `people/<handle>.json`: your handle, display name, email, GitHub login, what you have installed, what you endorse. |
| A receipt | One JSON file, `evals/<skill-uuid>/v<N>/<runId>.json`. One run, written once, never edited. |
| The team's own settings | `team.json`: the team name, its category list, its project lists, its archived handles, and the license that publish stamps into every `SKILL.md`. |

Membership is repository access. You are an active member of a team when `people/<handle>.json` exists and your handle is not in `team.json`'s `archived` list. Both halves are required, because a departure archives the handle rather than deleting the file.

There is no Terum server and no account with Terum. The tool is a CLI that runs on your machine and a desktop app that drives it. Your team's data is in your team's repository, on whatever git host you put it on.

## What runs where

| Where | What it does |
| --- | --- |
| Your laptop | The CLI, the desktop app, and every eval run. The team clone lives at `~/.terum/skills/teams/<team>` (`%USERPROFILE%\.terum\skills\teams\<team>` on Windows). Placed skills live in `~/.claude/skills` and in the projects you registered. |
| Your team's git host | One `git clone` when you join, then `git fetch` and `git push` against the team repository. Any git remote works for storing and syncing: GitHub, GitLab, Bitbucket, a bare SSH repository. |
| Anthropic, through your own Claude Code login | Eval runs, the judge, generated eval assets, and the category suggestion at publish. The CLI spawns `claude -p`. It never handles a token, and the work is billed to whoever is logged into Claude Code on that machine. |
| GitHub's API, through `gh` | Invitations, access-revoking `team remove`, the admin lookup behind `status --permissions`, the invitation your join accepts, and the search for a successor repository when a team's repository has gone. These are GitHub-only; on another host they refuse rather than guess. |
| `github.com/ryanliu-terum/terum-skills` | A `git ls-remote --tags` release probe, at most once a day, and only when a team on this machine has a GitHub remote. Desktop app downloads come from that repository's releases through `gh release download`. |

See [privacy and network](privacy-and-network.md) for the full inventory of what is sent and how to avoid each item.

## The CLI and the app

The app does not reimplement anything. It runs the CLI as a child process with `--frames`, which turns the CLI's prompts into JSON frames on stdin and stdout: one JSON object per line down (`hello`, `print`, `ask`, `progress`, `result`) and one per line up (`answer`, `cancel`). Every question a verb would ask you in a terminal becomes an `ask` frame that blocks until the app answers it.

So the app shows what the CLI answers. A board is empty because the verb behind it returned nothing, and a button is greyed because the CLI's `hello` frame did not advertise that feature. The protocol is documented in [the frame protocol](../frame-protocol.md).

The app itself has no HTTP client. Its webview may open `https://github.com/*` and `https://discord.gg/*` links and nothing else. Every network operation happens inside the CLI child.

## How a write to the team repo works

Every write to the team repository goes through one function, and it is a re-apply model rather than a rebase. It fetches, hard-resets the clone to `origin/main`, runs your verb's pure change against that freshly reset tree, runs the write guard on the result, writes and stages exactly the paths the change touched, proves the staged diff equals those paths, commits, and pushes to `main`. If someone else pushed first, it discards its commit and does the whole thing again, with backoff, until a 30-second deadline. One writer holds a per-clone lock for the whole loop, so two terminals on one machine queue rather than race. Unless the commit reached `main`, or another writer took the lock mid-run, a cleanup step then resets the clone to `origin/main` and removes the untracked paths the attempt created.

The guard is the authorization model, and it is per verb. `publish` may add files into a version folder that does not exist yet, and may not touch one that does. `unpublish` is the only thing that may remove a version folder. Every other verb may write your own people file and nothing else, and `team.json` only in the exact shape its verb needs. The generated `README.md` is the one path every verb may write, because it is regenerated from the catalogue rather than hand-edited. A write that touches one path it does not own is refused whole. See [the team repository reference](../reference/team-repo.md) for the layout and the per-verb rules.

There is no second path for publish, though its help still advertises one that `team.json` no longer carries:

```
Publish a skill to the team's marketplace: opens a pull request under policy "pr", commits directly under policy "push"
```

No `policy.publish` field exists, no publish branch is created, and no pull request is opened. Publish goes through the loop above like every other write, and the loop pushes to `main`.

The same guard runs as a `pre-push` hook inside your clone, so a hand-written `git push` is refused too. That guard catches accidents, not abuse: it is bypassable, and a bypass is attributed to whoever pushed.

## What sync is, and what it is not

```sh
npx -y terum-skills@latest sync
```

`sync` moves the team clone forward. For each configured team it runs `git fetch` and then `git reset --hard origin/main` under that clone's writer lock, and records the fetch in `~/.terum/skills/run/<team>.stamp`. That is all it does to the team.

It exists because every read verb is fetch-free by contract. `ls`, `search` and `status` read the clone exactly as it stands and never move it, so a teammate's publish reaches your machine only when something fetches. The app runs `sync` in the background at launch and on window focus, at most once a minute.

`sync` does not:

- place, copy, move or delete any skill folder on your machine
- push anything, or write anything to the team repository
- edit a local skill you are authoring
- re-clone or repair a clone that is missing, incomplete, or pointing at a different repository

The verb's own help puts it more absolutely than the code does:

```
Fetch each team clone and reset it to origin/main. Nothing on this machine is changed: no placement, no upload, no edit to your skills.
```

Two things are worth knowing about the edges. When a GitHub team's repository answers "not found", `sync` looks for where the team went and, at a terminal, offers to move this machine to the successor. Taking that offer runs `team move`, which does remove and re-place your placed skills from the new team. And in session-hook mode `sync` refreshes two files it put on your machine itself, when they are outdated copies of its own: the bundled `/terum-skills` manual at `~/.claude/skills/terum-skills` and the edit-hook script at `~/.terum/skills/hooks/terum-skills-edit.mjs`. A copy you declined is never installed later, and a file that is not this tool's is never touched.

## The session hook

Setup offers a Claude Code session-start hook, defaulting to No. When installed it runs `sync --hook` at every session start: a fetch of the team clone, a reconcile of what is placed, and a refresh of the managed `/terum-skills` copy and the edit-hook script when they are outdated copies of Terum's own. It prints one line to stdout for Claude and everything else to stderr. Concurrent session starts queue on the clone's writer lock for four seconds; one that still cannot take it reports `<team>: not refreshed (busy)` on stderr and exits 0. The hook entry, what it writes and how to remove it are in [Claude Code integration](../guides/claude-code-integration.md).

## Why it is built this way

**No server.** The only thing outside your machine is the git host. A server would mean an account with Terum, a Terum-held copy of your skills, and an operator you have to trust; a private repository already does distribution, history, access control and offline reads.

**No container.** A skill is a folder with a `SKILL.md` that Claude Code reads. There is no runtime to isolate, and running Claude Code inside a container breaks host authentication, host MCP servers, the editor and browser extensions, and your own global skills and hooks.

**Any git remote.** The team needs a shared git remote, not GitHub specifically. Storage and sync work anywhere git works. Only membership administration needs a collaborator API, which is why `invite` and access-revoking `team remove` are GitHub-only and say so instead of pretending.

**Git-host access is the permission model.** Who may read and write the team's skills is who may read and write the repository. Git hosts cannot scope write access to a subdirectory, so the write guard prevents accidents rather than abuse: a raw `git push` can still get past it, and it is attributed.

**Evals run on your own machine and your own budget.** An eval spawns your Claude Code, so the cost and the login are yours, no CI job holds an API key, and a receipt in the repository is testimony about a run someone on the team actually paid for.
