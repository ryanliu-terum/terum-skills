# Contract: normalizeRemote(input: string): string

Module context: remote handling for a CLI that shares files through one private git repository.
This function is the single place that decides what a git remote is and produces its comparison
spelling. Two remotes name the same repository if and only if
`normalizeRemote(a) === normalizeRemote(b)`.

## Signature

    export function normalizeRemote(input: string): string

Throws an `Error` whose message starts with `Unsupported remote: ` on anything that is not
recognizably a git remote. Pure: no I/O, no network, no filesystem access.

## Accepted input shapes

1. URL form: `scheme://[userinfo@]host[:port]/path`, scheme one of https, http, ssh, git
   (scheme case-insensitive). The userinfo runs to the LAST `@` before the first `/`, which is
   how git and curl read it, so a password containing `@` is consumed whole.
2. scp-style form: `[user@]host:path`. The host contains no slash and is followed by a colon
   that does not start `//`. A one-character host is a Windows drive letter, never an SSH host.
   scp-style remotes carry no password; an `@` anywhere in the first path segment means a
   credential was attempted, and the input is refused.
3. Local path: an absolute path starting with `/`; or `file:///absolute/path`; or the canonical
   `file:/absolute/path`.
4. Canonical `host/path` where the host is dotted (contains at least one `.`), for example
   `github.com/org/repo`. A single-label host in this form (`myhost/org/repo`) is NOT accepted,
   so a GitHub shorthand typed without its host (`org/repo`) is never mistaken for a remote.

## Refusals (throw), checked before any shape pattern runs

- empty or whitespace-only input
- input that, after trimming, starts with `-` (git would read it as an option); the message
  ends with `(looks like an option)`
- a `<helper>::` prefix such as `ext::sh -c id` or `fd::17`, which selects a git remote helper
  and can run a command; the message ends with `(transport helpers are not allowed)`
- a host that starts with `-`, in any accepted form
- a path that is empty after cleaning, or that is nothing but `.git` (names no repository)
- anything that matches no accepted shape

## Output spelling

- Dotted host: `host/path`. The host is lowercased. The path keeps its case, except on hosts
  whose owner/repo paths are case-insensitive (currently only `github.com`), where the path is
  lowercased too.
- Single-label host (an ssh alias, `localhost`), whether it arrived in scp form or URL form:
  the scp spelling `host:path`.
- Local path, from any of its three input shapes: `file:<absolute path>`.
- Removed from every form: protocol, credentials and userinfo (an ssh `git@` login included),
  port, a trailing `.git` (case-insensitive), and leading or trailing slashes on the path.

## Invariants

- Idempotent: `normalizeRemote(normalizeRemote(x)) === normalizeRemote(x)` for every accepted x.
- Never echoes a credential: for an input carrying `user:tok@` or `tok@`, the thrown message
  must not contain the token.
- Surrounding whitespace is trimmed first and never changes the result.
