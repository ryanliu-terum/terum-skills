/**
 * D5: one renderer per verb, keyed by the `verb` of a ResultOutcome; every other public verb is
 * listed in FALLBACK_VERBS on purpose (a fenced block of its printed lines). D6: a printed line no
 * renderer covers becomes a note, so nothing a verb said is lost. A renderer that throws is a defect,
 * but the person still gets the fallback block and a note naming it (§12). A hard failure without a
 * value draws the fallback block too — a renderer is never asked to draw from nothing (§12, D8).
 */
import { FRAME_VERBS } from '../frames.js';
import type { ResultOutcome } from '../frames.js';
import { board, textBlock, type Board, type RenderContext } from './board.js';
import type { Renderer } from './renderer.js';
import { VERB_RENDERERS } from './verbs/index.js';

export type { Renderer } from './renderer.js';

export const RENDERED_VERBS: readonly string[] = ['ls', 'status', 'search', 'eval-report', 'eval', 'update', 'sync', 'validate', 'install', 'uninstall-skill', 'project list', 'project add', 'project remove'];
export const FALLBACK_VERBS: readonly string[] = FRAME_VERBS.filter((verb) => !RENDERED_VERBS.includes(verb));

export const REGISTRY: Record<string, Renderer> = { ...VERB_RENDERERS };

export function fallbackBoard(verb: string, lines: readonly string[]): Board {
  return board(verb, { sections: lines.length === 0 ? [] : [textBlock([...lines], { fenced: 'text' })] });
}

export function renderBoard(outcome: ResultOutcome, printed: readonly string[], resolved: readonly string[], ctx: RenderContext): Board {
  const lines = printed.filter((line) => line.trim() !== '');
  const renderer = REGISTRY[outcome.verb];
  let drawn: Board;
  if (renderer === undefined || (!outcome.ok && outcome.value === undefined)) drawn = fallbackBoard(outcome.verb, lines);
  else {
    try {
      drawn = renderer.render(outcome.value, ctx);
      const notes = renderer.uncovered ? renderer.uncovered(lines, outcome.value) : lines.filter((line) => !renderer.covered.some((pattern) => pattern.test(line)));
      drawn.notes.push(...notes);
    } catch (error) {
      drawn = fallbackBoard(outcome.verb, lines);
      drawn.notes.push(`The ${outcome.verb} board could not be drawn (${error instanceof Error ? error.message : String(error)}); its printed lines are shown instead.`);
    }
  }
  drawn.resolved = [...resolved];
  if (!outcome.ok) {
    drawn.failure = {
      error: outcome.error ?? 'failed',
      ...(outcome.refused === true ? { refused: true as const } : {}),
      ...(outcome.cancelled === true ? { declined: true as const } : {}),
      ...(outcome.value === undefined ? {} : { partial: true as const }),
    };
  }
  return drawn;
}
