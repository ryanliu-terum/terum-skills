import { describe, expect, it } from 'vitest';
import { fakeGh, ghOnlyRunner, noGhRunner } from './fixtures.js';
import { findSuccessors, successorSummary, SUCCESSOR_LOOKUP_DEADLINE_MS } from '../successor.js';
import type { CommandResult } from '../runner.js';

const OLD = 'https://github.com/ryanliu-terum/terum-shared-skills.git';
const ok = (value: unknown): CommandResult => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const notFound: CommandResult = { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
const teamJson = (name: string) => ok({ encoding: 'base64', content: Buffer.from(JSON.stringify({ layout_version: 3, name })).toString('base64') });
const REPOS = 'api user/repos?affiliation=collaborator,organization_member,owner&sort=pushed&per_page=100 --paginate --slurp';

describe('findSuccessors', () => {
  it('ranks a pending invitation from the same owner first, then reachable repositories of that owner that carry a team.json, newest first', async () => {
    const runner = ghOnlyRunner(fakeGh('me', {
      'api user/repository_invitations': ok([
        { id: 1, created_at: '2026-09-07T04:53:27Z', repository: { full_name: 'ryanliu-terum/team-skills', owner: { login: 'ryanliu-terum' } } },
        { id: 2, created_at: '2026-09-13T22:25:29Z', repository: { full_name: 'ryanliu-terum/shared-skills', owner: { login: 'ryanliu-terum' } } },
        { id: 3, created_at: '2026-09-13T23:00:00Z', repository: { full_name: 'someone-else/shared-skills', owner: { login: 'someone-else' } } },
      ]),
      [REPOS]: ok([[
        { full_name: 'ryanliu-terum/terum-skills', pushed_at: '2026-09-13T20:00:00Z', owner: { login: 'ryanliu-terum' } },
        { full_name: 'ryanliu-terum/old-team', pushed_at: '2026-09-01T00:00:00Z', owner: { login: 'ryanliu-terum' } },
        { full_name: 'ryanliu-terum/terum-shared-skills', pushed_at: '2026-09-12T00:00:00Z', owner: { login: 'ryanliu-terum' } },
        { full_name: 'ryanliu-terum/archived-team', pushed_at: '2026-09-11T00:00:00Z', archived: true, owner: { login: 'ryanliu-terum' } },
        { full_name: 'teniroo/mine', pushed_at: '2026-09-13T00:00:00Z', owner: { login: 'teniroo' } },
      ]]),
      'api repos/ryanliu-terum/terum-skills/contents/team.json': notFound,
      'api repos/ryanliu-terum/old-team/contents/team.json': teamJson('old-team'),
    }));
    const search = await findSuccessors(runner, OLD);
    expect(search).toEqual({ successors: [
      { ownerRepo: 'ryanliu-terum/shared-skills', source: 'invitation', invitationId: 2, teamName: null, at: '2026-09-13T22:25:29Z' },
      { ownerRepo: 'ryanliu-terum/team-skills', source: 'invitation', invitationId: 1, teamName: null, at: '2026-09-07T04:53:27Z' },
      { ownerRepo: 'ryanliu-terum/old-team', source: 'member', teamName: 'old-team', at: '2026-09-01T00:00:00Z' },
    ] });
    // The dead repository itself, an archived one, another owner's, and one without team.json are never offered; the archived one is never even probed.
    expect(runner.calls.map((call) => call.args.join(' ')).filter((line) => line.includes('/contents/team.json'))).toEqual([
      'api repos/ryanliu-terum/terum-skills/contents/team.json', 'api repos/ryanliu-terum/old-team/contents/team.json',
    ]);
    expect(runner.calls.every((call) => call.args[0] !== 'api' || (call as { args: string[] }).args.length > 0)).toBe(true);
  });

  it('does not offer a repository that is already listed as an invitation twice, and reads a team.json that is not base64', async () => {
    const runner = ghOnlyRunner(fakeGh('me', {
      'api user/repository_invitations': ok([{ id: 9, created_at: '2026-09-13T00:00:00Z', repository: { full_name: 'ryanliu-terum/shared-skills' } }]),
      [REPOS]: ok([[{ full_name: 'ryanliu-terum/shared-skills', pushed_at: '2026-09-13T01:00:00Z' }, { full_name: 'ryanliu-terum/other', pushed_at: '2026-09-10T00:00:00Z' }]]),
      'api repos/ryanliu-terum/other/contents/team.json': ok({ content: JSON.stringify({ name: 'other' }) }),
    }));
    const search = await findSuccessors(runner, OLD);
    expect(search.successors.map((entry) => [entry.ownerRepo, entry.source, entry.teamName])).toEqual([['ryanliu-terum/shared-skills', 'invitation', null], ['ryanliu-terum/other', 'member', 'other']]);
  });

  it('bounds every gh call and probes at most the newest N repositories', async () => {
    const runner = ghOnlyRunner(fakeGh('me', {
      'api user/repository_invitations': ok([]),
      [REPOS]: ok([[1, 2, 3].map((n) => ({ full_name: `ryanliu-terum/r${n}`, pushed_at: `2026-09-0${n}T00:00:00Z` }))]),
      'api repos/ryanliu-terum/r3/contents/team.json': teamJson('r3'),
      'api repos/ryanliu-terum/r2/contents/team.json': teamJson('r2'),
    }));
    const search = await findSuccessors(runner, OLD, { probeLimit: 2 });
    expect(search.successors.map((entry) => entry.ownerRepo)).toEqual(['ryanliu-terum/r3', 'ryanliu-terum/r2']);
    expect(runner.calls.map((call) => call.args.join(' '))).not.toContain('api repos/ryanliu-terum/r1/contents/team.json');
    for (const call of runner.calls) expect((call as { args: string[] }).args[0]).toBe('api');
    // Every call carried the deadline (recorded through the runner's options).
    const deadlines = new Set<number | undefined>();
    const spy = { run: async (command: 'git' | 'gh', args: readonly string[], options?: { deadlineMs?: number }) => { deadlines.add(options?.deadlineMs); return runner.run(command, args, options); } };
    await findSuccessors(spy, OLD, { probeLimit: 2 });
    expect([...deadlines]).toEqual([SUCCESSOR_LOOKUP_DEADLINE_MS]);
  });

  it('explains a non-GitHub remote, a missing gh, a logged-out gh, a timeout, and an unreadable answer, and never throws', async () => {
    expect(await findSuccessors(noGhRunner, 'https://git.example/team.git')).toEqual({ successors: [], reason: 'The team repository is not on github.com, so no replacement can be looked up.' });
    expect((await findSuccessors(noGhRunner, OLD)).reason).toMatch(/gh is not installed/);
    expect((await findSuccessors(ghOnlyRunner(fakeGh('me', {}, false)), OLD)).reason).toMatch(/gh is logged out/);
    const slow = ghOnlyRunner(() => ({ code: 124, stdout: '', stderr: 'terum-skills: gh api exceeded 10 s' }));
    expect((await findSuccessors(slow, OLD)).reason).toMatch(/did not answer in time/);
    const garbage = ghOnlyRunner(fakeGh('me', { 'api user/repository_invitations': { code: 0, stdout: '{"not":"an array"}', stderr: '' } }));
    expect((await findSuccessors(garbage, OLD)).reason).toMatch(/unreadable invitation list/);
    // An invitation list that reads but a repository list that fails keeps the invitations and says why the rest is missing.
    const half = ghOnlyRunner(fakeGh('me', { 'api user/repository_invitations': ok([{ id: 4, repository: { full_name: 'ryanliu-terum/shared-skills' } }]) }));
    const search = await findSuccessors(half, OLD);
    expect(search.successors.map((entry) => entry.ownerRepo)).toEqual(['ryanliu-terum/shared-skills']);
    expect(search.reason).toMatch(/GitHub could not be asked for a replacement/);
  });
});

describe('successorSummary', () => {
  it('names the dead repository, the best replacement and how it was found, or says nothing was found and what to do', () => {
    expect(successorSummary('team', 'ryanliu-terum/terum-shared-skills', { successors: [{ ownerRepo: 'ryanliu-terum/shared-skills', source: 'invitation', invitationId: 1, teamName: null, at: '2026-09-13T22:25:29Z' }] }))
      .toBe("team's repository ryanliu-terum/terum-shared-skills no longer exists on GitHub. A replacement from the same owner is available: ryanliu-terum/shared-skills (you were invited to it on 2026-09-13).");
    expect(successorSummary('team', 'o/r', { successors: [{ ownerRepo: 'o/n', source: 'member', teamName: 'n', at: null }] })).toContain('(you already have access to it)');
    expect(successorSummary('team', 'o/r', { successors: [] })).toContain('no pending invitation from o');
    expect(successorSummary('team', 'o/r', { successors: [] })).toContain('team move <owner>/<repo>');
    expect(successorSummary('team', 'o/r', { successors: [], reason: 'gh is logged out.' })).toBe("team's repository o/r no longer exists on GitHub. gh is logged out.");
  });
});
