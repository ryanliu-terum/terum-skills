import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const icons = resolve(dirname(fileURLToPath(import.meta.url)), '../../src-tauri/icons');
const pngs = readdirSync(icons)
  .filter((name) => name.endsWith('.png'))
  .sort();

/** The four corner pixels, as alpha values. */
function cornerAlpha(file: string): number[] {
  const png = PNG.sync.read(readFileSync(join(icons, file)));
  const alpha = (x: number, y: number) => png.data[((png.width * y + x) << 2) + 3];
  return [
    alpha(0, 0),
    alpha(png.width - 1, 0),
    alpha(0, png.height - 1),
    alpha(png.width - 1, png.height - 1),
  ];
}

describe('app icon', () => {
  it('ships every size', () => {
    expect(pngs.length).toBeGreaterThan(0);
    expect(pngs).toContain('icon.png');
    expect(pngs).toContain('source.png');
  });

  // The icon is a rounded rectangle. Rasterized onto a white page instead of
  // onto transparency, its corners come out opaque white, and macOS then draws
  // the app as a hard-edged square in the Dock. Regenerate with `npm run icon`.
  // Downscaling leaves a trace of alpha in the corner pixel of the smallest
  // sizes, so the bar is "invisible", not a literal zero.
  it.each(pngs)('%s has transparent corners', (file) => {
    for (const alpha of cornerAlpha(file)) expect(alpha).toBeLessThanOrEqual(2);
  });

  it('has no mobile icon sets to keep in sync', () => {
    const dirs = readdirSync(icons, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(dirs.map((entry) => entry.name)).toEqual([]);
  });
});
