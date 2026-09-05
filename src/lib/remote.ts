/**
 * Remote handling (build spec §5.1 remote matching, §6.0 host scoping).
 *
 * This is the one place that decides what a remote is, which host it lives on, and how it is
 * handed to git. `guard.ts`, `teamRepo.ts`, and the verbs all import it, so there is exactly one
 * GitHub predicate in the product.
 *
 * A remote is data, never an option and never a transport helper. Anything that starts with `-`
 * (git would read it as an option) or with a `<helper>::` prefix (`ext::sh -c …` runs a shell) is
 * refused before any pattern runs. Embedded credentials (`https://user:tok@host/…`) are removed
 * before a remote reaches git argv, `.git/config`, or a message; the call sites also put `--`
 * before the remote so git reads it as a positional even if a future path skips this file.
 * Every accepted shape goes through ONE parser (`parseRemote`), so the comparison spelling and
 * the git spelling can never disagree about what is a remote.
 */

type ParsedRemote =
  | { kind: 'file'; path: string }
  | { kind: 'url'; scheme: string; user: string; host: string; port: string; path: string }
  | { kind: 'scp'; user: string; host: string; path: string }
  | { kind: 'canonical'; host: string; path: string };

// scheme://[userinfo@]host[:port]/path — the userinfo runs to the LAST `@` before the first `/`,
// which is how git and curl read it, so a password containing `@` is consumed whole.
const URL_FORM = /^(https?|ssh|git):\/\/(?:([^/]*)@)?([^/:@]+)(?::(\d+))?\/(.+)$/i;
// [user@]host:path — the host has no slash and is followed by a colon that does not start "//".
const SCP_FORM = /^(?:([^@/:]+)@)?([^/:@]+):(?!\/\/)(.+)$/;
const FILE_URL_FORM = /^file:\/\/(\/.+)$/i;
// Our own normalized spelling for a local path: `file:<absolute path>`.
const FILE_CANONICAL = /^file:(\/.+)$/;
// An already-normalized "host/path" for a dotted host; also what the CLI accepts for `--remote`.
// A single-label host (an ssh alias, `localhost`) normalizes to the scp spelling `host:path`
// instead, so a GitHub shorthand typed without its host (`org/repo`) is never mistaken for one.
const CANONICAL_FORM = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/(.+)$/i;
// `<helper>::<address>` selects a git remote helper; `ext::` runs an arbitrary command.
const HELPER_PREFIX = /^[A-Za-z0-9+.-]+::/;

/** Hosts whose owner/repo paths are case-insensitive, so identity comparison lowercases them. */
const CASE_INSENSITIVE_HOSTS = new Set(['github.com']);

/** For an input that was not a remote at all: scrub any `scheme://…tok@` or `user:tok@` run wherever it sits. */
function redact(input: string): string {
  return input.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1').replace(/[^\s/@]+:[^\s/]+@/g, '');
}

function unsupported(input: string, why?: string): Error {
  const shown = redact(input.trim()) || '(empty)';
  return new Error(`Unsupported remote: ${shown}${why ? ` (${why})` : ''}`);
}

function stripGitSuffix(path: string): string {
  return path.replace(/\/+$/, '').replace(/\.git$/i, '');
}

function cleanPath(rawPath: string): string {
  return stripGitSuffix(rawPath.replace(/^\/+|\/+$/g, ''));
}

/** A host that starts with `-` would reach ssh as an option; a path that is nothing but `.git` names no repository. */
function assertHostAndPath(host: string, path: string, input: string): void {
  if (host.startsWith('-')) throw unsupported(input, 'looks like an option');
  if (!cleanPath(path)) throw unsupported(input);
}

/** The one parser. Every shape check lives here, so `normalizeRemote` and `remoteToGitUrl` cannot drift. */
function parseRemote(input: string): ParsedRemote {
  const trimmed = input.trim();
  if (!trimmed) throw unsupported(input);
  if (trimmed.startsWith('-')) throw unsupported(input, 'looks like an option');
  if (HELPER_PREFIX.test(trimmed)) throw unsupported(input, 'transport helpers are not allowed');
  const fileUrl = FILE_URL_FORM.exec(trimmed);
  if (fileUrl) return { kind: 'file', path: fileUrl[1]! };
  const fileCanonical = FILE_CANONICAL.exec(trimmed);
  if (fileCanonical) return { kind: 'file', path: fileCanonical[1]! };
  if (trimmed.startsWith('/')) return { kind: 'file', path: trimmed };
  const url = URL_FORM.exec(trimmed);
  if (url) {
    const scheme = url[1]!;
    const host = url[3]!;
    const path = url[5]!;
    assertHostAndPath(host, path, input);
    // Only ssh keeps a login (`git@`); an http(s)/git userinfo is only ever a credential. A password never survives.
    const user = scheme.toLowerCase() === 'ssh' ? (url[2] ?? '').split(':')[0]! : '';
    return { kind: 'url', scheme, user, host, port: url[4] ?? '', path };
  }
  const scp = SCP_FORM.exec(trimmed);
  // A one-character "host" is a Windows drive letter, never an SSH host.
  if (scp && scp[2]!.length > 1) {
    // scp-style remotes carry no password, so `user:tok@host:path` parses as host `user` with the
    // token inside the path. An `@` in the first path segment is that shape; refuse it.
    if (/^[^/]*@/.test(scp[3]!)) throw unsupported(input, 'credentials in an scp-style remote are not supported');
    assertHostAndPath(scp[2]!, scp[3]!, input);
    return { kind: 'scp', user: scp[1] ?? '', host: scp[2]!, path: scp[3]! };
  }
  const canonical = CANONICAL_FORM.exec(trimmed);
  if (canonical) {
    assertHostAndPath(canonical[1]!, canonical[2]!, input);
    return { kind: 'canonical', host: canonical[1]!, path: canonical[2]! };
  }
  throw unsupported(input);
}

/**
 * What to hand to git — always after a `--`. URL and scp forms keep their transport but lose any
 * embedded credential; a path passes through; the canonical `host/path` form becomes an HTTPS
 * URL, and `file:<path>` becomes the path. Byte-identical to the input for a credential-free URL.
 */
function toGitUrl(remote: ParsedRemote): string {
  switch (remote.kind) {
    case 'file': return remote.path;
    case 'url': return `${remote.scheme}://${remote.user ? `${remote.user}@` : ''}${remote.host}${remote.port ? `:${remote.port}` : ''}/${remote.path}`;
    case 'scp': return `${remote.user ? `${remote.user}@` : ''}${remote.host}:${remote.path}`;
    case 'canonical': return `https://${remote.host.toLowerCase()}/${cleanPath(remote.path)}.git`;
  }
}

/**
 * Normalize a remote for comparison: strip protocol, credentials, port, `.git`, and trailing
 * slashes; lowercase the host (and the path on hosts known to be case-insensitive); local paths
 * become `file:<absolute path>`; a single-label host keeps the scp spelling `host:path`.
 * Idempotent: normalizing a normalized remote is a no-op, for every accepted form. Throws on
 * anything that is not recognizably a git remote.
 */
export function normalizeRemote(input: string): string {
  const remote = parseRemote(input);
  if (remote.kind === 'file') return `file:${stripGitSuffix(remote.path)}`;
  const host = remote.host.toLowerCase();
  const path = cleanPath(remote.path);
  if (!host.includes('.')) return `${host}:${path}`;
  return `${host}/${CASE_INSENSITIVE_HOSTS.has(host) ? path.toLowerCase() : path}`;
}

/** Two remotes name the same repository. */
export function sameRemote(a: string, b: string): boolean {
  return normalizeRemote(a) === normalizeRemote(b);
}

/** What to hand to `git clone`/`git remote add`/`git ls-remote`, after a `--`. Refuses exactly what `normalizeRemote` refuses. */
export function remoteToGitUrl(input: string): string {
  return toGitUrl(parseRemote(input));
}

/**
 * The same remote with any embedded credential removed: `https://user:tok@host/p` becomes
 * `https://host/p`; an ssh login (`git@`) is kept. Trims. Never throws, so it is safe in messages —
 * an input that is not a remote at all is scrubbed textually instead.
 */
export function stripRemoteCredentials(input: string): string {
  const trimmed = input.trim();
  try {
    const remote = parseRemote(trimmed);
    return remote.kind === 'url' ? toGitUrl(remote) : trimmed;
  } catch {
    return redact(trimmed);
  }
}

/** Whether a remote as typed carried a credential that `stripRemoteCredentials` would drop — the caller says so once. */
export function hasEmbeddedCredentials(input: string): boolean {
  return stripRemoteCredentials(input) !== input.trim();
}

export function isGitHubRemote(remote: string): boolean {
  return normalizeRemote(remote).startsWith('github.com/');
}

/** The repository basename, used as the default team name at `team join <url>` (§6). */
export function remoteName(remote: string): string {
  const normalized = normalizeRemote(remote);
  return normalized.slice(Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf(':')) + 1);
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
  return { ok: false, error: `Access is managed on the host for ${stripRemoteCredentials(remote)}; this operation is GitHub-only in phase 1.` };
}
