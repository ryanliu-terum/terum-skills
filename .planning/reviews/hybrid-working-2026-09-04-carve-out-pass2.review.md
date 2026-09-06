# ultrareview: working (M1 security carve-out, pass 2)

> **Disposition (2026-09-04, carve-out pass 2 — NOT APPLIED).** Panel: Codex gpt-5.6-sol@high, 3 voters, relayFailures 0, panelValid. 15 raw → 10 distinct → 7 confirmed (0 critical / 1 high / 4 medium / 2 low), 2 contested, 1 killed 0-3. Ryan stopped the fix-and-re-review loop after this run ("finish this review then stop"), so every item below is open and waiting for his call; none is in the working tree. Triage sorted them 4 mechanical / 3 clear / 0 fork:
> - **HIGH `redact()` misses a `/` in a password** — mechanical: make the message fallback lossy-but-safe (everything between the scheme and the LAST `@` becomes `<redacted>`), add a `/`-bearing secret to the test `SECRETS`. Note the URL itself is not one git/curl would authenticate with (an unencoded `/` ends the authority), so no working credential reaches git; the typed string is echoed in the "Unsupported remote" error.
> - **MEDIUM `team create` strips before it validates** — mechanical: validate `args.remote` (normalizeRemote) BEFORE stripping, as `team join` already does, so `--upload-pack=x:y@z.com/p` cannot be rewritten into `z.com/p`.
> - **MEDIUM vacuous `remoteToGitUrl` assertion in the rejection loop** — clear (test only): assert it throws too.
> - **MEDIUM `teamRepo.ts` redaction untested** — clear (test only): a wrong-origin and a failed-clone case with a credentialed remote.
> - **MEDIUM file branch not idempotent (`/tmp/.git` → `file:/tmp/`)** — clear: strip `.git` then trailing slashes, in that order, and reject an empty path.
> - **LOW option-shaped ssh login / scp path re-emitted** — mechanical: reject a leading `-` on the ssh user and on the scp path.
> - **LOW `remoteName` splits on `:` unconditionally** — mechanical: split on `:` only for the single-label `host:path` spelling.
> - **contested LOW ssh login dropped for single-label hosts (2-1)** — a documented rough edge of the `host:path` spelling; Ryan's call whether to keep the login in the normalized form.
> - **contested LOW `login --remote` has no notice (1-2)** — recommend decline: `login` loses `--remote` entirely in the gated wave (Decision 4).
> - **killed 0-3** (`--` pairing duplicated) — nothing to do.

**Verdict.** This diff hardens remote parsing so no credential reaches git argv, config, or an error message — and the structured parser mostly delivers. What does not hold is the *fallback*: `redact()` (src/lib/remote.ts:43) is a purely textual scrub whose character classes cannot cross a `/`, so a password containing an unencoded `/` fails the structured parse *and* the textual fallback and is printed verbatim to stderr by `execute` — the one guarantee the module header advertises. The same never-throws fallback is also used as an *operative* value in `team create` (src/commands/team.ts:53 sanitizes before validating), where it can rewrite an option-shaped hostile input into a well-formed remote pointing at a host the user never typed; `team join` gets the order right, so `create` is the odd one out. Alongside those, the new tests have two real holes (a vacuous `remoteToGitUrl` assertion, and zero coverage for the teamRepo.ts redaction), and the file branch of `normalizeRemote` skips the shared path cleanup, breaking the idempotence the docstring and the new test claim. Nothing here is a live remote-code-execution path — modern git independently refuses the option-shaped strings — but the defense-in-depth layer this diff exists to add has gaps exactly where the tests do not look.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 2 |

Reviewers filed 15 raw findings; 5 cross-dimension duplicates were merged before verification, leaving 10 distinct. 7 confirmed by 3-vote adversarial verification, 2 contested (listed separately, excluded from counts).

## Terum invariants

- [ ] **(high) `redact()` misses passwords containing `/`, so the error message echoes the pasted token verbatim** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:43` *(3-0; merges 3 reviewer reports across Terum invariants / Reuse, simplify, perf / Security & data-loss)*

  **Evidence.** `redact()` is `input.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1').replace(/[^\s/@]+:[^\s/]+@/g, '')` — both alternatives exclude `/` from the credential run, and `URL_FORM` (remote.ts:25) uses `(?:([^/]*)@)?` for userinfo, which cannot cross a `/` either. So a `/`-bearing password fails the structured parse *and* the textual fallback. Verified by running the module:

  ```
  normalize(https://me:aWxs/K3Q@git.example/team.git) THROW: Unsupported remote: https://me:aWxs/K3Q@git.example/team.git
  strip  (https://me:aWxs/K3Q@git.example/team.git) => "https://me:aWxs/K3Q@git.example/team.git"
  hasEmbedded => false
  ```

  That message is the `Result.error` returned by `create`/`join`/`login`, written straight to stderr by `execute` (src/index.ts:12). It contradicts the guarantee stated at remote.ts:10-12 ("a `redact` helper so error messages never echo secrets"); `/` is routine in base64-alphabet secrets (AWS CodeCommit HTTPS credentials, Google Cloud Source Repositories, Artifactory keys). `SECRETS = ['tok', 'leak', 'p@ss', 't@k']` (remote.test.ts:4) contains no `/`, so the gap is untested. `hasEmbeddedCredentials` also returns false, so the user is never told a credential was ignored.

  **Fix.** Make the fallback lossy-but-safe rather than regex-precise: when the input contains an `@` at all, replace everything between the scheme (or start) and the **last** `@` with a fixed placeholder (`https://<redacted>@git.example/team.git`), e.g. anchor on `/^([a-z][a-z0-9+.-]*:\/\/)(.*)@/i` (greedy) instead of `[^/\s]*@` — or simply refuse to echo any input that still contains `@` after redaction. Add a `/`-bearing secret (`p/q`, `gh/p_tok`) to `SECRETS` at src/lib/__tests__/remote.test.ts:4 and to the hostile-input loop, plus the create/join leak tests. This is the only scrubber used by src/lib/teamRepo.ts:143,246 and src/lib/remote.ts:183, so fixing it here covers those sites.

- [ ] **(medium) `normalizeRemote`'s file branch skips `cleanPath`/`assertHostAndPath`, breaking the newly claimed idempotence for local remotes** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:126` *(3-0)*

  **Evidence.** Every non-file branch routes its path through `cleanPath` (strip surrounding slashes, then `.git`) and `assertHostAndPath`'s empty-path check (remote.ts:55-63, 81/92/97). The file branch does neither: `parseRemote` returns the raw path (remote.ts:72,74,75) and `normalizeRemote` returns `` `file:${stripGitSuffix(remote.path)}` ``, where `stripGitSuffix` removes trailing slashes *before* `.git`, leaving the slash behind.

  ```
  normalize(/tmp/.git)  => "file:/tmp/"   renormalize => "file:/tmp"    <-- not idempotent
  normalize(/.git)      => "file:/"       renormalize THROW: Unsupported remote: file:/
  normalize(/)          => "file:"        renormalize THROW: Unsupported remote: file:
  ```

  This contradicts the docstring at remote.ts:121 ("Idempotent … for every accepted form") and the test at remote.test.ts:114, which only exercises `/tmp/x/team.git` and `file:///tmp/x/team.git`. Concrete failure: `team join /srv/teams/x/.git` stores `file:/srv/teams/x/`, a later `team join /srv/teams/x` computes `file:/srv/teams/x`, and `ensureClone` (src/commands/team.ts:203) throws "…is a clone of file:/srv/teams/x/, not file:/srv/teams/x; pass `--as <other-name>`" for the same repository — a §5.1 remote-matching violation. `sameRemote('/srv/x/.git', '/srv/x')` is likewise `false`.

  **Fix.** Run the file path through the same normalization at remote.ts:126 (strip `.git` then any trailing slash, in that order) and reject an empty result so `/`, `//`, `/.git` are refused and `<path>/.git` collapses to `<path>`. Add `'/tmp/x/team/.git'`, `'/'`, `'/.git'` to the idempotence and rejection lists at src/lib/__tests__/remote.test.ts:114 and :123.

## Security & data-loss

- [ ] **(medium) `team create` sanitizes the remote before validating it, so an option-/helper-shaped `--remote` containing `user:pass@` is silently rewritten into a valid remote instead of refused** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/commands/team.ts:53` *(3-0; merges 3 reviewer reports across Security & data-loss / Terum invariants / Reuse, simplify, perf)*

  **Evidence.** team.ts:53-58 makes `stripRemoteCredentials` the first thing that touches user input, and validation then runs on the already-rewritten string:

  ```ts
  remote = stripRemoteCredentials(args.remote);
  const bound = teamByRemote(config, remote);          // validates the REWRITTEN value
  const heads = await runner.run('git', ['ls-remote', '--heads', '--', remoteToGitUrl(remote)]);
  ```

  But `stripRemoteCredentials` (remote.ts:148-156) deliberately never throws: when `parseRemote` refuses the input it returns `redact(trimmed)`, a blind textual `.replace(/[^\s/@]+:[^\s/]+@/g, '')` that can delete the very prefix that made the input hostile. Verified against the real regexes:

  ```
  '--upload-pack=x:y@z.com/p'  -> 'z.com/p'          (matches CANONICAL_FORM)
  'ext::sh:x@evil.example/p'   -> 'evil.example/p'   (matches CANONICAL_FORM)
  ```

  So `team create t --remote '--upload-pack=x:y@z.com/p'` is not refused: the "looks like an option" throw is swallowed, `remote` becomes `z.com/p`, `hasEmbeddedCredentials` is true so the user is told "Ignored the credential embedded in the remote URL … Access to z.com/p …" (there was no credential), and git runs `ls-remote --heads -- https://z.com/p.git` against a host the user never typed. This contradicts remote.ts:8-12 ("Anything that starts with `-` … is refused before any pattern runs"). `parseJoinTarget` (team.ts:231-232) gets the order right — `normalizeRemote(trimmed)` on the raw value first — so `join` is safe. The new create test passes only because both hostile inputs (`'--upload-pack=touch:pwned'`, `'ext::sh -c id'`) contain no `@`.

  **Fix.** Validate the raw input before scrubbing: call `normalizeRemote(args.remote)` (or `parseRemote`) at team.ts:53 first, then assign `remote = stripRemoteCredentials(args.remote)`, mirroring team.ts:231. Alternatively give `stripRemoteCredentials` a throwing sibling for operative use and keep the redacting one for messages only (teamRepo.ts:143,246 and remote.ts:183 are message-only and fine); or on the catch path return the trimmed input unchanged so it is refused downstream, rather than substituting a regex-derived string. While there: both call sites compute the strip and the credential notice from two independent parses of the same input — have `stripRemoteCredentials` return `{ remote, stripped }` so they cannot disagree. Add `'--upload-pack=x:y@z.com/p'` and `'ext::sh:x@evil.example/p'` to the hostile lists in create.test.ts and join.test.ts.

- [ ] **(low) Option-shaped ssh userinfo and scp paths are not covered by the `-` refusal and are re-emitted verbatim into git argv** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:83` *(3-0)*

  **Evidence.** `assertHostAndPath` (remote.ts:60-63) only rejects an option-shaped **host**: `if (host.startsWith('-')) throw unsupported(...)`. The ssh userinfo is kept unchecked at remote.ts:83 (`const user = scheme.toLowerCase() === 'ssh' ? (url[2] ?? '').split(':')[0]! : ''`) and `toGitUrl` (remote.ts:111-112) puts it straight back. The scp branch (remote.ts:91-93) likewise keeps `path` unchecked.

  ```
  remoteToGitUrl('ssh://-oProxyCommand=touch+x@host.example/o/r')  -> unchanged, reaches `git ls-remote --heads -- <that>`
  remoteToGitUrl('git@host.example:-oProxyCommand=touch+x')        -> unchanged, reaches git argv
  ```

  The new test asserts refusal "at every entry point" but its hostile list only covers option-shaped *hosts* (`git@-evil:…`, `ssh://git@-evil/…`). Impact is bounded: git 2.50.1 refuses both itself (`fatal: strange hostname '…' blocked`, `fatal: strange pathname '…' blocked` — CVE-2017-1000117 hardening, git >= 2.14.1), so this is a hole in the new defense-in-depth layer rather than a live exploit; on a pre-2.14.1 git it is option injection into ssh.

  **Fix.** Apply the same `startsWith('-')` check to the reconstructed ssh `user` and the scp `path` inside `assertHostAndPath` (or just before the returns at remote.ts:84 and :93), and add `'ssh://-oProxyCommand=x@host.example/o/r'` and `'git@host.example:-oProxyCommand=x'` to the hostile list in src/lib/__tests__/remote.test.ts.

## Correctness & tests

- [ ] **(medium) Secret-free assertion on `remoteToGitUrl` is vacuous when it does not throw** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/__tests__/remote.test.ts:93` *(3-0)*

  **Evidence.** `thrownMessage()` returns `''` when the callback does **not** throw. The rejection loop asserts `toContain('Unsupported remote')` for `normalizeRemote` (line 91) but not for `remoteToGitUrl`:

  ```ts
  const viaGit = thrownMessage(() => remoteToGitUrl(input));
  for (const secret of SECRETS) expect(viaGit, input).not.toContain(secret);
  ```

  If a future edit made `remoteToGitUrl('https://user:tok@github.com')` *return* the input instead of throwing, `viaGit` would be `''` and every `not.toContain` would pass. `remoteToGitUrl`'s return value is the string that lands in git argv (team.ts:58, team.ts:272, teamRepo.ts:245) — the one function this change exists to keep credential-free — and on this input set the test constrains only its throw message, never its return value or that it throws at all.

  **Fix.** Mirror line 91: add `expect(viaGit, input).toContain('Unsupported remote');` immediately before the secrets loop, and/or assert `expect(() => remoteToGitUrl(input)).toThrow('Unsupported remote')`.

- [ ] **(medium) `teamRepo.ts` credential redaction in error messages is never exercised by a test** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/teamRepo.ts:143` *(3-0)*

  **Evidence.** Both new `stripRemoteCredentials` calls are dead as far as the suite is concerned:

  ```ts
  // teamRepo.ts:143
  throw new Error(`Clone at ${root} points at ${stripRemoteCredentials(actual)}, not ${stripRemoteCredentials(remote)}; refusing to write to the wrong repository`);
  // teamRepo.ts:246
  if (clone.code !== 0) throw new Error(`Could not clone ${stripRemoteCredentials(remote)}: ...`);
  ```

  The only test reaching the first message (src/lib/__tests__/teamRepo.test.ts:97) passes a credential-free remote (`openTeamRepo(clone, 'https://github.com/someone/else.git')`). `cloneTeam` has no direct test at all — `grep -rn cloneTeam src` finds only the definition and the team.ts call site; join.test.ts:202-203 covers the `--` in its argv but never a clone failure. Reverting both calls to bare `${actual}` / `${remote}` would leave the suite green, unlike the equivalent hardening in create.ts/join.ts which got dedicated tests in this same batch.

  **Fix.** Add teamRepo.test.ts cases that (a) point a clone's origin at a credential-bearing URL and assert the `wrong repository` message contains neither the token nor `@`, and (b) drive `cloneTeam` against an unreachable credential-bearing remote and assert the `Could not clone` message is secret-free.

## Reuse, simplify, perf

- [ ] **(low) `remoteName()` splitting on the last `:` truncates the default team name for local/file remotes whose basename contains a colon** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:170` *(3-0)*

  **Evidence.** remote.ts:169-170: `return normalized.slice(Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf(':')) + 1);`. The `:` was added for the new single-label scp spelling (`myhost:team`) but is applied unconditionally, including to `file:<abs path>` and dotted-host forms where `:` is part of the basename.

  ```
  normalizeRemote('/tmp/teams/my:team.git') -> 'file:/tmp/teams/my:team'
  remoteName('/tmp/teams/my:team.git')      -> 'team'   (was 'my:team' before this change)
  remoteName('file:/srv/git/a:b')           -> 'b'
  remoteName('https://git.example/o/re:po.git') -> 'po'
  ```

  `team join /tmp/teams/my:team.git` with no `--as` therefore binds the team under the name `team` (src/commands/team.ts:106), silently dropping part of the repository name — and sibling repos `my:team.git` and `your:team.git` both default to `team`, colliding at team.ts:107.

  **Fix.** Only consult `:` when the normalized remote has no `/` (the single-label scp spelling this change introduced): `const cut = normalized.includes('/') ? normalized.lastIndexOf('/') : normalized.lastIndexOf(':'); return normalized.slice(cut + 1);`. Add `remoteName('/tmp/teams/my:team.git') === 'my:team'` next to the existing `remoteName('myhost:team.git')` case in src/lib/__tests__/remote.test.ts.

## Contested (split adversarial verdict -- needs human adjudication)

- **(low / Correctness & tests) normalizeRemote drops the ssh login for single-label hosts, so the stored remote no longer names the same access path** @ src/lib/remote.ts:129 [vote 2-1]

  Evidence:
  ```ts
  // remote.ts:129
  if (!host.includes('.')) return `${host}:${path}`;
  ```

  The scp branch of `toGitUrl` re-emits the user only if the ParsedRemote carries one, and the normalized single-label string carries none: `normalizeRemote('ssh://git@myhost/org/repo.git')` -> `'myhost:org/repo'` (asserted at remote.test.ts:26), then `remoteToGitUrl('myhost:org/repo')` -> `'myhost:org/repo'` — the `git@` login is gone, so ssh connects as the local `$USER`. team.ts:140 persists exactly this value (`bindTeam(fresh, team, { remote: normalized, ... })`), so the durable config record for such a team no longer reconstructs a fetchable URL. Before this change the same input normalized to `myhost/org/repo`, which the old dot-requiring CANONICAL_FORM made `remoteToGitUrl` reject loudly — the change converts a loud failure into a silent wrong-identity remote. The new test claiming coverage is titled 'so an ssh alias round-trips' (remote.test.ts:23) but only asserts `expect(() => remoteToGitUrl(once), input).not.toThrow()` (line 40); it never asserts the round-trip names the same repository or user, so this loss is invisible to the suite. Not reachable in git argv today (login.ts only probes when hostOperationAllowed is true, and create passes the raw remote), but the wrong value is already being written to config for M2+ consumers.

  Additional evidence cited for the same defect (other review dimensions):
  - `normalizeRemote` now returns the scp spelling for a single-label host (remote.ts:129: `if (!host.includes('.')) return `${host}:${path}`;`) and `toGitUrl` reconstructs the scp form from `remote.user` (remote.ts:112). But `normalizeRemote` never carries the user forward, so `ssh://git@myhost/org/repo.git` normalizes to `myhost:org/repo`, and `remoteToGitUrl('myhost:org/repo')` yields `myhost:org/repo` — an ssh remote with no login, which git resolves as `$USER@myhost` rather than `git@myhost`. T...

- **(low / Terum invariants) login is the third user-supplied-remote entry point but got neither the explicit strip nor the credential notice** @ src/commands/login.ts:20 [vote 1-2]

  Evidence: The change adds credential stripping plus a one-time `credentialNotice` at both `team create` (src/commands/team.ts:53,56) and `team join` (src/commands/team.ts:100,232). `login` takes an equally user-supplied `--remote` (src/cli.ts:22) and does only `const remote = normalizeRemote(args.remote)` (login.ts:20). `normalizeRemote` happens to drop a URL userinfo, so nothing leaks into config — but the user is never told their pasted token was ignored, and an scp-shaped credential (`user:tok@host:path`) makes `login` fail with a bare `Unsupported remote` instead of the actionable notice the other two verbs now print. The result is that the same paste behaves three different ways depending on the verb.

## Triage — 7 confirmed → 4 mechanical · 3 clear · 0 fork · 0 declined

Buckets are derived in code from each finding's ratings (single-fix gate: trivial + low risk + isolated + patch = mechanical). NOTHING here has been applied.

### Mechanical — one fix, trivial / low-risk / isolated, patch supplied; batch-apply on ONE confirmation (4)

- **high — redact() misses passwords containing `/`, so the error message echoes the pasted token verbatim** — `src/lib/remote.ts:43`
  - Root cause: `redact()` (src/lib/remote.ts:43) is the only scrubber every error message and every "safe value" path goes through, and both of its patterns bound the credential run with `/`: `([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@` and `[^\s/@]+:[^\s/]+@`. Neither class can cross a `/`, so a pasted URL whose password contains an unencoded `/` (routine for base64 secrets — CodeCommit, GCSR, Artifactory) matches nothing. The structured parser cannot save it either: `URL_FORM` (line 25) bounds userinfo with `([^/]*)@` — correctly, because git's authority ends at the first `/` — so `https://me:aWxs/K3Q@git.example/team.git` fails every form and reaches `throw unsupported(input)` (line 100). `unsupported()` (lines 46-48) interpolates `redact(input.trim())`, i.e. the untouched secret, into `Unsupported remote: …`; that string is the `Result.error` of create/join/login and is written to stderr by `execute` in src/index.ts:12. `hasEmbeddedCredentials` (line 159) also returns false for the same reason, so the user is not even told a credential was ignored. Verified by executing the exact regexes: current `redact('https://me:aWxs/K3Q@git.example/team.git')` returns the input unchanged. The defect is entirely in the fallback textual scrubber — widening `URL_FORM` instead would be a bug, since it would let `https://github.com/org/repo@v1.git` be re-read as userinfo + host `v1.git`. (src/lib/remote.ts:43)
  - Fix: src/lib/remote.ts:43 — drop `/` from both userinfo classes so the run reaches the LAST `@`: `input.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s]*@/gi, '$1').replace(/[^\s@]+:[^\s]+@/g, '')`, with a comment recording that over-scrubbing a non-remote is cosmetic while under-scrubbing prints the secret, and that URL_FORM (line 25) deliberately stays `/`-bounded because git's authority ends at the first `/`. Lock it in src/lib/__tests__/remote.test.ts: add `'aWxs/K3Q'` to SECRETS (line 4), add `'https://me:aWxs/K3Q@git.example/team.git'` to the hostile-input loop (line 89), and add a `hasEmbeddedCredentials(...)===true` assertion for the same URL. This is the only scrubber used by remote.ts:47, remote.ts:183, teamRepo.ts:143, teamRepo.ts:246 and team.ts:53,232, so one edit covers every site. Optional follow-up (not in the minimal patch): add the same `/`-password URL to the end-to-end leak tests in create.test.ts and join.test.ts.

```diff
--- a/src/lib/remote.ts
+++ b/src/lib/remote.ts
@@ -39,8 +39,13 @@
 const CASE_INSENSITIVE_HOSTS = new Set(['github.com']);
 
-/** For an input that was not a remote at all: scrub any `scheme://…tok@` or `user:tok@` run wherever it sits. */
+/**
+ * For an input that was not a remote at all: scrub any `scheme://…tok@` or `user:tok@` run wherever
+ * it sits. The run reaches the LAST `@`, across `/`, because a pasted password routinely contains a
+ * `/` (base64 alphabets) and no `/`-bounded pattern can find it. `URL_FORM` above stays `/`-bounded
+ * on purpose — git's authority ends at the first `/` — so such an input is refused, and this is the
+ * only thing standing between the secret and stderr. Over-scrubbing a non-remote is cosmetic;
+ * under-scrubbing one prints the secret.
+ */
 function redact(input: string): string {
-  return input.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1').replace(/[^\s/@]+:[^\s/]+@/g, '');
+  return input.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s]*@/gi, '$1').replace(/[^\s@]+:[^\s]+@/g, '');
 }
 
 function unsupported(input: string, why?: string): Error {
--- a/src/lib/__tests__/remote.test.ts
+++ b/src/lib/__tests__/remote.test.ts
@@ -2,5 +2,5 @@
 import { hasEmbeddedCredentials, hostOperationAllowed, isGitHubRemote, normalizeRemote, remoteName, remoteToGitUrl, sameRemote, stripRemoteCredentials } from '../remote.js';
 
-const SECRETS = ['tok', 'leak', 'p@ss', 't@k'];
+const SECRETS = ['tok', 'leak', 'p@ss', 't@k', 'aWxs/K3Q'];
 function thrownMessage(fn: () => unknown): string {
   try { fn(); } catch (error) { return (error as Error).message; }
@@ -86,4 +86,5 @@
     expect(hasEmbeddedCredentials('https://u:tok@github.com/o/r.git')).toBe(true);
     expect(hasEmbeddedCredentials(' https://tok@github.com/o/r.git')).toBe(true);
+    expect(hasEmbeddedCredentials('https://me:aWxs/K3Q@git.example/team.git')).toBe(true);
     for (const clean of ['git@github.com:o/r.git', 'ssh://git@github.com/o/r.git', 'github.com/o/r', '/tmp/x/team.git']) expect(hasEmbeddedCredentials(clean), clean).toBe(false);
-    for (const input of ['https://user:tok@github.com', 'https://user:tok@github.com/', '-https://user:tok@github.com/x', 'user:tok@host:path/', 'user:t@k@host:path/', 'https://me:gh@p_leak@git.example/.git', ' https://me:p@ss@-evil.example/x']) {
+    for (const input of ['https://user:tok@github.com', 'https://user:tok@github.com/', '-https://user:tok@github.com/x', 'user:tok@host:path/', 'user:t@k@host:path/', 'https://me:gh@p_leak@git.example/.git', ' https://me:p@ss@-evil.example/x', 'https://me:aWxs/K3Q@git.example/team.git']) {
```

- **medium — `team create` sanitizes the remote before validating it, so an option-/helper-shaped `--remote` containing `user:pass@` is silently rewritten into a valid remote instead of refused** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/commands/team.ts:53`
  - Root cause: Ordering: `create` scrubs the user's `--remote` before anything validates it. At src/commands/team.ts:53 `remote = stripRemoteCredentials(args.remote)` is the first thing to touch the raw input, and `stripRemoteCredentials` (src/lib/remote.ts:148-156) is documented as never-throwing: when `parseRemote` refuses the input it falls into `catch { return redact(trimmed) }`. `redact` (remote.ts:42-44) is a blind textual scrub, `.replace(/[^\s/@]+:[^\s/]+@/g, '')`, so it can delete the exact prefix that made the input hostile and return a well-formed remote. Every later check (team.ts:54 `teamByRemote`→`normalizeRemote`, team.ts:58 `remoteToGitUrl`) then runs on the ALREADY-REWRITTEN string, so nothing is left to refuse it. Verified by executing the real regexes: `'--upload-pack=x:y@z.com/p'` -> `'z.com/p'` and `'ext::sh:x@evil.example/p'` -> `'evil.example/p'`, both matching CANONICAL_FORM. Consequences: (1) git runs `ls-remote --heads -- https://z.com/p.git`, `remote add origin -- …`, and the scaffold push against a host the user never typed, and that host is stored in config; (2) `hasEmbeddedCredentials(args.remote)` is true (strip changed the string), so team.ts:56 prints "Ignored the credential embedded in the remote URL … Access to z.com/p …" when there was no credential. This contradicts the module contract at remote.ts:8-12 ("Anything that starts with `-` … is refused before any pattern runs"). The sibling operative call site gets the order right — src/commands/team.ts:231 calls `normalizeRemote(trimmed)` on the RAW value and only then strips at :232 — so `join` is safe and `create` is the odd one out. The new create test passes only because both of its hostile inputs contain no `@`, so `redact` leaves them intact (confirmed: `'--upload-pack=touch:pwned'` and `'ext::sh -c id'` round-trip unchanged). (src/commands/team.ts:53)
  - Fix: In src/commands/team.ts, insert `normalizeRemote(args.remote);` immediately before line 53's `remote = stripRemoteCredentials(args.remote);`, so an option-shaped, helper-shaped, or scp-with-credential input throws `Unsupported remote` on the RAW value before the never-throws scrubber can rewrite it. This is exactly the order src/commands/team.ts:231-232 already uses for `join`. Update the comment on team.ts:51-52 to say why the raw value is validated first. Add `'--upload-pack=x:y@z.com/p'` and `'ext::sh:x@evil.example/p'` to the hostile list in src/commands/__tests__/create.test.ts:150 and to src/commands/__tests__/join.test.ts:189 (join already passes them — regression coverage).

```diff
--- a/src/commands/team.ts
+++ b/src/commands/team.ts
@@ -47,8 +47,11 @@ export async function create(args: CreateArgs, io: Prompter): Promise<Result<Cre
     let remote: string;
     let token: string | null = null;
     let identity: Identity;
     if (args.remote) {
-      // Generic-git path: an existing EMPTY remote the user already has credentials for. A credential
-      // pasted into the URL is dropped here, before the remote reaches git, config, or a message.
-      remote = stripRemoteCredentials(args.remote);
+      // Generic-git path: an existing EMPTY remote the user already has credentials for. Validate the RAW
+      // value first, as `parseJoinTarget` does — `stripRemoteCredentials` never throws, and its textual
+      // fallback can rewrite a refused option-/helper-shaped input into a well-formed remote for a host the
+      // user never typed. Only then is a pasted credential dropped, before the remote reaches git, config,
+      // or a message.
+      normalizeRemote(args.remote);
+      remote = stripRemoteCredentials(args.remote);
       const bound = teamByRemote(config, remote);
--- a/src/commands/__tests__/create.test.ts
+++ b/src/commands/__tests__/create.test.ts
@@ -147,7 +147,7 @@ describe('team create (§6)', () => {
   it('refuses an option-shaped or helper-shaped --remote before running any git command', async () => {
     const { root, bare } = await emptyBare();
     const store = createConfigStore(pathJoin(root, 'local'));
-    for (const remote of ['--upload-pack=touch:pwned', 'ext::sh -c id']) {
+    for (const remote of ['--upload-pack=touch:pwned', 'ext::sh -c id', '--upload-pack=x:y@z.com/p', 'ext::sh:x@evil.example/p']) {
       const runner = mappedRunner(remote, bare);
       expect(await create({ name: 'evil', remote, config: store, runner }, new ScriptedPrompter(['me', 'me', 'Me', 'me@example.com'])), remote).toMatchObject({ ok: false, error: expect.stringContaining('Unsupported remote') });
       expect(runner.calls.filter((call) => call.command === 'git'), remote).toEqual([]);
--- a/src/commands/__tests__/join.test.ts
+++ b/src/commands/__tests__/join.test.ts
@@ -186,5 +186,5 @@ describe('team join (§6, §5.4 identity)', () => {
     expect(() => parseJoinTarget('not a target')).toThrow('Unsupported remote');
     expect(parseJoinTarget('https://me:ghp_leak@gitlab.com/acme/team.git')).toEqual({ remote: 'https://gitlab.com/acme/team.git', github: false });
     expect(parseJoinTarget(' https://me:gh@p_leak@gitlab.com/acme/team.git')).toEqual({ remote: 'https://gitlab.com/acme/team.git', github: false });
-    for (const hostile of ['--upload-pack=touch:pwned', 'ext::sh -c id', 'git@-evil:acme/team.git']) expect(() => parseJoinTarget(hostile), hostile).toThrow('Unsupported remote');
+    for (const hostile of ['--upload-pack=touch:pwned', 'ext::sh -c id', 'git@-evil:acme/team.git', '--upload-pack=x:y@z.com/p', 'ext::sh:x@evil.example/p']) expect(() => parseJoinTarget(hostile), hostile).toThrow('Unsupported remote');
   });
```

- **low — Option-shaped ssh userinfo and scp paths are not covered by the `-` refusal and are re-emitted verbatim into git argv** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:83`
  - Root cause: `assertHostAndPath` (src/lib/remote.ts:60-63) validates only ONE of the three pieces the parser later re-emits: it throws when `host.startsWith('-')`, but never looks at the ssh login or the path. The whole-string guard at remote.ts:69 (`trimmed.startsWith('-')`) cannot help, because these inputs start with `ssh://` or `git@`. So `parseRemote` stores the option-shaped piece (`user` at remote.ts:83 from the URL userinfo, `path` at remote.ts:93 from the scp form) and `toGitUrl` (remote.ts:111-112) concatenates it back verbatim into the single argv token handed to `git ls-remote/clone/remote add`. git then splits that token back apart and passes `user@host` to ssh as one argv element and the path to the remote command, so the piece that was never checked is exactly the piece that becomes an ssh argument. Verified against the live regexes: `ssh://-oProxyCommand=touch+x@host.example/o/r` parses with `user = '-oProxyCommand=touch+x'`, and `git@host.example:-oProxyCommand=touch+x` parses with `path = '-oProxyCommand=touch+x'`; both round-trip unchanged through `remoteToGitUrl`. The `--` at all four call sites (auth.ts:152, team.ts:58, team.ts:272, teamRepo.ts:245) stops git from reading the token as an option, but not ssh from reading the sub-piece as one. Impact is bounded today because git >= 2.14.1 refuses both itself ("strange hostname/pathname blocked"), so this is a gap in the new defense-in-depth layer rather than a live exploit — but the module header (remote.ts:8-9) claims the broader invariant and the new test claims it holds "at every entry point". (src/lib/remote.ts:60-63 (`assertHostAndPath` checks only `host`); re-emitted unchecked at src/lib/remote.ts:83 (ssh `user`), :93 (scp `path`), :111-112 (`toGitUrl`))
  - Fix: In src/lib/remote.ts add a one-line helper `assertNotOption(value, input)` that throws `unsupported(input, 'looks like an option')` on a leading `-`; call it from `assertHostAndPath` (remote.ts:60-63) for BOTH `host` and `path` (which covers the scp path at :92, the URL path at :81, and the canonical path at :97), and call it on the reconstructed ssh `user` immediately after remote.ts:83, before the `return`. Both entry points then refuse identically, because every shape check already lives in `parseRemote`. Extend the hostile list at src/lib/__tests__/remote.test.ts:57 with 'ssh://-oProxyCommand=touch+x@host.example/o/r', 'git@host.example:-oProxyCommand=touch+x' and 'https://host.example/-oProxyCommand=x/r'.

```diff
--- a/src/lib/remote.ts
+++ b/src/lib/remote.ts
@@ -57,7 +57,13 @@
 }
 
-/** A host that starts with `-` would reach ssh as an option; a path that is nothing but `.git` names no repository. */
+/** git splits a remote back into a login, a host, and a path; any piece starting with `-` reaches ssh as an option. */
+function assertNotOption(value: string, input: string): void {
+  if (value.startsWith('-')) throw unsupported(input, 'looks like an option');
+}
+
+/** A host or path that starts with `-` would reach ssh as an option; a path that is nothing but `.git` names no repository. */
 function assertHostAndPath(host: string, path: string, input: string): void {
-  if (host.startsWith('-')) throw unsupported(input, 'looks like an option');
+  assertNotOption(host, input);
+  assertNotOption(path, input);
   if (!cleanPath(path)) throw unsupported(input);
 }
@@ -81,5 +81,6 @@
     assertHostAndPath(host, path, input);
     // Only ssh keeps a login (`git@`); an http(s)/git userinfo is only ever a credential. A password never survives.
     const user = scheme.toLowerCase() === 'ssh' ? (url[2] ?? '').split(':')[0]! : '';
+    assertNotOption(user, input);
     return { kind: 'url', scheme, user, host, port: url[4] ?? '', path };
   }
--- a/src/lib/__tests__/remote.test.ts
+++ b/src/lib/__tests__/remote.test.ts
@@ -56,3 +56,3 @@
   it('refuses option-shaped and transport-helper remotes before any pattern runs, at every entry point', () => {
-    const hostile = ['--upload-pack=touch:pwned', '-oProxyCommand=x:y', ' --upload-pack=x:y', '-', 'ext::sh -c id', 'fd::17', 'https://-evil.example/acme/team.git', 'https://a@b@-evil.example/acme/team.git', 'git@-evil:acme/team.git', 'ssh://git@-evil/acme/team.git'];
+    const hostile = ['--upload-pack=touch:pwned', '-oProxyCommand=x:y', ' --upload-pack=x:y', '-', 'ext::sh -c id', 'fd::17', 'https://-evil.example/acme/team.git', 'https://a@b@-evil.example/acme/team.git', 'git@-evil:acme/team.git', 'ssh://git@-evil/acme/team.git', 'ssh://-oProxyCommand=touch+x@host.example/o/r', 'git@host.example:-oProxyCommand=touch+x', 'https://host.example/-oProxyCommand=x/r'];
     for (const input of hostile) {
```

- **low — remoteName() splitting on the last `:` truncates the default team name for local/file remotes whose basename contains a colon** — `/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:170`
  - Root cause: `remoteName` re-derives the repository basename by string surgery on the *normalized* remote instead of on the parsed one: it cuts at whichever of `/` or `:` appears last. After this change `:` is a separator in exactly ONE normalized spelling — the new single-label scp form `host:path` produced at src/lib/remote.ts:129 (`if (!host.includes('.')) return `${host}:${path}``). In the other two normalized spellings (`file:<abs path>` from line 126, and `host/path` for a dotted host from line 130) a `:` is an ordinary character inside the path, so any repository whose basename contains a colon is truncated at that colon. Verified against the real strings: `file:/tmp/teams/my:team` -> `team` (was `my:team`), `gitlab.com/Org/re:po` -> `po`. That value is the default team name at src/commands/team.ts:106 (`existing?.[0] ?? args.as ?? remoteName(target.remote)`), so `team join /tmp/teams/my:team.git` with no `--as` binds the clone under `team`, and a sibling `your:team.git` collides on it at team.ts:107. The build spec §6 (`.planning/specs/2026-09-02-phase-1-build.md:297`) states "The team name is the repo basename unless `--as <name>` overrides", which the truncated value violates. No deferral exists: `.planning/debug/` is absent, there is no PRODUCT-CONCERNS.md, and the ledger `.planning/decisions/2026-09-04-m1-hardening-decision-walk.md` records nothing about basename derivation. (/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:170)
  - Fix: In `remoteName` (src/lib/remote.ts:168-171) replace the `Math.max(lastIndexOf('/'), lastIndexOf(':'))` cut with: consult `:` only when there is no `/` at all — `const cut = normalized.includes('/') ? normalized.lastIndexOf('/') : normalized.lastIndexOf(':'); return normalized.slice(cut + 1);` — plus a two-line comment saying why (`:` separates only in the single-label scp spelling). Add the regression cases to the existing 'names a team after the repository basename' test at src/lib/__tests__/remote.test.ts:112-116: `remoteName('/tmp/teams/my:team.git') === 'my:team'` and `remoteName('https://gitlab.com/Org/re:po.git') === 're:po'`.

```diff
--- a/src/lib/remote.ts
+++ b/src/lib/remote.ts
@@ -167,5 +167,7 @@
 /** The repository basename, used as the default team name at `team join <url>` (§6). */
 export function remoteName(remote: string): string {
   const normalized = normalizeRemote(remote);
-  return normalized.slice(Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf(':')) + 1);
+  // `:` separates only in the single-label scp spelling (`myhost:team`); in `file:/…` and in a
+  // dotted-host path it belongs to the name, so a `/` wins whenever the normalized form has one.
+  const cut = normalized.includes('/') ? normalized.lastIndexOf('/') : normalized.lastIndexOf(':');
+  return normalized.slice(cut + 1);
 }
--- a/src/lib/__tests__/remote.test.ts
+++ b/src/lib/__tests__/remote.test.ts
@@ -112,5 +112,7 @@
   it('names a team after the repository basename', () => {
     expect(remoteName('git@github.com:Org/Team-Skills.git')).toBe('team-skills');
     expect(remoteName('https://gitlab.com/Org/Team-Skills.git')).toBe('Team-Skills');
     expect(remoteName('/tmp/x/team.git')).toBe('team');
+    expect(remoteName('/tmp/teams/my:team.git')).toBe('my:team');
+    expect(remoteName('https://gitlab.com/Org/re:po.git')).toBe('re:po');
   });
```


### Clear — one fix clearly wins, but not mechanical; confirm each, or hand to /parallel-fix (3)

- **medium — Secret-free assertion on remoteToGitUrl is vacuous when it does not throw** — `src/lib/__tests__/remote.test.ts:93`
  - Root cause: `thrownMessage` (src/lib/__tests__/remote.test.ts:5-8) is a fail-OPEN helper: on the no-throw path it falls through to `return '';`. Vitest's `.not.toContain(x)` is trivially satisfied by `''`, so any assertion built only from `thrownMessage(...)` + `.not.toContain(...)` passes both when the function threw a scrubbed message AND when it did not throw at all. Line 90-92 neutralises that for `normalizeRemote` by pinning the message first (`expect(message, input).toContain('Unsupported remote')` — `''` fails that). Lines 93-94 do NOT: `const viaGit = thrownMessage(() => remoteToGitUrl(input));` is followed straight by `for (const secret of SECRETS) expect(viaGit, input).not.toContain(secret);` with nothing in between that a `''` would fail. I confirmed by hand-tracing all 7 inputs through `parseRemote` (src/lib/remote.ts:66-101) that `remoteToGitUrl` does throw for every one of them today (empty/absent path → `assertHostAndPath` at :62; leading `-` → :69 and :61; `@` in an scp first path segment → :91), so the test is green for the right reason right now — but the assertion has zero power to keep it that way. `remoteToGitUrl`'s RETURN value is what reaches git argv (src/commands/team.ts:58, :272; src/lib/teamRepo.ts:245), and on this input set nothing constrains that return value or even that a return does not happen: a regression that made `remoteToGitUrl('https://user:tok@github.com')` return the credential-bearing string verbatim would leave this suite passing. (src/lib/__tests__/remote.test.ts:7 (`return '';` — thrownMessage's fail-open no-throw path), consumed without a throw assertion at src/lib/__tests__/remote.test.ts:93-94)
  - Rated: trivial / low risk / pattern — siblings: Sweep worklist for the same defect class — an assertion about a failure's CONTENT that is also satisfied by the absence of any failure:
1. /Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/__tests__/remote.test.ts:93-94 — the finding itself (`viaGit` from the fail-open helper, then `.not.toContain`). This is the only instance inside the current diff.
2. /Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/__tests__/remote.test.ts:7 — the shared cause; the helper's `return '';` makes instance 1 possible and would make any future third call site vacuous the same way. Line 90-92 is the one call site currently immunised (by `toContain('Unsupported remote')` at :91).
3. /Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/__tests__/schema.test.ts:54 — `expect(() => parseOrExplain(teamNameSchema, '../x', 'team name')).not.toThrow(/\[/);`. Same shape via the vitest matcher rather than the helper: parseOrExplain is supposed to throw here (the surrounding test is 'validation errors read as rules'), and if a regression made it return instead, `.not.toThrow(/\[/)` still passes. PRE-EXISTING and OUTSIDE this diff (schema.test.ts is not in `git diff HEAD --stat`); already logged once at .planning/reviews/hybrid-working-2026-09-04-pass2.review.md:255 as low. Fix would be `.toThrow(...)` with the expected message plus a separate check that it contains no `[`.
Checked and NOT affected (verified, do not sweep): remote.test.ts:95 and :97 (stripRemoteCredentials never throws and hostOperationAllowed's `ok:false` is asserted, so neither can be empty/absent); create.test.ts:168-169 and join.test.ts:198-199 (guarded by `if (!result.ok) throw` plus positive assertions on the success path — these are the already-clear-fixed versions noted at .planning/reviews/hybrid-working-2026-09-04-carve-out-pass1.review.md:6).
  - Why one fix: No real trade-off. All three are test-only edits of one or two lines with identical cost; the recommended one is just the other two done together, and it is the only one that both (a) states the thing the reviewer wanted stated — that remoteToGitUrl rejects each credential-bearing input, matching what line 91 already does for its sibling function — and (b) removes the empty-string trap so the next person to reach for this helper cannot fall into it. Neither alternative beats it on anything; each is a strict subset of it.
  - **Option 1: Pin the throw at the call site AND make thrownMessage fail-closed (recommended)** — Depth 4/4 · Cost 0/4. Two edits in src/lib/__tests__/remote.test.ts. (1) Insert `expect(() => remoteToGitUrl(input), input).toThrow('Unsupported remote');` between current line 92 and line 93, mirroring line 91 and using the same two-arg `expect(fn, input)` idiom the file already uses at lines 31-32 and 59-63. (2) Change line 7 from `return '';` to `throw new Error('thrownMessage: expected a throw, got a return');` so the helper can never hand a caller an empty string. Edit (1) restores the specific guarantee (remoteToGitUrl rejects each of the 7 credential-bearing non-remotes, with the Unsupported-remote error, not some other failure); edit (2) removes the trap for the existing call at line 90 and for any future use of the helper. Verified safe: normalizeRemote and remoteToGitUrl both throw for all 7 inputs today, and thrownMessage has exactly 2 call sites, both in this file. *Wins if:* Wins whenever you want the same class of vacuous assertion to be impossible in this file going forward — it costs one extra changed line over the call-site-only fix and removes the cause rather than one instance.
  - Option 2: Call-site assertion only (the reviewer's suggestion) — Depth 2/4 · Cost 0/4. Insert `expect(() => remoteToGitUrl(input), input).toThrow('Unsupported remote');` before the secrets loop at src/lib/__tests__/remote.test.ts:94 (or equivalently add `expect(viaGit, input).toContain('Unsupported remote');`). Leave thrownMessage as-is. *Wins if:* Wins if you want the absolute minimum diff on a test file that is already large in this change set, and are willing to leave the fail-open helper in place for whoever adds a third call site.
  - Option 3: Fail-closed helper only — Depth 3/4 · Cost 0/4. Change src/lib/__tests__/remote.test.ts:7 from `return '';` to a throw, and leave lines 93-94 otherwise untouched. *Wins if:* Wins only if you specifically do not want to assert WHICH error remoteToGitUrl raises — it guarantees the assertion is non-vacuous but, unlike line 91's treatment of normalizeRemote, leaves 'it threw a TypeError instead of Unsupported remote' passing.
- **medium — teamRepo.ts credential redaction in error messages is never exercised by a test** — `src/lib/teamRepo.ts:143`
  - Root cause: The collocated suite never reaches either redacted message with a credential-bearing remote, so neither new `stripRemoteCredentials` call is fenced. `assertOrigin`'s mismatch branch (teamRepo.ts:143) is exercised exactly once, at teamRepo.test.ts:97, and that case passes the credential-free `https://github.com/someone/else.git` against a clone whose origin is a local bare path — so both interpolations are credential-free inputs and the redaction is a no-op. `cloneTeam` (teamRepo.ts:246) is never invoked from any test at all: `grep -rn 'cloneTeam' src` finds only the definition and the single call site at src/commands/team.ts:198, and join.test.ts only asserts the `--` separator in the clone argv on the SUCCESS path, never a clone failure. Reverting both calls to bare `${actual}` / `${remote}` leaves `npm test` green. The production code itself is correct — I checked every other remote-bearing message (team.ts:59,60,80,83,87,201,203 and login.ts:25,27,34,39) and each one interpolates a value already passed through `stripRemoteCredentials` (team.ts:51, parseJoinTarget) or `normalizeRemote` (login.ts:20), so this is purely a missing regression fence, not a live leak. (src/lib/__tests__/teamRepo.test.ts:97 (the only mismatch case, credential-free) plus the absence of any `cloneTeam` case in that file; the unfenced production lines are src/lib/teamRepo.ts:143 and src/lib/teamRepo.ts:246)
  - Rated: moderate / low risk / isolated
  - Why one fix: Option 1 is strictly a subset of option 0 — same file, same style, less coverage — and option 3 rewrites working production code to solve a problem that is only a missing test (I checked every other place the product puts a remote in a message, and they all strip the credential before the message is built). So the plain answer is: write one test in the file that already owns these behaviours. No product or design judgement is needed; nothing user-visible changes either way.
  - **Option 1: One collocated test covering both messages (recommended)** — Depth 3/4 · Cost 1/4. Add one `it` to src/lib/__tests__/teamRepo.test.ts (after the existing wrong-remote case that ends at line 100), plus `cloneTeam` in the `../teamRepo.js` import and a small `rejectionMessage(promise)` helper next to `exists`/`personJson` (mirrors `thrownMessage` in remote.test.ts). Body: (a) `bareTeam()` + `cloneWithIdentity()`, then `await git(['remote','set-url','origin','https://me:ghp_leak@git.example/else.git'], clone)` and `rejectionMessage(openTeamRepo(clone, 'https://me:ghp_leak@github.com/someone/else.git').safeWrite(() => undefined, { action: 'join', handle: 'me' }))` — assert the message contains `points at https://git.example/else.git, not https://github.com/someone/else.git` and contains none of `ghp_leak`, `@git.example`, `@github.com`; this exercises BOTH interpolations on line 143 (`actual` from git config and `remote` from the caller) and is safe because assertOrigin throws before the lockfile is taken. (b) a stub `Runner` returning `{ code: 128, stdout: '', stderr: 'fatal: Authentication failed' }` that captures argv, then `rejectionMessage(cloneTeam('https://me:ghp_leak@git.example/team.git', join(fixture.root,'fresh'), failing))` — assert `Could not clone https://git.example/team.git: fatal: Authentication failed`, no `ghp_leak`, and argv `['clone','-q','--branch','main','--','https://git.example/team.git', destination]`, which also gives cloneTeam its own `--`-separator fence (today only asserted indirectly from join.test.ts:202). No network, no real clone; the redacted strings were confirmed against the built dist/lib/remote.js. *Wins if:* You want both new call sites fenced in one place, in the file that owns them, with no production code touched — the normal case.
  - Option 2: Minimal: credential-ize the existing wrong-remote assertion — Depth 2/4 · Cost 0/4. In src/lib/__tests__/teamRepo.test.ts:97, swap the remote for `https://me:ghp_leak@github.com/someone/else.git`, capture the rejection message instead of using `.rejects.toThrow('wrong repository')`, and add `expect(message).not.toContain('ghp_leak')`. Two lines changed, no new fixture, no stub runner. *Wins if:* You want the fence today at zero cost and accept that teamRepo.ts:246 (`Could not clone`) stays untested and that the `actual` half of line 143 — the origin URL read out of .git/config, the only spelling the product does not already strip upstream — is still never exercised with a credential.
  - Option 3: Make redaction structural instead of tested — Depth 4/4 · Cost 2/4. Stop passing raw remote strings into message-formatting positions: give teamRepo.ts (and team.ts/login.ts) a single `describeRemote(remote)` formatter — or change `cloneTeam`/`openTeamRepo` to accept the parsed `ParsedRemote` from remote.ts rather than a string — so an unredacted spelling cannot reach a message by construction, and back it with a lint rule banning bare `${remote}`/`${actual}` in template literals. Still needs the option-0 test to prove it. *Wins if:* M2/M3 are about to add many more verbs that put a remote in an error message and you would rather make the leak structurally impossible than fence two call sites — but note that today every other such message already redacts upstream, so this buys no coverage the test does not, at the price of touching shared production signatures.
- **medium — normalizeRemote's file branch skips cleanPath/assertHostAndPath, breaking the newly claimed idempotence for local remotes** — `src/lib/remote.ts:126`
  - Root cause: `stripGitSuffix` (src/lib/remote.ts:52) applies `.replace(/\/+$/, '')` BEFORE `.replace(/\.git$/i, '')`, so a path ending in `/.git` loses nothing at the end and then loses only `.git`, leaving the separator slash behind: `/srv/x/.git` -> `/srv/x/`. `normalizeRemote`'s file branch (remote.ts:126) returns that residue verbatim as `file:/srv/x/`, and re-normalizing it takes the other order (`FILE_CANONICAL` -> `stripGitSuffix('/srv/x/')` -> `/srv/x`), so the function is not idempotent — contradicting the docstring at remote.ts:121 and the test at remote.test.ts:36. The same ordering bug reaches every other form through `cleanPath` (remote.ts:56), which calls `stripGitSuffix` last: `https://github.com/Org/Repo/.git` -> `github.com/org/repo/` -> `github.com/org/repo`, and `git@host:org/repo/.git` -> `host:org/repo/` (an ssh path ending in `/.git` is a perfectly ordinary non-bare repo). Second, independent gap: the three file branches of `parseRemote` (remote.ts:72,74,75) return the raw path with no counterpart to `assertHostAndPath`'s empty-path check (remote.ts:62), so `/`, `//`, `/.git`, `file:///` are accepted and normalize to `file:` / `file:/` — outputs `normalizeRemote` itself then rejects. Verified failures beyond the reported one: (a) `remoteName('/srv/x/.git')` = `''` because `normalizeRemote` returned `file:/srv/x/` and the basename after the trailing `/` is empty, so `team join /srv/x/.git` with no `--as` fails at src/commands/team.ts:106 with the team-name schema error before cloning; (b) joining the same repo as `/srv/x` once and `/srv/x/.git` later makes `ensureClone` (src/commands/team.ts:203) compare `file:/srv/x` against `file:/srv/x/` and throw "is a clone of …, not …; pass --as <other-name>" for one repository — the §5.1 remote-matching violation. (/Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:52 (ordering inside `stripGitSuffix`); secondary: src/lib/remote.ts:72-75 (file branches of `parseRemote` skip the empty-path check that `assertHostAndPath` applies at :62))
  - Rated: moderate / low risk / pattern — siblings: All confirmed locations of the same `/.git` ordering mistake share one helper, so the sweep is one file, but each site needs checking after the change: (1) /Users/ryanliu/Documents/Terum/terum-codex/m1-plumbing/src/lib/remote.ts:52 — `stripGitSuffix`, the root; (2) src/lib/remote.ts:126 — `normalizeRemote` file branch, the reported site (`/srv/x/.git` -> `file:/srv/x/`); (3) src/lib/remote.ts:56 `cleanPath` -> src/lib/remote.ts:128 — every host form (verified: `https://github.com/Org/Repo/.git` -> `github.com/org/repo/`, `git@github.com:Org/Repo/.git` -> `github.com/org/repo/`, `myhost:Org/Repo/.git` -> `myhost:Org/Repo/`, `https://gitlab.com/Org/Repo/.git` -> `gitlab.com/Org/Repo/`), a location the finding did not name; (4) src/lib/remote.ts:113 — `toGitUrl` canonical case, which appends `.git` to `cleanPath(...)` and so emits `https://host/org/repo/.git`; (5) src/lib/remote.ts:168-171 — `remoteName` slices after the last `/`, so the trailing-slash residue yields `''` (breaks the default team name at src/commands/team.ts:106); (6) src/lib/remote.ts:72,74,75 — the file branches with no empty-path guard, the second half of the fix. Downstream consumers to re-verify after the change (no edit expected): src/lib/teamRepo.ts:142 `assertOrigin`, src/commands/team.ts:203 `ensureClone`, src/lib/auth.ts:184/194-196 `bindTeam`/`teamByRemote`. Checked and NOT affected: src/commands/team.ts:228 (`parseJoinTarget` strips `.git` from an `owner/repo` pair whose regex admits only one slash, so `owner/repo/.git` cannot reach it).
  - Why one fix: Option 1 is the same size of change as option 2 and fixes more: reordering the two replacements inside one shared four-line helper repairs the local-path case the reviewer found AND the identical break on ssh/https remotes whose path ends in `/.git` (a normal non-bare repo on a server), and it makes `remoteName` stop returning an empty team name. Option 2 patches one branch and leaves the sibling breakages plus the two entry points disagreeing about what they accept. There is no trade-off worth a human decision here; the only judgement call is that `/`, `//` and `/.git` become explicit errors rather than nonsense output, which is what every other form already does.
  - **Option 1: Fix the shared suffix stripper, and guard the empty file path in the one parser (recommended)** — Depth 4/4 · Cost 1/4. Two edits in src/lib/remote.ts plus tests. (1) remote.ts:51-53 — strip `.git` before trailing slashes so the separator cannot survive: `return path.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');`. This fixes the file branch (remote.ts:126) and, through `cleanPath` (remote.ts:56), every host form at once (`https://github.com/Org/Repo/.git`, `git@host:org/repo/.git`, `myhost:Org/Repo/.git`), and it also fixes `toGitUrl`'s canonical case (remote.ts:113) and `remoteName` (remote.ts:168-171), which today returns `''` for `/srv/x/.git`. (2) Give the file kind the empty-path check the other kinds get from `assertHostAndPath`: add a 3-line helper (e.g. `function fileRemote(path: string, input: string): ParsedRemote { if (!stripGitSuffix(path)) throw unsupported(input); return { kind: 'file', path }; }`) and use it at remote.ts:72, :74, :75, so `/`, `//`, `/.git`, `file:///` are refused identically by `normalizeRemote` and `remoteToGitUrl` (the invariant claimed at remote.ts:138) instead of normalizing to `file:` / `file:/`. Keep `parseRemote` storing the RAW path — `toGitUrl` must pass `/srv/x.git` through untouched (remote.test.ts:108). (3) Tests in src/lib/__tests__/remote.test.ts: add `'/tmp/x/team/.git'`, `'file:///tmp/x/team/.git'`, `'https://github.com/Org/Repo/.git'`, `'git@example.org:Org/Repo/.git'` to the idempotence list at :37; add `'/'`, `'//'`, `'/.git'`, `'file:///'` to the both-parsers-reject list at :50; assert `remoteName('/srv/x/.git') === 'x'` near :115. *Wins if:* Wins whenever `<path>/.git` or `<host>/<path>/.git` can be typed at all — it is the same single-file change as the narrow fix but also closes the ssh/https forms and repairs `remoteName`'s empty basename, and it keeps the two entry points refusing exactly the same inputs.
  - Option 2: Normalize only the file branch at the call site (reviewer's suggestion) — Depth 2/4 · Cost 0/4. Leave `stripGitSuffix` alone; at src/lib/remote.ts:126 run the local path through a file-specific clean (strip `.git` then any trailing slash) and throw `unsupported(input)` when the result is empty, so `/`, `//`, `/.git` are refused and `<path>/.git` collapses. Add `'/tmp/x/team/.git'` and `'/'`/`'/.git'` to the lists at remote.test.ts:37 and :50. *Wins if:* Wins only if you want the smallest possible diff on this branch and are willing to leave `https://host/org/repo/.git` and `git@host:org/repo/.git` non-idempotent; it also leaves `normalizeRemote` and `remoteToGitUrl` disagreeing about `/` (the docstring at remote.ts:138 says they refuse exactly the same things) and leaves `remoteName('/srv/x/.git')` returning `''` unless the same cleanup is duplicated there.

### Forks — no single fix clearly wins; run `/decision-walk <this report>` (0)

_none_

### Declined by triage — overrule if you disagree (the standalone test applies) (0)

_none_

### Untriaged — the triage agent returned nothing usable; investigate by hand or resume the run (0)

_none_
