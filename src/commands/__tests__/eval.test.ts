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
    await expect(run({ ref: 'sample', working: true, config: store }, new ScriptedPrompter())).resolves.toMatchObject({ ok: false, error: 'sample is not a connected local source for team team; --working is unavailable.' });
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

it.each([false, true])('size warning reaches eval preflight unless accompanied by an error (mixed: %s)', async (mixed) => {
  const fixture = await bareTeam(); await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('x'.repeat(20_001) + (mixed ? '\u202E' : '')));
  await pushFromSeed(fixture.seed, 'skills/sample/evals/cases/happy.yaml', 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n');
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

describe('eval --vs head-to-head (IE6)', () => {
  const RIVAL_ID = '22222222-2222-4222-8222-222222222222';
  const rivalSkill = (name: string) => `---\nname: ${name}\ndescription: also checks deployments\nlicense: UNLICENSED\nmetadata:\n  id: ${RIVAL_ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nprefer a dry run first`;

  const briefCases = { cases: ['one', 'two', 'three', 'four', 'five'].map((stem, index) => ({
    name: `case-${stem}`,
    task: `Prepare release step ${index + 1}.`,
    checks: [{ transcript_mentions: 'deployed' }],
    judge: 'A better answer states what will change before changing it. It names the rollback path.',
    bucket: index === 4 ? 'adversarial' : 'explicit',
  })) };

  /** Two skills in one team, both staged by name so the arms are distinguishable. */
  const twoSkillFixture = async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('deploy carefully'));
    await pushFromSeed(fixture.seed, 'skills/rival-checker/SKILL.md', rivalSkill('rival-checker'));
    const store = createConfigStore(join(fixture.root, 'state'));
    await cloneWithIdentity(fixture.bare, store.teamClone('team'));
    await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
    return store;
  };

  const headToHeadAgent = (prompts: string[], brief = 'Take a change that is ready and get it live without surprising anyone.'): AgentApi => ({
    runAgent: async (_task, cwd) => {
      const staged = ['sample', 'rival-checker'].find((name) => existsSync(join(cwd, '.claude', 'skills', name)));
      return transcript(staged === undefined ? [] : [staged]);
    },
    askJson: async (prompt) => {
      prompts.push(prompt);
      if (prompt.includes('Describe THE JOB')) return { brief };
      if (prompt.includes('Generate exactly five')) return briefCases;
      return { selected: ['sample'] };
    },
  });

  const noAgent = (counter: { calls: number }): AgentApi => ({
    runAgent: () => { counter.calls++; return Promise.resolve(transcript([])); },
    askJson: () => { counter.calls++; return Promise.resolve({}); },
  });

  it.each([
    ['--commit', { commit: true }, 'never committed'],
    ['--case', { case: 'happy-path' }, 'authored assertion'],
    ['--no-gen', { noGen: true }, 'generated from the shared brief'],
    ['--save', { save: true, working: true }, 'neither skill'],
    ['--triggers-only', { triggersOnly: true }, 'execution only'],
  ])('refuses --vs with %s before any agent call', async (_label, extra, fragment) => {
    const store = await twoSkillFixture();
    const counter = { calls: 0 };
    const result = await run({ ref: 'sample', vs: 'rival-checker', config: store, preflight: async () => success({ ccVersion: 'stub' }), agent: noAgent(counter), ...extra }, new ScriptedPrompter([], [], true));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(fragment) });
    expect(counter.calls).toBe(0);
  });

  it('refuses a rival that resolves to the same skill, and one outside the team', async () => {
    const store = await twoSkillFixture();
    const counter = { calls: 0 };
    expect(await run({ ref: 'sample', vs: 'sample', config: store, preflight: async () => success({ ccVersion: 'stub' }), agent: noAgent(counter) }, new ScriptedPrompter([], [], true)))
      .toMatchObject({ ok: false, error: expect.stringContaining('two different skills') });
    expect(await run({ ref: 'sample', vs: 'not-a-skill', config: store, preflight: async () => success({ ccVersion: 'stub' }), agent: noAgent(counter) }, new ScriptedPrompter([], [], true)))
      .toMatchObject({ ok: false, error: expect.stringContaining('No skill named or identified by not-a-skill') });
    expect(counter.calls).toBe(0);
  });

  it('refuses a non-interactive channel by naming --brief, not by throwing PromptClosedError', async () => {
    const store = await twoSkillFixture();
    const counter = { calls: 0 };
    const result = await run({ ref: 'sample', vs: 'rival-checker', config: store, preflight: async () => success({ ccVersion: 'stub' }), agent: noAgent(counter) }, new ScriptedPrompter([], [], false));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('--brief <path>') });
    expect(result).not.toMatchObject({ error: expect.stringContaining('interactive terminal') });
    expect(counter.calls).toBe(0);
  });

  it('derives a brief, gates on the confirm, and reports three arms with no verdict and no receipt', async () => {
    const store = await twoSkillFixture();
    const prompts: string[] = [];
    const io = new ScriptedPrompter([], [true], true);
    const result = await run({ ref: 'sample', vs: 'rival-checker', k: 1, config: store, preflight: async () => success({ ccVersion: 'stub' }), agent: headToHeadAgent(prompts) }, io);
    expect(result).toMatchObject({ ok: true, value: { rival: { name: 'rival-checker', id: RIVAL_ID } } });
    if (!result.ok) return;

    expect(io.askedAbout('Use this brief?')).toBe(true);
    expect(existsSync(join(result.value.runDir, 'brief.md'))).toBe(true);

    // §3.2: the case prompt sees the brief alone — neither SKILL.md reaches it.
    const casePrompt = prompts.find((prompt) => prompt.includes('Generate exactly five'))!;
    expect(casePrompt).toContain('TASK BRIEF');
    expect(casePrompt).not.toContain('deploy carefully');
    expect(casePrompt).not.toContain('prefer a dry run first');

    const report = io.lines.join('\n');
    expect(report).toContain('head-to-head: sample vs rival-checker — 5 cases · k=1');
    expect(report).toContain('scored: 10/10 rows');
    expect(report).toMatch(/candidate-vs-rival: .*sign test p=/);
    expect(report).not.toMatch(/^verdict:/m);
    expect(report).not.toMatch(/net lift/);
    expect(report).toContain('not a ranking');
    expect(result.value.receiptPath).toBeUndefined();
  });

  it('a declined brief stops the run and points at --brief with the path', async () => {
    const store = await twoSkillFixture();
    const io = new ScriptedPrompter([], [false], true);
    const result = await run({ ref: 'sample', vs: 'rival-checker', k: 1, config: store, preflight: async () => success({ ccVersion: 'stub' }), agent: headToHeadAgent([]) }, io);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/re-run with --brief .*brief\.md/) });
  });

  it('checks a supplied brief instead of trusting it, on a channel with no human', async () => {
    const store = await twoSkillFixture();
    const dir = join(store.root, 'briefs');
    await mkdir(dir, { recursive: true });
    const named = join(dir, 'named.md');
    await writeFile(named, 'Use rival-checker to get the change live.', 'utf8');
    const counter = { calls: 0 };
    // §1.2: the deterministic checks run before ANY agent call — preflight is itself a
    // one-turn agent task (§7.4), so a brief that names a skill must not cost one.
    let preflights = 0;
    expect(await run({ ref: 'sample', vs: 'rival-checker', brief: named, config: store, preflight: async () => { preflights++; return success({ ccVersion: 'stub' }); }, agent: noAgent(counter) }, new ScriptedPrompter([], [], false)))
      .toMatchObject({ ok: false, error: expect.stringContaining("names 'rival-checker'") });
    expect(counter.calls).toBe(0);
    expect(preflights).toBe(0);

    const fair = join(dir, 'fair.md');
    await writeFile(fair, 'Take a change that is ready and get it live without surprising anyone.', 'utf8');
    const io = new ScriptedPrompter([], [], false);
    const result = await run({ ref: 'sample', vs: 'rival-checker', brief: fair, k: 1, config: store, preflight: async () => success({ ccVersion: 'stub' }), agent: headToHeadAgent([]) }, io);
    expect(result).toMatchObject({ ok: true });
    expect(io.askedAbout('Use this brief?')).toBe(false); // supplied briefs skip the gate, not the checks
    expect(io.lines.join('\n')).toContain('(supplied)');
  });
});
