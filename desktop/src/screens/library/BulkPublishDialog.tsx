import { useState } from 'react';
import { usePublishRun } from '../../app/publish-run-context';
import type { SkillCard } from '../../backend/types';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from '../../components/ui/Dialog';
import { Small, TerminalHint } from '../../components/domain/Primitives';
import { localActionReason } from '../../components/domain/skill-card-actions';
import { plural } from '../marketplace/market-data';
import { PublishOptions } from '../skill/PublishOptions';
import { publishFlags, usePublishDefaults } from '../skill/publish-defaults';
import { rowText } from './bulk-publish';

/** The Library's publish question. The app-level host owns streaming, cancellation, and outcomes. */
export function BulkPublishDialog({ cards, scope, onClose }: { cards: readonly SkillCard[]; /** The Library scope that asked, so the run is reported there and nowhere else. */ scope: string; onClose: () => void }) {
 const publishRun = usePublishRun(), defaults = usePublishDefaults(), [targetChoice, setTargetChoice] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
 const target = targetChoice ?? defaults.target, flags = publishFlags(target, null);
 const rows = cards.map(card => {
  const reason = localActionReason(card, 'publish');
  return { card, state: reason === null ? { kind: 'ready' as const } : { kind: 'skipped' as const, reason } };
 });
 const ready = rows.filter(row => row.state.kind === 'ready'), empty = cards.length === 0, first = ready[0];
 function start() {
  try { publishRun.start({ cards, flags, origin: 'library', scope }); onClose(); }
  catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
 }
 return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogPopup aria-busy={false} data-testid="bulk-publish-dialog">
  <DialogTitle>{empty ? 'No skills selected.' : `Publish ${plural(cards.length, 'skill')} to the team?`}</DialogTitle>
  <DialogDescription>{empty ? 'Select skills in the Library first, then publish them together.' : 'Copies each folder into the team repository as its next immutable version, so teammates can install it. Existing versions are never changed; identical bytes mint nothing. Skills run one at a time.'}</DialogDescription>
  {empty ? null : <PublishOptions bulk defaults={defaults} target={target} onTarget={setTargetChoice} category="" onCategory={() => {}} />}
  {empty ? null : <div className="bulk-publish-rows" role="list" aria-label="Skills to publish">{rows.map(row => <div key={row.card.path ?? row.card.name} role="listitem" className="bulk-publish-row" data-testid={'bulk-row-' + row.card.name}><span>{row.card.name}</span><span data-state={row.state.kind}>{rowText(row.state)}</span></div>)}</div>}
  {first === undefined ? null : <><TerminalHint command={`npx -y terum-skills@latest publish ${first.card.name}${flags.project ? ` --project ${flags.project}` : ''}`} />{ready.length > 1 ? <Small>… and {plural(ready.length - 1, 'more skill')} the same way, one after another.</Small> : null}</>}
  {error ? <div role="alert">{error}</div> : null}
  <div className="bulk-publish-actions"><Button onClick={onClose}>{empty ? 'Close' : 'Cancel'}</Button>{empty ? null : <Button kind="primary" disabled={ready.length === 0} onClick={start}>{`Publish ${plural(ready.length, 'skill')}`}</Button>}</div>
 </DialogPopup></Dialog>;
}
