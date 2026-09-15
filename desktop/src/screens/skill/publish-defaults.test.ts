import { expect, it } from 'vitest';
import { CATEGORY_SUGGEST, MARKETPLACE_ONLY, effectiveTarget, publishFlags, sharedState, targetOptions } from './publish-defaults';

it('lists the marketplace first, then the team projects', () => {
  expect(targetOptions(['Terum', 'SSM'])).toEqual([MARKETPLACE_ONLY, 'Terum', 'SSM']);
  expect(targetOptions(null)).toEqual([MARKETPLACE_ONLY]);
});
it('falls back to the marketplace when the stored target is not a project any more', () => {
  expect(effectiveTarget('Payments', ['Terum'])).toBe(MARKETPLACE_ONLY);
  expect(effectiveTarget('Terum', ['Terum'])).toBe('Terum');
  expect(effectiveTarget(MARKETPLACE_ONLY, null)).toBe(MARKETPLACE_ONLY);
  // A team that still carries the retired Global card can target it like any other project.
  expect(effectiveTarget('Global', ['Global'])).toBe('Global');
});
it('sends --project only for a named project and --category only when typed', () => {
  expect(publishFlags(MARKETPLACE_ONLY, null)).toEqual({});
  expect(publishFlags(MARKETPLACE_ONLY, '  ')).toEqual({});
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
