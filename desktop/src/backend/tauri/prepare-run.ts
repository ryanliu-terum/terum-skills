import type { Result, Run } from '../types';

/** Resolve read-only inputs before starting a mutation, preserving the Run contract and cancellation. */
export function prepareRun<Input, Output>(prepare: (signal: AbortSignal) => Promise<Result<Input>>, start: (input: Input) => Run<Output>): Run<Output> {
  const controller = new AbortController();
  let active: Run<Output> | undefined;
  const ready = Promise.resolve().then(async (): Promise<Result<Run<Output>>> => {
    if (controller.signal.aborted) return {ok:false, error:'Cancelled.', cancelled:true};
    try {
      const input = await prepare(controller.signal);
      if (controller.signal.aborted) return {ok:false, error:'Cancelled.', cancelled:true};
      if (!input.ok) return {ok:false, error:input.error};
      active = start(input.value);
      return {ok:true, value:active};
    } catch (error) {
      return {ok:false, error:error instanceof Error ? error.message : String(error)};
    }
  });
  const done: Promise<Result<Output>> = ready.then(result => result.ok ? result.value.done : {ok:false, error:result.error, ...(result.cancelled ? {cancelled:true} : {})});
  return {
    done,
    frames: {
      async *[Symbol.asyncIterator]() {
        const result = await ready;
        if (result.ok) yield* result.value.frames;
        else yield {t:'result', ok:false, error:result.error};
      },
    },
    answer(id, value) { active?.answer(id, value); },
    async cancel() {
      controller.abort();
      await active?.cancel();
      await done;
    },
  };
}
