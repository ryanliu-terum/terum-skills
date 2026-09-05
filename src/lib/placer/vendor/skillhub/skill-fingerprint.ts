// Vendored from iflytek/skillhub cli/src/services/skill-fingerprint.ts @ 61aa957 — Apache-2.0 — modified: yes
// Modified: listSkillFiles rewrites path separators to '/' only on Windows (sep === '\\'); on POSIX a backslash is a legal filename character and stays in the snapshot key.
// Source: https://github.com/iflytek/skillhub/blob/61aa957ecc45e6c3672d11e0c48c13bd601f15c5/cli/src/services/skill-fingerprint.ts
// Full commit: 61aa957ecc45e6c3672d11e0c48c13bd601f15c5. License text: ./LICENSE at the repo root; attribution: ./NOTICE.

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export interface SkillSnapshot {
  fingerprint: string
  files: Record<string, string>
}

export async function snapshotSkillDirectory(skillDir: string): Promise<SkillSnapshot> {
  const paths = await listSkillFiles(skillDir)
  const files: Record<string, string> = {}
  const aggregate = createHash('sha256')

  for (const path of paths) {
    const content = await readFile(join(skillDir, path))
    const fileHash = createHash('sha256').update(content).digest('hex')
    files[path] = fileHash
    aggregate.update(`${path}:${fileHash}\n`, 'utf8')
  }

  return { fingerprint: `sha256:${aggregate.digest('hex')}`, files }
}

export function diffSkillFiles(
  baseline: Record<string, string> | undefined,
  current: Record<string, string>
): string[] {
  if (!baseline) return []
  const paths = new Set([...Object.keys(baseline), ...Object.keys(current)])
  return [...paths]
    .filter(path => baseline[path] !== current[path])
    .sort((left, right) => left.localeCompare(right))
}

async function listSkillFiles(root: string): Promise<string[]> {
  const files: string[] = []

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.skillhub') continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (entry.isFile()) {
        const rel = relative(root, absolute)
        files.push(sep === '\\' ? rel.split('\\').join('/') : rel)
      }
    }
  }

  await walk(root)
  return files.sort()
}
