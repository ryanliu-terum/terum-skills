import { expect, it } from 'vitest';
import type { Root } from '../../backend/types';

const checkout: Root = { id: '/work/docs', kind: 'checkout', label: 'Docs', root: '~/work/docs', registered: true, detected: false, remote: { url: 'https://github.com/team/docs', slug: 'team/docs' } };
it.each([
  ['one match', [checkout], ['team/docs'], true, 'Docs', [['Global', 'every session · ~/.claude/skills'], ['Docs', 'project · ~/work/docs']]],
  ['no match', [checkout], ['team/other'], true, 'Global', [['Global', 'every session · ~/.claude/skills'], ['Docs', 'project · ~/work/docs']]],
  ['two matches', [checkout, { ...checkout, id: '/work/other', label: 'Other' }], ['team/docs'], true, null, [['Global', 'every session · ~/.claude/skills'], ['Docs', 'project · ~/work/docs'], ['Other', 'project · ~/work/docs']]],
  ['checkouts disabled', [checkout], [], false, 'Global', [['Global', 'every session · ~/.claude/skills'], ['Docs', 'project · ~/work/docs']]],
  ['unregistered excluded', [{ ...checkout, registered: false }], ['team/docs'], true, 'Global', [['Global', 'every session · ~/.claude/skills']]],
  ['no project remotes', [checkout], [], true, 'Global', [['Global', 'every session · ~/.claude/skills'], ['Docs', 'project · ~/work/docs']]],
  ['absent root retained', [{ ...checkout, rootState: 'absent' }], ['team/docs'], true, 'Docs', [['Global', 'every session · ~/.claude/skills'], ['Docs', 'project · ~/work/docs']]],
  ['unreadable root retained', [{ ...checkout, rootState: 'unreadable' }], ['team/docs'], true, 'Docs', [['Global', 'every session · ~/.claude/skills'], ['Docs', 'project · ~/work/docs']]],
] as const)('%s', async (_name, roots, remotes, checkouts, preselected, rows) => {
  // Load per case so the pre-fix run records each missing contract, not a collection error.
  const modulePath = './install-destinations';
  const { destinationsFor }: typeof import('./install-destinations') = await import(modulePath);
  expect(destinationsFor([...roots], [...remotes], { checkouts })).toEqual({ rows, preselected, addRow: checkouts });
});
