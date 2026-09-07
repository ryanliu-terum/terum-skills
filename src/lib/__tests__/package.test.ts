import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVED_UPSTREAM, PACKAGE_NAME, packageMetadata, packageVersion } from '../package.js';

describe('package metadata', () => {
  it('reads the real adjacent package manifest and approves its canonical upstream', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(packageMetadata()).toEqual({ name: manifest.name, version: manifest.version, repository: manifest.repository.url, upstreamApproved: true });
    expect(packageVersion()).toBe(manifest.version);
  });
  it.each([null, {}, { name: 3, version: false, repository: [] }])('preserves unavailable fields as null: %j', (value) => {
    expect(packageMetadata(() => value)).toEqual({ name: null, version: null, repository: null, upstreamApproved: false });
  });
  it('contains missing and malformed manifest errors', () => {
    expect(packageMetadata(() => { throw new Error('missing or invalid JSON'); })).toEqual({ name: null, version: null, repository: null, upstreamApproved: false });
  });
  it.each([
    ['fork', APPROVED_UPSTREAM, false], [PACKAGE_NAME, 'https://example.com/fork.git', false],
    [PACKAGE_NAME, APPROVED_UPSTREAM, true], [PACKAGE_NAME, `git+${APPROVED_UPSTREAM}`, true],
  ])('validates the package/upstream pair %s %s', (name, url, approved) => {
    expect(packageMetadata(() => ({ name, version: '0.1.0', repository: { url } })).upstreamApproved).toBe(approved);
  });
});
