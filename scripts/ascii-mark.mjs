#!/usr/bin/env node
// Maintainer-only: regenerate src/lib/banner.ts's 44-column, 22-row mark from the desktop icon.
// Run `node scripts/ascii-mark.mjs`; Python Pillow is optional and is never an install/runtime dependency.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../desktop/src-tauri/icons/icon.png', import.meta.url));
const result = spawnSync('python3', ['-c', `
import sys
try:
    from PIL import Image, ImageOps
except ImportError:
    print('Pillow not available')
    sys.exit(0)
image = Image.open(sys.argv[1]).convert('RGBA')
background = Image.new('RGBA', image.size, (0,0,0,255))
background.alpha_composite(image)
image = ImageOps.grayscale(background).resize((44,22), Image.Resampling.LANCZOS)
ramp = ' .:-=+*#%@'
for y in range(22):
    print(''.join(ramp[round(max(0, image.getpixel((x,y))-40)*9/215)] for x in range(44)).rstrip())
`, source], { encoding: 'utf8' });
if (result.error?.code === 'ENOENT') console.log('Pillow not available');
else if (result.error || result.status !== 0) { console.error(result.error?.message ?? result.stderr); process.exitCode = 1; }
else process.stdout.write(result.stdout);
