import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as ls } from '../../commands/ls.js';
import { run as status } from '../../commands/status.js';
import { run as evalReport } from '../../commands/evalReport.js';
import { DASHBOARD_IDS, dashboardTeam, emptyMachine, redact, ScriptedPrompter } from './fixtures.js';

describe('dashboardTeam()', () => {
  it('builds a team the boards can show: three skills, three people, receipts at two versions, one invalid', async () => {
    const f = await dashboardTeam();
    const team = await ls({ config: f.store, runner: f.runner, home: f.home, cwd: f.home }, new ScriptedPrompter());
    if (!team.ok) throw new Error(team.error);
    expect(team.value.skills.map((s) => [s.name, s.latest, s.versionCount, s.installs, s.receipt?.verdict ?? null, s.evalVersion, s.latestEvalState])).toEqual([
      ['deploy-check', 'v2', 2, 2, 'NEUTRAL', 2, 'ok'], ['diagnose', 'v1', 1, 0, null, null, 'invalid'], ['tdd', 'v2', 2, 1, 'PASS', 1, 'none'],
    ]);
    expect(team.value.skills.map((s) => new Date(s.updated).toISOString())).toEqual(['2026-09-05T10:00:00.000Z', '2026-09-03T10:00:00.000Z', '2026-09-04T10:00:00.000Z']);
    expect(team.value.people?.map((p) => [p.handle, p.role, p.local_skills, p.installed.length, p.profile.length])).toEqual([['mira', null, 3, 2, 0], ['ravi', 'Debugging', null, 0, 0], ['seed', 'Platform', 4, 1, 1]]);
    expect(team.value.projects?.map((p) => p.name)).toEqual(['Global', 'terum']);
    expect(team.value.problems).toEqual([{ source: `evals/${DASHBOARD_IDS.diagnose}`, message: expect.stringContaining('invalid') }]);
  });

  it('builds a Library with a placed, an edited, an untracked, a symlinked, an invalid-YAML and a project folder, with local receipts', async () => {
    const f = await dashboardTeam();
    const library = await ls({ local: true, config: f.store, runner: f.runner, home: f.home }, new ScriptedPrompter());
    if (!library.ok) throw new Error(library.error);
    const [global, project] = library.value.local!;
    expect(global!.rows.map((r) => [r.name, r.tracked, r.edited, r.localEval?.verdict ?? null, r.localEvalStale, r.matchedVersion, r.teamEval?.verdict ?? null])).toEqual([
      ['deploy-check', true, false, 'FAIL', false, 'v1', 'PASS'], ['notes', false, false, null, false, null, null], ['tdd', true, true, null, true, null, null],
    ]);
    expect(global!.notOffered.map((r) => [r.name, r.reason])).toEqual([['bad-yaml', 'invalid-yaml'], ['linked', 'symlink']]);
    expect(project!.registered).toBe(true); expect(project!.label).toBe('proj');
    expect(project!.rows.map((r) => [r.name, r.tracked, r.knownToTeam])).toEqual([['diagnose', false, true]]);
    expect((await lstat(f.paths.notes)).isDirectory()).toBe(true);
  });

  it('status sees a stale stamp, a pending install and the placements; eval-report falls back for tdd and warns for diagnose', async () => {
    const f = await dashboardTeam();
    const s = await status({ config: f.store, runner: f.runner, now: () => Date.parse('2026-09-13T12:00:00Z') }, new ScriptedPrompter());
    if (!s.ok) throw new Error(s.error);
    expect(s.value.teams[0]).toMatchObject({ team: 'acme', handle: 'seed', stale: true, membership: 'active', memberCount: 3, sharedSkills: 3, pending: [{ op: 'install', id: DASHBOARD_IDS.diagnose }] });
    expect(s.value.ledger.placements.map((p) => p.id).sort()).toEqual([DASHBOARD_IDS.deploy, DASHBOARD_IDS.tdd]);
    expect(s.value.tools).toEqual({ git: true, gh: false });
    const tdd = await evalReport({ ref: 'tdd', config: f.store, runner: f.runner, home: f.home }, new ScriptedPrompter());
    expect(tdd).toMatchObject({ ok: true, value: { versions: { placed: 'v1', teamCurrent: 'v2', evaluated: 'v1' }, fallbackFrom: 'v1', latestState: 'ok' } });
    const io = new ScriptedPrompter();
    expect(await evalReport({ ref: 'diagnose', config: f.store, runner: f.runner, home: f.home }, io)).toMatchObject({ ok: true, value: { latestState: 'invalid', latest: null } });
    expect(io.lines[0]).toMatch(/^warning: the newest receipt is invalid/);
    expect(redact(`${f.root}/x ${f.home}/y`, f)).toBe('<ROOT>/x <HOME>/y');
    expect(JSON.parse(await readFile(join(f.store.root, 'config.json'), 'utf8')).default_handle).toBe('seed');
  });

  it('emptyMachine() has no team and an empty Library', async () => {
    const m = await emptyMachine();
    const s = await status({ config: m.store, runner: { run: async (command) => (command === 'git' ? { code: 0, stdout: 'git version 2', stderr: '' } : Promise.reject(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }))) } }, new ScriptedPrompter());
    expect(s).toMatchObject({ ok: true, value: { teams: [] } });
  });
});
