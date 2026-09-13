import { beforeEach, expect, it } from 'vitest';
import { createMockBackend, resetMockRemovals } from '../index';
import type { Run } from '../../types';
beforeEach(()=>{location.hash='#/library/global';resetMockRemovals();});
async function answer<T>(run:Run<T>,name:string){for await(const frame of run.frames)if(frame.t==='ask')run.answer(frame.id,name);return run.done;}
it('keeps mock file operations visible in the Library and the path detail',async()=>{
 const backend=createMockBackend(),path='~/.claude/skills/deploy-check',renamed='~/.claude/skills/renamed';
 const before=await backend.library({scope:{kind:'global'}});expect(before.value?.skills.every(s=>!s.teamed&&s.installs==='—'&&s.latestVersion===null&&!s.flags.includes('update'))).toBe(true);
 expect(await answer(backend.skillFile.rename({path,to:'renamed'}),'deploy-check')).toMatchObject({ok:true});
 expect((await backend.library({scope:{kind:'global'}})).value?.skills.map(s=>s.name)).toContain('renamed');
 expect(await backend.localSkill({path:renamed})).toMatchObject({ok:true,value:{name:'renamed',edited:true,skillMd:{frontmatter:expect.stringContaining('name: renamed')}}});
 const moved='/Users/you/code/terum/.claude/skills/renamed';
 expect(await answer(backend.skillFile.move({path:renamed,to:'/Users/you/code/terum'}),'renamed')).toMatchObject({ok:true});
 expect((await backend.library({scope:{kind:'global'}})).value?.skills.map(s=>s.name)).not.toContain('renamed');
 expect((await backend.library({scope:{kind:'checkout',root:'/Users/you/code/terum'}})).value?.skills.map(s=>s.name)).toContain('renamed');
 expect(await answer(backend.skillFile.delete({path:moved}),'renamed')).toMatchObject({ok:true});
 expect((await backend.library({scope:{kind:'checkout',root:'/Users/you/code/terum'}})).value?.skills.map(s=>s.name)).not.toContain('renamed');
});
