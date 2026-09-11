import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The desktop bundle is a browser bundle. Anything it imports from the root CLI tree drags that module's
 * whole graph in, and one transitive `node:` builtin is externalised at build time and throws in the page
 * rather than at compile time — `node:tty.isatty` reached the browser exactly this way when the serve
 * allow-list was imported from `src/lib/frames.js`.
 *
 * The rule this pins: a desktop source file may import from the root `src/` tree only if the target is a
 * leaf that imports nothing at all. Type-only imports are erased and are exempt.
 */
const here = dirname(fileURLToPath(import.meta.url));
const desktopSrc = resolve(here, '../../..');
const repoRoot = resolve(desktopSrc, '../..');

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

/** Every `from '...'` that walks out of desktop/ into the repo's own src/, excluding `import type`. */
function crossTreeImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+(type\s+)?([^;]*?)\bfrom\s+'([^']+)'/g)) {
    const [, typeOnly, clause, specifier] = match;
    if (typeOnly) continue;
    if (clause && /^\s*\{\s*type\s/.test(clause) && !/,/.test(clause)) continue;
    if (specifier?.includes('../../../../src/')) specifiers.push(specifier);
  }
  return specifiers;
}

describe('desktop imports from the CLI tree', () => {
  it('only reach leaves that import nothing, so no node: builtin can enter the browser bundle', async () => {
    const files = await sourceFiles(desktopSrc);
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes(`${join('', '__tests__')}`) || /\.test\.tsx?$/.test(file)) continue;
      for (const specifier of crossTreeImports(await readFile(file, 'utf8'))) {
        const target = resolve(repoRoot, 'src', specifier.split('../../../../src/')[1]!).replace(/\.js$/, '.ts');
        const targetSource = await readFile(target, 'utf8').catch(() => null);
        if (targetSource === null) { offenders.push(`${file} -> ${specifier} (no such file)`); continue; }
        // A leaf has no value imports and no requires; type-only imports are erased before the bundle.
        const leaf = !/(?:^|\n)\s*import\s+(?!type\s)/.test(targetSource) && !/\brequire\s*\(/.test(targetSource);
        if (!leaf) offenders.push(`${file} -> ${specifier} is not a leaf`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
