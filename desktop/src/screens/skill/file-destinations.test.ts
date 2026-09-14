import { expect, it } from 'vitest';
import { fileDestinations } from './file-destinations';
import type { Root } from '../../backend/types';

const root=(id:string,kind:Root['kind'],label:string,path:string):Root=>({id,kind,label,root:path,registered:kind==='checkout'});
const ROOTS:Root[]=[root('global','global','Global','~/.claude/skills'),root('/code/ssm','checkout','SSM','/code/ssm'),root('/code/mrf','checkout','MRF','/code/mrf')];

// `owningRoot` spells the global root 'Global' and `Root.id` spells it 'global' (tauri/index.ts
// owningRootOf): a naive id===id comparison keeps Global in its own list and offers a move the CLI
// refuses as the same folder.
it('drops the root the folder sits in, global spelled either way, and keeps the rest in order',()=>{
 expect(fileDestinations(ROOTS,{id:'Global',label:'Global'}).map(d=>d.label)).toEqual(['SSM','MRF']);
 expect(fileDestinations(ROOTS,{id:'/code/ssm',label:'SSM'}).map(d=>d.label)).toEqual(['Global','MRF']);
});
it('sends global as the CLI keyword and a checkout as its root path',()=>{
 expect(fileDestinations(ROOTS,{id:'/code/ssm',label:'SSM'}).map(d=>d.value)).toEqual(['global','/code/mrf']);
});
it('offers every root to a folder under none, and none when the only root is the folder’s own',()=>{
 expect(fileDestinations(ROOTS,null)).toHaveLength(3);
 expect(fileDestinations([ROOTS[0]!],{id:'Global',label:'Global'})).toEqual([]);
});
