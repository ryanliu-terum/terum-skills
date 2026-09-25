/**
 * Resolves the agent binary the way a Windows shell would, so `claude` launches under the
 * desktop app and from PowerShell alike. Node's `spawn` refuses a `.cmd`/`.bat` shim without a
 * shell (`spawn EINVAL`, the 2024 batch-injection hardening), and a shell wrapper would mangle
 * the multi-line prompt that `runAgent`/`askJson` pass as one argv value. So an npm shim is
 * bypassed: the script it launches runs on the current Node directly, arguments untouched. The
 * script is found two ways — the conventional `node_modules/@anthropic-ai/claude-code/cli.js`
 * beside the shim, and failing that by reading the shim itself, because npm, pnpm, Volta, nvm4w
 * and Claude Code's own installer lay the package out differently (Teddy's `C:\nvm4w\nodejs\claude.cmd`
 * refused on 2026-09-13 with the conventional path alone). A native `claude.exe` spawns as is.
 * Every other platform spawns the name unchanged.
 */
import { statSync } from 'node:fs';
import { win32 as winPath } from 'node:path';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';

export interface AgentCommandEvidence {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** The Node binary running this process; an npm shim's script runs on it directly. */
  execPath: string;
  isFile(path: string): boolean;
  /** The text of a `.cmd`/`.bat` shim, or null when it cannot be read. Absent means "never read shims". */
  readText?(path: string): string | null;
}

export interface AgentSpawnSpec { file: string; args: string[] }

/** The extensions Windows treats as launchable and this resolver knows how to start. */
const LAUNCHABLE = ['.com', '.exe', '.bat', '.cmd'] as const;
type Launchable = typeof LAUNCHABLE[number];
const isLaunchable = (ext: string): ext is Launchable => (LAUNCHABLE as readonly string[]).includes(ext);
/** Where npm's `claude.cmd` shim conventionally points: the package beside it. */
const SHIM_TARGET = ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'];
/** A JavaScript file a shim launches, relative to the shim's own folder (`%~dp0` / `%dp0%`), quoted or bare. */
// What a shim may launch: a Node script (run on the current Node) or a native binary (run as is). Claude Code ≥ 2.1
// ships `bin\claude.exe` inside the npm package and its shim runs that, so a `.js`-only pattern saw nothing there.
const SHIM_TARGET_EXT = '(?:[cm]?js|exe|com)';
const SHIM_SCRIPT = new RegExp(`"([^"\\r\\n]*%~?dp0%?[^"\\r\\n]*?\\.${SHIM_TARGET_EXT})"|(?:^|\\s)((?:%~?dp0%?)[^\\s"]*?\\.${SHIM_TARGET_EXT})(?=\\s|$)`, 'gim');
const isNativeTarget = (path: string): boolean => ['.exe', '.com'].includes(winPath.extname(path).toLowerCase());

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  // Windows environment names are case-insensitive; a plain object (tests, some launchers) is not.
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** PATHEXT order, restricted to what can be started here; the Windows default when unset. */
function launchableExtensions(env: NodeJS.ProcessEnv): Launchable[] {
  const declared = (envValue(env, 'PATHEXT') ?? '').split(';').map((ext) => ext.trim().toLowerCase()).filter(isLaunchable);
  return declared.length > 0 ? [...new Set(declared)] : [...LAUNCHABLE];
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  return (envValue(env, 'PATH') ?? '').split(';').map((entry) => entry.trim().replace(/^"(.*)"$/, '$1')).filter((entry) => entry.length > 0);
}

/** Where Claude Code's native Windows installer puts `claude.exe`; a last resort after PATH, never ahead of it. */
function nativeInstallDir(env: NodeJS.ProcessEnv): string | undefined {
  const profile = envValue(env, 'USERPROFILE');
  return profile === undefined || profile.trim() === '' ? undefined : winPath.join(profile.trim(), '.local', 'bin');
}

/** Every file a Windows shell would try for `command`, in the order it would try them. */
function candidates(command: string, env: NodeJS.ProcessEnv): string[] {
  const hasExtension = winPath.extname(command) !== '';
  const extensions = launchableExtensions(env);
  if (/[\\/]/.test(command)) return hasExtension ? [command] : extensions.map((ext) => command + ext);
  return pathEntries(env).flatMap((dir) => hasExtension ? [winPath.join(dir, command)] : extensions.map((ext) => winPath.join(dir, command + ext)));
}

/**
 * The scripts a shim's text launches, in order of appearance, resolved against the shim's folder.
 * Only paths anchored at `%~dp0`/`%dp0%` count: a shim that runs an absolute path elsewhere is
 * not an npm-style shim and its target is not ours to guess.
 */
export function shimScripts(shim: string, text: string): string[] {
  const dir = winPath.dirname(shim);
  const scripts: string[] = [];
  for (const match of text.matchAll(SHIM_SCRIPT)) {
    const raw = (match[1] ?? match[2] ?? '').replace(/%~?dp0%?[\\/]?/i, '');
    if (!raw) continue;
    const resolved = winPath.join(dir, raw);
    if (!scripts.includes(resolved)) scripts.push(resolved);
  }
  return scripts;
}

export function resolveAgentCommand(command: string, args: readonly string[], evidence: AgentCommandEvidence): Result<AgentSpawnSpec> {
  if (evidence.platform !== 'win32') return success({ file: command, args: [...args] });
  const explicit = /[\\/]/.test(command) || winPath.extname(command) !== '';
  const found = candidates(command, evidence.env).find((candidate) => evidence.isFile(candidate));
  if (found === undefined) return failure(`\`${command}\` was not found${explicit ? '' : ' on PATH'} — is Claude Code installed?`);
  const extension = winPath.extname(found).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') return success({ file: found, args: [...args] });
  const conventional = winPath.join(winPath.dirname(found), ...SHIM_TARGET);
  if (evidence.isFile(conventional)) return success({ file: evidence.execPath, args: [conventional, ...args] });
  const text = evidence.readText?.(found) ?? null;
  const fromShim = text === null ? [] : shimScripts(found, text);
  const script = fromShim.find((candidate) => evidence.isFile(candidate));
  if (script !== undefined) return isNativeTarget(script) ? success({ file: script, args: [...args] }) : success({ file: evidence.execPath, args: [script, ...args] });
  // The shim is opaque (or names nothing that exists): the native installer's own claude.exe, when present and not
  // already on PATH ahead of the shim, is the right thing to run — that is what the remedy below would tell the
  // person to install, and it is already there.
  const nativeDir = nativeInstallDir(evidence.env);
  const native = nativeDir === undefined || explicit ? undefined : [winPath.join(nativeDir, 'claude.exe')].find((candidate) => evidence.isFile(candidate));
  if (native !== undefined) return success({ file: native, args: [...args] });
  const looked = fromShim.length > 0 ? ` It launches ${fromShim.join(', ')}, which does not exist.` : text === null ? ' The shim could not be read.' : ' The shim names no script this tool can launch.';
  return failure(`\`${command}\` resolves to the batch shim ${found}, which cannot be launched without a shell.${looked} Install Claude Code with the native Windows installer, or point TERUM_SKILLS_AGENT_CMD at claude.exe.`);
}

/** A shell to run, and the folders to put first on its PATH (empty when it sets up its own). */
export interface PosixShell { file: string; path: string[] }

/** The install root a Git-for-Windows-style folder belongs to: `<root>\bin`, `\usr\bin`, `\mingw64\bin` or `\cmd`. */
function installRoot(dir: string): string | null {
  const normal = winPath.normalize(dir).replace(/[\\/]+$/, '');
  const lower = normal.toLowerCase();
  for (const tail of ['\\usr\\bin', '\\mingw64\\bin', '\\bin', '\\cmd']) if (lower.endsWith(tail)) return normal.slice(0, normal.length - tail.length);
  return null;
}

/**
 * The POSIX shell for a case's `setup` hook, its `requires` probes and its `command_succeeds` checks
 * (SETUP_RULE in generate.ts). Windows has no `/bin/sh`, so every such case failed there with `spawn
 * /bin/sh ENOENT` before the skill ran. Claude Code on Windows runs on Git for Windows, so its shell is
 * there to use. The install is found from CLAUDE_CODE_GIT_BASH_PATH, an `sh.exe` or `git.exe` on PATH,
 * or the default location, and its `bin\sh.exe` launcher is preferred: it puts `/usr/bin` and
 * `/mingw64/bin` on PATH itself, where the raw `usr\bin\sh.exe` finds no `mkdir` outside a Git Bash
 * session. An install with no launcher (MinGit, MSYS2) runs its raw shell with those folders put first
 * on PATH. Every other platform, and a Windows host with none of those, keeps `/bin/sh`.
 */
export function resolvePosixShell(evidence: Pick<AgentCommandEvidence, 'platform' | 'env' | 'isFile'>): PosixShell {
  if (evidence.platform !== 'win32') return { file: '/bin/sh', path: [] };
  const bash = envValue(evidence.env, 'CLAUDE_CODE_GIT_BASH_PATH')?.trim().replace(/^"(.*)"$/, '$1');
  const entries = pathEntries(evidence.env);
  const programFiles = envValue(evidence.env, 'ProgramFiles')?.trim() || 'C:\\Program Files';
  const roots: string[] = [];
  const add = (dir: string): void => { const root = installRoot(dir); if (root !== null && !roots.some((known) => known.toLowerCase() === root.toLowerCase())) roots.push(root); };
  if (bash) add(winPath.dirname(bash));
  for (const dir of entries) if (evidence.isFile(winPath.join(dir, 'sh.exe')) || evidence.isFile(winPath.join(dir, 'git.exe'))) add(dir);
  add(winPath.join(programFiles, 'Git', 'cmd'));
  for (const root of roots) {
    const launcher = winPath.join(root, 'bin', 'sh.exe');
    if (evidence.isFile(launcher)) return { file: launcher, path: [] };
    const raw = winPath.join(root, 'usr', 'bin', 'sh.exe');
    if (evidence.isFile(raw)) return { file: raw, path: [winPath.join(root, 'usr', 'bin'), winPath.join(root, 'mingw64', 'bin')] };
  }
  // An sh.exe on PATH outside any such layout (busybox, a tools folder) already has its PATH.
  const loose = entries.map((dir) => winPath.join(dir, 'sh.exe')).find((candidate) => evidence.isFile(candidate));
  if (loose !== undefined) return { file: loose, path: [] };
  if (bash && evidence.isFile(bash)) return { file: bash, path: [] };
  return { file: '/bin/sh', path: [] };
}

let hostShell: PosixShell | undefined;
/** `resolvePosixShell` for this host, resolved once per process. */
export function posixShell(): PosixShell {
  hostShell ??= resolvePosixShell({
    platform: process.platform, env: process.env,
    isFile: (path) => { try { return statSync(path).isFile(); } catch { return false; } },
  });
  return hostShell;
}

/** The environment variable a script travels in on Windows (see shellCommand). */
export const SCRIPT_VAR = 'TERUM_SKILLS_SCRIPT';

/**
 * How to run `script` under the host's POSIX shell, with `extra` as its positional parameters. On
 * Windows the script travels in the environment and the shell `eval`s it: the MSYS runtime re-parses
 * its command line, and Node quotes an argument only when it holds a space, so a multi-line script
 * with no spaces was split at its newlines and ran only its first line (`true\nfalse` exited 0).
 */
export function shellCommand(script: string, flags: '-c' | '-ce', extra: readonly string[] = [], shell: PosixShell = posixShell(), platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): { file: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (platform !== 'win32') return { file: shell.file, args: [flags, script, ...extra], env: { ...env } };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'Path';
  const path = [...shell.path, ...(env[pathKey] ? [env[pathKey]] : [])].join(';');
  return { file: shell.file, args: [flags, `eval "$${SCRIPT_VAR}"`, ...extra], env: { ...env, [pathKey]: path, [SCRIPT_VAR]: script } };
}
