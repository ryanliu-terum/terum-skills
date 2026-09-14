import { expect, it } from 'vitest';
import { cliSetup } from '../index';
import { SETUP_STEP_KEYS } from '../../types';

// The CLI reports one outcome per wizard step. 0.17.0 added `editHook` to that map; this app's key list
// was not updated, and because the map was parsed against a closed key set every finished setup run in
// the app died with `unrecognized_keys: ["editHook"]` — reported as "terum-skills answered, but the
// desktop app could not read the result", with the CLI's work already durable on disk.
it('reads the edit-hook step a 0.17.0+ CLI reports', () => {
  const parsed = cliSetup.parse({ role: 'joiner', team: 'shared-skills', steps: { github: 'done', team: 'done', hook: 'done', wrapper: 'done', editHook: 'done', done: 'printed' } });
  expect(parsed.steps).toMatchObject({ editHook: 'done', done: 'printed' });
  expect(SETUP_STEP_KEYS).toContain('editHook');
});

// docs/frame-protocol.md: "Protocol stays 1 because every change is additive." The app runs whatever CLI
// the machine recorded, so a CLI newer than the app WILL name steps this app has never heard of. An
// unknown step is a row the board cannot draw — never a reason to discard a finished run.
it('drops a step key this app has never heard of instead of failing the whole result', () => {
  const parsed = cliSetup.parse({ role: 'creator', team: 'acme', steps: { team: 'done', somethingAddedLater: 'done' } });
  expect(parsed.steps).toEqual({ team: 'done' });
});

it('drops an outcome this app has never heard of and keeps the rest', () => {
  const parsed = cliSetup.parse({ role: 'creator', team: 'acme', steps: { team: 'done', evals: 'deferred-somehow' } });
  expect(parsed.steps).toEqual({ team: 'done' });
});

it('reports absent steps as null rather than an empty map', () => {
  expect(cliSetup.parse({ role: 'creator', team: 'acme' }).steps).toBeNull();
  expect(cliSetup.parse({ role: 'creator', team: 'acme', steps: null }).steps).toBeNull();
});
