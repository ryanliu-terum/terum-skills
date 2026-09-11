import type { EvalResult, PendingEval } from '../../commands/eval.js';
import { settleWithConcurrency } from '../concurrency.js';
import type { Prompter } from '../prompt.js';
import { fromError, type Result } from '../result.js';

export const EVAL_PARALLEL_DEFAULT = 4;
export const EVAL_LOCK_WAIT_MS = 300_000;

/** One output/question mutex for the whole batch, including completion while a question is open. */
export async function runEvalBatch(input: {
  items: PendingEval[];
  parallel: number;
  io: Prompter;
  run: (item: PendingEval, io: Prompter) => Promise<Result<EvalResult>>;
  onSettled?: (item: PendingEval, outcome: Result<EvalResult>) => void;
}): Promise<{ ok: number; failed: number; outcomes: Result<EvalResult>[] }> {
  const { items, io } = input;
  const parallel = Number.isFinite(input.parallel) ? Math.max(1, Math.floor(input.parallel)) : 1;
  let tail = Promise.resolve(), done = 0;
  function exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = tail.then(action);
    tail = result.then(() => undefined, () => undefined); // Release after a declined/failed prompt too.
    return result;
  }
  io.print(`Evaluating ${items.length} skills, ${parallel} at a time…`);
  const settled = await settleWithConcurrency(items, parallel, async item => {
    const buffer: string[] = [];
    const flush = () => {
      if (!buffer.length) return;
      io.print(`── ${item.name} ──`);
      for (const line of buffer.splice(0)) io.print(line);
    };
    const ask = <T>(action: () => Promise<T>) => exclusive(async () => { flush(); return action(); });
    const captured: Prompter = {
      interactive: io.interactive, ...(io.channel === undefined ? {} : { channel: io.channel }),
      print: line => { buffer.push(line); }, progress: () => undefined,
      confirm: (question, options) => ask(() => io.confirm(question, options)),
      text: (question, fallback, options) => ask(() => io.text(question, fallback, options)),
      select: (question, choices, fallback, options) => ask(() => io.select(question, choices, fallback, options)),
    };
    let outcome: Result<EvalResult>;
    try { outcome = await input.run(item, captured); }
    catch (error) { outcome = fromError(error); }
    try { input.onSettled?.(item, outcome); }
    catch (error) { outcome = fromError(error); }
    await exclusive(async () => {
      flush();
      io.print(outcome.ok ? `✓ ${item.name}` : `✗ ${item.name}: ${outcome.error.split(/\r?\n/)[0]}`);
      io.progress?.({ step: 'evals', current: ++done, total: items.length });
    });
    return outcome;
  });
  const outcomes = settled.map(result => result.status === 'fulfilled' ? result.value : fromError(result.reason));
  const ok = outcomes.filter(outcome => outcome.ok).length;
  io.print(`Evaluated ${ok} of ${items.length}; ${items.length - ok} failed.`);
  return { ok, failed: items.length - ok, outcomes };
}
