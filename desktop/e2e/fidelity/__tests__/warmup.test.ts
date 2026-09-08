import { beforeEach, expect, it, vi } from 'vitest';
import type { FullProject } from '@playwright/test';
import { BOARDS } from '../boards';
import { warmDevServer, WARMUP_ROUTES } from '../setup';

const mocks = vi.hoisted(() => {
 const page = {
  goto: vi.fn(),
  waitForSelector: vi.fn(),
  locator: vi.fn(),
  setDefaultTimeout: vi.fn(),
  setDefaultNavigationTimeout: vi.fn(),
 };
 const browser = { newPage: vi.fn(), close: vi.fn() };
 return { page, browser, launch: vi.fn(), boundaryCount: vi.fn() };
});
vi.mock('@playwright/test', () => ({ chromium: { launch: mocks.launch } }));

const project: Pick<FullProject, 'use' | 'timeout'> = {
 use: { baseURL: 'http://localhost:1420', channel: 'chromium' },
 timeout: 60_000,
};

beforeEach(() => {
 vi.resetAllMocks();
 mocks.launch.mockResolvedValue(mocks.browser);
 mocks.browser.newPage.mockResolvedValue(mocks.page);
 mocks.browser.close.mockResolvedValue(undefined);
 mocks.page.goto.mockResolvedValue({ ok: () => true });
 mocks.page.waitForSelector.mockResolvedValue(undefined);
 mocks.page.locator.mockReturnValue({ count: mocks.boundaryCount });
 mocks.boundaryCount.mockResolvedValue(0);
});

it('warms every board route family using a concrete board route, plus Search', () => {
 const family = (route: string) => route.split('?')[0]?.split('/')[1];
 const warmedFamilies = new Set(WARMUP_ROUTES.map(family));
 for (const board of BOARDS) expect(warmedFamilies.has(family(board.route)), board.route).toBe(true);
 const boardRoutes = new Set(BOARDS.map(board => board.route));
 for (const route of WARMUP_ROUTES) {
  if (route === '#/search') continue;
  expect(boardRoutes.has(route), route).toBe(true);
 }
 expect(WARMUP_ROUTES).toContain('#/search');
 expect(warmedFamilies.size).toBe(WARMUP_ROUTES.length);
});

it('awaits each fresh document and readiness marker, then discards the warm-up browser', async () => {
 const events: string[] = [];
 mocks.page.goto.mockImplementation(async (url: string) => {
  events.push(url);
  return { ok: () => true };
 });
 mocks.page.waitForSelector.mockImplementation(async (selector: string) => { events.push(selector); });
 mocks.boundaryCount.mockImplementation(async () => { events.push('boundary'); return 0; });
 await warmDevServer(project);
 expect(events).toEqual(WARMUP_ROUTES.flatMap(route => [
  'about:blank', '/' + route, 'html[data-app-ready="true"]', 'boundary',
 ]));
 expect(mocks.launch).toHaveBeenCalledWith({ channel: 'chromium' });
 expect(mocks.browser.newPage).toHaveBeenCalledExactlyOnceWith({
  baseURL: 'http://localhost:1420', viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1, colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC',
 });
 expect(mocks.page.setDefaultTimeout).toHaveBeenCalledExactlyOnceWith(60_000);
 expect(mocks.page.setDefaultNavigationTimeout).toHaveBeenCalledExactlyOnceWith(60_000);
 expect(mocks.page.locator).toHaveBeenCalledWith('[data-error-boundary]');
 expect(mocks.browser.close).toHaveBeenCalledOnce();
});

it('does not begin the next family while the current screen is still loading', async () => {
 let markReady: (() => void) | undefined;
 mocks.page.waitForSelector.mockImplementationOnce(() => new Promise<void>(resolve => { markReady = resolve; }));
 const warming = warmDevServer(project);
 await vi.waitFor(() => expect(mocks.page.waitForSelector).toHaveBeenCalledOnce());
 expect(mocks.page.goto).toHaveBeenCalledTimes(2);
 expect(mocks.browser.close).not.toHaveBeenCalled();
 if (!markReady) throw new Error('The first screen never began its readiness wait.');
 markReady();
 await warming;
 expect(mocks.page.waitForSelector).toHaveBeenCalledTimes(WARMUP_ROUTES.length);
});

it('uses the project browser options and page settings', async () => {
 await warmDevServer({
  timeout: 60_000,
  use: {
   ...project.use, launchOptions: { headless: true }, viewport: { width: 1200, height: 800 },
   deviceScaleFactor: 2, colorScheme: 'light', locale: 'fr-FR', timezoneId: 'Europe/Paris',
  },
 });
 expect(mocks.launch).toHaveBeenCalledWith({ channel: 'chromium', headless: true });
 expect(mocks.browser.newPage).toHaveBeenCalledWith({
  baseURL: 'http://localhost:1420', viewport: { width: 1200, height: 800 },
  deviceScaleFactor: 2, colorScheme: 'light', locale: 'fr-FR', timezoneId: 'Europe/Paris',
 });
});

it('fails before launching when no dev-server URL is configured', async () => {
 await expect(warmDevServer({ use: {}, timeout: 60_000 })).rejects.toThrow('baseURL');
 expect(mocks.launch).not.toHaveBeenCalled();
});

it('propagates browser launch errors without claiming that warm-up succeeded', async () => {
 const failure = new Error('Browser unavailable');
 mocks.launch.mockRejectedValue(failure);
 await expect(warmDevServer(project)).rejects.toBe(failure);
 expect(mocks.browser.newPage).not.toHaveBeenCalled();
});

it('closes the browser when creation of the throwaway page fails', async () => {
 const failure = new Error('Page unavailable');
 mocks.browser.newPage.mockRejectedValue(failure);
 await expect(warmDevServer(project)).rejects.toBe(failure);
 expect(mocks.browser.close).toHaveBeenCalledOnce();
});

it.each(['navigation', 'readiness', 'boundary', 'http', 'no-response'] as const)(
 'fails setup and closes the browser on a %s failure', async failureMode => {
  const failure = new Error(failureMode + ' failed');
  switch (failureMode) {
   case 'navigation': mocks.page.goto.mockResolvedValueOnce(null).mockRejectedValueOnce(failure); break;
   case 'readiness': mocks.page.waitForSelector.mockRejectedValueOnce(failure); break;
   case 'boundary': mocks.boundaryCount.mockResolvedValueOnce(1); break;
   case 'http': mocks.page.goto.mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: () => false, status: () => 503 }); break;
   case 'no-response': mocks.page.goto.mockResolvedValueOnce(null).mockResolvedValueOnce(null); break;
  }
  const result = warmDevServer(project);
  await expect(result).rejects.toThrow('Dev-server warm-up failed for #/frame.');
  const cause = failureMode === 'navigation' || failureMode === 'readiness' ? failure : expect.any(Error);
  await expect(result).rejects.toMatchObject({ cause });
  expect(mocks.page.goto).toHaveBeenCalledTimes(2);
  expect(mocks.browser.close).toHaveBeenCalledOnce();
 },
);

it('does not hide failure to dispose of the warm-up browser', async () => {
 const failure = new Error('Browser cleanup failed');
 mocks.browser.close.mockRejectedValue(failure);
 await expect(warmDevServer(project)).rejects.toBe(failure);
});

it('preserves both the failed route and cleanup error when warm-up and disposal fail', async () => {
 const readinessFailure = new Error('Readiness timed out');
 const cleanupFailure = new Error('Browser cleanup failed');
 mocks.page.waitForSelector.mockRejectedValueOnce(readinessFailure);
 mocks.browser.close.mockRejectedValueOnce(cleanupFailure);
 await expect(warmDevServer(project)).rejects.toMatchObject({
  name: 'AggregateError',
  errors: [
   { message: 'Dev-server warm-up failed for #/frame.', cause: readinessFailure },
   cleanupFailure,
  ],
 });
 expect(mocks.browser.close).toHaveBeenCalledOnce();
});
