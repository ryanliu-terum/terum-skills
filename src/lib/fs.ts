import { access, chmod, mkdir, stat } from 'node:fs/promises';

export async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/**
 * Create a directory (and parents) that only the owner may read: everything under ~/.terum/skills
 * is private. mkdir's mode applies only to directories it creates, so a pre-existing one (a restored
 * backup, a plain `mkdir -p`) is tightened here, the way the vendored lock helper does it. A chmod
 * refusal is real news — someone else owns the tree — and propagates.
 */
export async function mkdirPrivate(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32' && ((await stat(path)).mode & 0o077) !== 0) await chmod(path, 0o700);
}
