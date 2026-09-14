import { beforeEach, expect, it } from 'vitest';
import { createMockBackend, resetMockRemovals } from '../index';
import type { Run } from '../../types';
beforeEach(()=>{location.hash='#/library/global';resetMockRemovals();});
/** Move, copy and rename ask nothing since 2026-09-14; only delete does. The helper answers whatever
 *  ask arrives and reports whether one did, so a mode that silently regrows a question fails here. */
async function answer<T>(run:Run<T>,name:string){let asked=false;for await(const frame of run.frames)if(frame.t==='ask'){asked=true;run.answer(frame.id,name);}return {result:await run.done,asked};}
// §7.5 / §9.1.1 (hybrid review r1, high): the mock silently evicted whatever card already sat at the
// destination. It now mirrors the CLI: rename onto an occupied name refuses with the CLI's sentence and
// moves nothing; a move onto an occupied name keeps the resident at <root>/.claude/old-skills/<name>
// (hidden by construction, exactly as on disk) and says so before the Moved line.
it('refuses a rename onto an occupied name and keeps a move collision in old-skills with the CLI notice',async()=>{
 const backend=createMockBackend(),global=(await backend.library({scope:{kind:'global'}})).value!.skills.map(s=>s.name),other=global.find(name=>name!=='deploy-check')!;
 expect((await answer(backend.skillFile.rename({path:'~/.claude/skills/deploy-check',to:other}),'deploy-check')).result).toMatchObject({ok:false,error:'~/.claude/skills/'+other+' already exists; choose another name.'});
 expect((await backend.library({scope:{kind:'global'}})).value?.skills.map(s=>s.name)).toEqual(global);
 const root='/Users/you/code/ssm',target=(await backend.library({scope:{kind:'checkout',root}})).value!.skills[0]!.name;
 expect((await answer(backend.skillFile.move({path:'~/.claude/skills/'+target,to:root}),target)).result).toMatchObject({ok:true,value:{notices:['Your previous copy is kept at '+root+'/.claude/old-skills/'+target+'.','Moved ~/.claude/skills/'+target+' to '+root+'/.claude/skills/'+target+'.']}});
 expect((await backend.library({scope:{kind:'checkout',root}})).value!.skills.filter(s=>s.name===target)).toHaveLength(1);
 expect(await backend.localSkill({path:root+'/.claude/skills/'+target})).toMatchObject({ok:true,value:{name:target}});
});
it('answers skill fix as the CLI does for a folder that already parses',async()=>{
 const backend=createMockBackend(),path='~/.claude/skills/deploy-check',lines:string[]=[];
 const run=backend.skillFile.fix({path});for await(const frame of run.frames)if(frame.t==='print')lines.push(frame.line);
 expect(await run.done).toEqual({ok:true,value:{kind:'fix',path,destination:null,quarantined:null,installed:false,notices:['deploy-check: SKILL.md frontmatter is already valid YAML; nothing changed.']}});
 expect(lines).toEqual(['deploy-check: SKILL.md frontmatter is already valid YAML; nothing changed.']);
});
it('keeps mock file operations visible in the Library and the path detail',async()=>{
 const backend=createMockBackend(),path='~/.claude/skills/deploy-check',renamed='~/.claude/skills/renamed';
 const before=await backend.library({scope:{kind:'global'}});expect(before.value?.skills.every(s=>!s.teamed&&s.installs==='—'&&s.latestVersion===null&&!s.flags.includes('update'))).toBe(true);
 expect(await answer(backend.skillFile.rename({path,to:'renamed'}),'deploy-check')).toMatchObject({result:{ok:true},asked:false});
 expect((await backend.library({scope:{kind:'global'}})).value?.skills.map(s=>s.name)).toContain('renamed');
 expect(await backend.localSkill({path:renamed})).toMatchObject({ok:true,value:{name:'renamed',edited:true,skillMd:{frontmatter:expect.stringContaining('name: renamed')}}});
 const moved='/Users/you/code/terum/.claude/skills/renamed';
 expect(await answer(backend.skillFile.move({path:renamed,to:'/Users/you/code/terum'}),'renamed')).toMatchObject({result:{ok:true},asked:false});
 expect((await backend.library({scope:{kind:'global'}})).value?.skills.map(s=>s.name)).not.toContain('renamed');
 expect((await backend.library({scope:{kind:'checkout',root:'/Users/you/code/terum'}})).value?.skills.map(s=>s.name)).toContain('renamed');
 expect(await answer(backend.skillFile.delete({path:moved}),'renamed')).toMatchObject({result:{ok:true},asked:true});
 expect((await backend.library({scope:{kind:'checkout',root:'/Users/you/code/terum'}})).value?.skills.map(s=>s.name)).not.toContain('renamed');
});
