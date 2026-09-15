import { useEffect, useState } from 'react';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBackend, usePreference } from '../backend';
import { appUpdatePolicy, stagedAppUpdate, recordAppUpdateAttempt, recordAppUpdateError, type AppUpdateErrors } from '../lib/app-update';
import type { AppUpdateStatus, Result } from '../backend/types';
import { useOvernightWindow } from './overnightWindow';

/** A focus more than this long after the last check asks the CLI again; the CLI's own once-a-day cap makes most of those a cached read. */
export const APP_UPDATE_RECHECK_MS = 60 * 60_000;

/**
 * The launch check fills the cache; policy changes act on that observation. It is not once-per-window: a window
 * that stays open for days would otherwise never learn about a release tagged after launch, and a CLI whose hello
 * came late (no `run/app.json` at that instant) would have disabled updates for the whole session. So a focus repeats
 * the launch check while it has not succeeded, and after an hour re-reads the CLI's answer.
 */
export function useAppUpdateCheck(): void {
  const backend = useBackend(), client = useQueryClient();
  const policy = appUpdatePolicy(usePreference('updates:app:policy', 'on-close'));
  const [ready, setReady] = useState(false);
  const observation = useQuery<Result<AppUpdateStatus>>({ queryKey: ['app-update'], enabled: false, queryFn: skipToken });
  const staging = useQuery<string | null>({ queryKey: ['app-update-staging'], enabled: false, queryFn: skipToken });
  // Shared with Settings' Update and relaunch: a version either side already started downloading is not started again this session.
  const attempted = useQuery<string[]>({ queryKey: ['app-update-attempted'], enabled: false, queryFn: skipToken, gcTime: Infinity }).data;
  const status = observation.data?.ok ? observation.data.value : null;
  const version = ready && status?.supported && status.newer ? status.latest : null;
  const staged = ready ? stagedAppUpdate(status) : null;
  useQuery<AppUpdateErrors>({ queryKey: ['app-update-policy-outcome'], enabled: false, queryFn: skipToken, gcTime: Infinity });
  const recordError = (error: unknown) => recordAppUpdateError(client, 'apply', error);
  useEffect(() => {
    let disposed = false, inFlight = false, succeeded = false, checkedAt = 0;
    const launch = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      try {
        if (!(await backend.surfaces()).appUpdate || disposed) return;
        if (!(await backend.features()).appUpdate || disposed) return;
        await backend.prefs.ready;
        await client.ensureQueryData({ queryKey: ['app-update'], queryFn: () => backend.appUpdate.check(), staleTime: Infinity, gcTime: Infinity, retry: false });
        checkedAt = Date.now(); succeeded = true;
        try { await backend.prefs.flush?.(); }
        catch (error) {
          recordAppUpdateError(client, 'preferences', `Could not save update preferences: ${String(error)}`);
        }
        if (!disposed) setReady(true);
      } catch (error) { recordAppUpdateError(client, 'launch', error); }
      finally { inFlight = false; }
    };
    const recheck = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      try { await client.fetchQuery({ queryKey: ['app-update'], queryFn: () => backend.appUpdate.check(), staleTime: 0, gcTime: Infinity, retry: false }); checkedAt = Date.now(); }
      catch (error) { recordAppUpdateError(client, 'launch', error); }
      finally { inFlight = false; }
    };
    const focus = () => { if (!succeeded) void launch(); else if (Date.now() - checkedAt >= APP_UPDATE_RECHECK_MS) void recheck(); };
    void launch();
    window.addEventListener('focus', focus);
    return () => { disposed = true; window.removeEventListener('focus', focus); };
  }, [backend, client]);
  useEffect(() => {
    if (!version || status?.installed.includes(version) || staged || policy === 'ask' || staging.data || attempted?.includes(version)) return;
    recordAppUpdateAttempt(client, version);
    client.setQueryData(['app-update-staging'], version);
    void (async () => {
      try {
        const result = await backend.appUpdate.stage(version).done;
        if (!result.ok) recordAppUpdateError(client, 'stage', result.error);
        else if (result.value.staged) client.setQueryData<Result<AppUpdateStatus>>(['app-update'], current => current?.ok ? { ok: true, value: { ...current.value, staged: version } } : current);
        // An advertised release without published assets is a quiet W-01 no-op; Download remains available.
      } catch (error) {
        recordAppUpdateError(client, 'stage', error);
      } finally { client.setQueryData(['app-update-staging'], null); }
    })();
  }, [backend, client, policy, version, staged, staging.data, status?.installed, attempted]);
  useEffect(() => {
    if (!ready) return;
    const result = policy === 'on-close' && staged ? backend.appUpdate.armOnClose(staged) : backend.appUpdate.disarmOnClose();
    void result.then(outcome => { if (!outcome.ok) recordAppUpdateError(client, 'arm', outcome.error); }, error => {
      recordAppUpdateError(client, 'arm', error);
    });
    return () => {
      void backend.appUpdate.disarmOnClose().then(outcome => {
        if (!outcome.ok) recordAppUpdateError(client, 'arm', outcome.error);
      }, error => { recordAppUpdateError(client, 'arm', error); });
    };
  }, [backend, client, policy, ready, staged]);
  useOvernightWindow({
    enabled: policy === 'overnight' && staged !== null,
    onFire: async () => {
      if (staged === null) return;
      const result = await backend.appUpdate.apply(staged, 'overnight');
      if (!result.ok) recordAppUpdateError(client, 'apply', result.error);
      if (result.ok) await backend.quit();
    },
    onError: recordError,
  });
}
