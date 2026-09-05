# terum-skills — M3 remainder: `setup` and the §8 hook installer (locked spec)

**Status:** LOCKED for implementation (2026-09-05). Branch `m3-setup`, worktree `/Users/ryanliu/Documents/Terum/terum-codex/setup-wizard`, base `origin/main` @ `765032c`.
**Parent:** `.planning/specs/2026-09-02-phase-1-build.md` (rev 9) — §6.1 `setup`, §8 session-start hook (the settings-file mutation contract and the hook offer), §12 "hook install" and "setup" suites, §13 default 39 (`COMMUNITY_URL`). Where this document restates the parent it is verbatim; where it adds detail it closes a gap the parent left open, and the reading chosen is stated, not left for the implementer.
**Rulings behind this spec:** `.planning/decisions/2026-09-05-phase1-closeout-decision-walk.md` D6 (`COMMUNITY_URL` = the repo Issues page) and D9 (a parallel branch, `m2-sweep`, is rewriting the M2 verbs at the same time — see §0.2).
**Scope:** one verb (`setup`), one library module (`src/lib/hook.ts`: the §8 settings-file contract and the hook offer, which `setup` step 7 and `team create`/`team join` need and which does not exist on `main`), one constant, and the `offerHook: false` plumbing on `team create`/`team join`. **Not built here:** the `run/<team>.lock` hook mutex and the stale-lock rules of §8 (those live in `sync --hook`, which the parallel branch owns; M4 adds them), the pre-push guard hook, Windows, npm packaging.

---

## 0. Ground rules (read before touching a file)

1. **Read `AGENTS.md` at the repo root first, then `CLAUDE.md`.** Every invariant there applies: every team-repo write goes through `safeWrite()`; the guard is the authorization model; the `placements` ledger is the only source of deletable paths; shell out only to `git` and `gh` through `src/lib/runner.ts`; no verb imports `readline`/`process`/`console` (eslint enforces it); every verb is `run(args, io)` over the `Prompter` in `src/lib/prompt.ts`.
2. **A parallel branch (`m2-sweep`) is rewriting these files right now. Do not edit them:** `src/commands/share.ts`, `src/commands/sync.ts`, `src/commands/search.ts`, `src/commands/uninstall.ts`, `src/commands/install.ts`, `src/lib/placer.ts`, `src/lib/placer/**`, `src/lib/guard.ts`, `src/lib/schema.ts`, `src/lib/skills.ts`, `src/lib/teamRepo.ts`, `src/lib/readme.ts`, `src/lib/__tests__/fixtures.ts`, and every existing test file except the ones named in rule 3. Import from them freely.
3. **Files you may create or modify** (nothing else):
   - new `src/lib/hook.ts`, `src/lib/community.ts`, `src/commands/setup.ts`
   - new `src/lib/__tests__/hook.test.ts`, `src/commands/__tests__/setup.test.ts`, `src/__tests__/m3-setup-walkthrough.test.ts`
   - `src/commands/team.ts` — the `offerHook` plumbing in §3.1 only
   - `src/commands/leave.ts` — the last-team hook removal in §3.2 only
   - `src/lib/auth.ts` — nothing, unless §1.3 step 2 turns out to need a helper that does not exist; say so in the report if you touch it
   - `src/cli.ts` — the `setup` registration and its `CliVerbs` field (§3.3)
   - `src/__tests__/cli.test.ts`, `src/commands/__tests__/create.test.ts`, `src/commands/__tests__/join.test.ts`, `src/commands/__tests__/leave.test.ts` — **add** cases; change no existing assertion
4. **`setup` owns no write path and no consent prompt.** Every write it causes is a verb's own `safeWrite`; every placement is the Placer's; every consent y/N (the hook, the endorsed set, per-skill `allowed-tools`, the `share` frontmatter) is asked by the verb that defines it, on the same `Prompter` object `setup` was given. `setup` never wraps, filters, pre-answers, or replays a prompt. §1.4 carries the test that proves it cannot.
5. **One active path per behaviour.** The hook offer is one function (`offerHook` in `hook.ts`) called from three places (`team create`, `team join`, `setup` step 7). Identity questions belong to `team create`/`team join` (their `collectIdentity` calls) and are asked once — `setup` never asks them itself (§1.3 step 2, the reading chosen). Repository access checks belong to the verbs. `setup` reuses `parseJoinTarget` from `src/commands/team.ts`, `teamByRemote` from `src/lib/auth.ts`, `isGitHubRemote`/`githubOwnerRepo`/`stripRemoteCredentials` from `src/lib/remote.ts`, `readPeople`/`activePeople` from `src/lib/readme.ts`, `AGENT_PATHS` from `src/lib/placer/agent-paths.ts`, and `exists` from `src/lib/fs.ts`.
6. **No token, anywhere.** Nothing prompts for, stores, or passes a credential (rev 9, Decision 2). The `Prompter` has no `secret` method and must not gain one.
7. Gates: `npm run lint && npm run typecheck && npm test` from the worktree root. Baseline before this change: lint 0 problems, typecheck clean, vitest **40 files / 340 tests, all passing**. Report your real counts.

---

## 1. `setup [<target>]` — the onboarding wizard

### 1.1 Parent text (spec §6.1, verbatim where it matters)

> `setup [<org>/<repo> | <remote-url>]` is the single onboarding entry point, for a team creator (no argument) and for a joiner (the target the invite block printed). It is a **sequencer over the verbs above and owns no write path of its own** … `setup` cannot skip, pre-answer, or batch any of them; it calls `run(args, io)` on each verb with the same terminal `Prompter` (§3) and lets the verb ask.

> **Resumable by outcome, not by a state file.** `setup` records nothing of its own. Each step that writes is skipped when its outcome is already present … Print-only steps always run. Re-running `setup` after an interruption therefore continues from the first unfinished step and can never create a second repo, a second people file, or a second hook entry.

> **Errors.** A step that fails … prints the verb's own error and exits non-zero at that step; the user re-runs `setup` and it resumes there. `setup` never retries a verb itself and never unwinds a completed step.

### 1.2 Signature

```ts
// src/commands/setup.ts
export interface SetupVerbs {           // injection seam for tests; defaults are the real verbs
  team: typeof import('./team.js').run;
  share: typeof import('./share.js').run;
  invite: typeof import('./invite.js').run;
  offerHook: typeof import('../lib/hook.js').offerHook;
}
export interface SetupArgs {
  target?: string;                       // absent → creator; `<org>/<repo>` or a remote URL → joiner
  config?: ConfigStore; runner?: Runner; home?: string;   // test seams, as every other verb
  hook?: HookOptions;                    // see §2.2; defaults to the real settings file and backup dir
  communityUrl?: string;                 // defaults to COMMUNITY_URL; '' skips step 6
  verbs?: Partial<SetupVerbs>;
}
export type StepOutcome = 'done' | 'skipped' | 'printed';
export interface SetupResult { role: 'creator' | 'joiner'; team: string; remote: string; steps: Record<'welcome' | 'github' | 'team' | 'actions' | 'invite' | 'community' | 'hook' | 'done', StepOutcome>; }
export async function run(args: SetupArgs, io: Prompter): Promise<Result<SetupResult>>;
```

`role` is decided by `args.target` alone. `steps` records what each step did on this run, so tests and the report can pin resumption without a state file.

### 1.3 Behaviour, in order

Every line below goes through `io.print`. `Result.error` is what `src/index.ts` writes to stderr. A step that throws ends the run: return `failure(<the verb's own message>)` with a `SetupResult` whose `steps` shows where it stopped — never retry, never unwind.

1. **Welcome** (`printed`, always). Print exactly these lines, in order:
   ```
   Welcome to terum-skills.
   Your team's skills live in one private git repository the team controls; each member installs what they want, edits flow back on sync, and the team endorses the ones everyone should have.
   This wizard will check GitHub, set up your team, share a first skill, invite teammates, and offer the session hook. Re-run it any time; finished steps are skipped.
   ```
2. **GitHub** (`done` | `skipped`). The reading chosen: **step 2 is gh detection plus the gh offer, and nothing else** — identity questions are asked once, by `team create` or `team join` in step 3 (their own `collectIdentity`), because a wizard that asked them here and let the verb ask again would ask every question twice, and a wizard that pre-answered the verb's questions would be the bypass rule 4 forbids. Concretely: `const gh = await detectOrOfferGh(io, runner)` (`src/lib/auth.ts`; it makes the `gh auth login` offer at most once and only on an interactive channel).
   - **Creator:** `gh.authenticated` → print `GitHub: gh is logged in.` and record `done`. Otherwise stop: `failure` with the exact message `authenticateCreator` produces for the same state (call `explainGhFailure(runner)` / reuse its wording — do not invent a third phrasing). The re-run resumes here.
   - **Joiner:** nothing is required. Print one of `GitHub: gh is logged in; the invitation will be accepted for you.` / `GitHub: gh is installed but logged out; you will be asked to accept the invitation in your browser.` / `GitHub: gh is not installed; you will be asked to accept the invitation in your browser.` Record `done`.
   - **Skip rule:** none beyond the above — detection is read-only and cheap, and the offer is self-limiting.
3. **Team** (`done` | `skipped`).
   - **Creator:** if `Object.keys(config.teams).length > 0` → print `Team <name> is already configured on this machine.` for the first configured team, record `skipped`, and carry that team forward. Otherwise `await verbs.team({ kind: 'create', offerHook: false, config, runner }, io)`; `team create` asks the team name and the repository name itself (Decision 5) and collects identity. A failure is this step's failure. On success carry `value.team`/`value.remote` forward (read the exact `CreateResult` shape from `team.ts`). The reading chosen for the parent's "and an optional org": **not asked in phase 1** — `team create --org` is the way to create under an organization; `setup` passes no `org`. Say so in the report.
   - **Joiner:** parse the target with `parseJoinTarget(target)` (throws on an invalid target — that is this step's failure). If `teamByRemote(config, normalizedRemote)` finds a configured team whose `handle` is set → print `Team <name> is already configured on this machine.`, record `skipped`, carry it forward. Otherwise `await verbs.team({ kind: 'join', target, offerHook: false, config, runner }, io)`; `team join` does the handle collision check, the invitation accept (with the browser URL and a y/N when gh is not logged in), the endorsed-set y/N, and the per-skill `allowed-tools` prompts — all on `io`, none of them `setup`'s.
4. **First actions** (`done` | `skipped` for the share offer; the one-liners are always printed).
   - **Creator:** list the directories directly under `AGENT_PATHS['claude-code'].global(home)` that contain a `SKILL.md`, minus any whose resolved path equals a `config.shared[*].source` (already shared) or a key of `config.placements` (placed by us — not the user's to share). If the list is empty → print `No unshared skills under <that directory>.` and record `skipped`. Otherwise `const choice = await io.select('Share a skill with the team?', [...names, 'skip'])`; on `'skip'` record `skipped`; else `await verbs.share({ path: join(root, choice), team, config, runner }, io)` — `share`'s own "Will add …" lines and its `Share <name>?` y/N follow, asked by `share`. A `share` failure is this step's failure.
   - **Both roles, always:** print exactly
     ```
     Next, from any terminal:
       terum-skills install <team>/<skill>   — install a shared skill (add @<version> to pin it)
       terum-skills ls                       — list members and shared skills
       terum-skills search <term>            — find a skill by name, description, or category
       terum-skills sync                     — pull updates and finish pending work
       terum-skills publish <skill>          — endorse a skill for the whole team
     ```
     with `<team>` replaced by the carried team name. **The strings `eval` and `ui` must not appear anywhere in the wizard's output** (§6.1: reserved steps are absent, not stubbed).
5. **Invite** (`done` | `skipped`). Creator only; a joiner never sees this step (record `skipped`).
   - GitHub remote (`isGitHubRemote(remote)`): `const answer = await io.text('GitHub logins to invite (space or comma separated; blank to skip)', '')`; split on `/[\s,]+/`, drop empties; none → `skipped`. Else `await verbs.invite({ logins, team, config, runner }, io)` — `invite` prints its per-login lines and the Slack-ready block. The parent's "every named invitee already has access" skip is `invite`'s own 204 path; nothing extra here.
   - Generic-git remote: print `Access to <remote> is managed on the host; grant it there, then send teammates: npx -y terum-skills@latest setup <remote>` (remote through `stripRemoteCredentials`) and record `skipped`.
6. **Community** (`printed` | `skipped`). `const url = args.communityUrl ?? COMMUNITY_URL`; empty → `skipped`, nothing printed. Else print `Feedback and requests: <url>` — printed, never opened.
7. **Hook** (`done` | `skipped`). `const outcome = await verbs.offerHook(io, hookOptions)` (§2.3). `'present'` → `skipped` (the offer function prints its own one line and asks nothing); `'installed'`/`'replaced'` → `done`; `'declined'` → `skipped`.
8. **Done** (`printed`, always). Print the roster (`Members:` then one `  @<handle> — <display_name>` per active person, from `readPeople(clone)` + `activePeople(people, team.json archived)`), then `Repository: <url>` and `README: <url>`. For a GitHub remote the URLs are `https://github.com/<owner>/<repo>` and `https://github.com/<owner>/<repo>/blob/main/README.md`; for any other host print the stripped remote for both. Return `success` with the `SetupResult`. **This is the line phase 2 replaces with opening the local UI.**

### 1.4 What must be provably true (`src/commands/__tests__/setup.test.ts`)

Use the fixtures as `create.test.ts`, `join.test.ts`, and `leave.test.ts` do (`bareTeam`, `pushFromSeed`, `cloneWithIdentity`, `createConfigStore`, `ScriptedPrompter`, `mappedRunner`, `fakeGh`, `wrapRunner`, `git`, `originSha`; `fakeGh` handlers for `repo create` as `create.test.ts` sets them up). Add no fixture to `fixtures.ts`; local helpers live in the test file. Every hook-touching case passes `hook: { settingsFile: join(root, 'settings.json'), backupDir: join(root, 'backups') }` — **never the real `~/.claude/settings.json`**.

1. **Creator, end to end, gh logged in:** `setup` with no target → the welcome lines; `GitHub: gh is logged in.`; `team create` asked `Team name` and `GitHub repository name [...]` on the same `io` (assert on `io.asked`); one skill folder under the test home is offered via `select` and shared after `share`'s own `Share <name>?` y/N; the five one-liners with the team name substituted; the invite question, two logins invited (assert on the fake gh calls); the community line; the hook y/N asked exactly once, then the settings file contains one `SessionStart` entry whose command contains `terum-skills`; `Members:` shows the creator; `Repository:`/`README:` lines; `ok: true` with every step `done`/`printed` as appropriate.
2. **Interrupt after `team create`, before invite, then rerun** (§12): drive a run whose `verbs.share` throws after `team create` returned; rerun with the same store → `steps.team === 'skipped'`, `gh repo create` was called exactly once across both runs (assert on the recorded gh calls), the people file on `origin/main` is one file, and the run continues through invite, community, hook, done.
3. **Joiner interrupted after the people file lands, before step 7, then rerun:** seed a team, run `setup <org>/<repo>` with a `verbs.invite`-independent failure injected at step 6 (pass a `communityUrl` and make the hook seam throw once), rerun → `steps.team === 'skipped'`, exactly one `people/<handle>.json` on `origin/main` (assert the tree), and the hook question asked **exactly once across both runs** (`countAsked`).
4. **Already configured machine:** config already binds the team, the people file exists, the settings file already carries the entry → `steps` shows `team: skipped`, `hook: skipped`, `actions.share` skipped when nothing is unshared, print-only steps ran (welcome, one-liners, community, done), `ok: true`, and **no `safeWrite` push happened** (assert no `git push` in the recorded calls).
5. **`setup` is never the answerer:** stub `verbs.share`, `verbs.invite`, and `verbs.offerHook` with functions that record the `io` object they received and ask one question on it; assert each received **the very same `io` instance** `setup` was given (`toBe`), that their questions appear in `io.asked`, and that `io.asked` contains no entry `setup` asked other than `Share a skill with the team?` and the invite-logins question. Also assert, on a real run, that the strings `Approve`, `Install`, `Share`-with-a-question-mark, and the hook question were asked by their verbs (present in `io.asked`) and that `setup.ts` contains no call to `io.confirm` (read the source in the test, or assert structurally through the stub).
6. **`offerHook: false` and the direct path:** `team create` called directly (no `setup`) offers the hook once; called with `offerHook: false` it asks nothing about the hook; `setup` step 7 then asks exactly once. Same for `team join`. (The direct-path halves belong in `create.test.ts`/`join.test.ts`, additive.)
7. **Generic-git remote skips step 5 with the host message:** a creator whose configured team remote is a bare path (`team create --remote` style seed) → the invite question is never asked, the host line is printed, `steps.invite === 'skipped'`.
8. **Nobody is ever asked for a token:** for the creator run and the joiner run, assert `io.asked` **equals** the exact list of questions the verbs and the wizard ask (write the list out); a credential prompt of any wording would break the equality.
9. **No `eval` or `ui` string** in `io.lines` (case-insensitive, whole-word) for both roles.
10. **Empty `COMMUNITY_URL` skips step 6:** `communityUrl: ''` → no `Feedback` line, `steps.community === 'skipped'`; the default constant → the line with the Issues URL.
11. **A joiner never sees invite:** `steps.invite === 'skipped'`, the logins question absent from `io.asked`.
12. **Failure stops at the step, non-zero, resumable:** a creator with gh logged out (`fakeGh('me', {}, false)` and a non-interactive prompter so no offer is made) → `ok: false`, the error is `authenticateCreator`'s wording, `steps.team` undefined/absent, nothing pushed.

### 1.5 Walkthrough (`src/__tests__/m3-setup-walkthrough.test.ts`)

The §12 two-person slice as far as it can run against the bare fixture with a fake gh, in one test: Alice runs `setup` (creator) — creates the team, shares one skill, invites `bob`; Bob runs `setup <org>/<repo>` (joiner) against the same bare remote with his own store and home — joins, is offered the endorsed set (empty at this point, so no prompt), sees the one-liners, gets the hook y/N once, and the done block lists `@alice` and `@bob`. Then Alice `publish`es the shared skill (`policy.publish: 'push'` seeded, or the `pr` path with a simulated merge as `m3-publish-walkthrough.test.ts` does) and Bob's next interactive `sync` asks the endorsed-set y/N exactly once. Assert on `origin/main`'s tree (two people files, one skill), on both settings files (one entry each), and on the absence of any `git push` to `main` from `setup` itself outside the verbs' own writes (the verbs' pushes are expected; `setup` adds none).

---

## 2. `src/lib/hook.ts` — the §8 settings-file contract and the offer

### 2.1 Parent text (spec §8, verbatim)

> Installed only after y/N at create/join — or, when those verbs run inside `setup`, at the wizard's step 7 (§6.1) — into **`~/.claude/settings.json`**. Exactly one offer per run, never silent, never two.

The literal settings block:

```jsonc
{ "hooks": { "SessionStart": [ { "matcher": "startup", "hooks": [ {
  "type": "command",
  "command": "npx -y terum-skills@latest sync --hook",
  "async": true, "timeout": 60
} ] } ] } }
```

> **Settings-file mutation contract.** Target `~/.claude/settings.json`. Absent → create it, mode 0600, containing only this hook. **Parse before write.** Unparseable JSON → refuse, print the path, change nothing. **Idempotency key** is a SessionStart hook entry whose `command` contains `terum-skills`. Present → replace **in place**; absent → append. **Preserve everything else** … **Write atomically**: temp file in the same directory, `fsync`, `rename` over the target. **Back up** the previous contents to `~/.terum/skills/backups/settings.<ISO8601>.json` before the first modification on a machine. **Removal** (`team leave` of the last team) deletes only the entry matching the idempotency key, leaves the rest of the file alone, and removes nothing if the key is absent.

### 2.2 API

```ts
// src/lib/hook.ts
export const HOOK_COMMAND = 'npx -y terum-skills@latest sync --hook';
export const HOOK_ENTRY = { matcher: 'startup', hooks: [{ type: 'command', command: HOOK_COMMAND, async: true, timeout: 60 }] } as const;
export interface HookOptions { settingsFile?: string; backupDir?: string; }   // defaults: join(homedir(), '.claude', 'settings.json') and join(<ConfigStore root>, 'backups')
export function defaultHookOptions(storeRoot: string, home?: string): Required<HookOptions>;
export async function hookInstalled(settingsFile: string): Promise<boolean>;
export async function installHook(options: Required<HookOptions>): Promise<'installed' | 'replaced'>;
export async function removeHook(options: Required<HookOptions>): Promise<'removed' | 'absent'>;
export async function offerHook(io: Prompter, options: Required<HookOptions>): Promise<'installed' | 'replaced' | 'declined' | 'present'>;
```

Readings chosen where §8 is silent:
- **The idempotency key** matches any element of `hooks.SessionStart[]` that has a `hooks[]` array containing a command whose string includes `terum-skills` (so a hand-edited command such as `npx terum-skills sync --hook` still counts). "Replace in place" replaces that whole element with `HOOK_ENTRY` at the same index.
- **Shape tolerance:** `hooks` absent → create it; `hooks.SessionStart` absent → create the array; `hooks.SessionStart` present but not an array, or the file's top level not an object → treat as **unparseable for our purposes**: refuse, name the path, change nothing (the parent's parse-before-write rule, applied to shape as well as syntax).
- **Preserve everything else:** parse with `JSON.parse`, mutate the object in place, serialize with `JSON.stringify(value, null, 2)` plus a trailing newline. Key order is preserved by object semantics; formatting is normalized to two-space indent. That is the "where the JSON round-trips" caveat: byte identity for the rest of the file is not promised, content identity is.
- **Backup** happens once per machine: if `backupDir` contains no `settings.*.json` yet and the settings file exists, copy it to `<backupDir>/settings.<ISO8601 with ':' and '.' replaced by '-'>.json` (`mkdir -p` with mode 0700) before the first write. Later installs and removals do not back up again.
- **Removal:** delete only the matching element(s); if `SessionStart` becomes empty delete the `SessionStart` key; if `hooks` becomes empty delete `hooks`. Never delete the file. `'absent'` when the file does not exist or carries no matching entry — and then write nothing.
- **Atomic write:** `writeFile(<same dir>/.settings.json.<random>.tmp)`, `fsync` via an open file handle, `rename` over the target, `rm` the temp on any failure. A new file is created with mode 0600; an existing file's mode is left alone.

### 2.3 The offer

`offerHook(io, options)`:
- `await hookInstalled(settingsFile)` → `true`: print `Session hook already installed in <settingsFile>.` and return `'present'` (asks nothing; §6.1 step 7's "skipped without asking").
- Otherwise ask exactly once: `io.confirm('Install the Claude Code session-start hook so team skills sync automatically? (edits ' + settingsFile + ')')`. `false` → print `Skipped the session hook; re-run setup to install it later.` and return `'declined'`. `true` → `installHook`, print `Installed the session hook in <settingsFile> (backup in <backupDir>).` (omit the backup clause when no backup was taken), return the install outcome.
- An unparseable settings file surfaces as the thrown error `Cannot edit <settingsFile>: it is not valid JSON. Fix it by hand or move it aside, then re-run.` — the caller (verb or wizard) lets it end the step.

### 2.4 Tests (`src/lib/__tests__/hook.test.ts`) — the §12 "hook install" suite

1. **Absent file → created** with mode 0600 (skip the mode assertion on win32), containing exactly `{ hooks: { SessionStart: [HOOK_ENTRY] } }`, and no backup taken.
2. **An existing unrelated `SessionStart` hook survives:** a file with `{ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }], other: 1 }, theme: 'dark' }` → after install, `SessionStart` has two elements, ours last, `other` and `theme` intact; a backup exists with the original bytes.
3. **Repeat install is idempotent:** install twice → one matching element; a hand-edited variant (`command: 'npx terum-skills sync --hook'`) is replaced in place at its index, count stays one; returns `'replaced'`.
4. **Malformed JSON refuses:** `{ not json` → `installHook` rejects with the exact message in §2.3, the file bytes are unchanged, no temp file remains in the directory.
5. **Interrupted rename leaves a valid file:** inject a failure between the temp write and the rename (e.g. wrap `rename` through a seam or make the target directory read-only after the temp write on POSIX) → the original file is intact and parseable, and the temp file is gone or ignorable; a following install succeeds.
6. **Removal:** `removeHook` deletes only our element (the unrelated hook and every other key survive); with no matching element returns `'absent'` and writes nothing (mtime unchanged); an absent file returns `'absent'`.
7. **`offerHook` outcomes:** present → `'present'`, nothing asked; declined → `'declined'`, file untouched; accepted → `'installed'` and the confirm question asked exactly once.

---

## 3. Shared code

### 3.1 `offerHook` plumbing in `src/commands/team.ts`

`CreateArgs` and `JoinArgs` gain `offerHook?: boolean` (default `true`) and `TeamDependencies` gains `hook?: HookOptions`. After a **successful** create or join (after the roster print, before returning), `if (args.offerHook !== false) await offerHook(io, resolvedHookOptions)`. The offer's outcome does not change the verb's `Result` (a declined hook is still a successful create). Replace the stale comment at the top of the file (`The §8 hook offer … arrive with M4`) with the truth. `hook` options resolve through `defaultHookOptions(store.root, home?)`; tests pass a temp settings file.

### 3.2 Last-team removal in `src/commands/leave.ts`

Inside the final `store.update` (or immediately after it, from the same fresh read): if no `teams` remain, `await removeHook(resolvedHookOptions)` and print `Removed the session hook from <settingsFile>.` when it returns `'removed'`. `LeaveArgs` gains `hook?: HookOptions`. **Leave-with-other-teams-remaining keeps the entry** (§8; test in `leave.test.ts`, additive: two teams configured, leave one → the entry survives; leave the other → removed).

### 3.3 Registration (`src/cli.ts`)

Add `setup?: typeof runSetup` to `CliVerbs`, resolve it in `active`, and register directly after `login`:

```ts
program
  .command('setup [target]')
  .description('Onboarding wizard: create a team (no argument) or join one (<org>/<repo> or a remote URL)')
  .action(async (target: string | undefined) => execute((io) => active.setup({ target }, io)));
```

`src/__tests__/cli.test.ts`: one new `it` that parses `setup` and `setup acme/team` through the harness and asserts the `target` argument reaches the stub.

### 3.4 `src/lib/community.ts`

```ts
/** §13 default 39 (D6, 2026-09-05): printed by `setup` step 6, never opened. Empty skips the step. */
export const COMMUNITY_URL = 'https://github.com/ryanliu-terum/terum-skills/issues';
```

---

## 4. Known interplay with the parallel branch (do not fix here)

- `m2-sweep` changes `share.ts` (malformed `allowed-tools` refusal at share time; rename propagation), `sync.ts` (a new "blocked" sub-case), `search.ts` (a version column), `uninstall.ts` (one write for bulk removal). None of these change the signatures `setup` calls. If a test you write depends on `share`'s exact refusal wording, assert on `ok: false` only.
- The `run/<team>.lock` mutex and the stale-lock rule for `sync --hook` (§8, default 31) are M4 and not built on either branch. `HOOK_ENTRY` is still correct without them.

---

## 5. Report

Return the `report.schema.json` object. `openQuestions` must list every place you had to choose a reading this document does not state; `deviations` every requirement above you did not meet; `testsModified` every existing test file you touched (expected: `cli.test.ts`, `create.test.ts`, `join.test.ts`, `leave.test.ts`, all additive). Do not claim a gate you did not run.
