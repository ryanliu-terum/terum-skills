import { createInterface } from 'node:readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';

/**
 * §3 library-first: the ONLY channel a verb uses to talk to a human. Verbs never touch
 * process.stdin / stdout / console; the ESLint rule in eslint.config.js enforces that and
 * src/lib/__tests__/prompt.test.ts proves the rule fires.
 *
 * One addition beyond the four spec methods, a property of the channel rather than of any verb:
 * `interactive` (a human is on the other end and stdio may be handed to a child process, which
 * is what the §6 `login` gh offer needs to know). There is no hidden-input method: the tool never
 * asks for a token (rev 9, Decision 2).
 */
export interface Prompter {
  readonly interactive: boolean;
  confirm(question: string): Promise<boolean>;
  text(question: string, defaultValue?: string): Promise<string>;
  select(question: string, choices: readonly string[]): Promise<string>;
  print(line: string): void;
}

/** §3: `sync --hook` is typed against this — it can print and nothing else. */
export interface NonInteractivePrompter {
  readonly interactive: false;
  print(line: string): void;
}

/** Thrown when a question cannot be answered: the channel is not interactive, or input ended first. */
export class PromptClosedError extends Error {
  constructor(question: string, reason: 'not-interactive' | 'closed') {
    super(reason === 'not-interactive'
      ? `Cannot ask "${question}": this command needs an interactive terminal (stdin is not a TTY).`
      : `Input ended before "${question}" was answered.`);
    this.name = 'PromptClosedError';
  }
}

export const MAX_SELECT_ATTEMPTS = 3;

export interface TerminalStreams {
  input?: NodeJS.ReadableStream & { isTTY?: boolean };
  output?: NodeJS.WritableStream;
  /** Override TTY detection (tests). Defaults to `input.isTTY`. */
  interactive?: boolean;
}

/**
 * The terminal implementation. Questions are only asked on an interactive channel; a piped or
 * closed stdin gets PromptClosedError instead of a hang. Each question opens its own readline
 * interface and closes it in a `finally`, so the process can exit when the verb returns and a
 * child process handed our stdio (gh auth login) never competes with a live reader. EOF while a
 * question is pending is raced explicitly, because readline/promises never settles it.
 */
export function terminalPrompter(streams: TerminalStreams = {}): Prompter {
  const input = streams.input ?? processStdin;
  const output = streams.output ?? processStdout;
  const interactive = streams.interactive ?? Boolean(input.isTTY);

  async function ask(question: string): Promise<string> {
    if (!interactive) throw new PromptClosedError(question.trim(), 'not-interactive');
    const rl = createInterface({ input, output, terminal: true });
    const closed = new Promise<never>((_, reject) => rl.once('close', () => reject(new PromptClosedError(question.trim(), 'closed'))));
    try {
      return await Promise.race([rl.question(question), closed]);
    } finally {
      rl.close();
    }
  }

  return {
    interactive,
    async confirm(question) {
      const answer = await ask(`${question} [y/N] `);
      return /^(y|yes)$/i.test(answer.trim());
    },
    async text(question, defaultValue) {
      const suffix = defaultValue === undefined || defaultValue === '' ? '' : ` [${defaultValue}]`;
      const answer = await ask(`${question}${suffix}: `);
      return answer.trim() || defaultValue || '';
    },
    async select(question, choices) {
      const lines = choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n');
      for (let attempt = 0; attempt < MAX_SELECT_ATTEMPTS; attempt++) {
        const answer = (await ask(`${question}\n${lines}\n> `)).trim();
        const byNumber = /^\d+$/.test(answer) ? choices[Number(answer) - 1] : undefined;
        const picked = byNumber ?? choices.find((choice) => choice === answer);
        if (picked !== undefined) return picked;
        output.write(`Enter a number from 1 to ${choices.length}.\n`);
      }
      throw new Error(`No valid choice after ${MAX_SELECT_ATTEMPTS} attempts`);
    },
    print(line) {
      output.write(`${line}\n`);
    },
  };
}
