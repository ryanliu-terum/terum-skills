import { access, chmod, lstat, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Windows keeps a file it has just executed or written open for a moment: the launcher's handle, Defender's
 * post-execution scan, the search indexer. A rename or delete that touches it fails with EPERM, EBUSY or
 * EACCES, and removing its directory fails with ENOTEMPTY while the delete inside is still pending. Measured
 * after running an NSIS installer on Windows 11 ARM64 (2026-09-13): EPERM for about 200 ms, then success.
 * Off Windows the same codes are real answers, so the operation runs exactly once.
 */
export const WINDOWS_TRANSIENT_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
/** Waits between attempts: about 5.5 s in all, well past the measured hold and short enough that a real lock still surfaces. */
export const TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, 800, 1000, 1000, 1000, 1000];
export interface TransientRetry {
  /** Whether to retry at all; the app verbs pass the detected platform, the default is this process. */
  windows?: boolean;
  /** Attempts in all, the first included (default: one more than the delay table). */
  attempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Run `operation`, retrying a Windows transient code with the bounded backoff above; any other failure, and the
 * last attempt's, is rethrown as is. Callers wrap their own `rename`/`rm` so the call stays in their module (a
 * test that mocks node:fs/promises reaches the caller's import; this module is loaded by the test setup first).
 */
export async function retryTransient<T>(operation: () => Promise<T>, options: TransientRetry = {}): Promise<T> {
  const windows = options.windows ?? process.platform === 'win32';
  const attempts = windows ? options.attempts ?? TRANSIENT_RETRY_DELAYS_MS.length + 1 : 1;
  const sleep = options.sleep ?? wait;
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      const code = (error as { code?: unknown } | null | undefined)?.code;
      if (attempt >= attempts || typeof code !== 'string' || !WINDOWS_TRANSIENT_CODES.has(code)) throw error;
      await sleep(TRANSIENT_RETRY_DELAYS_MS[Math.min(attempt, TRANSIENT_RETRY_DELAYS_MS.length) - 1]!);
    }
  }
}

export async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/**
 * Create a directory (and parents) that only the owner may read: everything under ~/.terum/skills
 * is private. mkdir's mode applies only to directories it creates, so a pre-existing one (a restored
 * backup, a plain `mkdir -p`) is tightened here. Judged without following a link, the way the
 * vendored lock-dir check does it: the invariant is asserted about THIS inode, so a symlink, a
 * non-directory or a foreign owner is refused rather than tightened somewhere else (the repo's
 * rule for symlinks everywhere: refuse, never follow).
 */
export async function mkdirPrivate(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`Refusing to use ${path}: it is not a plain directory.`);
  if (typeof process.getuid === 'function' && details.uid !== process.getuid()) throw new Error(`Refusing to use ${path}: it is owned by another user.`);
  // Only the POSIX mode work is platform-gated — Windows synthesizes mode bits, so a chmod there is
  // noise. The shape and owner checks above are filesystem facts and hold everywhere (a junction
  // needs no elevation; the uid check self-disables where there is no uid).
  if (process.platform !== 'win32' && (details.mode & 0o077) !== 0) await chmod(path, 0o700);
}

/** Atomic private JSON write: temp file in the same directory, 0600, then rename. */
export async function writeJsonPrivate(path: string, value: unknown): Promise<void> {
  await mkdirPrivate(dirname(path));
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  // A reader that still holds the previous file (the desktop app polling a marker, a scanner) makes the swap fail transiently on Windows.
  await retryTransient(() => rename(temporary, path));
}
