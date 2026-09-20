import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dependencyPlan, scanHeavySkill } from '../dependencies.js';
import { seedSandbox, type EvalCase } from '../execution.js';

const evalCase: EvalCase = { name: 'c', task: 'work', files: {}, checks: [], requires: [] };
const MiB = 1024 * 1024;

/** Every temporary root this file makes is removed after its test: the cap tests write 33 MB of (sparse) files. */
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function tmp(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function put(path: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

/** A sparse file of `bytes` logical bytes: the cap reads its size, and the disk barely notices. */
async function big(path: string, bytes: number): Promise<void> {
  await put(path, '');
  await truncate(path, bytes);
}

async function link(target: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path);
}

/** Sandbox-relative paths of every symlink in an arm; dependency staging never writes one. */
async function linksIn(arm: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) found.push(relative(arm, path));
      else if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(arm);
  return found;
}

/**
 * A repository shaped like the harness: `.git`, a `state` skill carrying its answer key
 * (`evals/`, `fixtures/`) and a top-level `run.sh`, a second skill, data and settings files, and a
 * workflow engine with a sibling helper.
 */
async function harnessRepo(body: string): Promise<{ root: string; skill: string }> {
  const root = await tmp('dependency-harness-');
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

/** A skill folder outside `.claude/skills`, in a repository of its own. */
async function sourceRepo(body: string): Promise<{ root: string; skill: string }> {
  const root = await tmp('dependency-source-');
  const skill = join(root, 'skills-src', 'goal');
  await mkdir(join(root, '.git'), { recursive: true });
  await put(join(skill, 'SKILL.md'), `---\nname: goal\ndescription: useful\n---\n${body}`);
  await put(join(skill, 'evals', 'cases.yaml'), 'answer: key');
  return { root, skill };
}

/** Seeds an arm with scratch outside the repository, as a real run does. */
async function arm(caseDir: string, skillName: string, skillDir: string | null, plan: Awaited<ReturnType<typeof dependencyPlan>>, files: Record<string, string> = {}): Promise<string> {
  const scratch = await tmp('dependency-scratch-');
  return seedSandbox({ ...evalCase, files }, { caseDir, skillName, skillDir, scratch, dependencies: plan });
}

const seed = (root: string, skillDir: string | null, plan: Awaited<ReturnType<typeof dependencyPlan>>, files: Record<string, string> = {}): Promise<string> =>
  arm(root, 'state', skillDir, plan, files);

describe('heavy and dependency scans (§5 / §6.1)', () => {
  it('detects a Workflow tool, observes a frontmatter override, and plans named repository scripts', async () => {
    const root = await tmp('dependency-');
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
    const baseline = await arm(root, 'sample', null, plan);
    const candidate = await arm(root, 'sample', skill, plan);
    expect(existsSync(join(baseline, '.claude', 'workflows', 'engine.js'))).toBe(false);
    expect(existsSync(join(candidate, '.claude', 'workflows', 'engine.js'))).toBe(true);
    expect(existsSync(join(candidate, '.claude', 'workflows', 'helper.js'))).toBe(true);
  });

  it('reports a missing path only when it is a repo-relative script, never prose, data, absolute paths or URLs', async () => {
    const root = await tmp('dependency-prose-');
    const skill = join(root, 'skill');
    await mkdir(skill, { recursive: true });
    await writeFile(join(root, '.git'), 'gitdir: nowhere');
    // Live false positives: `handoff` said built/fixed/changed., `spec-readable` said topic/feature/migration.
    await writeFile(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nAn A/B test at 40 tok/s per openai/codex; see https://github.com/openai/codex/issues/1.js and .claude/workflows/gone.js plus scripts/run.sh. What was built/fixed/changed. Name it topic/feature/migration. Write .claude/handoff.md under .planning/specs; run /usr/local/bin/tool.sh or ~/.claude/hooks/check.js');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], missing: ['.claude/workflows/gone.js', 'scripts/run.sh'], skipped: [] });
  });

  it('lets metadata.eval.heavy false override a positive scan', async () => {
    const root = await tmp('heavy-');
    await writeFile(join(root, 'SKILL.md'), '---\nname: sample\ndescription: useful\nmetadata:\n  eval:\n    heavy: false\n---\nUse the Workflow tool.');
    await expect(scanHeavySkill(root)).resolves.toMatchObject({ heavy: false, evidence: 'SKILL.md metadata.eval.heavy is false' });
  });
});

describe('dependency staging never hands an arm the skill, its answer key, or the task input (§6.1 rev 3)', () => {
  it('a self reference by directory token stages nothing and brings no evals/ into the arm', async () => {
    const { root, skill } = await harnessRepo('Read .claude/skills/state before you start.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], skipped: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'evals'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'fixtures'))).toBe(false);
  });

  it('a self reference by SKILL.md token stages nothing', async () => {
    const { root, skill } = await harnessRepo('Follow .claude/skills/state/SKILL.md exactly.');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], missing: [], copies: [] });
  });

  it('a self reference to a top-level script by its repository path stages nothing and brings no evals/', async () => {
    const { root, skill } = await harnessRepo('Run .claude/skills/state/run.sh first.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'run.sh'))).toBe(true);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it('a skill folder outside .claude/skills named by its repository path is not staged over itself', async () => {
    const { root, skill } = await sourceRepo('Run skills-src/goal/run.sh first');
    await put(join(skill, 'run.sh'), 'echo goal');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const sandbox = await arm(root, 'goal', skill, plan);
    expect(existsSync(join(sandbox, 'skills-src', 'goal', 'evals'))).toBe(false);
  });

  it('the ancestor .claude/skills stages nothing and brings no skill trees into the arm', async () => {
    const { root, skill } = await harnessRepo('Every skill lives in .claude/skills and you may list .claude/skills/other.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'other'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it("another skill's script under .claude/skills is not staged", async () => {
    const { root, skill } = await harnessRepo('Delegate to .claude/skills/other/tool.sh when stuck.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'other'))).toBe(false);
  });

  it('data paths and settings are the task input, not the method: none is staged', async () => {
    const { root, skill } = await harnessRepo('Write .claude/handoff.md, read .planning/specs and .planning/specs/spec.md, and respect .claude/settings.json and notes/data.md.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], skipped: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    for (const path of [['.claude', 'handoff.md'], ['.claude', 'settings.json'], ['.planning'], ['notes']]) {
      expect(existsSync(join(sandbox, ...path))).toBe(false);
    }
  });

  it('a script under .git is never staged', async () => {
    const { root, skill } = await harnessRepo('The hook .git/hooks/pre-push.sh must pass.');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.git'))).toBe(false);
  });

  it('a workflow engine is staged with its sibling helper (the method travels)', async () => {
    const { root, skill } = await harnessRepo('Workflow({ scriptPath: ".claude/workflows/engine.js" })');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/workflows/engine.js'], missing: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'workflows', 'engine.js'))).toBe(true);
    expect(existsSync(join(sandbox, '.claude', 'workflows', 'helper.js'))).toBe(true);
    expect(existsSync(join(sandbox, '.claude', 'settings.json'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'handoff.md'))).toBe(false);
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
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, 'build.sh'))).toBe(true);
    expect(existsSync(join(sandbox, '.claude', 'statusline.js'))).toBe(true);
    for (const path of [['notes'], ['.planning'], ['.claude', 'handoff.md'], ['.claude', 'settings.json'], ['.claude', 'skills', 'other'], ['.claude', 'skills', 'state', 'evals']]) {
      expect(existsSync(join(sandbox, ...path))).toBe(false);
    }
  });

  it('the 20 MB cap counts the parent directory the copy brings, not only the named script', async () => {
    const root = await tmp('dependency-cap-');
    const skill = join(root, 'skill');
    await mkdir(join(root, '.git'), { recursive: true });
    await put(join(root, 'large', 'run.js'), 'export {};');
    await big(join(root, 'large', 'asset.bin'), 21 * MiB);
    await put(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nnode large/run.js');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], copies: [], skipped: [{ path: 'large/run.js', bytes: 21 * MiB + 'export {};'.length }] });
  });

  it('two scripts sharing a directory count it once', async () => {
    const root = await tmp('dependency-dedup-');
    const skill = join(root, 'skill');
    await mkdir(join(root, '.git'), { recursive: true });
    await put(join(root, 'tools', 'a.js'), 'a');
    await put(join(root, 'tools', 'b.js'), 'b');
    await big(join(root, 'tools', 'data.bin'), 12 * MiB);
    await put(join(skill, 'SKILL.md'), '---\nname: sample\ndescription: useful\n---\nnode tools/a.js then tools/b.js');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: ['tools/a.js', 'tools/b.js'], skipped: [] });
  });

  it('a global skill under a HOME-rooted repository that names its own folder stages nothing', async () => {
    const home = await tmp('dependency-home-');
    const work = await tmp('dependency-work-');
    await mkdir(join(home, '.git'), { recursive: true });
    await mkdir(join(work, '.git'), { recursive: true });
    const skill = join(home, '.claude', 'skills', 'state');
    await put(join(skill, 'SKILL.md'), '---\nname: state\ndescription: useful\n---\nRun .claude/skills/state/run.sh and read .claude/skills/state.');
    await put(join(skill, 'run.sh'), 'echo global');
    await put(join(skill, 'evals', 'cases.yaml'), 'answer: key');
    const plan = await dependencyPlan(skill, work);
    expect(plan).toMatchObject({ repoRoot: home, staged: [], missing: [], copies: [] });
    const sandbox = await arm(work, 'state', skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it('a global skill outside any repository never takes the cwd repository\'s same-named skill or its answer key', async () => {
    const home = await tmp('dependency-global-');
    const work = await tmp('dependency-work-');
    await mkdir(join(work, '.git'), { recursive: true });
    const skill = join(home, '.claude', 'skills', 'state');
    await put(join(skill, 'SKILL.md'), '---\nname: state\ndescription: useful\n---\nglobal body. Run .claude/skills/state/run.sh, follow .claude/skills/state/SKILL.md, see .claude/skills/state.');
    await put(join(work, '.claude', 'skills', 'state', 'SKILL.md'), '---\nname: state\ndescription: useful\n---\nproject body');
    await put(join(work, '.claude', 'skills', 'state', 'run.sh'), 'echo project');
    await put(join(work, '.claude', 'skills', 'state', 'evals', 'cases.yaml'), 'answer: key');
    const plan = await dependencyPlan(skill, work);
    expect(plan).toMatchObject({ repoRoot: work, staged: [], copies: [] });
    const sandbox = await arm(work, 'state', skill, plan);
    expect(await readFile(join(sandbox, '.claude', 'skills', 'state', 'SKILL.md'), 'utf8')).toContain('global body');
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'run.sh'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it("the incumbent arm keeps its own SKILL.md when the candidate's plan names the skill", async () => {
    const { root, skill } = await harnessRepo('Follow .claude/skills/state/SKILL.md, keep .claude/skills/state open, and run .claude/skills/state/run.sh.');
    const incumbent = await tmp('dependency-incumbent-');
    await put(join(incumbent, 'SKILL.md'), '---\nname: state\ndescription: the last receipted version\n---\nincumbent body');
    await put(join(incumbent, 'run.sh'), 'echo incumbent');
    const plan = await dependencyPlan(skill, root);
    const sandbox = await seed(root, incumbent, plan);
    expect(await readFile(join(sandbox, '.claude', 'skills', 'state', 'SKILL.md'), 'utf8')).toContain('incumbent body');
    expect(await readFile(join(sandbox, '.claude', 'skills', 'state', 'run.sh'), 'utf8')).toBe('echo incumbent');
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });

  it('a seeded case file at a staged path survives the dependency copy', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await put(join(root, 'tools', 'helper.js'), 'repository copy');
    const plan = await dependencyPlan(skill, root);
    expect(plan.staged).toEqual(['tools/run.js']);
    const sandbox = await seed(root, skill, plan, { 'tools/helper.js': 'seeded by the case' });
    expect(await readFile(join(sandbox, 'tools', 'helper.js'), 'utf8')).toBe('seeded by the case');
    expect(await readFile(join(sandbox, 'tools', 'run.js'), 'utf8')).toBe('export {};');
  });

  it('a copy root leaves out node_modules and __tests__, and the cap does not count them', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await big(join(root, 'tools', 'node_modules', 'dep', 'blob.bin'), 21 * MiB);
    await put(join(root, 'tools', '__tests__', 'run.test.js'), 'test');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['tools/run.js'], skipped: [], copies: ['tools'] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, 'tools', 'run.js'))).toBe(true);
    expect(existsSync(join(sandbox, 'tools', 'node_modules'))).toBe(false);
    expect(existsSync(join(sandbox, 'tools', '__tests__'))).toBe(false);
  });

  it('a script beside a skill folder outside .claude/skills travels alone, without the answer key', async () => {
    const { root, skill } = await sourceRepo('Run skills-src/build.sh first');
    await put(join(root, 'skills-src', 'build.sh'), 'echo build');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['skills-src/build.sh'], copies: ['skills-src/build.sh'] });
    const sandbox = await arm(root, 'goal', skill, plan);
    expect(existsSync(join(sandbox, 'skills-src', 'build.sh'))).toBe(true);
    expect(existsSync(join(sandbox, 'skills-src', 'goal', 'evals'))).toBe(false);
  });

  it('a skill outside .claude/skills naming a script under .claude does not bring .claude along', async () => {
    const { root, skill } = await sourceRepo('Run .claude/tool.sh first');
    await put(join(root, '.claude', 'tool.sh'), 'echo tool');
    await put(join(root, '.claude', 'handoff.md'), 'data');
    await put(join(root, '.claude', 'skills', 'other', 'evals', 'cases.yaml'), 'other: key');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/tool.sh'], copies: ['.claude/tool.sh'] });
    const sandbox = await arm(root, 'goal', skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'tool.sh'))).toBe(true);
    expect(existsSync(join(sandbox, '.claude', 'handoff.md'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'other'))).toBe(false);
  });
});

describe('a copy never follows or writes a link beneath a copied directory (§6.1 rev 3)', () => {
  it('a skills alias inside a staged directory does not hand the arm the answer key', async () => {
    const { root, skill } = await harnessRepo('Run .agents/sync.js first.');
    await put(join(root, '.agents', 'sync.js'), 'export {};');
    await link('../.claude/skills', join(root, '.agents', 'skills'));
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.agents/sync.js'], copies: ['.agents'] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.agents', 'sync.js'))).toBe(true);
    expect(existsSync(join(sandbox, '.agents', 'skills'))).toBe(false);
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('no link beneath a copied directory is copied or followed, wherever it points', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await put(join(root, 'shared', 'lib.js'), 'export const lib = true;');
    await link('../.claude/skills/state', join(root, 'tools', 'self'));
    await link('../.claude/skills/state/evals/cases.yaml', join(root, 'tools', 'key.yaml'));
    await link('../.git', join(root, 'tools', 'git'));
    await link('..', join(root, 'tools', 'up'));
    await link('.', join(root, 'tools', 'loop'));
    await link('../shared/lib.js', join(root, 'tools', 'lib.js'));
    await link('../shared', join(root, 'tools', 'shared'));
    await link('../.claude/settings.json', join(root, 'tools', 'config.json'));
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['tools/run.js'], copies: ['tools'] });
    expect(plan.entries.map((entry) => entry.to)).toEqual(['tools', join('tools', 'run.js')]);
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, 'tools', 'run.js'))).toBe(true);
    for (const name of ['self', 'key.yaml', 'git', 'up', 'loop', 'lib.js', 'shared', 'config.json']) expect(existsSync(join(sandbox, 'tools', name))).toBe(false);
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('with a symlinked .claude/skills, a link to .claude inside a copy root brings nothing from .claude (C4)', async () => {
    const { root } = await harnessRepo('');
    // `.claude/skills` becomes a link, so `.claude` is no longer an ancestor of its real path.
    const shared = await tmp('dependency-shared-skills-');
    await rm(join(root, '.claude', 'skills'), { recursive: true });
    await put(join(shared, 'state', 'SKILL.md'), '---\nname: state\ndescription: useful\n---\nnode tools/run.js');
    await put(join(shared, 'state', 'evals', 'cases.yaml'), 'answer: key');
    await link(shared, join(root, '.claude', 'skills'));
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await link('../.claude', join(root, 'tools', 'claude'));
    const skill = join(root, '.claude', 'skills', 'state');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['tools/run.js'], copies: ['tools'] });
    expect(plan.entries.filter((entry) => entry.to.startsWith(join('tools', 'claude')))).toEqual([]);
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, 'tools', 'run.js'))).toBe(true);
    expect(existsSync(join(sandbox, 'tools', 'claude'))).toBe(false);
    for (const path of [['.claude', 'handoff.md'], ['.claude', 'settings.json'], ['.claude', 'statusline.js']]) expect(existsSync(join(sandbox, ...path))).toBe(false);
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('a named script that is a link in a directory an outer copy already wrote still arrives as a file', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js, then tools/sub/engine.js');
    const outside = await tmp('dependency-dotfiles-');
    await put(join(outside, 'engine.js'), 'export const engine = "outside";');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await put(join(root, 'tools', 'sub', 'helper.js'), 'export {};');
    await link(join(outside, 'engine.js'), join(root, 'tools', 'sub', 'engine.js'));
    await link(join(outside, 'engine.js'), join(root, 'tools', 'sub', 'alias.js'));
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['tools/run.js', 'tools/sub/engine.js'], copies: ['tools'] });
    const sandbox = await seed(root, skill, plan);
    expect(await readFile(join(sandbox, 'tools', 'sub', 'engine.js'), 'utf8')).toBe('export const engine = "outside";');
    expect(existsSync(join(sandbox, 'tools', 'sub', 'helper.js'))).toBe(true);
    expect(existsSync(join(sandbox, 'tools', 'sub', 'alias.js'))).toBe(false);
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('a symlinked workflow directory outside the repository is staged as a real copy, executable bits kept', async () => {
    const { root, skill } = await harnessRepo('Workflow({ scriptPath: ".claude/workflows/engine.js" })');
    const outside = await tmp('dependency-dotfiles-');
    await put(join(outside, 'workflows', 'engine.js'), 'export const shared = true;');
    await put(join(outside, 'workflows', 'helper.js'), 'export const helper = true;');
    await put(join(outside, 'workflows', 'run.sh'), 'echo run');
    await chmod(join(outside, 'workflows', 'run.sh'), 0o755);
    await rm(join(root, '.claude', 'workflows'), { recursive: true });
    await link(join(outside, 'workflows'), join(root, '.claude', 'workflows'));
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/workflows/engine.js'], missing: [], copies: ['.claude/workflows'] });
    const sandbox = await seed(root, skill, plan);
    expect((await lstat(join(sandbox, '.claude', 'workflows'))).isDirectory()).toBe(true);
    expect(await readFile(join(sandbox, '.claude', 'workflows', 'helper.js'), 'utf8')).toBe('export const helper = true;');
    expect((await stat(join(sandbox, '.claude', 'workflows', 'run.sh'))).mode & 0o111).not.toBe(0);
    await writeFile(join(sandbox, '.claude', 'workflows', 'written.js'), 'by the arm');
    expect(existsSync(join(outside, 'workflows', 'written.js'))).toBe(false);
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('a script that is itself a link outside the repository is staged as a file; a dangling one is missing', async () => {
    const { root, skill } = await harnessRepo('node tools/engine.js, then tools/broken.js');
    const outside = await tmp('dependency-dotfiles-');
    await put(join(outside, 'engine.js'), 'export const engine = "outside";');
    await link(join(outside, 'engine.js'), join(root, 'tools', 'engine.js'));
    await link('../nowhere.js', join(root, 'tools', 'broken.js'));
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['tools/engine.js'], missing: ['tools/broken.js'], copies: ['tools'] });
    const sandbox = await seed(root, skill, plan);
    expect(await readFile(join(sandbox, 'tools', 'engine.js'), 'utf8')).toBe('export const engine = "outside";');
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('the cap counts the bytes behind a symlinked directory, not the link', async () => {
    const { root, skill } = await harnessRepo('Workflow({ scriptPath: ".claude/workflows/engine.js" })');
    await rm(join(root, '.claude', 'workflows'), { recursive: true });
    await put(join(root, 'shared', 'workflows', 'engine.js'), 'export {};');
    await big(join(root, 'shared', 'workflows', 'model.bin'), 21 * MiB);
    await link('../shared/workflows', join(root, '.claude', 'workflows'));
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], copies: [], skipped: [{ path: '.claude/workflows/engine.js', bytes: 21 * MiB + 'export {};'.length }] });
  });
});

/** Permission bits mean nothing to root, so the unreadable-entry tests skip there. */
const asRoot = process.getuid?.() === 0;

/** Runs `body` with each path at its mode, then restores 0755 so the temporary roots can be removed. */
async function locked<T>(paths: [string, number][], body: () => Promise<T>): Promise<T> {
  try {
    for (const [path, mode] of paths) await chmod(path, mode);
    return await body();
  } finally {
    for (const [path] of paths) await chmod(path, 0o755).catch(() => undefined);
  }
}

describe('an entry the eval cannot read is left out, never thrown (§6.1 rev 3)', () => {
  it.skipIf(asRoot)('a link to an unreadable directory beneath a copy root is left out, and the plan resolves (C2)', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await put(join(root, 'private', 'secret.js'), 'export {};');
    await link('../private', join(root, 'tools', 'locked'));
    await locked([[join(root, 'private'), 0o000]], async () => {
      const plan = await dependencyPlan(skill, root);
      expect(plan).toMatchObject({ staged: ['tools/run.js'], missing: [], skipped: [], copies: ['tools'] });
      expect(plan.entries.map((entry) => entry.to)).toEqual(['tools', join('tools', 'run.js')]);
      const sandbox = await seed(root, skill, plan);
      expect(existsSync(join(sandbox, 'tools', 'run.js'))).toBe(true);
      expect(existsSync(join(sandbox, 'tools', 'locked'))).toBe(false);
      expect(await linksIn(sandbox)).toEqual([]);
    });
  });

  it.skipIf(asRoot)('an unreadable directory or file beneath a copy root is left out, and the plan resolves (G1)', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await put(join(root, 'tools', 'helper.js'), 'export {};');
    await put(join(root, 'tools', 'locked', 'inner.js'), 'export {};');
    await put(join(root, 'tools', 'sealed.js'), 'export {};');
    await locked([[join(root, 'tools', 'locked'), 0o000], [join(root, 'tools', 'sealed.js'), 0o000]], async () => {
      const plan = await dependencyPlan(skill, root);
      expect(plan).toMatchObject({ staged: ['tools/run.js'], missing: [], skipped: [], copies: ['tools'] });
      expect(plan.entries.map((entry) => entry.to)).toEqual(['tools', join('tools', 'helper.js'), join('tools', 'run.js')]);
      const sandbox = await seed(root, skill, plan);
      expect(existsSync(join(sandbox, 'tools', 'run.js'))).toBe(true);
      expect(existsSync(join(sandbox, 'tools', 'helper.js'))).toBe(true);
      expect(existsSync(join(sandbox, 'tools', 'locked'))).toBe(false);
      expect(existsSync(join(sandbox, 'tools', 'sealed.js'))).toBe(false);
    });
  });

  it.skipIf(asRoot)('a named script the eval cannot read is reported missing, and staging does not throw', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await put(join(root, 'tools', 'helper.js'), 'export {};');
    await locked([[join(root, 'tools', 'run.js'), 0o000]], async () => {
      const plan = await dependencyPlan(skill, root);
      expect(plan).toMatchObject({ staged: [], missing: ['tools/run.js'], skipped: [], copies: [] });
      const sandbox = await seed(root, skill, plan);
      expect(existsSync(join(sandbox, 'tools'))).toBe(false);
    });
  });

  it.skipIf(asRoot)('a named script in a directory the eval may search but not list still travels, alone', async () => {
    const { root, skill } = await harnessRepo('node tools/run.js');
    await put(join(root, 'tools', 'run.js'), 'export {};');
    await put(join(root, 'tools', 'helper.js'), 'export {};');
    await locked([[join(root, 'tools'), 0o111]], async () => {
      const plan = await dependencyPlan(skill, root);
      expect(plan).toMatchObject({ staged: ['tools/run.js'], missing: [], skipped: [], copies: ['tools'] });
      const sandbox = await seed(root, skill, plan);
      expect(await readFile(join(sandbox, 'tools', 'run.js'), 'utf8')).toBe('export {};');
      expect(existsSync(join(sandbox, 'tools', 'helper.js'))).toBe(false);
    });
  });
});

describe("a harness linked into node_modules is the skill's method (§6.1 rev 3, C1)", () => {
  it.each([
    ['inside the repository', (at: { root: string; prefix: string }) => join(at.root, 'node_modules', '@org', 'harness')],
    ['under a global npm prefix', (at: { root: string; prefix: string }) => join(at.prefix, 'lib', 'node_modules', '@org', 'harness')],
  ])("a .claude/workflows link into node_modules %s is staged, without the package's own node_modules", async (_label, packageDir) => {
    const { root, skill } = await harnessRepo('Workflow({ scriptPath: ".claude/workflows/engine.js" })');
    const pkg = packageDir({ root, prefix: await tmp('dependency-prefix-') });
    await put(join(pkg, 'workflows', 'engine.js'), 'export const engine = "harness";');
    await put(join(pkg, 'workflows', 'helper.js'), 'export const helper = true;');
    await put(join(pkg, 'workflows', 'node_modules', 'dep', 'index.js'), 'export {};');
    await rm(join(root, '.claude', 'workflows'), { recursive: true });
    await link(join(pkg, 'workflows'), join(root, '.claude', 'workflows'));
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/workflows/engine.js'], missing: [], skipped: [], copies: ['.claude/workflows'] });
    const sandbox = await seed(root, skill, plan);
    expect(await readFile(join(sandbox, '.claude', 'workflows', 'engine.js'), 'utf8')).toBe('export const engine = "harness";');
    expect(await readFile(join(sandbox, '.claude', 'workflows', 'helper.js'), 'utf8')).toBe('export const helper = true;');
    expect(existsSync(join(sandbox, '.claude', 'workflows', 'node_modules'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'settings.json'))).toBe(false);
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('a named script that is itself a link into node_modules is staged as a file, with its own directory', async () => {
    const { root, skill } = await harnessRepo('node tools/engine.js');
    await put(join(root, 'node_modules', 'pkg', 'engine.js'), 'export const engine = "package";');
    await put(join(root, 'node_modules', 'pkg', 'other.js'), 'export {};');
    await put(join(root, 'tools', 'helper.js'), 'export {};');
    await link('../node_modules/pkg/engine.js', join(root, 'tools', 'engine.js'));
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['tools/engine.js'], missing: [], copies: ['tools'] });
    const sandbox = await seed(root, skill, plan);
    expect(await readFile(join(sandbox, 'tools', 'engine.js'), 'utf8')).toBe('export const engine = "package";');
    expect(existsSync(join(sandbox, 'tools', 'helper.js'))).toBe(true);
    expect(existsSync(join(sandbox, 'node_modules'))).toBe(false);
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('a named script or workflow directory whose real path is under .git is still refused', async () => {
    const { root, skill } = await harnessRepo('node tools/hook.sh, then Workflow({ scriptPath: ".claude/workflows/pre-push.sh" })');
    await link('../.git/hooks/pre-push.sh', join(root, 'tools', 'hook.sh'));
    await rm(join(root, '.claude', 'workflows'), { recursive: true });
    await link('../.git/hooks', join(root, '.claude', 'workflows'));
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, 'tools'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'workflows'))).toBe(false);
  });
});

describe('every .claude tree is fenced, at any depth and in any spelling (§6.1 rev 3)', () => {
  it('a skill outside .claude by path, behind a .claude/skills link, stages a .claude script alone (C3)', async () => {
    const { root, skill } = await sourceRepo('Run .claude/statusline.js; it reads .claude/handoff.md and .claude/settings.json.');
    await link('../skills-src', join(root, '.claude', 'skills'));
    await put(join(root, '.claude', 'statusline.js'), 'export {};');
    await put(join(root, '.claude', 'handoff.md'), 'handoff notes');
    await put(join(root, '.claude', 'settings.json'), '{"hooks":{}}');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/statusline.js'], missing: [], skipped: [], copies: ['.claude/statusline.js'] });
    const sandbox = await arm(root, 'goal', skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'statusline.js'))).toBe(true);
    for (const path of [['.claude', 'handoff.md'], ['.claude', 'settings.json'], ['.claude', 'skills', 'goal', 'evals']]) {
      expect(existsSync(join(sandbox, ...path))).toBe(false);
    }
    expect(await linksIn(sandbox)).toEqual([]);
  });

  it('with a symlinked .claude/skills, a script directly under .claude still travels alone', async () => {
    const root = await tmp('dependency-linked-skills-');
    const shared = await tmp('dependency-shared-skills-');
    await mkdir(join(root, '.git'), { recursive: true });
    await put(join(shared, 'state', 'SKILL.md'), '---\nname: state\ndescription: useful\n---\nRun .claude/statusline.js');
    await put(join(shared, 'state', 'evals', 'cases.yaml'), 'answer: key');
    await link(shared, join(root, '.claude', 'skills'));
    await put(join(root, '.claude', 'statusline.js'), 'export {};');
    await put(join(root, '.claude', 'handoff.md'), 'data');
    await put(join(root, '.claude', 'settings.json'), '{}');
    const skill = join(root, '.claude', 'skills', 'state');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['.claude/statusline.js'], copies: ['.claude/statusline.js'] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.claude', 'statusline.js'))).toBe(true);
    for (const path of [['.claude', 'handoff.md'], ['.claude', 'settings.json'], ['.claude', 'skills', 'state', 'evals']]) {
      expect(existsSync(join(sandbox, ...path))).toBe(false);
    }
  });

  it("a package directory is staged without its nested .claude/skills or settings", async () => {
    const { root, skill } = await harnessRepo('Run packages/app/build.sh first.');
    await put(join(root, 'packages', 'app', 'build.sh'), 'echo app');
    await put(join(root, 'packages', 'app', 'lib.js'), 'export {};');
    await put(join(root, 'packages', 'app', '.claude', 'settings.json'), '{}');
    await put(join(root, 'packages', 'app', '.claude', 'settings.local.json'), '{}');
    await put(join(root, 'packages', 'app', '.claude', 'skills', 'other', 'SKILL.md'), '---\nname: other\ndescription: other\n---\nother');
    await put(join(root, 'packages', 'app', '.claude', 'skills', 'other', 'evals', 'key.yaml'), 'other: key');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: ['packages/app/build.sh'], copies: ['packages/app'] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, 'packages', 'app', 'build.sh'))).toBe(true);
    expect(existsSync(join(sandbox, 'packages', 'app', 'lib.js'))).toBe(true);
    for (const name of ['skills', 'settings.json', 'settings.local.json']) expect(existsSync(join(sandbox, 'packages', 'app', '.claude', name))).toBe(false);
  });

  it("a script inside a nested package's .claude/skills is never staged", async () => {
    const { root, skill } = await harnessRepo('Run packages/app/.claude/skills/other/run.sh first.');
    await put(join(root, 'packages', 'app', '.claude', 'skills', 'other', 'run.sh'), 'echo other');
    await put(join(root, 'packages', 'app', '.claude', 'skills', 'other', 'evals', 'key.yaml'), 'other: key');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], missing: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, 'packages'))).toBe(false);
  });

  it("another skill's absent script is missing even when this skill has a file of the same name", async () => {
    const { root, skill } = await harnessRepo('Delegate to .claude/skills/other/run.sh or .claude/skills/other/gone.sh.');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: [], missing: ['.claude/skills/other/gone.sh', '.claude/skills/other/run.sh'], copies: [] });
  });

  it.each([
    ['a .git in capitals', 'The hook .GIT/hooks/pre-push.sh must pass.'],
    ['node_modules in capitals', 'Run NODE_MODULES/pkg/bin.js.'],
    ['a dot-slash self reference', 'Run ./.claude/skills/state/run.sh first.'],
    ['a self reference in other capitals', 'Run .Claude/Skills/state/run.sh first.'],
    ["another skill's script in other capitals", 'Delegate to .claude/Skills/other/tool.sh.'],
  ])('%s is never staged', async (_label, body) => {
    const { root, skill } = await harnessRepo(body);
    await put(join(root, 'NODE_MODULES', 'pkg', 'bin.js'), 'export {};');
    const plan = await dependencyPlan(skill, root);
    expect(plan).toMatchObject({ staged: [], copies: [] });
    const sandbox = await seed(root, skill, plan);
    expect(existsSync(join(sandbox, '.git'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'other'))).toBe(false);
    expect(existsSync(join(sandbox, '.claude', 'skills', 'state', 'evals'))).toBe(false);
  });
});

describe('script spellings (§6.1 rev 3)', () => {
  it('a ${VAR}/, $VAR/, "$VAR"/ or <placeholder>/ prefix stands for the repo root; $HOME, ~ and / do not', async () => {
    const { root, skill } = await harnessRepo([
      'Run ${ROOT}/scripts/a.sh, <repo>/scripts/b.sh, "$CLAUDE_PROJECT_DIR"/.claude/hooks/c.js and $ROOT/tools/d.sh.',
      'Never $HOME/tools/e.sh, ${HOME}/tools/e.sh, ~/tools/e.sh or /tools/e.sh.',
    ].join('\n'));
    for (const path of ['scripts/a.sh', 'scripts/b.sh', '.claude/hooks/c.js', 'tools/d.sh', 'tools/e.sh']) await put(join(root, path), 'echo');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: ['.claude/hooks/c.js', 'scripts/a.sh', 'scripts/b.sh', 'tools/d.sh'], missing: [] });
  });

  it('two spellings of one script stage it once, under the first spelling', async () => {
    const { root, skill } = await harnessRepo('Run ./scripts/x.sh; scripts/x.sh is idempotent.');
    await put(join(root, 'scripts', 'x.sh'), 'echo x');
    await expect(dependencyPlan(skill, root)).resolves.toMatchObject({ staged: ['./scripts/x.sh'], missing: [], copies: ['scripts'] });
  });
});
