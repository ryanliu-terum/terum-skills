import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { isManagedSkill } from '../lib/wrapper.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

/** The paths the release workflow refuses to publish without: parsed out of the literal array in release.yml. */
async function mustList(): Promise<string[]> {
  const workflow = await readFile(resolve(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const match = /for \(const must of (\[[^\]]*\])\)/.exec(workflow);
  if (!match) throw new Error('release.yml no longer carries the tarball must-list (`for (const must of [...])`)');
  return JSON.parse(match[1]!) as string[];
}

/** Every marked skill under .claude/skills — what scripts/bundle-skill.mjs bundles. */
async function markedSkills(): Promise<string[]> {
  const skills = resolve(root, '.claude', 'skills');
  const names: string[] = [];
  for (const entry of await readdir(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try {
      raw = await readFile(resolve(skills, entry.name, 'SKILL.md'), 'utf8');
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (isManagedSkill(raw)) names.push(entry.name);
  }
  return names.sort();
}

it('the release tarball must-list names every marked skill under .claude/skills, nothing else under dist/claude/skills, and the fixed files', async () => {
  const must = await mustList();
  const marked = await markedSkills();
  expect(marked.length).toBeGreaterThan(0);
  expect(must.filter((path) => path.startsWith('dist/claude/skills/')).sort()).toEqual(marked.map((name) => `dist/claude/skills/${name}/SKILL.md`));
  for (const fixed of ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/index.js', 'dist/claude/hooks/terum-skills-edit.mjs']) expect(must).toContain(fixed);
});
