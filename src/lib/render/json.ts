/** D4: the result frame minus `t`, plus every printed line — one document, one read. */
import type { ResultOutcome } from '../frames.js';

export function renderJson(outcome: ResultOutcome, lines: readonly string[]): string {
  const document = {
    verb: outcome.verb, ok: outcome.ok, exitCode: outcome.exitCode,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    ...(outcome.cancelled === true ? { declined: true } : {}),
    ...(outcome.refused === true ? { refused: true } : {}),
    ...(outcome.value === undefined ? {} : { value: outcome.value }),
    lines: [...lines],
  };
  return JSON.stringify(document, null, 2);
}
