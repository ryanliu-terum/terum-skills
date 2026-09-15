import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

// UI policy §5 (2026-09-14 review): the top-bar eval chip is a fixed *state* and an ellipsizing *subject*. The slot
// (.topbar-right) is a fixed 240px shared with the Stop button and the inbox bell, and only a real engine measures
// text: before this spec, "Evaluating · 1 of 2" lost its count to the ellipsis beside a text Stop button. The run is
// the Library's own handoff (Select → Evaluate 2 skills…) in batches of one, so the mock CLI asks "Continue?" after
// the first skill and the run sits in 'running' at "Evaluating · 1 of 2" for as long as the test needs: the
// measurements are of a live chip beside a live Stop, with no timing window. That question is modal, so the top bar
// is read through the DOM rather than clicked, and Stop is fired as the event its click produces.
const LONGEST_STATE = 'Evaluating · 100 of 128', LONG_SUBJECT = 'a-very-long-skill-folder-name-indeed';

type Fit = { stateWhole: boolean; subjectWhole: boolean | null; chipInSlot: boolean; stopInSlot: boolean; bellInSlot: boolean; chipClearOfStop: boolean; stopClearOfBell: boolean };

/** Reads the chip's fit as drawn; with `state`/`subject`, redraws those parts first (the run is paused, so nothing
 *  overwrites them) and puts React's DOM back exactly as it was, so the next render reconciles what it drew. */
async function measure(page: Page, state?: string, subject?: string | null): Promise<Fit> {
  return page.evaluate(([state, subject]) => {
    const right = document.querySelector<HTMLElement>('.topbar-right'), chip = right?.querySelector<HTMLElement>('.eval-chip[data-tone]');
    const stateEl = chip?.querySelector<HTMLElement>('.eval-chip-state'), stop = right?.querySelector<HTMLElement>('button[aria-label="Stop"]'), bell = right?.querySelector<HTMLElement>('.bell-button');
    if (!right || !chip || !stateEl || !stop || !bell) throw new Error('top bar not drawn: ' + [right, chip, stateEl, stop, bell].map(Boolean).join(','));
    const drawnState = stateEl.textContent, drawnSubject = chip.querySelector<HTMLElement>('.eval-chip-subject'), drawnSubjectText = drawnSubject?.textContent ?? null;
    if (state !== undefined) stateEl.textContent = state;
    let subjectEl: HTMLElement | null = drawnSubject, made: HTMLElement | null = null;
    if (subject === null) { if (drawnSubject) drawnSubject.hidden = true; subjectEl = null; }
    else if (subject !== undefined) {
      if (!subjectEl) { made = document.createElement('span'); made.className = 'eval-chip-subject'; chip.append(made); subjectEl = made; }
      subjectEl.textContent = ' · ' + subject;
    }
    const box = (el: Element) => el.getBoundingClientRect(), slot = box(right);
    const inSlot = (el: Element) => box(el).left >= slot.left - 0.5 && box(el).right <= slot.right + 0.5;
    const fit = {
      stateWhole: stateEl.scrollWidth <= stateEl.clientWidth, subjectWhole: subjectEl ? subjectEl.scrollWidth <= subjectEl.clientWidth : null,
      chipInSlot: inSlot(chip), stopInSlot: inSlot(stop), bellInSlot: inSlot(bell),
      chipClearOfStop: box(chip).right <= box(stop).left, stopClearOfBell: box(stop).right <= box(bell).left,
    };
    stateEl.textContent = drawnState;
    if (drawnSubject) { drawnSubject.hidden = false; drawnSubject.textContent = drawnSubjectText; }
    made?.remove();
    return fit;
  }, [state, subject] as const);
}

test('the eval chip keeps its state whole beside Stop and the bell; only its subject gives way', async ({ page }) => {
  await prepare(page, { name: 'Eval chip fit', route: '#/library/global', klass: 'screen', width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('checkbox', { name: 'Select deploy-check' }).click();
  await page.getByRole('checkbox', { name: 'Select pr-review' }).click();
  await page.getByRole('button', { name: 'Evaluate 2 skills…' }).click();
  const question = page.getByRole('dialog', { name: 'Evaluate 2 skills?' });
  await expect(question).toBeVisible();
  await question.getByRole('radio', { name: 'In batches' }).check();
  await question.getByLabel('Batch size').fill('1');
  await question.getByRole('button', { name: 'Run evals' }).click();
  // The CLI's question between batches holds the run.
  await expect(page.getByRole('dialog', { name: 'Continue with the next 1? (1 of 2 done, 1 left)' })).toBeVisible();

  const chip = page.locator('.eval-chip[data-tone="running"]');
  await expect(chip).toHaveText('Evaluating · 1 of 2');
  await expect(chip).toHaveAttribute('title', 'Evaluating · 1 of 2');
  await expect(chip).toHaveAttribute('aria-label', 'Evaluating · 1 of 2');
  const stop = page.locator('.topbar-right button[aria-label="Stop"]');
  await expect(stop).toBeVisible();
  // Both covered cards carry the dot (the modal question hides the page from the accessibility tree, so by class); no other card does.
  const dots = page.locator('.card-evaluating');
  await expect(dots).toHaveCount(2);
  await expect(page.locator('.card-evaluating[aria-label="Evaluating deploy-check"]')).toBeVisible();
  await expect(page.locator('.card-evaluating[aria-label="Evaluating pr-review"]')).toBeVisible();

  const live = await measure(page);
  expect(live).toMatchObject({ stateWhole: true, chipInSlot: true, stopInSlot: true, bellInSlot: true, chipClearOfStop: true, stopClearOfBell: true });
  // The longest state in the ladder still reads whole with no subject beside it.
  expect(await measure(page, LONGEST_STATE, null)).toMatchObject({ stateWhole: true, chipInSlot: true, chipClearOfStop: true, stopClearOfBell: true });
  // A long name: the subject is what shortens, never the state, and the chip stays inside its slot.
  expect(await measure(page, 'Starting', LONG_SUBJECT)).toMatchObject({ stateWhole: true, subjectWhole: false, chipInSlot: true, chipClearOfStop: true, stopClearOfBell: true });
  // A short name (Teddy's `handoff`) beside a short state shortens nothing.
  expect(await measure(page, 'Starting', 'handoff')).toMatchObject({ stateWhole: true, subjectWhole: true, chipInSlot: true, chipClearOfStop: true });

  // The square Stop is the real one: it cancels the run, the chip turns to stopped with a ✕, and the dots go out.
  await stop.dispatchEvent('click');
  await expect(page.locator('.eval-chip[data-tone="stopped"]')).toHaveText('Eval stopped · 2 skills');
  await expect(page.locator('.topbar-right button[aria-label="Dismiss eval status"]')).toBeVisible();
  await expect(dots).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /^Continue with the next/ })).toHaveCount(0);
});
