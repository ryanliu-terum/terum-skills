import { spawn } from 'node:child_process';

export interface CommandResult { code: number; stdout: string; stderr: string; }
export interface RunOptions { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: 'inherit'; }

/** The product shells out to exactly two tools (AGENTS.md invariant 1). Injectable so tests never spawn the real `gh`. */
export interface Runner {
  run(command: 'git' | 'gh', args: readonly string[], options?: RunOptions): Promise<CommandResult>;
}

export const systemRunner: Runner = {
  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const inherit = options.stdio === 'inherit';
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        // Piped runs never get a terminal, so git must never stop to ask for credentials.
        env: { ...process.env, ...(inherit ? {} : { GIT_TERMINAL_PROMPT: '0' }), ...options.env },
        stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
    });
  },
};
