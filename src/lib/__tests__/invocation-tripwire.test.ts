import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { invocationLiteralCatalog } from './invocation-catalog.js';

it('allows source command literals only at explicitly catalogued file-and-line-content patterns', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const src = resolve(root, 'src');
  const hits: { file: string; pattern: string }[] = [];
  for (const entry of await readdir(src, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = resolve(entry.parentPath, entry.name);
    if (path.split('/').includes('__tests__')) continue;
    const file = relative(root, path);
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      // Stronger than the required npx-prefix/bare-verb search: inventory every package literal,
      // plus the fixed executable-less admin handoffs, so a new uncatalogued hint cannot drift.
      if (line.includes('terum-skills') || /(?:run \\`team remove|ask an admin to \\`team remove|Re-run team remove|run team leave <team>)/.test(line)) hits.push({ file, pattern: line.trim() });
    }
  }
  const key = (value: { file: string; pattern: string }) => `${value.file}: ${value.pattern}`;
  expect(hits.map(key).sort()).toEqual(invocationLiteralCatalog.map(key).sort());
});
