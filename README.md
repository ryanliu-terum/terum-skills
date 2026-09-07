# terum-skills

Share private Claude Code skills across a team through one private git repo. No server.

## Get started

Requires Node 22.12 or newer and `git`. Creating a GitHub team requires an authenticated GitHub CLI (`gh`). Joiners can accept an invitation in their browser and use their configured git credentials; if git is signed in to GitHub differently from gh, `gh auth setup-git --hostname github.com` makes git use gh's account.

Create a team (first person) — on a new machine the wizard asks whether you are creating a team or joining one; re-run it to resume:

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

Every step the wizard runs is also a plain verb — `login`, `team create|join`, `share`, `install`, `invite`, `ls`, `search`, `publish`, `sync`, `uninstall-skill`, `uninstall`, `team leave`. Run `npx -y terum-skills@latest --help` for the list.

## Install (optional)

These instructions are for npm; other package managers have not been tested.

For a global installation, run `npm install -g terum-skills`. The bare command works when npm's global executable directory is on PATH; then `terum-skills --help` lists every command.

Already ran `npm install terum-skills` without `-g`? npm links the command under that project's `node_modules/.bin` and does not add that directory to your shell PATH. From that folder, run `npx terum-skills setup` to create a team, or `npx terum-skills setup <org>/<repo>` to join one; an npm script or the explicit path `node_modules/.bin/terum-skills` (macOS/Linux) also works. Use `-g` if you want the bare `terum-skills` command.

### `terum-skills: command not found` after `npm install -g`

If a global command is not found, check `npm prefix -g`. On macOS/Linux, add that prefix's `bin` directory to PATH; on Windows, add the prefix itself. If the launcher is missing from that directory, check whether npm's `bin-links` setting is disabled: `npm config get bin-links` should print `true`.

## Uninstall

`terum-skills uninstall` (no skill name) removes the tool from this machine: every team you joined
(placed skills, local clones, cache), the Claude Code session-start hook if present, and
`~/.terum/skills` except its recovery data (`quarantine/`, `backups/`). It then prints the one
package-manager line to finish with — `npm uninstall -g terum-skills` for a global install; nothing
for the `npx` form. `terum-skills uninstall-skill <skill>` removes one skill only.

## Updating

Run `terum-skills update` using the copy you want to inspect. It prints that copy's version,
location, release observations and the applicable update command. It never executes a package
manager. `terum-skills --version` prints the running version.

- If installed globally with npm: `npm install -g terum-skills@latest`.
- If managed locally with npm: run `npm install terum-skills@latest` in the declaring project;
  for a dev dependency, use `npm install --save-dev terum-skills@latest`.
- For an npx cache copy: `npx -y terum-skills@latest <command>` requests the registry's `latest`
  release on each run. It does not update other local or global installations. A recorded bare
  or versioned cache request is shown verbatim; it is not evidence of an `@latest` request.
- For a source checkout: update through its normal git workflow, then run `npm run build`.
  The checkout's version does not establish npm publication.
- If the installation method is unknown, update it with the tool that installed that copy.

The session-start hook requests `@latest` at startup and updates no other copy. Its existing entry
is not refreshed by setup; changing the hook command would require a migration.

Release advertisements come from stable tags on the approved terum-skills upstream, with a
10-second git deadline and no HTTP client or npm registry access. The selected policy permits a
probe only when at least one configured team uses GitHub. `update` explicitly checks under that
policy; an interactive `sync` checks at most once a day, and successful and failed attempts both
back off for 24 hours. Hook sync, prune and non-interactive sync never probe. A verified npx `@latest` cache also supplies a local
**observed** release; a running version alone supplies no advertisement.

Eligible commands show a newer release notice last on stderr, at most once per release per day.
Notices are suppressed when stderr is piped, in `CI`, or when `NO_UPDATE_NOTIFIER` or
`TERUM_SKILLS_NO_UPDATE_NOTIFIER` is set. The environment opt-outs also suppress automatic probes;
explicit `update` still produces advice and checks when policy permits. Hook sync, internal
commands, `update`, help and version output never emit the notice. The machine-local
`~/.terum/skills/run/latest-version.json` holds separate observations and acknowledgments; it is
safe to delete. Unknown schemas or identities are ignored and left untouched.

## Releasing

A release is one deliberate action. A maintainer bumps `version` in `package.json` and both `version` fields in `package-lock.json` in a reviewed PR (README changes are shipped changes — the tarball includes it). After that PR is on `main`, run Actions → Release with the version and the full merged commit SHA; the workflow runs the gates, packs once, publishes that tarball to npm with provenance, verifies the registry serves those exact bytes, and only then creates the annotated `v<version>` tag on that commit and a GitHub Release whose notes list the PRs since the previous tag. The controlled workflow advertises only verified publications; tags are immutable release history, not a mirror of npm's `latest` dist-tag. A failed run is re-dispatched with the same version and SHA — the planner finishes whatever step is missing. Tags are never deleted or moved by automation; a wrong tag is an incident decision. Daily, `release-drift.yml` checks every tag against the registry and the Releases. Prerelease versions (`0.2.0-rc.1`) publish under the `next` dist-tag and are marked pre-release. 0.1.0 predates this workflow: it was published by hand, has no provenance, and is recorded as a legacy exception.

### What the tags mean

The `v<x.y.z>` tags on the tool's public repository are release *advertisements*: the controlled release workflow (`release.yml`) creates a tag only after the registry serves that version with a verified digest and provenance, and `release-drift.yml` reports daily any tag without a publication, publication without a tag, or `latest` dist-tag that differs from the highest stable tag. A tag is immutable history and does not follow a later `latest` rollback (product fork 3); the notice therefore says *advertised*, never *published* or *latest*, and `update` prints `npm availability was not checked`. Manual tags, unpublication, and dist-tag changes are outside the workflow's guarantee and are detected, not prevented.
The gate must use the single `PACKAGE_NAME` / `APPROVED_UPSTREAM` pair in `src/lib/package.ts`.

## Troubleshooting

Created a team by mistake? Join the right one with the command its owner sent you (`npx -y terum-skills@latest setup <org>/<repo>`); if its repository name matches a team you already have locally, run `terum-skills team join <org>/<repo> --as <other-name>` instead. Optional cleanup: `terum-skills team leave <accidental-name>` removes it from this machine (your membership is unchanged); delete the repository on GitHub yourself if you do not want it.
