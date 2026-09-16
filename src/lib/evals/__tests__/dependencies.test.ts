import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependencyPlan, scanHeavySkill } from '../dependencies.js';
import { seedSandbox, type EvalCase } from '../execution.js';

const evalCase: EvalCase = { name: 'c', task: 'work', files: {}, checks: [], requires: [] };

async function put(path: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

/**
 * A repository shaped like the harness: `.git`, a `state` skill carrying its answer key
 * (`evals/`, `fixtures/`) and a top-level `run.sh`, a second skill, data and settings files, and a
 * workflow engine with a sibling helper.
 */
async function harnessRepo(body: string): Promise<{ root: string; skill: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dependency-harness-'));
  const skill = join(root, '.claude', 'skills', 'state');
  await mkdir(join(root, '.git', 'hooks'), { recursive: true });
  await put(join(root, '.git', 'hooks', 'pre-push.sh'), 'exit 0');
  await put(join(skill, 'SKILL.md'), `---\nname: state\ndescription: useful\n---\n${body}`);
  await put(join(skill, 'run.sh'), 'echo candidate');
  await put(join(skill, 'evals', 'cases.yaml'), 'answer: key');
  await put(join(skill, 'fixtures', 'expected.txt'), 'answer key');
  await put(join(root, '.claude', 'skills', 'other', 'SKILL.md'), '---\nname: other\ndescription: other\n---\nother');
  await put(join(root, '.claude', 'skills', 'other', 'tool.sh'), 'echo other');
  await put(join(root, '.claude', 'skills', 'other', 'evals', 'cases.yaml'), 'other: key');
  await put(join(root, '.claude', 'settings.json'), '{"hooks":{}}');
  await put(join(root, '.claude', 'handoff.md'), 'handoff notes');
  await put(join(root, '.claude', 'statusline.js'), 'export {};');
  await put(join(root, '.claude', 'workflows', 'engine.js'), 'export const engine = true;');
  await put(join(root, '.claude', 'workflows', 'helper.js'), 'export const helper = true;');
  await put(join(root, '.planning', 'specs', 'spec.md'), '# spec');
  await put(join(root, 'notes', 'data.md'), 'data');
  await put(join(root, 'build.sh'), 'echo build');
  return { root, skill };
}

const seed = (root: string, skillDir: string | null, plan: Awaited<ReturnType<typeof dependencyPlan>>, files: Record<string, string> = {}): Promise<string> =>
  seedSandbox({ ...evalCase, files }, { caseDir: root, skillName: 'state', skillDir, scratch: root, dependencies: plan });

describe('heavy and dependency scans (§5 / §6.1)', () => {
  it('detects a Workflow tool, observes a frontmatter override, and plans named repository scripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dependency-'));
    const skill = join(root, '.claude', 'skills', 'sample');
    await mkdir(join(skill, 'node_modules', 'ignored'), { recursive: true });
    await mkdir(join(root, '.claude', 'workflows'), { recursive: true });
    await writeFile(join(root, '.git'), 'gitdir: nowhere');
    await writeFile(join(root, '.claude', 'workflows', 'engine.js'), 'export const engine = true;');
    await writeFile(join(root, '.claude', 'workflows', 'helper.js'), 'export const helper = true;');
    await writeFile(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nUse the Workflow tool on .claude/workflows/engine.js and missing/path.py');
    expect(await scanHeavySkill(skill)).toMatchObject({ heavy: true, evidence: 'SKILL.md names the Workflow tool' });
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/workflows/engine.js'], missing: ['missing/path.py'] });
    expect(await scanHeavySkill(skill, 'staged/first.js')).toMatchObject({ heavy: true, evidence: 'SKILL.md names the Workflow tool and staged/first.js' });
    const baseline = await seedSandbox(evalCase, { caseDir: root, skillName: 'sample', skillDir: null, scratch: root, dependencies: plan });
    const candidate = await seedSandbox(evalCase, { caseDir: root, skillName: 'sample', skillDir: skill, scratch: root, dependencies: plan });
    expect(existsSync(join(baseline, '.claude', 'workflows', 'engine.js'))).toBe(false);
    expect(existsSync(join(candidate, '.claude', 'workflows', 'engine.js'))).toBe(true);
    expect(existsSync(join(candidate, '.claude', 'workflows', 'helper.js'))).toBe(true);
  });

  it('reports a missing path only when it is a repo-relative script, never prose, data, absolute paths or URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dependency-prose-'));
    const skill = join(root, 'skill');
    await mkdir(skill, { recursive: true });
    await writeFile(join(root, '.git'), 'gitdir: nowhere');
    // Live false positives: `handoff` said built/fixed/changed., `spec-readable` said topic/feature/migration.
    await writeFile(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nAn A/B test at 40 tok/s per openai/codex; see https://github.com/openai/codex/issues/1.js and .claude/workflows/gone.js plus scripts/run.sh. What was built/fixed/changed. Name it topic/feature/migration. Write .claude/handoff.md under .planning/specs; run /usr/local/bin/tool.sh or ~/.claude/hooks/check.js');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], missing: ['.claude/workflows/gone.js', 'scripts/run.sh'], skipped: [] });
  });

  it('lets metadata.eval.heavy false override a positive scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heavy-'));
    await writeFile(join(root, 'SKILL.md'), '---\nname: sample\ndescription: useful\nmetadata:\n  eval:\n    heavy: false\n---\nUse the Workflow tool.');
    await expect(scanHeavySkill(root)).resolves.toMatchObject({ heavy: false, evidence: 'SKILL.md metadata.eval.heavy is false' });
  });
});

describe('dependency staging never hands an arm the skill, its answer key, or the task input (§6.1 rev 3)', () => {
  it('a self reference by directory token stages nothing and brings no evals/ into the arm', async () => {
    const { root, skill } = await harnessRepo('Read .claude/skills/state before you start.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], skipped: [], copies: [] });
    const arm = await seed(root, skill, plan);
    expect(existsSync(join(arm, '.claude', 'skills', 'state', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(arm, '.claude', 'skills', 'state', 'evals'))).toBe(false);
    expect(existsSync(join(arm, '.claude', 'skills', 'state', 'fixtures'))).toBe(false);
  });

  it('a self reference by SKILL.md token stages nothing', async () => {
    const { root, skill } = await harnessRepo('Follow .claude/skills/state/SKILL.md exactly.');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], missing: [], copies: [] });
  });

  it('a self reference to a top-level script by its repository path stages nothing and brings no evals/', async () => {
    const { root, skill } = await harnessRepo('Run .claude/skills/state/run.sh first.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const arm = await seed(root, skill, plan);
    expect(existsSync(join(arm, '.claude', 'skills', 'state', 'run.sh'))).toBe(true);
    expect(existsSync(join(arm, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it('a skill folder outside .claude/skills named by its repository path is not staged over itself', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dependency-src-'));
    const skill = join(root, 'skills-src', 'goal');
    await mkdir(join(root, '.git'), { recursive: true });
    await put(join(skill, 'SKILL.md'), '---\nname: goal\ndescription: useful\n---\nRun skills-src/goal/run.sh first');
    await put(join(skill, 'run.sh'), 'echo goal');
    await put(join(skill, 'evals', 'cases.yaml'), 'answer: key');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const arm = await seedSandbox(evalCase, { caseDir: root, skillName: 'goal', skillDir: skill, scratch: root, dependencies: plan });
    expect(existsSync(join(arm, 'skills-src', 'goal', 'evals'))).toBe(false);
  });

  it('the ancestor .claude/skills stages nothing and brings no skill trees into the arm', async () => {
    const { root, skill } = await harnessRepo('Every skill lives in .claude/skills and you may list .claude/skills/other.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const arm = await seed(root, skill, plan);
    expect(existsSync(join(arm, '.claude', 'skills', 'other'))).toBe(false);
    expect(existsSync(join(arm, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it("another skill's script under .claude/skills is not staged", async () => {
    const { root, skill } = await harnessRepo('Delegate to .claude/skills/other/tool.sh when stuck.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const arm = await seed(root, skill, plan);
    expect(existsSync(join(arm, '.claude', 'skills', 'other'))).toBe(false);
  });

  it('data paths and settings are the task input, not the method: none is staged', async () => {
    const { root, skill } = await harnessRepo('Write .claude/handoff.md, read .planning/specs and .planning/specs/spec.md, and respect .claude/settings.json and notes/data.md.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], skipped: [], copies: [] });
    const arm = await seed(root, skill, plan);
    for (const path of [['.claude', 'handoff.md'], ['.claude', 'settings.json'], ['.planning'], ['notes']]) {
      expect(existsSync(join(arm, ...path))).toBe(false);
    }
  });

  it('a script under .git is never staged', async () => {
    const { root, skill } = await harnessRepo('The hook .git/hooks/pre-push.sh must pass.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const arm = await seed(root, skill, plan);
    expect(existsSync(join(arm, '.git'))).toBe(false);
  });

  it('a workflow engine is staged with its sibling helper (the method travels)', async () => {
    const { root, skill } = await harnessRepo('Workflow({ scriptPath: ".claude/workflows/engine.js" })');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/workflows/engine.js'], missing: [] });
    const arm = await seed(root, skill, plan);
    expect(existsSync(join(arm, '.claude', 'workflows', 'engine.js'))).toBe(true);
    expect(existsSync(join(arm, '.claude', 'workflows', 'helper.js'))).toBe(true);
    expect(existsSync(join(arm, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(arm, '.claude', 'handoff.md'))).toBe(false);
  });

  it('a script token that ends a sentence is staged without its period', async () => {
    const { root, skill } = await harnessRepo('Finish by running .claude/workflows/engine.js.');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: ['.claude/workflows/engine.js'], missing: [] });
  });

  it('a script whose directory is the repo root or .claude travels alone, not with the whole tree', async () => {
    const { root, skill } = await harnessRepo('Run ./build.sh and .claude/statusline.js before you start');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['./build.sh', '.claude/statusline.js'].sort(), copies: ['.claude/statusline.js', 'build.sh'] });
    // Scratch outside the repository, as in a real run: copying the root into itself would throw instead.
    const scratch = await mkdtemp(join(tmpdir(), 'dependency-scratch-'));
    const arm = await seedSandbox(evalCase, { caseDir: root, skillName: 'state', skillDir: skill, scratch, dependencies: plan });
    expect(existsSync(join(arm, 'build.sh'))).toBe(true);
    expect(existsSync(join(arm, '.claude', 'statusline.js'))).toBe(true);
    for (const path of [['notes'], ['.planning'], ['.claude', 'handoff.md'], ['.claude', 'settings.json'], ['.claude', 'skills', 'other'], ['.claude', 'skills', 'state', 'evals']]) {
      expect(existsSync(join(arm, ...path))).toBe(false);
    }
  });

  it('the 20 MB cap counts the parent directory the copy brings, not only the named script', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dependency-cap-'));
    const skill = join(root, 'skill');
    await mkdir(join(root, '.git'), { recursive: true });
    await put(join(root, 'large', 'run.js'), 'export {};');
    await put(join(root, 'large', 'asset.bin'), Buffer.alloc(21 * 1024 * 1024));
    await put(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nnode large/run.js');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], copies: [], skipped: [{ path: 'large/run.js', bytes: 21 * 1024 * 1024 + 'export {};'.length }] });
  });

  it('two scripts sharing a directory count it once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dependency-dedup-'));
    const skill = join(root, 'skill');
    await mkdir(join(root, '.git'), { recursive: true });
    await put(join(root, 'tools', 'a.js'), 'a');
    await put(join(root, 'tools', 'b.js'), 'b');
    await put(join(root, 'tools', 'data.bin'), Buffer.alloc(12 * 1024 * 1024));
    await put(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nnode tools/a.js then tools/b.js');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: ['tools/a.js', 'tools/b.js'], skipped: [] });
  });

  it('a global skill under a HOME-rooted repository that names its own folder stages nothing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dependency-home-'));
    const work = await mkdtemp(join(tmpdir(), 'dependency-work-'));
    await mkdir(join(home, '.git'), { recursive: true });
    await mkdir(join(work, '.git'), { recursive: true });
    const skill = join(home, '.claude', 'skills', 'state');
    await put(join(skill, 'SKILL.md'), '---\nname: state\ndescription: useful\n---\nRun .claude/skills/state/run.sh and read .claude/skills/state.');
    await put(join(skill, 'run.sh'), 'echo global');
    await put(join(skill, 'evals', 'cases.yaml'), 'answer: key');
    const plan = await dependencyPlan(skill, work);
    expect(plan).toMatchObject({ repoRoot: home, staged: [], missing: [], copies: [] });
    const arm = await seedSandbox(evalCase, { caseDir: work, skillName: 'state', skillDir: skill, scratch: work, dependencies: plan });
    expect(existsSync(join(arm, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it("the incumbent arm keeps its own SKILL.md when the candidate's plan names the skill", async () => {
    const { root, skill } = await harnessRepo('Follow .claude/skills/state/SKILL.md, keep .claude/skills/state open, and run .claude/skills/state/run.sh.');
    const incumbent = await mkdtemp(join(tmpdir(), 'dependency-incumbent-'));
    await put(join(incumbent, 'SKILL.md'), '---\nname: state\ndescription: the last receipted version\n---\nincumbent body');
    await put(join(incumbent, 'run.sh'), 'echo incumbent');
    const plan = await dependencyPlan(skill, root);
    const arm = await seed(root, incumbent, plan);
    expect(await readFile(join(arm, '.claude', 'skills', 'state', 'SKILL.md'), 'utf8')).toContain('incumbent body');
    expect(await readFile(join(arm, '.claude', 'skills', 'state', 'run.sh'), 'utf8')).toBe('echo incumbent');
    expect(existsSync(join(arm, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it('a seeded case file at a staged path survives the dependency copy', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await put(join(root, 'tools', 'helper.js'), 'repository copy');
    const plan = await dependencyPlan(skill, root);
    expect(plan.staged).toEqual(['tools/run.js']);
    const arm = await seed(root, skill, plan, { 'tools/helper.js': 'seeded by the case' });
    expect(await readFile(join(arm, 'tools', 'helper.js'), 'utf8')).toBe('seeded by the case');
    expect(await readFile(join(arm, 'tools', 'run.js'), 'utf8')).toBe('export {};');
  });
});
