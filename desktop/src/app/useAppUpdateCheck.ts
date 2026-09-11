import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBackend } from '../backend';

/** One check per app process (m7 decision walk row 9: no timer, no poll, and — deliberately narrower
 *  than that gate — not on window focus either, because a check can reach the network). When the
 *  preference allows it and a newer app is advertised, the download starts here and the Relaunch
 *  button on Settings ▸ Updates is what installs it. Every failure is swallowed: a launch must never
 *  be worse because an update check did not work. */
export function useAppUpdateCheck(): void {
  const backend = useBackend(), client = useQueryClient();
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const surfaces = await backend.surfaces();
        if (disposed || !surfaces.appUpdate) return;
        const features = await backend.features();
        if (disposed || !features.appUpdate) return;
        await backend.prefs.ready;
        const status = await client.ensureQueryData({ queryKey: ['app-update'], queryFn: () => backend.appUpdate.check(), staleTime: Infinity, gcTime: Infinity, retry: false });
        if (disposed || !status.ok) return;
        const latest = status.value.latest;
        if (!status.value.newer || latest === null || status.value.staged === latest) return;
        if (!backend.prefs.get('updates:app:auto', true)) return;
        const staged = await backend.appUpdate.stage(latest).done;
        if (disposed || !staged.ok) return;
        client.setQueryData(['app-update'], { ok: true, value: { ...status.value, staged: staged.value.staged ? latest : status.value.staged } });
      } catch { /* A failed launch-time check leaves Settings ▸ Updates to report it on demand. */ }
    })();
    return () => { disposed = true; };
  }, [backend, client]);
}
