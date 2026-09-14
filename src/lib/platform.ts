/**
 * Which desktop app, if any, this machine can run (decision walk D3, 2026-09-08). Pure: every input is
 * injected so the table is unit-tested without touching the host. WSL is Linux to Node but the person is on
 * Windows, so it gets its own answer.
 */
export type AppPlatform = 'darwin-arm64' | 'darwin-x64' | 'win32-arm64' | 'win32-x64' | 'linux' | 'wsl' | 'unsupported';

export interface PlatformEvidence {
  platform: NodeJS.Platform;
  arch: string;
  /** Process environment, read only for the Windows host-architecture keys. Absent means "trust arch". */
  env?: Readonly<Partial<Record<string, string>>>;
  /** Contents of /proc/version on Linux, or null when unreadable / not Linux. */
  procVersion?: string | null;
}

/**
 * The CPU the machine actually has, as distinct from the architecture the current process reports.
 * A 32- or 64-bit x86 process running under Windows emulation sees its own emulated architecture in
 * `process.arch`. WOW64 (32-bit code on x64 or ARM64) records the real one in PROCESSOR_ARCHITEW6432, set only
 * inside such a process. Prism (x64 code on Windows on ARM64) sets no such hint: the emulated process sees
 * PROCESSOR_ARCHITECTURE=AMD64 and only PROCESSOR_IDENTIFIER ("ARMv8 (64-bit) Family 8 …, Qualcomm …") still
 * names the silicon (measured on a Snapdragon X box, 2026-09-13, where the x64 installer had been chosen for
 * every download). A native ARM64 process reports PROCESSOR_ARCHITECTURE=ARM64 outright. Off Windows there is
 * nothing to correct and the environment is never read.
 */
export function hostArch(evidence: PlatformEvidence): string {
  if (evidence.platform !== 'win32') return evidence.arch;
  const env = evidence.env ?? {};
  switch (env.PROCESSOR_ARCHITEW6432?.toUpperCase()) {
    case 'ARM64': return 'arm64';
    case 'AMD64': return 'x64';
    default: break;
  }
  if (env.PROCESSOR_ARCHITECTURE?.toUpperCase() === 'ARM64' || /^\s*ARM/i.test(env.PROCESSOR_IDENTIFIER ?? '')) return 'arm64';
  return evidence.arch;
}

export function detectPlatform(evidence: PlatformEvidence): AppPlatform {
  switch (evidence.platform) {
    // p-arch A1: Rosetta's sysctl.proc_translated is not an environment variable and is out of scope.
    case 'darwin': return evidence.arch === 'arm64' ? 'darwin-arm64' : evidence.arch === 'x64' ? 'darwin-x64' : 'unsupported';
    case 'win32': {
      const arch = hostArch(evidence);
      return arch === 'arm64' ? 'win32-arm64' : arch === 'x64' ? 'win32-x64' : 'unsupported';
    }
    case 'linux': return /microsoft/i.test(evidence.procVersion ?? '') ? 'wsl' : 'linux';
    default: return 'unsupported';
  }
}

/** Release asset suffix per platform, as release.yml's desktop matrix names them; null where no build exists yet. */
export function assetSuffix(platform: AppPlatform): string | null {
  switch (platform) {
    case 'darwin-arm64': return 'aarch64.app.tar.gz';
    case 'darwin-x64': return 'x64.app.tar.gz';
    case 'win32-arm64': return 'arm64-setup.exe';
    case 'win32-x64': return 'x64-setup.exe';
    default: return null;
  }
}
