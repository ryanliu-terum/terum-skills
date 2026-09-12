import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';

function recorded(name:string){return readFileSync(resolve('../.planning/codex-runs/personal-library/frames',name+'.jsonl'),'utf8').trim().split('\n');}
const checkoutResult=JSON.parse(recorded('checkout-add').at(-1)!) as {value:{path:string;registered:boolean}};
const path=checkoutResult.value.path;
const home=path.slice(0,path.lastIndexOf('/repo/app'))+'/home';
function replay(name='ls-local') {
 const f=fakeBridge((args,emit)=>{
  // The re-recorded hello advertises `serve`, so the adapter probes for a shared read session. The
  // transport itself is covered by session.test.ts; here the probe answers without the feature so every
  // read stays a per-verb spawn and the recordings below are what the mirrors actually parse.
  if(args[0]==='serve') {emit({kind:'stdout',line:JSON.stringify({t:'hello',protocol:1,version:'0.14.0',verbs:[],features:{}})});return;}
  if(args[0]==='sync') {emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'sync',ok:true,exitCode:0,value:{changed:false,notices:[],teams:[]}})});return;}
  if(args[0]==='status') {emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'status',ok:true,exitCode:0,value:{version:'0.1.7',teams:[],identity:null,ledger:{placements:[],approvals:[],},tools:{git:true,gh:true}}})});return;}
  const file=args[0]==='checkout'?'checkout-'+args[1]:name;
  for(const line of recorded(file))emit({kind:'stdout',line});
 });
 f.bridge.homeDirectory=async()=>home;
 return {...f,backend:createTauriBackend(f.bridge)};
}
it('replays roots and authoritative skill-folder counts, including a name mismatch',async()=>{
 const {backend}=replay();const status=await backend.status();
 expect(status).toMatchObject({ok:true,value:{counts:{Global:'2'},roots:[{id:'global',kind:'global',root:'~/.claude/skills',count:'2'},{id:path,kind:'checkout',label:'app',root:path,registered:true,detected:false,count:'2',rootState:'scanned'}]}});
 const library=await backend.library({scope:{kind:'global'}});
 expect(library).toMatchObject({ok:true,value:{root:{id:'global',label:'Global',count:'2'},title:'2 skills',team:{kind:'none'},skills:[{name:'alpha',project:'Global',path:home+'/.claude/skills/alpha',flags:['local'],placed:false},{name:'beta',project:'Global',flags:['broken'],flagText:{broken:'Not connectable · SKILL.md name not-beta does not equal folder beta'}}]}});
 // Re-recorded from the B1 CLI (Ryan's ruling, 2026-09-11), so the capture now carries description and
 // characters and the Library shows both instead of degrading to a dash. Nothing is shared, so installs is 0.
 expect(library.value?.skills.every(s=>s.desc==='A fixture skill used by the desktop replay captures.'&&s.size!=='—'&&s.installs==='0 installs')).toBe(true);
 const checkout=await backend.library({scope:{kind:'checkout',root:path}});
 expect(checkout.value?.skills.map(s=>s.name)).toEqual(['delta','gamma']);
 expect(checkout.value?.skills.every(s=>!s.placed)).toBe(true);
});
it('replays the detected cwd root without implying registration or sharing',async()=>{
 const {backend}=replay('ls-local-detected'),status=await backend.status();
 expect(status.value?.roots[2]).toMatchObject({id:path.replace(/app$/,'other'),label:'other',registered:false,detected:true,count:'1'});
 const result=await backend.library({scope:{kind:'checkout',root:path.replace(/app$/,'other')}});
 expect(result.value?.skills).toMatchObject([{name:'epsilon',flags:['local'],placed:false}]);
});
it('replays an absent checkout with zero folders while retaining its registry identity',async()=>{
 const {backend}=replay('ls-local-missing');
 expect((await backend.status()).value?.roots[1]).toMatchObject({id:path,registered:true,rootState:'absent',count:'0'});
 expect(await backend.library({scope:{kind:'checkout',root:path}})).toMatchObject({ok:true,value:{root:{id:path,label:'app',rootState:'absent'},skills:[],title:'0 skills'}});
});
it('maps both checkout recordings, argv and config notifications',async()=>{
 const {backend,spawns}=replay(),notify=vi.fn();backend.subscribe(notify);
 expect(await backend.checkouts.add(path).done).toEqual({ok:true,value:{path,registered:true}});
 expect(await backend.checkouts.remove(path).done).toEqual({ok:true,value:{path,placementsRemaining:0}});
 expect(spawns.map(s=>s.args)).toEqual([['checkout','add','--',path],['sync'],['checkout','remove','--',path]]);
 expect(notify.mock.calls).toEqual([['config'],['config']]);
 expect(await backend.surfaces()).toMatchObject({checkouts:true});
});
it.each(['alpha','beta'])('serves the recorded %s local detail without fabricating markdown',async name=>{
 const {backend}=replay();const folder=home+'/.claude/skills/'+name;
 const detail=await backend.localSkill({path:folder+'/'});
 // The recorded frontmatter is shown verbatim; body and markdown stay empty because a local read never
 // renders a document the CLI did not send.
 const frontmatter=`---\nname: ${name==='beta'?'not-beta':name}\ndescription: A fixture skill used by the desktop replay captures.\n---`;
 expect(detail).toMatchObject({ok:true,value:{name,path:folder,pathLabel:'~/.claude/skills/'+name,team:null,skillRef:'local:'+folder,skillMd:{frontmatter,body:[],markdown:null},repo:null,installScopes:[]}});
 if(name==='beta')expect(detail.value?.flagText.broken).toContain('Not connectable');
});
it('reports only unknown folders as not-in-library and never enriches their team',async()=>{
 const {backend,spawns}=replay();
 expect(await backend.localSkill({path:'/missing/folder'})).toMatchObject({ok:false,reason:'not-in-library',error:expect.stringContaining('/missing/folder is not in any Library root')});
 expect(spawns.map(s=>s.args)).toEqual([['ls','--local'],['sync']]);
});
it('does not turn a local CLI failure into not-in-library',async()=>{
 const f=fakeBridge((args,emit)=>emit({kind:'stdout',line:JSON.stringify({t:'result',verb:args[0],ok:false,exitCode:1,error:'EACCES: scan denied'})}));
 expect(await createTauriBackend(f.bridge).localSkill({path:'/missing/folder'})).toEqual({ok:false,error:'EACCES: scan denied'});
});
