import { afterEach, expect, it } from 'vitest';
import { createMockBackend } from '../mock';
import { design } from '../mock/data';
afterEach(()=>{location.hash='';});
it('mock profile updates roster/catalog separately from the permission preference',async()=>{
 const backend=createMockBackend();backend.prefs.set('role:'+design.ME.handle,'admin');
 const project=design.PROJECTS[0]!.name;
 const args={name:'New Name',bio:'New bio',role:'Platform',projects:[project]};
 expect(await backend.profile(args).done).toEqual({ok:true,value:{handle:design.ME.handle,changed:['display_name','bio','role','projects']}});
 expect((await backend.roster()).value?.members.find(member=>member.handle===design.ME.handle)).toMatchObject({name:'New Name',role:'Platform',projects:[project]});
 expect((await backend.catalog()).value?.people.find(member=>member.handle===design.ME.handle)).toMatchObject({name:'New Name',role:'Platform',projects:[project]});
 expect(await backend.profile(args).done).toEqual({ok:true,value:{handle:design.ME.handle,changed:[]}});
 expect(backend.prefs.get('role:'+design.ME.handle,'')).toBe('admin');
});
