import { describe, expect, it, vi } from 'vitest';
import { invocation, resolveInvocationForm, type FormEvidence } from '../invocation.js';
import type { Launch } from '../launch.js';

const entry = '/prefix/lib/node_modules/terum-skills/dist/index.js';
function evidence(overrides: Partial<FormEvidence> = {}): FormEvidence {
  return { launch: { kind: 'global', path: entry }, env: {}, platform: 'darwin', pathEntries: ['/prefix/bin'], access: async () => undefined, realpath: async () => entry, stat: async () => ({ isFile: () => true }), ...overrides };
}
describe('runtime hint evidence (independent of provenance)', () => {
  it('requires the first executable PATH candidate to resolve to the running entry', async () => {
    expect(await resolveInvocationForm(evidence())).toBe('bare');
    const realpath = vi.fn(async () => '/shadow/index.js');
    expect(await resolveInvocationForm(evidence({ pathEntries: ['/shadow', '/prefix/bin'], realpath }))).toBe('npx');
    expect(realpath.mock.calls).toHaveLength(1);
  });
  it('ignores empty entries and skips non-files; no candidate is npx', async () => {
    const stat = vi.fn(async (p: string) => ({ isFile: () => p.startsWith('/prefix') }));
    expect(await resolveInvocationForm(evidence({ pathEntries: ['', '/directory', '/prefix/bin'], stat }))).toBe('bare');
    expect(stat.mock.calls.map(([p]) => p)).toEqual(['/directory/terum-skills', '/prefix/bin/terum-skills']);
    expect(await resolveInvocationForm(evidence({ pathEntries: [] }))).toBe('npx');
    expect(await resolveInvocationForm(evidence({ pathEntries: [''] }))).toBe('npx');
    expect(await resolveInvocationForm(evidence({ stat: async () => ({ isFile: () => false }) }))).toBe('npx');
  });
  it('walks past PATH entries without the executable (ENOENT, ENOTDIR) to a later match; a walk with no match is npx', async () => {
    const missing = (code: string) => Object.assign(new Error(code), { code });
    const stat = vi.fn(async (p: string) => { if (p.startsWith('/prefix')) return { isFile: () => true }; throw missing(p.startsWith('/file') ? 'ENOTDIR' : 'ENOENT'); });
    expect(await resolveInvocationForm(evidence({ pathEntries: ['/usr/bin', '/file/bin', '/prefix/bin'], stat }))).toBe('bare');
    expect(stat.mock.calls.map(([p]) => p)).toEqual(['/usr/bin/terum-skills', '/file/bin/terum-skills', '/prefix/bin/terum-skills']);
    expect(await resolveInvocationForm(evidence({ pathEntries: ['/usr/bin', '/file/bin'], stat }))).toBe('npx');
  });
  it.each(['npm_command', 'npm_lifecycle_event', 'npm_execpath', 'npm_config_user_agent'])('vetoes %s even when empty, before filesystem work', async (key) => {
    const stat = vi.fn(async () => ({ isFile: () => true }));
    for (const value of ['', 'exec']) expect(await resolveInvocationForm(evidence({ env: { [key]: value }, stat }))).toBe('npx');
    expect(stat).not.toHaveBeenCalled();
  });
  it.each<Launch>([
    { kind: 'npx', path: entry, cacheDir: '/cache', request: null },
    { kind: 'local', path: entry, root: '/work', dependencyKind: 'dependencies' },
    { kind: 'unknown', path: entry }, { kind: 'source', path: entry, root: '/repo' },
  ])('vetoes $kind provenance with a matching PATH hit', async (launch) => {
    expect(await resolveInvocationForm(evidence({ launch }))).toBe('npx');
  });
  it('defaults missing launch and Windows to npx', async () => {
    expect(await resolveInvocationForm(evidence({ launch: undefined }))).toBe('npx');
    expect(await resolveInvocationForm(evidence({ platform: 'win32' }))).toBe('npx');
  });
  it.each(['access', 'realpath', 'stat'] as const)('fails closed on a thrown %s error', async (method) => {
    expect(await resolveInvocationForm(evidence({ [method]: async () => { throw new Error('unavailable'); } }))).toBe('npx');
  });
  it('uses identical POSIX single quoting in both forms, including apostrophes', () => {
    for (const form of [undefined, 'npx', 'bare'] as const) {
      const prefix = form === 'bare' ? 'terum-skills' : 'npx -y terum-skills@latest';
      expect(invocation(form, 'connect --team', 'Te am')).toBe(`${prefix} connect --team 'Te am'`);
      expect(invocation(form, 'connect', "it's here")).toBe(`${prefix} connect 'it'\\''s here'`);
    }
  });
});
