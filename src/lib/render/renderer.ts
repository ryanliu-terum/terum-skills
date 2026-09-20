import type { Board, RenderContext } from './board.js';

export interface Renderer {
  render(value: unknown, ctx: RenderContext): Board;
  covered: RegExp[];
  uncovered?(lines: readonly string[], value: unknown): string[];
}
