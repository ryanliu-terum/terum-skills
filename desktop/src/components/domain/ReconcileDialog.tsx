import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { driveRun, PrintContext, PromptContext, useBackend } from '../../backend';
import type { ReconcileResult, Run } from '../../backend/types';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Dialog, DialogDescription, DialogTitle } from '../ui/Dialog';
import { WorkflowPopup } from './WorkflowPopup';
import { CliBox, PathText, Small } from './Primitives';
import { skillRootLabel } from '../../lib/path-text';
// The version vocabulary exists once (refactor spec §3.2): this dialog is prose, so it says "Version N", never `vN`.
import { recordedVersionLabel as versionLabel } from '../../../../src/lib/versions.js';

type SelectionKey = `adopt:${string}` | `publish:${string}`;
interface RowOutcome { key: SelectionKey; text: string; ok: boolean }

function defaults(result: ReconcileResult): Set<SelectionKey> {
  return new Set<SelectionKey>([
    ...result.identical.map((row) => `adopt:${row.path}` as const),
    ...result.differing.filter((row) => row.sameId).map((row) => `publish:${row.path}` as const),
  ]);
}

/** A single explicit batch coordinator: rows remain independent and report their own outcome. */
export function ReconcileDialog({ result, title = 'Your skills', onClose, onFinished }: { result: ReconcileResult; title?: string; onClose: () => void; onFinished?: () => void }) {
  const backend = useBackend();
  const ask = useContext(PromptContext);
  const print = useContext(PrintContext);
  const [selected, setSelected] = useState(() => defaults(result));
  const [outcomes, setOutcomes] = useState<RowOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const active = useRef<Run<unknown> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void active.current?.cancel(); };
  }, []);

  const setChecked = (key: SelectionKey, checked: boolean): void => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(key); else next.delete(key);
    return next;
  });
  const record = (outcome: RowOutcome): void => { if (mounted.current) setOutcomes((current) => [...current, outcome]); };

  async function drive<T>(key: SelectionKey, label: string, operation: () => Run<T>): Promise<void> {
    try {
      const run = operation(); active.current = run as Run<unknown>;
      const result = await driveRun(run, {}, ask, print);
      record(result.ok ? { key, text: label, ok: true } : { key, text: `${label}: ${result.error}`, ok: false });
    } catch (error) {
      record({ key, text: `${label}: ${error instanceof Error ? error.message : String(error)}`, ok: false });
    } finally { active.current = null; }
  }

  async function confirm(): Promise<void> {
    if (busy || finished) return;
    setBusy(true); setOutcomes([]);
    // Leaving the screen ends the batch: cleanup cancels the run in flight, and no further row is launched.
    for (const row of result.identical) {
      if (!mounted.current) return;
      const key = `adopt:${row.path}` as const;
      if (selected.has(key)) await drive(key, `Recorded ${row.name}.`, () => backend.install({ team: row.team, adopt: row.path }));
    }
    for (const row of result.differing) {
      if (!mounted.current) return;
      const key = `publish:${row.path}` as const;
      if (selected.has(key)) await drive(key, `Published ${row.name}.`, () => backend.publish({ team: row.team, ref: row.path }));
    }
    if (mounted.current) { setBusy(false); setFinished(true); onFinished?.(); }
  }

  const group = (heading: string, children: ReactNode) => <section style={{display:'flex',flexDirection:'column',gap:8}}><strong style={{fontSize:12}}>{heading}</strong>{children}</section>;
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><WorkflowPopup style={{width:560,maxHeight:'calc(100vh - 32px)',overflowY:'auto'}}>
    <DialogTitle>{title}</DialogTitle>
    <DialogDescription>Choose which existing folders to record or publish. No folder is copied or replaced.</DialogDescription>
    {result.identical.length ? group('Matches the team exactly', result.identical.map((row) => {
      const key = `adopt:${row.path}` as const;
      return <Checkbox key={key} checked={selected.has(key)} disabled={busy||finished} onCheckedChange={(checked) => setChecked(key, checked === true)} label={<span className="reconcile-row"><span><b>{row.name}</b> <Small>· {skillRootLabel(row.path)}</Small> · Record as installed ({versionLabel(row.version)})</span><PathText path={row.path}/></span>}/>;
    })) : null}
    {result.differing.length ? group('Shares a name but differs', result.differing.map((row) => {
      const key = `publish:${row.path}` as const, checked = selected.has(key);
      // UI policy §2 and §6: the root label tells two same-named folders apart, the path is a PathText, and the rename hint is said ONCE under the group, not under every unchecked row.
      return <Checkbox key={key} checked={checked} disabled={busy||finished} onCheckedChange={(value) => setChecked(key,value===true)} label={<span className="reconcile-row"><span><b>{row.name}</b> <Small>· {skillRootLabel(row.path)}</Small> · Publish as {versionLabel(row.nextVersion)}</span><PathText path={row.path}/></span>}/>;
    })) : null}
    {result.differing.some((row) => !selected.has(`publish:${row.path}`)) ? <div className="reconcile-footnote"><Small>Unchecked folders stay as they are. To keep one separate from the team’s copy, rename it first:</Small><CliBox command="npx -y terum-skills@latest skill rename &lt;path&gt; --to &lt;new-name&gt;"/></div> : null}
    {result.renamed.length ? group('Same bytes, different name', result.renamed.map((row) => <span key={`${row.team}:${row.path}`} className="reconcile-row"><Small><b>{row.name}</b> · {skillRootLabel(row.path)} · holds the bytes of {row.teamName} {versionLabel(row.version)} under a different folder name; nothing is offered for it.</Small><PathText path={row.path}/></span>)) : null}
    {outcomes.length ? <div role="log" aria-live="polite" style={{display:'flex',flexDirection:'column',gap:4}}>{outcomes.map((outcome) => <div key={outcome.key} style={{fontSize:12,color:`var(--tk-${outcome.ok?'good':'bad'})`}}>{outcome.text}</div>)}</div> : null}
    {!result.identical.length&&!result.differing.length ? <Small>Nothing to reconcile.</Small> : null}
    <div style={{display:'flex',justifyContent:'flex-end',gap:8}}><Button onClick={onClose} disabled={busy}>{finished?'Done':'Cancel'}</Button>{!finished?<Button kind="primary" onClick={() => void confirm()} disabled={busy||selected.size===0}>{busy?'Working…':'Confirm'}</Button>:null}</div>
  </WorkflowPopup></Dialog>;
}
