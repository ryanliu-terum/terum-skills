import { describe, expect, it } from 'vitest';
import { FRAME_VERBS } from '../../frames.js';
import { board, type RenderContext } from '../board.js';
import { FALLBACK_VERBS, REGISTRY, RENDERED_VERBS, renderBoard } from '../registry.js';

export const CTX: RenderContext = { format: 'md', host: 'claude', rows: 25, width: 100, color: false, form: undefined, home: '/home/u', now: Date.parse('2026-09-13T12:00:00Z'), argv: ['publish', 'x'], command: 'npx -y terum-skills@latest publish x --format md', rowsAllCommand: 'npx -y terum-skills@latest publish x --format md --rows all' };

describe('registry (D5)', () => {
  it('rendered verbs and fallback verbs partition FRAME_VERBS exactly', () => {
    expect([...RENDERED_VERBS, ...FALLBACK_VERBS].sort()).toEqual([...FRAME_VERBS].sort());
    expect(RENDERED_VERBS.filter((verb) => FALLBACK_VERBS.includes(verb))).toEqual([]);
  });
  it('every rendered verb has a renderer, and only those', () => {
    expect(Object.keys(REGISTRY).sort()).toEqual([...RENDERED_VERBS].sort());
  });
  it('no renderer throws on a missing, null or wrongly-shaped value (§12)', () => {
    const shapes: unknown[] = [undefined, null, {}, [], 'text', 42, { local: null, skills: null, selection: { kind: 'skill' } }, { selection: { kind: 'member' }, member: null }, { items: null }, { report: { aggregate: null } }, { teams: [{}], ledger: null }, { projects: [null] }, [{}], [null]];
    for (const [verb, renderer] of Object.entries(REGISTRY)) for (const shape of shapes) {
      const b = renderer.render(shape, CTX);
      expect(typeof b.title, `${verb} on ${JSON.stringify(shape)}`).toBe('string');
      expect(Array.isArray(b.sections) && Array.isArray(b.next) && Array.isArray(b.notes)).toBe(true);
      if (renderer.uncovered) expect(renderer.uncovered(['a line'], shape)).toEqual(expect.any(Array));
    }
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
  it('draws the fallback block, never the renderer, for a hard failure without a value (§12, D8)', () => {
    let calls = 0;
    REGISTRY['__failing__'] = { render: () => { calls += 1; return board('__failing__', {}); }, covered: [/^No skill named /] };
    try {
      const b = renderBoard({ verb: '__failing__', ok: false, error: 'No skill named ghost.', exitCode: 1 }, ['No skill named ghost.'], [], CTX);
      expect(calls).toBe(0);
      expect(b.sections).toEqual([{ kind: 'text', lines: ['No skill named ghost.'], fenced: 'text' }]);
      expect(b.notes).toEqual([]);
      expect(b.failure).toEqual({ error: 'No skill named ghost.' });
    } finally { delete REGISTRY['__failing__']; }
  });
});
