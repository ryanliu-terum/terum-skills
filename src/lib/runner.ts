import { spawn } from 'node:child_process';
import { platform } from 'node:os';

export interface CommandResult { code: number; stdout: string; stderr: string; }
export interface RunOptions { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: 'inherit'; deadlineMs?: number; maxOutputBytes?: number; }

/** The product shells out to exactly two tools (AGENTS.md invariant 1). Injectable so tests never spawn the real `gh`. */
export interface Runner {
  run(command: 'git' | 'gh', args: readonly string[], options?: RunOptions): Promise<CommandResult>;
}

export const systemRunner: Runner = {
  run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const inherit = options.stdio === 'inherit';
      const grouped = options.deadlineMs !== undefined && platform() !== 'win32';
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        // Piped runs never get a terminal, so git must never stop to ask for credentials.
        env: { ...process.env, ...(inherit ? {} : { GIT_TERMINAL_PROMPT: '0' }), ...options.env },
        stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        detached: grouped,
      });
      const out: Buffer[] = []; const err: Buffer[] = [];
      let bytes = 0; let expired = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      let settle: ReturnType<typeof setTimeout> | undefined;
      const collect = (into: Buffer[], chunk: Buffer): void => {
        const remaining = Math.max(0, (options.maxOutputBytes ?? Infinity) - bytes);
        const part = chunk.subarray(0, remaining); if (part.length) into.push(part); bytes += part.length;
      };
      const signal = (name: NodeJS.Signals | 0): boolean => {
        try {
          // A shell alias or git transport can hold the pipes after git exits. Kill the whole
          // bounded process group so close really settles and no child is left behind.
          if (grouped && child.pid) { process.kill(-child.pid, name); return true; }
          return child.kill(name);
        } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' && child.kill(name); }
      };
      const clear = (): void => { clearTimeout(deadline); clearTimeout(escalation); clearTimeout(settle); };
      if (options.deadlineMs !== undefined) deadline = setTimeout(() => {
        expired = true; signal('SIGTERM');
        escalation = setTimeout(() => {
          signal('SIGKILL');
          // Where no process group exists (Windows), a grandchild such as git-remote-https can keep the
          // inherited pipes open after git itself is gone, and `close` would never fire. Dropping our ends
          // of the pipes bounds the wait: `close` follows `exit`, whatever the grandchild does.
          settle = setTimeout(() => { child.stdout?.destroy(); child.stderr?.destroy(); }, 2000);
        }, 2000);
      }, options.deadlineMs);
      child.stdout?.on('data', (chunk: Buffer) => collect(out, chunk));
      child.stderr?.on('data', (chunk: Buffer) => collect(err, chunk));
      child.on('error', (error) => { clear(); reject(error); });
      child.on('close', async (code) => {
        clear();
        if (expired && grouped) {
          signal('SIGKILL');
          // close reaps git, not an alias's grandchildren. Let the OS reap the terminated
          // process group before reporting cancellation complete; never wait indefinitely.
          const cleanupDeadline = Date.now() + 2000;
          while (signal(0) && Date.now() < cleanupDeadline) await new Promise<void>((done) => setTimeout(done, 10));
        }
        let verb = args[0] ?? '';
        // The probe's -c option is not its verb. Keep deadline errors useful for local aliases too.
        for (let i = 0; i < args.length; i++) { if (args[i] === '-c') { i++; continue; } verb = args[i]!; break; }
        resolve({ code: expired ? 124 : code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: expired ? `terum-skills: ${command} ${verb} exceeded ${options.deadlineMs! / 1000} s` : Buffer.concat(err).toString('utf8') });
      });
    });
  },
};
