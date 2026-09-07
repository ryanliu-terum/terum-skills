import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { type AgentApi, Transcript } from '../../lib/evals/agent.js';
import { success } from '../../lib/result.js';
import { bareTeam, cloneWithIdentity, git, pushFromSeed, ScriptedPrompter } from '../../lib/__tests__/fixtures.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { run } from '../eval.js';

const ID = '11111111-1111-4111-8111-111111111111';
const skill = (body = '') => `---\nname: sample\ndescription: checks deployments\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${body}`;
const transcript = (skills: string[]): Transcript => Transcript.fromStream(`${JSON.stringify({ type: 'system', subtype: 'init', skills })}\n${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: skills.length ? 'deployed' : 'nothing happened' }] } })}\n${JSON.stringify({ type: 'result', result: 'done' })}`);
const transcriptWithText = (skills: string[], text: string): Transcript => Transcript.fromStream(`${JSON.stringify({ type: 'system', subtype: 'init', skills })}\n${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n${JSON.stringify({ type: 'result', result: 'done' })}`);

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

  it('commits one schema-valid, redacted receipt and no derived README for a generic team remote (VE4)', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const raw = `deployed ghp_${'z'.repeat(36)} -----BEGIN RSA PRIVATE KEY-----\nprivate\n-----END RSA PRIVATE KEY-----`;
    const agent: AgentApi = {
      runAgent: (_task, cwd) => Promise.resolve(transcriptWithText(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : [], raw)),
      askJson: () => Promise.resolve({ selected: [] }),
    };
    const result = await run({ ref: 'sample', commit: true, config: store, agent, k: 1, now: () => new Date('2026-09-07T12:34:56Z'), preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { receiptPath: expect.stringMatching(new RegExp(`^evals/${ID}/[0-9a-f]{40}/20260907T123456Z\\.json$`)) } });
    if (!result.ok || result.value.receiptPath === undefined) return;
    const committed = await readFile(join(clone, result.value.receiptPath), 'utf8');
    expect(receiptSchema.parse(JSON.parse(committed))).toMatchObject({ skill_id: ID, run_id: '20260907T123456Z' });
    expect(committed).not.toContain('ghp_');
    expect(committed).not.toContain('PRIVATE KEY');
    expect((await git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], clone)).trim()).toBe(result.value.receiptPath);
    expect(existsSync(join(clone, 'README.md'))).toBe(false);
  });

  it('refuses --working --commit and only permits --working for a registered source', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    await expect(run({ ref: 'sample', working: true, commit: true, config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('--working --commit') });
    await expect(run({ ref: 'sample', working: true, config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('--working') });
  });
});
