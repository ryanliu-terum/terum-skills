import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bareTeam, cloneWithIdentity, pushFromSeed, ScriptedPrompter, TEAM_JSON } from '../../lib/__tests__/fixtures.js';
import { run } from '../readme.js';

const ID = '44444444-4444-4444-8444-444444444444';
const SKILL = `---\nname: report\ndescription: Report writing\nlicense: UNLICENSED\nmetadata:\n  id: ${ID}\n  author: Seed <seed@example.com>\n  terum-category: docs\n---\n`;

describe('hidden readme verb — the Action entry point (§9)', () => {
  it('creates a missing README.md from the generated region', async () => {
    const fixture = await bareTeam();
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    expect(await run({ cwd: clone }, new ScriptedPrompter())).toMatchObject({ ok: true, value: { changed: true } });
    expect(await readFile(join(clone, 'README.md'), 'utf8')).toContain('<!-- terum-skills:begin -->');
  });

  it('regenerates README.md in the current clone, is idempotent, and renders the publish preview against a base ref', async () => {
    const fixture = await bareTeam();
    await pushFromSeed(fixture.seed, 'skills/report/SKILL.md', SKILL);
    await pushFromSeed(fixture.seed, 'README.md', '# team skills\n\n<!-- terum-skills:begin -->\n<!-- terum-skills:end -->\n');
    const clone = await cloneWithIdentity(fixture.bare, join(fixture.root, 'clone'));
    const io = new ScriptedPrompter();
    expect(await run({ cwd: clone }, io)).toMatchObject({ ok: true, value: { changed: true } });
    const readme = await readFile(join(clone, 'README.md'), 'utf8');
    expect(readme).toMatch(/^# team skills\n/);
    expect(readme).toContain('| report | docs | Report writing | 0 | — |');
    expect(await run({ cwd: clone }, io)).toMatchObject({ ok: true, value: { changed: false } });
    await writeFile(join(clone, 'team.json'), `${JSON.stringify({ ...TEAM_JSON, global: [ID] }, null, 2)}\n`);
    expect(await run({ cwd: clone, prComment: 'origin/main' }, io)).toMatchObject({ ok: true });
    expect(io.lines.join('\n')).toContain('<!-- terum-skills:pr-comment -->');
    expect(io.lines.join('\n')).toContain('- report (docs)');
  });
});
