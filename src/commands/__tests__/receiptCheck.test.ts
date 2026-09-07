import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bareTeam, cloneWithIdentity, git, pushFromSeed, ScriptedPrompter, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { run } from '../receiptCheck.js';

const ID = '55555555-5555-4555-8555-555555555555';
const skill = (body: string) => `---\nname: sample\ndescription: useful\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n${body}\n`;

function receipt(version: string, verdict: 'PASS' | 'NEUTRAL' | 'FAIL', incumbent: boolean): string {
  // §16.7: the gate bands the incumbent comparison's own counts; the top-level verdict is
  // baseline-derived and informational. The `verdict` param drives the incumbent counts here,
  // while the recorded verdict is deliberately decoupled (a regression can still say PASS).
  const counts = verdict === 'FAIL' ? { win: 0, loss: 3, tie: 0, net_lift: -1, sign_p: 1 } : { win: 1, loss: 0, tie: 0, net_lift: 1, sign_p: 1 };
  return `${JSON.stringify({
    schema_version: 1, skill_id: ID, skill_name: 'sample', version, run_id: '20260907T010000Z', verdict: verdict === 'FAIL' ? 'PASS' : verdict,
    attribution: 'test receipt', execution_status: 'complete', expected_rows: 1, scored_rows: 1,
    comparisons: incumbent ? { 'candidate-vs-incumbent': counts } : {},
    arm_scores: {}, triggers: null, efficiency: {},
    provenance: { engine_version: '0.1.3', engine_commit: 'unknown', cc_version: 'test', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-09-07T00:00:00Z', runner_handle: 'seed' },
  }, null, 2)}\n`;
}

async function commit(checkout: string, message: string): Promise<void> {
  await git(['add', '--all'], checkout); await git(['commit', '-q', '-m', message], checkout);
}

async function candidate(options: { baseSkill?: boolean; receipt?: { verdict: 'PASS' | 'NEUTRAL' | 'FAIL'; incumbent: boolean; version?: string }; stale?: boolean } = {}) {
  const fixture = await bareTeam();
  let baseVersion: string | undefined;
  if (options.baseSkill) {
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('base'));
    baseVersion = (await git(['rev-parse', 'HEAD:skills/sample'], fixture.seed)).trim();
  }
  const checkout = await cloneWithIdentity(fixture.bare, join(fixture.root, 'publish'));
  await git(['checkout', '-q', '-b', 'publish/sample-seed-12345678'], checkout);
  await mkdir(join(checkout, 'skills', 'sample'), { recursive: true });
  await writeFile(join(checkout, 'skills', 'sample', 'SKILL.md'), skill('candidate'));
  await writeFile(join(checkout, 'team.json'), `${JSON.stringify({ ...TEAM_JSON, global: [ID] }, null, 2)}\n`);
  await commit(checkout, 'endorse sample');
  const version = (await git(['rev-parse', 'HEAD:skills/sample'], checkout)).trim();
  if (options.receipt) {
    const receiptVersion = options.receipt.version ?? (options.stale ? baseVersion! : version);
    await mkdir(join(checkout, 'evals', ID, receiptVersion), { recursive: true });
    await writeFile(join(checkout, 'evals', ID, receiptVersion, '20260907T010000Z.json'), receipt(receiptVersion, options.receipt.verdict, options.receipt.incumbent));
    await commit(checkout, 'add receipt');
  }
  return { checkout, version, baseVersion };
}

describe('hidden receipt-check (§6.1 publish-PR predicate)', () => {
  it('passes a current, valid receipt with a non-FAIL incumbent comparison', async () => {
    const { checkout } = await candidate({ baseSkill: true, receipt: { verdict: 'PASS', incumbent: true } });
    const io = new ScriptedPrompter();
    expect(await run({ cwd: checkout, base: 'origin/main' }, io)).toMatchObject({ ok: true, value: { endorsed: [ID], checked: 1 } });
    expect(io.lines).toEqual([expect.stringContaining('sample: PASS')]);
  });

  it('blocks an incumbent comparison banding FAIL even when the baseline verdict says PASS (§16.7)', async () => {
    const { checkout } = await candidate({ baseSkill: true, receipt: { verdict: 'FAIL', incumbent: true } });
    expect(await run({ cwd: checkout, base: 'origin/main' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('bands FAIL') });
  });

  it('counts a cross-scope endorsement: a project skill newly added to global is an endorsement', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/sample/SKILL.md', skill('base'));
    // The BASE already endorses the skill in a project; a flattened diff would see nothing added.
    await pushFromSeed(fixture.seed, 'team.json', `${JSON.stringify({ ...TEAM_JSON, projects: { p: { remotes: [], skills: [ID] } } }, null, 2)}\n`);
    const checkout = await cloneWithIdentity(fixture.bare, join(fixture.root, 'publish'));
    await git(['checkout', '-q', '-b', 'publish/sample-seed-12345678'], checkout);
    await writeFile(join(checkout, 'team.json'), `${JSON.stringify({ ...TEAM_JSON, global: [ID], projects: { p: { remotes: [], skills: [ID] } } }, null, 2)}\n`);
    await commit(checkout, 'endorse sample globally');
    const result = await run({ cwd: checkout, base: 'origin/main' }, new ScriptedPrompter());
    // The endorsement is detected — the failure is about the missing receipt, never "no endorsement".
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('missing receipt') });
  });

  it('blocks a missing current receipt', async () => {
    const { checkout } = await candidate({ baseSkill: true });
    expect(await run({ cwd: checkout, base: 'origin/main' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('missing receipt') });
  });

  it('calls out a receipt at an older tree hash as stale', async () => {
    const { checkout } = await candidate({ baseSkill: true, stale: true, receipt: { verdict: 'PASS', incumbent: true } });
    expect(await run({ cwd: checkout, base: 'origin/main' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('stale receipt') });
  });

  it('allows a first publish with no incumbent comparison and no prior skill tree', async () => {
    const { checkout } = await candidate({ receipt: { verdict: 'PASS', incumbent: false } });
    expect(await run({ cwd: checkout, base: 'origin/main' }, new ScriptedPrompter())).toMatchObject({ ok: true });
  });

  it('blocks a no-incumbent receipt when the base already contains the skill', async () => {
    const { checkout } = await candidate({ baseSkill: true, receipt: { verdict: 'PASS', incumbent: false } });
    expect(await run({ cwd: checkout, base: 'origin/main' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('prior version exists') });
  });

  it('fails a publish branch that does not add any endorsement', async () => {
    const fixture = await bareTeam();
    const checkout = await cloneWithIdentity(fixture.bare, join(fixture.root, 'publish'));
    await git(['checkout', '-q', '-b', 'publish/noop-seed-12345678'], checkout);
    expect(await run({ cwd: checkout, base: 'origin/main' }, new ScriptedPrompter())).toMatchObject({ ok: false, error: expect.stringContaining('must endorse at least one skill') });
  });
});
