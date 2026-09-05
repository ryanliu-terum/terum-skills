/**
 * Remote handling (build spec §5.1 remote matching, §6.0 host scoping).
 *
 * This is the one place that decides what a remote is, which host it lives on, and how it is
 * handed to git. `guard.ts`, `teamRepo.ts`, and the verbs all import it, so there is exactly one
 * GitHub predicate in the product.
 */

const URL_FORM = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i;
// git@host:path — the host has no slash and is followed by a colon that does not start "//".
const SCP_FORM = /^(?:[^@/:]+@)?([^/:]+):(?!\/\/)(.+)$/;
const FILE_URL_FORM = /^file:\/\/(\/.+)$/i;
// Our own normalized spelling for a local path: `file:<absolute path>`.
const FILE_CANONICAL = /^file:(\/.+)$/;
// An already-normalized "host/path" (a host always contains a dot). Also what the CLI accepts
// for `--remote`; `remoteToGitUrl` turns it back into something git can fetch.
const CANONICAL_FORM = /^([a-z0-9.-]+\.[a-z0-9-]+)\/(.+)$/i;

/** Hosts whose owner/repo paths are case-insensitive, so identity comparison lowercases them. */
const CASE_INSENSITIVE_HOSTS = new Set(['github.com']);

/**
 * Normalize a remote for comparison: strip protocol, credentials, port, `.git`, and trailing
 * slashes; lowercase the host (and the path on hosts known to be case-insensitive); local paths
 * become `file:<absolute path>`. Idempotent: normalizing a normalized remote is a no-op. Throws on
 * anything that is not recognizably a git remote.
 */
export function normalizeRemote(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Unsupported remote: (empty)');
  const fileUrl = FILE_URL_FORM.exec(trimmed);
  if (fileUrl) return `file:${stripGitSuffix(fileUrl[1]!)}`;
  const fileCanonical = FILE_CANONICAL.exec(trimmed);
  if (fileCanonical) return `file:${stripGitSuffix(fileCanonical[1]!)}`;
  if (trimmed.startsWith('/')) return `file:${stripGitSuffix(trimmed)}`;
  const url = URL_FORM.exec(trimmed);
  if (url) return hostPath(url[1]!, url[2]!);
  const scp = SCP_FORM.exec(trimmed);
  // A one-character "host" is a Windows drive letter, never an SSH host.
  if (scp && scp[1]!.length > 1) return hostPath(scp[1]!, scp[2]!);
  const canonical = CANONICAL_FORM.exec(trimmed);
  if (canonical) return hostPath(canonical[1]!, canonical[2]!);
  throw new Error(`Unsupported remote: ${input}`);
}

function hostPath(rawHost: string, rawPath: string): string {
  const host = rawHost.toLowerCase();
  const path = stripGitSuffix(rawPath.replace(/^\/+|\/+$/g, ''));
  if (!path) throw new Error(`Unsupported remote: ${rawHost}/${rawPath}`);
  return `${host}/${CASE_INSENSITIVE_HOSTS.has(host) ? path.toLowerCase() : path}`;
}

function stripGitSuffix(path: string): string {
  return path.replace(/\/+$/, '').replace(/\.git$/i, '');
}

/** Two remotes name the same repository. */
export function sameRemote(a: string, b: string): boolean {
  return normalizeRemote(a) === normalizeRemote(b);
}

/**
 * What to hand to `git clone`/`git remote add`. URL, scp, and path forms pass through; the
 * canonical `host/path` form (what `--remote` accepts and what config stores) becomes an HTTPS
 * URL, and `file:<path>` becomes the path.
 */
export function remoteToGitUrl(input: string): string {
  const trimmed = input.trim();
  const fileCanonical = FILE_CANONICAL.exec(trimmed);
  if (fileCanonical) return fileCanonical[1]!;
  if (FILE_URL_FORM.test(trimmed) || trimmed.startsWith('/') || URL_FORM.test(trimmed)) return trimmed;
  const scp = SCP_FORM.exec(trimmed);
  if (scp && scp[1]!.length > 1) return trimmed;
  const canonical = CANONICAL_FORM.exec(trimmed);
  if (canonical) return `https://${canonical[1]!.toLowerCase()}/${canonical[2]!.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')}.git`;
  throw new Error(`Unsupported remote: ${input}`);
}

export function isGitHubRemote(remote: string): boolean {
  return normalizeRemote(remote).startsWith('github.com/');
}

/** Return the canonical owner/repository pair for a GitHub remote, or null for every other host. */
export function githubOwnerRepo(remote: string): string | null {
  const normalized = normalizeRemote(remote);
  return normalized.startsWith('github.com/') ? normalized.slice('github.com/'.length) : null;
}

/** The repository basename, used as the default team name at `team join <url>` (§6). */
export function remoteName(remote: string): string {
  const normalized = normalizeRemote(remote);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/**
 * §6.0 host scoping: `invite`, access-revoking `team remove`, and (D7) the per-team PAT are
 * GitHub-only in phase 1. On any other host they must fail before mutating; `--archive-only`
 * is the part that is ours.
 */
export function hostOperationAllowed(remote: string, archiveOnly = false): { ok: true } | { ok: false; error: string } {
  if (archiveOnly) return { ok: true };
  let github = false;
  try { github = isGitHubRemote(remote); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  if (github) return { ok: true };
  return { ok: false, error: `Access is managed on the host for ${remote}; this operation is GitHub-only in phase 1.` };
}
