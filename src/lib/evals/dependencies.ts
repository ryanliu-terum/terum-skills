/**
 * Scan and plan the repository scripts a skill names but does not carry (spec §6.1 rev 3). Only a
 * named script travels, with its directory: those files are the skill's method. A data path the
 * skill names is the task's input, which belongs in a case's `files`/`fixture` — staging it would
 * hand the candidate an input the bare agent never gets (North Star: "on the same input").
 */
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { decodeText, hygieneFrontmatter } from './hygiene.js';

const TOKEN = /[\w.-]+(?:\/[\w.-]+)+/g;
/** Directories a copy never descends into. Names compare without case: APFS is case-insensitive. */
const EXCLUDED = new Set(['node_modules', '.git', '__tests__']);
/** A path through either of these is never a skill's method: it is neither staged nor reported missing. */
const NEVER = new Set(['node_modules', '.git']);
const SCRIPT = new Set(['.js', '.mjs', '.cjs', '.ts', '.sh', '.py']);
/** `${VAR}/`, `$VAR/`, `"$VAR"/` or `<placeholder>/` right before a token: the prefix stands for the repo root. */
const PLACEHOLDER = /(["']?)(?:\$\{(\w+)\}|\$(\w+)|<[\w.-]+>)\1\/$/;
/** Write errors that mean the sandbox already holds the path: the case's seeds and the staged skill win. */
const OCCUPIED = new Set(['EEXIST', 'ENOTDIR', 'EISDIR']);
export const DEPENDENCY_CAP_BYTES = 20 * 1024 * 1024;

export interface DependencyEntry {
  /** The real path read. A link is always resolved first, so no arm is handed a link into the repository. */
  from: string;
  /** The sandbox-relative path written. */
  to: string;
  directory: boolean;
  bytes: number;
}

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
   * parent directory, or the script alone when that directory is the repo root, a `.claude`
   * directory, or would carry the skill folder or `.claude/skills` (§6.1: never the skill's own
   * folder or an ancestor of it).
   */
  copies: string[];
  /** Every directory and file `stageDependencies` writes for `copies`, parents first; the cap summed exactly these bytes. */
  entries: DependencyEntry[];
}

export interface HeavyScan { heavy: boolean; evidence: string; }

/** Real paths every staged path is measured against. */
interface Fence { root: string; skill: string; installed: string; }

const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);
const isFile = async (path: string): Promise<boolean> => stat(path).then((info) => info.isFile(), () => false);
/** `path` is `root` itself or lies beneath it. */
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
const folded = (part: string): string => part.toLowerCase();
/** The segments pass through a `.claude/skills` tree, at any depth. */
const skillsTree = (parts: string[]): boolean => parts.some((part, index) => folded(part) === '.claude' && folded(parts[index + 1] ?? '') === 'skills');
const neverTree = (parts: string[]): boolean => parts.some((part) => NEVER.has(folded(part)));
const claudeDir = (path: string): boolean => folded(basename(path)) === '.claude';
const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

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
 * A real path staging never reads: the skill folder, anything in it, or an ancestor of it; the same
 * for `<root>/.claude/skills`, which may be a link; a `.claude/skills` tree, `.git` or `node_modules`
 * anywhere (measured from the repo root when the path is inside it); and the repo root or an ancestor.
 */
function fenced(fence: Fence, path: string): boolean {
  const parts = (inside(fence.root, path) ? relative(fence.root, path) : path).split(sep);
  return neverTree(parts) || skillsTree(parts) || inside(path, fence.root)
    || inside(fence.skill, path) || inside(path, fence.skill)
    || inside(fence.installed, path) || inside(path, fence.installed);
}

/** A sandbox-relative path no dependency copy writes: a `.claude/skills` tree or a `.claude/settings*.json`, at any depth. */
function landingRefused(landing: string): boolean {
  const parts = landing.split(/[\\/]/);
  return skillsTree(parts) || (parts.length >= 2 && folded(parts.at(-2)!) === '.claude' && /^settings.*\.json$/i.test(parts.at(-1)!));
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

/**
 * The repo-relative script tokens of a SKILL.md body, keyed by their normalized path so `./a/x.sh`
 * and `a/x.sh` are one script; each keeps the first spelling the body uses.
 */
function scriptTokens(body: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(TOKEN)) {
    let token = match[0];
    const at = match.index ?? 0;
    const before = body.slice(Math.max(0, at - 256), at);
    if (before.endsWith('$')) {
      // `$VAR/rest`: TOKEN began inside the variable's name. `$HOME` is not the repo root.
      const [name, ...rest] = token.split('/');
      if (name === 'HOME' || rest.length < 2) continue;
      token = rest.join('/');
    } else if (before.endsWith('/')) {
      // No leading `/` (§6.1): an absolute, `~/` or URL path is not repo-relative; a root placeholder is.
      const placeholder = PLACEHOLDER.exec(before);
      if (placeholder === null || (placeholder[2] ?? placeholder[3]) === 'HOME') continue;
    }
    // TOKEN already stops before `,;:)`; a sentence-ending period is the one mark it swallows, and
    // stripping it leaves a real extension (`engine.js.` → `engine.js`) intact.
    token = token.replace(/\.+$/, '');
    const segments = token.split('/').filter((segment) => segment !== '.');
    if (segments.includes('..') || neverTree(segments)) continue;
    // Only a script is the skill's method; `built/fixed/changed`, `.planning/specs` and
    // `.claude/handoff.md` are prose or the task's input, never staged and never "missing".
    if (!SCRIPT.has(extension(token))) continue;
    const key = segments.join('/');
    if (!tokens.has(key)) tokens.set(key, token);
  }
  return tokens;
}

/** Resolve the immutable, run-wide dependency plan once before any arm sandbox is made. */
export async function dependencyPlan(skillDir: string, cwd = process.cwd()): Promise<DependencyPlan> {
  const skillFile = join(skillDir, 'SKILL.md');
  const source = await lstat(skillFile).then(async () => readFile(skillFile), () => Buffer.alloc(0));
  const text = decodeText(source) ?? '';
  const root = await repoRootFor(skillDir, cwd);
  const declared = (hygieneFrontmatter(source) as { name?: unknown } | null | undefined)?.name;
  // The names skill staging may put this skill under: `.claude/skills/<name>/…` is its own file.
  const names = new Set([basename(resolve(skillDir)), ...(typeof declared === 'string' ? [declared] : [])].map(folded));
  const skill = await real(skillDir);
  const fence: Fence | null = root === null ? null : { root: await real(root), skill, installed: await real(join(root, '.claude', 'skills')) };
  const found: { token: string; copy: string; source: string }[] = [];
  const missing: string[] = [];
  const tokens = [...scriptTokens(skillBody(text))].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, token] of tokens) {
    const local = resolve(skillDir, key);
    // Already carried by the skill folder copy (evals/ and fixtures/ stay out on purpose).
    if (await isFile(local) && inside(skill, await real(local))) continue;
    const segments = key.split('/');
    const own = segments.length > 3 && folded(segments[0]!) === '.claude' && folded(segments[1]!) === 'skills' && names.has(folded(segments[2]!));
    if (own && await isFile(join(skillDir, ...segments.slice(3)))) continue;
    const candidate = root === null ? null : resolve(root, key);
    const info = candidate === null ? null : await stat(candidate).catch(() => null);
    // A script that resolves nowhere, a dangling link included, is the honest `missing` result.
    if (candidate === null || info === null) { missing.push(token); continue; }
    // A `.claude/skills` tree at any depth belongs to skill staging or to another skill.
    if (!info.isFile() || skillsTree(segments)) continue;
    // Tested on the repo-resolved real path, so a self reference by its repository path, a global
    // skill under a HOME-rooted repo, and a link into a skill or `.git` are all refused.
    const target = await real(candidate);
    if (fenced(fence!, target)) continue;
    const parent = dirname(candidate);
    const parentReal = await real(parent);
    // The script travels alone when its directory is the repo root, a `.claude` directory (settings,
    // notes and skills live there), or would carry the skill folder or `.claude/skills`.
    const alone = parent === root || claudeDir(parent) || claudeDir(parentReal) || inside(parent, resolve(skillDir)) || fenced(fence!, parentReal);
    found.push({ token, copy: relative(root!, alone ? candidate : parent), source: alone ? target : parentReal });
  }

  // The cap counts what the copy will write: each distinct copy root once, ancestors first, a root
  // the kept copies already wrote free.
  const roots = new Map<string, string>();
  for (const { copy, source: from } of found) if (!roots.has(copy)) roots.set(copy, from);
  const copies: string[] = [];
  const entries: DependencyEntry[] = [];
  const landed = new Set<string>();
  const bytesOf = new Map<string, number>();
  let total = 0;
  for (const [copy, from] of [...roots].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (landed.has(copy)) { bytesOf.set(copy, 0); continue; }
    const listed = await copyEntries(fence!, from, copy);
    const bytes = listed.reduce((sum, entry) => sum + entry.bytes, 0);
    bytesOf.set(copy, bytes);
    if (total + bytes > DEPENDENCY_CAP_BYTES) continue;
    total += bytes;
    copies.push(copy);
    for (const entry of listed) { landed.add(entry.to); entries.push(entry); }
  }
  const staged: string[] = [], skipped: { path: string; bytes: number }[] = [];
  for (const { token, copy } of found) {
    if (landed.has(copy)) staged.push(token); else skipped.push({ path: token, bytes: bytesOf.get(copy) ?? 0 });
  }
  return { repoRoot: root, staged, missing, skipped, copies, entries };
}

/**
 * Everything one copy root writes, parents first. Beneath the root: no `node_modules`, `.git` or
 * `__tests__`; nothing landing in a `.claude/skills` tree or on `.claude/settings*.json`; and every
 * link followed to its real target, which must pass the fence and must not loop back up the walk.
 * `fs.cp` would instead write the link, rewritten to an absolute path into the live repository.
 */
async function copyEntries(fence: Fence, source: string, copy: string): Promise<DependencyEntry[]> {
  const info = await stat(source).catch(() => null);
  if (info === null) return [];
  if (!info.isDirectory()) return info.isFile() ? [{ from: source, to: copy, directory: false, bytes: info.size }] : [];
  const out: DependencyEntry[] = [{ from: source, to: copy, directory: true, bytes: 0 }];
  const walk = async (dir: string, landing: string, open: string[]): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(byName)) {
      if (EXCLUDED.has(folded(entry.name))) continue;
      const to = join(landing, entry.name);
      if (landingRefused(to)) continue;
      const from = entry.isSymbolicLink() ? await realpath(join(dir, entry.name)).catch(() => null) : join(dir, entry.name);
      if (from === null || fenced(fence, from)) continue;
      const target = await stat(from).catch(() => null);
      if (target?.isDirectory()) {
        // A link to this directory or one above it would copy forever.
        if (open.some((ancestor) => inside(from, ancestor))) continue;
        out.push({ from, to, directory: true, bytes: 0 });
        await walk(from, to, [...open, from]);
      } else if (target?.isFile()) {
        out.push({ from, to, directory: false, bytes: target.size });
      }
    }
  };
  await walk(source, copy, [source]);
  return out;
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
 * Write the plan's entries into an arm sandbox. Runs after the case seeds and the skill staging
 * step, and never overwrites what they placed: a seeded file or the staged skill wins, and a
 * directory path they hold as a file keeps everything beneath it out.
 */
export async function stageDependencies(plan: DependencyPlan, sandbox: string): Promise<void> {
  const held: string[] = [];
  for (const entry of plan.entries) {
    if (held.some((path) => inside(path, entry.to))) continue;
    const target = join(sandbox, entry.to);
    try {
      if (entry.directory) {
        await mkdir(target, { recursive: true });
      } else {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(entry.from, target, constants.COPYFILE_EXCL);
      }
    } catch (error) {
      if (!OCCUPIED.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      if (entry.directory) held.push(entry.to);
    }
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

function extension(path: string): string { const name = path.split('/').at(-1) ?? ''; const dot = name.lastIndexOf('.'); return dot < 0 ? '' : name.slice(dot).toLowerCase(); }
