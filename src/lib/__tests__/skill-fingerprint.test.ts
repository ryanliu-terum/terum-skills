import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotSkillDirectory } from '../placer/vendor/skillhub/skill-fingerprint.js';
import { temporaryDirectory } from './fixtures.js';

describe('vendored skill-fingerprint — path separator handling', () => {
  it.skipIf(sep === '\\')('keeps a POSIX filename containing a backslash as its own snapshot key and hashes its content', async () => {
    const root = await temporaryDirectory();
    const name = 'docs\\readme.md';
    await writeFile(join(root, name), 'backslash-named');
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'other.md'), 'nested');
    const snapshot = await snapshotSkillDirectory(root);
    expect(Object.keys(snapshot.files).sort()).toEqual(['docs/other.md', name]); // '/' sorts before '\\'
    expect(snapshot.files[name]).toBe(createHash('sha256').update('backslash-named').digest('hex'));
    expect(snapshot.files['docs/readme.md']).toBeUndefined();
  });
});
