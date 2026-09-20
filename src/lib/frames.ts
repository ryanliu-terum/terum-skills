import { MAX_SELECT_ATTEMPTS, PromptClosedError, type FormAnswers, type FormField, type FormOptions, type Prompter, type ProgressUpdate } from './prompt.js';
import { CancelledError } from './result.js';

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
/**
 * The protocol a shell must declare (`--frames=2`) before the CLI sends a `form` ask. A bare `--frames` is
 * protocol 1: forms are asked as their fields, one question at a time, exactly as before. The CLI advertises
 * that it understands the declaration through `hello.features.form`, so a shell never sends `=2` to a CLI
 * that would hand it to commander as an unknown option.
 */
export const FORM_PROTOCOL = 2;

export type FrameLevel = 'info' | 'warn' | 'error';
export type AskKind = 'confirm' | 'text' | 'select' | 'path' | 'form';

/** First line of every frame-mode run: what this CLI is and what it can honour, so a shell never hard-codes it. */
export interface HelloFrame { t: 'hello'; protocol: typeof FRAME_PROTOCOL; version: string | null; verbs: readonly string[]; features: Readonly<Record<string, boolean>>; }
export interface PrintFrame { t: 'print'; id?: string; level: FrameLevel; line: string; }
export interface AskFrame {
  t: 'ask'; id?: string; kind: AskKind; question: string; default?: string; choices?: readonly string[]; detail?: readonly string[]; descriptions?: readonly string[];
  /** `form` only: the fields to draw, the submit label, whether Skip is offered, and per-field problems with the previous answers. */
  fields?: readonly FormField[]; submit?: string; skippable?: boolean; skipLabel?: string; errors?: Readonly<Record<string, string>>;
}

/**
 * Reads the frames flag off an argv (before any `--` operand separator): whether frame mode is on, the highest
 * protocol the shell declared (`--frames=2`), and the argv with every spelling of the flag removed.
 */
export function framesFromArgv(argv: readonly string[]): { frames: boolean; shellProtocol: number; argv: string[] } {
  const separator = argv.indexOf('--');
  const prefixEnd = separator === -1 ? argv.length : separator;
  const isFlag = (argument: string) => argument === FRAMES_FLAG || /^--frames=\d+$/.test(argument);
  const flags = argv.slice(0, prefixEnd).filter(isFlag);
  const shellProtocol = flags.reduce((highest, flag) => Math.max(highest, flag === FRAMES_FLAG ? FRAME_PROTOCOL : Number(flag.slice(FRAMES_FLAG.length + 1))), 0);
  return { frames: flags.length > 0, shellProtocol, argv: argv.filter((argument, index) => index >= prefixEnd || !isFlag(argument)) };
}
/** Emitted by `install`, `publish` and `setup`'s evals step; every other verb is silent. One shape, declared once (Prompter.progress). Never ordered against `ask`; a shell may ignore it. */
export interface ProgressFrame extends ProgressUpdate { t: 'progress'; id?: string; }
export interface ResultFrame { t: 'result'; id?: string; verb: string; ok: boolean; exitCode: 0 | 1; error?: string; declined?: boolean; refused?: boolean; value?: unknown; }
export type Frame = HelloFrame | PrintFrame | AskFrame | ProgressFrame | ResultFrame;

/** A `form` ask is answered with one object of field answers, or null when the person pressed Skip. */
export interface AnswerFrame { t: 'answer'; id: string; value?: string | number | boolean | FormAnswers | null; }
export interface CancelFrame { t: 'cancel'; }
export interface RequestFrame { t: 'request'; id: string; argv: string[]; cwd?: string; }
export interface ServeCancelFrame { t: 'cancel'; id?: string; }
export type InboundFrame = AnswerFrame | CancelFrame | RequestFrame | ServeCancelFrame;
/** Shared by the CLI session and desktop adapter; mutations always keep their own process. */
export { SERVE_READ_VERBS } from './serve-verbs.js';

/** Public verbs, as a shell may invoke them (hidden maintenance verbs and `share` are not listed).
 * B4 marketplace uses existing ls/status/install/publish entries; reinstall is install, not a verb. */
export const FRAME_VERBS = [
  'skill move', 'skill copy', 'skill rename', 'skill delete', 'skill fix', 'skill category', 'skill enable', 'skill disable', 'project add', 'project remove', 'project list', 'login', 'setup', 'team create', 'team join', 'team remove', 'team leave', 'team move', 'team workflow-update', 'team project create', 'team project delete', 'invite', 'ls', 'status', 'reconcile', 'publish', 'unpublish', 'validate', 'eval', 'eval-report', 'usage', 'misses', 'install', 'uninstall-skill', 'uninstall', 'sync', 'prune', 'search', 'update', 'app', 'profile', 'app-update', 'serve'] as const;

/**
 * What the CLI can honour today for the affordances the design draws (investigation doc §7). Every
 * `false` is a drawn control a real shell must hide or grey; flipping one is a product decision, not
 * a frame-mode change.
 *
 * `liftOnCards` moved false -> true on 2026-09-10 (Ryan), overriding the D29 display resolution's
 * "no lift-style decimal appears at card level" for the desktop app's Library and Marketplace cards
 * only; the rest of D29 stands. The card is backed by `ls`'s `receipt` limb, so the number a card
 * shows is one receipt's own `candidate-vs-baseline` net lift with its provenance beside it, never a
 * statistic derived across receipts (eval-engine spec §12).
 *
 * `disablePerMachine` moved false -> true on 2026-09-14 (Teddy): `skill enable` / `skill disable` write Claude
 * Code's own `skillOverrides` setting (src/lib/skill-overrides.ts), so the drawn switch is now the same switch
 * as Claude's `/skills` menu rather than an app-only flag.
 */
export const FRAME_FEATURES: Readonly<Record<string, boolean>> = Object.freeze({
  libraryProjects: true, projects: true,
  memberRole: true, localIdentity: true, roles: true,
  favorites: false, follow: false, lastSeen: false, installScope: true, inviteScoping: false,
  disablePerMachine: true, projectMembers: false, liftOnCards: true, runEvalInApp: true, perCase: true, progress: true,
  refresh: true, appUpdate: true, reconcile: true,
  serve: true, usage: true,
  // 2026-09-19 (Ryan): setup asks its team, identity, invitation and Claude Code questions as three forms. A shell
  // that draws them declares `--frames=2`; this switch tells it the CLI accepts that declaration.
  form: true,
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
  onCancel?(): void;
  /** Session requests use an isolated input stream and stamp every response with this id. */
  requestId?: string;
  /** What the shell declared it renders (framesFromArgv); below FORM_PROTOCOL the channel has no `form` and askForm falls back. */
  shellProtocol?: number;
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
export function readFrames(input: NodeJS.ReadableStream, onFrame: (frame: InboundFrame) => void, onBad: (line: string) => void, onEnd: () => void, serve = false): () => void {
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
    if (isAnswer(parsed) || (!serve && isCancel(parsed)) || (serve && isServeCancel(parsed)) || (serve && isRequest(parsed))) onFrame(parsed);
    else onBad(line);
  };
  const onClose = () => { if (buffer.trim()) deliver(buffer.trim()); buffer = ''; onEnd(); };
  input.on('data', onData);
  input.on('end', onClose);
  input.on('close', onClose);
  return () => { input.off('data', onData); input.off('end', onClose); input.off('close', onClose); };
}

export function isFormAnswers(value: unknown): value is FormAnswers {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string' || typeof entry === 'boolean');
}
export function isAnswer(value: unknown): value is AnswerFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<AnswerFrame>;
  return frame.t === 'answer' && typeof frame.id === 'string' && (frame.value === undefined || frame.value === null || ['string', 'number', 'boolean'].includes(typeof frame.value) || isFormAnswers(frame.value));
}
export function isCancel(value: unknown): value is CancelFrame {
  return Boolean(value) && typeof value === 'object' && (value as Partial<CancelFrame>).t === 'cancel';
}

function isRequestId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 64; }
export function isRequest(value: unknown): value is RequestFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<RequestFrame>;
  return frame.t === 'request' && isRequestId(frame.id) && Array.isArray(frame.argv) && frame.argv.every(arg => typeof arg === 'string') && (frame.cwd === undefined || typeof frame.cwd === 'string');
}
export function isServeCancel(value: unknown): value is ServeCancelFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<ServeCancelFrame>;
  return frame.t === 'cancel' && (frame.id === undefined || isRequestId(frame.id));
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
  const write = (frame: Frame) => writeFrame(output, streams.requestId !== undefined && frame.t !== 'hello' ? { ...frame, id: streams.requestId } : frame);
  const diagnostic = streams.diagnostic ?? (() => undefined);
  type Answer = NonNullable<AnswerFrame['value']> | null;
  const pending = new Map<string, { question: string; kind: AskKind; defaultChoice?: string | undefined; resolve(value: Answer): void; reject(error: Error): void }>();
  let sequence = 0;
  let closed = false;
  let closedReason: 'closed' | 'output-closed' = 'closed';

  const failPending = () => {
    for (const [id, ask] of pending) { pending.delete(id); ask.reject(new PromptClosedError(ask.question, closedReason)); }
  };
  const stop = readFrames(input, (frame) => {
    if (frame.t === 'cancel') { closed = true; failPending(); streams.onCancel?.(); return; }
    if (frame.t !== 'answer') { diagnostic('frames: unexpected request ignored'); return; }
    const ask = pending.get(frame.id);
    if (!ask) { diagnostic(`frames: answer for unknown question id ${JSON.stringify(frame.id)} ignored`); return; }
    // null is an answer only to a form (Skip); anywhere else it is a missing value, as before.
    const value = frame.value === null && ask.kind !== 'form' ? undefined : (frame.value === undefined ? ask.defaultChoice : frame.value);
    if (value === undefined) { diagnostic(`frames: answer without a value for ${JSON.stringify(frame.id)} ignored`); return; }
    pending.delete(frame.id);
    ask.resolve(value);
  }, (line) => diagnostic(`frames: ignored malformed line ${JSON.stringify(line.length > 200 ? `${line.slice(0, 200)}…` : line)}`), () => { closed = true; failPending(); });

  const ask = (kind: AskKind, question: string, extra: Pick<AskFrame, 'default' | 'choices' | 'detail' | 'descriptions' | 'fields' | 'submit' | 'skippable' | 'skipLabel' | 'errors'> = {}): Promise<Answer> => {
    if (closed) return Promise.reject(new PromptClosedError(question, closedReason));
    const id = streams.requestId ?? `q${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { question, kind, resolve, reject, defaultChoice: kind === 'select' ? extra.default : undefined });
      const { detail, ...rest } = extra;
      write({ t: 'ask', id, kind, question, ...rest, ...(detail?.length ? { detail } : {}) });
    });
  };

  /**
   * One `form` ask, answered with an object. The answer is normalised against the fields: a value of the wrong
   * type, or a missing one, is the field's default; a read-only field and a disabled checkbox always answer their
   * default whatever the shell sent. null is Skip and is only honoured on a skippable form.
   */
  const form = async (title: string, fields: readonly FormField[], options: FormOptions = {}): Promise<FormAnswers | null> => {
    const answer = await ask('form', title, {
      fields,
      ...(options.detail?.length ? { detail: options.detail } : {}),
      ...(options.submit === undefined ? {} : { submit: options.submit }),
      ...(options.skippable ? { skippable: true } : {}),
      ...(options.skipLabel === undefined ? {} : { skipLabel: options.skipLabel }),
      ...(options.errors && Object.keys(options.errors).length ? { errors: options.errors } : {}),
    });
    if (answer === null) {
      if (options.skippable) return null;
      throw new CancelledError(`${title} was cancelled.`);
    }
    const sent: Record<string, unknown> = isFormAnswers(answer) ? answer : {};
    const answers: FormAnswers = {};
    for (const field of fields) {
      const value = sent[field.id];
      if (field.kind === 'checkbox') answers[field.id] = field.disabled || typeof value !== 'boolean' ? field.default : value;
      else answers[field.id] = field.readOnly || typeof value !== 'string' ? (field.default ?? '') : value;
    }
    return answers;
  };

  const io: Prompter = {
    interactive: true,
    channel: 'frames',
    async confirm(question, options) {
      const answer = await ask('confirm', question, { ...(options?.default === undefined ? {} : { default: String(options.default) }), ...(options?.detail?.length ? { detail: options.detail } : {}) });
      return typeof answer === 'boolean' ? answer : String(answer).trim() ? /^(y|yes|true)$/i.test(String(answer).trim()) : Boolean(options?.default);
    },
    async text(question, defaultValue, options) {
      const answer = String(await ask(options?.path === true ? 'path' : 'text', question, { ...(defaultValue === undefined || defaultValue === '' ? {} : { default: defaultValue }), ...(options?.detail?.length ? { detail: options.detail } : {}) })).trim();
      return answer || defaultValue || '';
    },
    async select(question, choices, defaultChoice, options) {
      for (let attempt = 0; attempt < MAX_SELECT_ATTEMPTS; attempt++) {
        const answer = await ask('select', question, { choices, ...(options?.descriptions ? { descriptions: options.descriptions } : {}), ...(defaultChoice === undefined ? {} : { default: defaultChoice }), ...(options?.detail?.length ? { detail: options.detail } : {}) });
        if ((answer === undefined || answer === null || String(answer).trim() === '') && defaultChoice !== undefined) return defaultChoice;
        const index = typeof answer === 'number' ? answer : /^\d+$/.test(String(answer).trim()) ? Number(String(answer).trim()) : NaN;
        const picked = Number.isInteger(index) && index >= 1 && index <= choices.length ? choices[index - 1] : choices.find((choice) => choice === String(answer));
        if (picked !== undefined) return picked;
        write({ t: 'print', level: 'warn', line: `Enter a number from 1 to ${choices.length} or one of the choices.` });
      }
      throw new Error(`No valid choice after ${MAX_SELECT_ATTEMPTS} attempts`);
    },
    print(line) {
      if (streams.requestId !== undefined && closed) return;
      write({ t: 'print', level: 'info', line });
    },
    ...((streams.shellProtocol ?? FRAME_PROTOCOL) >= FORM_PROTOCOL ? { form } : {}),
    progress(update) {
      // Exactly one `result` frame ends a run (docs/frame-protocol.md); nothing may follow it.
      if (closed) return;
      write({ t: 'progress', ...update });
    },
  };

  return {
    io,
    hello(version) { write({ t: 'hello', protocol: FRAME_PROTOCOL, version, verbs: FRAME_VERBS, features: FRAME_FEATURES }); },
    result(outcome) {
      const frame: ResultFrame = { t: 'result', verb: outcome.verb, ok: outcome.ok, exitCode: outcome.exitCode };
      if (outcome.error !== undefined) frame.error = outcome.error;
      if (outcome.cancelled === true) frame.declined = true;
      if (outcome.refused === true) frame.refused = true;
      if (outcome.value !== undefined) frame.value = outcome.value;
      write(frame);
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
