/**
 * Scan and plan the repository scripts a skill names but does not carry (spec §6.1 rev 3). Only a
 * named script travels, with its directory: those files are the skill's method. A data path the
 * skill names is the task's input, which belongs in a case's `files`/`fixture` — staging it would
 * hand the candidate an input the bare agent never gets (North Star: "on the same input").
 */
import { constants, type Dirent, type Stats } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { decodeText, hygieneFrontmatter } from './hygiene.js';

const TOKEN = /[\w.-]+(?:\/[\w.-]+)+/g;
/** Directories a copy never descends into. Names compare without case: APFS is case-insensitive. */
const EXCLUDED = new Set(['node_modules', '.git', '__tests__']);
/**
 * A token spelled through `node_modules` is never a skill's method: it is neither staged nor reported
 * missing. A token spelled through `.git` is not either; `dependencyPlan` withholds it when it exists.
 */
const NEVER = new Set(['node_modules']);
const SCRIPT = new Set(['.js', '.mjs', '.cjs', '.ts', '.sh', '.py']);
/** `${VAR}/`, `$VAR/`, `"$VAR"/` or `<placeholder>/` right before a token: the prefix stands for the repo root. */
const PLACEHOLDER = /(["']?)(?:\$\{(\w+)\}|\$(\w+)|<[\w.-]+>)\1\/$/;
/** Write errors that mean the sandbox already holds the path: the case's seeds and the staged skill win. */
const OCCUPIED = new Set(['EEXIST', 'ENOTDIR', 'EISDIR']);
export const DEPENDENCY_CAP_BYTES = 20 * 1024 * 1024;
/** The most entries the identity walk (`answerKey`) visits; past it the plan stages nothing. */
export const ANSWER_KEY_ENTRY_CAP = 200_000;

/** Why a named script that exists is withheld (§6.1); each reads after "not staged: ". */
const WITHHELD = {
  key: "it is part of this skill's answer key (evals/ or fixtures/)",
  own: "it is one of this skill's own files",
  git: 'it lies in .git',
  skills: 'it lies in a .claude/skills tree',
  root: 'it lies at or above the repository root',
} as const;

export interface DependencyEntry {
  /**
   * The real path read. A named script or copy root that is a link is read through its real target;
   * a link beneath a copy root is never read, so no arm is handed a link into the repository.
   */
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
   * Named scripts that exist but a fence refuses (§6.1), with the reason: one of the skill's own
   * files or its answer key (by path, or by file identity through any link or spelling), a
   * `.claude/skills` tree, `.git`, or the repo root or above. Neither staged nor missing.
   */
  withheld: { path: string; reason: string }[];
  /**
   * Set when the identity walk could not finish (past `ANSWER_KEY_ENTRY_CAP` entries, or at a
   * directory the eval may search but not list): it says why, and the plan stages nothing, since a
   * file the walk never saw could be the answer key. Absent when the walk finished or never ran.
   */
  incomplete?: string;
  /**
   * Repo-relative paths `stageDependencies` copies, each once, ancestors first: a staged script's
   * parent directory, or the script alone when that directory is the repo root, a `.claude`
   * directory, or would carry the skill folder or `.claude/skills` (§6.1: never the skill's own
   * folder or an ancestor of it). A copy leaves out every file and directory of the skill folder
   * and of its answer key, by file identity.
   */
  copies: string[];
  /** Every directory and file `stageDependencies` writes for `copies`, parents first; the cap summed exactly these bytes. */
  entries: DependencyEntry[];
}

export interface HeavyScan { heavy: boolean; evidence: string; }

/** Real paths every staged path is measured against: where things are, not what they are. */
interface Fence { root: string; skill: string; installed: string; }

/**
 * The files and directories no arm may receive, keyed by `dev:ino` so every spelling of a path, a
 * link and a hard link are one entry, each with its `WITHHELD` reason; `incomplete` says why the walk
 * could not finish (see `answerKey`).
 */
interface Identity { ids: Map<string, string>; incomplete?: string; }

/**
 * A named script as `dependencyPlan` resolved it: the one link a copy's walk still reads through.
 * `to` is its repo-relative path; `dev`/`ino` identify its real target.
 */
interface Named { to: string; from: string; bytes: number; dev: number; ino: number; }

const exists = async (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);
const isFile = async (path: string): Promise<boolean> => stat(path).then((info) => info.isFile(), () => false);
const readable = async (path: string): Promise<boolean> => access(path, constants.R_OK).then(() => true, () => false);
/** A directory the eval may pass through, whether or not it may list it. */
const searchable = async (path: string): Promise<boolean> =>
  (await stat(path).then((info) => info.isDirectory(), () => false)) && access(path, constants.X_OK).then(() => true, () => false);
/** A directory's entries in name order, or null when it cannot be listed (an unreadable directory is left out, never thrown). */
const listing = async (dir: string): Promise<Dirent[] | null> => readdir(dir, { withFileTypes: true }).then((entries) => entries.sort(byName), () => null);
/** `path` is `root` itself or lies beneath it. */
const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
const folded = (part: string): string => part.toLowerCase();
/** The segments pass through a `.claude/skills` tree, at any depth. */
const skillsTree = (parts: string[]): boolean => parts.some((part, index) => folded(part) === '.claude' && folded(parts[index + 1] ?? '') === 'skills');
const neverTree = (parts: string[]): boolean => parts.some((part) => NEVER.has(folded(part)));
const gitTree = (parts: string[]): boolean => parts.some((part) => folded(part) === '.git');
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

/** A file's identity: every spelling of its path, every link to it and every hard link share it. */
const idOf = (info: Stats): string => `${info.dev}:${info.ino}`;

/** Where a path leads, links followed: its stats, `null` when nowhere the eval can read, 'blind' when its name is too long to resolve. */
async function look(path: string): Promise<Stats | null | 'blind'> {
  return stat(path).catch((error: NodeJS.ErrnoException) => (error.code === 'ENAMETOOLONG' ? 'blind' : null));
}

/**
 * The identity (`dev:ino`) of every regular file and directory an arm must never receive. First
 * the answer key, which is anything the runner can read under the skill's `evals/` and `fixtures/`:
 * links there, to files and to directories, are followed to any depth, since the runner reads
 * through them. Then everything that physically lies in the skill folder, links not followed: a
 * repository directory the skill folder links to is not the skill's own. Each directory is listed
 * once by identity, so chains and loops end, and is listed under its real path, so paths never grow
 * along a chain. No file is read: only names, types, identities and real paths. An entry the eval
 * cannot reach (a dangling link, a directory it may not search) is skipped, never thrown. The walk
 * is incomplete past `cap` entries, at a directory the eval may search but not list (a runner that
 * knows a name inside still reaches it), or at a path too long to resolve here; a directory the
 * eval may not search at all hides nothing it could reach.
 */
async function answerKey(skillDir: string, cap: number): Promise<Identity> {
  const ids = new Map<string, string>();
  const listed = new Set<string>();
  let visited = 0;
  const starts = [
    { start: join(skillDir, 'evals'), reason: WITHHELD.key, follow: true },
    { start: join(skillDir, 'fixtures'), reason: WITHHELD.key, follow: true },
    { start: skillDir, reason: WITHHELD.own, follow: false },
  ];
  for (const { start, reason, follow } of starts) {
    const unseen = (why: string): Identity => ({ ids, incomplete: `could not finish reading ${start} (${why})` });
    const queue = [start];
    for (let next = 0; next < queue.length; next += 1) {
      const path = queue[next]!;
      const info = await look(path);
      if (info === 'blind') return unseen(`a path too long to resolve: ${path}`);
      if (info === null) continue;
      const id = idOf(info);
      if (info.isFile()) {
        if (!ids.has(id)) ids.set(id, reason);
        continue;
      }
      if (!info.isDirectory() || listed.has(id)) continue;
      listed.add(id);
      if (!ids.has(id)) ids.set(id, reason);
      const dir = await realpath(path).catch(() => null);
      const children = dir === null ? null : await listing(dir);
      if (children === null) {
        // A runner that knows a name beneath a directory it may search still reaches it.
        if (await searchable(dir ?? path)) return unseen(`search-only directory ${dir ?? path}`);
        continue;
      }
      for (const entry of children) {
        visited += 1;
        if (visited > cap) return unseen(`more than ${cap.toLocaleString('en-US')} entries`);
        if (follow || !entry.isSymbolicLink()) queue.push(join(dir!, entry.name));
      }
    }
  }
  return { ids };
}

/**
 * Why staging never reads a real path, or null: `.git` or a `.claude/skills` tree anywhere
 * (measured from the repo root when the path is inside it); the skill folder, anything in it, or
 * an ancestor of it; `<root>/.claude/skills`, which may be a link, or an ancestor of it; and the
 * repo root or an ancestor. These fences are about where a path is; `answerKey` catches what a
 * file is, whatever its path. `node_modules` is not fenced by real path: a harness that links
 * `.claude/workflows` into an installed package, in the repository or under a global npm prefix,
 * is the skill's method. A token spelled through `node_modules` and a `node_modules` beneath a copy
 * root stay out.
 */
function refusal(fence: Fence, path: string): string | null {
  const parts = (inside(fence.root, path) ? relative(fence.root, path) : path).split(sep);
  if (gitTree(parts)) return WITHHELD.git;
  if (inside(fence.skill, path)) return ['evals', 'fixtures'].includes(folded(relative(fence.skill, path).split(sep)[0]!)) ? WITHHELD.key : WITHHELD.own;
  if (inside(path, fence.skill)) return WITHHELD.own;
  if (skillsTree(parts) || inside(fence.installed, path) || inside(path, fence.installed)) return WITHHELD.skills;
  if (inside(path, fence.root)) return WITHHELD.root;
  return null;
}

const fenced = (fence: Fence, path: string): boolean => refusal(fence, path) !== null;

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

/**
 * Resolve the immutable, run-wide dependency plan once before any arm sandbox is made. `entryCap`
 * bounds the identity walk (`answerKey`); callers leave it at `ANSWER_KEY_ENTRY_CAP`.
 */
export async function dependencyPlan(skillDir: string, cwd = process.cwd(), entryCap = ANSWER_KEY_ENTRY_CAP): Promise<DependencyPlan> {
  const skillFile = join(skillDir, 'SKILL.md');
  const source = await lstat(skillFile).then(async () => readFile(skillFile), () => Buffer.alloc(0));
  const text = decodeText(source) ?? '';
  const root = await repoRootFor(skillDir, cwd);
  const found: { token: string; copy: string; source: string }[] = [];
  /** Every named script, keyed by its folded repo-relative path. */
  const named = new Map<string, Named>();
  const missing: string[] = [];
  const withheld: { path: string; reason: string }[] = [];
  const tokens = [...scriptTokens(skillBody(text))].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
  // A SKILL.md that names no script has nothing to stage and nothing to fence.
  if (tokens.length === 0) return { repoRoot: root, staged: [], missing, skipped: [], withheld, copies: [], entries: [] };
  const declared = (hygieneFrontmatter(source) as { name?: unknown } | null | undefined)?.name;
  // The names skill staging may put this skill under: `.claude/skills/<name>/…` is its own file.
  const names = new Set([basename(resolve(skillDir)), ...(typeof declared === 'string' ? [declared] : [])].map(folded));
  const skill = await real(skillDir);
  const fence: Fence | null = root === null ? null : { root: await real(root), skill, installed: await real(join(root, '.claude', 'skills')) };
  // Walked once, and only when a script gets past the path fences.
  let walked: Promise<Identity> | undefined;
  const identity = (): Promise<Identity> => (walked ??= answerKey(skillDir, entryCap));
  for (const [key, token] of tokens) {
    const segments = key.split('/');
    if (gitTree(segments)) {
      // Spelled through `.git`: never the skill's method and never missing, but worth naming when it exists.
      if (root !== null && await isFile(resolve(root, key))) withheld.push({ path: token, reason: WITHHELD.git });
      continue;
    }
    const local = resolve(skillDir, key);
    // Already carried by the skill folder copy (evals/ and fixtures/ stay out on purpose).
    if (await isFile(local) && inside(skill, await real(local))) continue;
    const own = segments.length > 3 && folded(segments[0]!) === '.claude' && folded(segments[1]!) === 'skills' && names.has(folded(segments[2]!));
    if (own && await isFile(join(skillDir, ...segments.slice(3)))) continue;
    const candidate = root === null ? null : resolve(root, key);
    const info = candidate === null ? null : await stat(candidate).catch(() => null);
    // A script that resolves nowhere, a dangling link included, is the honest `missing` result.
    if (candidate === null || info === null) { missing.push(token); continue; }
    if (!info.isFile()) continue;
    // A `.claude/skills` tree at any depth belongs to skill staging or to another skill.
    if (skillsTree(segments)) { withheld.push({ path: token, reason: WITHHELD.skills }); continue; }
    // Tested on the repo-resolved real path, so a self reference by its repository path, a global
    // skill under a HOME-rooted repo, and a link into a skill or `.git` are all refused.
    const target = await real(candidate);
    const refused = refusal(fence!, target) ?? (await identity()).ids.get(idOf(info));
    if (refused !== undefined) { withheld.push({ path: token, reason: refused }); continue; }
    // A script the eval cannot read cannot travel: the same honest `missing` result, never a throw.
    if (!(await readable(target))) { missing.push(token); continue; }
    const parent = dirname(candidate);
    const parentReal = await real(parent);
    // The script travels alone when its directory is the repo root, a `.claude` directory (settings,
    // notes and skills live there), or would carry the skill folder or `.claude/skills`.
    const alone = parent === root || claudeDir(parent) || claudeDir(parentReal) || inside(parent, resolve(skillDir)) || fenced(fence!, parentReal);
    const to = relative(root!, candidate);
    named.set(folded(to), { to, from: target, bytes: info.size, dev: info.dev, ino: info.ino });
    found.push({ token, copy: alone ? to : relative(root!, parent), source: alone ? target : parentReal });
  }
  if (found.length === 0) return { repoRoot: root, staged: [], missing, skipped: [], withheld, copies: [], entries: [] };
  const { ids, incomplete } = await identity();
  // A file the walk never saw may be the answer key, so nothing travels (ruling d31ae2da).
  if (incomplete !== undefined) return { repoRoot: root, staged: [], missing, skipped: [], withheld, incomplete, copies: [], entries: [] };

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
    const listed = await copyEntries(fence!, ids, from, copy, named);
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
  return { repoRoot: root, staged, missing, skipped, withheld, copies, entries };
}

/**
 * Everything one copy root writes, parents first. The root itself may be a link's real target
 * (`dependencyPlan` resolved it). Beneath the root: no `node_modules`, `.git` or `__tests__`; nothing
 * landing in a `.claude/skills` tree or on `.claude/settings*.json`; nothing the fence refuses; no
 * file or directory whose identity is in `ids` (the skill folder and its answer key, whatever the
 * path: the directory around such a file still copies, with its other files); nothing the eval
 * cannot read (left out, never thrown); and no link, which is neither copied nor followed (§6.1): a
 * link can lead anywhere, a `.claude` directory or an unreadable one included, under a harmless
 * name. The one link read through is a named script itself, from the real target `dependencyPlan`
 * already fenced. Only regular files and directories are written; `fs.cp` would instead write each
 * link, rewritten to an absolute path into the live repository. Every entry costs a fixed number of
 * calls and set lookups, so a copy is linear in what it visits.
 */
async function copyEntries(fence: Fence, ids: Map<string, string>, source: string, copy: string, named: Map<string, Named>): Promise<DependencyEntry[]> {
  const info = await stat(source).catch(() => null);
  if (info === null) return [];
  if (!info.isDirectory()) return info.isFile() && !ids.has(idOf(info)) ? [{ from: source, to: copy, directory: false, bytes: info.size }] : [];
  const out: DependencyEntry[] = [{ from: source, to: copy, directory: true, bytes: 0 }];
  const scriptAt = (to: string): Named | undefined => named.get(folded(to));
  const walk = async (dir: string, landing: string, entries: Dirent[]): Promise<void> => {
    for (const entry of entries) {
      if (EXCLUDED.has(folded(entry.name))) continue;
      const from = join(dir, entry.name);
      const to = join(landing, entry.name);
      if (landingRefused(to) || fenced(fence, from)) continue;
      if (entry.isSymbolicLink()) {
        const script = scriptAt(to);
        const target = script === undefined ? null : await stat(from).catch(() => null);
        if (script !== undefined && target !== null && target.dev === script.dev && target.ino === script.ino) {
          out.push({ from: script.from, to, directory: false, bytes: script.bytes });
        }
      } else if (entry.isDirectory()) {
        const found = await stat(from).catch(() => null);
        const children = found === null || ids.has(idOf(found)) ? null : await listing(from);
        if (children === null) continue;
        out.push({ from, to, directory: true, bytes: 0 });
        await walk(from, to, children);
      } else if (entry.isFile()) {
        const file = await stat(from).catch(() => null);
        if (file?.isFile() && !ids.has(idOf(file)) && await readable(from)) out.push({ from, to, directory: false, bytes: file.size });
      }
    }
  };
  // A root that is itself a skill or answer-key directory hands over only the scripts named in it.
  const top = ids.has(idOf(info)) ? null : await listing(source);
  if (top !== null) {
    await walk(source, copy, top);
  } else {
    // A directory the eval may search but not list still hands over the scripts named in it.
    for (const script of named.values()) {
      if (folded(dirname(script.to)) === folded(copy)) out.push({ from: script.from, to: join(copy, basename(script.to)), directory: false, bytes: script.bytes });
    }
  }
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
  const held = new Set<string>();
  /** The path or one of its ancestors is a directory path the sandbox already holds as a file. */
  const underHeld = (path: string): boolean => {
    for (let at = path; ; at = dirname(at)) {
      if (held.has(at)) return true;
      if (dirname(at) === at) return false;
    }
  };
  for (const entry of plan.entries) {
    if (underHeld(entry.to)) continue;
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
      if (entry.directory) held.add(entry.to);
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
