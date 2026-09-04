# hybrid-review pass 1 proposed patches — NOT YET ADJUDICATED

## Proposed patches — 6 confirmed high findings, 23 edits across 9 files (6 source, 3 test)

Nothing applied. Three fixes were verified empirically in this environment (git 2.50.1, Node v25.8.2); those checks are noted inline.

---

### 1. `login` applies GitHub-only auth to any remote (`src/commands/login.ts:17`)

`hostOperationAllowed` (remote.ts:57) already exists for exactly this §6.0 host scoping and is covered by remote.test.ts:29-40 — `login` just never imports it. Gate before `authenticateCreator` prompts for a PAT.

```diff
-import { normalizeRemote } from '../lib/remote.js';
+import { hostOperationAllowed, normalizeRemote } from '../lib/remote.js';
@@
     const remote = normalizeRemote(args.remote);
+    // §6.0 host scoping: `login` collects a fine-grained GitHub PAT and verifies it against
+    // api.github.com, so it is GitHub-only in phase 1. Teams on any other host use ambient git
+    // credentials and must never have a GitHub token stored against them.
+    const allowed = hostOperationAllowed(remote);
+    if (!allowed.ok) {
+      throw new Error(`${allowed.error} \`login\` authenticates against GitHub only; for ${remote} use your ambient git credentials (\`team create <name> --remote <url>\` or \`team join <url>\`).`);
+    }
     const store = args.config ?? createConfigStore();
```

Plus a regression case in `login.test.ts` (no current test drives a non-GitHub remote): `login --team gl --remote https://gitlab.com/acme/skills.git` must fail and write no `teams.gl` entry. Patch 6 is the defense-in-depth half — even a legacy token in config is no longer offered off GitHub.

---

### 2. `team create` rebinds an existing config entry and inherits its PAT (`src/commands/team.ts:77`)

`create` guards the clone directory only; `join` (team.ts:98-100) and `login` (login.ts:20) both guard the config entry, and an entry can exist with no clone because `login` never clones.

```diff
     const clone = store.teamClone(name);
     if (await exists(clone)) throw new Error(`A clone already exists at ${clone}; ...`);
+    // A config entry can exist with no clone on disk (`login` never clones). `join` and `login`
+    // both refuse to rebind a team name to a different remote; `create` must too — overwriting the
+    // entry repoints the name and inherits the previous team's PAT (line 77).
+    const configBefore = await store.read();
+    const configured = configBefore.teams[name];
+    if (configured) throw new Error(`Team ${name} is already configured for ${configured.remote}; pick another name, or remove that team from ${pathJoin(store.root, 'config.json')}.`);
@@
-      identity = await collectIdentity(io, await store.read(), runner, { gh: await ghState(runner) });
+      identity = await collectIdentity(io, configBefore, runner, { gh: await ghState(runner) });
@@
-      config.teams[name] = { remote: normalizeRemote(remote), token: token ?? config.teams[name]?.token ?? null, handle: identity.handle };
+      config.teams[name] = { remote: normalizeRemote(remote), token, handle: identity.handle, handle_bound: true };
```

The token-inheritance clause becomes dead once the guard is in place, so it is removed rather than left as a residual cross-host leak. (`handle_bound: true` comes from patch 5.)

---

### 3. `assertSafePath` misses `.Git`, and `applyTree` writes before `guard()` (`src/lib/teamRepo.ts:92`, `:147`)

Two independent halves; both are needed.

**Ordering** — the write currently precedes authorization, so a refused path still lands on disk and the `finally` cleanup can then delete it:

```diff
+      // Authorize BEFORE writing anything: applyTree touches the working tree and the `finally`
+      // cleanup removes what it created, so a refused path must never reach the filesystem.
+      guard(tree, options);
       for (const path of changed) if (!tracked.has(path) && tree.after(path) !== undefined) created.add(path);
       await applyTree(root, tree, changed);
       await requireGit(['add', '-A', '--', ...changed]);
       const staged = ...
       if (JSON.stringify(staged) !== JSON.stringify([...changed].sort())) { throw new GuardError(...); }
-      guard(tree, options);
```

**Predicate** — first-segment, case-sensitive `.git` becomes an every-segment, filesystem-shaped test:

```diff
+const DOT_GIT = /^\.git([.\s:]|$)/i;
+const SHORT_GIT = /^git~1$/i;
 export function assertSafePath(path: string): void {
   const segments = path.split('/');
-  const bad = path === '' || path.startsWith('/') || path.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..') || segments[0] === '.git' || posix.normalize(path) !== path;
+  const bad =
+    path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path) ||
+    segments.some((s) => s === '' || s === '.' || s === '..' || DOT_GIT.test(s) || SHORT_GIT.test(s)) ||
+    posix.normalize(path) !== path;
   if (bad) throw new GuardError(`Refusing to write unsafe path ${JSON.stringify(path)}`);
 }
```

Verified with node: rejects `.Git/config`, `.GIT/config`, `skills/x/.git/config`, `.git./config`, `.git /config`, `.git::$DATA/config`, `git~1/config`, `C:/x`, `a\0b`; still accepts `people/me.json`, `.github/workflows/terum-skills.yml`, `skills/a/.gitignore`, `skills/a/.gitkeep`. teamRepo.test.ts:79's list is extended with those cases plus a must-pass list — the current list mirrors the implementation one-for-one and passes either way.

---

### 4. `terminalPrompter` hangs then exits 0 at EOF (`src/lib/prompt.ts:49`)

`readline/promises` drops the pending question callback on 'close', so race it explicitly and delete the blanket `catch` (which also mislabels stream/abort errors).

```diff
     const rl = hidden ? createInterface({ input: stdin, terminal }) : createInterface({ input: stdin, output: stdout, terminal });
+    // readline/promises never settles question() when input ends — it emits 'close' and drops the
+    // pending callback — so EOF is raced explicitly. Every other error propagates unchanged.
+    const closed = new Promise<never>((_, reject) => { rl.once('close', () => reject(new PromptClosedError(question.trim()))); });
     try {
       if (hidden) stdout.write(question);
-      const answer = await rl.question(hidden ? '' : question);
+      const answer = await Promise.race([rl.question(hidden ? '' : question), closed]);
       if (hidden) stdout.write('\n');
       return answer;
-    } catch {
-      throw new PromptClosedError(question.trim());
     } finally {
       rl.close();
     }
```

Verified on Node v25.8.2: with `< /dev/null` this shape rejects with `PromptClosedError` and the process exits 1 (via each verb's `failure()` path → index.ts:35); with piped input it returns the answer and produces no unhandled rejection, because `Promise.race` has already attached a handler to `closed` before the `finally` closes the interface. No `Prompter` interface change, so `ScriptedPrompter` is untouched.

---

### 5. `login` binds an unverified per-team handle (`src/commands/login.ts:24`)

`join` treats `teams.<team>.handle` as proof the people file is the actor's (team.ts:102 → team.ts:153). Make the config record *how* the handle got there.

```diff
-const teamConfigSchema = z.object({ remote: z.string().min(1), token: z.string().nullable(), handle: handleSchema }).passthrough();
+// §5.4: `handle_bound` is true only when this machine wrote people/<handle>.json for the team
+// (`team create` / `team join`). `login` never touches the repo, so the handle it records is a
+// local default and must not be trusted as the binding at join time.
+const teamConfigSchema = z.object({ remote: z.string().min(1), token: z.string().nullable(), handle: handleSchema, handle_bound: z.boolean().optional() }).passthrough();
```

```diff
-    const boundHandle = existing?.[1].handle;
+    const boundHandle = existing?.[1].handle_bound ? existing[1].handle : undefined;         // team.ts:102
-      config.teams[team] = { remote: normalized, token: ..., handle: identity.handle };
+      config.teams[team] = { remote: normalized, token: ..., handle: identity.handle, handle_bound: true };   // team.ts:128 (join wrote the people file)
-      config.teams[team] = { remote, handle: existing?.handle ?? auth.identity.handle, token: ... };
+      config.teams[team] = { remote, handle: existing?.handle ?? auth.identity.handle, token: ..., handle_bound: existing?.handle_bound };   // login.ts:24
```

Optional is deliberate: `undefined` is never serialized, so a login-created entry is byte-identical to today's and login.test.ts's `toEqual` assertions still pass. Bob's scenario now re-enters `identityForJoiner` with no fixed handle, hits `HandleCollisionError` on `people/ajay.json`, and re-prompts. Test fallout: `create.test.ts:37`, `create.test.ts:68`, `join.test.ts:31` need `handle_bound: true` in their exact-equality assertions; a new join case seeding a login-style unbound entry pins the fix.

*Smaller alternative, if you would rather not touch the schema:* have `login` refuse a team it does not already know (`if (!existing) throw …`), making `create`/`join` the only verbs that create entries. Two lines, no schema change, but it removes the pre-authenticate flow that login.test.ts:22 asserts.

---

### 6. `gitAuthEnv` installs an unscoped credential helper (`src/lib/auth.ts:91`)

```diff
-export function gitAuthEnv(token: string | null | undefined): NodeJS.ProcessEnv {
-  if (!token) return {};
+export function gitAuthEnv(token: string | null | undefined, remote?: string): NodeJS.ProcessEnv {
+  if (!token || !githubTarget(remote)) return {};
   return {
     GH_TOKEN: token,
     GIT_CONFIG_COUNT: '2',
-    GIT_CONFIG_KEY_0: 'credential.helper',      GIT_CONFIG_VALUE_0: '',
-    GIT_CONFIG_KEY_1: 'credential.helper',      GIT_CONFIG_VALUE_1: HELPER,
+    GIT_CONFIG_KEY_0: 'credential.https://github.com.helper', GIT_CONFIG_VALUE_0: '',
+    GIT_CONFIG_KEY_1: 'credential.https://github.com.helper', GIT_CONFIG_VALUE_1: CREDENTIAL_HELPER,
   };
 }
```

with `githubTarget(remote)` returning `true` for `undefined` (gh's own API calls, which only reach api.github.com) and `isGitHubRemote(remote)` otherwise, catching the parse error as `false`. Call sites gain the remote they already hold: `teamRepo.ts:58` (`gitAuthEnv(options.token, remote)`), `teamRepo.ts:194` (`cloneTeam`), `team.ts:239` (`bootstrap`). `team.ts:60` keeps the no-remote form — those are `gh repo create` / `gh repo view`.

Verified with git 2.50.1: under the new env, `git config --get-urlmatch credential https://github.com/acme/team.git` returns only our helper (the ambient `osxkeychain` helper is reset, preserving today's GitHub behavior), while the same env for `https://gitlab.com/acme/team.git` returns the ambient helper and never ours. Returning `{}` off GitHub also keeps `GH_TOKEN` out of the environment of git children whose ambient helper might forward it. Test fallout: `auth.test.ts:96-101` pins the scoped keys plus three `toEqual({})` cases for non-GitHub hosts; `create.test.ts:86` becomes `credential.https://github.com.helper`.

---

### Interactions between patches

- 1 + 6 are complementary layers: 1 stops a GitHub PAT ever being bound to a non-GitHub team; 6 stops any token already in config from being offered off GitHub.
- 2 + 5 both rewrite `team.ts:77`; the combined final line is `config.teams[name] = { remote: normalizeRemote(remote), token, handle: identity.handle, handle_bound: true };`.
- 3's two halves are independent: `guard()` already refuses `.Git/config` by path allowlist, so the reorder alone closes the disclosed failure; the predicate fix is the defense-in-depth layer for future guard rows.
- Suggested apply order: 4 (unblocks any manual CLI exercise), then 3, then 1/6, then 2/5.