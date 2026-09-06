# terum-skills

Share private Claude Code skills across a team through one private git repo. No server.

## Get started

Requires Node 22.12 or newer and `git`. Creating a GitHub team requires an authenticated GitHub CLI (`gh`). Joiners can accept an invitation in their browser and use their configured git credentials.

Create a team (first person):

```sh
npx -y terum-skills@latest setup
```

Join a team you were invited to (the block `invite` printed is this command):

```sh
npx -y terum-skills@latest setup <org>/<repo>
```

Have a skill install command from a teammate? Run it directly:

```sh
npx -y terum-skills@latest install <org>/<repo>/<skill>
```

If no teams are configured, this guides you through setup before installing the skill. You will still be asked to confirm setup and permissions. Replace the angle-bracket placeholders with your team's values.

Every step the wizard runs is also a plain verb — `login`, `team create|join`, `share`, `install`, `invite`, `ls`, `search`, `publish`, `sync`, `uninstall`, `team leave`. Run `npx -y terum-skills@latest --help` for the list.

## Install (optional)

These instructions are for npm; other package managers have not been tested.

For a global installation, run `npm install -g terum-skills`. The bare command works when npm's global executable directory is on PATH; then `terum-skills --help` lists every command.

Already ran `npm install terum-skills` without `-g`? npm links the command under that project's `node_modules/.bin` and does not add that directory to your shell PATH. From that folder, run `npx terum-skills setup` to create a team, or `npx terum-skills setup <org>/<repo>` to join one; an npm script or the explicit path `node_modules/.bin/terum-skills` (macOS/Linux) also works. Use `-g` if you want the bare `terum-skills` command.

### `terum-skills: command not found` after `npm install -g`

If a global command is not found, check `npm prefix -g`. On macOS/Linux, add that prefix's `bin` directory to PATH; on Windows, add the prefix itself. If the launcher is missing from that directory, check whether npm's `bin-links` setting is disabled: `npm config get bin-links` should print `true`.
