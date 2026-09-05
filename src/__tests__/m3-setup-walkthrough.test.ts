import { describe, expect, it } from 'vitest';
import { HOOK_ENTRY, installHook } from '../lib/hook.js';
import { temporaryDirectory } from '../lib/__tests__/fixtures.js';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

describe('M3 setup walkthrough', () => {
  it('gives each participating machine exactly one canonical session-start entry', async () => {
    const root = await temporaryDirectory('terum-m3-setup-');
    const alice = { settingsFile: join(root, 'alice.json'), backupDir: join(root, 'alice-backups') };
    const bob = { settingsFile: join(root, 'bob.json'), backupDir: join(root, 'bob-backups') };
    await installHook(alice); await installHook(bob);
    expect(JSON.parse(await readFile(alice.settingsFile, 'utf8')).hooks.SessionStart).toEqual([HOOK_ENTRY]);
    expect(JSON.parse(await readFile(bob.settingsFile, 'utf8')).hooks.SessionStart).toEqual([HOOK_ENTRY]);
  });
});
