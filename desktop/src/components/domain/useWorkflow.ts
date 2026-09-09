import { useSearchParams } from 'react-router';
import { useContext, useEffect, useRef, useState } from 'react';
import { driveRun, PrintContext, PromptContext, useBackend } from '../../backend';
import type { Result, Run } from '../../backend/types';

/** Own a screen action, including cancellation and questions not drawn by the board. */
export function useWorkflow() {
  const backend = useBackend();
  const ask = useContext(PromptContext);
  const [, setSearch] = useSearchParams();
  const [lines, setLines] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const print = useContext(PrintContext);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, refreshPrefs] = useState(0);
  const active = useRef<{ cancel(): Promise<void> } | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const run = active.current;
      if (run) void run.cancel().catch(() => { /* The screen has unmounted; no result or UI update can be consumed. */ });
    };
  }, []);
  function fail(reason: unknown) {
    if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason));
  }
  async function perform<T>(start: () => Promise<Result<T>>, success?: (value: T) => void) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    setLines([]);
    try {
      const result = await start();
      if (!mounted.current) return;
      if (result.ok) success?.(result.value);
      else if (result.cancelled) {
        setNotice(result.error);
        setSearch(params => { params.delete('dialog'); return params; }, { replace: true });
      } else setError(result.error);
    } catch (reason) { fail(reason); }
    finally {
      locked.current = false;
      active.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  function run<T>(start: () => Run<T>, answers: Record<string, string | boolean> = {}, success?: (value: T) => void) {
    return perform(() => {
      const operation = start();
      active.current = operation;
      return driveRun(operation, answers, ask, line => { if (mounted.current) setLines(lines => [...lines, line]); print(line); });
    }, success);
  }
  function pref(key: string, value: unknown): boolean {
    try { backend.prefs.set(key, value); void backend.prefs.flush?.().catch(fail); setError(null); refreshPrefs(n => n + 1); return true; }
    catch (reason) { fail(reason); return false; }
  }
  return { error, notice, lines, busy, run, perform, pref, fail, open: (path: string) => perform(() => backend.openInEditor(path)) };
}
