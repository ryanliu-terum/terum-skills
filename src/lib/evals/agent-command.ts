/**
 * Resolves the agent binary the way a Windows shell would, so `claude` launches under the
 * desktop app and from PowerShell alike. Node's `spawn` refuses a `.cmd`/`.bat` shim without a
 * shell (`spawn EINVAL`, the 2024 batch-injection hardening), and a shell wrapper would mangle
 * the multi-line prompt that `runAgent`/`askJson` pass as one argv value. So an npm shim is
 * bypassed: its `cli.js` runs on the current Node directly, arguments untouched. A native
 * `claude.exe` spawns as is. Every other platform spawns the name unchanged.
 */
import { win32 as winPath } from 'node:path';
import type { Result } from '../result.js';
import { failure, success } from '../result.js';

export interface AgentCommandEvidence {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** The Node binary running this process; an npm shim's `cli.js` runs on it directly. */
  execPath: string;
  isFile(path: string): boolean;
}

export interface AgentSpawnSpec { file: string; args: string[] }

/** The extensions Windows treats as launchable and this resolver knows how to start. */
const LAUNCHABLE = ['.com', '.exe', '.bat', '.cmd'] as const;
type Launchable = typeof LAUNCHABLE[number];
const isLaunchable = (ext: string): ext is Launchable => (LAUNCHABLE as readonly string[]).includes(ext);
/** Where npm's `claude.cmd` shim points: the package beside it. */
const SHIM_TARGET = ['node_modules', '@anthropic-ai', 'claude-code', 'cli.js'];

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

export function resolveAgentCommand(command: string, args: readonly string[], evidence: AgentCommandEvidence): Result<AgentSpawnSpec> {
  if (evidence.platform !== 'win32') return success({ file: command, args: [...args] });
  const explicit = /[\\/]/.test(command) || winPath.extname(command) !== '';
  const found = candidates(command, evidence.env).find((candidate) => evidence.isFile(candidate));
  if (found === undefined) return failure(`\`${command}\` was not found${explicit ? '' : ' on PATH'} — is Claude Code installed?`);
  const extension = winPath.extname(found).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') return success({ file: found, args: [...args] });
  const target = winPath.join(winPath.dirname(found), ...SHIM_TARGET);
  if (evidence.isFile(target)) return success({ file: evidence.execPath, args: [target, ...args] });
  return failure(`\`${command}\` resolves to the batch shim ${found}, which cannot be launched without a shell. Install Claude Code with the native Windows installer, or point TERUM_SKILLS_AGENT_CMD at claude.exe.`);
}
