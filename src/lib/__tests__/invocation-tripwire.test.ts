import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { invocationLiteralCatalog } from './invocation-catalog.js';
import type { Command } from 'commander';
import { buildProgram } from '../../cli.js';

it('allows source and documentation command literals only at explicitly catalogued file-and-line-content patterns', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const src = resolve(root, 'src');
  const hits: { file: string; pattern: string }[] = [];
  for (const entry of await readdir(src, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = resolve(entry.parentPath, entry.name);
    if (path.split(sep).includes('__tests__')) continue;
    // Catalog keys are spelled with `/`; `relative` uses the host separator. Lines are read as LF whatever autocrlf did.
    const file = relative(root, path).split(sep).join('/');
    for (const line of (await readFile(path, 'utf8')).replaceAll('\r\n', '\n').split('\n')) {
      // Stronger than the required npx-prefix/bare-verb search: inventory every package literal,
      // plus the fixed executable-less admin handoffs, so a new uncatalogued hint cannot drift.
      if (line.includes('terum-skills') || /(?:run \\`team remove|ask an admin to \\`team remove|Re-run team remove|run team leave <team>)/.test(line)) hits.push({ file, pattern: line.trim() });
    }
  }
  // B7: the shipped manual and public docs are invocation producers too. Include bare command
  // spans as well as package-prefixed commands; additions and removals both require review.
  // Every name in the command TREE counts, not only program's direct children: `migrate`, `move`,
  // `add`, `member` … are grandchildren, and a doc line under a "### team" heading that names only
  // `create [name]` must be catalogued like one that names `team create` (B7 review r1, medium).
  const names = (command: Command): string[] => command.commands.flatMap(child => [child.name(), ...names(child)]);
  const verbs = [...new Set(names(buildProgram(async () => {})))].sort((a, b) => b.length - a.length).join('|');
  const command = new RegExp('(?:`|^)(?:' + verbs + ')(?=[ `])');
  const documents = ['.claude/skills/terum-skills/SKILL.md', 'README.md', 'SECURITY.md',
    ...(await readdir(resolve(root, 'docs'), { recursive: true })).filter(path => path.endsWith('.md')).map(path => `docs/${path}`)];
  for (const file of documents) {
    for (const line of (await readFile(resolve(root, file), 'utf8')).replaceAll('\r\n', '\n').split('\n')) {
      if (line.includes('terum-skills') || command.test(line) || /"argv"\s*:/.test(line)) hits.push({ file, pattern: line.trim() });
    }
  }
  const key = (value: { file: string; pattern: string }) => `${value.file}: ${value.pattern}`;
  expect(hits.map(key).sort()).toEqual(invocationLiteralCatalog.map(key).sort());
});
