# Join a team

Someone on the team invites you on GitHub and sends you a command. GitHub emails you its own repository invitation separately. You need git; you do not need the GitHub CLI.

```sh
npx -y terum-skills@latest setup <org>/<repo>
```

`setup` with a target joins and then continues with the rest of the wizard (a project, your existing skills, the evals offer, the three Claude Code hooks). For the join on its own:

```sh
npx -y terum-skills@latest team join <org>/<repo>
```

`team join` still ends with one offer of the session-start hook, after the join itself is durable. It never offers the `/terum-skills` skill or the edit hook; only `setup` does.

`<org>/<repo>` is the GitHub form: it is the only form that can accept an invitation through GitHub's API. Any other git URL is joined with your ambient git credentials and no invitation step, even when it happens to point at github.com.

## What joining does

1. **Checks `gh`.** Installed but logged out, at a terminal, gets the offer "GitHub CLI is installed but logged out. Run `gh auth login` now?".
2. **Accepts the invitation**, or tells you to. See below.
3. **Clones** the repository to `~/.terum/skills/teams/<team>/` and arms the clone's push guard. The team name defaults to the repository name.
4. **Asks for your identity**: `GitHub login (- for none)`, `Team handle`, `Your name`, `Your email`, each with a default where this machine has one, and each asked up to three times against its rule. When all four are already known on this machine they collapse to one `Use this identity?` question.
5. **Sets `user.name` and `user.email` inside the clone only.** Your global git config is not touched.
6. **Pushes your roster entry**, `people/<handle>.json`, as one commit to `main`.
7. **Records the binding** in `~/.terum/skills/config.json` and prints `Joined <team> as <handle>` (or `Rejoined`) followed by the member list.

### Accepting the invitation

With a logged-in `gh`, join lists your pending repository invitations and accepts the matching one for you. Two answers are not failures:

- `Your account already has access to <org>/<repo>; there is no pending invitation to accept. Continuing.`
- `No pending GitHub invitation to <org>/<repo> for your account. Your account cannot read that repository either: if the next step cannot reach it, the person who invited you has not added you on GitHub yet; ask them, then run this again.`

Without `gh`, or with `gh` logged out, join hands the invitation to your browser:

```
Accept the invitation at https://github.com/<org>/<repo>/invitations before continuing.
```

It then asks `Continue after accepting the invitation?`. Answering no cancels the join and writes nothing. Accept the invitation in the browser first, then answer yes, so the clone that follows can reach the repository.

### The handle question

Your handle is how the team repo names you: `people/<handle>.json`, the author line on skills you publish, and `install member <handle>`. A handle is 1 to 39 characters: letters, digits, and single internal hyphens, stored lowercase. It defaults to the handle this machine already uses, and to your GitHub login when there is none.

If another active member already holds it, join prints `Handle <handle> is already in use by an active member.` and asks `Team handle` again, up to three attempts. A handle is fixed once this machine is bound to the team: a later re-join from the same machine carries the bound handle and never asks again. A different machine joining the same team is asked, and reclaims your existing roster entry when the GitHub login or the email on it matches.

### What join writes, and what it does not

Join writes your people file to the team repo, the clone, the git identity inside that clone, and the team binding in `config.json`.

Nothing is installed on join. Joining a team does not place a single skill on your machine, and a team can never place one on your behalf. You choose what to install, afterwards.

## Getting skills

```sh
npx -y terum-skills@latest ls
npx -y terum-skills@latest search <term>
npx -y terum-skills@latest install <skill>
```

`ls` lists the members and the shared skills from your clone, offline. `install` copies the latest version of a skill into Global (`~/.claude/skills`) or into a project you have registered, and asks `Install to` at an interactive terminal; over a pipe, with no projects registered, it goes to Global without asking. `ls --local` shows your own folders and how they relate to the team. See [install and manage skills](../guides/install-and-manage.md) and [Library and Marketplace](../concepts/library-and-marketplace.md).

On macOS and Windows, the app is the same set of commands with a view of the team. See [the desktop app](../guides/desktop-app.md).

## One team per machine

Terum Skills keeps one team per machine. Any verb that would bind a second one refuses before it does anything:

```
One team per machine: This machine is on team <name> (<remote>). Terum Skills keeps one team per machine: run `npx -y terum-skills@latest team leave <name>` first, then re-run `<the command you ran>`.
```

### Leaving

```sh
npx -y terum-skills@latest team leave <name>
```

Leave is local only. It inventories what will go, then asks: "Leave `<name>`? This removes N placed skill(s), the local clone and your skill consent records; your membership in `<remote>` is unchanged." It removes every skill this team placed, the clone, the team's cache and run files, and the config entry. When this was the last team on the machine it also clears your tool-consent records and removes the session hook from `~/.claude/settings.json`, printing `Removed the session hook from <path>.`; an unreadable settings file is reported and leaves the hook in place rather than failing the leave. A placed folder you have edited is moved to quarantine rather than deleted, and a clone holding uncommitted or unpushed work is moved to quarantine rather than deleted. Nothing is written to the team repository, so you stay on the roster:

```
Left <name>. You are still an active member of <remote>; an admin archives membership with team remove <handle>.
```

### Moving to a repository that moved

When the team's repository moves (the owner recreated it somewhere else), do not leave and re-join by hand. Move:

```sh
npx -y terum-skills@latest team move <org>/<repo>
```

It asks once, "Move this machine from `<from>` (`<url>`) to `<url>`?", with the consequences spelled out: the placed skills from the old team are removed and placed again from the new team where it shares them, the local clone is replaced, and your membership in the old repository is unchanged (it may no longer exist). Then it tears the old team down locally, joins the new repository carrying the identity you already proved, and re-places every skill the old team had placed here, at the same scope. It ends with a line naming all three outcomes: "Moved to `<to>` as `<handle>`: N skill(s) placed again, M not shared there (…), K failed." Your tool-consent records survive the move, because they are keyed by skill content.

You usually do not have to notice the move yourself. Two commands offer it:

- **`setup <org>/<repo>`** on a machine already bound to a different team first checks whether the old repository still exists. Only a clear "repository not found" counts; offline or access denied keeps the ordinary one-team refusal. When it is gone, setup prints "Team `<current>`'s repository `<url>` no longer exists on GitHub." and asks "Move this machine from `<current>` to `<url>`?" before doing the move for you.
- **`sync`** at a terminal asks GitHub what replaced a repository that answers "not found": a pending invitation from the same owner, or a repository of theirs you can already reach that carries a `team.json`. It prints one line naming what it found and offers "Move this machine from `<team>` to the replacement?" with the candidates and `Not now`. Over a pipe or in hook mode it prints the `team move` command instead of asking.
