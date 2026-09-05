import { describe, expect, it } from 'vitest';
import { githubOwnerRepo, hasEmbeddedCredentials, hostOperationAllowed, isGitHubRemote, normalizeRemote, remoteName, remoteToGitUrl, sameRemote, stripRemoteCredentials } from '../remote.js';

// `aWxs/K3Q` carries a `/`, which the structured parse cannot cross (an unencoded `/` ends the
// authority for git and curl too), so it can only be kept out of a message by the lossy fallback.
const SECRETS = ['tok', 'leak', 'p@ss', 't@k', 'aWxs/K3Q', 'a/b:c@d'];
function thrownMessage(fn: () => unknown): string {
  try { fn(); } catch (error) { return (error as Error).message; }
  return '';
}

describe('normalizeRemote (§5.1)', () => {
  it('strips protocol, credentials, port, .git, and trailing slash; lowercases the host, and the path on GitHub', () => {
    expect(normalizeRemote('https://github.com/Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemote('https://user:tok@GitHub.com/Org/Repo/')).toBe('github.com/org/repo');
    expect(normalizeRemote('https://me:gh@p_leak@GitHub.com/Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemote('ssh://git@github.com:22/Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemote('git@github.com:Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemote('github.com/Org/Repo')).toBe('github.com/org/repo');
    expect(normalizeRemote('https://gitlab.com/Org/Repo.git')).toBe('gitlab.com/Org/Repo');
  });

  it('keeps a local path as the identity: only trailing slashes go, `.git` stays, and the result is still fetchable', () => {
    expect(normalizeRemote('/tmp/teams/team.git')).toBe('file:/tmp/teams/team.git');
    expect(normalizeRemote('/tmp/teams/team.git/')).toBe('file:/tmp/teams/team.git');
    expect(normalizeRemote('file:///tmp/teams/team.git')).toBe('file:/tmp/teams/team.git');
    expect(normalizeRemote('/tmp/x/team/.git')).toBe('file:/tmp/x/team/.git');
    expect(normalizeRemote('/tmp/x/team')).toBe('file:/tmp/x/team');
    expect(sameRemote('/srv/x/team.git/', '/srv/x/team.git')).toBe(true);
    expect(sameRemote('/srv/x/team.git', '/srv/x/team')).toBe(false);
    for (const input of ['/tmp/x/team.git', '/tmp/x/team/.git', '/tmp/x/team']) expect(remoteToGitUrl(normalizeRemote(input)), input).toBe(input);
    for (const bad of ['/', '//', 'file:///', 'file:/', 'file://']) {
      expect(() => normalizeRemote(bad), bad).toThrow('Unsupported remote');
      expect(() => remoteToGitUrl(bad), bad).toThrow('Unsupported remote');
    }
  });

  it('keeps the scp spelling for a single-label host, so an ssh alias round-trips and `org/repo` is never mistaken for one', () => {
    expect(normalizeRemote('myhost:Org/Repo.git')).toBe('myhost:Org/Repo');
    expect(normalizeRemote('git@localhost:org/repo.git')).toBe('localhost:org/repo');
    expect(normalizeRemote('ssh://git@myhost/org/repo.git')).toBe('myhost:org/repo');
    expect(remoteToGitUrl('myhost:Org/Repo')).toBe('myhost:Org/Repo');
    expect(remoteName('myhost:team.git')).toBe('team');
    expect(hostOperationAllowed('myhost:Org/Repo')).toMatchObject({ ok: false, error: expect.stringContaining('managed on the host') });
    for (const bad of ['org/repo', 'myhost/Org/Repo', 'acme/team-skills']) {
      expect(() => normalizeRemote(bad), bad).toThrow('Unsupported remote');
      expect(() => remoteToGitUrl(bad), bad).toThrow('Unsupported remote');
    }
  });

  it('is idempotent on its own output, in every form, and the output is usable everywhere', () => {
    for (const input of ['https://github.com/Org/Repo.git', 'https://gitlab.com/Org/Repo.git', 'git@example.org:Org/Repo.git', 'myhost:Org/Repo.git', 'ssh://git@myhost/org/repo.git', 'git@localhost:org/repo.git', '/tmp/x/team.git', 'file:///tmp/x/team.git', '/tmp/x/team/.git', '/tmp/x/team.git/', '/tmp/x/team']) {
      const once = normalizeRemote(input);
      expect(normalizeRemote(once), input).toBe(once);
      expect(() => remoteToGitUrl(once), input).not.toThrow();
      expect(() => hostOperationAllowed(once), input).not.toThrow();
      expect(remoteName(once), input).not.toBe('');
    }
  });

  it('never matches a near-miss, and both parsers reject the same non-remotes', () => {
    expect(sameRemote('https://github.com/Org/Repo.git', 'https://github.com/Org/Repo-extra.git')).toBe(false);
    expect(sameRemote('https://github.com/Org/Repo', 'https://github.com/org/repo')).toBe(true);
    expect(sameRemote('https://gitlab.com/Org/Repo', 'https://gitlab.com/org/repo')).toBe(false);
    for (const bad of ['', '   ', 'not a remote', 'repo', 'C:\\repos\\team', 'C:/repos/team', 'github.com/', './team.git', 'https://github.com', 'https://github.com/', 'https://github.com/.git', 'github.com/.git']) {
      expect(() => normalizeRemote(bad), bad).toThrow('Unsupported remote');
      expect(() => remoteToGitUrl(bad), bad).toThrow('Unsupported remote');
    }
  });

  it('refuses option-shaped and transport-helper remotes before any pattern runs, at every entry point', () => {
    const hostile = [
      '--upload-pack=touch:pwned', '-oProxyCommand=x:y', ' --upload-pack=x:y', '-', 'ext::sh -c id', 'fd::17',
      'https://-evil.example/acme/team.git', 'https://a@b@-evil.example/acme/team.git', 'git@-evil:acme/team.git', 'ssh://git@-evil/acme/team.git',
      // an option-shaped ssh login or scp path is refused too, not re-emitted into git argv
      'ssh://-oProxyCommand=x@host.example/o/r', 'git@host.example:-oProxyCommand=x', '-u@host.example:o/r',
    ];
    for (const input of hostile) {
      expect(() => normalizeRemote(input), input).toThrow('Unsupported remote');
      expect(() => remoteToGitUrl(input), input).toThrow('Unsupported remote');
      expect(() => remoteName(input), input).toThrow('Unsupported remote');
      expect(() => isGitHubRemote(input), input).toThrow('Unsupported remote');
      expect(hostOperationAllowed(input), input).toMatchObject({ ok: false, error: expect.stringContaining('Unsupported remote') });
    }
    expect(() => normalizeRemote('--upload-pack=x:y')).toThrow('looks like an option');
    expect(() => normalizeRemote('ssh://-oProxyCommand=x@host.example/o/r')).toThrow('looks like an option');
    expect(() => normalizeRemote('git@host.example:-oProxyCommand=x')).toThrow('looks like an option');
    expect(() => remoteToGitUrl('ext::sh -c id')).toThrow('transport helpers are not allowed');
    // A `-` inside a URL path is data, not an option to anything.
    expect(remoteToGitUrl('https://host.example/-org/-repo.git')).toBe('https://host.example/-org/-repo.git');
  });

  it('drops an embedded credential — to the LAST `@`, as git reads it — before a remote reaches git, keeps the ssh login, and never echoes one', () => {
    expect(remoteToGitUrl('https://user:tok@github.com/Org/Repo.git')).toBe('https://github.com/Org/Repo.git');
    expect(remoteToGitUrl('https://ghp_tok@github.com/Org/Repo.git')).toBe('https://github.com/Org/Repo.git');
    expect(remoteToGitUrl('https://me:gh@p_leak@git.example/team.git')).toBe('https://git.example/team.git');
    expect(remoteToGitUrl('https://ryan@corp.com:ghp_tok@gitlab.example.com/acme/team.git')).toBe('https://gitlab.example.com/acme/team.git');
    expect(remoteToGitUrl('https://user:tok@gitlab.example:8443/Org/Repo.git')).toBe('https://gitlab.example:8443/Org/Repo.git');
    expect(remoteToGitUrl('ssh://git:tok@github.com/Org/Repo.git')).toBe('ssh://git@github.com/Org/Repo.git');
    expect(remoteToGitUrl('ssh://git:p@ss@host.example/o/r.git')).toBe('ssh://git@host.example/o/r.git');
    expect(remoteToGitUrl('ssh://git@github.com:22/Org/Repo.git')).toBe('ssh://git@github.com:22/Org/Repo.git');
    expect(remoteToGitUrl('git@github.com:Org/Repo.git')).toBe('git@github.com:Org/Repo.git');
    expect(isGitHubRemote('https://me:gh@p_leak@github.com/o/r.git')).toBe(true);
    expect(stripRemoteCredentials(' https://me:gh@p_leak@git.example/x.git ')).toBe('https://git.example/x.git');
    expect(stripRemoteCredentials('https://user:tok@github.com/Org/Repo.git')).toBe('https://github.com/Org/Repo.git');
    expect(stripRemoteCredentials('ssh://:tok@github.com/Org/Repo.git')).toBe('ssh://github.com/Org/Repo.git');
    expect(stripRemoteCredentials('https://github.com/org/repo@v1.git')).toBe('https://github.com/org/repo@v1.git');
    expect(stripRemoteCredentials('git@github.com:Org/Repo.git')).toBe('git@github.com:Org/Repo.git');
    expect(stripRemoteCredentials('not a remote')).toBe('not a remote');
    expect(hasEmbeddedCredentials('https://u:tok@github.com/o/r.git')).toBe(true);
    expect(hasEmbeddedCredentials(' https://tok@github.com/o/r.git')).toBe(true);
    for (const clean of ['git@github.com:o/r.git', 'ssh://git@github.com/o/r.git', 'github.com/o/r', '/tmp/x/team.git']) expect(hasEmbeddedCredentials(clean), clean).toBe(false);
    const rejected = [
      'https://user:tok@github.com', 'https://user:tok@github.com/', '-https://user:tok@github.com/x', 'user:tok@host:path/', 'user:t@k@host:path/',
      'https://me:gh@p_leak@git.example/.git', ' https://me:p@ss@-evil.example/x',
      // a password with `/` (or `/` and `:` and `@`) fails the structured parse; the message fallback must still not echo it
      'https://me:aWxs/K3Q@git.example/team.git', 'https://me:a/b:c@d@git.example/team.git', 'me:aWxs/K3Q@git.example:team.git',
      'me:aWxs/K3Q@git.example/team.git', 'user:AbC/dEf@github.com/org/repo.git',
    ];
    for (const input of rejected) {
      const message = thrownMessage(() => normalizeRemote(input));
      expect(message, input).toContain('Unsupported remote');
      for (const secret of SECRETS) expect(message, input).not.toContain(secret);
      const viaGit = thrownMessage(() => remoteToGitUrl(input));
      expect(viaGit, input).toContain('Unsupported remote');
      for (const secret of SECRETS) expect(viaGit, input).not.toContain(secret);
      for (const secret of SECRETS) expect(stripRemoteCredentials(input), input).not.toContain(secret);
    }
    expect(stripRemoteCredentials('https://me:aWxs/K3Q@git.example/team.git')).toBe('https://<redacted>@git.example/team.git');
    expect(hostOperationAllowed('https://user:tok@gitlab.com/acme/team.git')).toMatchObject({ ok: false, error: expect.not.stringContaining('tok') });
    expect(hostOperationAllowed('https://me:aWxs/K3Q@git.example/team.git')).toMatchObject({ ok: false, error: expect.not.stringContaining('K3Q') });
  });

  it('turns every accepted form into something git can fetch, byte-identical when there was nothing to strip', () => {
    expect(remoteToGitUrl('github.com/Org/Repo')).toBe('https://github.com/Org/Repo.git');
    expect(remoteToGitUrl('git.example/team/skills.git')).toBe('https://git.example/team/skills.git');
    expect(remoteToGitUrl('https://github.com/Org/Repo.git')).toBe('https://github.com/Org/Repo.git');
    expect(remoteToGitUrl('HTTPS://GitHub.com/Org/Repo/')).toBe('HTTPS://GitHub.com/Org/Repo/');
    expect(remoteToGitUrl('git@github.com:Org/Repo.git')).toBe('git@github.com:Org/Repo.git');
    expect(remoteToGitUrl('file:/tmp/x/team')).toBe('/tmp/x/team');
    expect(remoteToGitUrl('file:/tmp/x/team.git')).toBe('/tmp/x/team.git');
    expect(remoteToGitUrl('file:///tmp/x/team')).toBe('/tmp/x/team');
    expect(remoteToGitUrl('/tmp/x/team.git')).toBe('/tmp/x/team.git');
    expect(() => remoteToGitUrl('not a remote')).toThrow('Unsupported remote');
  });

  it('names a team after the repository basename, splitting on `:` only where the spelling puts one before the path', () => {
    expect(remoteName('git@github.com:Org/Team-Skills.git')).toBe('team-skills');
    expect(remoteName('https://gitlab.com/Org/Team-Skills.git')).toBe('Team-Skills');
    expect(remoteName('/tmp/x/team.git')).toBe('team');
    expect(remoteName('file:/tmp/x/team.git')).toBe('team');
    expect(remoteName('/tmp/x/team')).toBe('team');
    expect(remoteName('/tmp/x/team/.git')).toBe('team');
    expect(remoteName('file:/tmp/x/team/.git')).toBe('team');
    expect(remoteName('localhost:org/repo.git')).toBe('repo');
    expect(remoteName('https://gitlab.com/Org/re:po.git')).toBe('re:po');
  });

  it('extracts GitHub owner/repository only from GitHub remotes', () => {
    expect(githubOwnerRepo('git@github.com:Acme/Team.git')).toBe('acme/team');
    expect(githubOwnerRepo('https://gitlab.com/acme/team.git')).toBeNull();
  });
});

describe('host scoping (§6.0)', () => {
  it('classifies GitHub in every URL form and refuses the rest before any mutation', () => {
    expect(isGitHubRemote('ssh://git@github.com/acme/team.git')).toBe(true);
    expect(isGitHubRemote('git@github.com:acme/team.git')).toBe(true);
    expect(isGitHubRemote('https://gitlab.com/acme/team.git')).toBe(false);
    expect(hostOperationAllowed('https://github.com/acme/team.git')).toEqual({ ok: true });
    expect(hostOperationAllowed('ssh://git@github.com/acme/team.git')).toEqual({ ok: true });
    expect(hostOperationAllowed('ssh://git@git.example/team.git')).toMatchObject({ ok: false, error: expect.stringContaining('managed on the host') });
    expect(hostOperationAllowed('ssh://git@git.example/team.git', true)).toEqual({ ok: true });
    expect(hostOperationAllowed('nonsense')).toMatchObject({ ok: false });
    expect(hostOperationAllowed('https://user@github.com.evil.example/acme/team.git')).toMatchObject({ ok: false });
  });
});
