import { expect, it } from 'vitest';
import type { Root } from '../../backend/types';
import { destinationsFor } from './install-destinations';
const root = (label: string, registered = true, slug = 'acme/repo'): Root => ({ id: label, kind: 'checkout', label, root: `/Projects/${label}`, registered, remote: { slug, url: slug } });
it('always offers Global, includes only registered projects, and uses the renamed feature', () => {
  expect(destinationsFor([root('one'), root('ignored', false)], [], { libraryProjects: true })).toEqual({ rows: [['Global', 'every session · ~/.claude/skills'], ['one', 'project · /Projects/one']], preselected: 'Global', addRow: true });
  expect(destinationsFor([], [], { libraryProjects: false })).toEqual({ rows: [['Global', 'every session · ~/.claude/skills']], preselected: 'Global', addRow: false });
});
it('preselects a unique remote match and requires a choice for several matches', () => {
  expect(destinationsFor([root('one')], ['acme/repo'], { libraryProjects: true }).preselected).toBe('one');
  expect(destinationsFor([root('one'), root('two')], ['acme/repo'], { libraryProjects: true }).preselected).toBeNull();
});
it('keeps unreadable registered projects visible for the CLI to explain', () => {
  expect(destinationsFor([{ ...root('one'), rootState: 'unreadable' }], [], { libraryProjects: true }).rows).toHaveLength(2);
});
