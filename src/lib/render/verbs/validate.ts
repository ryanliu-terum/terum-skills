import { board, count, kv, path, textBlock, type Board, type RenderContext } from '../board.js';
import type { Renderer } from '../renderer.js';
import { asArray, asRecord, num, str } from './shared.js';

/** `formatHygieneFindings` (`src/lib/evals/hygiene.ts:124`): `${code} ${path}[:line]: ${message}`. A warning line is prefixed `warning ` by `formatHygieneWarnings` and never matches this. */
const HYGIENE_ERROR = /^HYG\d+ \S+(:\d+)?: /;

export const render = (raw: unknown, _ctx: RenderContext): Board => {
  void _ctx;
  const value = asRecord(raw); const name = str(value['name']);
  const findings = num(value['findings']), warnings = num(value['warnings']), repairable = num(value['repairable']);
  const known = findings !== null && warnings !== null && repairable !== null;
  const b = board(`Validate — ${name ?? '—'}`, known ? { headline: findings === 0 && warnings === 0 ? 'No findings.' : `${findings} finding${findings === 1 ? '' : 's'} · ${warnings} warning${warnings === 1 ? '' : 's'} · ${repairable} repairable` } : {});
  b.sections.push(kv([['folder', path(value['directory'])], ['findings', count(findings)], ['warnings', count(warnings)], ['repairable', count(repairable)]]));
  const repairs = asArray(value['repairs']).map(str).filter((s): s is string => s !== null);
  if (repairs.length) b.sections.push(textBlock(repairs, { title: 'Will change' }));
  const directory = str(value['directory']);
  if (repairable !== null && repairable > 0 && directory !== null) b.next.push({ label: 'Fix', verb: 'skill fix', args: [directory] });
  if (findings === 0 && name !== null) b.next.push({ label: 'Publish', verb: 'publish', args: [name] });
  return b;
};
/** Only the pass line is the board's; every finding and warning line is a note, verbatim (§7). */
export const covered: RegExp[] = [/^\S+: hygiene passed( \(\d+ warnings?\))?\.$/];
/** Error findings are quoted by the failure block (`validate.ts:129` embeds them in the error), so they are not repeated as notes; warnings are notes. */
export const uncovered = (lines: readonly string[], raw: unknown): string[] => {
  const findings = num(asRecord(raw)['findings']);
  const quoted = findings !== null && findings > 0;
  return lines.filter((line) => !(quoted && HYGIENE_ERROR.test(line)) && !covered.some((pattern) => pattern.test(line)));
};
export const renderer: Renderer = { render, covered, uncovered };
