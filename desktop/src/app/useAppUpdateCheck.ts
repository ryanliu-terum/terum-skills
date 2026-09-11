import { useEffect, useRef, useState } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBackend, usePreference } from '../backend';
import { appUpdatePolicy } from '../backend/prefs';
import type { AppUpdateStatus, Result } from '../backend/types';
import { useOvernightWindow } from './overnightWindow';

/** A single launch check fills the cache. Policy changes act on that observation, never check again. */
export function useAppUpdateCheck(): void {
  const backend = useBackend(), client = useQueryClient();
  const policy = appUpdatePolicy(usePreference('updates:app:policy', 'on-close'));
  const [ready, setReady] = useState(false);
  const attempted = useRef(new Set<string>());
  const observation = useQuery<Result<AppUpdateStatus>>({ queryKey: ['app-update'], enabled: false, queryFn: skipToken });
  const staging = useQuery<string | null>({ queryKey: ['app-update-staging'], enabled: false, queryFn: skipToken });
  const status = observation.data?.ok ? observation.data.value : null;
  const version = ready && status?.supported && status.newer ? status.latest : null;
  const staged = version !== null && status?.staged === version && !status.installed.includes(version) ? version : null;
  const recordError = (error: unknown) => client.setQueryData(['app-update-policy-outcome'], { ok: false, error: error instanceof Error ? error.message : String(error) });
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        if (!(await backend.surfaces()).appUpdate || disposed) return;
        if (!(await backend.features()).appUpdate || disposed) return;
        await backend.prefs.ready;
        await client.ensureQueryData({ queryKey: ['app-update'], queryFn: () => backend.appUpdate.check(), staleTime: Infinity, gcTime: Infinity, retry: false });
        try { await backend.prefs.flush?.(); }
        catch (error) {
          client.setQueryData(['app-update-policy-outcome'], { ok: false, error: `Could not read or save update preferences: ${String(error)}` });
          return;
        }
        if (!disposed) setReady(true);
      } catch { /* The cached check error remains available to Settings; launch stays usable. */ }
    })();
    return () => { disposed = true; };
  }, [backend, client]);
  useEffect(() => {
    if (!version || staged || policy === 'ask' || staging.data || attempted.current.has(version)) return;
    attempted.current.add(version);
    client.setQueryData(['app-update-staging'], version);
    void (async () => {
      try {
        const result = await backend.appUpdate.stage(version).done;
        if (!result.ok) client.setQueryData(['app-update-policy-outcome'], result);
        else if (result.value.staged) client.setQueryData<Result<AppUpdateStatus>>(['app-update'], current => current?.ok ? { ok: true, value: { ...current.value, staged: version } } : current);
      } catch (error) {
        client.setQueryData(['app-update-policy-outcome'], { ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally { client.setQueryData(['app-update-staging'], null); }
    })();
  }, [backend, client, policy, version, staged, staging.data]);
  useEffect(() => {
    if (!ready) return;
    const result = policy === 'on-close' && staged ? backend.appUpdate.armOnClose(staged) : backend.appUpdate.disarmOnClose();
    void result.then(outcome => { client.setQueryData(['app-update-policy-outcome'], outcome); }, error => {
      client.setQueryData(['app-update-policy-outcome'], { ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      void backend.appUpdate.disarmOnClose().then(outcome => {
        if (!outcome.ok) client.setQueryData(['app-update-policy-outcome'], outcome);
      }, error => { client.setQueryData(['app-update-policy-outcome'], { ok: false, error: String(error) }); });
    };
  }, [backend, client, policy, ready, staged]);
  useOvernightWindow({
    enabled: policy === 'overnight' && staged !== null,
    onFire: async () => {
      if (staged === null) return;
      const result = await backend.appUpdate.apply(staged, 'overnight');
      client.setQueryData(['app-update-policy-outcome'], result);
      if (result.ok) await backend.quit();
    },
    onError: recordError,
  });
}
