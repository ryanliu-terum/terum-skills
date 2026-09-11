import { useEffect, useRef } from 'react';

export interface OvernightWindowOptions {
  /** false: nothing is scheduled and any pending timer is cleared. */
  enabled: boolean;
  /** Called at most once per local calendar night; rejected promises go to onError. */
  onFire: () => void | Promise<void>;
  onError?: (error: unknown) => void;
  /** Local hours; defaults 1 and 5. */
  startHour?: number;
  endHour?: number;
  /** Default 30 * 60_000. Activity = pointerdown, pointermove, keydown, wheel on window. */
  idleMs?: number;
  /** Test knob for the clock; timers use the global setTimeout. */
  now?: () => Date;
}
const clock = () => new Date();
function validateHours(start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) throw new RangeError('Overnight hours must satisfy 0 <= startHour < endHour <= 24.');
}
function boundary(date: Date, hour: number, tomorrow = false): Date {
  const result = new Date(date);
  if (tomorrow) result.setDate(result.getDate() + 1);
  result.setHours(hour, 0, 0, 0);
  return result;
}
/** Pure: ms to the next open window, using local calendar arithmetic across DST changes. */
export function msUntilWindow(now: Date, startHour: number, endHour: number): number {
  validateHours(startHour, endHour);
  if (!Number.isFinite(now.getTime())) throw new RangeError('Overnight clock must return a valid date.');
  if (now < boundary(now, startHour)) return boundary(now, startHour).getTime() - now.getTime();
  if (now < boundary(now, endHour)) return 0;
  return boundary(now, startHour, true).getTime() - now.getTime();
}
/** One pending timer, shared by the update policy and queued-eval consumers. */
export function useOvernightWindow({ enabled, onFire, onError, startHour = 1, endHour = 5, idleMs = 30 * 60_000, now = clock }: OvernightWindowOptions): void {
  const callbacks = useRef({ onFire, onError });
  const nights = useRef(new Set<string>());
  useEffect(() => { callbacks.current = { onFire, onError }; }, [onFire, onError]);
  useEffect(() => {
    if (!enabled) return;
    let lastActivity = NaN;
    let dueAt = Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    function report(error: unknown): void {
      try { callbacks.current.onError?.(error); }
      catch { /* Error reporting is best-effort; keep the scheduler alive if its consumer also fails. */ }
    }
    function tick(): void {
      if (disposed) return;
      if (timer !== undefined) clearTimeout(timer);
      let delay = 60_000;
      try {
        validateHours(startHour, endHour);
        if (!Number.isFinite(idleMs) || idleMs < 0) throw new RangeError('idleMs must be finite and non-negative.');
        const date = now(), time = date.getTime();
        const wait = msUntilWindow(date, startHour, endHour);
        // A timer over a minute late may have slept or been suspended. Require fresh idle time.
        if (!Number.isFinite(lastActivity) || time < lastActivity || time - dueAt > 60_000) lastActivity = time;
        const night = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        if (wait === 0 && !nights.current.has(night) && time - lastActivity >= idleMs) {
          nights.current.add(night);
          // Reserve this night before calling user code, including synchronous failures.
          void Promise.resolve().then(() => { if (!disposed) return callbacks.current.onFire(); }).catch(report);
        }
        delay = nights.current.has(night)
          ? boundary(date, startHour, true).getTime() - time
          : wait > 0 ? wait : Math.min(Math.max(1, lastActivity + idleMs - time), boundary(date, endHour).getTime() - time);
        dueAt = time + Math.max(1, delay);
      } catch (error) {
        lastActivity = NaN;
        dueAt = Infinity;
        report(error);
      } finally {
        if (!disposed) timer = setTimeout(tick, Math.max(1, delay));
      }
    }
    const activity = () => {
      try {
        const time = now().getTime();
        if (!Number.isFinite(time)) throw new RangeError('Overnight clock must return a valid date.');
        const backwards = time < lastActivity;
        lastActivity = time;
        // Ordinary activity only updates the timestamp. The existing timer will check it before firing.
        // A wake or backwards clock change requires replacing the now-obsolete window boundary.
        if (time >= dueAt || backwards) tick();
      } catch (error) { lastActivity = NaN; report(error); }
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    for (const event of events) window.addEventListener(event, activity, { passive: true });
    tick();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, activity);
    };
  }, [enabled, startHour, endHour, idleMs, now]);
}
