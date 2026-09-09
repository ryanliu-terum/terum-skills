import { afterEach, expect, it } from 'vitest';
import { createMockBackend } from '../index';
import { design } from '../fixture';
import { parseDesign } from '../../../fixtures/schema';

afterEach(()=>{location.hash='';});
it.each(['Global','Terum','SSM','MRF'] as const)('serves the exact %s title and overview',async scope=>{
 const result=await createMockBackend().library({scope});
 expect(result.ok).toBe(true);
 expect(result.value?.title).toBe(design.DERIVED.libraryTitles[scope]);
 expect(result.value?.overview).toEqual(design.OVERVIEW_BY_SCOPE[scope]);
 expect(result.value?.skills).toHaveLength(Number(design.COUNTS[scope]));
 expect(result.value?.title).toBe(`${result.value?.skills.length} skills`);
 const canonical=await createMockBackend().library({scope:scope.toLowerCase()});
 expect(canonical).toEqual(result);
});
it.each(['unknown','toString','__proto__'])('serves zero overview for unknown scope %s',async scope=>{
 const result=await createMockBackend().library({scope});
 expect(result.ok&&result.value.scanned).toBeNull();
 expect(result.ok?result.value.projects?.map(project=>project.name):[]).toEqual(['Terum','SSM','MRF']);
 expect(result).toEqual({ok:true,value:{scanned:null,projects:result.ok?result.value.projects:[],skills:[],title:'0 skills',overview:{
  skills:'0',skills_note:design.LIBRARY_OVERVIEW.zero.skills,evaluated:'—',
  meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:design.LIBRARY_OVERVIEW.zero.evaluated,
  installs:'0',installs_note:design.LIBRARY_OVERVIEW.zero.installs,attention:'0',
  attention_lines:[design.LIBRARY_OVERVIEW.zero.attention],attention_link:design.LIBRARY_OVERVIEW.attention_link,zero:design.LIBRARY_OVERVIEW.zero,
 }}});
});
it('serves a zero library for the empty scenario',async()=>{
 location.hash='#/library/project/Terum?__mock=empty';
 const result=await createMockBackend().library({scope:'Terum'});
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
