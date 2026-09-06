/**
 * Remote handling (build spec §5.1 remote matching, §6.0 host scoping).
 *
 * This is the one place that decides what a remote is, which host it lives on, and how it is
 * handed to git. `guard.ts`, `teamRepo.ts`, and the verbs all import it, so there is exactly one
 * GitHub predicate in the product.
 *
 * A remote is data, never an option and never a transport helper. Anything that starts with `-`
 * (git would read it as an option) or with a `<helper>::` prefix (`ext::sh -c …` runs a shell) is
 * refused before any pattern runs; so is an option-shaped ssh login or scp path. Embedded
 * credentials (`https://user:tok@host/…`) are removed before a remote reaches git argv,
 * `.git/config`, or a message; the call sites also put `--` before the remote so git reads it as
 * a positional even if a future path skips this file. Every accepted shape goes through ONE parser
 * (`parseRemote`), so the comparison spelling and the git spelling can never disagree about what
 * is a remote.
 */

type ParsedRemote =
  | { kind: 'file'; path: string; canonical: string }
  | { kind: 'url'; scheme: string; user: string; host: string; port: string; path: string }
  | { kind: 'scp'; user: string; host: string; path: string }
  | { kind: 'canonical'; host: string; path: string };

// scheme://[userinfo@]host[:port]/path — the userinfo runs to the LAST `@` before the first `/`,
// which is how git and curl read it, so a password containing `@` is consumed whole.
const URL_FORM = /^(https?|ssh|git):\/\/(?:([^/]*)@)?([^/:@]+)(?::(\d+))?\/(.+)$/i;
// [user@]host:path — the host has no slash and is followed by a colon that does not start "//".
const SCP_FORM = /^(?:([^@/:]+)@)?([^/:@]+):(?!\/\/)(.+)$/;
const FILE_URL_FORM = /^file:\/\/(\/.*)$/i;
// Our own normalized spelling for a local path: `file:<absolute path>`.
const FILE_CANONICAL = /^file:(\/.*)$/;
// An already-normalized "host/path" for a dotted host; also what the CLI accepts for `--remote`.
// A single-label host (an ssh alias, `localhost`) normalizes to the scp spelling `host:path`
// instead, so a GitHub shorthand typed without its host (`org/repo`) is never mistaken for one.
const CANONICAL_FORM = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/(.+)$/i;
// `<helper>::<address>` selects a git remote helper; `ext::` runs an arbitrary command.
const HELPER_PREFIX = /^[A-Za-z0-9+.-]+::/;

/** Hosts whose owner/repo paths are case-insensitive, so identity comparison lowercases them. */
const CASE_INSENSITIVE_HOSTS = new Set(['github.com']);

/**
 * For an input that was not a remote at all: lossy on purpose. Everything between the scheme (or
 * the start of the string) and the LAST `@` is replaced, so a password containing `/`, `:`, or
 * `@` can never survive into a message. Precision is not the goal here; not echoing is.
 */
function redact(input: string): string {
  const at = input.lastIndexOf('@');
  if (at === -1) return input;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(input)?.[0] ?? '';
  return `${scheme}<redacted>@${input.slice(at + 1)}`;
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

/**
 * A host, an ssh login, or an scp path that starts with `-` would reach ssh or git as an option;
 * a path that is nothing but `.git` names no repository.
 */
function assertRemoteParts(input: string, parts: { host: string; path: string; user?: string; optionShapedPath?: boolean }): void {
  if (parts.host.startsWith('-') || parts.user?.startsWith('-') || (parts.optionShapedPath && parts.path.startsWith('-'))) throw unsupported(input, 'looks like an option');
  if (!cleanPath(parts.path)) throw unsupported(input);
}

/**
 * A local path. Trailing slashes are dropped and an empty result is refused. `.git` is KEPT: on
 * disk `team.git` and `team` are different directories, so the path is the identity, and what
 * normalizes must still be fetchable (`remoteToGitUrl(normalizeRemote(p))` names the same dir).
 */
function filePath(rawPath: string, input: string): ParsedRemote {
  const canonical = rawPath.replace(/\/+$/, '');
  if (!canonical) throw unsupported(input);
  return { kind: 'file', path: rawPath, canonical };
}

/** The one parser. Every shape check lives here, so `normalizeRemote` and `remoteToGitUrl` cannot drift. */
function parseRemote(input: string): ParsedRemote {
  const trimmed = input.trim();
  if (!trimmed) throw unsupported(input);
  if (trimmed.startsWith('-')) throw unsupported(input, 'looks like an option');
  if (HELPER_PREFIX.test(trimmed)) throw unsupported(input, 'transport helpers are not allowed');
  const fileUrl = FILE_URL_FORM.exec(trimmed);
  if (fileUrl) return filePath(fileUrl[1]!, input);
  const fileCanonical = FILE_CANONICAL.exec(trimmed);
  if (fileCanonical) return filePath(fileCanonical[1]!, input);
  if (trimmed.startsWith('/')) return filePath(trimmed, input);
  const url = URL_FORM.exec(trimmed);
  if (url) {
    const scheme = url[1]!;
    const host = url[3]!;
    const path = url[5]!;
    // Only ssh keeps a login (`git@`); an http(s)/git userinfo is only ever a credential. A password never survives.
    const user = scheme.toLowerCase() === 'ssh' ? (url[2] ?? '').split(':')[0]! : '';
    assertRemoteParts(input, { host, path, user });
    return { kind: 'url', scheme, user, host, port: url[4] ?? '', path };
  }
  const scp = SCP_FORM.exec(trimmed);
  // A one-character "host" is a Windows drive letter, never an SSH host.
  if (scp && scp[2]!.length > 1) {
    // scp-style remotes carry no password, so `user:tok@host:path` parses as host `user` with the
    // token inside the path — wherever the `@` lands once the password contains `/` or `:`. A
    // legitimate `[user@]host:path` never carries a second `@`, so ANY `@` in the path is refused.
    if (scp[3]!.includes('@')) throw unsupported(input, 'credentials in an scp-style remote are not supported');
    assertRemoteParts(input, { host: scp[2]!, path: scp[3]!, user: scp[1] ?? '', optionShapedPath: true });
    return { kind: 'scp', user: scp[1] ?? '', host: scp[2]!, path: scp[3]! };
  }
  const canonical = CANONICAL_FORM.exec(trimmed);
  if (canonical) {
    assertRemoteParts(input, { host: canonical[1]!, path: canonical[2]! });
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
 * become `file:<absolute path>` with only trailing slashes removed (the path IS the identity);
 * a single-label host keeps the scp spelling `host:path`. Idempotent: normalizing a normalized
 * remote is a no-op, for every accepted form. Throws on anything that is not recognizably a git
 * remote.
 */
export function normalizeRemote(input: string): string {
  const remote = parseRemote(input);
  if (remote.kind === 'file') return `file:${remote.canonical}`;
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
 * an input that is not a remote at all is scrubbed textually instead (lossily: see `redact`).
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

/** Return the canonical owner/repository pair for a GitHub remote, or null for every other host. */
export function githubOwnerRepo(remote: string): string | null {
  const normalized = normalizeRemote(remote);
  return normalized.startsWith('github.com/') ? normalized.slice('github.com/'.length) : null;
}

/**
 * The repository basename, used as the default team name at `team join <url>` (§6). Only the
 * `file:<path>` and single-label `host:path` spellings carry a colon before the path; a dotted
 * host never does, and a path may, so the colon is split only for those two.
 */
export function remoteName(remote: string): string {
  const normalized = normalizeRemote(remote);
  const path = normalized.startsWith('file:')
    ? normalized.slice('file:'.length)
    : /^[^/:]+:(.*)$/.exec(normalized)?.[1] ?? normalized.slice(normalized.indexOf('/') + 1);
  // `<dir>/.git` names the repository at <dir>, as it does for git clone.
  const repository = path.replace(/\/\.git$/i, '');
  return repository.slice(repository.lastIndexOf('/') + 1).replace(/\.git$/i, '');
}

/**
 * §6.0 host scoping: `invite` and access-revoking `team remove` are GitHub-only in phase 1. On
 * any other host they must fail before mutating; `--archive-only` is the part that is ours.
 */
export function hostOperationAllowed(remote: string, archiveOnly = false): { ok: true } | { ok: false; error: string } {
  if (archiveOnly) return { ok: true };
  let github = false;
  try { github = isGitHubRemote(remote); } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  if (github) return { ok: true };
  return { ok: false, error: `Access is managed on the host for ${stripRemoteCredentials(remote)}; this operation is GitHub-only in phase 1.` };
}
