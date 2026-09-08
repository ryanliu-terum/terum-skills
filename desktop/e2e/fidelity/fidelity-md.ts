import { readFileSync, existsSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
export type FidelityStatus='todo'|'in-progress'|'locked';
export function readFidelity(path='FIDELITY.md'):Map<string,FidelityStatus>{
 const result=new Map<string,FidelityStatus>();
 for(const line of readFileSync(path,'utf8').split(/\r?\n/)){
  if(!line.trim().startsWith('|'))continue;
  const cells=line.split('|').slice(1,-1).map(s=>s.trim());
  const [name,route,status]=cells;
  if(!name||!route?.replaceAll('`','').startsWith('#/'))continue;
  if(status!=='todo'&&status!=='in-progress'&&status!=='locked')throw new Error(`Malformed fidelity status for ${name}: ${status}`);
  if(result.has(name))throw new Error('Duplicate fidelity board: '+name);
  result.set(name,status);
 }
 return result;
}
// Per-board files isolate workers. Only the teardown writes the aggregate report.
export default function assembleReport():void {
 const dir='e2e/out/fidelity/rows';if(!existsSync(dir))return;
 const rows=readdirSync(dir).filter(f=>f.endsWith('.json')).sort().map(f=>JSON.parse(readFileSync(join(dir,f),'utf8')) as unknown);
 const target='e2e/out/fidelity/report.json';const content=JSON.stringify(rows,null,2)+'\n';
 writeFileSync(target+'.tmp',content);if(readFileSync(target+'.tmp','utf8')!==content)throw new Error('Fidelity report write verification failed.');renameSync(target+'.tmp',target);
}
