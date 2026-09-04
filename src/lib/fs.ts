import { access, mkdir } from 'node:fs/promises';

export async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/** Create a directory (and parents) that only the owner may read: everything under ~/.terum/skills is private. */
export async function mkdirPrivate(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}
