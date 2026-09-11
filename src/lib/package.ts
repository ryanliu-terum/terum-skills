import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './package-root.js';

export const PACKAGE_NAME = 'terum-skills';
export const APPROVED_UPSTREAM = 'https://github.com/ryanliu-terum/terum-skills.git';
export interface PackageMetadata { name: string | null; version: string | null; repository: string | null; upstreamApproved: boolean; }

/** One adjacent manifest reader for source and shipped dist/lib layouts. Never invent a version. */
/** Resolve this package's manifest independently of the emitted layout. */
function defaultRead(): unknown {
  const root = packageRoot();
  if (root === null) return null;
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}
export function packageMetadata(read: () => unknown = defaultRead): PackageMetadata {
  const absent: PackageMetadata = { name: null, version: null, repository: null, upstreamApproved: false };
  try {
    const value = read();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return absent;
    const manifest = value as Record<string, unknown>;
    const name = typeof manifest.name === 'string' && manifest.name.length ? manifest.name : null;
    const version = typeof manifest.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version) ? manifest.version : null;
    const repo = manifest.repository;
    const url = repo && typeof repo === 'object' && !Array.isArray(repo) ? (repo as Record<string, unknown>).url : repo;
    const repository = typeof url === 'string' && url.length ? url : null;
    // npm's git+ transport prefix is metadata, not a different approved destination.
    const upstreamApproved = name === PACKAGE_NAME && repository?.replace(/^git\+/, '') === APPROVED_UPSTREAM;
    return { name, version, repository, upstreamApproved };
  } catch { return absent; }
}

export function packageVersion(): string | null { return packageMetadata().version; }
