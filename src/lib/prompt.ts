import { createInterface } from 'node:readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';

/** Lines the person needs in order to answer; a terminal prints them once, immediately before the question; frame mode carries them on the ask frame. */
export interface AskOptions { detail?: readonly string[]; }

/** A verb's report that a long step has moved on. A terminal ignores it; frame mode writes one `progress` frame. */
export interface ProgressUpdate { step: string; current?: number; total?: number; }

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
  /**
   * What is on the other end: a terminal, or a program over frames (docs/frame-protocol.md). Verbs read it
   * only for the two questions that need a terminal and make no sense to a program: the app opt-in in
   * setup and the `gh auth login` offer (decision walk D5, 2026-09-08). Absent means terminal.
   */
  readonly channel?: 'terminal' | 'frames';
  confirm(question: string, options?: AskOptions): Promise<boolean>;
  text(question: string, defaultValue?: string, options?: AskOptions): Promise<string>;
  select(question: string, choices: readonly string[], defaultChoice?: string, options?: AskOptions): Promise<string>;
  print(line: string): void;
  /**
   * Optional: only a channel that can render progress implements it (frame mode does; a terminal does not,
   * because a verb that wants a person to see progress prints a line). Callers must use `io.progress?.(…)`.
   */
  progress?(update: ProgressUpdate): void;
}

/** §3: `sync --hook` is typed against this — it can print and nothing else. */
export interface NonInteractivePrompter {
  readonly interactive: false;
  print(line: string): void;
}

/** Thrown when a question cannot be answered: the channel is not interactive, input ended first, or the output the question would go to is gone. */
export class PromptClosedError extends Error {
  constructor(question: string, reason: 'not-interactive' | 'closed' | 'output-closed') {
    super(reason === 'not-interactive'
      ? `Cannot ask "${question}": this command needs an interactive terminal (stdin is not a TTY).`
      : reason === 'output-closed'
        ? `Output closed before "${question}" could be asked: the reader went away.`
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
  /** Settles when the output stream broke (a reader that went away): a pending or later question fails closed instead of hanging. */
  outputClosed?: Promise<void>;
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
  let outputBroken = false;
  // Settlement, not fulfilment, is the signal (the field's doc comment says so): a producer that
  // reports the broken output by REJECTING has lost it just as surely, and a fulfilment-only handler
  // would leave that rejection unhandled on a promise nobody subscribes to — process-fatal.
  const markBroken = () => { outputBroken = true; };
  void streams.outputClosed?.then(markBroken, markBroken);

  async function ask(question: string): Promise<string> {
    if (!interactive) throw new PromptClosedError(question.trim(), 'not-interactive');
    if (outputBroken) throw new PromptClosedError(question.trim(), 'output-closed');
    const rl = createInterface({ input, output, terminal: true });
    const closed = new Promise<never>((_, reject) => rl.once('close', () => reject(new PromptClosedError(question.trim(), 'closed'))));
    // A pending question also loses to the output breaking under it: the broken-pipe signal arrives
    // from the event loop, after the question was already written, so a pre-check alone is not enough.
    const failClosed = (): never => { throw new PromptClosedError(question.trim(), 'output-closed'); };
    const broken = streams.outputClosed?.then<never>(failClosed, failClosed);
    try {
      return await Promise.race(broken ? [rl.question(question), closed, broken] : [rl.question(question), closed]);
    } finally {
      rl.close();
    }
  }

  return {
    interactive,
    channel: 'terminal',
    async confirm(question, options) {
      for (const line of options?.detail ?? []) output.write(`${line}\n`);
      const answer = await ask(`${question} [y/N] `);
      return /^(y|yes)$/i.test(answer.trim());
    },
    async text(question, defaultValue, options) {
      for (const line of options?.detail ?? []) output.write(`${line}\n`);
      const suffix = defaultValue === undefined || defaultValue === '' ? '' : ` [${defaultValue}]`;
      const answer = await ask(`${question}${suffix}: `);
      return answer.trim() || defaultValue || '';
    },
    async select(question, choices, defaultChoice, options) {
      for (const line of options?.detail ?? []) output.write(`${line}\n`);
      const lines = choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n');
      for (let attempt = 0; attempt < MAX_SELECT_ATTEMPTS; attempt++) {
        const suffix = defaultChoice === undefined ? '' : ` [${defaultChoice}]`;
        const answer = (await ask(`${question}${suffix}\n${lines}\n> `)).trim();
        if (!answer && defaultChoice !== undefined) return defaultChoice;
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
