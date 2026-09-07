import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
    const result = await run({ ref: 'sample', commit: true, noGen: true, config: store, agent, k: 1, now: () => new Date('2026-09-07T12:34:56Z'), preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter());
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

  it('generates missing kinds into the run tree and consumes those assets', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
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
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/evals/triggers.yaml', 'should_trigger: [deploy]\nshould_not_trigger: [chat]\n');
    await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
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
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const prompts: string[] = [];
    await expect(run({ ref: 'sample', config: store, agent: generationAgent(prompts), k: 1, preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true });
    expect(prompts.filter((prompt) => prompt.includes('Generate '))).toHaveLength(1);
    expect(prompts.find((prompt) => prompt.includes('Generate '))).toContain('Generate trigger evaluation');
  });

  it('--no-gen preserves the zero-asset empty report', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const io = new ScriptedPrompter(); const prompts: string[] = [];
    await expect(run({ ref: 'sample', noGen: true, config: store, agent: generationAgent(prompts), preflight: async () => success({ ccVersion: 'stub' }) }, io)).resolves.toMatchObject({ ok: true });
    expect(prompts).toEqual([]); expect(io.lines).toEqual(['verdict: NEUTRAL\nwhy: no execution comparisons ran']);
  });

  it('--gen leaves authored assets untouched while evaluating a local generated set', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    const authoredCase = 'task: authored\nchecks:\n  - transcript_mentions: authored\n'; const authoredTriggers = 'should_trigger: [authored]\nshould_not_trigger: [chat]\n';
    await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/authored.yaml', authoredCase); await pushFromSeed(fixture.seed, 'skills/sample/evals/triggers.yaml', authoredTriggers);
    const store = createConfigStore(join(fixture.root, 'state')); const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    const authoredCasePath = join(clone, 'skills/sample/evals/cases/authored.yaml'); const authoredCaseMtime = (await stat(authoredCasePath)).mtimeMs;
    const result = await run({ ref: 'sample', gen: true, config: store, agent: generationAgent([]), k: 1, preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true }); if (!result.ok) return;
    expect(await readFile(authoredCasePath, 'utf8')).toBe(authoredCase); expect((await stat(authoredCasePath)).mtimeMs).toBe(authoredCaseMtime);
    expect(await readFile(join(clone, 'skills/sample/evals/triggers.yaml'), 'utf8')).toBe(authoredTriggers);
    expect(await readFile(join(result.value.runDir, 'generated/cases/happy-path.yaml'), 'utf8')).toContain('generated by terum-skills');
  });

  it('refuses --commit before receipt construction when any generated asset was used', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    await expect(run({ ref: 'sample', commit: true, config: store, agent: generationAgent([]), preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('--commit is refused for generated eval assets') });
  });

  it('requires --working for --save', async () => {
    await expect(run({ ref: 'sample', save: true }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('--save is only available with --working') });
  });

  it('saves validated generated assets only into the registered working source and refuses existing targets per kind', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
    const source = join(fixture.root, 'source'); await mkdir(source); await writeFile(join(source, 'SKILL.md'), skill());
    const store = createConfigStore(join(fixture.root, 'state')); await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; config.shared[ID] = { source, team: 'team' }; });
    await expect(run({ ref: 'sample', working: true, save: true, config: store, agent: generationAgent([]), k: 1, preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: true });
    expect(await readFile(join(source, 'evals/cases/happy-path.yaml'), 'utf8')).toContain('# generated by terum-skills eval-gen — review before trusting');
    const triggerSource = join(fixture.root, 'trigger-source'); await mkdir(join(triggerSource, 'evals'), { recursive: true }); await writeFile(join(triggerSource, 'SKILL.md'), skill()); await writeFile(join(triggerSource, 'evals/triggers.yaml'), 'should_trigger: [authored]\n');
    await store.update((config) => { config.shared[ID]!.source = triggerSource; });
    await expect(run({ ref: 'sample', working: true, save: true, gen: true, triggersOnly: true, config: store, agent: generationAgent([]), preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('triggers.yaml already exists') });
    expect(await readFile(join(triggerSource, 'evals/triggers.yaml'), 'utf8')).toBe('should_trigger: [authored]\n');
    const caseSource = join(fixture.root, 'case-source'); await mkdir(join(caseSource, 'evals/cases'), { recursive: true }); await writeFile(join(caseSource, 'SKILL.md'), skill()); await writeFile(join(caseSource, 'evals/cases/authored.yaml'), 'task: authored\n');
    await store.update((config) => { config.shared[ID]!.source = caseSource; });
    await expect(run({ ref: 'sample', working: true, save: true, gen: true, executionOnly: true, config: store, agent: generationAgent([]), preflight: async () => success({ ccVersion: 'stub' }) }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('cases already exists') });
    expect(await readFile(join(caseSource, 'evals/cases/authored.yaml'), 'utf8')).toBe('task: authored\n');
  });

  it('keeps --case with no authored case as an error and never generates it', async () => {
    const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill());
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
