import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { type AgentApi, Transcript } from '../../lib/evals/agent.js';
import { success } from '../../lib/result.js';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { run } from '../eval.js';

const ID = '11111111-1111-4111-8111-111111111111';
const skill = (body = '') => `---\nname: sample\ndescription: checks deployments\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${body}`;
const transcript = (skills: string[]): Transcript => Transcript.fromStream(`${JSON.stringify({ type: 'system', subtype: 'init', skills })}\n${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: skills.length ? 'deployed' : 'nothing happened' }] } })}\n${JSON.stringify({ type: 'result', result: 'done' })}`);

describe('eval (§6 / IE2)', () => {
  it('hard-stops at hygiene before preflight or any agent process', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('bad\u202Etext'));
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
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/evals/triggers.yaml', 'should_trigger: [deploy now]\nshould_not_trigger: [chat]\n');
    await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
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
    expect(await readFile(join(clone, 'skills', 'sample', 'SKILL.md'), 'utf8')).toBe(skill());
  });

  it('refuses receipt commits and only permits --working for a registered source', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    await expect(run({ ref: 'sample', commit: true, config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('--commit') });
    await expect(run({ ref: 'sample', working: true, config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('--working') });
  });
});
