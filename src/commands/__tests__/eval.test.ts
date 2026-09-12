import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { type AgentApi, Transcript } from '../../lib/evals/agent.js';
import { success } from '../../lib/result.js';
import { bareTeam, cloneWithIdentity, holdCloneLock, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { run } from '../eval.js';

const ID = '11111111-1111-4111-8111-111111111111';
const skill = (body = '') => `---\nname: sample\ndescription: checks deployments\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${body}`;
const transcript = (skills: string[]): Transcript => Transcript.fromStream(`${JSON.stringify({ type: 'system', subtype: 'init', skills })}\n${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: skills.length ? 'deployed' : 'nothing happened' }] } })}\n${JSON.stringify({ type: 'result', result: 'done' })}`);
const generatedCases = { cases: [
  { name: 'happy-path', task: 'Deploy the service.', checks: [{ transcript_mentions: 'deployed' }], bucket: 'explicit' },
  { name: 'safe-command', task: 'Prepare the deployment.', checks: [{ no_command_matching: 'deploy --force' }], bucket: 'negative' },
  { name: 'unsafe-request', task: 'Handle an unsafe request.', checks: [{ file_absent: '.env.leaked' }], bucket: 'adversarial' },
] };
const generatedTriggers = { should_trigger: ['deploy 1', 'deploy 2', 'deploy 3', 'deploy 4', 'deploy 5'], should_not_trigger: ['other 1', 'other 2', 'other 3', 'other 4', 'other 5'] };
function generationAgent(prompts: string[]): AgentApi {
  return {
    runAgent: async (_task, cwd) => transcript(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : []),
    askJson: async (prompt) => {
      prompts.push(prompt);
      if (prompt.includes('Generate exactly three')) return generatedCases;
      if (prompt.includes('Generate trigger evaluation')) return generatedTriggers;
      return { selected: ['sample'] };
    },
  };
}

describe('eval (§6 / IE2)', () => {
  it('waits out a busy clone, says so, and then runs the eval', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/triggers.yaml', 'should_trigger: [deploy now]\nshould_not_trigger: [chat]\n');
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const agent: AgentApi = { runAgent: async (_task, cwd) => transcript(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : []), askJson: async () => ({ selected: ['sample'] }) };
    const release = await holdCloneLock(store.teamClone('team'));
    let released: Promise<void> | undefined;
    const releaseOnce = () => released ??= release();
    const timer = setTimeout(() => void releaseOnce(), 2_500);
    const io = new ScriptedPrompter([], [], true);
    try {
      const result = await run({ ref: 'sample', config: store, agent, k: 1, lockWaitMs: 30_000, preflight: async () => success({ ccVersion: 'stub' }) }, io);
      expect(result.ok).toBe(true);
      expect(io.lines.some(line => /^Waiting for another terum-skills operation on team to finish… \(\d+ s\)$/.test(line))).toBe(true);
    } finally { clearTimeout(timer); await releaseOnce(); }
  });

  it('refuses with the unchanged busy sentence when the wait is exhausted, before anything is paid for', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    let preflightCalls = 0, agentCalls = 0;
    const agent: AgentApi = { runAgent: async () => { agentCalls++; return transcript([]); }, askJson: async () => { agentCalls++; return { selected: [] }; } };
    const release = await holdCloneLock(store.teamClone('team'));
    try {
      const result = await run({ ref: 'sample', config: store, agent, lockWaitMs: 800, preflight: async () => { preflightCalls++; return success({ ccVersion: 'stub' }); } }, new ScriptedPrompter([], [], true));
      expect(result).toMatchObject({ ok: false, error: 'Another terum-skills operation holds the write lock on team; retry when it finishes.' });
      expect(preflightCalls).toBe(0); expect(agentCalls).toBe(0);
    } finally { await release(); }
  });

  it('keeps the non-interactive budget short', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update(config => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const release = await holdCloneLock(store.teamClone('team'));
    const io = new ScriptedPrompter(), started = Date.now();
    try {
      expect(await run({ ref: 'sample', config: store }, io)).toMatchObject({ ok: false, error: 'Another terum-skills operation holds the write lock on team; retry when it finishes.' });
      expect(Date.now() - started).toBeLessThan(8_000);
      expect(io.lines.some(line => line.startsWith('Waiting for another'))).toBe(false);
    } finally { await release(); }
  });

  it('hard-stops at hygiene before preflight or any agent process', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill('bad\u202Etext'));
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    let preflightCalls = 0; let agentCalls = 0;
    const agent: AgentApi = { runAgent: () => { agentCalls++; return Promise.resolve(transcript([])); }, askJson: () => { agentCalls++; return Promise.resolve({ selected: [] }); } };
    const result = await run({ ref: 'sample', config: store, agent, preflight: async () => { preflightCalls++; return success({ ccVersion: 'stub' }); } }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('HYG2') });
    expect(preflightCalls).toBe(0); expect(agentCalls).toBe(0);
  });

  it('writes an inspectable local run tree for trigger plus two-arm execution without editing the clone', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/triggers.yaml', 'should_trigger: [deploy now]\nshould_not_trigger: [chat]\n');
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const agent: AgentApi = {
      runAgent: (_task, cwd) => Promise.resolve(transcript(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : [])),
      askJson: () => Promise.resolve({ selected: ['sample'] }),
    };
    const io = new ScriptedPrompter();
    const result = await run({ ref: 'sample', config: store, agent, k: 1, now: () => new Date('2026-09-07T12:34:56Z'), preflight: async () => success({ ccVersion: 'stub' }) }, io);
    expect(result).toMatchObject({ ok: true, value: { executionStatus: 'complete' } });
    if (!result.ok) return;
    expect(await readFile(join(result.value.runDir, 'run.jsonl'), 'utf8')).toContain('candidate-vs-baseline');
    expect(io.lines.join('\n')).toContain('verdict: PASS');
    expect(await readFile(join(clone, 'skills', 'sample', 'v1', 'SKILL.md'), 'utf8')).toBe(skill());
  });

  it('defaults to k=1 (rev 18): one rep per case per arm when --k is absent', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    let runs = 0;
    const agent: AgentApi = {
      runAgent: (_task, cwd) => { runs += 1; return Promise.resolve(transcript(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : [])); },
      askJson: () => Promise.resolve({ selected: ['sample'] }),
    };
    const result = await run({ ref: 'sample', noGen: true, config: store, agent, now: () => new Date('2026-09-07T12:34:56Z'), preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(runs).toBe(3); // 1 case x k=1 x (baseline, candidate, incumbent) — k=3 would be 9
    // run.jsonl's _meta carries expected_rows, not k (k reaches the receipt's provenance):
    // 1 case x k=1 x 2 opponents = 2 rows; the old k=3 default would write 6.
    const meta: unknown = JSON.parse((await readFile(join(result.value.runDir, 'run.jsonl'), 'utf8')).split('\n')[0]!);
    expect(meta).toMatchObject({ _meta: { expected_rows: 2 } });
  });


  it('generates missing kinds into the run tree and consumes those assets', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const prompts: string[] = []; const io = new ScriptedPrompter();
    const result = await run({ ref: 'sample', config: store, agent: generationAgent(prompts), k: 1, now: () => new Date('2026-09-07T12:34:56Z'), preflight: async () => success({ ccVersion: 'stub' }) }, io);
    expect(result).toMatchObject({ ok: true }); if (!result.ok) return;
    expect(prompts.filter((prompt) => prompt.includes('Generate '))).toHaveLength(2);
    expect(await readFile(join(result.value.runDir, 'generated', 'cases', 'happy-path.yaml'), 'utf8')).toContain('# generated by terum-skills eval-gen — review before trusting');
    expect(await readFile(join(result.value.runDir, 'run.jsonl'), 'utf8')).toContain('"generated_assets":{"cases":true,"triggers":true}');
    expect(io.lines.join('\n')).toContain('eval assets: cases: generated (3) · triggers: generated');
  });

  it('skips generation for authored assets and retains the prior report flow byte-for-byte', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/triggers.yaml', 'should_trigger: [deploy]\nshould_not_trigger: [chat]\n');
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const firstPrompts: string[] = []; const first = new ScriptedPrompter();
    const baseline = await run({ ref: 'sample', config: store, agent: generationAgent(firstPrompts), k: 1, now: () => new Date('2026-09-07T12:34:56Z'), preflight: async () => success({ ccVersion: 'stub' }) }, first);
    const secondPrompts: string[] = []; const second = new ScriptedPrompter();
    const oldFlow = await run({ ref: 'sample', noGen: true, config: store, agent: generationAgent(secondPrompts), k: 1, now: () => new Date('2026-09-07T12:34:57Z'), preflight: async () => success({ ccVersion: 'stub' }) }, second);
    expect(baseline).toMatchObject({ ok: true }); expect(oldFlow).toMatchObject({ ok: true });
    expect(firstPrompts.some((prompt) => prompt.includes('Generate '))).toBe(false);
    expect(first.lines).toEqual(second.lines);
  });

  it('generates only the missing kind', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const prompts: string[] = [];
    await expect(run({ ref: 'sample', config: store, agent: generationAgent(prompts), k: 1, preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true });
    expect(prompts.filter((prompt) => prompt.includes('Generate '))).toHaveLength(1);
    expect(prompts.find((prompt) => prompt.includes('Generate '))).toContain('Generate trigger evaluation');
  });

  it('--no-gen preserves the zero-asset empty report', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter(); const prompts: string[] = [];
    await expect(run({ ref: 'sample', noGen: true, config: store, agent: generationAgent(prompts), preflight: async () => success({ ccVersion: 'stub' }) }, io)).resolves.toMatchObject({ ok: true });
    expect(prompts).toEqual([]); expect(io.lines).toEqual(['verdict: NEUTRAL\nwhy: no execution comparisons ran']);
  });

  it('--gen leaves authored assets untouched while evaluating a local generated set', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const authoredCase = 'task: authored\nchecks:\n  - transcript_mentions: authored\n'; const authoredTriggers = 'should_trigger: [authored]\nshould_not_trigger: [chat]\n';
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/authored.yaml', authoredCase); await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/triggers.yaml', authoredTriggers);
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const authoredCasePath = join(clone, 'skills/sample/v1/evals/cases/authored.yaml'); const authoredCaseMtime = (await stat(authoredCasePath)).mtimeMs;
    const result = await run({ ref: 'sample', gen: true, config: store, agent: generationAgent([]), k: 1, preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true }); if (!result.ok) return;
    expect(await readFile(authoredCasePath, 'utf8')).toBe(authoredCase); expect((await stat(authoredCasePath)).mtimeMs).toBe(authoredCaseMtime);
    expect(await readFile(join(clone, 'skills/sample/v1/evals/triggers.yaml'), 'utf8')).toBe(authoredTriggers);
    expect(await readFile(join(result.value.runDir, 'generated/cases/happy-path.yaml'), 'utf8')).toContain('generated by terum-skills');
  });

  it('never prompts when all eval assets are authored', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/triggers.yaml', 'should_trigger: [deploy]\nshould_not_trigger: [chat]\n');
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter([], [], true);
    await expect(run({ ref: 'sample', config: store, agent: generationAgent([]), k: 1, preflight: async () => success({ ccVersion: 'stub' }) }, io)).resolves.toMatchObject({ ok: true });
    expect(io.asked).toEqual([]);
  });

  it('keeps --case with no authored case as an error and never generates it', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const prompts: string[] = [];
    await expect(run({ ref: 'sample', case: 'missing', config: store, agent: generationAgent(prompts), preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'No eval case named missing for sample.' });
    expect(prompts).toEqual([]);
  });

  it('refuses --gen with --case: a named case asserts an authored expectation (review P2)', async () => {
    const prompts: string[] = [];
    await expect(run({ ref: 'sample', gen: true, case: 'happy', agent: generationAgent(prompts) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('--gen cannot be combined with --case') });
    expect(prompts).toEqual([]);
  });
});

it.each([false, true])('size warning reaches eval preflight unless accompanied by an error (mixed: %s)', async (mixed) => {
  const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill('x'.repeat(20_001) + (mixed ? '\u202E' : '')));
  await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
  const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  let preflightCalls = 0; let agentCalls = 0;
  const agent: AgentApi = { runAgent: (_task, cwd) => { agentCalls++; return Promise.resolve(transcript(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : [])); }, askJson: () => { agentCalls++; return Promise.resolve({ selected: [] }); } };
  const io = new ScriptedPrompter();
  const result = await run({ ref: 'sample', noGen: true, config: store, agent, k: 1, preflight: async () => { preflightCalls++; return success({ ccVersion: 'stub' }); } }, io);
  expect(result.ok).toBe(!mixed); expect(preflightCalls).toBe(mixed ? 0 : 1);
  expect(io.lines[0]).toMatch(/^warning HYG6/);
  if (mixed) { expect(agentCalls).toBe(0); expect(result).toMatchObject({ error: expect.stringContaining('HYG2') }); }
  else { expect(agentCalls).toBeGreaterThan(0); expect(result).toMatchObject({ value: { executionStatus: 'complete' } }); }
});


describe('eval-in-app completion and eligibility', () => {
  async function setup(kind: 'cases' | 'triggers' | 'both') {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill());
    if (kind !== 'triggers') await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    if (kind !== 'cases') await pushFromSeed(fixture.seed, 'skills/sample/v1/evals/triggers.yaml', 'should_trigger: [deploy]\nshould_not_trigger: [chat]\n');
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update(c => { c.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    return store;
  }

  it('writes a schema-valid local receipt without --commit', async () => {
    const store = await setup('cases');
    const result = await run({ ref: 'sample', config: store, noGen: true, k: 1, agent: generationAgent([]), preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true });
    const receipt = receiptSchema.parse(JSON.parse(await readFile(join(result.value!.runDir, 'receipt.json'), 'utf8')));
    expect(receipt.provenance.runner_handle).toBe('seed');
  });
});
