import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependencyPlan, scanHeavySkill } from '../dependencies.js';
import { seedSandbox, type EvalCase } from '../execution.js';

const evalCase: EvalCase = { name: 'c', task: 'work', files: {}, checks: [], requires: [] };

describe('heavy and dependency scans (§5 / §6.1)', () => {
  it('detects a Workflow tool, observes a frontmatter override, and plans named repository paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dependency-'));
    const skill = join(root, '.claude', 'skills', 'sample');
    await mkdir(join(skill, 'node_modules', 'ignored'), { recursive: true });
    await mkdir(join(root, '.claude', 'workflows'), { recursive: true });
    await writeFile(join(root, '.git'), 'gitdir: nowhere');
    await writeFile(join(root, '.claude', 'workflows', 'engine.js'), 'export const engine = true;');
    await writeFile(join(root, '.claude', 'workflows', 'helper.js'), 'export const helper = true;');
    await writeFile(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nUse the Workflow tool on .claude/workflows/engine.js and missing/path.txt');
    expect(await scanHeavySkill(skill)).toMatchObject({ heavy: true, evidence: 'SKILL.md names the Workflow tool and .claude/workflows/engine.js' });
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/workflows/engine.js'], missing: ['missing/path.txt'] });
    expect(await scanHeavySkill(skill, 'staged/first.js')).toMatchObject({ heavy: true, evidence: 'SKILL.md names the Workflow tool and staged/first.js' });
    const baseline = await seedSandbox(evalCase, { caseDir: root, skillName: 'sample', skillDir: null, scratch: root, dependencies: plan });
    const candidate = await seedSandbox(evalCase, { caseDir: root, skillName: 'sample', skillDir: skill, scratch: root, dependencies: plan });
    expect(existsSync(join(baseline, '.claude', 'workflows', 'engine.js'))).toBe(false);
    expect(existsSync(join(candidate, '.claude', 'workflows', 'engine.js'))).toBe(true);
    expect(existsSync(join(candidate, '.claude', 'workflows', 'helper.js'))).toBe(true);
  });

  it('reports a missing path only when it is shaped like a file or dot-directory, never prose ratios or URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dependency-prose-'));
    const skill = join(root, 'skill');
    await mkdir(skill, { recursive: true });
    await writeFile(join(root, '.git'), 'gitdir: nowhere');
    await writeFile(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nAn A/B test at 40 tok/s per openai/codex; see https://github.com/openai/codex/issues/1 and .claude/workflows/gone.js plus scripts/run.sh');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], missing: ['.claude/workflows/gone.js', 'scripts/run.sh'] });
  });

  it('lets metadata.eval.heavy false override a positive scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heavy-'));
    await writeFile(join(root, 'SKILL.md'), '---\nname: sample\ndescription: useful\nmetadata:\n  eval:\n    heavy: false\n---\nUse the Workflow tool.');
    await expect(scanHeavySkill(root)).resolves.toMatchObject({ heavy: false, evidence: 'SKILL.md metadata.eval.heavy is false' });
  });

  it('does not stage a dependency that would exceed the 20 MB cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dependency-cap-'));
    const skill = join(root, 'skill');
    await mkdir(join(root, 'large'), { recursive: true });
    await mkdir(skill, { recursive: true });
    await writeFile(join(root, '.git'), 'gitdir: nowhere');
    await writeFile(join(root, 'large', 'asset.bin'), Buffer.alloc(21 * 1024 * 1024));
    await writeFile(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nlarge/asset.bin');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], skipped: [{ path: 'large/asset.bin', bytes: 21 * 1024 * 1024 }] });
  });
});
