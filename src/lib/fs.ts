import { access, chmod, lstat, mkdir } from 'node:fs/promises';

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
  if (process.platform === 'win32') return;
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`Refusing to use ${path}: it is not a plain directory.`);
  if (typeof process.getuid === 'function' && details.uid !== process.getuid()) throw new Error(`Refusing to use ${path}: it is owned by another user.`);
  if ((details.mode & 0o077) !== 0) await chmod(path, 0o700);
}
