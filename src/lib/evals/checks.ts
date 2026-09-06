/**
 * Eval spec §5.1 / §7.1: the five deterministic check kinds, ported verbatim from skilldeck
 * `evals/checks.py` (commit 42084dc). Checks run first, always — they are the only signal that
 * doesn't drift with judge models; the LLM judge only sees cases the checks can't decide.
 * Unknown check kinds FAIL (they never error the run). Pure apart from sandbox stat calls (ME1).
 */
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** The slice of a transcript the checks read. `agent.ts`'s Transcript satisfies it structurally. */
export interface TranscriptText {
  allText(): string;
  bashCommands(): string[];
}

/** §7.1: a failed arm is scored against an empty transcript, never skipped. */
export const emptyTranscript: TranscriptText = { allText: () => '', bashCommands: () => [] };

/** A case's `checks` entries: `"kind"` or `{ kind: arg }` single-key dicts (§5.1). */
export type CheckSpec = string | Record<string, unknown>;

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export function runChecks(specs: readonly CheckSpec[], transcript: TranscriptText, sandbox: string): CheckResult[] {
  return specs.map((spec) => {
    let kind: string;
    let arg: unknown;
    if (typeof spec === 'string') {
      kind = spec;
      arg = undefined;
    } else if (spec !== null && typeof spec === 'object' && Object.keys(spec).length === 1) {
      [kind] = Object.keys(spec) as [string];
      arg = spec[kind];
    } else {
      return { name: JSON.stringify(spec), passed: false, detail: 'unrecognized check spec' };
    }
    const check = CHECKS[kind];
    if (!check) return { name: kind, passed: false, detail: `unknown check kind '${kind}'` };
    return check(arg, transcript, sandbox);
  });
}

/** Arm score input (§16.4): fraction of checks passed, or null when the case has no checks. */
export function fractionPassed(results: readonly CheckResult[]): number | null {
  if (results.length === 0) return null;
  return results.filter((result) => result.passed).length / results.length;
}

type Check = (arg: unknown, transcript: TranscriptText, sandbox: string) => CheckResult;

/** File checks must stay inside the sandbox — an escaping path fails the check, never the run. */
function insideSandbox(sandbox: string, relative: string): string | null {
  const target = resolve(sandbox, relative);
  return target === resolve(sandbox) || target.startsWith(resolve(sandbox) + sep) ? target : null;
}

const CHECKS: Record<string, Check> = {
  transcript_mentions: (arg, transcript) => {
    const ok = transcript.allText().toLowerCase().includes(String(arg).toLowerCase());
    return { name: `transcript_mentions:${String(arg)}`, passed: ok, detail: ok ? '' : `'${String(arg)}' never appeared in the transcript` };
  },
  no_command_matching: (arg, transcript) => {
    const pattern = new RegExp(String(arg));
    const hits = transcript.bashCommands().filter((command) => pattern.test(command));
    return { name: `no_command_matching:${String(arg)}`, passed: hits.length === 0, detail: hits.length === 0 ? '' : `matched: ${JSON.stringify(hits.slice(0, 3))}` };
  },
  command_matching: (arg, transcript) => {
    const pattern = new RegExp(String(arg));
    const ok = transcript.bashCommands().some((command) => pattern.test(command));
    return { name: `command_matching:${String(arg)}`, passed: ok, detail: ok ? '' : 'no Bash command matched' };
  },
  file_exists: (arg, _transcript, sandbox) => {
    const target = insideSandbox(sandbox, String(arg));
    const ok = target !== null && existsSync(target);
    return { name: `file_exists:${String(arg)}`, passed: ok, detail: ok ? '' : target === null ? 'path escapes the sandbox' : 'file not found in sandbox' };
  },
  file_absent: (arg, _transcript, sandbox) => {
    const target = insideSandbox(sandbox, String(arg));
    const ok = target !== null && !existsSync(target);
    return { name: `file_absent:${String(arg)}`, passed: ok, detail: ok ? '' : target === null ? 'path escapes the sandbox' : 'file exists in sandbox' };
  },
};
