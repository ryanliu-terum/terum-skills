/**
 * Which desktop app, if any, this machine can run (decision walk D3, 2026-09-08). Pure: every input is
 * injected so the table is unit-tested without touching the host. WSL is Linux to Node but the person is on
 * Windows, so it gets its own answer.
 */
export type AppPlatform = 'darwin-arm64' | 'darwin-x64' | 'win32-arm64' | 'win32-x64' | 'linux' | 'wsl' | 'unsupported';

export interface PlatformEvidence {
  platform: NodeJS.Platform;
  arch: string;
  /** Contents of /proc/version on Linux, or null when unreadable / not Linux. */
  procVersion?: string | null;
}

export function detectPlatform(evidence: PlatformEvidence): AppPlatform {
  const arm = evidence.arch === 'arm64';
  switch (evidence.platform) {
    case 'darwin': return arm ? 'darwin-arm64' : evidence.arch === 'x64' ? 'darwin-x64' : 'unsupported';
    case 'win32': return arm ? 'win32-arm64' : evidence.arch === 'x64' ? 'win32-x64' : 'unsupported';
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
    default: return null;
  }
}
