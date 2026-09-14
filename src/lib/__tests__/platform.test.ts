import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assetSuffix, detectPlatform, hostArch, type PlatformEvidence } from '../platform.js';

describe('host architecture (p-arch A1)', () => {
  it.each(['darwin', 'linux', 'freebsd'] as const)('never reads the environment on %s', platform => {
    const evidence: PlatformEvidence = {
      platform, arch: 'x64',
      get env(): never { throw new Error('The environment must not be read off Windows'); },
    };
    expect(hostArch(evidence)).toBe('x64');
    expect(detectPlatform(evidence)).toBe(platform === 'darwin' ? 'darwin-x64' : platform === 'linux' ? 'linux' : 'unsupported');
  });

  it.each(['ARM64', 'arm64', 'ArM64'])('recognises the ARM host hint %s', value => {
    expect(hostArch({ platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITEW6432: value } })).toBe('arm64');
  });

  it.each(['AMD64', 'amd64', 'AmD64'])('recognises the x64 host hint %s for WOW64', value => {
    const evidence: PlatformEvidence = { platform: 'win32', arch: 'ia32', env: { PROCESSOR_ARCHITEW6432: value } };
    expect(hostArch(evidence)).toBe('x64');
    expect(detectPlatform(evidence)).toBe('win32-x64');
  });

  it.each([
    ['absent environment', undefined],
    ['absent key', {}],
    ['empty hint', { PROCESSOR_ARCHITEW6432: '' }],
    ['unknown hint', { PROCESSOR_ARCHITEW6432: 'RISCV64' }],
    ['whitespace hint', { PROCESSOR_ARCHITEW6432: ' ARM64 ' }],
    ['native x64 keys', { PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_IDENTIFIER: 'Intel64 Family 6 Model 158 Stepping 10, GenuineIntel' }],
    ['native AMD keys', { PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_IDENTIFIER: 'AMD64 Family 25 Model 33 Stepping 0, AuthenticAMD' }],
    ['empty identifier', { PROCESSOR_IDENTIFIER: '' }],
  ] as const)('preserves the process architecture for %s', (_label, env) => {
    for (const arch of ['x64', 'arm64', 'ia32', 'future-arch']) {
      const evidence: PlatformEvidence = { platform: 'win32', arch, env };
      expect(hostArch(evidence)).toBe(arch);
      expect(detectPlatform(evidence)).toBe(arch === 'x64' ? 'win32-x64' : arch === 'arm64' ? 'win32-arm64' : 'unsupported');
    }
  });

  // Windows on ARM64 runs x64 code through Prism, which (unlike WOW64) does not set PROCESSOR_ARCHITEW6432: the
  // emulated process sees PROCESSOR_ARCHITECTURE=AMD64 and nothing else, except that PROCESSOR_IDENTIFIER still
  // names the real silicon. Measured on a Snapdragon X box, 2026-09-13.
  const PRISM = { PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_IDENTIFIER: 'ARMv8 (64-bit) Family 8 Model 1 Revision 201, Qualcomm Technologies Inc' };
  it('recognises an ARM64 host from the processor identifier when the WOW64 hint is absent (Prism)', () => {
    const evidence: PlatformEvidence = { platform: 'win32', arch: 'x64', env: PRISM };
    expect(hostArch(evidence)).toBe('arm64');
    expect(detectPlatform(evidence)).toBe('win32-arm64');
    expect(assetSuffix(detectPlatform(evidence))).toBe('arm64-setup.exe');
  });
  it.each(['ARMv8 (64-bit) Family 8 Model D4B Revision 0, Microsoft Corporation', 'armv8 (64-bit) Family 8 Model 1 Revision 201, Qualcomm Technologies Inc', 'ARMv9 (64-bit) Family 9 Model 0 Revision 0, Qualcomm Technologies Inc'])('reads any ARM identifier as an ARM64 host: %s', identifier => {
    expect(hostArch({ platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_IDENTIFIER: identifier } })).toBe('arm64');
  });
  it('recognises an ARM64 host from a native PROCESSOR_ARCHITECTURE too', () => {
    expect(hostArch({ platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'ARM64' } })).toBe('arm64');
    expect(hostArch({ platform: 'win32', arch: 'arm64', env: { PROCESSOR_ARCHITECTURE: 'ARM64', PROCESSOR_IDENTIFIER: PRISM.PROCESSOR_IDENTIFIER } })).toBe('arm64');
  });
  it('lets the explicit WOW64 hint win over the identifier', () => {
    expect(hostArch({ platform: 'win32', arch: 'ia32', env: { ...PRISM, PROCESSOR_ARCHITEW6432: 'AMD64' } })).toBe('x64');
    expect(hostArch({ platform: 'win32', arch: 'ia32', env: { ...PRISM, PROCESSOR_ARCHITEW6432: 'ARM64' } })).toBe('arm64');
  });
  it('still reads nothing but the platform off Windows when ARM keys are present', () => {
    expect(hostArch({ platform: 'darwin', arch: 'x64', env: PRISM })).toBe('x64');
    expect(hostArch({ platform: 'linux', arch: 'x64', env: PRISM })).toBe('x64');
  });

  it('selects the ARM64 installer for an x64 process on an ARM64 Windows host', () => {
    const platform = detectPlatform({ platform: 'win32', arch: 'x64', env: { PROCESSOR_ARCHITEW6432: 'ARM64' } });
    expect(platform).toBe('win32-arm64');
    expect(assetSuffix(platform)).toBe('arm64-setup.exe');
  });

  it.each(['x64', 'arm64', 'future-arch'])('leaves darwin %s on process architecture despite a Windows hint (Rosetta out of scope)', arch => {
    const evidence: PlatformEvidence = { platform: 'darwin', arch, env: { PROCESSOR_ARCHITEW6432: 'ARM64' } };
    expect(hostArch(evidence)).toBe(arch);
    expect(detectPlatform(evidence)).toBe(arch === 'x64' ? 'darwin-x64' : arch === 'arm64' ? 'darwin-arm64' : 'unsupported');
  });
});

it('names exactly the asset suffixes release.yml publishes, so a renamed artifact fails here and not on a download', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8');
  for (const platform of ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'] as const) expect(workflow).toContain(`suffix: ${assetSuffix(platform)}`);
  expect(workflow.match(/^\s+suffix: \S+$/gm)).toHaveLength(4);
});
