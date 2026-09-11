import { useEffect, useRef, useState } from 'react';
import { activeSetupSession, useBackend, usePreference } from '../backend';
import { evalQueueFor } from '../backend/eval-queue';
import { useEvalRun } from './eval-run-context';
import { msUntilWindow, useOvernightWindow } from './overnightWindow';

/** One nightly session. The entire parallel batch is one visible, cancellable eval-host run. */
export function EvalQueueDrainer() {
  const backend = useBackend(), host = useEvalRun(), enabled = usePreference('evals:overnight', true);
  const [error, setError] = useState<string | null>(null);
  const live = useRef({ host, enabled });
  const disposed = useRef(false), active = useRef(false), interrupted = useRef(false);
  useEffect(() => { live.current = { host, enabled }; }, [host, enabled]);
  useEffect(() => {
    disposed.current = false;
    const activity = () => { if (active.current) interrupted.current = true; };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    for (const event of events) window.addEventListener(event, activity, { passive: true });
    return () => { disposed.current = true; for (const event of events) window.removeEventListener(event, activity); };
  }, []);
  const isBusy = () => live.current.host.isRunning?.() ?? live.current.host.current?.state === 'running';
  useOvernightWindow({
    enabled: enabled && evalQueueFor(backend) !== undefined,
    onError: reason => setError(reason instanceof Error ? reason.message : String(reason)),
    onFire: async () => {
      const service = evalQueueFor(backend);
      if (!service || active.current || isBusy() || activeSetupSession(backend)) return;
      active.current = true; interrupted.current = false;
      try {
        const queue = await service.list();
        if (!queue.ok) throw new Error(queue.error);
        const item = queue.value.items.find(item => item.window === 'overnight');
        if (!item || disposed.current || !live.current.enabled || interrupted.current || msUntilWindow(new Date(), 1, 5) !== 0 || isBusy() || activeSetupSession(backend)) return;
        await live.current.host.startQueued?.(item);
      } finally { active.current = false; }
    },
  });
  return error ? <div role="alert">Queued evals could not run: {error}</div> : null;
}
