import { MAX_SELECT_ATTEMPTS, PromptClosedError, type Prompter } from './prompt.js';

/**
 * Frame mode: the machine-readable channel a desktop shell (or any program) drives the CLI through.
 * `--frames <verb> ...` on the bin writes one JSON object per stdout line and reads one JSON object
 * per stdin line. It is the Prompter serialised: every question a verb would ask a human becomes an
 * `ask` frame and blocks until the matching `answer` frame arrives. Without the flag nothing changes.
 *
 * Down (stdout):  hello | print | ask | progress | result      Up (stdin):  answer | cancel
 * Diagnostics never go to stdout; the bin routes them to stderr. Documented in docs/frame-protocol.md.
 */
export const FRAMES_FLAG = '--frames';
export const FRAME_PROTOCOL = 1;

export type FrameLevel = 'info' | 'warn' | 'error';
export type AskKind = 'confirm' | 'text' | 'select';

/** First line of every frame-mode run: what this CLI is and what it can honour, so a shell never hard-codes it. */
export interface HelloFrame { t: 'hello'; protocol: typeof FRAME_PROTOCOL; version: string | null; verbs: readonly string[]; features: Readonly<Record<string, boolean>>; }
export interface PrintFrame { t: 'print'; level: FrameLevel; line: string; }
export interface AskFrame { t: 'ask'; id: string; kind: AskKind; question: string; default?: string; choices?: readonly string[]; }
/** Reserved: no verb emits progress yet (the CLI has no progress events); the shape is fixed so a shell can render it when one does. */
export interface ProgressFrame { t: 'progress'; step: string; current?: number; total?: number; }
export interface ResultFrame { t: 'result'; verb: string; ok: boolean; exitCode: 0 | 1; error?: string; declined?: boolean; refused?: boolean; value?: unknown; }
export type Frame = HelloFrame | PrintFrame | AskFrame | ProgressFrame | ResultFrame;

export interface AnswerFrame { t: 'answer'; id: string; value: string | number | boolean; }
export interface CancelFrame { t: 'cancel'; }
export type InboundFrame = AnswerFrame | CancelFrame;

/** Public verbs, as a shell may invoke them (hidden maintenance verbs and `share` are not listed). */
export const FRAME_VERBS = ['checkout add', 'checkout remove', 'checkout list', 'login', 'setup', 'team create', 'team join', 'team remove', 'team leave', 'team workflow-update', 'invite', 'ls', 'status', 'publish', 'validate', 'eval', 'connect', 'install', 'uninstall-skill', 'uninstall', 'sync', 'search', 'update', 'app', 'profile', 'decline'] as const;

/**
 * What the CLI can honour today for the affordances the design draws (investigation doc §7). Every
 * `false` is a drawn control a real shell must hide or grey; flipping one is a product decision, not
 * a frame-mode change.
 */
export const FRAME_FEATURES: Readonly<Record<string, boolean>> = Object.freeze({
  checkouts: true,
  memberRole: true, localIdentity: true,
  favorites: false, follow: false, roles: false, lastSeen: false, installScope: false, inviteScoping: false,
  disablePerMachine: false, projectMembers: false, liftOnCards: false, runEvalInApp: false, perCase: false, progress: false,
});

export const COMMANDER_NON_ERRORS = new Set(['commander.help', 'commander.helpDisplayed', 'commander.version']);

/** Longest leading verb name; options and the operand separator end the prefix. */
export function attemptedVerb(operands: readonly string[]): string {
  let prefix = '';
  let verb: string | undefined;
  for (const operand of operands) {
    if (operand.startsWith('-')) break;
    prefix = prefix ? `${prefix} ${operand}` : operand;
    if (FRAME_VERBS.some((candidate) => candidate === prefix)) verb = prefix;
  }
  return verb || operands[0] || 'terum-skills';
}

export interface FrameStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Where malformed or unexpected inbound lines are reported (the bin passes stderr). */
  diagnostic?(line: string): void;
}

export interface ResultOutcome { verb: string; ok: boolean; error?: string; cancelled?: true; refused?: true; value?: unknown; exitCode: 0 | 1; }

export interface FrameChannel {
  /** The Prompter a verb is handed: questions become `ask` frames, `print` becomes `print` frames. */
  io: Prompter;
  hello(version: string | null): void;
  /** Terminal frame; also stops reading stdin so the process can exit when the verb is done. */
  result(outcome: ResultOutcome): void;
  /** Frames written so far that were not answers to a question (tests). */
  readonly closed: boolean;
}

export function writeFrame(output: NodeJS.WritableStream, frame: Frame): void {
  output.write(`${JSON.stringify(frame)}\n`);
}

/** Splits an inbound stream into lines and parses each as one frame; malformed lines go to `onBad`. */
function readFrames(input: NodeJS.ReadableStream, onFrame: (frame: InboundFrame) => void, onBad: (line: string) => void, onEnd: () => void): () => void {
  let buffer = '';
  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) deliver(line);
      index = buffer.indexOf('\n');
    }
  };
  const deliver = (line: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { onBad(line); return; }
    if (isAnswer(parsed) || isCancel(parsed)) onFrame(parsed);
    else onBad(line);
  };
  const onClose = () => { if (buffer.trim()) deliver(buffer.trim()); buffer = ''; onEnd(); };
  input.on('data', onData);
  input.on('end', onClose);
  input.on('close', onClose);
  return () => { input.off('data', onData); input.off('end', onClose); input.off('close', onClose); };
}

function isAnswer(value: unknown): value is AnswerFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<AnswerFrame>;
  return frame.t === 'answer' && typeof frame.id === 'string' && ['string', 'number', 'boolean'].includes(typeof frame.value);
}
function isCancel(value: unknown): value is CancelFrame {
  return Boolean(value) && typeof value === 'object' && (value as Partial<CancelFrame>).t === 'cancel';
}

/**
 * The frame implementation of the channel. `interactive` is true: a human is on the other end of
 * the shell, and verbs gate their questions on it (sync defers silently and connect refuses when it
 * is false). The one consequence a shell must handle: the `gh auth login` offer in lib/auth.ts hands
 * stdio to a child when confirmed, which would seize the frame pipes, so a shell answers that
 * confirm with `false` and shows the login as a copyable instruction (investigation doc §9.3).
 */
export function frameChannel(streams: FrameStreams): FrameChannel {
  const { input, output } = streams;
  const diagnostic = streams.diagnostic ?? (() => undefined);
  const pending = new Map<string, { question: string; resolve(value: string | number | boolean): void; reject(error: Error): void }>();
  let sequence = 0;
  let closed = false;
  let closedReason: 'closed' | 'output-closed' = 'closed';

  const failPending = () => {
    for (const [id, ask] of pending) { pending.delete(id); ask.reject(new PromptClosedError(ask.question, closedReason)); }
  };
  const stop = readFrames(input, (frame) => {
    if (frame.t === 'cancel') { closed = true; failPending(); return; }
    const ask = pending.get(frame.id);
    if (!ask) { diagnostic(`frames: answer for unknown question id ${JSON.stringify(frame.id)} ignored`); return; }
    pending.delete(frame.id);
    ask.resolve(frame.value);
  }, (line) => diagnostic(`frames: ignored malformed line ${JSON.stringify(line.length > 200 ? `${line.slice(0, 200)}…` : line)}`), () => { closed = true; failPending(); });

  const ask = (kind: AskKind, question: string, extra: Pick<AskFrame, 'default' | 'choices'> = {}): Promise<string | number | boolean> => {
    if (closed) return Promise.reject(new PromptClosedError(question, closedReason));
    const id = `q${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { question, resolve, reject });
      writeFrame(output, { t: 'ask', id, kind, question, ...extra });
    });
  };

  const io: Prompter = {
    interactive: true,
    channel: 'frames',
    async confirm(question) {
      const answer = await ask('confirm', question);
      return typeof answer === 'boolean' ? answer : /^(y|yes|true)$/i.test(String(answer).trim());
    },
    async text(question, defaultValue) {
      const answer = String(await ask('text', question, defaultValue === undefined || defaultValue === '' ? {} : { default: defaultValue })).trim();
      return answer || defaultValue || '';
    },
    async select(question, choices) {
      for (let attempt = 0; attempt < MAX_SELECT_ATTEMPTS; attempt++) {
        const answer = await ask('select', question, { choices });
        const index = typeof answer === 'number' ? answer : /^\d+$/.test(String(answer).trim()) ? Number(String(answer).trim()) : NaN;
        const picked = Number.isInteger(index) && index >= 1 && index <= choices.length ? choices[index - 1] : choices.find((choice) => choice === String(answer));
        if (picked !== undefined) return picked;
        writeFrame(output, { t: 'print', level: 'warn', line: `Enter a number from 1 to ${choices.length} or one of the choices.` });
      }
      throw new Error(`No valid choice after ${MAX_SELECT_ATTEMPTS} attempts`);
    },
    print(line) {
      writeFrame(output, { t: 'print', level: 'info', line });
    },
  };

  return {
    io,
    hello(version) { writeFrame(output, { t: 'hello', protocol: FRAME_PROTOCOL, version, verbs: FRAME_VERBS, features: FRAME_FEATURES }); },
    result(outcome) {
      const frame: ResultFrame = { t: 'result', verb: outcome.verb, ok: outcome.ok, exitCode: outcome.exitCode };
      if (outcome.error !== undefined) frame.error = outcome.error;
      if (outcome.cancelled === true) frame.declined = true;
      if (outcome.refused === true) frame.refused = true;
      if (outcome.value !== undefined) frame.value = outcome.value;
      writeFrame(output, frame);
      // The run is over: stop holding stdin open so the process can exit without the shell closing the
      // pipe. Pausing alone is not enough for a piped stdin (the socket still refs the event loop), so
      // the stream is also unref'd when it can be.
      closed = true; closedReason = 'output-closed'; failPending(); stop();
      const socket = input as { pause?(): void; unref?(): void };
      socket.pause?.();
      socket.unref?.();
    },
    get closed() { return closed; },
  };
}
