import type { LocalSettings } from '../../backend/types';
import { PlacementTable } from './PlacementTable';
import { SettingsHead as Head, SettingsGroup as Group, SettingsNote as Note, SettingCard as Card, SettingRow as Row, Value } from './SettingsParts';
import { ErrorLine } from '../../components/domain/Primitives';

export function LocalSettingsContent({ data, section }: { data: LocalSettings; section: string }) {
  return <>{section === 'sharing' ? <><Head title="Sharing" sub="The skills you author on this machine, and how they reach the team."/><Group label="Shared from this machine"><Card>{data.SHARED.map(row=><Row key={`${row.path}:${row.team}:${row.id}`} title={row.name} desc={`${row.path} · ${row.team}`}><Value quiet>{row.state}</Value></Row>)}</Card></Group></> : <><Head title="This machine" sub="What Terum put on this laptop, and what it will ask you again for on the next one."/><Group label="Placed here" note={<Note>The provenance ledger: the only paths Terum may ever touch. Tracked copies follow the team at sync; a pinned one stays until you install again.</Note>}><PlacementTable rows={data.PLACEMENTS} footer={<>— placed · — global · — pinned</>}/></Group></>}{data.problems.map((problem,index)=><ErrorLine key={`${problem.path}:${index}`}>{problem.path}: {problem.reason}</ErrorLine>)}</>;
}
