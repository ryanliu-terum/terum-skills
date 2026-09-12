import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bareTeam, cloneWithIdentity, git, pushFromSeed, ScriptedPrompter, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { run } from '../readme.js';

const ID = '44444444-4444-4444-8444-444444444444';
const SKILL = `---\nname: report\ndescription: Report writing\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: docs\n---\n`;
const receipt = (version: string, runId: string, verdict: 'PASS' | 'NEUTRAL' | 'FAIL', status: Record<string, unknown> = {}) => JSON.stringify({
  schema_version: 1, skill_id: ID, skill_name: 'report', version, run_id: runId, verdict,
  attribution: 'test receipt', execution_status: 'complete', expected_rows: 0, scored_rows: 0, ...status,
  comparisons: {}, arm_scores: {}, triggers: null, efficiency: {},
  provenance: { engine_version: '0.1.0', engine_commit: 'unknown', cc_version: 'test', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: [], arm_skill_lists: {}, timestamp: '2026-09-07T00:00:00Z', runner_handle: 'seed' },
}, null, 2) + '\n';

describe('hidden readme verb — the Action entry point (§9)', () => {
  it('creates a missing README.md from the generated region', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    expect(await run({ cwd: clone }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: true } });
    expect(await readFile(join(clone, 'README.md'), 'utf8')).toContain('<!-- terum-skills:begin -->');
  });

  it('regenerates README.md in the current clone, is idempotent, and renders the publish preview against a base ref', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/report/v1/SKILL.md', SKILL);
    await pushFromSeed(fixture.seed, 'README.md', '# team skills\n\n<!-- terum-skills:begin -->\n<!-- terum-skills:end -->\n');
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const io = new ScriptedPrompter();
    expect(await run({ cwd: clone }, io)).toMatchObject({ ok: true, value: { changed: true } });
    const readme = await readFile(join(clone, 'README.md'), 'utf8');
    expect(readme).toMatch(/^# team skills\n/);
    expect(readme).toMatch(/\| report \| docs \| Report writing \| 0 \| — \| [0-9a-f]{8} \| — \|/);
    expect(await run({ cwd: clone }, io)).toMatchObject({ ok: true, value: { changed: false } });
    await writeFile(join(clone, 'team.json'), `${JSON.stringify({ ...TEAM_JSON, projects: { Global: { remotes: [], skills: [ID] } } }, null, 2)}\n`);
    expect(await run({ cwd: clone, prComment: 'origin/main' }, io)).toMatchObject({ ok: true });
    expect(io.lines.join('\n')).toContain('<!-- terum-skills:pr-comment -->');
    expect(io.lines.join('\n')).toContain('- report (docs)');
  });

  it('uses the lexicographically newest receipt for the current skill tree in the eval column', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/report/v1/SKILL.md', SKILL);
    const version = (await git(['rev-parse', 'HEAD:skills/report/v1'], fixture.seed)).trim();
    await pushFromSeed(fixture.seed, `evals/${ID}/${version}/20260907T010000Z.json`, receipt(version, '20260907T010000Z', 'PASS'));
    await pushFromSeed(fixture.seed, `evals/${ID}/${version}/20260907T020000Z.json`, receipt(version, '20260907T020000Z', 'FAIL'));
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    expect(await run({ cwd: clone }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: true } });
    expect(await readFile(join(clone, 'README.md'), 'utf8')).toContain(`| report | docs | Report writing | 0 | — | ${version.slice(0, 8)} | FAIL |`);
  });

  it('never promotes a partial receipt to a full verdict (§5.4)', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/report/v1/SKILL.md', SKILL);
    const version = (await git(['rev-parse', 'HEAD:skills/report/v1'], fixture.seed)).trim();
    await pushFromSeed(fixture.seed, `evals/${ID}/${version}/20260907T010000Z.json`, receipt(version, '20260907T010000Z', 'PASS', { execution_status: 'partial', expected_rows: 9, scored_rows: 7 }));
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    expect(await run({ cwd: clone }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: true } });
    expect(await readFile(join(clone, 'README.md'), 'utf8')).toContain(`| ${version.slice(0, 8)} | PASS — partial (7/9 scored) |`);
  });

  it('the PR comment cannot carry a link whose label lies either (R14)', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/report/v1/SKILL.md', SKILL.replace('terum-category: docs', "terum-category: 'docs [Install v2](https://evil.example)'"));
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    await writeFile(join(clone, 'team.json'), `${JSON.stringify({ ...TEAM_JSON, projects: { Global: { remotes: [], skills: [ID] } } }, null, 2)}\n`);
    const io = new ScriptedPrompter();
    expect(await run({ cwd: clone, prComment: 'origin/main' }, io)).toMatchObject({ ok: true });
    const comment = io.lines.join('\n');
    expect(comment).toContain('- report (docs \\[Install v2\\](https://evil.example))');
    expect(comment).not.toMatch(/[^\\]\]\(https:\/\/evil\.example/);
  });

  it('neutralizes a skill field that spells the PR-comment anchor, so a poisoned PR cannot aim the Action at a comment of its own', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/report/v1/SKILL.md', SKILL.replace('terum-category: docs', "terum-category: 'docs <!-- terum-skills:pr-comment -->'"));
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    await writeFile(join(clone, 'team.json'), `${JSON.stringify({ ...TEAM_JSON, projects: { Global: { remotes: [], skills: [ID] } } }, null, 2)}\n`);
    const io = new ScriptedPrompter();
    expect(await run({ cwd: clone, prComment: 'origin/main' }, io)).toMatchObject({ ok: true });
    const comment = io.lines.join('\n');
    expect(comment.split('<!-- terum-skills:pr-comment -->')).toHaveLength(2);
    expect(comment).toContain('- report (docs &lt;!-- terum-skills:pr-comment -->)');
  });
});
