// Vendored from iflytek/skillhub cli/src/services/skill-target-lock.ts @ 61aa957 — Apache-2.0 — modified: yes
// Source: https://github.com/iflytek/skillhub/blob/61aa957ecc45e6c3672d11e0c48c13bd601f15c5/cli/src/services/skill-target-lock.ts
// Full commit: 61aa957ecc45e6c3672d11e0c48c13bd601f15c5. License text: ./LICENSE at the repo root; attribution: ./NOTICE.

import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { lock } from 'proper-lockfile'

/** Our replacement for skillhub's CliError/EXIT.filesystem pair. */
export class TargetBusyError extends Error {
  readonly exitCode = 1
  constructor(message: string, readonly path: string) { super(message); this.name = 'TargetBusyError' }
}

/** Serializes every local lifecycle mutation for one Skill target directory. */
export async function acquireSkillTargetLock(rootDir: string, slug: string): Promise<() => Promise<void>> {
  const lockPath = await skillTargetLockPath(rootDir, slug)
  try {
    return await lock(lockPath, {
      lockfilePath: lockPath,
      realpath: false,
      stale: 10_000,
      update: 3_000,
      retries: 0
    })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ELOCKED') {
      throw targetBusyError(rootDir, slug)
    }
    throw error
  }
}

export async function skillTargetLockPath(rootDir: string, slug: string): Promise<string> {
  // Inline skillhub's canonicalizeExistingPath: realpath if the root exists, otherwise retain
  // the resolved spelling so a not-yet-created skills root can still be locked safely.
  const canonicalRoot = await canonicalizeExistingPath(resolve(rootDir))
  const target = resolve(canonicalRoot, slug)
  const digest = createHash('sha256').update(target).digest('hex')
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  const lockDir = join(tmpdir(), `terum-skills-target-locks-${uid}`)
  await ensurePrivateLockDir(lockDir)
  return join(lockDir, `${digest}.lock`)
}

interface LockDirectoryDetails {
  isDirectory(): boolean
  isSymbolicLink(): boolean
  uid: number
  mode: number
}

export function assertPrivateLockDir(
  lockDir: string,
  details: LockDirectoryDetails,
  currentUid: number | null
): void {
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`unsafe SkillHub CLI lock directory: ${lockDir}`)
  }
  if (currentUid !== null && details.uid !== currentUid) {
    throw new Error(`SkillHub CLI lock directory is owned by another user: ${lockDir}`)
  }
}

export async function ensurePrivateLockDir(lockDir: string): Promise<void> {
  try {
    await mkdir(lockDir, { mode: 0o700 })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }

  const details = await lstat(lockDir)
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  assertPrivateLockDir(lockDir, details, currentUid)
  if (process.platform !== 'win32' && (details.mode & 0o077) !== 0) {
    await chmod(lockDir, 0o700)
  }
}

async function canonicalizeExistingPath(path: string): Promise<string> {
  try {
    const { realpath } = await import('node:fs/promises')
    return await realpath(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return path
    throw error
  }
}

function targetBusyError(rootDir: string, slug: string): TargetBusyError {
  return new TargetBusyError(`install target is busy: ${join(rootDir, slug)}`, join(rootDir, slug))
}
