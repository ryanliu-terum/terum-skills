# Create a team

A team is one private git repository that the team controls. Creating it scaffolds that repository, clones it to this machine, and records you as its first member.

```sh
npx -y terum-skills@latest team create [name]
```

`setup` runs this for you when you pick "Create a new team". Run `team create` directly when you already know the answers, or when you are creating the team against a remote you made yourself.

Creating on GitHub needs a logged-in `gh`. Without one the command stops with what to do instead: "Creating a GitHub team needs the GitHub CLI (gh) in phase 1. Install it from https://cli.github.com and run `gh auth login`, or create the team against an existing empty remote with `npx -y terum-skills@latest team create <name> --remote <url>`." A `gh` that is installed but logged out is offered "GitHub CLI is installed but logged out. Run `gh auth login` now?" first; declining that, or a login that does not take, stops with "GitHub authentication is required to create a team: run `gh auth login` and retry, or create the team against an existing empty remote with `npx -y terum-skills@latest team create <name> --remote <url>`."

This machine can be on one team at a time. A second `team create` is refused before anything is created: "One team per machine: This machine is on team `<name>` (`<remote>`). Terum Skills keeps one team per machine: run `npx -y terum-skills@latest team leave <name>` first, then re-run `…`."

## Options

| Option | What it does |
| --- | --- |
| `--org <org>` | Create the repository under a GitHub organization instead of your own account. |
| `--repo <repo>` | Name the GitHub repository instead of being asked. Default is `<team name>-shared-skills`. |
| `--remote <url>` | Push the scaffold to an existing empty remote instead of creating one on GitHub. Cannot be combined with `--org` or `--repo`. |

## The questions, in order

1. **Team name**, when you did not pass one. A team name is 1 to 100 characters of letters, digits, dot, underscore, or hyphen, and the first character must be a letter or a digit. The name is used for the config entry, the clone folder under `~/.terum/skills/teams/`, and `team.json`. The rule the CLI prints on a rejection says only "cannot start with a dot"; a leading underscore or hyphen is refused as well.
2. **Your identity**: `GitHub login (- for none)`, `Team handle`, `Your name`, `Your email`. Each is offered with a default where this machine has one, taken from your existing config, from `gh api user`, and from `git config --global user.name` and `user.email`. With no login to suggest, that first question reads `GitHub login`. When all four are already known they collapse to one question, `Use this identity?`, with the line `Identity: @handle — Name <email> (GitHub: login)`; answering no asks the four again. A handle is 1 to 39 characters: letters, digits, and single internal hyphens, stored lowercase. Each answer is asked up to three times against its rule, and the third rejection ends the command.
3. **The repository name**, on the GitHub path only. `team create` prints `What should the GitHub repository name be for the team "<team>"? Suggested name: <team>-shared-skills.` and then asks `GitHub repository name` with that suggestion as the default. If GitHub says the name is taken, it prints `The repository name <spec> is already taken on GitHub.` and asks again, up to three attempts in total. A collision on the host never renames your team.

## What is created on GitHub

`team create` runs `gh repo create <repo> --private` (or `<org>/<repo>` with `--org`), so the repository is private from the first moment. It then asks `gh` which owner the name resolved to, and runs `gh repo edit <owner/repo> --delete-branch-on-merge`. That last setting is cosmetic housekeeping for merged branches; if it fails, nothing else changes.

The scaffold is committed in a staging clone and pushed to `main`. It contains:

- `team.json`: `layout_version: 3`, the team name, the seven default categories (`debugging`, `testing`, `docs`, `workflow`, `research`, `infra`, `misc`), an empty `projects` map, an empty `archived` list, and `policy.skill_license: "UNLICENSED"`.
- `people/<your-handle>.json`: your roster entry.
- `skills/`: empty, with a `.gitkeep`. Published versions land here.
- `evals/`: empty, with a `.gitkeep`. Committed receipts land here.
- `README.md`: a heading plus the `terum-skills:begin` and `terum-skills:end` markers.
- `.github/workflows/terum-skills.yml`: the team workflow. On a pull request it validates every skill the diff touches; on a push to `main` it re-renders the repository README between those two markers and commits the result when it changed.

Every field and path is described in [the team repo](../reference/team-repo.md).

Locally, `team create` writes `~/.terum/skills/teams/<team>/` (the clone, on `main`) and the team binding plus your identity defaults in `~/.terum/skills/config.json`.

## The push guard

Every clone is armed with a `pre-push` hook in `.git/hooks`, and `core.hooksPath` is set to that folder. It re-runs this CLI's own write rules over each pushed branch. A deletion or a non-branch ref is refused outright; an existing branch is judged against the content it replaces, a new one from its fork point off `main`. Of the paths that remain, a raw push may change `README.md`, your own `people/<handle>.json`, and a narrow set of `team.json` edits. `skills/` and `evals/` are always refused, because a version is minted by `publish` and a receipt is written by the run that produced it. This exists to stop accidents, not to stop anyone: `git push --no-verify` bypasses it, attributed to you. If the launcher the hook was armed with has been removed, the hook exits 0 with one warning line saying the push was not checked, and tells you to re-run `team join <remote>` to re-arm it.

## Creating on a non-GitHub remote

```sh
npx -y terum-skills@latest team create <name> --remote <url>
```

The remote must already exist and hold no branches. If it has any, the command refuses: "`<remote>` already has branches; `npx -y terum-skills@latest team create --remote` needs an empty repository. To join an existing team run `npx -y terum-skills@latest team join <remote>`." A credential pasted into the URL is dropped before the URL reaches git, config, or any message, and the drop is announced: "Ignored the credential embedded in the remote URL: terum-skills never stores one or passes one to git. Git access uses your configured Git credentials."

This path uses no `gh` at all. Publishing, installing, syncing, and evaluating all work, because they are git operations. What does not work on a non-GitHub remote:

- `invite` refuses: "Access is managed on the host for `<remote>`; this operation is GitHub-only in phase 1." Setup prints the same fact and hands you the join command instead: "Access to `<remote>` is managed on the host; grant it there, then send teammates: `npx -y terum-skills@latest setup <remote>`".
- `team remove` can only archive. Revoking host access is GitHub-only, so a non-GitHub team uses `team remove <handle> --archive-only` and revokes access on its own host.
- The CLI's release probe is off. It runs only when a configured team remote is on GitHub, so `update` says "Release advertisements are not checked on this machine."

## Invite teammates

```sh
npx -y terum-skills@latest invite <github-login> [<github-login>…]
```

Setup asks this as "Invite teammates by inputting their GitHub usernames (comma or space separated; blank to skip)".

The whole batch is validated before a single invitation is sent, so a typo costs nothing. Each login is then added with one GitHub API call per person. GitHub requires repository admin permission to add a collaborator; terum-skills applies no check of its own, so a member without admin gets GitHub's 403 back, and inside setup that ends the wizard after naming what is already durable. The call carries no permission parameter, so each collaborator gets GitHub's default permission for that endpoint, which is write. Anyone you invite can therefore publish to the team repository, which is the intended model: publishing appends an immutable version folder, and any member may publish or unpublish.

GitHub caps invitations at 50 per repository per day. When a refusal is a 403 that mentions invitations, the CLI says so in the failure line.

Per login you get one of:

| Line | Meaning |
| --- | --- |
| `Invited @<login>.` | GitHub created the invitation. |
| `@<login> already has access.` | They are already a collaborator. |
| `@<login> already has access (owner).` | That login owns the repository. |
| `Could not invite @<login>: there is no GitHub user named @<login>. …` | The login does not exist. Inside setup this is re-asked rather than fatal. |

Then the block to send, printed even when some of the invitations failed (a login that fails the syntax check stops the command before any of this, and nothing is sent):

````text
Send this to your teammate:
```
npm install -g terum-skills
npx -y terum-skills@latest setup <owner>/<repo>

Bare equivalent: npx -y terum-skills@latest team join <owner>/<repo>
```
If you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.
````

The fenced middle is there so it pastes cleanly into Slack or email. The `npm install -g` line is optional: it only gives your teammate the bare `terum-skills` command, and the `npx` line below works without it.

Your teammate runs:

```sh
npx -y terum-skills@latest setup <org>/<repo>
```

That is the whole of their side. What it asks them, and how they accept the invitation without `gh`, is in [join a team](join-a-team.md). Running the team day to day, including removing members, is in [team admin](../guides/team-admin.md).
