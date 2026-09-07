import type { WithForm } from '../lib/invocation.js';
import { resolve } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { guardRawPush, GuardTree } from '../lib/guard.js';
import { Prompter } from '../lib/prompt.js';
import { normalizeRemote, stripRemoteCredentials } from '../lib/remote.js';
import { failure, Result, success } from '../lib/result.js';
import { CommandResult, Runner, systemRunner } from '../lib/runner.js';

export interface GuardPushArgs extends WithForm { remote: string; url: string; refs?: readonly string[]; cwd?: string; config?: ConfigStore; runner?: Runner; }
export interface GuardPushResult { team: string; checked: number; }

/** git's null OID — the "no content here" marker of a new branch or a deletion — matched by shape, not length: 40 zeros under sha-1, 64 under `--object-format=sha256`. */
const ZERO_SHA = /^0+$/;
type Git = (parts: readonly string[]) => Promise<CommandResult>;

/**
 * The hidden pre-push hook entry (D12, the clone-local half of the write guard). git's
 * `<local ref> <local sha> <remote ref> <remote sha>` lines arrive as arguments — the hook turns
 * its stdin into them, because the CLI reads stdin nowhere outside the Prompter (§3) — and every
 * branch update is diffed against the content it replaces (its fork point off `main` for a new
 * branch) and held to the pusher's own identity. What cannot be attributed — a deletion, a
 * non-branch ref, a branch with no base to diff against — is refused, never waived. A refusal is
 * one line on stderr and exit 1, which makes git abort the whole push. Accidents, not abuse:
 * `--no-verify` bypasses it, attributed to the pusher.
 */
export async function run(args: GuardPushArgs, io: Prompter): Promise<Result<GuardPushResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const cwd = args.cwd ?? resolve('.');
    const config = await store.read();
    const normalized = normalizeRemote(args.url);
    const configured = Object.entries(config.teams).find(([, entry]) => normalizeRemote(entry.remote) === normalized);
    if (!configured) throw new Error(`Push guard: ${stripRemoteCredentials(args.url)} is not a team this machine has joined, so ownership cannot be checked. Push from a configured clone, or bypass with \`git push --no-verify\` (attributed to you).`);
    const [team, binding] = configured;
    const author = config.display_name && config.email ? `${config.display_name} <${config.email}>` : undefined;
    // git's `$1` is the push target as typed — a remote NAME ordinarily, the credentialed URL itself
    // when someone pushes by URL (githooks(5)). Only a target that CAN hold a credential is scrubbed:
    // every URL and scp spelling carries a colon and a nickname never does, so no message and no git
    // argument below echoes a token, while a name — `up@stream` included, which the scrub's lossy
    // non-remote fallback would rewrite to `<redacted>@stream` — reaches the ref lookup and the
    // printed remedy byte-for-byte.
    const remoteLabel = args.remote.includes(':') ? stripRemoteCredentials(args.remote) : args.remote;
    const git: Git = (parts) => runner.run('git', parts, { cwd });
    const refs = args.refs ?? [];
    if (refs.length % 4 !== 0) throw new Error('Push guard: expected <local ref> <local sha> <remote ref> <remote sha> groups.');
    let checked = 0;
    for (let index = 0; index < refs.length; index += 4) {
      const localSha = refs[index + 1]!; const remoteRef = refs[index + 2]!; const remoteSha = refs[index + 3]!;
      // A deletion (`git push --prune` / `--mirror` / `--delete` / `:ref`) carries no new content but destroys
      // content the guard cannot show is yours — a teammate's pending `publish/<skill>` branch exists nowhere
      // else — and a non-branch ref carries no SKILL.md to read ownership from. Neither is waived.
      if (ZERO_SHA.test(localSha)) throw new Error(`Push guard refused deleting ${remoteRef}: a deletion is pure loss and cannot be shown to be yours (D12). Delete it on the host, or bypass with \`git push --no-verify\` (attributed to you).`);
      if (!remoteRef.startsWith('refs/heads/')) throw new Error(`Push guard refused ${remoteRef}: only branches carry team content, so ownership cannot be checked (D12). Bypass with \`git push --no-verify\` (attributed to you).`);
      // An existing branch is judged against the content it replaces (a force-push included). A new branch
      // is judged from its fork point off main — what a PR merge applies — never from main's tip, which
      // would charge the pusher with the reversal of every commit that landed there since the branch was cut.
      const base = ZERO_SHA.test(remoteSha) ? await forkPoint(git, remoteLabel, localSha) : remoteSha;
      if (base === null) throw new Error(`Push guard: ${remoteRef} is new and ${remoteLabel}/main could not be resolved to check it against, so ownership cannot be checked. Run \`git fetch ${remoteLabel}\`, or bypass with \`git push --no-verify\` (attributed to you).`);
      // `--no-renames`: a rename is a delete plus an add, so the path being taken away is judged too — the
      // spelling safeWrite uses. `-z`: paths arrive verbatim, never C-quoted.
      const listed = await git(['diff', '--name-only', '--no-renames', '-z', base, localSha]);
      if (listed.code !== 0) throw new Error(`Push guard could not diff ${base.slice(0, 8)}..${localSha.slice(0, 8)}: ${(listed.stderr || listed.stdout).trim()}. Run \`git fetch ${remoteLabel}\` and retry, or bypass with \`git push --no-verify\` (attributed to you).`);
      const changedPaths = listed.stdout.split('\0').filter(Boolean).sort();
      guardRawPush(await treeBetween(git, base, localSha, changedPaths), { handle: binding.handle, author }, args.form);
      checked += changedPaths.length;
    }
    if (checked) io.print(`terum-skills push guard: ${checked} path(s) to ${stripRemoteCredentials(args.url)} are yours.`);
    return success({ team, checked });
  } catch (error) { return failure(pushGuardMessage(error)); }
}

/**
 * Every non-zero exit from this verb aborts the push, so every message it exits with has to be the
 * guard's own. A refusal already names who refused and how to bypass; anything else — a corrupt
 * `~/.terum/skills/config.json`, an unreadable clone, an unexpected throw — is the guard declining
 * to permit what it could not evaluate (`forkPoint`'s rule), and is re-voiced so the pusher learns
 * which tool blocked the push and that the attributed bypass is theirs to take.
 */
function pushGuardMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('Push guard')) return message;
  return `Push guard could not run: ${message}${message.endsWith('.') ? '' : '.'} Nothing was checked, so the push is refused; fix that, or bypass with \`git push --no-verify\` (attributed to you).`;
}

async function revParse(git: Git, ref: string): Promise<string | null> {
  const result = await git(['rev-parse', '--verify', '--quiet', ref]);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

/** `main` on the remote being pushed to, falling back to `origin`: git hands the hook a URL rather than a name when someone pushes by URL. */
async function mainOf(git: Git, remote: string): Promise<string | null> {
  return (await revParse(git, `refs/remotes/${remote}/main`)) ?? revParse(git, 'refs/remotes/origin/main');
}

/**
 * Where a new branch left main: the base a PR merge would apply it to. Null when main is unknown
 * or unrelated, and the caller refuses — a guard that cannot evaluate must not permit (the
 * unjoined-remote refusal above is the same rule).
 */
async function forkPoint(git: Git, remote: string, head: string): Promise<string | null> {
  const main = await mainOf(git, remote);
  if (main === null) return null;
  const result = await git(['merge-base', main, head]);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

/** A GuardTree over two commits. Only the blobs guardRawPush reads are fetched — team.json and each touched skill folder's SKILL.md, where ownership lives; every other row is judged by name from changedPaths. */
async function treeBetween(git: Git, base: string, head: string, changedPaths: readonly string[]): Promise<GuardTree> {
  const wanted = new Set<string>(changedPaths.filter((path) => path === 'team.json'));
  for (const path of changedPaths) { const folder = /^skills\/([^/]+)\//.exec(path); if (folder) wanted.add(`skills/${folder[1]}/SKILL.md`); }
  const before = new Map<string, string>(); const after = new Map<string, string>();
  // Every wanted blob is independent of every other, so they are read a slice at a time — this runs
  // inside `git push`, which blocks until the hook exits — with the fan-out bounded: the touched-folder
  // count of a push sets it, and the guard must not fail because it asked the OS for more processes
  // than it could get (an EMFILE here would refuse the push outright).
  const paths = [...wanted];
  for (let index = 0; index < paths.length; index += 8) {
    await Promise.all(paths.slice(index, index + 8).map(async (path) => {
      const [was, is] = await Promise.all([git(['show', `${base}:${path}`]), git(['show', `${head}:${path}`])]);
      if (was.code === 0) before.set(path, was.stdout);
      if (is.code === 0) after.set(path, is.stdout);
    }));
  }
  return { before: (path) => before.get(path), after: (path) => after.get(path), changedPaths };
}
