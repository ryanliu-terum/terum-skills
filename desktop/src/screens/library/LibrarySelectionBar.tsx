import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { plural } from '../marketplace/market-data';

/**
 * The strip between the search row and the grid while the Library is in selection mode (`?select=1`).
 * Deliberately dumb: it draws counts and buttons, the screen owns the selected set. `children` renders
 * after the Publish button so a later bulk action (the app-wide bulk-eval dialog's "Evaluate N…") can be
 * appended without touching the screen (batch E, 2026-09-13).
 */
export function LibrarySelectionBar({ selected, drawn, onSelectAll, onClear, onPublish, children }: { selected: number; drawn: number; onSelectAll: () => void; onClear: () => void; onPublish: () => void; children?: ReactNode }) {
  return <div className="library-selection-bar" role="toolbar" aria-label="Selection">
    <span className="library-selection-count" role="status">{selected} of {drawn} selected</span>
    <Button kind="ghost" onClick={onSelectAll} disabled={drawn === 0 || selected === drawn}>Select all</Button>
    <Button kind="ghost" onClick={onClear} disabled={selected === 0}>Clear</Button>
    <Button kind="primary" onClick={onPublish} disabled={selected === 0}>{selected === 0 ? 'Publish to team…' : `Publish ${plural(selected, 'skill')} to team…`}</Button>
    {children}
  </div>;
}
