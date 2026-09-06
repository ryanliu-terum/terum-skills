import { access, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { exists } from './fs.js';
import { isSkillName, type Config } from './schema.js';

export interface LocalCandidates { names: string[]; omitted: { name: string; reason: string }[]; unreadable: number; }

/**
 * Directories directly under one agent skills root (`AGENT_PATHS['claude-code'].global(home)` — the only
 * root shipped; a project root needs an injected repo-root resolver, cf. install.ts:224-226) that carry
 * a SKILL.md, are not a `config.shared[*].source` and not a `config.placements` key (setup-hook spec
 * step 4; the exclusions setup.ts:64 used), and pass the one check share's inspectSource makes on the
 * name: frontmatter `name` equals the folder and is a legal skill name (share.ts:43, 229). Passing is
 * candidacy, not shareability — share still checks description, grants, privileged content, symlinks.
 * One unreadable folder is counted, never fatal; nothing is ever written.
 */
export async function localSkillCandidates(root: string, config: Pick<Config, 'shared' | 'placements'>): Promise<LocalCandidates> {
  const result: LocalCandidates = { names: [], omitted: [], unreadable: 0 };
  if (!(await exists(root))) return result;
  const excluded = new Set([...Object.values(config.shared).map((entry) => resolve(entry.source)), ...Object.keys(config.placements).map((path) => resolve(path))]);
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { result.unreadable += 1; return result; }
  for (const entry of entries) {
    const path = join(root, entry.name);
    try {
      if (!entry.isDirectory() || excluded.has(resolve(path))) continue;
      const skillPath = join(path, 'SKILL.md');
      try { await access(skillPath); } catch (error) {
        // Absence is not a candidate; all other probe failures count as unreadable below.
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') continue;
        throw error;
      }
      const reason = nameProblem(entry.name, await readFile(skillPath, 'utf8'));
      if (reason) result.omitted.push({ name: entry.name, reason }); else result.names.push(entry.name);
    } catch { result.unreadable += 1; }
  }
  result.names.sort();
  return result;
}

/** The name half of share's inspectSource (share.ts:226-229), as a reason string or undefined. */
function nameProblem(folder: string, source: string): string | undefined {
  if (!isSkillName(folder)) return 'folder name is not a legal skill name';
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return 'SKILL.md has no YAML frontmatter';
  let declared: unknown;
  try { declared = (YAML.parse(match[1]!) as { name?: unknown } | null)?.name; } catch { return 'SKILL.md frontmatter is not valid YAML'; }
  return declared === folder ? undefined : `SKILL.md name ${String(declared)} does not equal folder ${folder}`;
}
