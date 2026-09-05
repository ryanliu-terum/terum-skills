import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentRunError, Transcript, type AgentApi } from '../agent.js';
import { ContaminationError, decide, loadCase, runCase, seedSandbox, type EvalCase } from '../execution.js';

let scratch: string;
beforeEach(async () => { scratch = await mkdtemp(join(tmpdir(), 'exec-')); });

const caseOf = (extra: Partial<EvalCase> = {}): EvalCase => ({ name: 'c', task: 'do the thing', files: {}, checks: [], ...extra });

const transcriptWith = (text: string, extras: Record<string, unknown>[] = []): Transcript =>
  Transcript.fromStream([
    ...extras.map((event) => JSON.stringify(event)),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    JSON.stringify({ type: 'result', result: 'done', num_turns: 4, duration_ms: 9400, total_cost_usd: 0.12 }),
  ].join('\n'));

describe('case loading (§5.1)', () => {
  it('requires task, validates bucket, defaults checks and files', () => {
    expect(loadCase('task: do it\n', 'a')).toMatchObject({ ok: true, value: { name: 'a', task: 'do it', checks: [], files: {} } });
    expect(loadCase('', 'a').ok).toBe(false);
    expect(loadCase('task: x\nbucket: adversarial\n', 'a')).toMatchObject({ ok: true, value: { bucket: 'adversarial' } });
    expect(loadCase('task: x\nbucket: sneaky\n', 'a').ok).toBe(false);
    expect(loadCase('task: x\nfiles: [nope]\n', 'a').ok).toBe(false);
    expect(loadCase('task: x\nchecks:\n  - file_exists: out.txt\n', 'a')).toMatchObject({ ok: true, value: { checks: [{ file_exists: 'out.txt' }] } });
  });
});

describe('sandbox seeding (§4.3, strictly in order)', () => {
  it('copies fixtures, writes inline files (.sh → 0755), runs setup, stages the skill without evals/fixtures', async () => {
    const caseDir = join(scratch, 'cases');
    await mkdir(join(caseDir, '..', 'fixtures', 'repo'), { recursive: true });
    await writeFile(join(caseDir, '..', 'fixtures', 'repo', 'seed.txt'), 'from fixture');
    const skillDir = join(scratch, 'skill-src');
    for (const dir of ['references', 'evals', 'fixtures']) await mkdir(join(skillDir, dir), { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# skill');
    await writeFile(join(skillDir, 'references', 'notes.md'), 'ref');
    await writeFile(join(skillDir, 'evals', 'answer-key.yaml'), 'secret');
    await mkdir(caseDir, { recursive: true });

    const evalCase = caseOf({
      fixture: '../fixtures/repo',
      files: { 'src/app.ts': 'code', 'scripts/run.sh': 'echo hi' },
      setup: 'test -f seed.txt && touch setup-ran.marker',
    });
    const sandbox = await seedSandbox(evalCase, { caseDir, skillName: 'deploy-preflight', skillDir, scratch });

    expect(existsSync(join(sandbox, 'seed.txt'))).toBe(true);
    expect(existsSync(join(sandbox, 'src', 'app.ts'))).toBe(true);
    expect(((await stat(join(sandbox, 'scripts', 'run.sh'))).mode & 0o755)).toBe(0o755);
    expect(existsSync(join(sandbox, 'setup-ran.marker'))).toBe(true);
    const staged = join(sandbox, '.claude', 'skills', 'deploy-preflight');
    expect(existsSync(join(staged, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(staged, 'references', 'notes.md'))).toBe(true);
    expect(existsSync(join(staged, 'evals'))).toBe(false); // the skill must not see its own answer key
    expect(existsSync(join(staged, 'fixtures'))).toBe(false);
  });

  it('baseline stages nothing; unsafe paths and failing setup abort the case', async () => {
    const sandbox = await seedSandbox(caseOf(), { caseDir: scratch, skillName: 's', skillDir: null, scratch });
    expect(existsSync(join(sandbox, '.claude'))).toBe(false);
    await expect(seedSandbox(caseOf({ files: { '../evil.txt': 'x' } }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('unsafe file path');
    await expect(seedSandbox(caseOf({ files: { '/etc/evil': 'x' } }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('unsafe file path');
    await expect(seedSandbox(caseOf({ setup: 'exit 3' }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('setup failed');
    await expect(seedSandbox(caseOf({ fixture: 'no-such-dir' }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('fixture dir not found');
  });
});

describe('row verdicts (§7.1, port of _decide)', () => {
  const deps = { agent: { runAgent: () => Promise.reject(new Error('x')), askJson: () => Promise.resolve({ winner: 'A', reason: 'better' }) } as AgentApi, rng: () => 0.9 };
  const passed = [{ name: 'c', passed: true, detail: '' }];
  const failed = [{ name: 'c', passed: false, detail: '' }];
  const t = transcriptWith('hello');

  it('failure ladder first, then checks, then tie or judge', async () => {
    expect(await decide(deps, caseOf(), null, null, [], [])).toMatchObject({ result: 'tie', decidedBy: 'both-arms-failed' });
    expect(await decide(deps, caseOf(), null, t, [], [])).toMatchObject({ result: 'loss', decidedBy: 'candidate-run-failed' });
    expect(await decide(deps, caseOf(), t, null, [], [])).toMatchObject({ result: 'win', decidedBy: 'opponent-run-failed' });
    expect(await decide(deps, caseOf(), t, t, passed, failed)).toMatchObject({ result: 'win', decidedBy: 'checks' });
    expect(await decide(deps, caseOf(), t, t, failed, passed)).toMatchObject({ result: 'loss', decidedBy: 'checks' });
    expect(await decide(deps, caseOf(), t, t, failed, failed)).toMatchObject({ result: 'tie', decidedBy: 'checks-equal-no-judge' });
    expect(await decide(deps, caseOf({ judge: 'cleaner wins' }), t, t, passed, passed)).toMatchObject({ result: 'win', decidedBy: 'judge', reason: 'better' });
  });

  it('a refusing judge yields a tie labeled judge-refused', async () => {
    const refusing = { ...deps, agent: { ...deps.agent, askJson: () => Promise.reject(new AgentRunError('usage policy')) } };
    expect(await decide(refusing, caseOf({ judge: 'r' }), t, t, [], [])).toMatchObject({ result: 'tie', decidedBy: 'judge-refused' });
  });
});

describe('the three-arm matrix (§7.1 / §7.3)', () => {
  const skillFixture = async (): Promise<string> => {
    const skillDir = join(scratch, 'skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# s');
    return skillDir;
  };

  /** The staged skill is visible in the sandbox, so the fake agent behaves per arm like the real one would. */
  const armAwareAgent = (skillName: string): AgentApi => ({
    runAgent: (_task, cwd) => {
      const withSkill = existsSync(join(cwd, '.claude', 'skills', skillName));
      return Promise.resolve(transcriptWith(withSkill ? 'ran PREFLIGHT before deploy' : 'just deployed', [
        { type: 'system', subtype: 'init', skills: withSkill ? [skillName] : [] },
      ]));
    },
    askJson: () => Promise.resolve({}),
  });

  it('produces k rows per opponent, per-arm samples, and check-decided outcomes', async () => {
    const skillDir = await skillFixture();
    const evalCase = caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] });
    const { rows, arms } = await runCase(
      { agent: armAwareAgent('s'), rng: () => 0.9 },
      evalCase,
      { k: 2, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.comparison === 'candidate-vs-baseline' && row.outcome === 'win' && row.decided_by === 'checks')).toBe(true);
    expect(arms).toHaveLength(4);
    expect(arms.filter((sample) => sample.arm === 'candidate').every((sample) => sample.fraction === 1 && sample.turns === 4 && sample.cost_usd === 0.12)).toBe(true);
    expect(arms.filter((sample) => sample.arm === 'baseline').every((sample) => sample.fraction === 0)).toBe(true);
  });

  it('runs the incumbent arm when a tree is provided', async () => {
    const skillDir = await skillFixture();
    const { rows } = await runCase(
      { agent: armAwareAgent('s'), rng: () => 0.9 },
      caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] }),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir, incumbent: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(rows.map((row) => row.comparison).sort()).toEqual(['candidate-vs-baseline', 'candidate-vs-incumbent']);
  });

  it('a failed arm never aborts the matrix; its row scores against the empty transcript (§7.1)', async () => {
    const skillDir = await skillFixture();
    const flaky: AgentApi = {
      runAgent: (_task, cwd) => (existsSync(join(cwd, '.claude', 'skills', 's'))
        ? Promise.resolve(transcriptWith('ran PREFLIGHT', [{ type: 'system', subtype: 'init', skills: ['s'] }]))
        : Promise.reject(new AgentRunError('agent run timed out'))),
      askJson: () => Promise.resolve({}),
    };
    const { rows, arms } = await runCase(
      { agent: flaky, rng: () => 0.9 },
      caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] }),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(rows[0]).toMatchObject({ outcome: 'win', decided_by: 'opponent-run-failed' });
    expect(arms.find((sample) => sample.arm === 'baseline')).toMatchObject({ failed: true, fraction: 0, turns: null });
  });

  it('refuses the run when an arm’s resolved skill list contradicts its construction (§7.3)', async () => {
    const skillDir = await skillFixture();
    const contaminated: AgentApi = {
      runAgent: () => Promise.resolve(transcriptWith('x', [{ type: 'system', subtype: 'init', skills: ['planted-global-skill'] }])),
      askJson: () => Promise.resolve({}),
    };
    await expect(runCase(
      { agent: contaminated, rng: () => 0.9 },
      caseOf(),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    )).rejects.toThrow(ContaminationError);
  });
});
