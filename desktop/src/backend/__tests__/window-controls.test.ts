import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { WINDOW_CONTROLS_X, macWindowControlsEnd } from '../window-controls';
import { createTauriBackend } from '../tauri';
import { fakeBridge } from '../tauri/__tests__/fake-bridge';

it.each([
 ['11.7.10', 68], ['15.6', 68], ['25.0', 68],
 ['26.0', 76], ['26.6.2', 76], ['27.1', 76],
 [null, 68], ['', 68], ['Tahoe', 68],
] as const)('macOS %s draws its controls out to x=%i', (version, end) => { expect(macWindowControlsEnd(version)).toBe(end); });

it('starts the controls where tauri.conf.json puts the close button and where the bars pad to', () => {
 const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
 expect(config.app.windows[0].trafficLightPosition.x).toBe(WINDOW_CONTROLS_X);
 for (const [file, rule] of [['src/styles/app.css', /\.topbar-left \{[^}]+\}/], ['src/screens/onboarding/onboarding.css', /\.onboarding-bar\{[^}]+\}/]] as const) {
  expect(readFileSync(file, 'utf8').match(rule)?.[0]).toContain(`padding:0 8px 0 ${WINDOW_CONTROLS_X}px`);
 }
});

it.each([['26.6.2', 76], ['15.6', 68]])('the real adapter reports the controls for release %s', async (version, end) => {
 const f = fakeBridge((_args, emit) => emit({ kind: 'exit', code: 1 })); f.bridge.hostOsVersion = async () => version;
 expect(await createTauriBackend(f.bridge).capabilities()).toMatchObject({ windowChrome: 'mac-overlay', windowControlsEnd: end });
});

it('an unreadable release falls back to the pre-Tahoe geometry rather than failing capabilities', async () => {
 const f = fakeBridge((_args, emit) => emit({ kind: 'exit', code: 1 })); f.bridge.hostOsVersion = async () => { throw new Error('SystemVersion.plist: permission denied'); };
 expect(await createTauriBackend(f.bridge).capabilities()).toMatchObject({ windowChrome: 'mac-overlay', windowControlsEnd: 68 });
});

it('no controls are reported where the OS draws its own title bar', async () => {
 const f = fakeBridge((_args, emit) => emit({ kind: 'exit', code: 1 })); f.bridge.hostPlatform = async () => 'windows'; f.bridge.hostOsVersion = async () => '10.0.26100';
 expect(await createTauriBackend(f.bridge).capabilities()).toMatchObject({ windowChrome: 'native', windowControlsEnd: null });
});
