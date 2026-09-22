import { useContext, useEffect, useRef, useState } from 'react';
import { driveRun, PrintContext, PromptContext, useBackend } from '../../backend';
import type { ProjectRenamed, Root, Run } from '../../backend/types';
import { WorkflowDialog, WorkflowField } from './WorkflowControls';

type Target = Pick<Root, 'id' | 'label' | 'root'>;

/**
 * Shared rename coordinator for every Rename affordance on a Library project (the sidebar row's
 * menu, Settings ▸ This machine ▸ Projects). One dialog: the row's current name, a field, and the
 * CLI line it stands for. `project rename` changes display text only — the folder keeps its name —
 * so the dialog says so and asks nothing else. Offered only where `features.projectRename` is true.
 */
export function useRenameLibraryProject() {
  const backend = useBackend();
  const ask = useContext(PromptContext);
  const print = useContext(PrintContext);
  const [target, setTarget] = useState<Target | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<Run<ProjectRenamed> | null>(null);
  useEffect(() => () => { void active.current?.cancel(); }, []);
  function open(root: Target): void { setTarget(root); setName(root.label); setError(null); }
  function close(): void { if (busy) return; setTarget(null); setError(null); }
  async function submit(): Promise<void> {
    if (!target || busy) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Type a name.'); return; }
    setBusy(true); setError(null);
    try {
      const run = backend.projects.rename({ path: target.id, name: trimmed }); active.current = run;
      const result = await driveRun(run, {}, ask, print);
      if (!result.ok) setError(result.error);
      else setTarget(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { active.current = null; setBusy(false); }
  }
  const dialog = target ? <WorkflowDialog title={`Rename ${target.label}`} body="The name this row shows in your Library. The folder on disk keeps its name, and nothing is shared." primary="Rename" command={`npx -y terum-skills@latest project rename ${target.root} --to ${name.trim() || '<name>'}`} close={close} submit={() => void submit()} busy={busy} error={error}>
    <WorkflowField aria-label="Project name" value={name} autoFocus disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit(); }} style={{ width: '100%' }}/>
  </WorkflowDialog> : null;
  return { open, dialog, busy };
}
