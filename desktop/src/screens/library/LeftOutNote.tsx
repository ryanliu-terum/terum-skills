import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { useContextMenuFor, useCopy, useCopyMenu } from '../../components/domain/context-menu';
import { groupLeftOut, leftOutText } from './bulk-eval-handoff';

/**
 * The selection bar's "left out of the eval" note (UI policy §6, 2026-09-14: the one-line version was a wall of
 * text). Collapsed, it is one sentence with a count and "Show why"; expanded, the folders group under their shared
 * reason, each name a chip that carries its full reason on hover and copies it on right-click. The whole note copies
 * as the old one line on right-click, so nothing the CLI said is lost.
 */
export function LeftOutNote({ leftOut, selected }: { leftOut: readonly { name: string; reason: string }[]; selected: number }) {
  const [open, setOpen] = useState(false), copy = useCopy();
  const text = leftOutText(leftOut) ?? '', menu = useCopyMenu(() => text, 'note');
  const rowMenu = useContextMenuFor<{ name: string; reason: string }>(row => [{ key: 'copy', label: 'Copy reason', icon: 'copy', onSelect: () => void copy(`${row.name}: ${row.reason}`, 'reason') }]);
  if (leftOut.length === 0) return null;
  const groups = groupLeftOut(leftOut);
  return <div role="note" className="library-selection-note" ref={menu} data-open={open || undefined}>
    <div className="left-out-summary"><span>{leftOut.length} of {selected} selected {selected === 1 ? 'skill' : 'skills'} {leftOut.length === 1 ? 'is' : 'are'} left out of the eval — {groups.length === 1 ? groups[0]!.heading : `${groups.length} reasons`}.</span><button type="button" className="collapsible-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show why'}</button></div>
    {open ? <div className="left-out-groups">{groups.map(group => <div key={group.heading} className="left-out-group"><span className="left-out-heading">{group.heading}</span><div className="left-out-names">{group.rows.map(row => <span key={row.name} ref={rowMenu(row)}><Chip title={row.reason}>{row.name}</Chip></span>)}</div></div>)}<div className="advice-actions"><Button kind="ghost" icon="copy" onClick={() => void copy(text, 'note')}>Copy all</Button></div></div> : null}
  </div>;
}
