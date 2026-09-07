import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { allowedTools, describeRaw, FRONTMATTER, isSkillName } from './schema.js';

export { FRONTMATTER } from './schema.js';
export type SourceProblem = 'symlink' | 'not-a-directory' | 'skill-md-missing' | 'skill-md-not-a-file' | 'no-frontmatter' | 'invalid-yaml' | 'illegal-name' | 'name-mismatch' | 'description-missing' | 'unsupported-field' | 'malformed-allowed-tools' | 'nested-symlink';
type SourceInspection = { ok: true; description: string } | { ok: false; reason: SourceProblem; detail: string };

/** Terminal rendering only: filesystem paths and ledger values retain their original bytes. */
export function printable(value: string): string { return value.replace(/\p{Cc}/gu, '?'); }

/** A tracked source may have been relocated; only initial imports enforce the folder's name. */
export function inspectSkillSource(raw: string, folderName?: string): SourceInspection {
  const result = inspect(raw, folderName);
  if (result.ok) return result;
  return { ok: false, reason: result.reason, detail: result.detail };
}

/** Share keeps its established refusal messages; discovery exposes the more precise reason. */
export function assertSkillSource(raw: string, folderName: string): string {
  const result = inspect(raw, folderName);
  if (!result.ok) throw new Error(result.reason === 'unsupported-field' ? printable(result.shareMessage) : result.shareMessage);
  return result.description;
}

function inspect(raw: string, folderName?: string): { ok: true; description: string } | { ok: false; reason: SourceProblem; detail: string; shareMessage: string } {
  const reject = (reason: SourceProblem, detail: string, shareMessage = detail) => ({ ok: false as const, reason, detail, shareMessage });
  if (folderName !== undefined && !isSkillName(folderName)) return reject('illegal-name', 'folder name is not a legal skill name (1–64 lowercase alphanumerics or single hyphens)', `Skill name ${folderName} must be 1–64 lowercase alphanumerics or single hyphens.`);
  const match = FRONTMATTER.exec(raw);
  if (!match) return reject('no-frontmatter', 'SKILL.md has no YAML frontmatter', 'SKILL.md has no YAML frontmatter.');
  let parsed: Record<string, unknown> | null;
  try { parsed = YAML.parse(match[1]!) as Record<string, unknown> | null; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reject('invalid-yaml', `SKILL.md frontmatter is not valid YAML: ${message}`, message);
  }
  const legacyNameMessage = `SKILL.md name must equal folder ${folderName} and description is required.`;
  if (folderName !== undefined && parsed?.name !== folderName) return reject('name-mismatch', `SKILL.md name ${String(parsed?.name)} does not equal folder ${folderName}`, legacyNameMessage);
  if (!parsed || typeof parsed.description !== 'string') return reject('description-missing', 'description is missing', legacyNameMessage);
  for (const key of Object.keys(parsed)) {
    if (!['name', 'description', 'license', 'metadata', 'allowed-tools'].includes(key)) return reject('unsupported-field', `unsupported top-level field ${key} (only name, description, license, metadata, allowed-tools)`);
  }
  // Discovery needs a candidate/omission reason. Share itself deliberately does not call this
  // validator: its assembled post-injection candidate goes through the single HYG1 path instead.
  const grants = allowedTools(parsed['allowed-tools']);
  if (!grants.ok) {
    const line = raw.split(/\r?\n/).findIndex((text) => /^allowed-tools\s*:/.test(text)) + 1;
    return reject('malformed-allowed-tools', `allowed-tools is malformed (SKILL.md line ${line})`, `${folderName}: allowed-tools is malformed${line ? ` (SKILL.md line ${line})` : ''}: ${describeRaw(grants.raw)}. Use a YAML list of tool patterns, or one comma-separated string.`);
  }
  return { ok: true, description: parsed.description };
}

/** File bytes and the mode facts hygiene needs; callers validate the directory/symlink invariant first. */
export async function sourceFiles(root: string): Promise<{ files: Map<string, Buffer>; executable: Set<string> }> {
  const files = new Map<string, Buffer>(); const executable = new Set<string>();
  async function walk(current: string, relative = ''): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const next = join(current, entry.name); const key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(next, key);
      else if (entry.isFile()) {
        files.set(key, await readFile(next));
        if ((await lstat(next)).mode & 0o111) executable.add(key);
      }
    }
  }
  await walk(root);
  return { files, executable };
}

/** One sequential walk, retaining the first nested link without ever following it. */
export async function scanSkillFolder(path: string): Promise<{ symlink?: string; privileged: boolean }> {
  let details;
  try { details = await stat(path); } catch { throw new Error(`${path} is not a skill folder.`); }
  if (!details.isDirectory()) throw new Error(`${path} is not a skill folder.`);
  const result: { symlink?: string; privileged: boolean } = { privileged: false };
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const next = join(current, entry.name);
      if (entry.isSymbolicLink()) { result.symlink ??= resolve(next); continue; }
      if ((entry.isDirectory() || entry.isFile()) && (entry.name === '.claude-plugin' || /^hooks?$/i.test(entry.name))) result.privileged = true;
      if (entry.isDirectory()) await visit(next);
    }
  }
  await visit(path);
  return result;
}

/** Explicit paths preserve share's stat-based top-level link policy and refusal text. */
export async function assertSkillDirectory(path: string): Promise<{ privileged: boolean }> {
  const scan = await scanSkillFolder(path);
  if (scan.symlink) throw new Error(`Skill folder contains symlink ${scan.symlink}.`);
  return scan;
}
