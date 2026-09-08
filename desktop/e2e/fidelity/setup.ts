import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import type { FullConfig, FullProject } from '@playwright/test';

export const WARMUP_ROUTES = [
 '#/frame',
 '#/library/global',
 '#/skill/deploy-check',
 '#/inbox',
 '#/marketplace',
 '#/share',
 // These families require a section/step; their bare paths render the fallback page.
 '#/settings/account',
 '#/onboarding/boot',
 '#/search',
] as const;

export async function warmDevServer(project: Pick<FullProject, 'use' | 'timeout'>): Promise<void> {
 const { baseURL, channel, launchOptions, viewport, deviceScaleFactor, colorScheme, locale, timezoneId } = project.use;
 if (!baseURL) throw new Error('Dev-server warm-up requires the Playwright project baseURL.');
 const browser = await chromium.launch({ ...launchOptions, ...(channel ? { channel } : {}) });
 try {
  const page = await browser.newPage({
   baseURL,
   viewport: viewport ?? { width: 1440, height: 900 },
   deviceScaleFactor: deviceScaleFactor ?? 1,
   colorScheme: colorScheme ?? 'dark',
   locale: locale ?? 'en-US',
   timezoneId: timezoneId ?? 'UTC',
  });
  page.setDefaultNavigationTimeout(project.timeout);
  page.setDefaultTimeout(project.timeout);
  for (const route of WARMUP_ROUTES) {
   try {
    // Hash-only navigation can observe the previous screen's readiness marker.
    // A fresh document preserves Vite's compiled modules without reusing that marker.
    await page.goto('about:blank');
    const response = await page.goto('/' + route);
    if (!response?.ok()) throw new Error(`Navigation returned ${response ? 'HTTP ' + response.status() : 'no response'}.`);
    await page.waitForSelector('html[data-app-ready="true"]');
    if (await page.locator('[data-error-boundary]').count()) throw new Error('The screen rendered an error boundary.');
   } catch (cause) {
    throw new Error(`Dev-server warm-up failed for ${route}.`, { cause });
   }
  }
 } catch (failure) {
  try {
   await browser.close();
  } catch (cleanupFailure) {
   throw new AggregateError([failure, cleanupFailure], 'Dev-server warm-up and browser cleanup failed.', { cause: cleanupFailure });
  }
  throw failure;
 }
 await browser.close();
}

export function clearFidelityOutput(outputDir:string):void {
 rmSync(join(outputDir,'rows'),{recursive:true,force:true});
 rmSync(join(outputDir,'report.json'),{force:true});
}
export default async function setup(config: FullConfig):Promise<void> {
 clearFidelityOutput('e2e/out/fidelity');
 const project = config.projects.find(project => project.name === 'chromium');
 if (!project) throw new Error('Dev-server warm-up requires the Chromium project.');
 await warmDevServer(project);
}
