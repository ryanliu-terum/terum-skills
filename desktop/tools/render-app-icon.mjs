// Regenerates the macOS/Windows app icon set from icons/source.svg.
//
//   npm run icon
//
// The rounded corners of the icon only look rounded if the pixels outside the
// rounded rectangle are TRANSPARENT. A rasterizer that flattens the SVG onto a
// white page instead writes opaque white corners, and every platform then draws
// the icon as a hard-edged square — the Dock, the taskbar, the installer.
// Chromium with `omitBackground` keeps the alpha channel, so the corners stay
// empty. `tools/__tests__/app-icon.test.ts` guards the checked-in set.
//
// Requires the Playwright browsers (`npx playwright install chromium`).
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(desktop, 'src-tauri', 'icons');

// Sizes that are checked in alongside the `tauri icon` output but that
// `tauri icon` itself does not emit.
const extraSizes = { 'icon.png': 512, '64x64.png': 64 };

/** Rasterize source.svg at `size`x`size` with a transparent background. */
async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true, type: 'png' });
}

const svg = readFileSync(join(icons, 'source.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  writeFileSync(join(icons, 'source.png'), await render(page, svg, 1024));
  const generated = spawnSync('npx', ['tauri', 'icon', 'src-tauri/icons/source.png'], {
    cwd: desktop,
    stdio: 'inherit',
  });
  if (generated.status !== 0) process.exit(generated.status ?? 1);
  for (const [name, size] of Object.entries(extraSizes)) {
    writeFileSync(join(icons, name), await render(page, svg, size));
  }
  // `tauri icon` always writes the mobile sets; this app ships desktop only.
  for (const mobile of ['android', 'ios']) {
    rmSync(join(icons, mobile), { recursive: true, force: true });
  }
  console.log('Regenerated the app icon set from source.svg.');
} finally {
  await page.close();
  await browser.close();
}
