import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

const properties = ['font-size', 'font-weight', 'line-height', 'color', 'margin-top'] as const;

async function styles(locator: Locator) {
  await expect(locator).toHaveCount(1);
  return locator.evaluate((element, names) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(names.map(name => [name, style.getPropertyValue(name)]));
  }, properties);
}

async function open(page: Page, raw: boolean) {
  await prepare(page, {
    name: 'Markdown parity', klass: 'screen', width: 1440, height: 900,
    route: '#/skill/deploy-check' + (raw ? '?__mock=raw-md' : ''),
  });
  await expect(page.getByTestId('frontmatter')).toHaveCount(1);
}

test('raw Markdown matches the mock blocks at 1440×900', async ({ page, context }) => {
  const mock = await context.newPage();
  const errors: string[] = [];
  for (const pane of [page, mock]) {
    pane.on('pageerror', error => errors.push(error.message));
    pane.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    pane.on('requestfailed', request => errors.push(request.failure()?.errorText ?? request.url()));
    pane.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
  }
  await open(page, true);
  await open(mock, false);
  const frontmatter = await mock.getByTestId('frontmatter').textContent();
  expect(frontmatter).toMatch(/^---\n[\s\S]+\n---$/);
  expect(await page.getByTestId('frontmatter').textContent()).toBe(frontmatter);
  expect(await page.locator('.md-doc').textContent()).not.toContain(frontmatter);

  const constructs = [
    ['frontmatter', '[data-testid="frontmatter"]', '[data-testid="frontmatter"]'],
    ['paragraph', '.md-doc > p.md-p', '.skill-md-blocks > .md-p'],
    ['ordered row', '.md-doc > ol.md-list > li', '.skill-md-blocks > .md-list > div'],
    // The mock has only ordered rows; unordered rows share their type and spacing, not their marker.
    ['unordered row', '.md-doc ul.md-list > li:not(.task-list-item)', '.skill-md-blocks > .md-list > div'],
    ['code block', '.md-doc > pre.md-code', '.skill-md-blocks > .md-code:not(.md-frontmatter)'],
  ] as const;
  for (const [name, rawSelector, mockSelector] of constructs) {
    expect(await styles(page.locator(rawSelector).first()), name)
      .toEqual(await styles(mock.locator(mockSelector).first()));
  }
  const mockGap = await mock.locator('.skill-md-blocks').evaluate(element => getComputedStyle(element).gap);
  expect(await page.locator('.skill-md-blocks').evaluate(element => getComputedStyle(element).gap)).toBe(mockGap);
  expect(await page.locator('.md-doc').evaluate(element => getComputedStyle(element).gap)).toBe(mockGap);

  // W-05 explicitly keeps the first document heading's margin at zero. As in markdown.spec.ts,
  // move that h2 to exercise section headings after both a paragraph and a list without adding
  // headings to the shared RAW_MD fixture (whose heading ramp is covered by the existing tests).
  for (const [selector, mockIndex] of [['p.md-p', 1], ['ol.md-list', 2]] as const) {
    const heading = page.locator('.md-doc > h2.md-h2');
    await heading.evaluate((element, previousSelector) => {
      const previous = element.parentElement?.querySelector(previousSelector);
      if (!previous) throw new Error('Missing Markdown section predecessor: ' + previousSelector);
      previous.after(element);
    }, selector);
    const mockHeading = mock.locator('.skill-md-blocks > .md-h2').nth(mockIndex);
    expect(await styles(heading), 'h2 after ' + selector).toEqual(await styles(mockHeading));
    const air = (locator: Locator) => locator.evaluate(element => {
      if (!element.previousElementSibling) throw new Error('Section heading has no predecessor');
      return element.getBoundingClientRect().top - element.previousElementSibling.getBoundingClientRect().bottom;
    });
    expect(await air(heading), 'section air after ' + selector).toBe(await air(mockHeading));
    await expect(heading).toHaveCSS('margin-top', '6px');
    expect(await air(heading)).toBe(16);
  }
  expect(errors).toEqual([]);
  await mock.close();
});
