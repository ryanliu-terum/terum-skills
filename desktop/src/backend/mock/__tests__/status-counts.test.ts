import { afterEach, describe, expect, it } from 'vitest';
import { createMockBackend } from '../index';
import { design } from '../fixture';
import { statusCounts } from '../status-counts';
import type { MockScenario } from '../scenario';

const withoutInbox = Object.fromEntries(Object.entries(design.COUNTS).filter(([key]) => !['Pushes', 'Updates', 'Alerts'].includes(key)));
const routes = [
  { route: '#/library/global', emptyCounts: { ...design.COUNTS, Global: '0' } },
  { route: '#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fterum', emptyCounts: { ...design.COUNTS, Global: '0' } },
  { route: '#/inbox', emptyCounts: withoutInbox },
  { route: '#/inbox/unknown', emptyCounts: withoutInbox },
  { route: '#/share', emptyCounts: design.COUNTS },
  { route: '#/marketplace', emptyCounts: design.COUNTS },
  { route: '#/settings/account', emptyCounts: design.COUNTS },
];
const scenarios: MockScenario[] = ['default', 'empty', 'error', 'loading', 'slow', 'disabled', 'not-installed'];
afterEach(() => { location.hash = ''; });

describe.each(routes)('$route', ({ route, emptyCounts }) => {
  it.each(scenarios)('derives counts for %s without changing the fixture', scenario => {
    const before = structuredClone(design.COUNTS);
    const counts = statusCounts(route + (route.includes('?')?'&':'?')+'tab=pushes&__mock=' + scenario, scenario);
    expect(counts).toEqual(scenario === 'empty' ? emptyCounts : design.COUNTS);
    expect(design.COUNTS).toEqual(before);
    expect(counts).not.toBe(design.COUNTS);
  });

  it('serves empty counts through status using the current hash', async () => {
    location.hash = route + (route.includes('?')?'&':'?')+'__mock=empty';
    const status = await createMockBackend().status();
    expect(status.ok).toBe(true);
    expect(status.value?.counts).toEqual(emptyCounts);
  });
});
