import { createHash } from 'node:crypto';
import { z } from 'zod';
import YAML from 'yaml';

/** §5.4: GitHub's own syntax — 1–39 chars, ASCII alphanumerics and single internal hyphens, stored lowercased. */
export const HANDLE_RULE = 'a handle is 1-39 characters: letters, digits, and single internal hyphens (stored lowercase)';
export const handleSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().min(1).max(39).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, HANDLE_RULE));

/** Team names double as directory names under ~/.terum/skills/teams and as GitHub repo names. */
export const TEAM_NAME_RULE = 'a team name is 1-100 characters: letters, digits, dot, underscore, or hyphen, and cannot start with a dot';
export const teamNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/, TEAM_NAME_RULE);

export const skillIdSchema = z.uuid();
export const emailSchema = z.email();
/** GitHub login syntax, used wherever a value becomes part of a GitHub API path. */
export const githubLoginSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, 'a GitHub login is 1-39 letters, digits, or single internal hyphens');

export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).passthrough(),
  z.object({ kind: z.literal('project'), project: z.string().min(1) }).passthrough(),
]);
export function sameScope(a: unknown, b: unknown): boolean {
  const left = scopeSchema.safeParse(a); const right = scopeSchema.safeParse(b);
  if (!left.success || !right.success || left.data.kind !== right.data.kind) return false;
  return left.data.kind === 'global' || left.data.project === (right.data as { kind: 'project'; project: string }).project;
}

export const installedSchema = z.object({
  id: skillIdSchema,
  version: z.string().length(40).nullable(),
  scope: scopeSchema,
  since: z.string(),
}).passthrough();

export const teamSchema = z.object({
  layout_version: z.literal(2),
  name: z.string().min(1),
  categories: z.array(z.string()),
  global: z.array(skillIdSchema),
  projects: z.record(z.string(), z.object({ remotes: z.array(z.string()), skills: z.array(skillIdSchema) }).passthrough()),
  archived: z.array(handleSchema),
  policy: z.object({ publish: z.enum(['pr', 'push']), skill_license: z.string().min(1) }).passthrough(),
}).passthrough();
export type Team = z.infer<typeof teamSchema>;

export const personSchema = z.object({
  handle: handleSchema,
  display_name: z.string().min(1),
  email: emailSchema,
  github: githubLoginSchema,
  bio: z.string(),
  installed: z.array(installedSchema),
  declined: z.array(skillIdSchema),
}).passthrough();
export type Person = z.infer<typeof personSchema>;

/**
 * §5.4 per-team entry. `handle` is the binding identity and is immutable once its people file
 * exists; it is null until `team create`/`team join` has proven it against the roster (a
 * `login` that runs first stores only the remote and the token).
 */
const teamConfigSchema = z.object({ remote: z.string().min(1), token: z.string().nullable(), handle: handleSchema.nullable() }).passthrough();
export type TeamConfig = z.infer<typeof teamConfigSchema>;
export const configSchema = z.object({
  default_handle: handleSchema.optional(),
  email: emailSchema.optional(),
  display_name: z.string().min(1).optional(),
  github: z.string().optional(),
  teams: z.record(z.string(), teamConfigSchema),
  shared: z.record(z.string(), z.object({ source: z.string(), team: z.string(), baseline: z.string().optional() }).passthrough()),
  approvals: z.record(z.string(), z.object({ grants: z.string(), approved_at: z.string() }).passthrough()),
  pending: z.array(z.object({ op: z.enum(['install', 'uninstall']), id: skillIdSchema, team: z.string(), scope: scopeSchema, started: z.string() }).passthrough()),
  placements: z.record(z.string(), z.object({ id: skillIdSchema, team: z.string(), version: z.string().length(40).nullable(), scope: scopeSchema, placed_at: z.string(), fingerprint: z.string() }).passthrough()),
}).passthrough();
export type Config = z.infer<typeof configSchema>;

export const emptyConfig = (): Config => ({ teams: {}, shared: {}, approvals: {}, pending: [], placements: {} });

/** §5.3: only Agent-Skills-legal top-level keys; everything custom nests under `metadata`. */
export const skillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string(),
  metadata: z.object({ id: skillIdSchema, author: z.string(), 'terum-category': z.string() }).passthrough(),
  'allowed-tools': z.unknown().optional(),
}).strict();
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export type AllowedTools = { ok: true; normalized: string; hash: string } | { ok: false; raw: unknown };

/**
 * §5.4 grant normalization. Absent, or present and empty (`[]`, `""`, or a bare `allowed-tools:`
 * line, which YAML reads as null) ⇒ the literal `none`. A sequence of strings or one
 * comma-separated string normalizes (split, trim, drop empties, de-duplicate, sort, join with
 * `\n`). Anything else is malformed: it never normalizes and never hashes.
 */
export function allowedTools(value: unknown): AllowedTools {
  if (value === undefined || value === null) return hashed('none');
  let pieces: string[];
  if (typeof value === 'string') pieces = value.split(',');
  else if (Array.isArray(value) && value.every((part) => typeof part === 'string')) pieces = value as string[];
  else return { ok: false, raw: value };
  const normalized = [...new Set(pieces.map((part) => part.trim()).filter(Boolean))].sort().join('\n') || 'none';
  return hashed(normalized);
}

function hashed(normalized: string): AllowedTools & { ok: true } {
  return { ok: true, normalized, hash: `sha256:${createHash('sha256').update(normalized).digest('hex')}` };
}

const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Parse a whole SKILL.md: the YAML block between the first two `---` lines, then the schema. */
export function parseSkillFrontmatter(source: string): { ok: true; data: SkillFrontmatter; grants: AllowedTools } | { ok: false; error: string } {
  const match = FRONTMATTER.exec(source);
  if (!match) return { ok: false, error: 'SKILL.md has no YAML frontmatter' };
  const document = YAML.parseDocument(match[1]!);
  if (document.errors.length > 0) return { ok: false, error: document.errors.map((error) => error.message).join('; ') };
  const raw = document.toJS() as unknown;
  const parsed = skillFrontmatterSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, data: parsed.data, grants: allowedTools(parsed.data['allowed-tools']) };
}

/** Human-readable zod issues: `field: message; field2: message`. */
export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.length ? issue.path.join('.') + ': ' : ''}${issue.message}`).join('; ');
}

export function parseJson<T>(schema: z.ZodType<T>, value: string, path: string): T {
  let raw: unknown;
  try { raw = JSON.parse(value); } catch (error) { throw new Error(`Invalid ${path}: ${error instanceof Error ? error.message : String(error)}`); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid ${path}: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

/** `schema.parse` with the rule text instead of a JSON issue dump. */
export function parseOrExplain<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${what}: ${describeIssues(parsed.error)}`);
  return parsed.data;
}
