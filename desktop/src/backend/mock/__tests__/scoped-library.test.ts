import { afterEach, expect, it } from 'vitest';
import { createMockBackend } from '../index';
import { design } from '../fixture';
import { parseDesign } from '../../../fixtures/schema';

afterEach(()=>{location.hash='';});
it.each(['Global','Terum','SSM','MRF'] as const)('serves the exact %s title and overview',async scope=>{
 const result=await createMockBackend().library({scope:scope==='Global'?{kind:'global'}:{kind:'checkout',root:'/Users/you/code/'+scope.toLowerCase()}});
 expect(result.ok).toBe(true);
 expect(result.value?.title).toBe(design.DERIVED.libraryTitles[scope]);
 expect(result.value?.overview).toEqual(design.OVERVIEW_BY_SCOPE[scope]);
 expect(result.value?.skills).toHaveLength(Number(design.COUNTS[scope]));
 expect(result.value?.title).toBe(`${result.value?.skills.length} skills`);
 const status=await createMockBackend().status();const root=status.value?.roots.find(root=>root.label===scope);
 expect(root).toBeDefined();expect(result.value?.root).toEqual(root);
 const canonical=await createMockBackend().library({scope:root!.kind==='global'?{kind:'global'}:{kind:'checkout',root:root!.id}});
 expect(canonical).toEqual(result);
});
it.each(['unknown','toString','__proto__'])('rejects unknown checkout root %s',async root=>{
 const result=await createMockBackend().library({scope:{kind:'checkout',root}});
 expect(result).toEqual({ok:false,error:'No such checkout: '+root});
});
it('serves a zero library for the empty scenario',async()=>{
 location.hash='#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fterum&__mock=empty';
 const result=await createMockBackend().library({scope:{kind:'checkout',root:'/Users/you/code/terum'}});
 expect(result).toMatchObject({ok:true,value:{title:'0 skills',skills:[],overview:{skills:'0',evaluated:'—',installs:'0',attention:'0'}}});
});
it('serves the fixture eval k in Settings',async()=>{
 const result=await createMockBackend().settings();
 expect(result).toMatchObject({ok:true,value:{K:3}});
 expect(result.value?.K).toBe(design.K);
});
it('rejects a stale scoped overview at its field path',()=>{
 const stale=structuredClone(design);
 Reflect.deleteProperty(stale.OVERVIEW_BY_SCOPE.Terum,'skills');
 expect(()=>parseDesign(stale)).toThrow(/OVERVIEW_BY_SCOPE.Terum.skills/);
});
