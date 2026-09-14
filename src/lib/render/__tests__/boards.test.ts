import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run as ls } from '../../../commands/ls.js';
import { run as status } from '../../../commands/status.js';
import { createExecute } from '../../execute.js';
import type { ResultOutcome } from '../../frames.js';
import type { Prompter } from '../../prompt.js';
import type { Result } from '../../result.js';
import { DASHBOARD_IDS, DASHBOARD_NOW, dashboardReceipt, dashboardTeam, emptyMachine, redact, type DashboardFixture } from '../../__tests__/fixtures.js';
import type { RenderContext } from '../board.js';
import type { RenderOptions } from '../options.js';
import { createBoardSink } from '../sink.js';
import { render as renderLs } from '../verbs/ls.js';
import { escapeRegExp, receiptHeadline, receiptSections, versionText } from '../verbs/shared.js';

/**
 * §13: one file snapshot per board × backend. Each scenario runs the real verb against dashboardTeam()
 * through the board sink, so what is pinned is the whole path from value to text. Review a changed
 * snapshot by eye; never regenerate one to make a test pass without reading the diff.
 */
export const BACKENDS: Record<string, Partial<RenderOptions>> = {
  md: { format: 'md', color: false, width: 100 },
  'pretty-colour': { format: 'pretty', color: true, width: 100 },
  'pretty-70': { format: 'pretty', color: false, width: 70 },
  json: { format: 'json' },
};

const RENDER_CTX: RenderContext = {
  format: 'md', host: 'claude', rows: 25, width: 100, color: false, form: undefined,
  home: '/home/seed', now: DASHBOARD_NOW, argv: ['ls'], command: 'npx -y terum-skills@latest ls --format md',
};

export async function boardOf(verb: string, argv: string[], backend: string, act: (io: Prompter) => Promise<Result<unknown>>, fixture: { root: string; home: string }): Promise<string> {
  const written: string[] = []; const errors: string[] = []; const codes: number[] = [];
  const options: RenderOptions = { format: 'md', formatGiven: true, host: 'claude', rows: 25, width: 100, color: false, ...BACKENDS[backend] };
  const sink = createBoardSink({ options, form: undefined, home: fixture.home, now: () => DASHBOARD_NOW, argv, command: `npx -y terum-skills@latest ${argv.join(' ')} --format ${options.format}`, write: (text) => written.push(text), stderr: (line) => errors.push(line), setExitCode: (code) => codes.push(code) });
  await createExecute(sink)(act, { verb, notices: false });
  expect(written).toHaveLength(1);
  const trailer = errors.length || codes.length ? `\n--- stderr ---\n${errors.join('\n')}\n--- exit ${codes.join(',')} ---\n` : '';
  return redact(`${written[0]}${trailer}`, fixture);
}

export function typed(verb: string, argv: string[], backend: string, outcome: Omit<ResultOutcome, 'verb'>, lines: string[], fixture = { root: '/nowhere-root', home: '/home/seed' }): Promise<string> {
  return boardOf(verb, argv, backend, async (io) => { for (const line of lines) io.print(line); return outcome.ok ? { ok: true, value: outcome.value } : { ok: false, error: outcome.error ?? 'failed', ...(outcome.refused ? { refused: true } : {}), ...(outcome.cancelled ? { cancelled: true } : {}), ...(outcome.value === undefined ? {} : { value: outcome.value }) }; }, fixture);
}

const snapshot = (name: string, backend: string): string => `./__snapshots__/${name}.${backend}.txt`;
let team: DashboardFixture | undefined;
const fixture = async (): Promise<DashboardFixture> => {
  const value = team ??= await dashboardTeam();
  const fixedMtime = new Date(DASHBOARD_NOW);
  await Promise.all(Object.values(value.paths).map((folder) => utimes(join(folder, 'SKILL.md'), fixedMtime, fixedMtime)));
  return value;
};
afterEach(() => { team = undefined; });

describe('shared renderer helpers', () => {
  it('renders the complete receipt sections and canonical version wording', () => {
    const receipt = dashboardReceipt({
      skill_id: DASHBOARD_IDS.deploy,
      skill_name: 'deploy-check',
      version: 'v1',
      run_id: '20260901T100000Z',
      content_digest: `sha256:${'a'.repeat(64)}`,
      w: 4,
      l: 2,
      t: 0,
      runner: 'mira',
    });
    expect(receiptHeadline(receipt, RENDER_CTX)).toBe('✓ PASS +33% · 4W 2L 0T (n=6) · p=0.031 · complete · sonnet k=1 · @mira · 12d ago');
    expect(receiptSections(receipt, receipt.triggers, RENDER_CTX).map((section) => section.title)).toEqual([
      'Comparisons', 'Arm scores', 'Efficiency', 'Cost, over the costlier arm', 'Triggers', 'Provenance',
    ]);
    expect(versionText('v3')).toBe('Version 3');
    expect(versionText('3')).toBe('—');
    expect(escapeRegExp('a+b[c]')).toBe('a\\+b\\[c\\]');
  });

  it('stays null-safe for absent limbs and malformed comparison counts', () => {
    expect(receiptSections(null, null, RENDER_CTX)).toEqual([]);
    expect(() => receiptSections({ comparisons: { malformed: { win: -1, loss: 1.5, tie: '2' } } }, null, RENDER_CTX)).not.toThrow();
    expect(receiptHeadline(null, RENDER_CTX)).toBe('— not evaluated');
  });
});

describe('ls boards', () => {
  it('uses the newest receipt, gives an equal run to the team, and attributes only a run that is not mine', () => {
    const receipt = (runId: string, verdict: 'PASS' | 'FAIL', mine: boolean, runner: string) => ({
      run_id: runId,
      verdict,
      execution_status: 'complete',
      expected_rows: 6,
      scored_rows: 6,
      comparisons: { 'candidate-vs-baseline': verdict === 'PASS' ? { win: 4, loss: 2, tie: 0 } : { win: 1, loss: 4, tie: 1 } },
      provenance: { runner_handle: runner },
      mine,
    });
    const value = {
      local: [{
        root: '/home/seed/.claude/skills', label: 'Global', rootState: 'scanned', registered: false, notOffered: [],
        rows: [
          { name: 'equal-run', localEval: receipt('20260901', 'FAIL', true, 'seed'), teamEval: receipt('20260901', 'PASS', true, 'seed') },
          { name: 'new-local', localEval: receipt('20260902', 'FAIL', false, 'ravi'), teamEval: receipt('20260901', 'PASS', true, 'seed') },
        ],
      }],
    };
    const rendered = renderLs(value, RENDER_CTX);
    const section = rendered.sections.find((candidate) => candidate.kind === 'table' && candidate.title?.startsWith('Global'));
    if (section === undefined || section.kind !== 'table') throw new Error('Expected the Global Library table.');
    const evalFor = (name: string) => section.rows.find((row) => row['skill']?.kind === 'text' && row['skill'].text === name)?.['eval'];
    expect(evalFor('equal-run')).toMatchObject({ kind: 'verdict', verdict: 'PASS', from: 'team' });
    expect(evalFor('new-local')).toMatchObject({ kind: 'verdict', verdict: 'FAIL', from: '@ravi' });
    expect(rendered.headline).toContain('attention 1 failing · 0 not evaluated');
  });

  it('does not throw when a result or narrowed result limb is absent', () => {
    for (const value of [null, {}, { selection: { kind: 'member' }, member: null }, { selection: { kind: 'project' }, projects: null }, { selection: { kind: 'skill' }, skills: null, local: null }, { local: [null] }]) {
      expect(() => renderLs(value, RENDER_CTX)).not.toThrow();
    }
  });

  for (const backend of Object.keys(BACKENDS)) {
    it.each([
      ['team.library', ['ls', '--local'], { local: true }],
      ['team.marketplace', ['ls'], {}],
      ['team.member', ['ls', 'member', 'seed'], { kind: 'member', value: 'seed' }],
      ['team.project', ['ls', 'project', 'terum'], { kind: 'project', value: 'terum' }],
      ['team.skill-team', ['ls', 'skill', 'deploy-check'], { kind: 'skill', value: 'deploy-check' }],
      ['team.skill-library', ['ls', 'skill', 'notes'], { kind: 'skill', value: 'notes' }],
      ['team.skill-prefix', ['ls', 'skill', 'DIAG'], { kind: 'skill', value: 'DIAG' }],
      ['team.skill-miss', ['ls', 'skill', 'ghost'], { kind: 'skill', value: 'ghost' }],
    ] as const)('%s (' + backend + ')', async (name, argv, args) => {
      const f = await fixture();
      const text = await boardOf('ls', [...argv], backend, (io) => ls({ ...args, config: f.store, runner: f.runner, home: f.home, cwd: f.home }, io), f);
      await expect(text).toMatchFileSnapshot(snapshot(name, backend));
    });
    it(`empty.library (${backend})`, async () => {
      const m = await emptyMachine();
      const text = await boardOf('ls', ['ls', '--local'], backend, (io) => ls({ local: true, config: m.store, home: m.home, runner: { run: async () => ({ code: 1, stdout: '', stderr: '' }) } }, io), { root: m.store.root, home: m.home });
      await expect(text).toMatchFileSnapshot(snapshot('empty.library', backend));
    });
  }
});

describe('status, update, sync boards', () => {
  for (const backend of Object.keys(BACKENDS)) {
    it(`team.status (${backend})`, async () => {
      const f = await fixture();
      const text = await boardOf('status', ['status'], backend, async (io) => {
        // the printed banner carries the live package version; pin it like value.version so a release bump cannot redden the snapshot
        const pinned: Prompter = { ...io, print: (line) => io.print(line.replace(/^terum-skills \d+\.\d+\.\d+\S*/, 'terum-skills 0.16.0')) };
        const result = await status({ config: f.store, runner: f.runner, now: () => DASHBOARD_NOW }, pinned);
        // Machine facts are overwritten so the snapshot is stable across hosts (§13).
        return result.value === undefined ? result : { ...result, value: { ...result.value, version: '0.16.0', hostArch: 'arm64', processArch: 'x64', tools: { git: true, gh: false } } };
      }, f);
      await expect(text).toMatchFileSnapshot(snapshot('team.status', backend));
    });
    it(`empty.status (${backend})`, async () => {
      const m = await emptyMachine();
      const text = await boardOf('status', ['status'], backend, async (io) => {
        // the printed banner carries the live package version; pin it like value.version so a release bump cannot redden the snapshot
        const pinned: Prompter = { ...io, print: (line) => io.print(line.replace(/^terum-skills \d+\.\d+\.\d+\S*/, 'terum-skills 0.16.0')) };
        const result = await status({ config: m.store, runner: { run: async (command) => (command === 'git' ? { code: 0, stdout: 'git version 2.45.0', stderr: '' } : Promise.reject(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }))) } }, pinned);
        return result.value === undefined ? result : { ...result, value: { ...result.value, version: '0.16.0', hostArch: 'x64', processArch: 'x64' } };
      }, { root: m.store.root, home: m.home });
      await expect(text).toMatchFileSnapshot(snapshot('empty.status', backend));
    });
    it(`typed.update (${backend})`, async () => {
      const value = { running: '0.16.0', latest: '0.17.0', observation: 'older', launch: 'npx', description: 'Latest advertised release: 0.17.0 (observed 2026-09-13T08:00:00Z)', advice: ['Cache request recorded as: terum-skills@latest', "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'], lines: ['terum-skills 0.16.0', 'This copy: /home/seed/.npm/_npx/abc/node_modules/terum-skills', 'Latest advertised release: 0.17.0 (observed 2026-09-13T08:00:00Z)', 'Cache request recorded as: terum-skills@latest', "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'] };
      await expect(await typed('update', ['update'], backend, { ok: true, value, exitCode: 0 }, value.lines)).toMatchFileSnapshot(snapshot('typed.update', backend));
    });
    it(`typed.sync (${backend})`, async () => {
      const value = { changed: true, teams: [{ team: 'acme', state: 'refreshed', changed: true, head: 'a1b2c3d4e5f6' }, { team: 'old', state: 'unreachable', changed: false, head: null, detail: 'repository not found', missing: true, successors: [{ ownerRepo: 'acme/team-2', source: 'member' }], summary: 'old: the repository is gone; GitHub knows acme/team-2 (renamed).' }], notices: ['Updated your terum-skills skills for this CLI.'] };
      await expect(await typed('sync', ['sync'], backend, { ok: true, value, exitCode: 0 }, ['old: not refreshed (unreachable) — repository not found', 'old: the repository is gone; GitHub knows acme/team-2 (renamed).', 'To follow it, run `npx -y terum-skills@latest team move acme/team-2`.'])).toMatchFileSnapshot(snapshot('typed.sync', backend));
    });
  }

  it('update board hides "How to update" and the Next step when the advice was not printed', async () => {
    const value = { running: '0.16.0', latest: '0.16.0', observation: 'same', launch: 'global', description: 'This copy matches the release advertisement. npm availability was not checked.', advice: ['If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.'], lines: ['terum-skills 0.16.0', 'This copy matches the release advertisement. npm availability was not checked.'] };
    const text = await typed('update', ['update'], 'md', { ok: true, value, exitCode: 0 }, value.lines);
    expect(text).not.toContain('How to update');
    expect(text).not.toContain('**Next:**');
  });

  it('update board shows "How to update" and the Next step when the advice was printed', async () => {
    const value = { running: '0.15.0', latest: '0.16.0', observation: 'older', launch: 'global', description: 'Latest advertised release: 0.16.0 (observed 2026-09-13T08:00:00Z)', advice: ['If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.'], lines: ['terum-skills 0.15.0', 'This copy: /opt/homebrew/lib/node_modules/terum-skills', 'Latest advertised release: 0.16.0 (observed 2026-09-13T08:00:00Z)', 'If installed globally with npm, run:', '  npm install -g terum-skills@latest', 'Otherwise, update it with the tool that installed this copy.'] };
    const text = await typed('update', ['update'], 'md', { ok: true, value, exitCode: 0 }, value.lines);
    expect(text).toContain('### How to update');
    expect(text).toContain('**Next:** `npm install -g terum-skills@latest`');
  });

  it('status board keeps the clone-repair instruction as a note, not a covered line', async () => {
    const value = {
      version: '0.16.0',
      teams: [{ team: 'acme', handle: 'seed', repository: 'https://github.com/acme/team', clone: { state: 'absent' }, clonePath: '/home/seed/.terum/skills/acme', membership: null, policy: null, categories: null, members: [], pending: [], syncedAt: null, stale: false }],
      ledger: { placements: [], approvals: [] }, identity: null, tools: { git: false, gh: false }, hostArch: 'x64', processArch: 'x64',
    };
    const lines = [
      'terum-skills 0.16.0',
      'Team acme (configured handle @seed)',
      '  Repository: https://github.com/acme/team',
      '  Clone: /home/seed/.terum/skills/acme is missing.',
      '  Restore it: npx -y terum-skills@latest team join https://github.com/acme/team',
    ];
    const text = await typed('status', ['status'], 'md', { ok: true, value, exitCode: 0 }, lines);
    expect(text).toContain('**Notes**');
    expect(text).toContain('-   Restore it: npx -y terum-skills@latest team join https://github.com/acme/team');
  });
});
