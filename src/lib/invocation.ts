import { join } from 'node:path';
import type { Launch } from './launch.js';
import { shellQuote } from './teamRepo.js';

export type InvocationForm = 'bare' | 'npx';
export interface WithForm { form?: InvocationForm; }
export const NPX_PREFIX = 'npx -y terum-skills@latest';
export interface FormEvidence {
  launch: Launch | undefined;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  pathEntries: string[];
  access(p: string): Promise<void>;
  realpath(p: string): Promise<string>;
  stat(p: string): Promise<{ isFile(): boolean }>;
}

/** Hint evidence only: never changes installation provenance. */
export async function resolveInvocationForm(evidence: FormEvidence): Promise<InvocationForm> {
  try {
    if (['npm_command', 'npm_lifecycle_event', 'npm_execpath', 'npm_config_user_agent'].some((key) => evidence.env[key] !== undefined)) return 'npx';
    if (evidence.launch?.kind !== 'global') return 'npx';
    // Follow-up (unverified): Windows shim-target parsing. No bare Windows hints in this rev.
    if (evidence.platform === 'win32') return 'npx';
    for (const entry of evidence.pathEntries) {
      if (!entry) continue;
      const candidate = join(entry, 'terum-skills');
      // A PATH walk passes every entry that lacks the executable; only the first entry that has it decides.
      let regularFile: boolean;
      try { regularFile = (await evidence.stat(candidate)).isFile(); }
      catch (error) { if (isAbsent(error)) continue; return 'npx'; }
      if (!regularFile) continue;
      await evidence.access(candidate);
      return await evidence.realpath(candidate) === evidence.launch.path ? 'bare' : 'npx';
    }
  } catch { return 'npx'; }
  return 'npx';
}

function isAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Undefined form defaults to npx. Arguments use POSIX quoting, not cmd.exe syntax. */
export function invocation(form: InvocationForm | undefined, verb: string, ...args: string[]): string {
  return [form === 'bare' ? 'terum-skills' : NPX_PREFIX, verb, ...args.map(shellQuote)].join(' ');
}

/** Shared onboarding copy for a successful query that found no configured teams. */
export function getStartedLines(form: InvocationForm | undefined): readonly string[] {
  return [
    'No team is configured on this machine.',
    `  Create a team: ${invocation(form, 'setup')}`,
    `  Join a team:   ${invocation(form, 'setup <org>/<repo>')}`,
  ];
}
