import { expect, it } from 'vitest';
import { fetchNote } from './reconcile';

const fetched = (teams: { team: string; state: string; detail?: string }[]) => ({ ok: true as const, value: { notices: [], changed: false, teams: teams as never } });

it('says nothing when every team was fetched or was fresh', () => {
  expect(fetchNote(fetched([{ team: 'a', state: 'refreshed' }, { team: 'b', state: 'fresh' }]))).toBeNull();
  expect(fetchNote(fetched([]))).toBeNull();
});

it('names each team the fetch did not bring forward, with the CLI detail when there is one', () => {
  expect(fetchNote(fetched([{ team: 'a', state: 'refreshed' }, { team: 'b', state: 'busy' }, { team: 'c', state: 'no-clone', detail: 'clone removed' }])))
    .toBe('b: another process holds this clone; try again in a moment; c: no usable clone on this machine · clone removed. This compares your skills against the team copy already on this machine.');
});

it('carries the run error when the fetch itself failed', () => {
  expect(fetchNote({ ok: false, error: 'offline' })).toBe('The team could not be fetched (offline). This compares your skills against the team copy already on this machine.');
});
