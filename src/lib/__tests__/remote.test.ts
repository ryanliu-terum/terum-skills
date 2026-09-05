import { describe, expect, it } from 'vitest';
import { githubOwnerRepo, hostOperationAllowed, isGitHubRemote, normalizeRemote, remoteName, remoteToGitUrl, sameRemote } from '../remote.js';

describe('normalizeRemote (§5.1)', () => {
  it('strips protocol, credentials, port, .git, and trailing slash; lowercases the host, and the path on GitHub', () => {
    expect(normalizeRemote('https://github.com/Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemote('https://user:tok@GitHub.com/Org/Repo/')).toBe('github.com/org/repo');
    expect(normalizeRemote('ssh://git@github.com:22/Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemote('git@github.com:Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemote('github.com/Org/Repo')).toBe('github.com/org/repo');
    expect(normalizeRemote('https://gitlab.com/Org/Repo.git')).toBe('gitlab.com/Org/Repo');
    expect(normalizeRemote('myhost:Org/Repo.git')).toBe('myhost/Org/Repo');
    expect(normalizeRemote('/tmp/teams/team.git')).toBe('file:/tmp/teams/team');
    expect(normalizeRemote('file:///tmp/teams/team.git')).toBe('file:/tmp/teams/team');
  });

  it('is idempotent on its own output, in every form', () => {
    for (const input of ['https://github.com/Org/Repo.git', 'https://gitlab.com/Org/Repo.git', 'git@example.org:Org/Repo.git', '/tmp/x/team.git', 'file:///tmp/x/team.git']) {
      const once = normalizeRemote(input);
      expect(normalizeRemote(once), input).toBe(once);
    }
  });

  it('never matches a near-miss and rejects things that are not remotes', () => {
    expect(sameRemote('https://github.com/Org/Repo.git', 'https://github.com/Org/Repo-extra.git')).toBe(false);
    expect(sameRemote('https://github.com/Org/Repo', 'https://github.com/org/repo')).toBe(true);
    expect(sameRemote('https://gitlab.com/Org/Repo', 'https://gitlab.com/org/repo')).toBe(false);
    for (const bad of ['', 'not a remote', 'org/repo', 'C:\\repos\\team', 'github.com/']) expect(() => normalizeRemote(bad), bad).toThrow('Unsupported remote');
  });

  it('turns every accepted form into something git can fetch', () => {
    expect(remoteToGitUrl('github.com/Org/Repo')).toBe('https://github.com/Org/Repo.git');
    expect(remoteToGitUrl('git.example/team/skills.git')).toBe('https://git.example/team/skills.git');
    expect(remoteToGitUrl('https://github.com/Org/Repo.git')).toBe('https://github.com/Org/Repo.git');
    expect(remoteToGitUrl('git@github.com:Org/Repo.git')).toBe('git@github.com:Org/Repo.git');
    expect(remoteToGitUrl('file:/tmp/x/team')).toBe('/tmp/x/team');
    expect(remoteToGitUrl('/tmp/x/team.git')).toBe('/tmp/x/team.git');
    expect(() => remoteToGitUrl('org/repo')).toThrow('Unsupported remote');
  });

  it('names a team after the repository basename', () => {
    expect(remoteName('git@github.com:Org/Team-Skills.git')).toBe('team-skills');
    expect(remoteName('https://gitlab.com/Org/Team-Skills.git')).toBe('Team-Skills');
    expect(remoteName('/tmp/x/team.git')).toBe('team');
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
