/** Deterministic, in-memory skill hygiene checks (eval spec §9). */
import YAML from 'yaml';
import { CREDENTIAL_PATTERNS } from './receipt.js';
import { allowedTools, describeRaw, FRONTMATTER, skillFrontmatterSchema } from '../schema.js';

export interface HygieneFinding { code: 'HYG1' | 'HYG2' | 'HYG3' | 'HYG4' | 'HYG5' | 'HYG6'; path: string; line?: number; message: string; }
export interface HygieneInput {
  name: string;
  frontmatter: unknown;
  files: Map<string, Buffer>;
  executable: ReadonlySet<string>;
  policy: { skill_license: string };
  /** Explicit `--allow-privileged` consent (or content whose repository copy already carries the
   *  consented form): waives HYG4's exec-bit and shebang findings only — the extension allowlist
   *  and every other check still apply (walk D5, Ryan 2026-09-07). */
  allowExecutable?: boolean;
}

const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.toml', '.xml', '.html', '.css', '.js', '.ts', '.py', '.sh', '.sql', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']);
const INVISIBLE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF]/u;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar', 'Georgian', 'Hangul', 'Ethiopic', 'Cherokee', 'Canadian_Aboriginal', 'Ogham', 'Runic', 'Khmer', 'Mongolian', 'Hiragana', 'Katakana', 'Bopomofo', 'Han', 'Yi', 'Old_Italic', 'Gothic', 'Deseret', 'Inherited', 'Common'] as const;
const SCRIPT_PATTERNS = SCRIPTS.map((script) => [script, new RegExp(`^\\p{Script=${script}}$`, 'u')] as const);

/** Parse the YAML portion without validating it, so HYG1 owns the strict-schema decision. */
export function hygieneFrontmatter(source: Buffer): unknown {
  const text = decodeText(source);
  if (text === undefined) return undefined;
  const match = FRONTMATTER.exec(text);
  if (!match) return undefined;
  try { return YAML.parse(match[1]!); } catch { return undefined; }
}

/** The §9 pure API: callers supply file bytes and observed executable bits. */
export function inspectHygiene(input: HygieneInput): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  const skill = input.files.get('SKILL.md');
  const parsed = skillFrontmatterSchema.safeParse(input.frontmatter);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue !== undefined && issue.path.length ? `field ${issue.path.join('.')}` : 'frontmatter';
    findings.push({ code: 'HYG1', path: 'SKILL.md', message: `SKILL.md ${where} is invalid${issue === undefined ? '' : `: ${issue.message}`} (allowed top-level fields: name, description, license, metadata, allowed-tools).` });
  } else if (parsed.data.name !== input.name) {
    findings.push({ code: 'HYG1', path: 'SKILL.md', line: lineOf(skill, /^name\s*:/m), message: `SKILL.md name ${parsed.data.name} does not equal folder ${input.name}.` });
  } else {
    const grants = allowedTools(parsed.data['allowed-tools']);
    if (!grants.ok) {
      const line = lineOf(skill, /^allowed-tools\s*:/m);
      findings.push({ code: 'HYG1', path: 'SKILL.md', ...(line === undefined ? {} : { line }), message: `${input.name}: allowed-tools is malformed${line === undefined ? '' : ` (SKILL.md line ${line})`}: ${describeRaw(grants.raw)}. Use a YAML list of tool patterns, or one comma-separated string.` });
    }
  }

  const author = parsed.success ? authorEmail(parsed.data.metadata.author) : undefined;
  for (const [path, contents] of input.files) {
    const text = decodeText(contents);
    if (text !== undefined) {
      const invisible = INVISIBLE.exec(text);
      const mixed = invisible ? undefined : mixedScriptOffset(text);
      if (invisible || mixed !== undefined) {
        const offset = invisible?.index ?? mixed!;
        findings.push({ code: 'HYG2', path, line: lineAt(text, offset), message: invisible ? 'Contains a bidi control or zero-width character.' : 'Contains a whitespace-delimited token that mixes Unicode scripts.' });
      }
      const credential = credentialOffset(text);
      const foreignEmail = emailOffset(text, author);
      if (credential !== undefined || foreignEmail !== undefined) {
        const offset = credential ?? foreignEmail!;
        findings.push({ code: 'HYG3', path, line: lineAt(text, offset), message: credential !== undefined ? 'Contains a credential-shaped value.' : 'Contains an email address that is not the skill author.' });
      }
    }
    const dot = path.lastIndexOf('.');
    const extension = dot <= path.lastIndexOf('/') ? '' : path.slice(dot).toLowerCase();
    const shebang = text?.startsWith('#!') ?? false;
    const executableForm = !input.allowExecutable && (input.executable.has(path) || shebang);
    if (executableForm || !ALLOWED_EXTENSIONS.has(extension)) {
      findings.push({ code: 'HYG4', path, message: executableForm ? (input.executable.has(path) ? 'File has an executable mode.' : 'File begins with a shebang.') : `File extension ${extension || '(none)'} is not allowlisted.` });
    }
  }

  if (parsed.success) {
    const licenses = [normalizeLicense(parsed.data.license), normalizeLicense(input.policy.skill_license)];
    for (const [path, contents] of input.files) if (/^LICENSE[^/]*$/i.test(path)) {
      const text = decodeText(contents);
      const detected = text === undefined ? undefined : detectLicense(text);
      if (detected !== undefined) licenses.push(detected);
    }
    if (new Set(licenses).size > 1) findings.push({ code: 'HYG5', path: 'SKILL.md', line: lineOf(skill, /^license\s*:/m), message: 'Frontmatter, team policy, and bundled LICENSE files must declare the same license.' });
  }
  const skillText = skill === undefined ? undefined : decodeText(skill);
  if ((skillText?.length ?? 0) > 20_000) findings.push({ code: 'HYG6', path: 'SKILL.md', message: 'SKILL.md exceeds 20,000 characters.' });
  const description = parsed.success ? parsed.data.description : recordValue(input.frontmatter, 'description');
  if (typeof description !== 'string' || !description.trim()) findings.push({ code: 'HYG6', path: 'SKILL.md', line: lineOf(skill, /^description\s*:/m), message: 'description must not be empty.' });
  return findings;
}

export function formatHygieneFindings(findings: readonly HygieneFinding[]): string {
  return findings.map((finding) => `${finding.code} ${finding.path}${finding.line === undefined ? '' : `:${finding.line}`}: ${finding.message}`).join('\n');
}

function decodeText(contents: Buffer): string | undefined {
  if (contents.subarray(0, 8192).includes(0)) return undefined;
  // ignoreBOM keeps a leading U+FEFF in the decoded text so HYG2 can see it — the default
  // decoder strips it, which would exempt exactly one of the code points HYG2 names (review P2).
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contents); } catch { return undefined; }
}
function lineOf(contents: Buffer | undefined, expression: RegExp): number | undefined {
  const text = contents === undefined ? undefined : decodeText(contents); const match = text === undefined ? undefined : expression.exec(text);
  return match === undefined || match === null ? undefined : lineAt(text!, match.index);
}
function lineAt(text: string, offset: number): number { return text.slice(0, offset).split('\n').length; }
function mixedScriptOffset(text: string): number | undefined {
  for (const match of text.matchAll(/\S+/gu)) {
    const scripts = new Set<string>();
    for (const char of match[0]) if (/^\p{L}$/u.test(char)) {
      const script = SCRIPT_PATTERNS.find(([, expression]) => expression.test(char))?.[0];
      // A letter matching none of the enumerated scripts still counts as one distinct script:
      // the spec exempts only Common/Inherited, and treating unlisted scripts (Adlam, Tifinagh, …)
      // as neutral would let a Latin+unlisted homoglyph token pass (review P2).
      if (script === undefined) scripts.add('Unknown');
      else if (script !== 'Common' && script !== 'Inherited') scripts.add(script);
    }
    if (scripts.size > 1) return match.index;
  }
  return undefined;
}
function credentialOffset(text: string): number | undefined {
  for (const pattern of CREDENTIAL_PATTERNS) { const match = new RegExp(pattern.source, pattern.flags).exec(text); if (match) return match.index; }
  return undefined;
}
function authorEmail(author: string): string | undefined { return /<([^<>]+)>/.exec(author)?.[1]; }
function recordValue(value: unknown, key: string): unknown { return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined; }
function emailOffset(text: string, author: string | undefined): number | undefined {
  for (const match of text.matchAll(EMAIL)) {
    const email = match[0]; const at = email.lastIndexOf('@'); const local = email.slice(0, at); const domain = email.slice(at + 1).toLowerCase();
    if (domain === 'example.com' || domain === 'example.org' || domain === 'example.net' || domain.endsWith('.invalid') || domain.endsWith('.test')) continue;
    if (author !== undefined) { const authorAt = author.lastIndexOf('@'); if (authorAt > 0 && local === author.slice(0, authorAt) && domain === author.slice(authorAt + 1).toLowerCase()) continue; }
    return match.index;
  }
  return undefined;
}
function normalizeLicense(value: string): string { return value.trim().toLowerCase().replace(/^apache license(?:,)? version 2\.0$/i, 'apache-2.0').replace(/^mit license$/i, 'mit').replace(/^bsd 3-clause(?: license)?$/i, 'bsd-3-clause'); }
function detectLicense(text: string): string | undefined {
  const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/i.exec(text)?.[1];
  if (spdx) return normalizeLicense(spdx);
  if (/apache license[\s\S]{0,100}version 2\.0/i.test(text)) return 'apache-2.0';
  if (/\bmit license\b/i.test(text)) return 'mit';
  if (/\bbsd 3-clause\b/i.test(text)) return 'bsd-3-clause';
  return undefined;
}
