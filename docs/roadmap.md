# Roadmap

Every other page in these docs describes what terum-skills does today. This page is the only one that describes direction: what is decided and unbuilt, what is still an open question, and what has been ruled out.

Nothing here carries a date, and nothing here is a promise. A status says how settled a decision is, not when it lands.

| Status | What it means |
| --- | --- |
| Planned | Decided, not built. |
| Under consideration | An open decision. Both answers are still live. |
| Deferred | Decided to wait. Where a trigger to revisit it is recorded, this page names it. |
| Not planned | Rejected, with the reason. |

## Evaluating skills

- **The heavy answer choosing the sessions.** Planned. `eval` detects a skill that spawns subagents, prints the notice and asks `Use the one-session heavy evaluation mode?`. The decision behind that question is that yes runs one session per arm at `k` of 1 and no runs the skill once per case. Neither branch is wired: the answer reaches the run log and nothing reads it, and the one-session shape comes from an `evals/suite.yaml`, authored or generated, instead. The checkbox the notice's own wording points at is not drawn in the app either.

- **`k` and cost controls.** Under consideration. `--k`, `--parallel`, `--batch` and a queue ship today, and the app and setup's evals step price a run from your earlier receipts before it starts. Whether the engine should choose `k` or the session mode for you is the heavy-answer item on this page. The numbers behind the controls are provisional and recorded as such in the source: `k` defaults to 1 on cost, arms run `sonnet`, and the escalation judge runs `opus`.

- **Boards for a terminal and for an agent session.** Planned. The decision is that there is no MCP server. One skill file per command points at the CLI, the same bytes for Claude Code and for Codex, and the CLI renders each read model as a Markdown or ANSI board behind a global `--format` flag. Neither the flag nor the per-command skills exist yet; setup offers you one skill, `/terum-skills`, which runs any verb for you.

- **A progress bar for a running eval.** Deferred. A batch of evals reports which skill it has reached, and `install`, `publish` and setup's evals step report their steps. Inside a single run the engine reports nothing, so the app shows the run's output lines and a busy indicator until it settles. It is revisited when the engine reports its own phases.

- **Running arms in a container.** Deferred. Each arm is a `claude -p` session on your machine with `--permission-mode acceptEdits`, so a skill under test writes files with your permissions, in a temporary sandbox rather than a container. Hardening that boundary is recorded as an open item and is not built.

- **Evals in CI on a publish pull request.** Not planned. It needs a model API key in the team repo's secrets and has no agreed cost model, and evals run on each member's own Claude Code login instead.

- **A leaderboard across skills.** Not planned. A receipt is comparable only with another run of the same skill under the same provenance, so a number that ranks one skill against another would be arithmetic over runs that were never comparable. A card shows one receipt's own net lift with its provenance beside it.

- **Running cases in parallel inside one eval.** Not planned. The seeded ordering and the receipt's case order depend on cases running in sequence. `--parallel` runs several skills at a time, which is a different thing.

- **Evaluating a skill that works through MCP tools.** Not planned. Arms run with `--strict-mcp-config`, so no MCP server is reachable inside a sandbox, and a skill whose method is calling one cannot be measured by this engine.

## Sharing and the marketplace

- **An index of skills beyond your own team.** Under consideration. Nothing in the record settles whether it happens or what would order it. Today the [Marketplace](concepts/library-and-marketplace.md) shows what your own team has published and its top-rated shelf orders by install count, and `search` reads the local clone of every team configured on this machine with no network call, so a skill in a team you are not a member of is not reachable at all. Anything wider than one team's clone needs a server, and any server we run is a stated non-goal.

- **Favorites and following.** Deferred. The app draws a heart on a skill card and a Follow button on a person, and both are hidden because the CLI reports `favorites` and `follow` as false. Making either real means a list in each person's file in the shared team repo, readable by everyone with repo access, and following is then a one-directional social graph inside the team. It is revisited on a written ruling that a team-visible favorites and following list is acceptable, or on a teammate asking for either control.

- **Last seen on the Members page.** Planned. The column is drawn and hidden, because the CLI reports `lastSeen` as false and nothing committed records activity. The decision taken is to derive it from the last change to the person's committed file and to label it Last active.

- **Scoped invitations.** Not planned. `invite <github-login>` adds someone to the whole team repo as a collaborator, which is the unit GitHub gives, and the scoping section came off the design for that reason. Narrowing an invitation to a project would need a new field in the team file, and that table is closed.

- **Members on a team project.** Deferred. A team project is a name, a repository and a list of skills, and nothing in the team file names a project admin, so the app hides the Members row. It is revisited if a team file's projects gain a member list and an admin.

- **Editing a team project.** Deferred. `team project create` and `team project delete` ship; changing a project's repository, renaming it or editing its key does not. Each is its own authorization and its own guard row, and deleting a key un-places skills for every teammate. The consequence is worth knowing in advance: a team project created without a repository link cannot be given one later from the app.

- **Installing a pinned version.** Deferred. A ref carrying a version is refused with `Installing a previous version is not supported yet; install installs the latest version.` Nothing is lost while this waits, because every published version stays in the team repo under `skills/<name>/v<N>/`.

- **A hosted tier.** Deferred. A hosted dashboard and registry, self-hostable, would add shareable links, live state and contributors who are not on the git host, and it is the surface a paid tier would need. It waits because the product runs with no server at all today.

- **Sharing commands, agents and hooks.** Deferred. Skills are the only unit for now, and a folder carrying a `.claude-plugin` or `hooks` folder is never offered as a candidate to share. `ls --local` lists it with the note `contains plugin or hook definitions`. Commands are cheap to add when someone asks; hooks come back only with a rule that flags and shows what they would run.

- **Star or vote ratings.** Not planned. Install counts already feed the browse views with no new machinery, and a human rating would compete with the thing the evals exist to provide.

- **Relabelling a whole catalogue at once.** Deferred. `publish` suggests a category and `skill category` sets one, so new work lands labelled. A back-fill verb waits for a team with more than about fifteen shared skills still sitting on `misc`, or for a change to the category list itself.

- **A shared folder, such as Dropbox or iCloud, as the team store.** Not planned. Past two people it produces silent conflicts, and it has no history and no review.

## Other agents

- **Placing skills for Codex and other agents.** Deferred. The placer already takes an agent and resolves its folders from a path table, and nothing auto-detects an agent; the table has exactly one row today, `claude-code`. It is revisited when a team needs Codex, Cursor or another agent that table can describe.

- **Evaluating with a non-Claude agent.** Deferred. Every arm is a `claude -p` session on your own login. Agent-agnostic arms are outside the engine's scope for now.

- **One set of files for both hosts.** Planned. The boards above are specified to ship as one skill file per command, the same bytes in Claude Code and Codex, with the CLI detecting which host it runs under and phrasing the next step for that host.

## Desktop app

- **A Linux build.** Deferred. Releases build macOS on arm64 and x64 and Windows on x64 and arm64. On Linux, `npx -y terum-skills@latest app` prints `There is no Linux desktop app yet; everything works from the terminal.` and exits 0, and inside WSL it points you at the Windows side of the same machine. It is revisited when a teammate works on a Linux desktop.

- **Signing and notarization.** Deferred. The macOS bundle is ad-hoc signed and never notarized and the Windows installer is unsigned, so a bundle downloaded from the Releases page in a browser hits Gatekeeper, and a manually run installer trips SmartScreen. Installing through `app` avoids both: it downloads with `gh`, which writes no macOS quarantine flag, and on Windows it runs the installer itself with `/S`. A Developer ID certificate costs an annual fee and brings mandatory notarization.

- **The Inbox.** Deferred. The bell and the Inbox route are hidden: the surface is off and the read model behind it is a declared gap. Two of the item kinds it was drawn with, `update` and `review`, were deleted along with the mechanisms behind them, and the five that remain have no producer. Whoever lights the Inbox decides what the rest of it reports.

- **The onboarding tour.** Deferred. The app's first run drives `setup` from a Boot step, so creating or joining a team does happen in the app. The six-step tour behind that step, Welcome through Style, Basics, Team, Feedback and Done, is drawn but never reached: its read model is a declared gap and the surface is off, so once setup settles you land in the Library. The tour's wording is held until the surface goes live.

- **The Quality tab.** Deferred. A skill page has a Quality tab that says `Hygiene checks and tool grants for this skill will land on this tab.`; the pane behind it, with per-check hygiene results, tool grants, Validate and Fix, is written and switched off, because whether it is ready is not that tab's own call to make. Until it ships, `npx -y terum-skills@latest validate <skill>` gives you the same checks, and [hygiene](evaluating/hygiene.md) explains them.

- **Clickable links in SKILL.md.** Under consideration. A link in a rendered SKILL.md is inert text with its destination printed beside it, and an image is a chip, because the app's opener is scoped to two hosts and a remote image in team text is a tracking beacon. Making a link clickable only when its destination is already on that allowlist is the middle path under discussion.

- **Symlinked skill folders.** Under consideration. A skill folder that is a symbolic link is listed as a refused card: you can see it and its on/off switch still works, but it has no id, and it cannot be published or evaluated. Claude Code follows the link and loads the skill anyway, so the two views of that folder disagree.

- **The full activity feed.** Planned. The Activity tab ships with skill firing counts and says so on the tab: `Install, publish and eval-run history will land on this tab too; only firings are recorded so far.` The drawn feed needs a producer that does not exist yet, in the CLI or anywhere else.

- **Translation.** Not planned. The app is English and that is recorded as a choice rather than left unsaid: the shell carries `lang="en"`, relative times come from one `Intl.RelativeTimeFormat` module, and no string you read is assembled from fragments, but nothing is extracted for translation and no locale is offered. On the CLI side the lines you read are quoted in the build spec, so translating them would be a change to that spec and not only to the code.

## Teams and admin

- **Signing in without the GitHub CLI.** Deferred. `login` and every GitHub operation go through `gh`, which you authenticate once. A device-code flow inside terum-skills is revisited when an admin turns up with neither `gh` nor the patience for a token, or when token scopes cause two support requests.

- **Admin operations on hosts other than GitHub.** Deferred. A team repo on a generic git remote works through your ambient git credentials, but an operation that changes access refuses with `Access is managed on the host for <remote>; this operation is GitHub-only in phase 1.` Adapters for other hosts are deferred, and nothing in the write path forecloses them.

- **Host-side rulesets for folder ownership.** Deferred. The CLI's write guard refuses a commit that touches a path the member does not own, and a pre-push hook runs that guard on every clone. Enforcing the same rule on the host, where no local client can route around it, is for bigger teams on paid plans.

- **Updating the team's workflow for you.** Deferred. `team workflow-update --print` prints the current workflow file and the line `Commit this to .github/workflows/terum-skills.yml in an ordinary PR by someone with push access.`, and the verb deliberately has no write path. A guarded write waits for the template to need a second team-wide bump, or for there to be more team repos than hand migration can carry.

- **A `terum-skills://` link that installs.** Deferred. It is the only path to clicking a link in chat and having the skill install. It needs OS protocol registration, a confirmation dialog and a refusal for a repo you are not a member of, and it pays off once most recipients already have the CLI.

- **Posting to Slack from Share.** Deferred. `invite` prints a block you paste into Slack yourself. Posting it directly needs a Slack app token stored on your machine, and waits until copy-and-paste sharing proves people use it.

- **A roles model of our own.** Not planned. The role beside a name on the Members page is a GitHub repository permission, Admin or Member, read through `status --permissions`; when that lookup is unavailable the CLI reports `unknown` and the app shows a dash rather than defaulting anyone to Member. Admin stays repo admin on the host, read-only in the app: there is no role field in the team file, no verb to change one, and the guard table that would have to admit one is closed.

- **Pending invitations on the Members page.** Planned. The page draws an Invited row, and the decision is that `ls` gains a `--host` flag that reads the repository's pending invitations and its admin list from GitHub, holds them in the process and writes neither to the team repo. Neither the flag nor the list exists yet, so the page shows members only. An invitee has no people file until they join, which is why the row carries no Joined, Skills or Last seen.

- **A published web page for a team's catalogue.** Not planned. On GitHub Free and Team plans a Pages site is public even when the repository is private, which would publish a private team's catalogue. The team repo's README is generated instead, and it is the catalogue.

## Platform and performance

- **Windows figures measured on Windows.** Planned. The performance work was measured on Linux, and every Windows number in it is a model with a stated falsifier rather than a measurement, so a pass on a Windows machine is owed. One known gap stays open there: a hung `git` or `gh` is not group-killed on Windows.

- **A background service, a keep-warm loop or a cached scan on disk.** Not planned. Read commands already share one long-lived CLI process and their results are cached for a minute. The app must never paint a filesystem state that may already be wrong, so there is no polling timer and no cache of the last scan between launches, and the cap of eight concurrent child processes stays where it is.

- **Making the writing commands sub-second.** Not planned. `install`, `publish`, `sync`, `eval`, `uninstall-skill` and the other writing verbs stay on one process per call, because they hold the clone's writer lock and own their own cancellation. Their time is git, the network or a model in any case, and the aim is to show that time rather than hide it. See [platforms](reference/platforms.md) for what each platform costs.

- **Prerelease builds.** Not planned. The version probe compares published releases only, and when the repository advertises a prerelease tag `update` prints `pre-release tags are not compared`. The app's own updater follows the same releases.

## How to influence this

Three ways to reach the maintainers. The Discord is at [discord.gg/SVVzejCf9](https://discord.gg/SVVzejCf9), bugs and feature requests go to [GitHub issues](https://github.com/ryanliu-terum/terum-skills/issues), and ryanliu@terum.ai reaches one of them directly.

An item moves on this page when the decision behind it moves, not when someone asks. So the fastest way to change a line here is to bring the case that changes that decision: what you tried, what it cost you, and what you expected instead.
