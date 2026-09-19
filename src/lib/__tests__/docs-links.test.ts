import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Every relative link in the public documentation must resolve to a file in the repository, and
// every `#fragment` on such a link must name a heading in the target file (GitHub's slug rule:
// lower-case, drop everything except letters, digits, spaces, hyphens and underscores, spaces to
// hyphens, then -1, -2 … for repeats). External links are not fetched; this is a rot check for the
// tree, not a network check.
const root = fileURLToPath(new URL('../../../', import.meta.url));

const slug = (heading: string): string => heading
  .replace(/`([^`]*)`/g, '$1')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N} _-]/gu, '')
  .replace(/ /g, '-');

const anchors = (markdown: string): Set<string> => {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = slug(heading[1] ?? '');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.add(count === 0 ? base : `${base}-${count}`);
  }
  return out;
};

// Links outside fenced blocks and inline code spans: `[text](target)` and `![alt](target)`.
const links = (markdown: string): { target: string; line: number }[] => {
  const out: { target: string; line: number }[] = [];
  let fenced = false;
  markdown.split('\n').forEach((raw, index) => {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; return; }
    if (fenced) return;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) if (match[1] !== undefined) out.push({ target: match[1], line: index + 1 });
  });
  return out;
};

it('every relative link in README.md and docs/**/*.md resolves, fragments included', async () => {
  const documents = ['README.md',
    ...(await readdir(resolve(root, 'docs'), { recursive: true })).map(path => path.split('\\').join('/')).filter(path => path.endsWith('.md')).sort().map(path => `docs/${path}`)];
  for (const optional of ['CONTRIBUTING.md', 'CHANGELOG.md']) {
    if (await stat(resolve(root, optional)).then(() => true, () => false)) documents.push(optional);
  }
  const headings = new Map<string, Set<string>>();
  const broken: string[] = [];
  for (const file of documents) {
    const markdown = await readFile(resolve(root, file), 'utf8');
    for (const { target, line } of links(markdown)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http, https, mailto …
      const [path = '', fragment] = target.split('#');
      const resolved = path === '' ? resolve(root, file) : resolve(root, dirname(file), decodeURI(path));
      const inside = relative(root, resolved);
      if (inside.startsWith('..')) { broken.push(`${file}:${line}: ${target} leaves the repository`); continue; }
      const exists = await stat(resolved).then(info => info.isFile(), () => false);
      if (!exists) { broken.push(`${file}:${line}: ${target} does not exist`); continue; }
      if (fragment === undefined) continue;
      if (!headings.has(inside)) headings.set(inside, inside.endsWith('.md') ? anchors(await readFile(resolved, 'utf8')) : new Set());
      if (!headings.get(inside)?.has(fragment.toLowerCase())) broken.push(`${file}:${line}: ${target} names no heading in ${inside}`);
    }
  }
  expect(broken).toEqual([]);
});
