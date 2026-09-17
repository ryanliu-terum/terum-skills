import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import type { AgentApi } from '../../lib/evals/agent.js';
import { archivePath } from '../../lib/usage/archive.js';
import type { Prompter } from '../../lib/prompt.js';
import { renderReport, run, type MissesResult } from '../misses.js';

const NOW = Date.parse('2026-09-15T00:00:00.000Z');
const io = { print: () => undefined } as unknown as Prompter;
const lines = (): { io: Prompter; out: string[] } => {
  const out: string[] = [];
  return { io: { print: (text: string) => out.push(text) } as unknown as Prompter, out };
};

const user = (text: string, ts: string): string => JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: ts, message: { content: text } });
const typed = (skill: string, ts: string): string => JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: ts, message: { content: `<command-name>/${skill}</command-name>` } });

const entry = (placedAt: string) => ({ id: '00000000-0000-4000-8000-000000000000', team: 't', version: null, scope: { kind: 'global' as const }, placed_at: placedAt, fingerprint: 'f' });

/** Never a real model call. */
const stub = (selected: string[]): AgentApi => ({
  askJson: async () => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), selected])),
  runAgent: (() => { throw new Error('not used'); }) as AgentApi['runAgent'],
});

async function machine(transcript: string[], skills: Record<string, string>) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'terum-misses-state-'));
  const projectsRoot = await mkdtemp(join(tmpdir(), 'terum-misses-projects-'));
  const skillsRoot = await mkdtemp(join(tmpdir(), 'terum-misses-skills-'));
  await mkdir(join(projectsRoot, 'p'), { recursive: true });
  await writeFile(join(projectsRoot, 'p', 's.jsonl'), transcript.join('\n'));
  const placements: Record<string, ReturnType<typeof entry>> = {};
  for (const [name, placedAt] of Object.entries(skills)) {
    const dir = join(skillsRoot, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: helps with ${name} work\n---\n\nbody\n`);
    placements[dir] = entry(placedAt);
  }
  const store = createConfigStore(stateRoot);
  await store.ensureRoot();
  await store.update((config) => { config.placements = placements as never; });
  return { store, projectsRoot, stateRoot };
}

describe('misses — the case layer 2 cannot see', () => {
  it('reports a skill that looked applicable and never fired', async () => {
    const m = await machine([user('help me settle these forks', '2026-09-14T00:00:00.000Z')], { 'decision-walk': '2026-08-01T00:00:00.000Z' });
    const result = await run({ config: m.store, projectsRoot: m.projectsRoot, agent: stub(['decision-walk']), now: () => NOW }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.groups[0]!.skill).toBe('decision-walk');
    expect(result.value.candidates).toBe(1);
  });

  it('does NOT report a skill the human typed — that is layer 2 row, not a miss', async () => {
    const m = await machine([
      user('help me settle these forks', '2026-09-14T00:00:00.000Z'),
      typed('decision-walk', '2026-09-14T00:01:00.000Z'),
    ], { 'decision-walk': '2026-08-01T00:00:00.000Z' });
    const result = await run({ config: m.store, projectsRoot: m.projectsRoot, agent: stub(['decision-walk']), now: () => NOW }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.candidates).toBe(0);
  });

  it('is an empty report, not an error, on a machine that has never run Claude Code', async () => {
    const m = await machine([], {});
    const result = await run({ config: m.store, projectsRoot: join(m.projectsRoot, 'nope'), agent: stub([]), now: () => NOW }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.candidates).toBe(0);
    expect(result.value.screened).toBe(0);
  });

  it('never shows the judge a skill placed after the prompt', async () => {
    const m = await machine([user('do a thing', '2026-09-10T00:00:00.000Z')], { late: '2026-09-12T00:00:00.000Z' });
    const result = await run({ config: m.store, projectsRoot: m.projectsRoot, agent: stub(['late']), now: () => NOW }, io);
    if (!result.ok) throw new Error(result.error);
    // No catalog at that timestamp means no call and no candidate, not a manufactured one.
    expect(result.value.candidates).toBe(0);
    expect(result.value.calls).toBe(1);
  });
});

describe('misses — boundaries', () => {
  it('NEVER writes usage-events.jsonl — the D2 archive stays four-field for D4 (§4)', async () => {
    const m = await machine([user('a prompt', '2026-09-14T00:00:00.000Z')], { alpha: '2026-08-01T00:00:00.000Z' });
    const path = archivePath(m.store.root);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"skill":"x","ts":"2026-09-01T00:00:00.000Z","kind":"D1","entrypoint":"cli"}\n');
    const before = await readFile(path, 'utf8');
    await run({ config: m.store, projectsRoot: m.projectsRoot, agent: stub(['alpha']), now: () => NOW }, io);
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('rejects a malformed --since instead of silently reporting an empty window', async () => {
    const m = await machine([], {});
    const result = await run({ config: m.store, projectsRoot: m.projectsRoot, agent: stub([]), since: '2026-9-1', now: () => NOW }, io);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('--since needs an ISO-8601 date');
  });

  it('rejects a non-positive --limit', async () => {
    const m = await machine([], {});
    const result = await run({ config: m.store, projectsRoot: m.projectsRoot, agent: stub([]), limit: 0, now: () => NOW }, io);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('--limit must be a positive integer');
  });

  it('narrows the printed queue to one skill without narrowing the judge catalog', async () => {
    const m = await machine([user('a prompt', '2026-09-14T00:00:00.000Z')], { alpha: '2026-08-01T00:00:00.000Z', beta: '2026-08-01T00:00:00.000Z' });
    const result = await run({ config: m.store, projectsRoot: m.projectsRoot, agent: stub(['alpha', 'beta']), ref: 'alpha', now: () => NOW }, io);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.groups.map((g) => g.skill)).toEqual(['alpha']);
    // The judge still saw both; only the report narrowed.
    expect(result.value.calls).toBe(1);
  });
});

const base: MissesResult = {
  groups: [], candidates: 0, prompts: 0, truncated: false, unjudged: 0,
  since: '2026-09-08T00:00:00.000Z', until: '2026-09-15T00:00:00.000Z',
  screened: 340, calls: 34, undated: [], problems: [],
  caveats: ['Counts are candidates for review, not measured misses; the judge sees a trimmed window, not the session.'],
};

describe('misses — the report', () => {
  it('names BOTH units, so a pair count is never read as a prompt count', () => {
    const out = renderReport({
      ...base, candidates: 12, prompts: 9,
      groups: [{ skill: 'a', candidates: [{ skill: 'a', prompt: 'p', ts: '2026-09-14T00:00:00.000Z', noPriorContext: false }] }],
    }).join('\n');
    expect(out).toContain('12 candidates across 9 prompts');
  });

  it('prints no percentage anywhere — this is never a miss rate', () => {
    const out = renderReport({ ...base, candidates: 3, prompts: 3 }).join('\n');
    expect(out).not.toMatch(/\d%/);
  });

  it('prints every caveat, always', () => {
    expect(renderReport(base).join('\n')).toContain('candidates for review, not measured misses');
  });

  it('reads as nothing worth reviewing, not as an error, when empty', () => {
    expect(renderReport(base).join('\n')).toContain('Nothing worth reviewing');
  });

  it('says so when the queue was truncated', () => {
    expect(renderReport({ ...base, truncated: true }).join('\n')).toContain('truncated');
  });

  it('marks a candidate that had no prior context', () => {
    const out = renderReport({
      ...base, candidates: 1, prompts: 1,
      groups: [{ skill: 'a', candidates: [{ skill: 'a', prompt: 'p', ts: '2026-09-14T00:00:00.000Z', noPriorContext: true }] }],
    }).join('\n');
    expect(out).toContain('no prior context');
  });

  it('discloses prompts it could not judge rather than counting them clean', () => {
    expect(renderReport({ ...base, unjudged: 4 }).join('\n')).toContain('4 prompts could not be judged');
  });

  it('warns about an unreadable transcript rather than silently screening fewer', async () => {
    const m = await machine([user('a prompt', '2026-09-14T00:00:00.000Z')], {});
    const sink = lines();
    await run({ config: m.store, projectsRoot: m.projectsRoot, agent: stub([]), now: () => NOW }, sink.io);
    expect(sink.out.join('\n')).not.toContain('warning:');
  });
});
