import { expect, it } from 'vitest';
import { parseCliFrame } from '../frames';

it.each(['confirm', 'text', 'select', 'path'] as const)('parses an ask of kind %s (every kind the CLI emits)', kind => {
  expect(parseCliFrame(JSON.stringify({ t: 'ask', id: 'q1', kind, question: 'Which folder?', default: '/home/me/repo' }))).toEqual({ t: 'ask', id: 'q1', kind, question: 'Which folder?', default: '/home/me/repo' });
});
it('rejects an ask kind the CLI never emits', () => {
  expect(parseCliFrame(JSON.stringify({ t: 'ask', id: 'q1', kind: 'multi', question: 'Which?' }))).toBeNull();
});

// Protocol 2 (2026-09-19): a `form` ask carries its fields; a form with an unreadable field is malformed as a whole.
it('parses a form ask with text and checkbox fields, submit, skippable, skipLabel and errors', () => {
  const fields = [
    { id: 'team', kind: 'text', label: 'Team name', required: true, note: 'Names the team.' },
    { id: 'repo', kind: 'text', label: 'Repository', default: 'x', follows: { field: 'team', template: '{value}-shared-skills' } },
    { id: 'login', kind: 'text', label: 'GitHub login', default: 'alice', readOnly: true },
    { id: 'hook', kind: 'checkbox', label: 'Hook', default: true, disabled: true, note: 'Already installed.' },
  ];
  expect(parseCliFrame(JSON.stringify({ t: 'ask', id: 'q1', kind: 'form', question: 'Create your team', fields, submit: 'Create team', skippable: true, skipLabel: 'Skip for now', errors: { team: 'taken', bogus: 3 }, detail: ['One repository.'] })))
    .toEqual({ t: 'ask', id: 'q1', kind: 'form', question: 'Create your team', fields, submit: 'Create team', skippable: true, skipLabel: 'Skip for now', errors: { team: 'taken' }, detail: ['One repository.'] });
  expect(parseCliFrame(JSON.stringify({ t: 'ask', id: 'q1', kind: 'form', question: 'Create your team' }))).toBeNull();
  expect(parseCliFrame(JSON.stringify({ t: 'ask', id: 'q1', kind: 'form', question: 'Create your team', fields: [{ id: 'hook', kind: 'checkbox', label: 'Hook' }] }))).toBeNull();
  expect(parseCliFrame(JSON.stringify({ t: 'ask', id: 'q1', kind: 'form', question: 'Create your team', fields: [{ id: 'x', kind: 'multi', label: 'X' }] }))).toBeNull();
});
