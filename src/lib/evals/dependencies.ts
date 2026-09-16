/** Scan and plan the repository files a skill names but does not carry. */
import { cp, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { decodeText, hygieneFrontmatter } from './hygiene.js';

const TOKEN = /[\w.-]+(?:\/[\w.-]+)+/g;
const EXCLUDED = new Set(['node_modules', '.git', '__tests__']);
const SCRIPT = new Set(['.js', '.mjs', '.cjs', '.ts', '.sh', '.py']);
export const DEPENDENCY_CAP_BYTES = 20 * 1024 * 1024;

export interface DependencyPlan {
  repoRoot: string | null;
  staged: string[];
  missing: string[];
  /** One warning for each otherwise-valid path the cap leaves out. */
  skipped: { path: string; bytes: number }[];
}

export interface HeavyScan { heavy: boolean; evidence: string; }

const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);
const inside = (root: string, path: string): boolean => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`)); };

/** The nearest git worktree/repository root; `.git` may be a file in a worktree. */
export async function repoRootFor(skillDir: string, cwd = process.cwd()): Promise<string | null> {
  for (const start of [resolve(skillDir), resolve(cwd)]) {
    let current = start;
    for (;;) {
      if (await exists(join(current, '.git'))) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}

function skillBody(source: string): string { return source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, ''); }

/** Resolve the immutable, run-wide dependency plan once before any arm sandbox is made. */
export async function dependencyPlan(skillDir: string, cwd = process.cwd()): Promise<DependencyPlan> {
  const skillFile = join(skillDir, 'SKILL.md');
  const source = await lstat(skillFile).then(async () => readFile(skillFile), () => Buffer.alloc(0));
  const text = decodeText(source) ?? '';
  const root = await repoRootFor(skillDir, cwd);
  const tokens = new Set<string>();
  const body = skillBody(text);
  for (const match of body.matchAll(TOKEN)) {
    const token = match[0];
    if (match.index !== undefined && body.slice(Math.max(0, match.index - 3), match.index) === '://') continue;
    if (token.split('/').includes('..')) continue;
    tokens.add(token);
  }
  const staged: string[] = [], missing: string[] = [];
  for (const token of [...tokens].sort()) {
    const local = resolve(skillDir, token);
    if (inside(resolve(skillDir), local) && await exists(local)) continue;
    const candidate = root === null ? null : resolve(root, token);
    if (candidate !== null && inside(root!, candidate) && await exists(candidate)) staged.push(token);
    // A path the repo does not hold is reported only when it is shaped like a file or a dot-directory
    // (some segment carries a dot): `A/B`, `tok/s`, `openai/codex` are prose, not a method that
    // failed to travel with the skill (§6.1 — the print is for a teammate whose install lacks a file).
    else if (token.split('/').some((segment) => segment.includes('.'))) missing.push(token);
  }
  let total = 0;
  const kept: string[] = [], skipped: { path: string; bytes: number }[] = [];
  for (const token of staged) {
    const bytes = await treeBytes(resolve(root!, token));
    if (total + bytes > DEPENDENCY_CAP_BYTES) skipped.push({ path: token, bytes });
    else { total += bytes; kept.push(token); }
  }
  return { repoRoot: root, staged: kept, missing, skipped };
}

/**
 * Static heavy detector. An explicit metadata.eval.heavy setting wins over file evidence. `referenced`
 * is the first staged dependency when the caller has a plan — the evidence line names the script the
 * skill fans out through, not the first path-shaped token in the file.
 */
export async function scanHeavySkill(skillDir: string, referenced?: string): Promise<HeavyScan> {
  const skill = await collectFiles(skillDir, false);
  const skillMd = skill.find((entry) => entry.path === 'SKILL.md');
  const frontmatter = skillMd === undefined ? undefined : hygieneFrontmatter(skillMd.contents);
  const override = (frontmatter as { metadata?: { eval?: { heavy?: unknown } } } | undefined)?.metadata?.eval?.heavy;
  if (typeof override === 'boolean') return { heavy: override, evidence: `SKILL.md metadata.eval.heavy is ${override}` };
  for (const file of skill) {
    const text = decodeText(file.contents);
    if (text === undefined) continue;
    const tool = /\b(Agent|Task|Workflow)\b/.exec(text)?.[1];
    if (tool) {
      const named = referenced ?? /[\w.-]+(?:\/[\w.-]+)+/.exec(text)?.[0];
      return { heavy: true, evidence: `${file.path} names the ${tool} tool${named === undefined ? '' : ` and ${named}`}` };
    }
    if (/codex exec/.test(text)) return { heavy: true, evidence: `${file.path} contains codex exec` };
    if (/claude -p/.test(text)) return { heavy: true, evidence: `${file.path} contains claude -p` };
  }
  return { heavy: false, evidence: 'no subagent invocation found' };
}

/** Copy exactly the plan's named dependency paths into an arm sandbox. */
export async function stageDependencies(plan: DependencyPlan, sandbox: string): Promise<void> {
  if (plan.repoRoot === null) return;
  for (const token of plan.staged) {
    const source = resolve(plan.repoRoot, token);
    const info = await lstat(source);
    const copyRoot = !info.isDirectory() && SCRIPT.has(extension(source)) ? dirname(source) : source;
    const target = resolve(sandbox, relative(plan.repoRoot, copyRoot));
    await mkdir(dirname(target), { recursive: true });
    await cp(copyRoot, target, { recursive: true, filter: (item) => !relative(copyRoot, item).split(/[\\/]/).some((part) => EXCLUDED.has(part)) });
  }
}

async function collectFiles(root: string, includeExcluded: boolean): Promise<{ path: string; contents: Buffer }[]> {
  const out: { path: string; contents: Buffer }[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!includeExcluded && (EXCLUDED.has(entry.name) || entry.name === 'evals' || entry.name === 'fixtures')) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) out.push({ path: relative(root, absolute), contents: await readFile(absolute) });
    }
  };
  await walk(root);
  return out;
}
async function treeBytes(path: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (EXCLUDED.has(entry.name)) continue;
      const child = join(dir, entry.name), childInfo = await lstat(child);
      if (childInfo.isDirectory()) await walk(child); else total += childInfo.size;
    }
  };
  await walk(path);
  return total;
}
function extension(path: string): string { const name = path.split('/').at(-1) ?? ''; const dot = name.lastIndexOf('.'); return dot < 0 ? '' : name.slice(dot).toLowerCase(); }
