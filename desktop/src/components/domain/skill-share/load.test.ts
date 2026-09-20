import { describe, expect, it, vi } from 'vitest';
import { createMockBackend } from '../../../backend/mock';
import { loadSharePng } from './load';
import { renderShareCard } from './render';
vi.mock('./render',()=>({renderShareCard:vi.fn(async()=>new Blob(['png'],{type:'image/png'}))}));
describe('share source identity',()=>{
 it('loads same-named folders by exact path and renders their own description, author and receipt',async()=>{
  const backend=createMockBackend();
  const result=await backend.skill({ref:'deploy-check'});if(!result.ok)throw new Error(result.error);
  const signal=new AbortController().signal;
  for(const [index,path] of ['/projects/one/deploy-check','/projects/two/deploy-check'].entries()){
   const detail={...result.value,path,desc:`Description ${index}`,author:{...result.value.author,name:`Author ${index}`,handle:`owner${index}`},receipt:{...result.value.receipt!,case_runs:{candidate:{passed:index+1,total:8},baseline:{passed:1,total:8}},eff:{...result.value.receipt!.eff,candidate:['0',`${index+12} s`,`$${index+2}.00`]}}};
   const local=vi.spyOn(backend,'localSkill').mockResolvedValue({ok:true,value:detail});
   await loadSharePng(backend,{...result.value,teamed:false,path,desc:'Stale card description'},undefined,signal,'dark');
   expect(local).toHaveBeenLastCalledWith({path},{signal});
   expect(renderShareCard).toHaveBeenLastCalledWith(expect.objectContaining({description:`Description ${index}`,author:`Author ${index} · @owner${index}`,candidate:{passed:index+1,total:8},metrics:[{label:'Cost / run',unit:'cost',candidate:index+2,baseline:.51},{label:'Time / run',unit:'time',candidate:index+12,baseline:53}]}),{format:'dark'});
  }
 });
 it('preserves the selected team reference and library scope',async()=>{
  const backend=createMockBackend(),result=await backend.skill({ref:'deploy-check'});if(!result.ok)throw new Error(result.error);
  const read=vi.spyOn(backend,'skill').mockResolvedValue(result),signal=new AbortController().signal,scope={kind:'checkout' as const,root:'/projects/selected'};
  await loadSharePng(backend,{...result.value,teamed:true,skillRef:'selected-team/deploy-check'},scope,signal);
  expect(read).toHaveBeenLastCalledWith({ref:'selected-team/deploy-check',at:scope},{signal});
 });
 it('rejects missing paths, failed reads and cancelled requests without rendering',async()=>{
  const backend=createMockBackend(),result=await backend.skill({ref:'deploy-check'});if(!result.ok)throw new Error(result.error);
  vi.mocked(renderShareCard).mockClear();const controller=new AbortController();
  await expect(loadSharePng(backend,{...result.value,teamed:false,path:null},undefined,controller.signal)).rejects.toThrow('source path');
  vi.spyOn(backend,'skill').mockResolvedValue({ok:false,error:'Receipt read failed'});
  await expect(loadSharePng(backend,{...result.value,teamed:true},undefined,controller.signal)).rejects.toThrow('Receipt read failed');
  controller.abort();await expect(loadSharePng(backend,result.value,undefined,controller.signal)).rejects.toThrow('Cancelled');
  expect(renderShareCard).not.toHaveBeenCalled();
 });
});
