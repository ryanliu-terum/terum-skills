import type { ReactNode } from 'react';
import type { PlacementRow } from '../../backend/types';

export function PlacementTable({ rows, footer }: { rows: readonly PlacementRow[]; footer: ReactNode }) {
  return <div className="placement-table" role="table" aria-label="Placed here"><div className="placement-head" role="row">{['Path','Scope','Version','Placed','State'].map(text=><span role="columnheader" key={text}>{text}</span>)}</div>{rows.map((row,index)=><div role="row" className="placement-row" data-testid={'placement-row-'+index} key={row.path}><span role="cell" title={row.team ? `${row.name} · ${row.team}` : row.name}>{row.path}</span><span role="cell">{row.scope}</span><span role="cell" className="board-mono" style={{color:row.version?'var(--tk-text1)':'var(--tk-text3)'}}>{row.version??'tracking'}</span><span role="cell">{row.placed}</span><span role="cell">{row.state}</span></div>)}<div className="placement-footer">{footer}</div></div>;
}
