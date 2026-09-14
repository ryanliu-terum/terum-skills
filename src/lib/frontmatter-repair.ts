import YAML from 'yaml';
import { FRONTMATTER } from './schema.js';

export type FrontmatterRepair =
  | { ok: true; source: string; rewritten: readonly string[] }
  | { ok: false; reason: 'no-frontmatter' | 'already-valid' | 'unrepairable'; detail: string };

/** A top-level `key: value` line whose value sits on the same line. Indented (nested) lines never match. */
/** The fault this repair covers: a colon-space, or a trailing colon, inside a bare scalar's text. */
const COLON_FAULT = /:(\s|$)/;
/** Values that open with a YAML indicator are structure, not prose, and are never rewritten. */
const INDICATOR = /^["'>|[{&*!%@`]/;
const SCALAR_LINE = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]+(\S.*)$/;

/**
 * Repair the one frontmatter fault an author cannot see: a bare scalar that YAML refuses. The
 * archetype is a `description:` whose prose contains `: ` — "ends in a triage: every finding" or a
 * trailing "Args: <path>" — which a strict parser reads as a mapping nested inside a mapping
 * ("Nested mappings are not allowed in compact mappings"). Claude Code's own loader splits on the
 * first colon and so never complains, which is why these files exist in the wild.
 *
 * The repair is line-local and value-preserving: only a top-level line that fails to parse ON ITS
 * OWN is touched, it is rewritten as the same key with the same text quoted the way the `yaml`
 * library would emit it, and every other byte (ordering, comments, the `metadata:` block, the body,
 * CRLF) survives untouched. The result is re-parsed and each rewritten key must read back as exactly
 * the text the author wrote after `key: `; anything else — a fault this rule does not cover, or a
 * rewrite that would change meaning — is reported as `unrepairable` rather than guessed at.
 */
export function repairFrontmatter(raw: string): FrontmatterRepair {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { ok: false, reason: 'no-frontmatter', detail: 'SKILL.md has no YAML frontmatter' };
  const block = match[1]!;
  let original: string;
  try { YAML.parse(block); return { ok: false, reason: 'already-valid', detail: 'frontmatter is already valid YAML' }; }
  catch (error) { original = error instanceof Error ? error.message : String(error); }

  const eol = /\r\n/.test(block) ? '\r\n' : '\n';
  const rewritten: string[] = [];
  const intended = new Map<string, string>();
  const lines = block.split(/\r?\n/).map((line) => {
    const scalar = SCALAR_LINE.exec(line);
    if (!scalar) return line;
    const [, key, text] = scalar as unknown as [string, string, string];
    const value = text.trim();
    // Only the colon fault, only on prose: a value opening with a YAML indicator (`[`, `{`, quotes,
    // block markers, anchors, tags) is structure the author meant, and quoting it would invent a string.
    if (!COLON_FAULT.test(value) || INDICATOR.test(value)) return line;
    try { YAML.parse(line); return line; } catch { /* This line is a culprit; quote it below. */ }
    intended.set(key, value); rewritten.push(key);
    // lineWidth 0 forbids folding, so the value stays on one line and only the quoting changes.
    return YAML.stringify({ [key]: value }, { lineWidth: 0 }).replace(/\r?\n$/, '');
  });
  if (rewritten.length === 0) return { ok: false, reason: 'unrepairable', detail: original };

  const repaired = lines.join(eol);
  let parsed: unknown;
  try { parsed = YAML.parse(repaired); } catch (error) { return { ok: false, reason: 'unrepairable', detail: error instanceof Error ? error.message : String(error) }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'unrepairable', detail: 'frontmatter is not a mapping' };
  for (const [key, value] of intended) {
    if ((parsed as Record<string, unknown>)[key] !== value) return { ok: false, reason: 'unrepairable', detail: `${key} would not read back as the text written after it` };
  }
  const start = match.index + match[0].indexOf(block);
  return { ok: true, source: `${raw.slice(0, start)}${repaired}${raw.slice(start + block.length)}`, rewritten };
}
