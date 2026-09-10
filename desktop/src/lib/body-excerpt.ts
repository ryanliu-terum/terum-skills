/**
 * One-line card summary from a SKILL.md body (the post-frontmatter markdown): the first paragraph —
 * or the first three non-empty lines when the body opens with a list — flattened to plain text.
 * Ratified decision (teddyzheng, 2026-09-08): cards summarize from the body, frontmatter
 * `description:` is the fallback — callers write `bodyExcerpt(row.body) ?? row.description`.
 */
const EXCERPT_MAX = 200;
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;

function flattenLine(line: string): string {
  return line
    .replace(/^(?:>\s*)+/, '')
    .replace(LIST_MARKER, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '');
}

export function bodyExcerpt(body: string | null): string | null {
  if (body === null) return null;
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === '') start++;
  // Leading headings are titles or section labels, not the summary.
  while (start < lines.length && /^#{1,6}\s/.test(lines[start]!.trim())) {
    start++;
    while (start < lines.length && lines[start]!.trim() === '') start++;
  }
  if (start >= lines.length) return null;
  const block: string[] = [];
  if (LIST_MARKER.test(lines[start]!.trim().replace(/^(?:>\s*)+/, ''))) {
    for (let i = start; i < lines.length && block.length < 3; i++) {
      const line = lines[i]!.trim();
      if (line !== '') block.push(line);
    }
  } else {
    for (let i = start; i < lines.length && lines[i]!.trim() !== ''; i++) block.push(lines[i]!.trim());
  }
  const flat = block.map(flattenLine).join(' ').replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  return flat.length > EXCERPT_MAX ? flat.slice(0, EXCERPT_MAX - 1).trimEnd() + '…' : flat;
}
