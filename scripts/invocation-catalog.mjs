#!/usr/bin/env node
// Regenerates the documentation half of src/lib/__tests__/invocation-catalog.ts.
//
// The invocation tripwire (src/lib/__tests__/invocation-tripwire.test.ts) requires every line of
// README.md, SECURITY.md, docs/**/*.md and the shipped /terum-skills manual that names the package or a verb to be
// catalogued by file and exact trimmed content. Source entries (src/**) stay hand-maintained: a new
// hint in code is a product decision and this script never touches those rows. Document rows are
// mechanical, so this script rewrites them from the current files using the same scan the test runs.
//
// Usage (after `npm run build`, because the verb list comes from dist/cli.js):
//   node scripts/invocation-catalog.mjs          # rewrite the document rows in place
//   node scripts/invocation-catalog.mjs --check  # exit 1 when the catalogue is out of date
//
// Review the diff in the same commit as the documentation change; the tripwire still fails CI when
// the two drift, which is the point.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const catalogPath = resolve(root, 'src/lib/__tests__/invocation-catalog.ts');
const check = process.argv.includes('--check');

const cliPath = resolve(root, 'dist/cli.js');
let buildProgram;
try {
  ({ buildProgram } = await import(pathToFileURL(cliPath).href));
} catch (error) {
  process.stderr.write(`Cannot load ${cliPath}: ${error instanceof Error ? error.message : String(error)}\nRun \`npm run build\` first.\n`);
  process.exit(2);
}

// Identical to the tripwire: every name in the whole command tree, longest first.
const names = command => command.commands.flatMap(child => [child.name(), ...names(child)]);
const verbs = [...new Set(names(buildProgram(async () => {})))].sort((a, b) => b.length - a.length).join('|');
const command = new RegExp('(?:`|^)(?:' + verbs + ')(?=[ `])');

const docs = (await readdir(resolve(root, 'docs'), { recursive: true }))
  .map(path => path.split('\\').join('/'))
  .filter(path => path.endsWith('.md'))
  .sort()
  .map(path => `docs/${path}`);
const documents = ['.claude/skills/terum-skills/SKILL.md', 'README.md', 'SECURITY.md', ...docs];

const source = await readFile(catalogPath, 'utf8');
const open = /\]\s*=\s*\[/.exec(source);
const close = source.lastIndexOf(']');
if (!open || close < open.index) {
  process.stderr.write(`${catalogPath}: cannot find the catalogue array literal.\n`);
  process.exit(2);
}
const arrayStart = open.index + open[0].length - 1;
const existing = JSON.parse(source.slice(arrayStart, close + 1));
const isDocument = row => documents.includes(row.file) || row.file.startsWith('docs/');
const kept = existing.filter(row => !isDocument(row));
// A row's policy is a human classification the test never asserts; keep it when the same
// file-and-content row already exists, and classify only rows that are new.
const policies = new Map(existing.filter(isDocument).map(row => [`${row.file}\n${row.pattern}`, row.policy]));

const rows = [];
for (const file of documents) {
  const lines = (await readFile(resolve(root, file), 'utf8')).split('\n');
  lines.forEach((line, index) => {
    if (line.includes('terum-skills') || command.test(line) || /"argv"\s*:/.test(line)) {
      const pattern = line.trim();
      rows.push({
        file,
        line: index + 1,
        policy: policies.get(`${file}\n${pattern}`) ?? (line.includes('npx -y terum-skills@latest') ? 'fixed' : 'prose'),
        pattern,
      });
    }
  });
}
const next = [...kept, ...rows];
const output = source.slice(0, arrayStart) + JSON.stringify(next, null, 2) + source.slice(close + 1);

if (output === source) {
  process.stderr.write(`Catalogue is current: ${kept.length} source rows, ${rows.length} document rows.\n`);
  process.exit(0);
}
if (check) {
  process.stderr.write(`Catalogue is out of date; run \`node scripts/invocation-catalog.mjs\`.\n`);
  process.exit(1);
}
await writeFile(catalogPath, output);
process.stderr.write(`Rewrote ${catalogPath}: ${kept.length} source rows kept, ${rows.length} document rows.\n`);
