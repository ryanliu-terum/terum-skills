import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore, type ConfigStore } from '../../lib/config.js';
import { type AgentApi, Transcript } from '../../lib/evals/agent.js';
import { success } from '../../lib/result.js';
import { bareTeam, cloneWithIdentity, holdCloneLock, pushFromSeed, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { skillContentDigest } from '../../lib/skills.js';
import { sourceFiles } from '../../lib/skill-source.js';
import { run } from '../eval.js';
import { run as publishRun } from '../publish.js';

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
const CASE = 'task: deploy\nchecks:\n  - transcript_mentions: deployed\n';
const TRIGGERS = 'should_trigger: [deploy now]\nshould_not_trigger: [chat]\n';
const armAgent: AgentApi = {
  runAgent: (_task, cwd) => Promise.resolve(transcript(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : [])),
  askJson: () => Promise.resolve({ selected: ['sample'] }),
};
const stub = async () => success({ ccVersion: 'stub' });

/**
 * §6.3: eval targets a folder in the LIBRARY. The clone is still built — it supplies the incumbent
 * arm and the hygiene license policy — but it is no longer where the evaluated bytes come from.
 */
async function evalFixture(options: { source?: string; assets?: Record<string, string>; incumbent?: boolean; team?: boolean } = {}) {
  const fixture = await bareTeam();
  const home = await temporaryDirectory();
  const folder = join(home, '.claude', 'skills', 'sample');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'SKILL.md'), options.source ?? skill());
  for (const [path, content] of Object.entries(options.assets ?? {})) {
    await mkdir(join(folder, path, '..'), { recursive: true });
    await writeFile(join(folder, path), content);
  }
  const store = createConfigStore(join(fixture.root, 'state'));
  if (options.incumbent) {
    // §6.5: an incumbent is a version folder carrying a receipt whose bytes differ from the candidate's.
    await pushFromSeed(fixture.seed, 'skills/sample/v1/SKILL.md', skill('# the published version\n'));
    await pushFromSeed(fixture.seed, `evals/${ID}/v1/20260101T000000Z.json`, '{}');
  }
  const clone = await cloneWithIdentity(fixture.bare, store.teamClone('team'));
  if (options.team !== false) await store.update((config) => { config.teams.team = { remote: fixture.bare, handle: 'seed' }; });
  return { fixture, store, clone, home, folder };
}
const args = (store: ConfigStore, home: string, extra: Record<string, unknown> = {}) => ({ ref: 'sample', config: store, home, preflight: stub, ...extra });

describe('eval (§6 / IE2)', () => {
  it('waits out a busy clone, says so, and then runs the eval', async () => {
    const { store, home } = await evalFixture({ assets: { 'evals/triggers.yaml': TRIGGERS, 'evals/cases/happy.yaml': CASE } });
    const release = await holdCloneLock(store.teamClone('team'));
    let released: Promise<void> | undefined;
    const releaseOnce = () => released ??= release();
    const timer = setTimeout(() => void releaseOnce(), 2_500);
    const io = new ScriptedPrompter([], [], true);
    try {
      const result = await run(args(store, home, { agent: armAgent, k: 1, lockWaitMs: 30_000 }), io);
      expect(result.ok).toBe(true);
      expect(io.lines.some(line => /^Waiting for another terum-skills operation on team to finish… \(\d+ s\)$/.test(line))).toBe(true);
    } finally { clearTimeout(timer); await releaseOnce(); }
  });

  it('refuses with the unchanged busy sentence when the wait is exhausted, before anything is paid for', async () => {
    const { store, home } = await evalFixture();
    let preflightCalls = 0, agentCalls = 0;
    const agent: AgentApi = { runAgent: async () => { agentCalls++; return transcript([]); }, askJson: async () => { agentCalls++; return { selected: [] }; } };
    const release = await holdCloneLock(store.teamClone('team'));
    try {
      const result = await run(args(store, home, { agent, lockWaitMs: 800, preflight: async () => { preflightCalls++; return success({ ccVersion: 'stub' }); } }), new ScriptedPrompter([], [], true));
      expect(result).toMatchObject({ ok: false, error: 'Another terum-skills operation holds the write lock on team; retry when it finishes.' });
      expect(preflightCalls).toBe(0); expect(agentCalls).toBe(0);
    } finally { await release(); }
  });

  it('keeps the non-interactive budget short', async () => {
    const { store, home } = await evalFixture();
    const release = await holdCloneLock(store.teamClone('team'));
    const io = new ScriptedPrompter(), started = Date.now();
    try {
      expect(await run({ ref: 'sample', config: store, home }, io)).toMatchObject({ ok: false, error: 'Another terum-skills operation holds the write lock on team; retry when it finishes.' });
      expect(Date.now() - started).toBeLessThan(8_000);
      expect(io.lines.some(line => line.startsWith('Waiting for another'))).toBe(false);
    } finally { await release(); }
  });

  it('hard-stops at hygiene before preflight or any agent process', async () => {
    const { store, home } = await evalFixture({ source: skill('bad‮text') });
    let preflightCalls = 0; let agentCalls = 0;
    const agent: AgentApi = { runAgent: () => { agentCalls++; return Promise.resolve(transcript([])); }, askJson: () => { agentCalls++; return Promise.resolve({ selected: [] }); } };
    const result = await run(args(store, home, { agent, preflight: async () => { preflightCalls++; return success({ ccVersion: 'stub' }); } }), new ScriptedPrompter());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('HYG2') });
    expect(preflightCalls).toBe(0); expect(agentCalls).toBe(0);
  });

  it('§6.3: reads the folder as it is on disk, so a folder that has never been published is evaluable', async () => {
    // No license, no metadata at all: HYG1 treats the four MANAGED fields as optional here, because
    // publish is what writes them and this folder has never been published.
    const { store, home } = await evalFixture({ source: `---\nname: sample\ndescription: checks deployments\n---\n`, assets: { 'evals/cases/happy.yaml': CASE } });
    expect(await run(args(store, home, { agent: armAgent, k: 1, noGen: true }), new ScriptedPrompter())).toMatchObject({ ok: true });
  });

  it('§6.3/D42: a folder belonging to no team is evaluable, single-arm, with a null team on the receipt', async () => {
    const { store, home, folder } = await evalFixture({ team: false, assets: { 'evals/cases/happy.yaml': CASE } });
    void folder;
    const io = new ScriptedPrompter();
    const result = await run(args(store, home, { agent: armAgent, k: 1, noGen: true }), io);
    expect(result).toMatchObject({ ok: true, value: { team: null, name: 'sample', shareHint: true } });
    if (!result.ok) return;
    const receipt = receiptSchema.parse(JSON.parse(await readFile(join(result.value.runDir, 'receipt.json'), 'utf8')));
    // §6.1: identity at run time is the content digest; the version is filled in by publish.
    expect(receipt.version).toBeNull();
    expect(receipt.content_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // §6.2: the store is keyed on the digest, which is what makes a teamless run storable at all.
    expect(result.value.runDir).toContain(join('evals', 'local', receipt.content_digest!.replace('sha256:', '')));
    // The team supplies only the incumbent arm: with no team there is none, so the run is single-arm.
    const meta: unknown = JSON.parse((await readFile(join(result.value.runDir, 'run.jsonl'), 'utf8')).split('\n')[0]!);
    expect(meta).toMatchObject({ _meta: { expected_rows: 1, team: null } });
  });

  it('§6.1: a folder with no metadata.id records skill_id null, and one that has an id records it', async () => {
    const anonymous = await evalFixture({ team: false, source: `---\nname: sample\ndescription: checks deployments\n---\n`, assets: { 'evals/cases/happy.yaml': CASE } });
    const first = await run(args(anonymous.store, anonymous.home, { agent: armAgent, k: 1, noGen: true }), new ScriptedPrompter());
    expect(first).toMatchObject({ ok: true, value: { id: null } });

    const declared = await evalFixture({ team: false, assets: { 'evals/cases/happy.yaml': CASE } });
    expect(await run(args(declared.store, declared.home, { agent: armAgent, k: 1, noGen: true }), new ScriptedPrompter())).toMatchObject({ ok: true, value: { id: ID } });
  });

  it('writes an inspectable local run tree for trigger plus two-arm execution without editing the clone', async () => {
    const { store, clone, home } = await evalFixture({ incumbent: true, assets: { 'evals/triggers.yaml': TRIGGERS, 'evals/cases/happy.yaml': CASE } });
    const io = new ScriptedPrompter();
    const result = await run(args(store, home, { agent: armAgent, k: 1, now: () => new Date('2026-09-07T12:34:56Z') }), io);
    expect(result).toMatchObject({ ok: true, value: { executionStatus: 'complete' } });
    if (!result.ok) return;
    expect(await readFile(join(result.value.runDir, 'run.jsonl'), 'utf8')).toContain('candidate-vs-baseline');
    expect(io.lines.join('\n')).toContain('verdict: PASS');
    expect(await readFile(join(clone, 'skills', 'sample', 'v1', 'SKILL.md'), 'utf8')).toBe(skill('# the published version\n'));
  });

  it('defaults to k=1 (rev 18): one rep per case per arm when --k is absent', async () => {
    const { store, home } = await evalFixture({ incumbent: true, assets: { 'evals/cases/happy.yaml': CASE } });
    let runs = 0;
    const agent: AgentApi = {
      runAgent: (_task, cwd) => { runs += 1; return Promise.resolve(transcript(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : [])); },
      askJson: () => Promise.resolve({ selected: ['sample'] }),
    };
    const result = await run(args(store, home, { noGen: true, agent, now: () => new Date('2026-09-07T12:34:56Z') }), new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(runs).toBe(3); // 1 case x k=1 x (baseline, candidate, incumbent) — k=3 would be 9
    const meta: unknown = JSON.parse((await readFile(join(result.value.runDir, 'run.jsonl'), 'utf8')).split('\n')[0]!);
    expect(meta).toMatchObject({ _meta: { expected_rows: 2 } });
  });

  it('§6.5: no receipted version in the clone means no incumbent, not a reach for an older tree', async () => {
    const { store, home } = await evalFixture({ assets: { 'evals/cases/happy.yaml': CASE } });
    let runs = 0;
    const agent: AgentApi = { runAgent: (task, cwd) => { runs += 1; return armAgent.runAgent(task, cwd); }, askJson: () => Promise.resolve({ selected: ['sample'] }) };
    const result = await run(args(store, home, { noGen: true, agent, k: 1 }), new ScriptedPrompter());
    if(!result.ok) throw new Error(result.error);
    expect(runs).toBe(2); // baseline + candidate only
  });

  it('§6.3/D9: generation writes the missing assets back into the LOCAL folder, announced before it writes', async () => {
    const { store, home, folder } = await evalFixture();
    const prompts: string[] = []; const io = new ScriptedPrompter();
    const result = await run(args(store, home, { agent: generationAgent(prompts), k: 1, now: () => new Date('2026-09-07T12:34:56Z') }), io);
    expect(result).toMatchObject({ ok: true }); if (!result.ok) return;
    expect(prompts.filter((prompt) => prompt.includes('Generate '))).toHaveLength(2);
    expect(await readFile(join(result.value.runDir, 'generated', 'cases', 'happy-path.yaml'), 'utf8')).toContain('# generated by terum-skills eval-gen — review before trusting');
    expect(await readFile(join(result.value.runDir, 'run.jsonl'), 'utf8')).toContain('"generated_assets":{"cases":true,"triggers":true}');
    // D29 deleted `--gen`, so the user never asked for this: the printed line naming the path and
    // the consequence is the only signal they get, and it must come BEFORE the write.
    const announcement = io.lines.find((line) => line.startsWith('Writing generated '));
    expect(announcement).toContain(folder);
    expect(announcement).toContain('the next publish mints a new version and the current local eval score blanks');
    expect(announcement).toContain('delete evals/cases/');
    expect(io.lines.indexOf(announcement!)).toBeLessThan(io.lines.findIndex((line) => line.startsWith('eval assets:')));
    expect(await readFile(join(folder, 'evals', 'cases', 'happy-path.yaml'), 'utf8')).toContain('generated by terum-skills');
    expect(await readFile(join(folder, 'evals', 'triggers.yaml'), 'utf8')).toContain('should_trigger');
  });

  it('§6.1/D9: a generating run stays attachable — the receipt digests the folder as the run LEFT it', async () => {
    // The defect: the run was keyed on the digest taken BEFORE the write-back, while `evals/` is
    // inside `skillContentDigest` by D9 — so every generating run named a folder state that no
    // longer existed anywhere on disk, and publish could never resolve it to a version. No
    // generating run was attachable, paid `--drain` runs included.
    const { store, home, folder } = await evalFixture();
    await store.update((config) => { config.display_name = 'Seed'; config.email = 'seed@example.com'; });
    const result = await run(args(store, home, { agent: generationAgent([]), k: 1 }), new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true }); if (!result.ok) return;
    // The oracle is the folder itself — the same one publish reads, through the same function.
    const onDisk = skillContentDigest((await sourceFiles(folder)).files);
    const receipt = receiptSchema.parse(JSON.parse(await readFile(join(result.value.runDir, 'receipt.json'), 'utf8')));
    expect(receipt.content_digest).toBe(onDisk);
    expect(result.value.runDir).toContain(join('evals', 'local', onDisk.replace(/^sha256:/, '')));
    // …and the consequence the digest exists for: §5.1 resolves it and attaches the run to v1.
    const published = await publishRun({ ref: 'sample', home, config: store }, new ScriptedPrompter([], [false]));
    expect(published).toMatchObject({ ok: true, value: { version: 'v1', attachedEvals: 1 } });
  });

  it('D29: authored assets are never regenerated and never overwritten — per asset', async () => {
    const authoredCase = 'task: authored\nchecks:\n  - transcript_mentions: authored\n';
    const { store, home, folder } = await evalFixture({ assets: { 'evals/cases/authored.yaml': authoredCase } });
    const mtime = (await stat(join(folder, 'evals', 'cases', 'authored.yaml'))).mtimeMs;
    const prompts: string[] = [];
    expect(await run(args(store, home, { agent: generationAgent(prompts), k: 1 }), new ScriptedPrompter())).toMatchObject({ ok: true });
    // Cases are there, triggers are not: exactly one generation, and the authored file is untouched.
    expect(prompts.filter((prompt) => prompt.includes('Generate '))).toHaveLength(1);
    expect(prompts.find((prompt) => prompt.includes('Generate '))).toContain('Generate trigger evaluation');
    expect(await readFile(join(folder, 'evals', 'cases', 'authored.yaml'), 'utf8')).toBe(authoredCase);
    expect((await stat(join(folder, 'evals', 'cases', 'authored.yaml'))).mtimeMs).toBe(mtime);
    expect(existsSync(join(folder, 'evals', 'triggers.yaml'))).toBe(true);
  });

  it('skips generation entirely for a folder holding both kinds, and never prompts', async () => {
    const { store, home } = await evalFixture({ assets: { 'evals/cases/happy.yaml': CASE, 'evals/triggers.yaml': TRIGGERS } });
    const prompts: string[] = []; const io = new ScriptedPrompter([], [], true);
    expect(await run(args(store, home, { agent: generationAgent(prompts), k: 1 }), io)).toMatchObject({ ok: true });
    expect(prompts.some((prompt) => prompt.includes('Generate '))).toBe(false);
    expect(io.asked).toEqual([]);
    expect(io.lines.some((line) => line.startsWith('Writing generated '))).toBe(false);
  });

  it('--no-gen preserves the zero-asset empty report and writes nothing into the folder', async () => {
    const { store, home, folder } = await evalFixture();
    const io = new ScriptedPrompter(); const prompts: string[] = [];
    expect(await run(args(store, home, { noGen: true, agent: generationAgent(prompts) }), io)).toMatchObject({ ok: true });
    expect(prompts).toEqual([]);
    expect(io.lines).toEqual(['verdict: NEUTRAL\nwhy: no execution comparisons ran']);
    expect(existsSync(join(folder, 'evals'))).toBe(false);
  });

  it('keeps --case with no authored case as an error and never generates it', async () => {
    const { store, home } = await evalFixture();
    const prompts: string[] = [];
    expect(await run(args(store, home, { case: 'missing', agent: generationAgent(prompts) }), new ScriptedPrompter())).toMatchObject({ ok: false, error: 'No eval case named missing for sample.' });
    expect(prompts).toEqual([]);
  });

  it('names the Library, not the team, when the ref resolves to no local folder', async () => {
    const { store, home } = await evalFixture();
    expect(await run(args(store, home, { ref: 'ghost' }), new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('No local skill folder named `ghost` in your library') });
  });
});

it.each([false, true])('size warning reaches eval preflight unless accompanied by an error (mixed: %s)', async (mixed) => {
  const { store, home } = await evalFixture({ source: skill('x'.repeat(20_001) + (mixed ? '‮' : '')), assets: { 'evals/cases/happy.yaml': CASE } });
  let preflightCalls = 0; let agentCalls = 0;
  const agent: AgentApi = { runAgent: (_task, cwd) => { agentCalls++; return Promise.resolve(transcript(existsSync(join(cwd, '.claude', 'skills', 'sample')) ? ['sample'] : [])); }, askJson: () => { agentCalls++; return Promise.resolve({ selected: [] }); } };
  const io = new ScriptedPrompter();
  const result = await run(args(store, home, { noGen: true, agent, k: 1, preflight: async () => { preflightCalls++; return success({ ccVersion: 'stub' }); } }), io);
  expect(result.ok).toBe(!mixed); expect(preflightCalls).toBe(mixed ? 0 : 1);
  expect(io.lines[0]).toMatch(/^warning HYG6/);
  if (mixed) { expect(agentCalls).toBe(0); expect(result).toMatchObject({ error: expect.stringContaining('HYG2') }); }
  else { expect(agentCalls).toBeGreaterThan(0); expect(result).toMatchObject({ value: { executionStatus: 'complete' } }); }
});

describe('eval-in-app completion and eligibility', () => {
  it('writes a schema-valid local receipt — a local eval never commits (§6.3)', async () => {
    const { store, home, clone } = await evalFixture({ assets: { 'evals/cases/happy.yaml': CASE } });
    const before = await readFile(join(clone, 'team.json'), 'utf8');
    const result = await run(args(store, home, { noGen: true, k: 1, agent: generationAgent([]) }), new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true });
    const receipt = receiptSchema.parse(JSON.parse(await readFile(join(result.value!.runDir, 'receipt.json'), 'utf8')));
    expect(receipt.provenance.runner_handle).toBe('seed');
    expect(receipt.schema_version).toBe(2);
    expect(await readFile(join(clone, 'team.json'), 'utf8')).toBe(before);
  });
});
