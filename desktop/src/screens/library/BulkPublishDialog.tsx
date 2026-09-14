import { useContext, useEffect, useRef, useState } from 'react';
import type { PublishResult, Result, Run, SkillCard } from '../../backend/types';
import { driveRun, PrintContext, PromptContext, useBackend } from '../../backend';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '../../components/ui/Dialog';
import { Small, TerminalHint } from '../../components/domain/Primitives';
import { localActionReason, localRef } from '../../components/domain/skill-card-actions';
import { publishOutcomeText } from '../skill/publish-outcome';
import { plural } from '../marketplace/market-data';
import { rowText } from './bulk-publish';
import type { BulkPublishSummary, BulkRow, BulkRowState } from './bulk-publish';

/**
 * Bulk "Publish to team" for the Library's selection mode (`?select=1&dialog=publish`, batch E 2026-09-13).
 * The CLI's `publish <ref>` takes ONE ref and every publish commits to the team clone under a writer lock, so
 * the rows run strictly one after another, never `Promise.all`; a failed row is reported with the CLI's own
 * sentence and the queue continues, a cancelled row stops the queue, and the finished rows keep their outcome.
 */
export function BulkPublishDialog({ cards, onClose, onFinished }: { cards: readonly SkillCard[]; onClose: () => void; onFinished: (summary: BulkPublishSummary) => void }) {
  const backend = useBackend(), print = useContext(PrintContext), unexpected = useContext(PromptContext);
  const [rows, setRows] = useState<BulkRow[]>(() => cards.map(card => {
    const reason = localActionReason(card, 'publish');
    return { key: card.path ?? card.name, card, state: reason === null ? { kind: 'ready' } : { kind: 'skipped', reason } };
  }));
  const [phase, setPhase] = useState<'idle' | 'running' | 'finished'>('idle');
  const [summary, setSummary] = useState<BulkPublishSummary | null>(null);
  // `busy` is a ref, not state, so two clicks in one frame cannot start two queues (the clone is write-locked).
  const busy = useRef(false), stop = useRef(false), activeRun = useRef<Run<PublishResult> | null>(null), mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; stop.current = true; const run = activeRun.current; activeRun.current = null; void run?.cancel(); }, []);

  const ready = rows.filter(row => row.state.kind === 'ready');
  // Everything that was ever sendable — stable while the queue runs, so the label and the hint do not count down.
  const sendable = rows.filter(row => row.state.kind !== 'skipped');
  const setRow = (key: string, state: BulkRowState) => { if (mounted.current) setRows(current => current.map(row => row.key === key ? { ...row, state } : row)); };

  async function publishAll() {
    if (busy.current || ready.length === 0) return;
    busy.current = true; stop.current = false; setPhase('running');
    setRows(current => current.map(row => row.state.kind === 'ready' ? { ...row, state: { kind: 'queued' } } : row));
    let published = 0, failed = 0;
    for (const row of ready) {
      if (stop.current) { setRow(row.key, { kind: 'not-started' }); continue; }
      setRow(row.key, { kind: 'publishing', label: null });
      let result: Result<PublishResult>;
      try {
        const run = backend.publish({ ref: localRef(row.card) });
        activeRun.current = run;
        result = await driveRun<PublishResult>(run, {}, unexpected, print, frame => setRow(row.key, { kind: 'publishing', label: frame.label ?? null }));
      } catch (error) {
        // driveRun already cancels the run on a throw; the row reports the message and the queue goes on.
        result = { ok: false, error: error instanceof Error ? error.message : 'Publish failed.' };
      }
      activeRun.current = null;
      if (!mounted.current) return;
      if (!result.ok) {
        // A run we asked to cancel ends `ok:false`; the mock's Run.cancel carries no `cancelled` flag, so the
        // request itself (`stop`) is the evidence — a failure after Cancel is the cancellation, not a CLI error.
        if (result.cancelled || stop.current) { setRow(row.key, { kind: 'cancelled' }); stop.current = true; continue; }
        failed += 1; setRow(row.key, { kind: 'failed', error: result.error }); continue;
      }
      published += 1; setRow(row.key, { kind: 'done', text: publishOutcomeText(row.card.name, result.value) });
    }
    busy.current = false;
    setSummary({ published, attempted: ready.length, failed });
    setPhase('finished');
  }

  function cancel() {
    if (phase !== 'running') { onClose(); return; }
    // Stops the queue: the active run ends `cancelled`, the rows after it read Not started, finished rows keep their outcome.
    stop.current = true;
    void activeRun.current?.cancel();
  }

  const empty = cards.length === 0;
  const first = sendable[0];
  return <Dialog open onOpenChange={(open, details) => {
    if (open) return;
    // Outside-press and focus-out are refused while the queue runs — the same guard as the skill page's dialogs.
    if (phase === 'running' && (details.reason === 'outside-press' || details.reason === 'focus-out')) { details.cancel(); return; }
    if (phase === 'running') { cancel(); return; }
    if (phase === 'finished' && summary !== null) { onFinished(summary); return; }
    onClose();
  }}>
    <DialogPopup aria-busy={phase === 'running'} data-testid="bulk-publish-dialog">
      <DialogTitle>{empty ? 'No skills selected.' : `Publish ${plural(cards.length, 'skill')} to the team?`}</DialogTitle>
      <DialogDescription>{empty ? 'Select skills in the Library first, then publish them together.' : 'Copies each folder into the team repository as its next immutable version, so teammates can install it. Existing versions are never changed; identical bytes mint nothing. Skills run one at a time.'}</DialogDescription>
      {empty ? null : <div className="bulk-publish-rows" role="list" aria-label="Skills to publish">
        {rows.map(row => <div key={row.key} role="listitem" className="bulk-publish-row" data-testid={'bulk-row-' + row.card.name}>
          <span>{row.card.name}</span>
          <span data-state={row.state.kind} {...(row.state.kind === 'publishing' ? { role: 'status' } : {})}>{rowText(row.state)}</span>
        </div>)}
      </div>}
      {first !== undefined ? <>
        <TerminalHint command={`npx -y terum-skills@latest publish ${first.card.name}`} />
        {sendable.length > 1 ? <Small>… and {plural(sendable.length - 1, 'more skill')} the same way, one after another.</Small> : null}
      </> : null}
      {summary !== null ? <div role="status" className="skill-dialog-progress">Published {summary.published} of {plural(summary.attempted, 'skill')}{summary.failed > 0 ? ` · ${summary.failed} failed` : ''}</div> : null}
      <div className="bulk-publish-actions">
        {phase === 'finished' ? null : <Button onClick={cancel}>Cancel</Button>}
        {phase === 'finished' && summary !== null
          ? <Button kind="primary" onClick={() => onFinished(summary)}>Done</Button>
          : empty ? null : <Button kind="primary" disabled={phase === 'running' || ready.length === 0} onClick={() => void publishAll()}>{`Publish ${plural(sendable.length, 'skill')}`}</Button>}
      </div>
    </DialogPopup>
  </Dialog>;
}
