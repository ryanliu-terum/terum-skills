import { useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { affects } from '../../app/invalidation';
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
import { PublishOptions } from '../skill/PublishOptions';
import { GLOBAL_LIST, TARGET_ASK, publishFlags, usePublishDefaults } from '../skill/publish-defaults';

/**
 * Bulk "Publish to team" for the Library's selection mode (`?select=1&dialog=publish`, batch E 2026-09-13).
 * The CLI's `publish <ref>` takes ONE ref and every publish commits to the team clone under a writer lock, so
 * the rows run strictly one after another, never `Promise.all`; a failed row is reported with the CLI's own
 * sentence and the queue continues, a cancelled row stops the queue, and the finished rows keep their outcome.
 */
export function BulkPublishDialog({ cards, onClose, onFinished }: { cards: readonly SkillCard[]; onClose: () => void; onFinished: (summary: BulkPublishSummary) => void }) {
  const backend = useBackend(), print = useContext(PrintContext), unexpected = useContext(PromptContext), client = useQueryClient();
  const [rows, setRows] = useState<BulkRow[]>(() => cards.map(card => {
    const reason = localActionReason(card, 'publish');
    return { key: card.path ?? card.name, card, state: reason === null ? { kind: 'ready' } : { kind: 'skipped', reason } };
  }));
  const [phase, setPhase] = useState<'idle' | 'running' | 'finished'>('idle');
  // Settings ▸ Publishing ▸ Defaults: the target applies to every row; categories stay per skill (the model's, or SKILL.md's).
  const defaults = usePublishDefaults(), [targetChoice, setTargetChoice] = useState<string | null>(null);
  const target = targetChoice ?? (defaults.target === TARGET_ASK ? GLOBAL_LIST : defaults.target), flags = publishFlags(target, null);
  const [summary, setSummary] = useState<BulkPublishSummary | null>(null);
  // `busy` is a ref, not state, so two clicks in one frame cannot start two queues (the clone is write-locked).
  const busy = useRef(false), stop = useRef(false), activeRun = useRef<Run<PublishResult> | null>(null), mounted = useRef(true), landed = useRef(0);
  // The setup re-arms `mounted`: StrictMode replays mount effects as setup → cleanup → setup, and a cleanup-only effect
  // would leave the flag false for the dialog's whole life (every setRow a no-op, the queue never reaching 'finished').
  // The cleanup cancels whatever is in flight and, when a version already landed, refetches every clone-backed read —
  // leaving mid-queue (Back, a second Cancel) must not strand the Library on a stale inventory.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; stop.current = true;
      const run = activeRun.current; activeRun.current = null; void run?.cancel();
      if (landed.current > 0) void client.invalidateQueries({ predicate: query => affects('clone', query.queryKey) });
    };
  }, [client]);

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
        const run = backend.publish({ ref: localRef(row.card), ...flags });
        activeRun.current = run;
        result = await driveRun<PublishResult>(run, {}, unexpected, print, frame => setRow(row.key, { kind: 'publishing', label: frame.label ?? null }));
      } catch (error) {
        // driveRun already cancels the run on a throw; the row reports the message and the queue goes on.
        result = { ok: false, error: error instanceof Error ? error.message : 'Publish failed.' };
      }
      activeRun.current = null;
      if (!mounted.current) return;
      if (!result.ok) {
        if (result.value !== undefined) {
          // The verb finished before the cancel landed: the adapter says so and carries the result, so the version IS
          // on disk. The row reports the publish and the CLI's own sentence, and the queue stops as the person asked.
          published += 1; landed.current = published;
          setRow(row.key, { kind: 'done', text: `${publishOutcomeText(row.card.name, result.value)} ${result.error}` });
          stop.current = true; continue;
        }
        // A cancellation is one driveRun reports (`cancelled`: a declined question) or the one this dialog asked for —
        // both adapters settle a requested cancel as exactly 'Cancelled.'. Any other sentence after Cancel is still the
        // CLI's own failure and is shown verbatim (COMMON §6); the queue stops either way once Cancel was pressed.
        if (result.cancelled || (stop.current && result.error === 'Cancelled.')) { setRow(row.key, { kind: 'cancelled' }); stop.current = true; continue; }
        failed += 1; setRow(row.key, { kind: 'failed', error: result.error }); continue;
      }
      published += 1; landed.current = published; setRow(row.key, { kind: 'done', text: publishOutcomeText(row.card.name, result.value) });
    }
    busy.current = false;
    setSummary({ published, attempted: ready.length, failed });
    setPhase('finished');
  }

  function cancel() {
    if (phase !== 'running') { onClose(); return; }
    // A second Cancel while the stopped run has not settled (a CLI child that hangs) leaves the dialog; the unmount
    // cleanup cancels the run once more and refetches, so nothing keeps working unseen.
    if (stop.current) { onClose(); return; }
    // Stops the queue: the active run ends 'Cancelled.', the rows after it read Not started, finished rows keep their outcome.
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
      {empty ? null : <PublishOptions bulk defaults={defaults} target={target} onTarget={setTargetChoice} category="" onCategory={() => {}} />}
      {empty ? null : <div className="bulk-publish-rows" role="list" aria-label="Skills to publish">
        {rows.map(row => <div key={row.key} role="listitem" className="bulk-publish-row" data-testid={'bulk-row-' + row.card.name}>
          <span>{row.card.name}</span>
          <span data-state={row.state.kind} {...(row.state.kind === 'publishing' ? { role: 'status' } : {})}>{rowText(row.state)}</span>
        </div>)}
      </div>}
      {first !== undefined ? <>
        <TerminalHint command={`npx -y terum-skills@latest publish ${first.card.name}${flags.project ? ` --project ${flags.project}` : ''}`} />
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
