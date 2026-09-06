import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { temporaryDirectory } from './fixtures.js';

// A quarantine move that fails with ENOENT (the quarantine tree removed between the mkdir and the
// rename — `sync prune` in another process) used to be swallowed by remove()'s "already gone" catch,
// which then hard-deleted the edited placement it had just failed to preserve. The mock reproduces
// exactly that ENOENT; it lives in its own file because vi.mock is module-wide.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (to.includes('quarantine')) throw Object.assign(new Error(`ENOENT: simulated vanished quarantine ${to}`), { code: 'ENOENT' });
      return actual.rename(from, to);
    },
  };
});

describe('placer.remove() when the quarantine move fails', () => {
  it('rejects with the quarantine error and leaves the edited placement on disk', async () => {
    const { place, remove } = await import('../placer.js');
    const root = await temporaryDirectory(); const target = join(root, '.claude', 'skills'); const source = join(root, 'source');
    await mkdir(source); await writeFile(join(source, 'SKILL.md'), 'original');
    const placed = await place(source, target, 'edited');
    await writeFile(join(placed.path, 'SKILL.md'), 'edited by user');
    await expect(remove(target, placed.path, placed.snapshot.fingerprint, join(root, 'quarantine'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(placed.path, 'SKILL.md'), 'utf8')).toBe('edited by user');
  });
});
