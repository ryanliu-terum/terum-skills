import type { EvalRunState } from '../../app/eval-run-context';

/**
 * Whether a finished run may be retried. Extracted and exported purely so it can be TESTED: the
 * branch that matters — a finished run whose local folder disappeared mid-stream, which the dialog's
 * own comment anticipates — cannot be reached through the render harness, because the skill query is
 * cached and there is no seam to change `path` after a run has started. A retry for an absent folder
 * is the same guaranteed CLI failure the pre-run gate exists to prevent.
 */
export function canRetry(active:Pick<EvalRunState,'state'|'result'>|null,missing:boolean):boolean{
 if(active===null||missing||active.state==='running')return false;
 return active.state==='stopped'||(active.result?.ok===false&&active.result.value===undefined);
}
