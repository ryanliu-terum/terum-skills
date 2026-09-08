#!/usr/bin/env node
// Bundle the /terum-skills Claude Code skill into the build output. Reports on stderr: this runs
// under prepack, and `npm pack --json` output must stay parseable.
//
// The one canonical copy is .claude/skills/terum-skills/SKILL.md — the file this repository's own
// Claude Code harness loads. npm cannot ship it from there (listing a dot-directory in `files` also
// drags the harness README along), so `npm run build` copies it, byte for byte, to
// dist/claude/skills/terum-skills/SKILL.md, where src/lib/wrapper.ts resolves it from dist/lib.
// The frontmatter marker is asserted here because setup and uninstall recognise their own copy by it.
//
//   node scripts/bundle-skill.mjs [--out <dist-dir>]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outIndex = process.argv.indexOf('--out');
const out = outIndex >= 0 && process.argv[outIndex + 1] ? resolve(process.argv[outIndex + 1]) : join(root, 'dist');
const source = join(root, '.claude', 'skills', 'terum-skills', 'SKILL.md');
const target = join(out, 'claude', 'skills', 'terum-skills', 'SKILL.md');

const raw = await readFile(source, 'utf8');
const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
if (!frontmatter || !/^\s+managed-by:\s*terum-skills\s*$/m.test(frontmatter[1]) || !/^name:\s*terum-skills\s*$/m.test(frontmatter[1])) {
  console.error(`${source}: frontmatter must carry name: terum-skills and metadata.managed-by: terum-skills; setup could not recognise its own copy without them.`);
  process.exit(1);
}
await mkdir(dirname(target), { recursive: true });
await writeFile(target, raw);
console.error(`Bundled ${source} -> ${target}`);
