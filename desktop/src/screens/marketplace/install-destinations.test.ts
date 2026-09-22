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
it('matches a root whose origin is any of the project\'s remotes, not only the first', () => {
  // Spec §3: the CLI matches a destination on ANY project remote; a project with two remotes must match a checkout whose origin is the second.
  expect(destinationsFor([root('one', true, 'acme/mirror')], ['acme/repo', 'acme/mirror'], { libraryProjects: true }).preselected).toBe('one');
});


// Sub-projects (2026-09-19): a folder inside a checkout reports the checkout's origin, so nested matches default to
// the outermost one; only unrelated matches leave the choice open.
it('defaults to the outermost of nested origin matches, in either order', () => {
  const parent = root('one'), child = { ...root('one/apps/web'), parent: parent.id };
  expect(destinationsFor([parent, child], ['acme/repo'], { libraryProjects: true }).preselected).toBe('one');
  expect(destinationsFor([child, parent], ['acme/repo'], { libraryProjects: true }).preselected).toBe('one');
  expect(destinationsFor([parent, child], ['acme/repo'], { libraryProjects: true }).rows.map(([label]) => label)).toEqual(['Global', 'one', 'one/apps/web']);
  expect(destinationsFor([parent, child, root('two')], ['acme/repo'], { libraryProjects: true }).preselected).toBeNull();
});
