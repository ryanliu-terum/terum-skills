import { expect, it } from 'vitest';
import { CATEGORY_SUGGEST, GLOBAL_LIST, TARGET_ASK, effectiveTarget, publishFlags, sharedState, targetOptions } from './publish-defaults';

it('lists the CLI question, Global, then the team projects once', () => {
  expect(targetOptions(['Terum', 'Global', 'SSM'])).toEqual([TARGET_ASK, GLOBAL_LIST, 'Terum', 'SSM']);
  expect(targetOptions(null)).toEqual([TARGET_ASK, GLOBAL_LIST]);
});
it('falls back to the CLI question when the stored target is not a project any more', () => {
  expect(effectiveTarget('Payments', ['Terum'])).toBe(TARGET_ASK);
  expect(effectiveTarget('Terum', ['Terum'])).toBe('Terum');
  expect(effectiveTarget(GLOBAL_LIST, null)).toBe(GLOBAL_LIST);
});
it('sends --project only for a fixed target and --category only when typed', () => {
  expect(publishFlags(TARGET_ASK, null)).toEqual({});
  expect(publishFlags(GLOBAL_LIST, '  ')).toEqual({ project: GLOBAL_LIST });
  expect(publishFlags('Terum', ' ops ')).toEqual({ project: 'Terum', category: 'ops' });
  expect(CATEGORY_SUGGEST).toBe('Model suggests');
});
it('names a Global folder\'s state from the Library fields', () => {
  expect(sharedState({ knownToTeam: false, localMatch: null, edited: false })).toBe('Not shared');
  expect(sharedState({ knownToTeam: true, localMatch: 'identical', edited: false })).toBe('In sync');
  expect(sharedState({ knownToTeam: true, localMatch: 'differs', edited: false })).toBe('Edited since publish');
  expect(sharedState({ knownToTeam: true, localMatch: 'identical', edited: true })).toBe('In sync');
  expect(sharedState({ knownToTeam: true, localMatch: null, edited: true })).toBe('Edited since publish');
  expect(sharedState({ knownToTeam: true, localMatch: 'none', edited: false })).toBe('Not published yet');
  expect(sharedState({ knownToTeam: true, localMatch: null, edited: false })).toBe('—');
});
