# ultrareview: working

Reviewed the working tree of `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing` (mode `working`, base `HEAD`) across four dimensions with full 3-vote adversarial verification. Reviewers filed 164 raw findings; 57 were merged as cross-dimension duplicates before verification, leaving 107 distinct, of which **24 were confirmed**, 10 split the panel, and the rest were skipped by efficient mode. The confirmed high band clusters on two invariants the milestone actually rests on: **identity** — `joinMutation`'s `samePerson` check treats `'' === ''` as proof, and `collectIdentity` is the only field in the identity flow with no validation, so an unrelated person can take over an archived member's handle and inherit their `installed`/`declined` ledgers (independently rediscovered by 3 reviewers on each side of the hole) — and **remote handling** — `remote.ts` is documented as the single gate that rejects anything that is not a git remote, yet it passes `--upload-pack=…`, `ext::sh -c …` and `https://user:tok@…` through verbatim into git argv with no `--` separator and into `.git/config` permanently. A third high, `await release()` inside `finally`, can turn a durable pushed join into a reported failure. The medium band is overwhelmingly **coverage**: the shipped bin and `src/index.ts`'s exit-code contract have zero tests, three existing assertions (`GIT_TERMINAL_PROMPT`, protected-branch fail-fast, bootstrap staging cleanup) are tautological and stay green through the regressions they name, and `MutableTree.remove`'s entire deletion path has neither a production caller nor a test. Nothing in Reuse/simplify/perf survived verification.

| Severity | Confirmed |
|---|---|
| Critical | 0 |
| High | 7 |
| Medium | 17 |
| Low | 0 |
| **Total** | **24** |

---

## Correctness & tests (17)

### High

- [ ] **`await release()` in a `finally` rejects after a compromised lock and replaces the real outcome** — `src/lib/teamRepo.ts:133` *(merges 2 reports across Correctness & tests / Terum invariants)*
  Suppressing `onCompromised: () => undefined` does not make release safe: `proper-lockfile`'s `setLockAsCompromised()` sets `lock.released = true`, so the release closure calls back with `Error('Lock is already released')` (ERELEASED) and `await release()` **rejects** — from inside `finally`, discarding whatever `try` produced. A `team join` whose push exceeds `stale: 60_000` while a second CLI steals the lock lands on origin/main and then reports `failure('Lock is already released')`; the rerun now hits the HandleCollision path. The same `finally` also swallows genuine `PushRefused`/`SafeWriteExhausted`/`GuardError`. `src/lib/config.ts:54` has the identical shape.
  **Fix:** `await release().catch(() => undefined)` (or try/catch it the way the git cleanup above it already is) at both `teamRepo.ts:133` and `config.ts:54`; add a test that forces the compromised path and asserts the pushed result / original error survives.

- [ ] **`collectIdentity` accepts an empty GitHub login, and empty-vs-empty compares equal in the join identity check** — `src/lib/auth.ts:62` *(merges 3 reports across Correctness & tests / Security & data-loss / Terum invariants)*
  `handle`, `displayName` and `email` all go through `askUntilValid`; `github = (await io.text('GitHub login', github)).trim()` has no validator and no retry, and `Prompter.text` returns `answer.trim() || defaultValue || ''`. `personSchema.github` is a bare `z.string()`, so `''` persists. The only consumer treats it as identity proof (`team.ts:172`). Alice joins without gh and leaves it blank, is archived; Bob picks handle `alice`, `'' === ''` ⇒ `samePerson`, no collision, and `people/alice.json` is rewritten with Bob's name while keeping Alice's ledgers. No test covers a blank GitHub login in `auth.test.ts` or `join.test.ts`. Note also `auth.ts:57` uses `??`, so a persisted `github: ""` suppresses the PAT-probed default — should be `||`.
  **Fix:** route the login through `askUntilValid` (or make it explicitly optional and stop treating it as identity evidence); independently harden `team.ts:172` to ignore empty operands; consider `z.string().min(1)` at `schema.ts:46`.

- [ ] **Patch 6 hardcodes `GIT_CONFIG_COUNT: '2'`, re-opening the ambient-GIT_CONFIG clobber the same review confirms as a medium** — `.planning/reviews/hybrid-working-2026-09-04-pass1.patches.md:157` *(merges 2 reports across Correctness & tests / Reuse, simplify, perf)*
  The shipped code already offsets from the inherited count (`auth.ts:98` `const base = Number.parseInt(inherited.GIT_CONFIG_COUNT ?? '0', 10) || 0;`, `:102` `String(base + 2)`), which is exactly the fix `review.md:112-114` demands. Applying patch 6 as written undoes a confirmed finding from its own review and breaks `auth.test.ts:110-115` (`expect(inherited.GIT_CONFIG_COUNT).toBe('3')`) and `create.test.ts:109-112`.
  **Fix:** drop patch 6 entirely — `auth.ts:96-109` already implements both halves. If any part is revived, keep the `base` offset and fold the `review.md:112` medium into it.

### Medium

- [ ] **The shipped bin (`dist/index.js`) has no test — every gate stays green if the build ships a broken CLI** — `package.json:11`
  `bin` points at the tsc output of `src/index.ts` and `prepack` runs the build, yet nothing touches it: `cli.test.ts` imports `buildProgram` and injects its own `execute`. A lost shebang or an `outDir`/`rootDir` change in `tsconfig.build.json` publishes a CLI that dies on `npx terum-skills` while lint, typecheck and test all pass.
  **Fix:** add a smoke test that builds once and spawns `node dist/index.js --help` plus one failing verb, asserting stdout and exit code.

- [ ] **`login`'s under-lock re-check omits the remote→team uniqueness check, so a concurrent bind creates two teams for one remote** — `src/commands/login.ts:39` *(merges 4 reports across Correctness & tests / Terum invariants / Reuse, simplify, perf / Security & data-loss)*
  Pre-lock, `login` enforces both `teamByRemote` uniqueness (line 25) and remote-match (line 27); the `store.update` callback whose comment claims to close the prompt-window race re-runs only the second. Terminal A sits at the PAT prompt while B's `team join` binds the same remote under a different team name; A then passes line 39 and writes a second entry. `teamByRemote` thereafter resolves by insertion order, and a later `login` for the same pair hard-fails. No test covers the re-check block at all.
  **Fix:** re-run `teamByRemote(fresh, remote)` inside the callback (ideally via one shared `assertBindable(config, team, remote)`); sweep `team.ts:80-84` (create re-checks the name but not the remote) and `team.ts:135-138` (join re-checks nothing).

- [ ] **`src/index.ts` has no test: the bin's entire exit-code and stderr contract is unexercised** — `src/index.ts:8` *(merges 4 reports across Correctness & tests / Terum invariants / Reuse, simplify, perf)*
  Lines 12 and 23 own the only `Result`→exit-code mapping. There is no `src/__tests__/index.test.ts`, and `cli.test.ts:10` substitutes its own `Execute`. Adversarially: replacing line 23 with `process.exitCode = 1` makes `--help` exit 1 (commander returns 0 for `helpDisplayed`) with a green suite; deleting the `process.stderr.write` makes every failure silent, also green.
  **Fix:** extract `execute` into an exported unit taking a `{ write, setExitCode }` sink and cover failing Result, thrown verb, and CommanderError passthrough (including the 0 from `--help`).

- [ ] **An interrupted `team join` is not idempotent: the rerun reports the user's own handle as taken and pushes a second people file** — `src/commands/team.ts:135`
  The people file is pushed at line 126 and the config bound at line 135 with no recovery between. If the process is interrupted or `store.update` throws, the rerun has `boundHandle === undefined`, so line 173 raises `HandleCollisionError` about the file the user just pushed; accepting the reprompt pushes a second people file and orphans the first. Contradicts the spec's own interrupt case (`.planning/specs/2026-09-02-phase-1-build.md:441`). `create` guards this window; `join` does not.
  **Fix:** allow the identity match alone to re-claim a live file when this machine has no binding (`samePerson && (boundHandle === undefined || boundHandle === handle)`), or bind config before `safeWrite` and roll back; add a test that fails `store.update` once after a successful `safeWrite`.

- [ ] **No regression test that `terminalPrompter` leaves no live reader on stdin — the documented reason for the open/close-per-question design** — `src/lib/prompt.ts:69`
  The contract at prompt.ts:47-53 is enforced only by `finally { rl.close(); }`. No test inspects listeners; the six behavioural tests check return values and echoed text, and the PassThrough fixture never keeps the loop alive. Deleting the `finally` or hoisting the interface to module scope leaves the suite green — the exact defect this file was rewritten to fix. `detectOrOfferGh` hands stdio to `gh auth login` right after `io.confirm`, so a surviving reader would fight the child.
  **Fix:** assert `input.listenerCount('data'|'keypress')` returns to its pre-question value after both a resolved and a rejected question, and that `input.isPaused()` is true once a question settles; cover `secret` too.

- [ ] **`bootstrap`'s catch-all rewrites a post-push failure into "holds no scaffold", and the recovery command it suggests cannot work** — `src/commands/team.ts:78` *(merges 3 reports across Correctness & tests / Terum invariants / Security & data-loss)*
  `bootstrap` pushes at team.ts:281 then renames at :282; any failure after the push takes this branch and asserts a fact it cannot know. The catch has already `rm -rf`'d staging, so the user has no local copy, and the suggested `team create <name> --remote <remote>` now fails at team.ts:58 with "already has branches". `create.test.ts` has no bootstrap-failure case.
  **Fix:** re-probe the remote (or have `bootstrap` report whether the push landed) and branch the message — pushed ⇒ direct the user to `team join <remote>`; add a create test that fails the push and one that fails after it, asserting no `*.bootstrap-*` directory survives.

- [ ] **Non-main push treats retryable ref-lock contention as a terminal refusal, contradicting the module's own RETRYABLE set** — `src/lib/teamRepo.ts:164` *(merges 2 reports across Correctness & tests / Terum invariants)*
  `RETRYABLE` includes `cannot lock ref|failed to lock`, and the `main` path consults it (line 157); the derived-branch loop consults only `STALE_LEASE`, so `cannot lock ref 'refs/heads/publish/x'` from two simultaneous publishes becomes a terminal `PushRefused` with no retry and no `-2` fallback. The only test for this branch injects `protected branch hook declined`, which is genuinely terminal.
  **Fix:** return `retryable: RETRYABLE.test(lastError)` instead of hard-coded `false`, keeping `STALE_LEASE` only to decide the `-2` fallback; add a `cannot lock ref` test on a `publish/x` push.

- [ ] **`isMember()` is the only handle entry point in guard.ts that does not normalize, so a mixed-case handle reports an active member as a non-member** — `src/lib/guard.ts:123` *(merges 2 reports across Correctness & tests)*
  `guard()` normalizes deliberately and the suite pins it (`{ action: 'join', handle: 'ME' }` must not throw). `isMember` compares the raw argument against `personSchema.handle` and `teamSchema.archived`, both already trimmed and lowercased, so `isMember(alicesFile, teamJson, 'Alice')` returns `false` for an active member and `archived.includes('Alice')` likewise misses. Existing tests only pass lowercase. No production caller yet — it ships as a trap for M2.
  **Fix:** run the argument through `normalizeHandle()` (returning false rather than throwing on invalid input) and add a mixed-case case at `guard.test.ts:105`.

- [ ] **The whole deletion path of safeWrite (`MutableTree.remove` → `rm` → staged deletion → `removeCreated`) has no test and no caller** — `src/lib/teamRepo.ts:194` *(merges 2 reports across Correctness & tests)*
  `grep -rn '\.remove(' src/` returns nothing outside the definition. Unproven: that `git add -A -- <deleted path>` stages the deletion, that the staged-diff proof at teamRepo.ts:109 matches for a removal, that the guard authorizes it (`ownsSkill` accepts `after === undefined`), and that the `finally` restores a deleted-then-abandoned tracked file. A regression producing an empty staged set and a `Staged diff … does not match` GuardError would ship green.
  **Fix:** add teamRepo cases for a committed+pushed deletion, a rejected push whose `finally` restores the file, a deletion that empties a folder (asserting `removeCreated` stops at the clone root), and a byte-identical rewrite asserting `{ changed: false }`.

- [ ] **`team join --as <name>` on a new remote is never tested, only the error that tells users to use it** — `src/commands/__tests__/join.test.ts:60`
  The only `as` case targets a remote that already has an entry, where team.ts:102-103 deliberately ignores it (the test asserts the "ignoring --as other" line). Line 95 asserts the message telling users to `pass --as <other-name>`, but no test follows that advice, so the middle arm of `existing?.[0] ?? args.as ?? remoteName(target.remote)` is uncovered — dropping `args.as` ships green while leaving the user in a dead end.
  **Fix:** join a second bare fixture whose basename collides, with `as: 'team-two'`, and assert two config entries with distinct clones and remotes.

- [ ] **Bootstrap failure path untested; the staging-cleanup assertion is a substring filter on the success path only** — `src/commands/__tests__/create.test.ts:33`
  The `filter((name) => name.includes('bootstrap'))` check runs after a *successful* create, where `rename(staging, clone)` already consumed the directory, so it is near-vacuous — and it is coupled to the literal prefix in `${clone}.bootstrap-${randomUUID()}`. Neither the `rm -rf` in bootstrap's catch nor the wrapping error is exercised; a reordering that leaks staging accumulates a fresh git repo per failed create, invisible to the `exists(clone)` guard.
  **Fix:** use `wrapRunner` to fail the `git push`, assert the error names the remote and the `--remote` retry and that `readdir(teams)` equals `[]` exactly; tighten line 33 to `toEqual(['new-team'])`.

- [ ] **`GIT_TERMINAL_PROMPT` assertion is tautological — vitest sets it globally, so the runner's injection is unguarded** — `src/lib/__tests__/runner.test.ts:16` *(merges 3 reports across Correctness & tests / Security & data-loss / Terum invariants)*
  `vitest.config.ts:18` puts `GIT_TERMINAL_PROMPT: '0'` in `process.env`, and `runner.ts:18` spreads `...process.env` first, so the child sees `'0'` regardless of the middle term; `setup.ts` deletes ~15 ambient GIT_* vars but not this one. Delete the injection from runner.ts and the suite stays green — in production a `git clone`/`fetch`/`ls-remote` against a private HTTPS remote then blocks forever on a `stdio: ['ignore','pipe','pipe']` child, which safeWrite's 30 s deadline cannot rescue.
  **Fix:** drop it from `vitest.config.ts` (add it to setup.ts's delete list) or set the ambient value to `'1'` for the test so the child's `'0'` can only come from runner.ts. Same ambient-shadowing trap applies to the `GIT_CONFIG_*` values at `vitest.config.ts:19-22`.

- [ ] **Config store's throwing-mutate path is untested, and two production race-guards depend on it** — `src/lib/__tests__/config.test.ts:35`
  None of the five tests makes `mutate` throw, yet `ConfigStore.update` releases the lock in a `finally` specifically to survive it, and both `team.ts:81` and `login.ts:39` throw from inside the mutate as their concurrency guard — neither string appears anywhere under `src/commands/__tests__/`. Move `await release()` out of the `finally` and the suite stays green; at runtime the config lock is held for the full 30 s stale window and every later write in that process exhausts its retries with an ELOCKED the user cannot act on.
  **Fix:** assert a rejected `update` leaves the file byte-identical and that a following `update` succeeds; add a corrupt-`config.json` read case too (`read()` only swallows ENOENT).

- [ ] **Protected-branch assertion is vacuous: the test cannot tell fail-fast from a 30 s retry loop** — `src/lib/__tests__/teamRepo.test.ts:87`
  `protectedBranch` fails every push and increments no counter, so nothing observes how many pushes happened; the branch-list assertion holds unconditionally because a stubbed push can never create a branch. Delete the early exit at `teamRepo.ts:164` and the loop falls through to `publish/x-2`, retries for the full 30 s, and throws `SafeWriteExhausted` whose message still matches the regex — green, just slower (testTimeout 120 s).
  **Fix:** give `protectedBranch` the `pushes` counter and assert `pushes === 1` (or capture refspecs), and assert the rejection is a `PushRefused` instance — `SafeWriteExhausted` embeds the same text, so `toThrow(/…/)` cannot separate the classes anywhere in this file.

---

## Security & data-loss (5)

### High

- [ ] **`normalizeRemote`/`remoteToGitUrl` accept option- and transport-helper-shaped strings that reach git argv with no `--` separator** — `src/lib/remote.ts:40` *(merges 2 reports)*
  The module is documented as the single gate that "Throws on anything that is not recognizably a git remote", but `SCP_FORM` matches any string whose first `:` is not preceded by `/`, including leading-dash and `<transport>::<address>` forms, and `remoteToGitUrl` returns them verbatim. Verified against the real regexes: `--upload-pack=touch:pwned`, `-oProxyCommand=x:y`, `ext::sh -c id` all pass. They land in argv at `teamRepo.ts:245` (`git clone`), `team.ts:56` (`ls-remote`), `team.ts:264` (`remote add`) — and both call sites pass the RAW user string, so normalization never sanitizes it. Confirmed on this machine that `git clone -q --branch main "--upload-pack=echo" <dest>` consumes the injected value as an option and silently promotes the destination to the repository argument.
  **Fix:** reject `trimmed.startsWith('-')` and `^[A-Za-z0-9+.-]+::` inside `normalizeRemote`/`remoteToGitUrl`, add `--` before the positional at `teamRepo.ts:245`, `team.ts:56`, `team.ts:264` and `auth.ts:152`, and pass the *normalized* remote from `join()`/`create()`.

- [ ] **`remoteToGitUrl` passes embedded credentials straight through to git argv and `.git/config`; the test table never covers it** — `src/lib/__tests__/remote.test.ts:34`
  Line 7 proves the stripping code exists (`normalizeRemote('https://user:tok@GitHub.com/Org/Repo/')` → `github.com/org/repo`), but the `remoteToGitUrl` table only feeds credential-free URLs and the negative table omits credentialed ones. Re-running the real regexes: `remoteToGitUrl('https://user:tok@github.com/Org/Repo.git')` returns the input verbatim. `parseJoinTarget` keeps the raw target, so the PAT appears in the `git clone` command line (readable via `ps -ef`) and is then persisted in plaintext in `<clone>/.git/config` and reused by every later fetch/push. The token store never notices: `bindTeam` and `assertOrigin` both compare normalized forms. Directly contradicts `auth.ts:10-11` ("never on a command line, never in a URL").
  **Fix:** rebuild URL_FORM/SCP_FORM inputs without the userinfo component (the group is already parsed and discarded), and add rows asserting the output contains no token for the https and ssh spellings; sweep `team.ts:56`, `team.ts:264`, `auth.ts:152`.

### Medium

- [ ] **A remote with credentials in the URL is stored verbatim in the clone's `.git/config` and echoed back to the terminal** — `src/commands/team.ts:52`
  `create` keeps `args.remote` raw and hands it to `git remote add origin` (team.ts:264) and to the output channel at lines 57, 78 and 85, so `https://x-access-token:ghp_xxx@github.com/acme/team.git` is written permanently into `~/.terum/skills/teams/<team>/.git/config` and printed. `join` has the same shape via `parseJoinTarget` → `ensureClone` → `cloneTeam`. Only the *config* copy is sanitized, which makes the leak easy to miss.
  **Fix:** strip userinfo before handing the remote to git and add a `redactRemote()` for every message; sweep team.ts:57/78/85/229, `teamRepo.ts:245`, `auth.ts:152`.

- [ ] **Suppressed `onCompromised` in `ConfigStore.update` turns a stolen lock into a silent lost update, not a reorder** — `src/lib/config.ts:46`
  The comment claims "a compromised lock cannot corrupt the file, only reorder two writers", which is false for a read-modify-write: suppression lets `update()` proceed to `writeAtomically` with the full snapshot read *before* the other writer existed, and `rename()` replaces the file wholesale. Process A stalls >30 s at a `bindTeam` write, B acquires the stale lock and writes `teams.other`, A resumes and renames over it — B's entry and its stored token vanish with both operations reporting success. This is the data-loss half of `hybrid-working-2026-09-04-pass1.review.md:204`; only the crash was fixed.
  **Fix:** record the compromise (`let compromised = false; onCompromised: () => { compromised = true; }`) and abort before `writeAtomically` with a retryable error, or re-read and re-apply under a fresh lock; same treatment at `teamRepo.ts:93`.

- [ ] **Fingerprint records a path key that does not resolve to the file it hashed, so `snapshotSkillDirectory` reads the wrong file or throws ENOENT** — `src/lib/placer/vendor/skillhub/skill-fingerprint.ts:51`
  `files.push(relative(root, absolute).split('\\').join('/'))` mangles real POSIX filenames instead of normalizing a Windows separator. Verified: a file named `docs\readme.md` under the skill root yields the key `docs/readme.md`, so the caller's `readFile(join(skillDir, path))` resolves elsewhere — either ENOENT on a legal skill directory, or the backslash file's content is never hashed and two materially different trees produce the same fingerprint. That is a blind spot in the primitive the Placer will use to decide whether local edits exist before overwriting a skill directory.
  **Fix:** gate the rewrite on `sep === '\\'` (or use `relative(...).split(sep).join('/')`). Since the file is vendored unmodified, either carry the patch and flip `modified: no` → `yes` in the header and NOTICE, or file upstream against `iflytek/skillhub @ 61aa957` and pin the fix for M2.

---

## Terum invariants (2)

### High

- [ ] **`joinMutation` treats two empty `github` fields as the same person, letting any joiner claim an archived member's handle and inherit their record** — `src/commands/team.ts:172` *(merges 3 reports across Terum invariants / Correctness & tests / Security & data-loss)*
  Lines 172-174 are the only roster-side identity check in the product, and `github` may be `''` on both sides (`personSchema.github` is `z.string()`; `collectIdentity` yields `''` on the generic-git path where `gh api user` never runs). On a self-hosted/GitLab team, `'' === ''` makes `samePerson` true for two unrelated humans and the `archived` branch does not throw: a newcomer types the archived handle `ghost`, `joinMutation` spreads `...(existing ?? {})` and inherits ghost's `bio`/`installed`/`declined` while overwriting name and email, and line 188 un-archives the handle — authorized by guard row e, which trusts the caller-supplied handle. The live-member branch reopens the same hole for anyone who edits `teams.<team>.handle` in their local config, since `boundHandle` is purely machine-local. Every fixture person carries a non-empty `github`, so the suite cannot see it.
  **Fix:** require non-empty on both sides before treating either identifier as a match (`const eq = (a, b) => a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase()`), tighten `personSchema.github` to `.min(1)` or make it nullable, and add a join test with an archived person and joiner who both leave the login blank.

- [ ] **Idempotency table omits the bare-hostname remote form the same file declares supported; `normalizeRemote` throws on its own output there** — `src/lib/__tests__/remote.test.ts:18`
  Line 12 accepts `myhost:Org/Repo.git` → `myhost/Org/Repo`, but the table titled "is idempotent on its own output, in every form" contains only dotted hosts. `CANONICAL_FORM` requires a dot in the host, so the normalized bare-host remote matches no branch and hits `throw new Error('Unsupported remote')`. Executed against the real module: `myhost:Org/Repo.git`, `ssh://git@myhost/org/repo.git` and `git@localhost:org/repo.git` all throw on round-trip, and through `remoteToGitUrl` and `hostOperationAllowed` too. The docstring explicitly promises idempotence and the product double-normalizes on the primary user paths, so the throw is reached unconditionally.
  **Fix:** accept a single-label host in `CANONICAL_FORM` (or short-circuit when input equals its normalized spelling), then add those three inputs to the idempotency table plus a `remoteToGitUrl`/`hostOperationAllowed` round-trip assertion. Double-normalize sites to sweep: `login.ts:20`+`:24`, `team.ts:97`+`:101`, `auth.ts:195`, `teamRepo.ts:142`.

---

## Reuse, simplify, perf (0)

No findings in this dimension survived adversarial verification. See the Unverified section for the (unchecked) reuse and duplication candidates.

---

## Contested (split adversarial verdict -- needs human adjudication)

- (high / Security & data-loss) `team join` from a second machine is rejected as a handle collision, forcing a duplicate handle and orphaning the member's people file  @ src/commands/team.ts:173  [vote 1-2]
  Evidence: `joinMutation` only accepts an existing *active* people file when this machine is already bound to the handle:

```ts
// team.ts:172-174
const samePerson = existing.github.toLowerCase() === identity.github.toLowerCase() || existing.email.toLowerCase() === identity.email.toLowerCase();
if (!archived && !(boundHandle === handle && samePerson)) throw new HandleCollisionError(handle);
if (archived && !samePerson) throw new HandleCollisionError(handle);
```

On a second machine (or after the user deletes `~/.terum/skills/config.json`, which config.ts:9 documents as "never committed, safe to delete") `configBefore.teams` is empty, so `boundHandle` is `undefined` at team.ts:108 and `boundHandle === handle` is false even for the genuine owner. The user's own `people/<handle>.json` therefore throws `HandleCollisionError`, they are re-prompted (team.ts:129-131) and end up as `me-2`: a second people file, a split roster entry, and an orphaned `installed`/`declined` list under the old handle — the state the archived-rejoin path at team.ts:53 in join.test.ts explicitly exists to prevent.

The asymmetry on the very next line is the tell: for an **archived** handle the same self-reported `samePerson` check is trusted on its own (join.test.ts:47-54 pins that), so identity-by-email/github is considered good enough for a rejoin — but not for an active member, where it additionally demands local config state that a second machine cannot have. join.test.ts covers only the impostor half (lines 137-153, where `samePerson` is false and rejection is correct) and the same-machine repeat join (lines 56-68, where `boundHandle` is set), so neither test exercises `samePerson === true && boundHandle === undefined`.

- (medium / Correctness & tests) Changed paths are passed to git as pathspecs, so a legal path containing glob metacharacters is never staged and the write aborts with an internal GuardError  @ src/lib/teamRepo.ts:107  [vote 2-1]
  Evidence: `assertSafePath` (teamRepo.ts:170) permits `[`, `]`, `*` and `?` — it only rejects absolute paths, `\`, empty/`.`/`..` segments and `.git`-like segments. Those paths are then handed to git as bare pathspecs, which git interprets with wildcard (fnmatch) semantics:

```ts
      await requireGit(['add', '-A', '--', ...changed]);                       // teamRepo.ts:107
      const staged = (await requireGit(['diff','--cached','--name-only','--no-renames','-z'])).stdout...;
      if (JSON.stringify(staged) !== JSON.stringify([...changed].sort())) {
        throw new GuardError(`Staged diff [...] does not match the mutation [...]`);
      }
```

Failure scenario: a mutation writes `skills/c[++]-tips/SKILL.md` (a folder name the guard's `^skills\/([^/]+)\/.+$` and `assertSafePath` both accept). `applyTree` writes the file to disk, but the pathspec `skills/c[++]-tips/SKILL.md` matches the character class `[+]`, i.e. the literal name `skills/c+-tips/SKILL.md`, and never the file that was actually written. Nothing is staged, `staged` is `[]`, and the operation dies with `Staged diff [] does not match the mutation [skills/c[++]-tips/SKILL.md]` — a nonsensical guard error for a perfectly legal write. The same pathspec problem makes the `finally` cleanup's `git ls-files --error-unmatch -- path` (teamRepo.ts:127) mis-report the file as untracked or unmatched.

- (medium / Correctness & tests) remote.test.ts locks in a lossy normalize→remoteToGitUrl round trip for local paths (.git is dropped)  @ src/lib/__tests__/remote.test.ts:36  [vote 2-1]
  Evidence: The file asserts both halves of the round trip independently and never composes them:

    remote.test.ts:13  expect(normalizeRemote('/tmp/teams/team.git')).toBe('file:/tmp/teams/team');
    remote.test.ts:36  expect(remoteToGitUrl('file:/tmp/x/team')).toBe('/tmp/x/team');

so `remoteToGitUrl(normalizeRemote('/srv/git/team.git'))` === '/srv/git/team' — the `.git` suffix is gone. Every other form re-adds it: `normalizeRemote('https://github.com/Org/Repo.git')` → 'github.com/org/repo' → `remoteToGitUrl` → 'https://github.com/org/repo.git' (remote.ts:75). Only the `file:` branch (remote.ts:69-70) returns the stripped path verbatim. There is an idempotency test for `normalizeRemote` (remote.test.ts:17-22) but no equivalent for the pair, so the asymmetry reads as intended behaviour.

Failure scenario: `bindTeam` stores the normalized spelling (auth.ts:185, called from team.ts:137 with `remote: normalized`), so `team join /srv/git/team.git` persists `teams.<name>.remote = 'file:/srv/git/team'`. `cloneTeam` feeds a remote straight to `remoteToGitUrl` (teamRepo.ts:245: `git clone -q --branch main ${remoteToGitUrl(remote)} ...`). The first caller that clones from the stored remote rather than the raw user argument — M1 gets away with it only because team.ts:116 passes `target.remote`, the un-normalized input — runs `git clone /srv/git/team` and fails with "does not appear to be a git repository". The fixtures never catch this: bareTeam() creates `team.git` but mappedRunner (fixtures.ts:117) substitutes the bare path for a public-looking remote string, so no test ever pushes a local path through normalize→toGitUrl.

- (medium / Security & data-loss) assertSafePath unsafe-path enumeration omits the Windows trailing-dot/space `.git.` forms that Win32 strips  @ src/lib/__tests__/teamRepo.test.ts:93  [vote 1-2]
  Evidence: The test enumerates what `assertSafePath` must refuse, and deliberately covers the Windows surface:

```ts
for (const bad of ['../escape.json', '/etc/passwd', '.git/config', '.Git/config', '.GIT/hooks/pre-commit', 'skills/x/.git/config', 'skills/x/GIT~1/config', 'people/../team.json', 'a/./b', 'a//b', 'people\\me.json', 'people/', '']) expect(() => assertSafePath(bad), bad).toThrow(GuardError);
```

It covers case variants (`.Git`, `.GIT`) and the NTFS short name (`GIT~1`) — matching the doc comment on src/lib/teamRepo.ts:169 ("no `.git` anywhere (any case, NTFS short names included)") — but never the trailing dot/space form. The predicate at src/lib/teamRepo.ts:172 is:

```ts
const gitLike = (segment: string) => segment.toLowerCase() === '.git' || /^git~\d+$/i.test(segment);
```

`'.git.'.toLowerCase()` is `'.git.'` ≠ `'.git'`, and `/^git~\d+$/` does not match, so `assertSafePath('.git./config')` and `assertSafePath('.git /config')` both pass. Win32 path canonicalization strips trailing dots and spaces from path components, so on Windows `join(root, '.git./config')` resolves to the clone's real `.git\config`. This is a known git bypass class — git's own `is_ntfs_dotgit()` guards `.git` followed by any run of dots/spaces *in addition to* `git~1`, which is exactly the half implemented here. Writing the clone's `.git/config` yields `core.fsmonitor` / `core.hooksPath` / `core.sshCommand`, i.e. command execution on the next git operation in `safeWrite`. No phase-1 verb can reach it (src/commands/team.ts:186 only sets `people/<validated handle>.json` and `team.json`), but `assertSafePath` is the defense-in-depth boundary M2/M3 `share`/`publish` will rely on for skill-folder names taken from repo content.

- (medium / Correctness & tests) ScriptedPrompter defaults interactive=false, a channel state in which the real prompter refuses every question  @ src/lib/__tests__/fixtures.ts:18  [vote 1-2]
  Evidence: `constructor(private readonly answers: string[] = [], private readonly confirms: boolean[] = [], readonly interactive = false)` — the default models a non-interactive channel that nevertheless answers `text`/`secret`/`select`/`confirm`. The real channel cannot do that: terminalPrompter's `ask` starts with `if (!interactive) throw new PromptClosedError(question.trim(), 'not-interactive')` (prompt.ts:60), so with `interactive === false` every question throws. 24 of the ~28 construction sites take the default, which means every `create`/`join`/`login` test runs with `io.interactive === false` and therefore silently short-circuits `detectOrOfferGh` at auth.ts:42 (`if (state.authenticated || !state.installed || !io.interactive) return state;`). The gh-offer branch is consequently exercised only by the three direct unit tests at auth.test.ts:22-25, never once through a verb, and a regression that made a verb ask a question on a non-TTY channel would still pass because the fixture answers it.

- (medium / Terum invariants) Patch 6 references two identifiers that exist nowhere and reinstates the hardcoded GIT_CONFIG_COUNT the same review flags as a bug  @ .planning/reviews/hybrid-working-2026-09-04-pass1.patches.md:154  [vote 1-2]
  Evidence: The patch-6 diff is not applicable as written, independent of staleness. (a) `:154` `+  if (!token || !githubTarget(remote)) return {};` calls `githubTarget`, which the diff never defines — `:166` only describes it in prose ("with `githubTarget(remote)` returning `true` for `undefined` …"); `grep -rn 'githubTarget' src/` returns nothing. (b) `:161` `+    GIT_CONFIG_KEY_1: 'credential.https://github.com.helper', GIT_CONFIG_VALUE_1: CREDENTIAL_HELPER,` renames the constant the `-` line calls `HELPER` to `CREDENTIAL_HELPER` with no declaration anywhere; `grep -rn 'CREDENTIAL_HELPER\|HELPER' src/` returns nothing. Either identifier is a TS2304 on `npm run typecheck`. (c) `:157` keeps the untouched context line `GIT_CONFIG_COUNT: '2',` — the exact hardcoding that the companion report flags as its own medium finding (`hybrid-working-2026-09-04-pass1.review.md:148`, "gitAuthEnv silently discards the caller's ambient GIT_CONFIG_* … Fix: offset from the inherited count"), so applying the high-severity patch as written leaves the medium it raised unfixed with no note. The shipped code already does it correctly at `src/lib/auth.ts:98` (`const base = Number.parseInt(inherited.GIT_CONFIG_COUNT ?? '0', 10) || 0;`), and it changed the second parameter to `inherited: NodeJS.ProcessEnv = process.env` (`:96`) rather than the patch's `remote?: string` — so the patch's signature change would also silently break the `gitAuthEnv('ghp_secret', {})` call shape that `auth.test.ts:101-102` and `teamRepo.ts:69` rely on.

- (medium / Correctness & tests) Patch 3's SHORT_GIT regex is narrower than the shipped guard (git~1 only vs git~N), while the half that is still genuinely missing was never applied  @ .planning/reviews/hybrid-working-2026-09-04-pass1.patches.md:79  [vote 2-1]
  Evidence: patches.md:79 proposes `+const SHORT_GIT = /^git~1$/i;`, but the shipped predicate at `src/lib/teamRepo.ts:172` is already broader: `/^git~\d+$/i`. NTFS 8.3 short-name generation emits `GIT~2`, `GIT~3`, ... whenever `GIT~1` is taken, so applying patch 3 verbatim newly admits `skills/x/GIT~2/config`. Verified against the shipped predicate: `git~2/config` and `GIT~3/x` are REJECTED today.
The converse half of the same patch is still open and unapplied — the same probe shows the shipped predicate ACCEPTS `.git./config`, `.git /config`, `.git::$DATA/config`, `a\0b` and `C:/x`, which patches.md:78 (`DOT_GIT = /^\.git([.\s:]|$)/i`) and :84 (`path.includes('\0') || /^[A-Za-z]:/.test(path)`) were written to cover. `src/lib/__tests__/teamRepo.test.ts:93`'s bad-path list stops at `.Git/config`, `.GIT/hooks/pre-commit`, `skills/x/.git/config`, `skills/x/GIT~1/config` — no trailing-dot, trailing-space, ADS, NUL or drive-letter case, so the gap is invisible to the suite.

- (medium / Correctness & tests) Patch 5 reintroduces login handle-binding and a dead `handle_bound` schema field, breaking two currently-passing login tests  @ .planning/reviews/hybrid-working-2026-09-04-pass1.patches.md:138  [vote 2-1]
  Evidence: patches.md:138-139 proposes login keep writing a handle: `+ config.teams[team] = { remote, handle: existing?.handle ?? auth.identity.handle, token: ..., handle_bound: existing?.handle_bound };`. The shipped fix took the stronger route instead — `src/commands/login.ts:41` `bindTeam(fresh, team, { remote, token: auth.token ?? current?.token ?? null });` writes no handle at all, per the docstring at login.ts:11-12 ("It never binds a handle: only `team create`/`team join` prove one against the roster"). `grep -rn handle_bound src/` returns zero hits, so patch 5's `teamConfigSchema` field (patches.md:130) would be written by nothing and read by nothing.
The stated test fallout at patches.md:142 (`create.test.ts:37`, `create.test.ts:68`, `join.test.ts:31` need `handle_bound: true`) is also stale; the tests that would actually break are `src/commands/__tests__/login.test.ts:25` and `:47`, both of which assert the shipped contract `expect((await store.read()).teams.team).toEqual({ remote: ..., token: ..., handle: null })`.

- (medium / Correctness & tests) Patch 1 would flip non-GitHub `login` from success to a hard error, contradicting the shipped contract and failing a passing test  @ .planning/reviews/hybrid-working-2026-09-04-pass1.patches.md:22  [vote 2-1]
  Evidence: patches.md:21-24 proposes `const allowed = hostOperationAllowed(remote); if (!allowed.ok) { throw new Error(...) }`, and patches.md:28 asks for a regression test where `login --team gl --remote https://gitlab.com/acme/skills.git` "must fail and write no `teams.gl` entry". The shipped code took the opposite decision at `src/commands/login.ts:29-34`: `const github = hostOperationAllowed(remote).ok;` then, when false, collects identity only, prints `${remote} is not on GitHub: access uses your ambient git credentials; nothing to store.` and returns `success({ ..., github: false })`. `src/commands/__tests__/login.test.ts:40-48` pins that: `expect(result).toEqual({ ok: true, value: { authenticated: false, github: false } })` and `expect((await store.read()).teams.team).toEqual({ remote: 'gitlab.com/acme/team', token: null, handle: null })` — an entry IS written, with a null token.

- (medium / Security & data-loss) PAT-leak assertion uses exact-element `Array.includes`, so a token embedded inside an argument (credential-in-URL) passes  @ src/commands/__tests__/create.test.ts:117  [vote 2-1]
  Evidence: The one test guarding the "a token never reaches a command line" invariant compares whole argv elements:

```ts
// create.test.ts:117
expect(runner.calls.every((call) => !call.args.includes('ghp_secret'))).toBe(true);
```

`Array.prototype.includes` is strict per-element equality, so it only fires if the PAT is passed as a standalone argument. The invariant auth.ts:10-11 actually claims is stronger — "never on a command line, never in a URL, never `gh auth login --with-token`". A regression that builds `https://x-access-token:ghp_secret@github.com/octocat/pat-team.git` and hands it to `git push` or `git clone` (the classic CWE-598 credential-in-URL leak, which then persists in `.git/config`, the reflog, and every `ps`/audit-log line for the child process) leaves this assertion green, because the token is a substring of an argument rather than an argument. The env-side of the invariant is well covered (auth.test.ts:102-116 pins `gitAuthEnv` exactly), which makes the argv side the only unguarded half.

## Unverified (not adversarially checked -- efficient mode)

- (medium / Security & data-loss) Guard matrix never tests a traversal path inside an owned skill folder, which guard() currently allows  @ src/lib/__tests__/guard.test.ts:97
- (medium / Security & data-loss) PAT tests assert '--with-token' is unused but never assert the token stays out of argv entirely  @ src/lib/__tests__/auth.test.ts:80
- (medium / Security & data-loss) allowed-tools normalization is not injective — the grant hash cannot distinguish one newline-bearing pattern from two real tool grants  @ src/lib/__tests__/schema.test.ts:15
- (medium / Terum invariants) Prompter boundary is bypassed by a type assertion, an assignment, or a parameter default — the repo's own DI idiom  @ eslint.config.js:30
- (medium / Terum invariants) normalizeRemote strips `.git` from local paths but remoteToGitUrl never restores it, so the persisted remote is not fetchable  @ src/lib/remote.ts:35
- (medium / Terum invariants) `git fetch origin` immediately before `push --force-with-lease` refreshes the lease, so a derived branch is force-overwritten  @ src/lib/teamRepo.ts:161
- (medium / Terum invariants) join.test.ts has no regression test for a concurrent team-entry rebind; `join` alone omits the re-check its two siblings perform, so the joined team can inherit another remote's PAT  @ src/commands/__tests__/join.test.ts:94
- (medium / Reuse, simplify, perf) Vendored lock() omits onCompromised, undoing the fix both existing proper-lockfile call sites carry  @ src/lib/placer/vendor/skillhub/skill-target-lock.ts:18
- (medium / Terum invariants) Test named "with inherited stdio" cannot assert stdio — ghOnlyRunner drops options.stdio, leaving auth.ts's only stdio:'inherit' call uncovered  @ src/lib/__tests__/auth.test.ts:15
- (medium / Terum invariants) The two "removes the folder it created" assertions pass vacuously; safeWrite's real cleanup and deletion paths have no test  @ src/lib/__tests__/teamRepo.test.ts:63
- (medium / Reuse, simplify, perf) Committed review + patch artifacts are stale: every headline finding is already fixed in the same working tree they ship with  @ .planning/reviews/working-2026-09-04.patches.md:11
- (medium / Reuse, simplify, perf) Vendor exclusion duplicated across 4 config sites; tsconfig.build.json's `exclude` silently replaces the base's, so the two configs will drift  @ tsconfig.build.json:6
- (medium / Reuse, simplify, perf) guard.ts's isMember() is dead code while team.ts hand-rolls the §4.1 membership predicate twice  @ src/commands/team.ts:171
- (medium / Reuse, simplify, perf) The "persist identity + team entry" config write is copy-pasted at 3 sites and has drifted — join omits the under-lock revalidation  @ src/commands/team.ts:135
- (medium / Reuse, simplify, perf) The "run git, throw on non-zero" wrapper is reimplemented in bootstrap, duplicating teamRepo's requireGit verbatim  @ src/commands/team.ts:256
- (medium / Reuse, simplify, perf) guard() re-parses the same SKILL.md YAML once per changed file in a skill folder  @ src/lib/guard.ts:58
- (medium / Reuse, simplify, perf) safeWrite's cleanup does a redundant network `git fetch` on every exit path, plus one git process per created path  @ src/lib/teamRepo.ts:124
- (medium / Reuse, simplify, perf) guard.test.ts re-declares team.json / SKILL.md fixtures that already exist in fixtures.ts (3rd copy of the team literal)  @ src/lib/__tests__/guard.test.ts:5
- (medium / Reuse, simplify, perf) Shared fixtures module ships three dead exports while its callers hand-roll the same helpers  @ src/lib/__tests__/fixtures.ts:157
- (medium / Reuse, simplify, perf) Four parallel unapplied review artifacts for one tree; the newer one cites the older as still-outstanding work  @ /Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/.planning/reviews/hybrid-working-2026-09-04-pass1.review.md:178
- (low / Correctness & tests) eslint.config.js: boundary bans process.std* but not process.exit()/abort(), the one call that voids the Result + exitCode design  @ eslint.config.js:20
- (low / Reuse, simplify, perf) `IO_MODULES.replace('/', '\\/')` escapes only the first slash, so the esquery selectors break the moment a second slashed module is banned  @ eslint.config.js:13
- (low / Reuse, simplify, perf) `build`/`prepack` never clean dist/, so deleted or renamed sources leave stale modules that get published  @ package.json:20
- (low / Terum invariants) engines floor (22.12.0) is below what eslint@10 supports, so the mandated lint gate cannot run on the declared minimum Node  @ package.json:7
- (low / Correctness & tests) vitest env leaves GIT_ASKPASS/SSH_ASKPASS ambient, so GIT_TERMINAL_PROMPT=0 does not actually prevent a credential prompt  @ vitest.config.ts:18
- (low / Correctness & tests) A non-CommanderError escaping parseAsync exits 1 with no message at all  @ src/index.ts:23
- (low / Correctness & tests) exists() reports false for every error, not just ENOENT, and src/lib/fs.ts has no collocated test  @ src/lib/fs.ts:4
- (low / Correctness & tests) systemRunner's stdio:'inherit' branch — the only path that hands the user's terminal to a child — has no test  @ src/lib/runner.ts:19
- (low / Reuse, simplify, perf) constants.ts and NonInteractivePrompter ship as placeholders with zero consumers in this milestone  @ src/lib/constants.ts:2
- (low / Correctness & tests) team.run dispatch and buildProgram's default verb bindings are never exercised  @ src/__tests__/cli.test.ts:11
- (low / Correctness & tests) UTF-8 decoding test uses a payload too small to ever split a multi-byte sequence across chunks  @ src/lib/__tests__/runner.test.ts:26
- (low / Reuse, simplify, perf) ScriptedPrompter.select does not mirror terminalPrompter.select, so a scripted number or an out-of-range answer passes where production would re-ask  @ src/lib/__tests__/fixtures.ts:33
- (low / Security & data-loss) Throwaway HOME directory is created per test file and never removed  @ src/lib/__tests__/setup.ts:13
- (low / Correctness & tests) `expect(...).not.toThrow(/…/)` passes vacuously when nothing is thrown  @ src/lib/__tests__/schema.test.ts:54
- (low / Correctness & tests) Neither review artifact records the base commit or tree hash it reviewed, so staleness is undetectable from the file  @ .planning/reviews/hybrid-working-2026-09-04-pass1.review.md:3
- (low / Reuse, simplify, perf) login re-implements the D7 "PAT is GitHub-only" gate with a second predicate, leaving authenticateCreator's own guard unreachable and hostOperationAllowed with one call site  @ /Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/commands/login.ts:29
- (low / Security & data-loss) login persists the team→remote binding without ever contacting the remote when gh is logged in, and the CLI offers no way to correct it  @ src/commands/login.ts:41
- (low / Security & data-loss) mkdirPrivate does not enforce 0700 on a directory that already exists  @ src/lib/fs.ts:8
- (low / Security & data-loss) remoteToGitUrl tests FILE_CANONICAL before FILE_URL_FORM, so `file:///path` becomes `///path`  @ src/lib/remote.ts:69
- (low / Security & data-loss) mappedRunner silently falls through to the real system git for any argument it fails to map, so a remote-spelling drift becomes a live github.com call instead of a test failure  @ src/lib/__tests__/fixtures.ts:117
- (low / Reuse, simplify, perf) `sourceMap: true` plus a `files` list that omits `src` publishes ~61 kB of sourcemaps that can never resolve  @ tsconfig.build.json:4
- (low / Reuse, simplify, perf) `src/lib/placer/vendor/**` in PROMPTER_BOUNDARY.ignores is dead config — the global ignores block already excludes it from all linting  @ eslint.config.js:16
- (low / Terum invariants) login's "already configured as team X" error prints a command the CLI rejects  @ src/commands/login.ts:25
- (low / Terum invariants) login reports authenticated:false and gh installed:false on a non-GitHub remote even when gh is logged in  @ src/commands/login.ts:33
- (low / Terum invariants) Placeholder Actions workflow is scaffolded into every private team repo and fires a billed runner on every push and PR to do nothing  @ src/commands/team.ts:303
- (low / Terum invariants) terminalPrompter derives `interactive` from stdin only, so a redirected stdout produces the invisible hang the module was written to prevent  @ src/lib/prompt.ts:57
- (low / Terum invariants) `exists()` is reimplemented identically in three places instead of importing the lib helper  @ src/lib/fs.ts:3
- (low / Terum invariants) parseSkillFrontmatter returns a raw Zod JSON dump instead of the module's own describeIssues  @ src/lib/schema.ts:117
- (low / Terum invariants) cli.test.ts's output suppression is a no-op for subcommands, so the missing-option test writes commander's error to the real stderr  @ src/__tests__/cli.test.ts:15
- (low / Terum invariants) snapshotSkillDirectory silently omits symlinked entries, so a skill that gains a symlink fingerprints as unchanged  @ src/lib/placer/vendor/skillhub/skill-fingerprint.ts:50
- (low / Terum invariants) Fake terminal advances only on a prompt-suffix regex, so any prompt-format change hangs the suite for the 120s timeout instead of failing  @ src/lib/__tests__/prompt.test.ts:70
- (low / Terum invariants) Deadline-exhaustion test asserts only the error class, leaving an off-by-one attempt count in SafeWriteExhausted unverified  @ src/lib/__tests__/teamRepo.test.ts:50
- (low / Terum invariants) `exists` helper re-implemented in the test file that already imports the identical fixture export  @ src/lib/__tests__/teamRepo.test.ts:9
- (low / Reuse, simplify, perf) Every verb reads and parses config.json twice per run, and login's two branches seed prompt defaults from different snapshots  @ /Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/commands/login.ts:23
- (low / Reuse, simplify, perf) `error instanceof Error ? error.message : String(error)` is hand-copied at 9 non-test sites, three of them the identical `return failure(...)` line  @ /Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/commands/login.ts:45
- (low / Reuse, simplify, perf) identityForJoiner is a single-use wrapper while create and login hand-roll the same collectIdentity+ghState call  @ src/commands/team.ts:55
- (low / Reuse, simplify, perf) exists() is defined twice with different symlink semantics — the shared fs.ts helper is shadowed by a private copy  @ src/lib/fs.ts:3
- (low / Reuse, simplify, perf) `sameRemote` has zero production callers while assertOrigin inlines its exact body  @ src/lib/remote.ts:58
- (low / Reuse, simplify, perf) ghState spawns `gh` twice where one `gh auth status` gives the same three-way answer  @ src/lib/auth.ts:20
- (low / Reuse, simplify, perf) The scripted-identity answer array and the temp ConfigStore setup are re-typed in every command test instead of living in fixtures  @ src/commands/__tests__/create.test.ts:21
- (low / Reuse, simplify, perf) Tautological PromptClosedError assertion in join.test duplicates real coverage in prompt.test  @ src/commands/__tests__/join.test.ts:168
- (low / Reuse, simplify, perf) prompt.test.ts lints every vector 3× against paths that resolve to an identical ESLint config  @ src/lib/__tests__/prompt.test.ts:50
- (low / Reuse, simplify, perf) Pointless object spread and a lying `as 'git'` cast in the ENOENT test  @ src/lib/__tests__/runner.test.ts:20
- (low / Reuse, simplify, perf) `createConfigStore(join(await temporaryDirectory(), 'skills'))` copy-pasted across ~9 sites instead of a fixtures helper  @ src/lib/__tests__/config.test.ts:10
- (low / Reuse, simplify, perf) guard.test.ts's GuardTree double contradicts the production makeTree contract (no-op 'changes', unsorted paths)  @ src/lib/__tests__/guard.test.ts:11
- (low / Reuse, simplify, perf) bareTeam() hand-rolls a second, divergent copy of the §4.1 scaffold that production bootstrap() writes  @ src/lib/__tests__/fixtures.ts:55
- (low / Reuse, simplify, perf) SKILL.md frontmatter builders and the same skill-id literal are re-declared in three test files instead of living in the fixtures module added alongside them  @ src/lib/__tests__/schema.test.ts:4