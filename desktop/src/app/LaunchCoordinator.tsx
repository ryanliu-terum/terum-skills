import { useEffect, useEffectEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { activeSetupSession, existingSetupSession, setupSession, useBackend } from '../backend';
import type { LaunchContext } from '../backend/types';
import { useUrlState } from './url-state';
import { decide, needsLaunchStatus } from './launch-decision';
import { useAppUpdateCheck } from './useAppUpdateCheck';

export function LaunchCoordinator() {
 const backend = useBackend(), client = useQueryClient(), navigate = useNavigate(), { mock } = useUrlState();
 const openBoot = useEffectEvent(() => navigate('/onboarding/boot', { replace: true }));
 useAppUpdateCheck();
 useEffect(() => {
  let disposed = false;
  let lastSeen: string | null | undefined;
  const pending: (LaunchContext | null)[] = [];
  let stopWaiting: (() => void) | undefined;
  let refreshNumber = 0;
  let draining = false;
  async function drain() {
   if (draining) return;
   draining = true;
   try {
    while (!disposed && pending.length) {
     const ctx = pending.shift() ?? null;
     const active = activeSetupSession(backend);
     if (active && active !== (ctx && existingSetupSession(backend, ctx))) {
      await new Promise<void>(resolve => {
       const off = active.subscribe(() => {
        if (active.snapshot().outcome === 'running') return;
        off(); stopWaiting = undefined; resolve();
       });
       stopWaiting = () => { off(); resolve(); };
      });
     }
     if (disposed) return;
     const consumed = backend.prefs.get('launch:consumedWrittenAt', '');
     const status = needsLaunchStatus(ctx, consumed) ? await client.ensureQueryData({
      queryKey: ['status', mock], queryFn: ({ signal }) => backend.status(undefined, { signal }),
     }).catch(() => undefined) : undefined;
     if (disposed) return;
     const boot = decide(ctx, consumed, status) === 'boot';
     // Reserve the shared session before publishing so the next queued request waits for this one.
     if (boot && ctx) setupSession(backend, ctx);
     client.setQueryData(['launch-context'], ctx);
     if (boot) openBoot();
    }
   } finally { draining = false; }
  }
  function accept(ctx: LaunchContext | null) {
   if (disposed || (ctx?.writtenAt ?? null) === lastSeen) return;
   lastSeen = ctx?.writtenAt ?? null;
   // Preserve observed requests in arrival order; writtenAt is an identity, never a sortable clock.
   pending.push(ctx);
   void drain();
  }
  async function refresh() {
   const request = ++refreshNumber;
   try {
    const ctx = await backend.refreshLaunch();
    if (!disposed && request === refreshNumber) accept(ctx);
   } catch { /* Keep the last usable launch context; a later launch or focus retries the read. */ }
  }
  // Register before refreshing: a second native open must not fall between read and subscription.
  const subscription = backend.onLaunchRequest(() => { void refresh(); });
  const focus = () => { void refresh(); };
  window.addEventListener('focus', focus);
  void (async () => {
   await backend.prefs.ready;
   // Warm status and the local scan; the adapter deduplicates these with the first render.
   void backend.status().catch(()=>{});
   try {
    const ctx = await client.ensureQueryData({queryKey: ['launch-context'], queryFn: () => backend.launchContext(), staleTime: Infinity});
    if (!disposed && refreshNumber === 0) accept(ctx);
   } catch { /* LaunchRoute renders the Library when no context can be read. */ }
   if (!disposed) await refresh();
  })();
  return () => { disposed = true; subscription(); stopWaiting?.(); window.removeEventListener('focus', focus); };
 }, [backend, client, mock]);
 return null;
}
