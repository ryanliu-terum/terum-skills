import { expect, it } from 'vitest';
import { versionText } from './presentation';

it('§3.2: a version folder reaches the UI only as `Version N` — never sliced, never with a bare `v`', () => {
  // The defect: every surface sliced these fields and wrote a literal `v` in front of them, because
  // before layout 3 they held a 40-hex tree hash. A version FOLDER through that path rendered as
  // "v v1", and a two-digit ordinal was silently truncated by the slice.
  expect(versionText('v1', 'unused')).toBe('Version 1');
  expect(versionText('v12', 'unused')).toBe('Version 12');
  expect(versionText('v1', 'unused')).not.toContain('v v');
  // The fallback covers the fields that already hold a label, and the `—` sentinel.
  expect(versionText(null, 'Version 3')).toBe('Version 3');
  expect(versionText(undefined, '—')).toBe('—');
  // The byte-locked design fixtures still carry layout-2 tree hashes: their rendering is unchanged,
  // so the locked boards do not move under this change.
  expect(versionText(null, '5f0e12ab9c3d')).toBe('v 5f0e12ab9c3d');
  // §3.2's parser is the authority on what a version folder is: `v0` and `v03` are not one.
  expect(versionText('v0', 'fallback')).toBe('fallback');
  expect(versionText('v03', 'fallback')).toBe('fallback');
});
