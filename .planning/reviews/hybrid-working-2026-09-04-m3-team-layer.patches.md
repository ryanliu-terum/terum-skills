## Proposed patches (not applied)

All four findings land in `src/commands/team.ts`; two need small companions in `src/lib/schema.ts` and `src/lib/auth.ts`.

---

### 1. (critical) `team remove` acts on the target's own unvalidated `github` field

Root cause: `people/<handle>.json` is writable by its owner (guard row b, `src/lib/guard.ts:38`), `personSchema.github` is a bare `z.string()` (`src/lib/schema.ts:46`), and `collectIdentity` takes the login as free text (`src/lib/auth.ts:62`). The value is then spliced raw into an admin-authenticated `DELETE` path (`team.ts:71`).

Three layers, because no single one closes both failure modes:

**a. `src/lib/schema.ts`** — new schema after `handleSchema` (line 10):

```ts
/** GitHub's own login syntax: 1-39 chars, ASCII alphanumerics and single internal hyphens. Case is
 *  preserved (GitHub compares case-insensitively); this is what a value must satisfy BEFORE it may
 *  become part of an API path. */
export const GITHUB_LOGIN_RULE = 'a GitHub login is 1-39 characters: letters, digits, and single internal hyphens';
export const githubLoginSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(39).regex(/^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/, GITHUB_LOGIN_RULE));
```

Deliberately **not** tightening `personSchema.github` itself: that schema is parsed by `readRoster`, README generation and `isMember`, so an empty or legacy `github` would make a member's file unparseable and silently drop them from the roster. Validate at the boundaries instead.

**b. `src/lib/auth.ts:62`** — stop accepting arbitrary text at the source:

```diff
-  github = (await io.text('GitHub login', github)).trim();
+  // Free text becomes part of GitHub API paths in `team remove`; reject anything that is not a login.
+  // Blank stays legal: generic (non-GitHub) remotes have no login to give.
+  github = await askUntilValid(io, 'GitHub login', github, (value) => {
+    const trimmed = value.trim();
+    if (!trimmed) return { ok: true, value: '' };
+    const parsed = githubLoginSchema.safeParse(trimmed);
+    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, rule: GITHUB_LOGIN_RULE };
+  });
```

(import on line 5 gains `GITHUB_LOGIN_RULE, githubLoginSchema`). Existing `auth.test.ts` cases all pass valid logins or rely on the default, so they stay green.

**c. `src/commands/team.ts`** — validate at use, and refuse a login another *active* member claims. Syntax validation kills the path-injection and the `github: ""` unremovable-member case; the exclusivity check kills the "point the revoke at an admin" case, which validation alone cannot. New helper between `remove()` and `archiveMutation`:

```ts
/**
 * A member owns their own people file (guard row b), so `github` is self-asserted. Refuse to act on a
 * login that ANOTHER active member also claims: otherwise `team remove mallory` can be pointed at an
 * admin's account, revoking the admin while mallory keeps push access and is merely archived.
 */
async function assertLoginUnclaimed(runner: Runner, clone: string, targetHandle: string, login: string): Promise<void> {
  const listed = await runner.run('git', ['ls-tree', '-r', '--name-only', 'origin/main', '--', 'people/'], { cwd: clone });
  if (listed.code !== 0) throw new Error(`Could not read the roster from origin/main: ${(listed.stderr || listed.stdout).trim()}`);
  const teamJson = await runner.run('git', ['show', 'origin/main:team.json'], { cwd: clone });
  if (teamJson.code !== 0) throw new Error(`Could not read team.json from origin/main: ${(teamJson.stderr || teamJson.stdout).trim()}`);
  const archived = parseJson(teamSchema, teamJson.stdout, 'team.json').archived;
  const wanted = login.toLowerCase();
  for (const path of listed.stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('people/') && line.endsWith('.json'))) {
    const handle = path.slice('people/'.length, -'.json'.length);
    if (handle === targetHandle || archived.includes(handle)) continue;
    const other = await runner.run('git', ['show', `origin/main:${path}`], { cwd: clone });
    if (other.code !== 0) continue;
    let claimed: string;
    try { claimed = personSchema.parse(JSON.parse(other.stdout)).github; } catch { continue; }
    if (claimed.trim().toLowerCase() === wanted) {
      throw new Error(`Refusing to remove ${targetHandle}: people/${targetHandle}.json claims @${login}, which ${handle} also claims. Resolve the duplicate GitHub login (or use --archive-only) before removing anyone.`);
    }
  }
}
```

---

### 2. (high) `--archive-only` performs no admin check + 3. (high) invitations are not paginated

Both live in the same block, so here is the single consolidated replacement for `src/commands/team.ts:63-81`:

```diff
-    if (!args.archiveOnly) {
-      const ownerRepo = githubRepository(binding.remote);
-      const admin = await runner.run('gh', ['api', `repos/${ownerRepo}`, '-q', '.permissions.admin'], { env });
-      if (admin.code !== 0 || admin.stdout.trim() !== 'true') throw new Error('Team removal requires GitHub repository admin permission.');
+    // Archiving is a roster mutation, not a host operation — but it still deactivates someone else,
+    // so it needs the same authority. On GitHub the repository is the only authority we have, so ask
+    // it on BOTH paths; a generic remote has no host to ask (§6.0).
+    const ownerRepo = isGitHubRemote(binding.remote) ? githubRepository(binding.remote) : null;
+    if (ownerRepo) {
+      const admin = await runner.run('gh', ['api', `repos/${ownerRepo}`, '-q', '.permissions.admin'], { env });
+      if (admin.code !== 0 || admin.stdout.trim() !== 'true') throw new Error('Team removal requires GitHub repository admin permission.');
+    }
+    // `hostOperationAllowed` above already refused a non-GitHub remote on this path; the null test
+    // only narrows the type.
+    if (!args.archiveOnly && ownerRepo) {
+      // people/<handle>.json is written by its own owner (guard row b), so `github` is a CLAIM, not a
+      // fact. Validate its syntax before it can become part of an API path, and refuse a login that
+      // another ACTIVE member also claims.
+      const parsedLogin = githubLoginSchema.safeParse(target.github);
+      if (!parsedLogin.success) throw new Error(`people/${targetHandle}.json does not carry a usable GitHub login (${GITHUB_LOGIN_RULE}); rerun with --archive-only and revoke access on GitHub by hand.`);
+      const targetLogin = parsedLogin.data;
+      await assertLoginUnclaimed(runner, clone, targetHandle, targetLogin);
       const admins = await runner.run('gh', ['api', `repos/${ownerRepo}/collaborators?permission=admin`], { env });
       if (admins.code !== 0) throw new Error(`Could not list repository admins: ${(admins.stderr || admins.stdout).trim()}`);
       const adminLogins = (JSON.parse(admins.stdout || '[]') as Array<{ login?: string }>).map((member) => member.login?.toLowerCase()).filter((login): login is string => Boolean(login));
-      if (adminLogins.length <= 1 && adminLogins.includes(target.github.toLowerCase())) throw new Error(`Refusing to remove ${targetHandle}: they are the last remaining admin.`);
-      const revoked = await runner.run('gh', ['api', '-X', 'DELETE', `repos/${ownerRepo}/collaborators/${target.github}`], { env });
-      if (revoked.code !== 0 && revoked.code !== 204) throw new Error(`Could not revoke @${target.github}: ${(revoked.stderr || revoked.stdout).trim()}`);
-      const invitations = await runner.run('gh', ['api', `repos/${ownerRepo}/invitations`], { env });
+      if (adminLogins.length <= 1 && adminLogins.includes(targetLogin.toLowerCase())) throw new Error(`Refusing to remove ${targetHandle}: they are the last remaining admin.`);
+      const revoked = await runner.run('gh', ['api', '-X', 'DELETE', `repos/${ownerRepo}/collaborators/${encodeURIComponent(targetLogin)}`], { env });
+      if (revoked.code !== 0 && revoked.code !== 204) throw new Error(`Could not revoke @${targetLogin}: ${(revoked.stderr || revoked.stdout).trim()}`);
+      // One `gh api` call returns ONE page (per_page=30) and each page is a separate JSON array
+      // unless --slurp wraps them: without both flags a target whose invitation sits past page 1
+      // keeps a live invitation that this command reports as revoked.
+      const invitations = await runner.run('gh', ['api', '--paginate', '--slurp', `repos/${ownerRepo}/invitations?per_page=100`], { env });
       if (invitations.code !== 0) throw new Error(`Could not list pending invitations: ${(invitations.stderr || invitations.stdout).trim()}`);
-      const pending = (JSON.parse(invitations.stdout || '[]') as Array<{ id?: number; invitee?: { login?: string } }>).filter((invite) => invite.invitee?.login?.toLowerCase() === target.github.toLowerCase());
+      const pages = JSON.parse(invitations.stdout || '[]') as unknown;
+      const pending = (Array.isArray(pages) ? (pages.flat() as Array<{ id?: number; invitee?: { login?: string } }>) : []).filter((invite) => invite.invitee?.login?.toLowerCase() === targetLogin.toLowerCase());
       for (const invitation of pending) {
         if (invitation.id === undefined) continue;
         const cancelled = await runner.run('gh', ['api', '-X', 'DELETE', `repos/${ownerRepo}/invitations/${invitation.id}`], { env });
-        if (cancelled.code !== 0 && cancelled.code !== 204) throw new Error(`Could not cancel @${target.github}'s pending invitation: ${(cancelled.stderr || cancelled.stdout).trim()}`);
+        if (cancelled.code !== 0 && cancelled.code !== 204) throw new Error(`Could not cancel @${targetLogin}'s pending invitation: ${(cancelled.stderr || cancelled.stdout).trim()}`);
       }
     }
```

Imports gain `isGitHubRemote` (line 8) and `GITHUB_LOGIN_RULE, githubLoginSchema` (line 11).

Notes on the pagination fix, verified against the installed `gh` (2.97.0): `gh api --paginate` alone would have made things *worse* — `gh api --help` states "Each page is a separate JSON array or object. Pass `--slurp` to wrap all pages of JSON arrays or objects into an outer JSON array", so `--paginate` without `--slurp` emits concatenated arrays that `JSON.parse` rejects. Hence `--paginate --slurp` plus `.flat()`; `.flat()` also tolerates the un-slurped single-page shape, so the code degrades gracefully. `--slurp` requires gh ≥ 2.44 — if the project must support older gh, substitute a manual `?per_page=100&page=N` loop that stops on a short page.

`hostOperationAllowed(remote, archiveOnly)` in `src/lib/remote.ts:95` is left as-is on purpose: its short-circuit is about *host reachability*, not authority, and the authority gap is properly fixed in the caller. The residual gap it leaves — on a **generic** (non-GitHub) remote any pusher can still `--archive-only` anyone — is inherent to a model with no roster-level admin concept, and matches the command's own printed disclaimer ("Access remains managed on the host"). Worth a follow-up ticket rather than a fix here.

---

### 4. (high) The scaffolded Action's publish-comment step is broken

`src/commands/team.ts:391` — one escaping change:

```diff
-          existing=$(gh api "repos/\${{ github.repository }}/issues/$PR/comments" --paginate --jq ".[] | select(.body | contains(\"$marker\")) | .id" | head -n 1)
+          existing=$(gh api "repos/\${{ github.repository }}/issues/$PR/comments" --paginate --jq ".[] | select(.body | contains(\\"$marker\\")) | .id" | head -n 1)
```

Verified end to end: the new literal emits `--jq ".[] | select(.body | contains(\"$marker\")) | .id"` into the YAML, and an argv-printing bash run confirms gh now receives one positional plus a single `--jq` argument (`.[] | select(.body | contains("<!-- terum-skills:pr-comment -->")) | .id`) instead of the current three word-split fragments. The existing test only greps the constant, so tighten it in `src/lib/__tests__/teamRepo.test.ts:34`:

```diff
-    expect(WORKFLOW).toContain('terum-skills:pr-comment');
+    expect(WORKFLOW).toContain("marker='<!-- terum-skills:pr-comment -->'");
+    // The jq program must survive the emitted YAML with its quotes escaped for the shell, or
+    // $marker is word-split and `gh api` fails with "accepts 1 arg(s), received 3".
+    expect(WORKFLOW).toContain('--jq ".[] | select(.body | contains(\\"$marker\\")) | .id"');
```

---

### Test fallout to apply with the above

`src/commands/__tests__/remove.test.ts` mocks the old invitation call and must be updated (lines 28 and 75) to `api --paginate --slurp repos/acme/team/invitations?per_page=100`, with line 28 returning a two-page shape `[[{id:1,invitee:{login:'someone-else'}}],[{id:9,invitee:{login:'member-gh'}}]]` so the page-2 case is actually exercised, and line 75 returning `'[[]]'`. The generic-remote archive-only test at line 51 is unaffected (its remote is `file:`, so the new admin gate does not fire). Add: an archive-only-on-GitHub-requires-admin test, a `github: 'admin'` impersonation test expecting "also claims", and a `github: 'x/../../../repos/acme/other'` test asserting no `DELETE` is ever issued.