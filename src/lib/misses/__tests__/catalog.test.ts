import { describe, expect, it } from 'vitest';
import { catalogAsOf, renderCatalog, undatedSkills, type CatalogEntry } from '../catalog.js';

const entry = (name: string, placedAt: string | null): CatalogEntry => ({ name, description: `does ${name}`, placedAt });

describe('catalog — reconstructed as of the prompt, never read from today', () => {
  it('excludes a skill placed AFTER the prompt — the cry-wolf failure', () => {
    // Showing the judge today's catalog against an old prompt flags every skill installed since.
    const out = catalogAsOf([entry('new', '2026-09-10T00:00:00.000Z')], '2026-09-01T00:00:00.000Z');
    expect(out).toEqual([]);
  });

  it('includes a skill placed before the prompt', () => {
    const out = catalogAsOf([entry('old', '2026-08-01T00:00:00.000Z')], '2026-09-01T00:00:00.000Z');
    expect(out.map((e) => e.name)).toEqual(['old']);
  });

  it('includes a skill placed at exactly the prompt timestamp', () => {
    const ts = '2026-09-01T00:00:00.000Z';
    expect(catalogAsOf([entry('same', ts)], ts).map((e) => e.name)).toEqual(['same']);
  });

  it('EXCLUDES an undated skill rather than assuming it was available', () => {
    // The one place "unknown" must not be read as "yes": a false miss is worse than a missed miss.
    expect(catalogAsOf([entry('undated', null)], '2026-09-01T00:00:00.000Z')).toEqual([]);
  });

  it('names the undated skills so the report can disclose what it could not consider', () => {
    expect(undatedSkills([entry('b', null), entry('a', null), entry('c', '2026-01-01T00:00:00.000Z')])).toEqual(['a', 'b']);
  });

  it('renders the `- name: description` shape layer 1 selection prompt expects', () => {
    expect(renderCatalog([entry('alpha', '2026-01-01T00:00:00.000Z')])).toBe('- alpha: does alpha');
  });

  it('sorts by name so one corpus renders one catalog', () => {
    const out = catalogAsOf([entry('z', '2026-01-01T00:00:00.000Z'), entry('a', '2026-01-01T00:00:00.000Z')], '2026-09-01T00:00:00.000Z');
    expect(out.map((e) => e.name)).toEqual(['a', 'z']);
  });
});
