import type { PublishRunState } from '../../app/publish-run-context';
import { rowText } from '../../screens/library/bulk-publish';
import { plural } from '../../screens/marketplace/market-data';
import { WorkflowDialog } from './WorkflowControls';
import './PublishRunDialog.css';

/** The streaming publish board. Escape and outside press only dismiss it; Stop is the cancellation gesture. */
export function PublishRunDialog({ current, onClose, onStop }: { current: PublishRunState; onClose: () => void; onStop: () => void }) {
 const first = current.rows.find(row => row.state.kind !== 'skipped');
 const command = first === undefined ? '' : `npx -y terum-skills@latest publish ${first.card.name}${current.flags.project ? ` --project ${current.flags.project}` : ''}`;
 const busy = current.state === 'running' || current.state === 'stopping';
 // D2: the first Stop asks the CLI to stop; the line says so, and names the second press for what it is — the app stops waiting, the child may not.
 const status = current.state === 'stopping' ? 'Stopping… press Stop again to stop waiting' : current.summary === undefined ? null : `Published ${current.summary.published} of ${plural(current.summary.attempted, 'skill')}${current.summary.failed > 0 ? ` · ${current.summary.failed} failed` : ''}`;
 return <WorkflowDialog title={`Publish ${plural(current.rows.length, 'skill')} to the team?`} body="Copies each folder into the team repository as its next immutable version, so teammates can install it. Existing versions are never changed; identical bytes mint nothing. Skills run one at a time." command={command} primary={null} close={onClose} submit={() => {}} busy={busy} onStop={onStop} dismissKeepsRunning status={status} closeLabel="Close">
  <div className="bulk-publish-rows" role="list" aria-label="Skills to publish">
   {current.rows.map(row => <div key={row.key} role="listitem" className="bulk-publish-row" data-testid={'bulk-row-' + row.card.name}>
    <span>{row.card.name}</span><span data-state={row.state.kind} {...(row.state.kind === 'publishing' ? { role: 'status' } : {})}>{rowText(row.state)}</span>
   </div>)}
  </div>
  {current.rows.filter(row => row.state.kind !== 'skipped').length > 1 ? <span className="bulk-publish-hint">… and {plural(current.rows.filter(row => row.state.kind !== 'skipped').length - 1, 'more skill')} the same way, one after another.</span> : null}
 </WorkflowDialog>;
}
