import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendEvents, archivePath, readArchive } from '../archive.js';
import type { UsageEvent } from '../transcripts.js';

const event = (skill: string, ts = '2026-09-01T00:00:00.000Z'): UsageEvent => ({ kind: 'D1', skill, ts, entrypoint: 'cli' });
const tempArchive = async (): Promise<string> => archivePath(await mkdtemp(join(tmpdir(), 'terum-archive-')));

describe('archive — the tuple is the dedup key, so no cursor is needed', () => {
  it('appending the same event twice adds one line, not two', async () => {
    const path = await tempArchive();
    expect(await appendEvents(path, [event('a')])).toBe(1);
    expect(await appendEvents(path, [event('a')])).toBe(0);
    expect(await readArchive(path)).toHaveLength(1);
  });

  it('deduplicates within a single append as well as against what is on disk', async () => {
    const path = await tempArchive();
    expect(await appendEvents(path, [event('a'), event('a'), event('b')])).toBe(2);
  });

  it('treats the same skill at a different timestamp as a different event', async () => {
    const path = await tempArchive();
    await appendEvents(path, [event('a', '2026-09-01T00:00:00.000Z')]);
    expect(await appendEvents(path, [event('a', '2026-09-02T00:00:00.000Z')])).toBe(1);
  });

  it('a rescan over transcripts already seen is a no-op — what makes stateless rescan and a growing archive coexist', async () => {
    const path = await tempArchive();
    const corpus = [event('a'), event('b'), event('c')];
    await appendEvents(path, corpus);
    expect(await appendEvents(path, corpus)).toBe(0);
    expect(await readArchive(path)).toHaveLength(3);
  });

  it('persists exactly the four privacy-cleared fields and nothing else (§8)', async () => {
    const path = await tempArchive();
    await appendEvents(path, [event('a')]);
    const written = JSON.parse((await readFile(path, 'utf8')).trim()) as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(['entrypoint', 'kind', 'skill', 'ts']);
  });
});

describe('archive — fail open', () => {
  it('reads a missing archive as empty', async () => {
    expect(await readArchive(await tempArchive())).toEqual([]);
  });

  it('skips a half-written trailing line, the expected shape of an interrupted append', async () => {
    const path = await tempArchive();
    await appendEvents(path, [event('a')]);
    await writeFile(path, `${await readFile(path, 'utf8')}{"kind":"D1","skill":"b`, 'utf8');
    expect((await readArchive(path)).map((e) => e.skill)).toEqual(['a']);
  });

  it('skips a well-formed line that is not a usage event', async () => {
    const path = await tempArchive();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `{"kind":"D3","skill":"a","ts":"t","entrypoint":"cli"}\n{"skill":"b"}\n`, 'utf8');
    expect(await readArchive(path)).toEqual([]);
  });

  it('appends nothing for an empty event list rather than creating an empty file', async () => {
    const path = await tempArchive();
    expect(await appendEvents(path, [])).toBe(0);
    expect(await readArchive(path)).toEqual([]);
  });
});
