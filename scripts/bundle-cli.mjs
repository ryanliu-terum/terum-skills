#!/usr/bin/env node
// Bundle the emitted CLI in place, keeping the tree for debugging and direct module consumers.
// Report on stderr so npm pack --json remains parseable. Dependencies are inlined: ESM loader
// filesystem work dominates short-lived CLI startup, especially on Windows (W-02).
import { build } from 'esbuild';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outIndex = process.argv.indexOf('--out');
const out = outIndex >= 0 && process.argv[outIndex + 1] ? resolve(process.argv[outIndex + 1]) : join(root, 'dist');
const entry = join(out, 'index.js');
const staging = join(out, '.bundle');
const staged = join(staging, 'index.js');

await stat(entry).catch(() => { console.error(`${entry}: missing; run tsc -p tsconfig.build.json first.`); process.exit(1); });
const result = await build({
  entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: staged, splitting: false, sourcemap: true, minify: false, logLevel: 'silent',
  // Bundled CommonJS dependencies need require in ESM output.
  banner: { js: 'import { createRequire as __terumCreateRequire } from "node:module";\nconst require = __terumCreateRequire(import.meta.url);' },
});
for (const warning of result.warnings) console.error(`bundle-cli: ${warning.text}`);
const first = (await readFile(staged, 'utf8')).split('\n', 1)[0];
if (first !== '#!/usr/bin/env node') {
  console.error(`${staged}: the bundle lost its shebang (first line was ${JSON.stringify(first)}); the bin would not be executable.`);
  process.exit(1);
}
// esbuild writes `sources` relative to the directory it wrote the map into, and the bundle is staged one
// directory below where it lands. Re-anchor every entry to `out` before writing the map there; a plain
// rename would leave every path one level too high and no frame in the shipped map would resolve.
const map = JSON.parse(await readFile(`${staged}.map`, 'utf8'));
if (!Array.isArray(map.sources)) {
  console.error(`${staged}.map: no sources array; the sourcemap esbuild wrote is not usable.`);
  process.exit(1);
}
// esbuild uses `<name>` for generated, file-less inputs (banner, define shims); those are not paths.
map.sources = map.sources.map((source) => (typeof source === 'string' && !source.startsWith('<') ? relative(out, resolve(staging, source)).split(sep).join('/') : source));
await writeFile(`${entry}.map`, JSON.stringify(map));
await rename(staged, entry);
await rm(staging, { recursive: true, force: true });
console.error(`Bundled ${entry} (one file, deps inlined)`);
