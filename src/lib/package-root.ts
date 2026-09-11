import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_NAME } from './package.js';

/** Find our own manifest from source, emitted modules, or the bundled entry; memoize per caller. */
const cache = new Map<string, string | null>();
export function packageRoot(from: string = fileURLToPath(import.meta.url)): string | null {
  const cached = cache.get(from);
  if (cached !== undefined) return cached;
  let directory = dirname(from);
  for (;;) {
    let name: unknown;
    try { name = (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: unknown }).name; }
    catch { name = undefined; }
    if (name === PACKAGE_NAME) { cache.set(from, directory); return directory; }
    const parent = dirname(directory);
    if (parent === directory) { cache.set(from, null); return null; }
    directory = parent;
  }
}
