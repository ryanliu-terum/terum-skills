# Team administration

A team is a git repository. Everything on this page either edits a file in that repository or asks
your git host to change who can reach it. There is no server in between, and no account beyond the
one you already have with your host.

## Who is a member, and who is an admin

**Membership is two facts in the repository.** A member has a `people/<handle>.json` file, and their
handle is not in `team.json`'s `archived` list. Nothing else grants or records membership. `status`
reports your own as one of three states, and prints a line for the two that are not `active`:

```
  Your membership: inactive in the local roster.
  Your membership: no entry in the local roster.
```

`inactive` means your handle is archived. `no entry` means the roster has no file for the handle this
machine is configured with.

**Admin is not a Terum concept.** It is GitHub repository admin permission, asked of GitHub at the
moment it matters. `team remove` asks `repos/<owner>/<repo>` for `.permissions.admin` before it
changes anything, and refuses with `Team removal requires GitHub repository admin permission.` when
the answer is not `true`. `status --permissions` adds one network call that lists the repository's admin
collaborators and marks each roster entry; without it, and without `gh`, every entry's admin state is
unknown rather than false.

**`profile --role` is a label.** It writes a free-text `role` string of up to 32 characters onto your
own people file. It grants nothing, is checked by nothing, and anyone can set their own.

A handle is 1 to 39 characters: letters, digits and single internal hyphens, stored lowercase.

## Inviting people

```sh
npx -y terum-skills@latest invite ada grace
```

Invitations are GitHub only. On any other host the command refuses before it sends anything:

```
Access is managed on the host for https://git.example.com/acme/skills.git; this operation is GitHub-only in phase 1.
```

**You need GitHub repository admin permission**, because adding a collaborator does. The CLI does not
check it: it sends the request and GitHub answers. A member without admin gets a `403` back, per
login, and the run fails.

**The whole batch is validated before a single invitation is sent**, so a typo costs nothing. A login
whose syntax is wrong is printed and the run stops with nothing sent. Duplicates are dropped
case-insensitively.

Then one request per login, each with its own line:

| Line | Meaning |
| --- | --- |
| `Invited @ada.` | GitHub created the invitation. |
| `@ada already has access.` | They are already a collaborator. |
| `@ada already has access (owner).` | They own the repository. |
| `Could not invite @ada: there is no GitHub user named @ada. Check the spelling; GitHub logins are case-insensitive but must exist.` | GitHub does not know that login. Retypeable. |
| `Could not invite @ada (GitHub status 403). GitHub caps invitations at 50 per repository per day. <detail>` | The cap. Waiting is the only fix. |
| `Could not invite @ada (GitHub status 403). <detail>` | A permission refusal. Usually you are not an admin. |

The request names no permission level, so GitHub applies its own default for a new collaborator on
that repository. There is no permission argument to pass, and nothing in the CLI narrows it.

At the end, whatever happened, the CLI prints the block to paste to your teammate:

````
Send this to your teammate:
```
npm install -g terum-skills
npx -y terum-skills@latest setup acme/skills

Bare equivalent: npx -y terum-skills@latest team join acme/skills
```
If you have a pending GitHub invitation, setup tries to accept it using your logged-in gh account; without gh authentication, it asks you to accept it in your browser. Git must also have access to this repository.
````

The global install is optional. It exists so the bare `terum-skills` command works on their machine;
the `npx` line works without it.

## Removing someone

```sh
npx -y terum-skills@latest team remove ada-handle
npx -y terum-skills@latest team remove ada-handle --archive-only
```

On GitHub both forms need repository admin permission, and the check runs before either one asks
anything. What `--archive-only` skips is the host itself, which is why it is the only form that also
works off GitHub.

Before asking anything, it checks three things:

1. You are not removing yourself. `You cannot remove yourself; run team leave <team> to leave this
   machine, or ask another admin to remove you.`
2. The member exists on `origin/main`, rather than only in your possibly stale clone. `No member
   ada-handle in acme: people/ada-handle.json is not on origin/main.`
3. They are not the last admin. Only the revoking form asks this. `Refusing to remove ada-handle:
   they are the last remaining admin.`

A fourth check runs later, when the archive commit is prepared: after you confirm, and before
anything is written. No other active member may declare the same GitHub login, because revoking it
would take someone else's access away. `Refusing to remove ada-handle: active member grace-handle
also declares GitHub login @ada; fix the roster before revoking access.`

Removing host access also needs a login to revoke. A roster entry without one can only be archived:
``ada-handle has no GitHub login on the roster, so there is no host access to revoke; run `team
remove ada-handle --archive-only` to archive the membership.``

Then one confirmation:

```
Revoke GitHub access for @ada and archive ada-handle? (y/N)
Archive ada-handle? (y/N)
```

**The roster is archived first, then access is revoked.** The handle is added to `team.json`'s
`archived` list in one commit. Their people file stays, and so does every skill they published:
membership changes, history does not. After that commit lands, the collaborator is removed and any
pending invitation for that login is cancelled.

That order is why there is a retry sentence. If the archive succeeds and GitHub refuses the
revocation, the run says so and tells you the second half is idempotent:

```
ada-handle is archived; @ada's access could not be revoked: <reason>. Re-run team remove ada-handle to retry.
```

When the login turns out to be neither a collaborator nor an invitee, that is reported and the
removal still counts: `@ada is neither a current collaborator nor a pending invitee.`

The last line is `Removed ada-handle from acme.`, or, with `--archive-only`, `Archived ada-handle from
acme. Access remains managed on the host.`

## Leaving a team on one machine

```sh
npx -y terum-skills@latest team leave acme
```

`team leave` is machine-local. It writes nothing to the team repository, and your membership is
unchanged: you keep your people file, your roster entry and your host access.

It prints what it is about to remove, then asks:

```
3 placed skill(s) will be removed.
Local clone at /home/me/.terum/skills/teams/acme will be removed.
2 pending operation(s) will be removed.
Skill consent records will be cleared (5); the next team asks again for skills that need tool permissions.
Leave acme? This removes 3 placed skill(s), the local clone and your skill consent records; your membership in github.com/acme/skills is unchanged.
```

The consent line and the consent clause appear only when this is the last team on the machine.

The teardown removes every placed folder for that team, quarantining any copy whose bytes drifted
from what was placed, then removes the clone, the cache and the run artifacts, then drops the team
from your config. A clone with uncommitted or unpushed work is never deleted:

```
Local clone /home/me/.terum/skills/teams/acme has uncommitted or unpushed work; moved to /home/me/.terum/skills/quarantine/2026-09-16T09-12-04-881Z/teams-acme.
```

On the last team, the session-start hook is removed too, and the run says so.

It ends with the sentence that separates the two meanings of leaving:

```
Left acme. You are still an active member of github.com/acme/skills; an admin archives membership with team remove ada-handle.
```

## Following a repository that moved

```sh
npx -y terum-skills@latest team move acme/shared-skills
```

One machine holds one team, so a repository that was recreated under a new name used to be a
three-command chore. `team move` does it in order: tear the old team down locally, join the target,
then place again every skill the old team had placed here that the new team also shares, at the same
scope.

| Flag | Use |
| --- | --- |
| `--from <team>` | Which configured team to move away from. Needed only when more than one is configured. |
| `--yes` | Skip the confirmation. A non-interactive run without it fails closed. |

```
3 placed skill(s) from acme will be removed, then placed again from the new team where it shares them.
The local clone is replaced; your membership in the old repository is unchanged (it may no longer exist).
Move this machine from acme (https://github.com/acme/skills) to https://github.com/acme/shared-skills? [y/N]
```

The old repository is never touched. It may not exist any more, which is the usual reason for
running this. Skill consent records survive the move, because grants are keyed by skill content and
the same content must not ask twice. The identity this machine already proved is carried over
without asking again.

```
Moved to shared-skills as ada-handle: 3 skill(s) placed again, 1 not shared there (old-thing).
```

A skill the new team does not share is reported, not invented. If the join fails after the teardown,
the message says exactly where you are and how to finish: ``Left acme, but joining
https://github.com/acme/shared-skills failed: <error> Run `npx -y terum-skills@latest team join
acme/shared-skills` to finish the move.``

`sync` offers this move by itself when a GitHub team's repository answers "repository not found". See
[Installing and managing skills](install-and-manage.md#when-a-repository-is-gone).

## Your identity and your profile

Identity is per machine. It is what publish writes into a skill's author line.

```sh
npx -y terum-skills@latest login --set name="Ada Lovelace" --set email=ada@example.com
npx -y terum-skills@latest login --set default-handle=ada-handle
```

The accepted keys are `name`, `email` and `default-handle`, and nothing else: `Accepted keys: name,
email, default-handle.` Every `--set` prints the notice:

```
This changes the author line (Ada Lovelace <ada@example.com>) that publish writes into the skills you publish from this machine; versions already published keep their recorded author.
```

Already-published versions are immutable, so they keep the author they were minted with. Bare `login`
runs the interactive version: it detects `gh`, offers the login when it is missing, asks for the four
identity fields and saves them.

Your profile is per team, and lives in your people file.

| Flag | Field |
| --- | --- |
| `--name <display>` | `display_name`, and your local identity too |
| `--bio <text>` | `bio` |
| `--role <role>` | `role`, a label of up to 32 characters |
| `--project <name>` | `projects`, repeatable, each name checked against the team's projects |
| `--remove <skill>` | Takes one entry off `profile[]`, matched by skill name or uuid |

`profile` refuses to change `email`, `github` or `handle`: those are bound by join and prove who you
are. An unknown project is refused with `Unknown project docs-site.`, and an entry that is not there
with `deploy-check is not on your profile.` It ends with `Updated ada-handle: display_name, profile
(removed deploy-check).` or `No profile changes for ada-handle.`

`profile[]` is what a teammate installs with `install member <handle>`. Publishing adds an entry
without asking; installing offers to. Removing one never touches a file on disk and never unpublishes
anything.

## Team projects

A team project is a named list of skills in `team.json`, with the repositories it belongs to. It is
not a folder, and creating one moves no skill.

```sh
npx -y terum-skills@latest team project create docs-site --remote https://github.com/acme/web
npx -y terum-skills@latest team project delete docs-site
```

Both refresh the clone first, and both ask `Project name?` when the name is omitted at a terminal. A
project name is 1 to 64 characters: letters, digits, spaces, dot, underscore or hyphen, and cannot
start with a dot or a space.

A repository belongs to exactly one project. A second project naming the same remote is refused,
because both readers that use it take the first match, which would make the second project
unreachable:

```
docs-site already claims github.com/acme/web; a repository belongs to one project.
```

A name that clashes case-insensitively with an existing project is refused with `acme already has a
project named Docs.`

`create` prints two lines, and the second depends on whether it has a repository:

```
Created project docs-site in acme.
Its skills place when a teammate syncs inside github.com/acme/web.
```

```
Created project docs-site in acme.
No repository yet — its skills place nowhere automatically until it has one.
```

The promise of automatic placement is not what happens: sync places nothing. What the remote does today is preselect
the destination. When a teammate runs `install project docs-site`, the registered project root whose
`origin` matches is the one already chosen in the `Install to` list.

Skills enter a project one way only:

```sh
npx -y terum-skills@latest publish deploy-check --project docs-site
```

and teammates take the whole list with `install project docs-site`.

`delete` removes the list and never a skill. The confirmation says so, because that is the only
question a person has here:

```
Delete project docs-site from acme? Its 3 skills stay in the marketplace; only the project list is removed.
```

Declining prints `Project docs-site was not deleted.` Deleting prints `Deleted project docs-site from
acme.` and `Its 3 skill(s) are still in the marketplace; install them by name.` This is also how a
team retires a project card it no longer wants.

## Repository layout and maintenance

`status` is the read that answers "what does this machine think the team is": the CLI version, the
configured team and handle, the repository URL, whether the clone is intact, the roster, your own
membership, the shared skill count, and whether the clone is stale. It reads local files and fetches
nothing, and only `--permissions` makes a network call, so `exit 0` means the query worked, not that
the team is reachable.

### Migrating the repository

```sh
npx -y terum-skills@latest team migrate
```

`team migrate` brings a team repository to layout 3: every skill's files move into `v1/`, receipts are
re-keyed to `evals/<id>/v1/` or archived when they describe other bytes, member files are rewritten,
and `team.json` gains `layout_version: 3`. It also re-arms the clone's push guard, on an
already-migrated repository too, so a retry repairs an interrupted run.

It is terminal only. Under `--frames` it refuses:

```
team migrate is a terminal-only operation; run it without --frames after the auto-share removal release has propagated.
```

**Run it once, after every teammate has a CLI that understands layout 3.** Older CLIs reject
`layout_version: 3` by design, so migrating early takes the team offline for whoever has not updated.
Until you migrate, this CLI refuses the repository the other way round:

```
this team repository uses an older layout; an admin should run `team migrate` to upgrade it
```

Everything is planned and validated before anything is written, and a repository it cannot migrate
cleanly is left exactly as it was. Every refusal starts with the same prefix, naming the one thing to
resolve:

```
Migration refused: skills/deploy-check/ already contains a version path; resolve the partial migration before retrying.
```

The outcome is either `Migrated acme to layout 3: 5 skill(s), 12 re-keyed receipt(s), 3 archived
receipt(s), 4 member file(s).` or `acme already uses layout 3; its push guard is re-armed.`

### The GitHub workflow

```sh
npx -y terum-skills@latest team workflow-update --print
```

This verb only prints. It has no write path at all, and without `--print` it refuses:

```
`npx -y terum-skills@latest team workflow-update` is print-only; pass --print.
```

After the YAML it prints `Commit this to .github/workflows/terum-skills.yml in an ordinary PR by
someone with push access.`

The workflow that `team create` commits has four jobs. Two of them do work today:

| Job | Trigger | What it does |
| --- | --- | --- |
| `hygiene` | Pull requests to `main` | Runs `validate` over every skill name touched by the diff under `skills/`. |
| `readme` | Pushes to `main` | Runs `readme` and commits the regenerated `README.md` when it changed. |
| `receipt-check` | Pull requests from a `publish/` branch | Never fires. |
| `publish-comment` | Pull requests from a `publish/` branch | Never fires. |

The last two are left from a design in which publishing opened a pull request. Publish commits
straight to `main` and creates no branch, so no pull request ever has a `publish/` head. `receipt-check`
itself is retired and answers `receipt-check is retired; publish records receipts when it mints a
version.`

The workflow is a committed file in your repository, so this CLI cannot update it. That is why the
update path is a print and a pull request you make yourself.

## Teams on a non-GitHub remote

Storage works on any git remote. Access management does not.

```sh
npx -y terum-skills@latest team create acme --remote https://git.example.com/acme/skills.git
npx -y terum-skills@latest team join https://git.example.com/acme/skills.git
```

`team create --remote` needs an **empty** repository that you already have credentials for. A remote
with branches is refused and points at join instead. No `gh` login is needed on either side: git
access uses your ordinary git credentials, and a credential embedded in the URL is dropped before the
remote reaches git, your config or any message.

| Works | Does not |
| --- | --- |
| Creating, joining, publishing, unpublishing, installing, syncing | `invite` |
| `team remove --archive-only` | `team remove` without `--archive-only` |

Both refusals print the same line, naming the remote as this machine recorded it:

```
Access is managed on the host for https://git.example.com/acme/skills.git; this operation is GitHub-only in phase 1.
```

Add and remove people on the host itself, then archive or restore the roster entry with
`team remove <handle> --archive-only` and `team join`.

One behaviour changes for the better off GitHub: the `README.md` catalogue is regenerated **inside
each commit** the CLI makes, because there is no Action to do it afterwards. On GitHub, the committed
workflow owns that job.

Related: [Publishing a skill](publish.md) · [Installing and managing skills](install-and-manage.md) ·
[How the team repo is laid out](../reference/team-repo.md) ·
[Migrating to layout 3](../migration-layout-3.md) · [CLI reference](../reference/cli.md)
