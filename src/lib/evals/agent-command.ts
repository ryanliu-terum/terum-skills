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
const SHIM_SCRIPT = /"([^"\r\n]*%~?dp0%?[^"\r\n]*?\.(?:[cm]?js))"|(?:^|\s)((?:%~?dp0%?)[^\s"]*?\.(?:[cm]?js))(?=\s|$)/gim;

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
  if (script !== undefined) return success({ file: evidence.execPath, args: [script, ...args] });
  const looked = fromShim.length > 0 ? ` It launches ${fromShim.join(', ')}, which does not exist.` : text === null ? ' The shim could not be read.' : ' The shim names no script this tool can launch.';
  return failure(`\`${command}\` resolves to the batch shim ${found}, which cannot be launched without a shell.${looked} Install Claude Code with the native Windows installer, or point TERUM_SKILLS_AGENT_CMD at claude.exe.`);
}
