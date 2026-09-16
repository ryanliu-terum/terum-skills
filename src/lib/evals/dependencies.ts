/**
 * Scan and plan the repository scripts a skill names but does not carry (spec §6.1 rev 3). Only a
 * named script travels, with its directory: those files are the skill's method. A data path the
 * skill names is the task's input, which belongs in a case's `files`/`fixture` — staging it would
 * hand the candidate an input the bare agent never gets (North Star: "on the same input").
 */
import { cp, lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { decodeText, hygieneFrontmatter } from './hygiene.js';

const TOKEN = /[\w.-]+(?:\/[\w.-]+)+/g;
const EXCLUDED = new Set(['node_modules', '.git', '__tests__']);
/** A token through either of these is never a skill's method: it is neither staged nor reported missing. */
const NEVER = new Set(['node_modules', '.git']);
const SCRIPT = new Set(['.js', '.mjs', '.cjs', '.ts', '.sh', '.py']);
export const DEPENDENCY_CAP_BYTES = 20 * 1024 * 1024;

export interface DependencyPlan {
  repoRoot: string | null;
  /** The named scripts that travel into the candidate and incumbent arms. */
  staged: string[];
  /** Script-shaped tokens that resolve nowhere. */
  missing: string[];
  /** One warning for each otherwise-valid script the cap leaves out; `bytes` is what staging it would copy. */
  skipped: { path: string; bytes: number }[];
  /**
   * Repo-relative paths `stageDependencies` copies, each once, ancestors first: a staged script's
   * parent directory, or the script alone when that directory is the repo root or would carry the
   * skill folder or `.claude/skills` (§6.1: never the skill's own folder or an ancestor of it).
   */
  copies: string[];
}

export interface HeavyScan { heavy: boolean; evidence: string; }

const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);
const isFile = async (path: string): Promise<boolean> => stat(path).then((info) => info.isFile(), () => false);
/** `path` is `root` itself or lies beneath it. */
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** The real path; for a path that does not exist, its nearest existing ancestor's real path plus the rest. */
async function real(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(await real(parent), basename(absolute));
  }
}

/**
 * The one copy predicate, shared by the cap and the copy so the two count the same bytes: nothing
 * under a `node_modules`/`.git`/`__tests__` directory beneath the copy root, nothing that would land
 * under `.claude/skills` (the skill staging step owns that tree), and never `.claude/settings*.json`.
 */
function copied(copyRel: string, innerRel: string): boolean {
  if (innerRel.split(/[\\/]/).some((part) => EXCLUDED.has(part))) return false;
  const landing = join(copyRel, innerRel).split(/[\\/]/);
  if (landing[0] !== '.claude') return true;
  return landing[1] !== 'skills' && !(landing.length === 2 && /^settings.*\.json$/.test(landing[1] ?? ''));
}

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
    // No leading `/` (§6.1): an absolute, `~/` or URL path is not repo-relative.
    if (match.index !== undefined && match.index > 0 && body[match.index - 1] === '/') continue;
    // TOKEN already stops before `,;:)`; a sentence-ending period is the one mark it swallows, and
    // stripping it leaves a real extension (`engine.js.` → `engine.js`) intact.
    const token = match[0].replace(/\.+$/, '');
    const segments = token.split('/');
    if (segments.includes('..') || segments.some((segment) => NEVER.has(segment))) continue;
    // Only a script is the skill's method; `built/fixed/changed`, `.planning/specs` and
    // `.claude/handoff.md` are prose or the task's input, never staged and never "missing".
    if (SCRIPT.has(extension(token))) tokens.add(token);
  }

  const skill = await real(skillDir);
  const rootReal = root === null ? null : await real(root);
  const installed = root === null ? null : await real(join(root, '.claude', 'skills'));
  const found: { token: string; copy: string }[] = [];
  const missing: string[] = [];
  for (const token of [...tokens].sort()) {
    const local = resolve(skillDir, token);
    // Already carried by the skill folder copy (evals/ and fixtures/ stay out on purpose).
    if (await isFile(local) && inside(skill, await real(local))) continue;
    const segments = token.split('/').filter((segment) => segment !== '.');
    // `.claude/skills/<name>/<rest>` names an installed skill's file; skill staging owns that tree.
    const underSkills = segments[0] === '.claude' && segments[1] === 'skills';
    if (underSkills && segments.length > 3 && await isFile(join(skillDir, ...segments.slice(3)))) continue;
    const candidate = root === null ? null : resolve(root, token);
    if (candidate === null || !await exists(candidate)) { missing.push(token); continue; }
    if (underSkills || !await isFile(candidate)) continue;
    // The inside-the-skill test uses the repo-resolved path, so a self reference by its repository
    // path (`.claude/skills/<self>/run.sh`, or a global skill under a HOME-rooted repo) is refused.
    const target = await real(candidate);
    if (!inside(rootReal!, target) || inside(installed!, target) || inside(skill, target)) continue;
    const parent = dirname(candidate);
    const parentReal = await real(parent);
    const whole = parentReal !== rootReal && !inside(parentReal, skill) && !inside(parentReal, installed!);
    found.push({ token, copy: relative(root!, whole ? parent : candidate) });
  }

  // The cap counts what the copy will write: each distinct copy root once, ancestors first, a root
  // already inside a kept one (and not filtered out of it) free.
  const copies: string[] = [];
  const bytesOf = new Map<string, number>();
  const coveredBy = (outer: string, copy: string): boolean => {
    const from = resolve(root!, outer), to = resolve(root!, copy);
    return inside(from, to) && copied(outer, relative(from, to));
  };
  let total = 0;
  for (const copy of [...new Set(found.map((entry) => entry.copy))].sort()) {
    if (copies.some((outer) => coveredBy(outer, copy))) { bytesOf.set(copy, 0); continue; }
    const bytes = await copyBytes(resolve(root!, copy), copy);
    bytesOf.set(copy, bytes);
    if (total + bytes <= DEPENDENCY_CAP_BYTES) { total += bytes; copies.push(copy); }
  }
  const staged: string[] = [], skipped: { path: string; bytes: number }[] = [];
  for (const { token, copy } of found) {
    if (copies.some((outer) => coveredBy(outer, copy))) staged.push(token); else skipped.push({ path: token, bytes: bytesOf.get(copy) ?? 0 });
  }
  return { repoRoot: root, staged, missing, skipped, copies };
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
      // Only a resolved dependency is worth naming: the first path-shaped token in a SKILL.md is
      // usually prose (`critical/high`, `trivial/safe/isolated` on the live harness skills).
      return { heavy: true, evidence: `${file.path} names the ${tool} tool${referenced === undefined ? '' : ` and ${referenced}`}` };
    }
    if (/codex exec/.test(text)) return { heavy: true, evidence: `${file.path} contains codex exec` };
    if (/claude -p/.test(text)) return { heavy: true, evidence: `${file.path} contains claude -p` };
  }
  return { heavy: false, evidence: 'no subagent invocation found' };
}

/**
 * Copy the plan's copy roots into an arm sandbox, each once. Runs after the case seeds and the skill
 * staging step, and never overwrites what they placed: a seeded file or the staged skill wins.
 */
export async function stageDependencies(plan: DependencyPlan, sandbox: string): Promise<void> {
  if (plan.repoRoot === null) return;
  for (const copy of plan.copies) {
    const source = resolve(plan.repoRoot, copy);
    const target = resolve(sandbox, copy);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: false, errorOnExist: false, filter: (item) => copied(copy, relative(source, item)) });
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

/** Bytes `stageDependencies` writes for one copy root, under the same predicate the copy applies. */
async function copyBytes(path: string, copyRel: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (!copied(copyRel, relative(path, child))) continue;
      if (entry.isDirectory()) await walk(child); else total += (await lstat(child)).size;
    }
  };
  await walk(path);
  return total;
}
function extension(path: string): string { const name = path.split('/').at(-1) ?? ''; const dot = name.lastIndexOf('.'); return dot < 0 ? '' : name.slice(dot).toLowerCase(); }
