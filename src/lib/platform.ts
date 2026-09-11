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
 * A 32- or 64-bit x86 process running under Windows emulation (WOW64 on x64, Prism on ARM64) sees its own
 * emulated architecture in `process.arch`; Windows records the real one in PROCESSOR_ARCHITEW6432, which is
 * set only inside such a process. Off Windows, and in a native Windows process, there is nothing to correct.
 */
export function hostArch(evidence: PlatformEvidence): string {
  if (evidence.platform !== 'win32') return evidence.arch;
  switch (evidence.env?.PROCESSOR_ARCHITEW6432?.toUpperCase()) {
    case 'ARM64': return 'arm64';
    case 'AMD64': return 'x64';
    default: return evidence.arch;
  }
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
