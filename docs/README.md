# terum-skills documentation

terum-skills evaluates Claude Code skills and shares them across a team through one private git repository. There is no server. The CLI does the work; the desktop app is a window onto it.

Install in one line:

```sh
npx -y terum-skills@latest setup
```

## Getting started

- [Install](getting-started/install.md): requirements by role and platform, what setup asks and writes, updating and uninstalling.
- [Create a team](getting-started/create-a-team.md): the team repository, inviting teammates, the join command.
- [Join a team](getting-started/join-a-team.md): accepting an invitation, one team per machine, moving between teams.
- [Your first eval](getting-started/first-eval.md): evaluate a skill in your Library and read the result.

## Concepts

- [How it works](concepts/how-it-works.md): the model, what runs where, why it is built this way.
- [Library and Marketplace](concepts/library-and-marketplace.md): your skills on disk versus the team's published versions.
- [Versions and identity](concepts/versions-and-identity.md): immutable versions, the content digest, lineage, the incumbent.
- [Privacy and network](concepts/privacy-and-network.md): everything that leaves your machine, and everything that does not.

## Guides

- [Publish](guides/publish.md): from a folder to a team version, and back out with unpublish.
- [Install and manage](guides/install-and-manage.md): installing, destinations, sync, reconcile, quarantine, the skill sub-commands.
- [Team admin](guides/team-admin.md): roles, invitations, removal, projects, migration, non-GitHub remotes.
- [Desktop app](guides/desktop-app.md): getting the app, every screen, settings, updates.
- [Claude Code integration](guides/claude-code-integration.md): the eight skills for Claude Code and Codex, the session hook, the edit hook, the per-machine switch.

## Evaluating skills

- [Overview](evaluating/overview.md): the method, what it adapts, defaults and cost.
- [Hygiene](evaluating/hygiene.md): the deterministic gates, `validate`, `skill fix`.
- [Test assets](evaluating/test-assets.md): cases, triggers, suites, fixtures.
- [Generated evals](evaluating/generated-evals.md): what `eval` writes when a skill has no tests.
- [Running evals](evaluating/running-evals.md): arms, sandboxes, options, batches, the queue, the lock.
- [Results and receipts](evaluating/results-and-receipts.md): the report, the numbers, the receipt, how scores reach cards.
- [Usage](evaluating/usage.md): which placed skills fired on this machine, and what `misses` screens for when one never did.

## Reference

- [CLI](reference/cli.md): every command, argument and option.
- [Team repository](reference/team-repo.md): the on-disk layout, the write model, the guard.
- [Local state](reference/local-state.md): everything written under `~/.terum/skills` and in Claude Code's files.
- [Platforms](reference/platforms.md): macOS, Windows, Linux and WSL notes; performance facts.
- [Frame protocol](frame-protocol.md): driving the CLI from a program.
- [Layout-3 migration](migration-layout-3.md): release notes for `team migrate`.

## Project

- [Roadmap](roadmap.md): what is planned, under consideration, deferred, and not planned.
- [Changelog](../CHANGELOG.md): every release, generated from the release record.
- [Contributing](../CONTRIBUTING.md): building, testing, the documentation gates, adding a verb.
- [Releasing](contributing/release.md): the release PR, the two-stage dispatch, the release workflow, the changelog step.
- [Collaborate with us](../README.md#collaborate-with-us): Discord, issues, email.
