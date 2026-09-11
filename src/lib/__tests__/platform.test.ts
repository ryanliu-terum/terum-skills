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
    ['unrelated key', { PROCESSOR_ARCHITECTURE: 'ARM64' }],
  ] as const)('preserves the process architecture for %s', (_label, env) => {
    for (const arch of ['x64', 'arm64', 'ia32', 'future-arch']) {
      const evidence: PlatformEvidence = { platform: 'win32', arch, env };
      expect(hostArch(evidence)).toBe(arch);
      expect(detectPlatform(evidence)).toBe(arch === 'x64' ? 'win32-x64' : arch === 'arm64' ? 'win32-arm64' : 'unsupported');
    }
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
