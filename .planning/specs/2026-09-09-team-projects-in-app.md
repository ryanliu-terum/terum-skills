# terum-skills — team projects, created and filled from the app (spec)

**Status:** BUILT (2026-09-09/10), worktree `/Users/ryanliu/Documents/Terum/skill-management-software-wt-projects`, base `origin/main` @ `2731fce`. Milestone A (§3) on `feat/team-projects`; Milestone B (§4) on `feat/team-projects-add-skills`, stacked on A. §7 records the defaults taken; they are still cheap to veto.
**Parent:** `.planning/specs/2026-09-02-phase-1-build.md` (rev 14, rev-15 note) — §6.0 write guard table (rows a–f), §6 `publish`, §5.2 automatic placement. Where this document restates the parent it is verbatim; where it adds, the reading chosen is stated, not left to the implementer.
**Base:** `origin/main` @ `2731fce`. The primary checkout is on `feat/frame-mode`, which carries no `desktop/`; implementation belongs in a worktree off `origin/main`.
**Trigger:** Ryan, 2026-09-09 — "Can't create a new team project. should be an add button. then a popup with fields: name of the team project (required), link to github repo (optional). should create a project card. once clicked on the project cards, should be an 'add skills' button that suggests options from your local skills into the project skills."

---

## 0. Ground rules

1. Read `AGENTS.md` then `CLAUDE.md` at the repo root first; every invariant there applies. Every team-repo write goes through `safeWrite()`; the guard is the authorization model; shell out only to `git`/`gh` through `src/lib/runner.ts`; a verb is `run(args, io): Promise<Result<…>>` over the `Prompter` and returns `failure(message)` rather than throwing.
2. **One active path per behaviour.** The new verb reuses `parseRef`/`teamForReference` (`src/commands/install.ts:221`), `readTeam` (`src/lib/skills.ts`), `openTeamRepo`/`refreshClone`/`treeText` (`src/lib/teamRepo.ts`), and `normalizeRemote` (`src/lib/remote.ts:148`). No second remote parser, no second team resolver.
3. The desktop app is a shell over CLI verbs (`desktop/src/backend/Backend.ts`). No behaviour is implemented in the app that the CLI cannot do headlessly, and no app screen writes the team repo directly.
4. Gates: §6.

---

## 1. What exists today — why the app cannot do this

A team project is a **named skill set bound to one or more repositories**: `team.json → projects: Record<name, { remotes: string[]; skills: uuid[] }>` (`src/lib/schema.ts:48`). It is not decoration:

- `install.ts:257-262` matches a project's `remotes` against each registered checkout's `origin` to preselect the install destination.
- `eval.ts:435` identifies "the project I am currently inside" the same way.
- §5.2 places a project's endorsed skills when a member syncs inside a matching checkout — the sentence the Marketplace already prints under the Projects section.

Three things block creating one from the app, in dependency order:

1. **No CLI verb creates a project.** `publish <ref> --project <name>` throws `Unknown project <name>.` unless the key exists (`src/commands/publish.ts:59-61`). Every project in every team today was hand-edited into `team.json`.
2. **The write guard refuses it by design.** `guardTeam` (`src/lib/guard.ts:171-177`) admits three team.json rows: (c) `publish` may change `global` and `projects[].skills` only, (d) `team remove` appends to `archived`, (e) `team join` removes your own handle. Row c's own comment: *"project keys, remotes, and every other field are untouchable."* Creating a key, or storing a GitHub URL in `remotes`, is refused before it reaches the remote.
3. **The app has no write path for either half.** `Catalog.projects` is read-only from `ls --json` (`desktop/src/backend/tauri/index.ts:215-218`); the project detail page offers Install, Remove, Edit-in-editor and nothing else (`MarketplaceScreen.tsx:45`). `PublishArgs` in `desktop/src/backend/types.ts:82` has no `project` field, so even endorsing into an existing project is unreachable from the UI.

The sidebar's existing **Add project** (`Sidebar.tsx:32`) is a different concept — it registers a local checkout folder via `checkout add`. It stays where it is and is not merged with this feature; §5 records why.

---

## 2. Decisions taken (Ryan, 2026-09-09)

- **D1 — creating a project is a direct commit to team `main`**, not a pull request, even under `policy.publish: "pr"`. Reason: a new project has an empty skills list, so it endorses nothing; the review-worthy act is adding skills, and the card must appear the moment Create is pressed. `safeWrite` is called with no `branch`, which is the ordinary `main` path (`teamRepo.ts:106`).
- **D2 — the "Add skills" picker offers every local skill**, not only skills already in the team repo. A skill that is not yet in the team is shared first (`connect`) and then endorsed (`publish --project`), with the two steps visible in the UI.
- **D3 — spec first**, then implementation on a branch off `origin/main`.

Endorsement itself is **unchanged**: adding a skill to a project follows the team's existing `policy.publish`. Under `"pr"` that means a pull request, and the app must say so rather than showing the skill as already in the project (§4.3).

---

## 3. Milestone A — `project create`

### 3.1 The verb

```ts
// src/commands/project.ts   (new; modelled on src/commands/checkout.ts)
export interface ProjectArgs extends WithForm {
  kind: 'create';
  name?: string;            // prompted when absent and interactive
  remote?: string;          // optional; the project's repository
  team?: string;            // explicit team when several are configured
  config?: ConfigStore; runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}
export interface ProjectCreated { team: string; name: string; remotes: string[]; skills: 0 }
export async function run(args: ProjectArgs, io: Prompter): Promise<Result<ProjectCreated>>;
```

Registration in `src/cli.ts`, beside the `checkout` group (`cli.ts:67-73`):

```
project create [name] [--remote <url>] [--team <team>]   Create a team project: a name, its repository, and the skills it places
```

`CliVerbs` gains `project?: typeof runProject`, wired the same way `checkout` is (`cli.ts:38,41`).

### 3.2 Behaviour, in order

1. Resolve the team with `teamForReference(config, args.team, undefined, undefined, args.form)`; the team must have a bound handle, else `Team <team> has no joined handle.`
2. `refreshClone(runner, clone, { label: team })` — same reason as publish step 2: the collision check below must be made against the current `team.json`, not a stale clone.
3. Resolve the name. Non-interactive with no `name` → `failure('Specify a project name.')`. Interactive → `io.text('Project name?')`. Validate against §3.4.
4. Resolve the remote. Absent → `remotes: []`. Present → `normalizeRemote(input)`; a parse failure returns that function's own message, unchanged.
5. **The pure mutation**, inside `safeWrite`, against the freshly reset tree (never against the copy read in step 2):
   - re-parse `team.json` with `teamSchema`;
   - refuse if a key equal to the name **case-insensitively** already exists: `<team> already has a project named <existing>.` (§3.4 says why case-insensitive);
   - refuse if the remote normalizes equal to a remote already listed by another project: `<other> already claims <remote>; a repository belongs to one project.` (`install.ts:262` and `eval.ts:435` both take the *first* match, so two projects on one remote is a silently wrong destination, not a tie);
   - otherwise set `projects[name] = { remotes, skills: [] }` and serialize with the same `JSON.stringify(fresh, null, 2) + '\n'` form `publish.ts:endorse` uses.
6. `safeWrite` options: `{ action: 'project', handle: binding.handle, message: '<handle>: create project <name>' }` — no `branch`, i.e. `main` (D1).
7. Print: `Created project <name> in <team>.`, then `Its skills place when a teammate syncs inside <remote>.` when a remote was given, or `No repository yet — add one when the project has a home.` when not. Return `success({ team, name, remotes, skills: 0 })`.
8. `changed === false` from `safeWrite` cannot happen here (step 5 either writes or refuses); if it does, return `failure` rather than reporting a create that did not happen.

### 3.3 Guard row (i)

Add to the parent spec's §6.0 table:

| # | Path | Permitted on |
|---|---|---|
| i | `team.json` `projects` — **add one new key** whose value is `{ remotes: [] or [one remote], skills: [] }` | `project create` only |

`GuardAction` gains `'project'` (`guard.ts:10`). `guardTeam` gains one clause before the final throw:

```ts
if (context.action === 'project' && oneEmptyProjectAdded(before, after)) return; // row i
```

`oneEmptyProjectAdded(before, after)` returns true iff **all** of:
- `sameExcept(before, after, ['projects'])` — every other team.json field byte-identical;
- `Object.keys(after.projects)` equals `Object.keys(before.projects)` plus exactly one new key;
- every pre-existing key's value is deep-equal before and after (no piggybacked edit to another project);
- the new key's `skills` is `[]`, its `remotes` has length 0 or 1, and it carries no other properties (the record is `.passthrough()`, so an unknown extra field must be refused here, not admitted by the schema).

Row (i) is separate from row (c) for the same reason (d) and (e) are separate: creating a name is a different authorization from endorsing into one. Nothing in row (i) permits editing or removing an existing project — see §5.

Threat model unchanged (parent §6.0): the guard **prevents accidents, not abuse**. Per `CLAUDE.md`, a hostile caller is out of scope until a threat model is adopted.

### 3.4 Name and remote rules

```ts
// src/lib/schema.ts, beside teamNameSchema
export const PROJECT_NAME_RULE = 'a project name is 1-64 characters: letters, digits, spaces, dot, underscore, or hyphen, and cannot start with a dot or a space';
export const projectNameSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/, PROJECT_NAME_RULE);
```

The name is stored **as typed** (it is display text: it appears on cards, in `person.projects`, and after `--project`). Collision is checked **case-insensitively** because `publish --project` matches with `Object.hasOwn` — exact — so `Payments` and `payments` would be two indistinguishable cards whose endorsements land in different lists. Spaces are admitted because these are human labels; a shell user quotes them, and the app never shells.

The remote is validated and stored through `normalizeRemote` — the one parser (`remote.ts:87`) — so `team.json` carries the same normalized form `install`/`eval` compare against.

### 3.5 Frames and feature flag

- `src/lib/frames.ts:32` `FRAME_VERBS` gains `'project create'`.
- `src/lib/frames.ts:39` `FRAME_FEATURES` gains `projects: true`.
- `desktop/src/backend/types.ts:12` `FEATURE_KEYS` gains `'projects'`.

An older CLI reports the key absent → `features.projects === false` → the app hides the Add button exactly as `AddProjectRow` hides itself when `checkouts` is false (`Sidebar.tsx:43`). No version sniffing.

### 3.6 Desktop

- `Backend` gains `projects: { create(args: { name: string; remote?: string }): Run<ProjectCreated> }`; the tauri implementation is one line beside `checkouts` (`tauri/index.ts:425`): `run(['project','create','--',name, ...(remote?['--remote',remote]:[])], cliProjectCreated, v=>v, ['clone'])`. The mock backend gains the same method, appending to its `PROJECTS` fixture.
- **Add button** on the Marketplace "Teams / Projects" section header and on the `#/marketplace/projects` list page (`MarketplaceScreen.tsx:23,52`), rendered only when `features.projects`.
- **Dialog** (`components/ui/Dialog.tsx`, the shape `InstallDialog` already uses): title *New project*; field 1 *Project name* (required); field 2 *GitHub repository* (optional, placeholder `https://github.com/org/repo`); Cancel and Create. Create is disabled until a name is typed. **The app checks only what the app already knows** — a name was typed, and no card in `catalog.projects` already carries it case-insensitively; the *format* rule stays the CLI's `projectNameSchema` and its refusal is shown in the dialog verbatim, so the regex is never copied into the frontend where it could drift. A CLI failure leaves the dialog open with the values intact.
- On success: close, invalidate the catalog query, and route to the new project's detail page (`#/marketplace/projects/<key>`), which is what "should create a project card" means for a user who just named one.
- The empty project card must render: `skills 0`, `members 0`, remote `—` when none. `catalogModel` already computes `installed` as `project.skills.length > 0 && …`, so an empty project reads as not-installed — correct, and the detail page must not offer *Install 0 skills*. Until §4 lands, a project with no skills shows a **No skills yet** note in the page actions where the install button would be; §4 replaces that note with **Add skills**.

---

## 4. Milestone B — "Add skills" on a project

### 4.1 Reaching endorsement from the app

`PublishArgs` (`desktop/src/backend/types.ts:82`) gains `project?: string`, passed through as `--project <name>`. This is plumbing that exists in the CLI and is simply unreachable today.

### 4.2 The picker

**Add skills** on the project detail page opens a picker listing the skills on this machine: `library({ kind: 'global' })` plus each registered checkout root (`status.roots` where `kind === 'checkout'`), deduplicated the way the CLI dedupes global over project (parent spec rev 12). Each row is one of three states, decided by joining the local row's skill id against `catalog.skills`:

| Local skill | Row state | What Add does |
|---|---|---|
| already in the team **and** already in `projects[<name>].skills` | *In this project* — not selectable | nothing |
| already in the team, not endorsed here | *Add* | `publish --project <name>` |
| not in the team repo at all | *Share, then add* | `connect <path>` → then `publish --project <name>` |

"In the team" is decided by **joining the local folder's name against `catalog.skills`**, because that is exactly how `publish` itself resolves a ref (`findSkill(clone, team, reference.name)`); the flat store gives the team one `skills/<name>/`, so name is identity on both sides. The two runs are sequential, never nested: `useWorkflow` holds one action at a time and ignores a `run` started from inside another's success callback, so the endorsement waits for the share and only starts if it landed. A declined share closes the dialog (the app's existing convention for a cancelled run) and leaves the skill exactly where it was.

The third row's label is not cosmetic: sharing publishes the skill's **content** to the team repo under the author's name, which is a bigger act than endorsing, and the user must see that before pressing it. The picker shows the count of each kind in its header.

### 4.3 What the app must say afterwards

Under `policy.publish: 'pr'` (the default, and this team's setting) `publish` opens a pull request; `team.json` does **not** change until it merges. The app therefore:

- shows the returned PR URL per skill, as an *Endorsement opened* row, and
- leaves the project's skill count unchanged until a later catalog read shows it.

It must never render the skill as being in the project on the strength of a queued PR. Under `policy.publish: 'push'` the count moves immediately.

Failures are per skill: one refused hygiene check or one closed PR does not roll back the others, and the picker reports each row's own outcome.

### 4.4 Tests

New: `src/commands/__tests__/project.test.ts`, cases in `src/lib/__tests__/guard.test.ts`, `src/__tests__/cli.test.ts`.

Adversarial cases the guard suite must carry (parent §12 acceptance style):
- `project create` diff that also touches `global` → refused;
- `project create` diff that adds a key **and** edits another project's `skills` → refused;
- a new key whose `skills` is non-empty → refused;
- a new key carrying an extra passthrough field → refused;
- two keys added in one diff → refused;
- `publish` adding a project key (row c must still refuse it) → refused;
- the honest create → admitted.

Command suite: name validation table; case-insensitive collision; duplicate-remote refusal; a remote that fails `normalizeRemote`; a concurrent writer landing between refresh and write (the safeWrite re-apply must re-run the collision check on the fresh tree and refuse, not overwrite).

Desktop: `projects.create` wiring test beside the `checkouts` one; a features test that the Add button is absent when `features.projects` is false; a picker test for each of the three row states.

---

## 5. Not in this spec

- **Editing or removing a project** — changing `remotes` after creation, renaming, or deleting a key. Each is its own authorization and its own guard row, and deletion silently un-places skills for every teammate. Consequence to accept knowingly: a project created without a GitHub link cannot be given one from the app until that follow-up lands.
- **Merging with the sidebar's Add project.** That button registers a *local checkout folder*; this one creates a *shared named skill set*. They stay separate surfaces. The word "project" doing both jobs is a live open thread (Terum, "Project naming model ambiguity", 2026-09-09): if the model is renamed, the cost of this feature is the verb string `project create`, the feature key `projects`, and the dialog copy — not its structure.
- **Project membership** (`person.projects`) — written by `profile --project`, already reachable; `features.projectMembers` stays false.
- Any change to how endorsement is reviewed (`policy.publish`).

---

## 6. Gates

From the worktree root: `npm run lint && npm run typecheck && npm test`, and from `desktop/`: `npm run check` (typecheck, lint, vitest, `e2e:routes`). Report real counts against the branch's own baseline; do not quote a baseline from another branch.

**Fidelity:** `desktop/FIDELITY.md` asserts only `locked` rows, and the New-project dialog and the Add-skills picker have **no board on the design canvas**. They therefore ship outside Gate A, and their rows are added as `todo`. If these surfaces are to be pixel-gated, the canvas needs boards first — that is Teddy's lane, not the implementer's, and it is not a blocker for the behaviour.

---

## 7. Defaults chosen here (veto cheap, before implementation starts)

Each is a real fork the spec had to settle to be implementable. The parent spec's convention applies: the reading is stated, and one word from Ryan reverses it.

1. **Verb shape — `project create <name>` as a new top-level group** (mirrors `checkout add`), not `team project create` under the admin group. `project` is already a top-level noun in `ls project <name>`, `install project <name>`, and `uninstall-skill project <name>`; the admin group is membership and access. If the naming thread renames the model, the cost either way is one verb string.
2. **Any joined member may create a project**, not GitHub admins only. Consistent with §6.0's stated model ("prevents accidents, not abuse") and with `CLAUDE.md`'s no-attacker-model rule; admin-gating would also leave generic-git teams — which have no portable admin predicate (parent §6.0) — unable to create a project at all.
3. **Milestones A and B ship as two PRs.** A is a small vertical slice (verb, guard row, dialog) that is useful alone: a project you can create and see. B is the larger flow and depends on nothing in A but the project existing.
