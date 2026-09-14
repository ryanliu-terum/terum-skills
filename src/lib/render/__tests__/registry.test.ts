import { describe, expect, it } from 'vitest';
import { FRAME_VERBS } from '../../frames.js';
import { type RenderContext } from '../board.js';
import { FALLBACK_VERBS, REGISTRY, RENDERED_VERBS, renderBoard } from '../registry.js';

export const CTX: RenderContext = { format: 'md', host: 'claude', rows: 25, width: 100, color: false, form: undefined, home: '/home/u', now: Date.parse('2026-09-13T12:00:00Z'), argv: ['publish', 'x'], command: 'npx -y terum-skills@latest publish x --format md' };

describe('registry (D5)', () => {
  it('rendered verbs and fallback verbs partition FRAME_VERBS exactly', () => {
    expect([...RENDERED_VERBS, ...FALLBACK_VERBS].sort()).toEqual([...FRAME_VERBS].sort());
    expect(RENDERED_VERBS.filter((verb) => FALLBACK_VERBS.includes(verb))).toEqual([]);
  });
  it('every registry key is a rendered verb (the registry fills in as renderers land)', () => {
    for (const key of Object.keys(REGISTRY)) expect(RENDERED_VERBS).toContain(key);
  });
  it('renders an unregistered verb as a fenced block of its lines, with resolved lines and the failure attached', () => {
    const b = renderBoard({ verb: 'publish', ok: false, error: 'declined', cancelled: true, exitCode: 1 }, ['a', 'b'], ['Resolved: x from the working directory'], CTX);
    expect(b).toEqual({ title: 'publish', resolved: ['Resolved: x from the working directory'], sections: [{ kind: 'text', lines: ['a', 'b'], fenced: 'text' }], notes: [], next: [], failure: { error: 'declined', declined: true } });
    expect(renderBoard({ verb: 'publish', ok: true, value: {}, exitCode: 0 }, [], [], CTX)).toEqual({ title: 'publish', resolved: [], sections: [], notes: [], next: [] });
    expect(renderBoard({ verb: 'eval', ok: false, error: 'x', refused: true, value: { items: [] }, exitCode: 1 }, [], [], CTX).failure).toEqual({ error: 'x', refused: true, partial: true });
  });
  it('answers with the fallback block and a note when a renderer throws', () => {
    REGISTRY['__throwing__'] = { render: () => { throw new Error('renderer bug'); }, covered: [] };
    try {
      const b = renderBoard({ verb: '__throwing__', ok: true, value: {}, exitCode: 0 }, ['line'], [], CTX);
      expect(b.sections).toEqual([{ kind: 'text', lines: ['line'], fenced: 'text' }]);
      expect(b.notes).toEqual(['The __throwing__ board could not be drawn (renderer bug); its printed lines are shown instead.']);
    } finally { delete REGISTRY['__throwing__']; }
  });
});
