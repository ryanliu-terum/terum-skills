import { expect, it } from 'vitest';
import { createTauriBackend } from '../index';
import { overviewCopy } from '../../../lib/overview-copy';
import { chromeLibraryReplay, underHome } from './chrome-library-fixture';

const global = {scope:{kind:'global'} as const};

it.each(['update-available','both'])('counts only available attention data with a second %s row (B1)',async health=>{
 const f=chromeLibraryReplay({local:value=>{
  const section=value.local[0]!,row=section.rows[0]!;
  section.rows=[{...row,health:'update-available'},{...row,path:row.path+'-second',health},{...row,path:row.path+'-broken',health:'unknown',problem:'Could not inspect placed copy.'},{...row,health:'update-available'}];
 }});
 const result=await createTauriBackend(f.bridge).library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.skills).toHaveLength(3);
 expect(result.value.overview).toMatchObject({attention:'3',attention_lines:['2 updates available','1 broken'],attention_link:''});
 expect(f.spawns.map(s=>s.args)).toEqual([['ls','--local'],['status'],['ls','--team','acme']]);
});
it('reports zero attention without placeholder notes or fabricated eval counters (B1)',async()=>{
 const result=await createTauriBackend(chromeLibraryReplay().bridge).library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 const {evaluated,...overview}=result.value.overview;
 expect(overview).toMatchObject({attention:'0',attention_lines:[],attention_link:'',installs_note:''});
 // The unknown eval aggregate is the one dash §3 explicitly preserves.
 expect(evaluated).toBe('—');expect(JSON.stringify(overview)).not.toContain('—');
});
it.each(['joined','unreadable','unjoined'])('describes only a readable team join when %s (B1)',async state=>{
 const f=chromeLibraryReplay(state==='unreadable'?{statusError:'Unreadable team clone.'}:state==='unjoined'?{local:value=>{value.local[0]!.rows=[];}}:{});
 const result=await createTauriBackend(f.bridge).library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.overview.skills_note).toBe(state==='joined'?'1 shared with acme':'');
 if(state==='unreadable')expect(result.value.team.kind).toBe('unreadable');
});
it('uses the designed empty eval copy without requesting per-skill reports (B1)',async()=>{
 const f=chromeLibraryReplay(),result=await createTauriBackend(f.bridge).library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.overview).toMatchObject({evaluated:'—',meter:{pass_:0,neutral:0,fail:0,total:0},meter_text:'Nothing evaluated yet',zero:overviewCopy});
 expect(f.spawns.map(s=>s.args)).toEqual([['ls','--local'],['status'],['ls','--team','acme']]);
});

it('serves the recorded scan coverage abbreviated from the real roots, never a literal (L5)',async()=>{
 const backend=createTauriBackend(chromeLibraryReplay({local:underHome}).bridge);
 const result=await backend.library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.scanned).toEqual(['~/.claude/skills','~/code/seed']);
});
it('leaves a root outside the home directory unabbreviated',async()=>{
 const backend=createTauriBackend(chromeLibraryReplay().bridge);
 const result=await backend.library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.scanned).toHaveLength(2);
 for(const root of result.value.scanned??[])expect(root).not.toContain('~');
 expect(result.value.scanned?.[0]).toMatch(/\/\.claude\/skills$/);
});
it('drops an absent root from the scanned line but keeps unreadable ones (L6)',async()=>{
 const absent=createTauriBackend(chromeLibraryReplay({local:value=>underHome(value,'absent')}).bridge);
 expect((await absent.library(global)).value?.scanned).toEqual(['~/.claude/skills']);
 const unreadable=createTauriBackend(chromeLibraryReplay({local:value=>underHome(value,'unreadable')}).bridge);
 expect((await unreadable.library(global)).value?.scanned).toEqual(['~/.claude/skills','~/code/seed']);
});
it('serves the four zero captions as app copy and grammatical install counts (L7, L9)',async()=>{
 const backend=createTauriBackend(chromeLibraryReplay().bridge);
 const result=await backend.library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.overview.zero).toEqual(overviewCopy);
 expect(result.value.skills.map(card=>card.name)).toEqual(['deploy-check']);
 for(const card of result.value.skills)expect(card.installs).toMatch(/^\d+ installs?$/);
});
it('shares the same scan coverage with Marketplace (M23)',async()=>{
 const backend=createTauriBackend(chromeLibraryReplay({local:value=>underHome(value,'absent')}).bridge);
 const catalog=await backend.catalog();
 expect(catalog.ok).toBe(true);if(!catalog.ok)throw new Error(catalog.error);
 expect(catalog.value.scanned).toEqual(['~/.claude/skills']);
 expect(catalog.value.scanned).toEqual((await backend.library(global)).value?.scanned);
});
