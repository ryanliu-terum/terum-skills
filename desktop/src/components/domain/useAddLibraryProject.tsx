import { useContext, useEffect, useRef, useState } from 'react';
import { driveRun, PrintContext, PromptContext, useBackend } from '../../backend';
import type { ProjectAdded, ReconcileResult, Run } from '../../backend/types';
import { ReconcileDialog } from './ReconcileDialog';
import { reconcileHasRows } from './reconcile';

/** Shared project-add coordinator used by every Add project affordance. */
export function useAddLibraryProject() {
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconcile, setReconcile] = useState<ReconcileResult | null>(null);
  const ask = useContext(PromptContext);
  const print = useContext(PrintContext);
  const active = useRef<Run<ProjectAdded> | null>(null);
  useEffect(() => () => { void active.current?.cancel(); }, []);
  async function add(path?: string, onAdded?: (added: ProjectAdded) => void): Promise<void> {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      let selected = path;
      if (selected === undefined) {
        const picked = await backend.pickFolder();
        if (!picked.ok) { setError(picked.error); return; }
        if (picked.value === null) return;
        selected = picked.value;
      }
      const run = backend.projects.add(selected); active.current = run;
      const result = await driveRun(run, {}, ask, print);
      if (!result.ok) setError(result.error);
      else {
        onAdded?.(result.value);
        if (reconcileHasRows(result.value.reconcile)) setReconcile(result.value.reconcile);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { active.current = null; setBusy(false); }
  }
  return {
    add,
    busy,
    error,
    clearError: () => setError(null),
    dialog: reconcile ? <ReconcileDialog result={reconcile} onClose={() => setReconcile(null)}/> : null,
  };
}
