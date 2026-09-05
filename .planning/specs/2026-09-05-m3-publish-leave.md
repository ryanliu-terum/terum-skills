# terum-skills — M3 remainder: `publish` and `team leave` (locked spec)

**Status:** LOCKED for implementation (2026-09-05). Branch `m3-publish-leave`, worktree `/Users/ryanliu/Documents/Terum/terum-codex/m3-publish-leave`, base `origin/main` @ `1bb7617`.
**Parent:** `.planning/specs/2026-09-02-phase-1-build.md` (rev 8) — §6 `publish` and `team leave`, §6.0 `safeWrite` + guard table row (c), §12 "publish branching". Where this document restates the parent it is verbatim; where it adds detail it closes a gap the parent left open, and the reading chosen is stated, not left for the implementer.
**Scope:** exactly two verbs, both already plumbed for on `main`. `safeWrite`'s `branch` parameter, the `--force-with-lease` push, the `<branch>-2` fallback, the `RETRYABLE`/`STALE_LEASE` classifiers, and the guard's `action: 'publish'` row all exist in `src/lib/teamRepo.ts` and `src/lib/guard.ts`; only the verbs are missing. Nothing in `setup` (§6.1) and nothing in M4 is built here.

---

## 0. Ground rules (read before touching a file)

1. **Read `AGENTS.md` at the repo root first, then `CLAUDE.md`.** Every invariant there applies. In particular: every team-repo write goes through `safeWrite()`; the guard is the authorization model; the `placements` ledger is the only source of deletable paths; shell out only to `git` and `gh` through `src/lib/runner.ts`; no verb imports `readline`/`process`/`console` (eslint enforces it); every verb is `run(args, io): Promise<Result<…>>` over the `Prompter` in `src/lib/prompt.ts` and returns `failure(message)` rather than throwing.
2. **A parallel branch (`m1-wave`) is rewriting these files right now. Do not edit them:** `src/lib/auth.ts`, `src/commands/login.ts`, `src/lib/schema.ts`, `src/lib/config.ts`, `src/lib/teamRepo.ts`, `src/lib/remote.ts`, `src/lib/guard.ts`, `src/lib/__tests__/fixtures.ts`, `src/commands/sync.ts`, `src/commands/install.ts`, `src/commands/share.ts`, and every existing test file except `src/__tests__/cli.test.ts`. `src/commands/team.ts` may change in **exactly one string** (§4). Anything you believe needs changing in those files goes into `openQuestions` in the report, with the workaround you used.
3. **Do not use the per-team token.** That parallel branch deletes `gitAuthEnv`, `probeToken`, and `teams.<name>.token` (spec rev 9, Decision 2). Never import `gitAuthEnv`, never read `binding.token`, never pass `token` to `safeWrite`. Ambient credentials (gh on GitHub, the git credential helper elsewhere) are the only credentials.
4. **Files you may create or modify** (nothing else):
   - new `src/commands/publish.ts`, `src/commands/leave.ts`
   - new `src/commands/__tests__/publish.test.ts`, `src/commands/__tests__/leave.test.ts`, `src/__tests__/m3-publish-walkthrough.test.ts`
   - `src/cli.ts` — the two registrations and the `CliVerbs` fields (§5)
   - `src/__tests__/cli.test.ts` — add cases; change no existing assertion
   - `src/commands/uninstall.ts` — extract one helper (§3.2); behaviour of `uninstallOne` unchanged
   - `src/commands/team.ts` — the one string in §4
5. **One active path per behaviour.** `team leave` reuses the placement-removal loop that `uninstallOne` already has by extracting it, not by copying it. `publish` reuses `parseRef`/`teamForReference` from `src/commands/install.ts`, `findSkill`/`readTeam` from `src/lib/skills.ts`, `ghState` from `src/lib/auth.ts` (import it; do not edit that file), `githubOwnerRepo`/`isGitHubRemote`/`stripRemoteCredentials` from `src/lib/remote.ts`, and `openTeamRepo`/`treeText` from `src/lib/teamRepo.ts`.
6. Gates: `npm run lint && npm run typecheck && npm test` from the worktree root. Baseline before this change: lint 0 problems, typecheck clean, vitest **35 files / 284 tests, all passing**. Report your real counts.

---

## 1. `publish <ref> [--project <proj>] [--team <team>]` — the deliberate endorsement act

### 1.1 Parent text (spec §6, verbatim)

> **`publish <name> [--project <proj>]`** — the deliberate team-endorsement act: adds the skill's ID to `team.json global` (default) or the project list. `policy.publish: "pr"` (default): `safeWrite(mutate, { branch: "publish/<name>" })` then `gh pr create` — the branch parameter is what keeps the generic algorithm off `main` (§6.0); merge is the review, and the Action comments on the PR. **A missing `gh` does not downgrade the gate** — under `"pr"` the command pushes the branch, prints the compare URL, and exits telling the user to open the PR; it never falls through to a direct push, because a policy any member can bypass by not installing `gh` is not a policy. Direct commit happens only under `policy.publish: "push"`, a team-level setting in `team.json`, after a y/N showing the skill. **[default — veto cheap: "pr"]**

And §6.0 step 4, verbatim:

> Commit, then push **to `refs/heads/<branch>`** — never to a ref the caller did not name. With the default `main` this is the ordinary path. With `branch: publish/<name>` the commit is created on top of the freshly reset `origin/main` and pushed to that branch only; **`origin/main` is not a push target in this mode and must be byte-identical before and after**. An existing remote `publish/<name>` from an abandoned attempt is reset to the new commit with `--force-with-lease` (safe: the branch is derived, and the lease fails if someone else moved it); a lease failure falls back to `publish/<name>-2` rather than clobbering. On success `publish` runs `gh pr create` against `main`.

Guard table row (c), verbatim: `team.json` `global`/`projects[].skills` — permitted on `publish` only. `src/lib/guard.ts` already implements it (`onlySkillListsChanged`): project **keys**, `remotes`, and every other field are untouchable, so `publish` can add an ID to an existing project list but can never create a project.

### 1.2 Signature

```ts
// src/commands/publish.ts
export interface PublishArgs {
  ref: string;                 // <name> | <team>/<name> | <org>/<repo>/<name>; an 8+ char ID prefix is accepted in the name slot
  project?: string;            // endorse into team.json projects[<project>].skills instead of global
  team?: string;               // explicit team when the ref is bare and several teams are configured
  config?: ConfigStore;
  runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;   // test clock, exactly as install/uninstall take it
}
export type PublishScope = { kind: 'global' } | { kind: 'project'; project: string };
export interface PublishResult {
  team: string; id: string; name: string; scope: PublishScope;
  policy: 'pr' | 'push';
  changed: boolean;            // false when the ID was already listed (nothing pushed, nothing asked)
  branch: string | null;       // 'publish/<name>' or 'publish/<name>-2' under "pr"; null under "push" or when unchanged
  prUrl: string | null;        // what `gh pr create` printed, or null
  compareUrl: string | null;   // the GitHub compare URL when the PR could not be opened by gh; null otherwise
}
export async function run(args: PublishArgs, io: Prompter): Promise<Result<PublishResult>>;
```

### 1.3 Behaviour, in order

1. **Resolve the team.** `parseRef(args.ref)` then `teamForReference(config, reference.team ?? args.team, reference.remote, reference.name)` — the same resolution `uninstall` uses. A ref carrying `@<version>` is an error: `publish endorses a skill by ID, not a version; drop @<version>.` The team must have a bound handle (`config.teams[team].handle`), else `Team <team> has no joined handle.`
2. **Bring the clone current.** `git pull --ff-only` in `store.teamClone(team)` through the runner (as `sync` does; no `env` argument). Failure → `Could not fast-forward <team>: <git's message>`. Reason: the publish policy and the endorsed lists are read from the clone next, and a stale clone must not let a member publish under a policy the team has since changed.
3. **Read policy and skill.** `readTeam(clone)` → `policy.publish` (`'pr' | 'push'`; the schema already restricts it). `findSkill(clone, team, reference.name)` → the `SkillRecord` (`id`, `name`); missing → `No skill <ref> in team <team>.`
4. **Choose the scope.** `--project <p>`: `team.projects[p]` must exist, else `Unknown project <p>.` (publish can never create one — guard row c). Otherwise `{ kind: 'global' }`.
5. **Already endorsed?** If the ID is already in the target list, print `<name> is already endorsed (<global|project p>) in <team>.` and return `success({ …, changed: false, branch: null, prUrl: null, compareUrl: null })`. No prompt, no write, no push.
6. **Under `policy.publish === 'push'` only: the y/N showing the skill.** Print a card, one line each: `name`, the 8-char ID prefix, `terum-category`, `description`, `metadata.author`, `allowed-tools` (the normalized grant string from `record.grants.normalized`, or the literal `none`; a malformed grant prints `allowed-tools: MALFORMED` and still lets the user decide), and the target (`global` or `project <p>`). Then `io.confirm('Publish <name> to <team> (<global|project p>)?')`. Declined → `failure('Publish was cancelled.')` with nothing written. Under `'pr'` there is no confirmation: the pull request is the review.
7. **The pure mutation** (§6.0 step 2 — a function of the tree it is handed and of values closed over before the loop: `id`, `name`, `scope`):
   - `tree.before('team.json')` missing → throw `This repository has no team.json; it is not a terum-skills team repo.`
   - `tree.before('skills/<name>/SKILL.md')` missing, or its parsed `metadata.id !== id` → throw `<name> is no longer in the repository as <id8>; run sync and retry.` (The reset tree may differ from the clone read in step 3; the mutation re-verifies, it does not trust the preflight.)
   - Parse `team.json` with `teamSchema`; if the ID is already in the target list, set nothing (safeWrite then returns `changed: false` — handle it exactly like step 5, since someone else endorsed it between the preflight and the push). Otherwise append the ID and `tree.set('team.json', JSON.stringify(team, null, 2) + '\n')`. Touch nothing else — the guard refuses any other field, and that refusal is correct.
8. **The write.** `openTeamRepo(clone, binding.remote, runner).safeWrite(mutate, options)` with `options = { action: 'publish', handle, message: '<handle>: publish <name>', ...(policy === 'pr' ? { branch: 'publish/<name>' } : {}), ...args.safeWrite }`. **No `token` field.** Under `'push'` the write lands on `main` and the command prints `Published <name> to <team> (<global|project p>).` and returns with `branch: null`.
8a. **An existing `publish/<name>` on the remote** (checked live with `git ls-remote --heads`, before the y/N and before anything is committed) is reused only when its `team.json` already carries THIS endorsement — an abandoned attempt of the same publish, which the lease then refreshes. Any other content is refused: `publish/<name> already exists on the remote with a different endorsement (<compare URL>). Merge or close its pull request, or delete the branch with \`git push origin --delete publish/<name>\`, then retry.` The lease alone cannot protect a pre-existing branch (the loop's own `fetch` refreshes the tracking ref moments before the push), so the parent's "safe: the lease fails if someone else moved it" holds only for a move DURING the write. The mutation also re-reads `policy.publish` from the reset tree and throws if it differs from the policy the branch was chosen under.
9. **Under `'pr'`, after the branch is pushed** (`result.pushedTo` is `publish/<name>` or `publish/<name>-2`):
   - If `isGitHubRemote(binding.remote)` **and** `(await ghState(runner)).authenticated`: run `gh pr create -R <owner/repo> --base main --head <pushedTo> --title "<handle>: publish <name>" --body "<body>"` where `<owner/repo>` is `githubOwnerRepo(binding.remote)` and `<body>` is `Endorse <name> (<id8>) for <team>: <global|project p>.\n\nOpened by terum-skills publish; merge to endorse.` On exit 0, print gh's stdout trimmed (the PR URL) and return `prUrl` set, `compareUrl: null`. On non-zero exit, do **not** retry and do **not** push anywhere else: print the compare URL (below) and return `failure('The endorsement branch <pushedTo> was pushed but gh could not open the pull request: <gh's message>. Open it at <compareUrl>.', value)` with the full `PublishResult` as the value.
   - Otherwise (no gh, gh logged out, or a non-GitHub remote): print `Pushed <pushedTo>. Open a pull request from <pushedTo> into main to complete the endorsement:` and then the compare URL, and return `success` with `prUrl: null`. This is the parent's "exits telling the user to open the PR"; it is a **success** exit — the gate held and the user was told what to do. It must never fall through to a direct push.
   - The compare URL is `https://github.com/<owner>/<repo>/compare/main...<pushedTo>?expand=1` on GitHub. On any other host there is no portable URL: print `<stripRemoteCredentials(remote)> — branch <pushedTo>` on that line instead and set `compareUrl: null`.
10. **Output discipline.** Everything goes through `io.print`; the `Result.error` string is what `src/index.ts` writes to stderr. Never print or log the remote with a credential in it (`stripRemoteCredentials`).

### 1.4 What must be provably true (tests, `src/commands/__tests__/publish.test.ts`)

Use the fixtures exactly as `uninstall.test.ts` and `remove.test.ts` do (`bareTeam`, `pushFromSeed`, `cloneWithIdentity`, `createConfigStore`, `ScriptedPrompter`, `mappedRunner`, `fakeGh`, `wrapRunner`, `git`, `originSha`). Add no fixture to `fixtures.ts`; local helpers live in the test file. Seed one or two skills with `pushFromSeed('skills/<name>/SKILL.md', …)` carrying a UUID `metadata.id`, as those suites do.

1. **`pr` policy with gh present (the parent's §12 case):** `originSha(bare, 'main')` is identical before and after; `refs/heads/publish/<name>` exists on the bare and `git show publish/<name>:team.json` lists the ID in `global`; `gh pr create` was called once with `--base main` and `--head publish/<name>` and `-R acme/team`; the result carries the PR URL the fake gh returned; no `git push` in `runner.calls` targeted `refs/heads/main`.
2. **`pr` policy with gh absent** (`mappedRunner` with no gh handler): same branch pushed, `origin/main` unchanged, `ok: true`, the printed lines contain the compare URL `https://github.com/acme/team/compare/main...publish/<name>?expand=1`, and **no push to `main` ever happened** (assert on `runner.calls`). Also cover **gh installed but logged out** (`fakeGh('me', {}, false)`): identical outcome, and `pr create` never called.
3. **An existing `publish/<name>` from an abandoned attempt:** create it first from the seed clone (`git push origin HEAD:refs/heads/publish/<name>` after an unrelated seed commit), then publish: the lease succeeds, the branch now points at the new commit, `origin/main` unchanged. Then the **failed lease** case, mirroring `teamRepo.test.ts` ("a stale lease falls back to -2"): a `wrapRunner` hook that force-pushes `publish/<name>` from the seed right before our push → `result.value.branch === 'publish/<name>-2'`, `publish/<name>` still points at the seed's commit (clobbered nothing), `origin/main` unchanged.
4. **`push` policy:** seed `team.json` with `policy.publish: 'push'`. With the confirm answered `false`: `ok: false`, error `Publish was cancelled.`, `origin/main` unchanged, no `publish/*` branch created. With `true`: `origin/main` moved by exactly one commit whose message is `<handle>: publish <name>`, `team.json global` lists the ID, and the printed card contains the skill name, the category, and the `allowed-tools` line.
5. **`--project`:** with a project seeded in `team.json`, `--project product` appends to `projects.product.skills` and leaves `global` and `remotes` unchanged; `--project nope` fails with `Unknown project nope.` before any push (assert `runner.calls` has no `push`).
6. **Already endorsed:** seed the ID into `global`; `ok: true`, `changed: false`, no push, no prompt asked (`io.asked` is empty), and the "already endorsed" line printed.
7. **Ref handling:** an unknown name fails with `No skill …`; `name@<tree>` fails with the version message; `<team>/<name>` resolves; with two teams configured a bare ref fails with the existing ambiguity message from `teamForReference` and `--team` resolves it.
8. **Mutation re-verification:** delete the skill from the remote (a seed commit that removes `skills/<name>/SKILL.md`) *after* the clone was pulled but before the write — use `wrapRunner` on the first `fetch` or on `push` as `join.test.ts` does for its race — and assert the failure names the skill and that nothing was pushed.
9. **gh failure after the push:** `pr create` returns exit 1 → `ok: false`, the error contains the compare URL and gh's message, the branch exists on the remote, `origin/main` unchanged, and `pr create` was called exactly once.
10. **Secrets:** with `binding.remote` set to a credential-bearing URL string in config (`https://me:tok@github.com/acme/team.git` stored verbatim), no printed line and no `Result.error` contains `tok`. (The remote is mapped by the runner; assert on `io.lines` and the error only.)

### 1.5 Walkthrough (`src/__tests__/m3-publish-walkthrough.test.ts`)

The §12 two-person slice "publish via PR → teammate prompted and accepts", against the bare fixture with gh absent, in one test:

1. Alice (`aStore`, bound as `seed` — reuse the seed people file the fixture already has) `share`s a skill (as `m2-walkthrough.test.ts` does), then `publish`es it under the default `pr` policy → `publish/<name>` exists, `origin/main` unchanged.
2. Simulate the merge from the seed clone: `git fetch origin`, `git push origin refs/remotes/origin/publish/<name>:main` (a fast-forward), and assert `git show main:team.json` on the bare now lists the ID.
3. Bob (`bStore`, his own people file pushed from the seed, his own clone, `home` under the fixture root) runs interactive `sync` with a `ScriptedPrompter([], [true])`: the prompt `Install 1 newly endorsed skill(s) from team?` is asked exactly once, the skill is placed under Bob's home `.claude/skills/<name>`, and `people/bob.json` on `origin/main` lists it in `installed`.
4. Bob runs `sync` again with a `ScriptedPrompter()` (no answers): nothing is asked, nothing changes — endorsement is offered once and recorded, not nagged.

---

## 2. `team leave <name>` — leave this machine, not the team

### 2.1 Parent text (spec §6, verbatim)

> **`team leave <name>`** — uninstall this team's placements, drop clone + config entry; leaves no repo trace (you remain an active member until an admin runs `team remove`).

### 2.2 The reading chosen (this closes the parent's gap; implement it as written)

"Leaves no repo trace" is read literally: **`team leave` never calls `safeWrite` and never runs `git` at all.** It does not edit `people/<handle>.json`, it does not clear the `installed` list there, and it records no `declined` entry — those are `uninstall`'s semantics for a member who stays, and a departing machine must not write consent decisions the user never made into the shared roster. The people file therefore keeps listing skills this machine no longer has; that is a documented rough edge (the `installed` list is a per-person snapshot, not a per-machine ledger) and `install member <handle>` after a later rejoin re-places them.

Everything `team leave` removes is machine-local and every path it deletes comes from the `placements` ledger or from `ConfigStore` itself:

1. **Placements.** Every `config.placements` entry with `entry.team === name`, via the helper extracted in §3.2: lock the target root, `placer.remove(root, path, entry.fingerprint, <root>/quarantine)` (a hand-edited copy is quarantined, never deleted; a path already missing on disk is fine), print the quarantine line when there is one, delete the ledger entry under `store.update`, release the lock.
2. **The clone.** `rm -rf store.teamClone(name)` if it exists. Also, if present: the version cache `<store.root>/cache/<name>`, the run stamp `<store.root>/run/<name>.stamp`, and the safeWrite lock directory `<store.root>/teams/.<name>.safewrite.lock`.
3. **Config**, in one `store.update`: delete `teams[name]`; delete every `shared` entry whose `team === name` (the source folders themselves are the user's own files outside `~/.terum` and are never touched); drop every `pending` entry for the team; drop any `placements` entry for the team that step 1 did not already remove. `approvals` are left alone — they are consent for grant sets, not team membership.

### 2.3 Signature and behaviour

```ts
// src/commands/leave.ts
export interface LeaveArgs { name: string; config?: ConfigStore; }
export interface LeaveResult { team: string; remote: string; handle: string | null; removed: number; cloneRemoved: boolean; }
export async function run(args: LeaveArgs, io: Prompter): Promise<Result<LeaveResult>>;
```

1. Validate `name` with `parseOrExplain(teamNameSchema, args.name, 'team name')`; `config.teams[name]` missing → `Team <name> is not configured.`
2. Count what will go (placements for the team, whether the clone exists, shared entries, pending entries) and print one summary line per non-zero item, then `io.confirm('Leave <name>? This removes <n> placed skill(s) and the local clone; your membership in <remote> is unchanged.')` — the remote printed through `stripRemoteCredentials`. Declined → `failure('Leave was cancelled.')` with nothing changed. A non-interactive channel throws `PromptClosedError` from the Prompter before anything changes; let it surface as the failure it is.
3. Steps 1–3 of §2.2, in that order (placements first, so a failure inside the Placer leaves config still pointing at a clone the user can inspect).
4. Print `Left <name>. You are still an active member of <remote>; an admin archives membership with team remove <handle>.` and return `success`.
5. Idempotence: a second `team leave <name>` after the first fails at step 1 (`not configured`). A partially completed first run (clone gone, config still bound) reruns cleanly: every removal in §2.2 tolerates an already-missing path.

### 2.4 Tests (`src/commands/__tests__/leave.test.ts`)

1. **The full path:** a team with one global placement and one project placement (build them with `install` as `uninstall.test.ts` does, `home` and a project checkout under the fixture root), one `shared` entry, one `pending` entry, a cache directory and a run stamp created by hand. After `team leave team` with the confirm answered `true`: both placed folders are gone from disk, `placements` is `{}`, `pending` is `[]`, `shared` has no entry for the team, `teams` has no `team`, the clone directory, cache directory, and stamp are gone, `approvals` is unchanged, and **the bare repository's `main` SHA is byte-identical** (no repo trace) — assert `originSha` before and after, and that `people/seed.json` on `main` still lists the installed entries.
3. **Declined:** confirm `false` → `Leave was cancelled.`, every path and every config entry still present.
4. **A hand-edited placement** is moved to quarantine, not deleted: modify the placed `SKILL.md` first, then leave; assert a directory under `<store.root>/quarantine` contains the edited bytes and the notice line was printed.
5. **Two teams:** leaving one leaves the other's placements, clone, and config entry untouched; `--`-free `team leave other` afterwards works too.
6. **Unknown team** fails before any prompt (`io.asked` empty); a second leave of the same name fails the same way.
7. **Rerun after partial completion:** delete the clone directory by hand, leave → `ok: true`, `cloneRemoved: false`, config cleaned.
8. **No git:** wrap `systemRunner` is not even injectable here (`LeaveArgs` has no `runner`) — assert instead that the bare's `main` SHA and the `people/seed.json` blob are unchanged in every passing case.

---

## 3. Shared code

### 3.1 Registration (`src/cli.ts`)

Add `publish?: typeof runPublish` and `leave?: typeof runLeave` to `CliVerbs`, resolve them in `active` like the others, and register:

```ts
team
  .command('leave <name>')
  .description('Remove this team’s placed skills, its local clone, and its config entry from this machine (your membership is unchanged)')
  .action(async (name: string) => execute((io) => active.leave({ name }, io)));
// …after the hidden `readme` command, before the "M2 verbs" block:
program
  .command('publish <ref>')
  .description('Endorse a shared skill for the team: opens a pull request under policy "pr", commits directly under policy "push"')
  .option('--project <project>', 'endorse into the project list instead of the global list')
  .option('--team <team>', 'configured team (required when more than one exists and the ref is bare)')
  .action(async (ref: string, options: { project?: string; team?: string }) => execute((io) => active.publish({ ref, ...options }, io)));
```

Place `team leave` directly after the existing `team remove` registration. Keep the `login` and `team create` registrations byte-identical — the parallel branch changes them. `src/__tests__/cli.test.ts`: one new `it` that parses `publish x --project p --team t` and `team leave t` through the harness and asserts the argument objects; pass stubs for `publish` and `leave` in that test's `buildProgram` call only.

### 3.2 The extracted helper (`src/commands/uninstall.ts`)

Move the per-placement loop that `uninstallOne` runs today —

```ts
for (const [path, entry] of matching) {
  const root = dirname(path);
  const release = await lockTarget(root, basename(path));
  try {
    const removed = await remove(root, path, entry.fingerprint, join(input.store.root, 'quarantine'));
    if (removed.quarantined) io.print(`Local changes at ${path} moved to ${removed.quarantined}.`);
    await input.store.update((fresh) => { delete fresh.placements[path]; });
  } finally { await release(); }
}
```

— into an exported `removePlacements(store: ConfigStore, matching: ReadonlyArray<[string, { fingerprint: string }]>, io: Pick<Prompter, 'print'>): Promise<number>` that returns how many it processed, and call it from both `uninstallOne` and `leave`. `uninstallOne`'s observable behaviour, its `pending` handling, and its `safeWrite` call are unchanged; the existing `uninstall.test.ts` must pass untouched.

---

## 4. The one string in `src/commands/team.ts`

Line 53 today: `'You cannot remove yourself; use team leave when that command is available.'`. Change it to `'You cannot remove yourself; run team leave <team> to leave this machine, or ask another admin to remove you.'` and nothing else in that file. `remove.test.ts` asserts `stringContaining('cannot remove yourself')`, which still holds.

---

## 5. Known interplay with the parallel branch (do not fix here)

- After `team leave`, running `team join` for the same team on the same machine collides with your own live people file under today's `joinMutation` (it requires this machine to be bound to the handle). The `m1-wave` branch changes that rule (spec rev 9 §5.4 reclaim: a matching non-empty GitHub login or email reclaims your own file on an unbound machine). Do not touch `joinMutation`; do not add a workaround; mention it in `openQuestions` only if you find a case this spec's tests cannot pass without it (there should be none — no test here rejoins).
- `SafeWriteOptions.token` still exists on `main`. Do not set it. Existing tests write `token: null` into `config.teams.<name>`; new tests may do the same to satisfy today's schema.

---

## 6. Report

Return the `report.schema.json` object. `openQuestions` must list every place you had to choose a reading this document does not state; `deviations` every requirement above you did not meet; `testsModified` every existing test you changed (expected: only `src/__tests__/cli.test.ts`, additive). Do not commit, do not push, do not stage.
