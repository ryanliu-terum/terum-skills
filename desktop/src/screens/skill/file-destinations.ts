import type { Root, SkillDetail } from '../../backend/types';

/** Where a move or a copy can land: every Library root except the one this folder already sits in —
 *  the CLI refuses that one outright ("The source and destination are the same folder."), so offering
 *  it is offering an error. There is no "Choose destination" row either; the picker opens on the first
 *  of these (Ryan, 2026-09-14). Matched by id, never by a path prefix: `owningRoot` spells the global
 *  root 'Global' where `Root.id` spells it 'global' (tauri/index.ts `owningRootOf`), and a prefix test
 *  is POSIX-only. A folder under no known root filters nothing out and is offered every root. */
export function fileDestinations(roots:readonly Root[],owningRoot:SkillDetail['owningRoot']):{id:string;value:string;label:string}[] {
 return roots.filter(root=>root.kind==='global'?owningRoot?.id!=='Global':root.id!==owningRoot?.id)
  .map(root=>({id:root.id,value:root.kind==='global'?'global':root.root,label:root.label}));
}
