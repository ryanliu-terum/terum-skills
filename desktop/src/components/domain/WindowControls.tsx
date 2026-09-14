import type { HTMLAttributes } from 'react';
import type { Capabilities } from '../../backend/types';
import { WINDOW_CONTROLS_X, macWindowControlsEnd } from '../../backend/window-controls';
import { TrafficLights } from './TrafficLights';

/**
 * The window-controls corner of a 40px bar whose padding-left is `WINDOW_CONTROLS_X`: drawn lights in the mock,
 * a spacer the width of the OS's own controls under `mac-overlay`, nothing where the OS draws the title bar itself.
 * The one place the spacer is sized, for the top bar and the onboarding bar alike.
 */
export function WindowControls({ mode, controlsEnd, ...rest }: { mode: Capabilities['windowChrome']; controlsEnd: number | null } & HTMLAttributes<HTMLDivElement>) {
  if (mode === 'cosmetic') return <TrafficLights />;
  if (mode === 'mac-overlay') return <div style={{ width: (controlsEnd ?? macWindowControlsEnd(null)) - WINDOW_CONTROLS_X, flexShrink: 0 }} {...rest} />;
  return null;
}
