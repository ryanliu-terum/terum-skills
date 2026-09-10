import { access, chmod, lstat, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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
  await rename(temporary, path);
}
