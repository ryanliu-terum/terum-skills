import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTranscript, scanTranscripts } from '../transcripts.js';

const TS = '2026-09-01T00:00:00.000Z';
const assistant = (skill: string, entrypoint = 'cli', extra: Record<string, unknown> = {}): string => JSON.stringify({
  type: 'assistant', entrypoint, timestamp: TS, sessionId: 's', cwd: '/x', version: '2.1.236',
  message: { content: [{ type: 'tool_use', id: 't', name: 'Skill', input: { skill }, caller: { type: 'direct' } }] }, ...extra,
});
const user = (text: string, entrypoint = 'cli', extra: Record<string, unknown> = {}): string => JSON.stringify({
  type: 'user', entrypoint, timestamp: TS, sessionId: 's', cwd: '/x', message: { content: text }, ...extra,
});

describe('parseTranscript — the two detectors', () => {
  it('reads an autonomous firing off a Skill tool_use block', () => {
    expect(parseTranscript(assistant('handoff'))).toEqual([{ kind: 'D1', skill: 'handoff', ts: TS, entrypoint: 'cli' }]);
  });

  it('reads an explicit firing off a command-name envelope, which writes no Skill record at all', () => {
    expect(parseTranscript(user('<command-name>/codex-spec</command-name> go'))).toEqual([{ kind: 'D2', skill: 'codex-spec', ts: TS, entrypoint: 'cli' }]);
  });

  it('counts D2 as additional to D1, never as a subset', () => {
    const events = parseTranscript([assistant('decision-walk'), user('<command-name>/decision-walk</command-name>')].join('\n'));
    expect(events.map((event) => event.kind)).toEqual(['D1', 'D2']);
  });

  it('accepts a block-array message as well as a bare string', () => {
    const line = JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: TS, message: { content: [{ type: 'text', text: '<command-name>/handoff</command-name>' }] } });
    expect(parseTranscript(line)).toHaveLength(1);
  });
});

describe('parseTranscript — the pollution filter is a field, not a heuristic (§2.4)', () => {
  it('drops an sdk-cli firing — every eval sandbox and every subagent', () => {
    expect(parseTranscript(assistant('handoff', 'sdk-cli'))).toEqual([]);
  });

  it('drops a sidechain record even when it claims cli', () => {
    expect(parseTranscript(assistant('handoff', 'cli', { isSidechain: true }))).toEqual([]);
  });

  it('drops a builtin slash command — counting /clear as a skill would be a straight-up error', () => {
    expect(parseTranscript(user('<command-name>/clear</command-name>'))).toEqual([]);
    expect(parseTranscript(user('<command-name>/login</command-name>'))).toEqual([]);
  });

  it('keeps a firing whose promptSource is system — 2 of 13 have no user prompt at all (§3)', () => {
    expect(parseTranscript(assistant('handoff', 'cli', { promptSource: 'system' }))).toHaveLength(1);
  });
});

describe('parseTranscript — fail open, never quietly (§10)', () => {
  it('skips a malformed line without losing the records around it', () => {
    expect(parseTranscript([assistant('a'), '{not json', assistant('b')].join('\n'))).toHaveLength(2);
  });

  it('skips a truncated final line, the expected shape of a transcript being appended to', () => {
    expect(parseTranscript(`${assistant('a')}\n{"type":"assist`)).toHaveLength(1);
  });

  it('ignores a record with no timestamp rather than inventing one', () => {
    expect(parseTranscript(JSON.stringify({ type: 'assistant', entrypoint: 'cli', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'a' } }] } }))).toEqual([]);
  });

  it('ignores a Skill block with no skill name', () => {
    expect(parseTranscript(JSON.stringify({ type: 'assistant', entrypoint: 'cli', timestamp: TS, message: { content: [{ type: 'tool_use', name: 'Skill', input: {} }] } }))).toEqual([]);
  });
});

describe('scanTranscripts', () => {
  it('is an empty report, not an error, when the projects root is missing', async () => {
    expect(await scanTranscripts({ root: join(tmpdir(), 'terum-usage-absent-root') })).toEqual([]);
  });

  it('reads one level of project dirs and skips nested subagent transcripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'terum-usage-'));
    await mkdir(join(root, 'project-a'), { recursive: true });
    await mkdir(join(root, 'project-a', 'subagents'), { recursive: true });
    await writeFile(join(root, 'project-a', 'one.jsonl'), assistant('handoff'));
    await writeFile(join(root, 'project-a', 'subagents', 'nested.jsonl'), assistant('should-not-count'));
    const events = await scanTranscripts({ root });
    expect(events.map((event) => event.skill)).toEqual(['handoff']);
  });
});
