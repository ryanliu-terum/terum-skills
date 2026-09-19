import { expect, it } from 'vitest';
import { createTauriBackend } from '../index';
import { detailReplay } from './skill-detail-replay';
import { shareCardModel } from '../../../components/domain/skill-share/model';

it('uses tracked author handles for both team detail and the selected Library folder',async()=>{
 const f=detailReplay((name,value)=>{
  if(name!=='ls')return;
  const skills=value.skills as {id:string;name:string;author:string}[];
  const skill=skills.find(row=>row.name==='deploy-check');if(!skill)throw new Error('Missing recorded skill');
  value.people=[{handle:'correct-handle',display_name:'Mira Chen',email:'mira@example.com',authored:[skill.id],installed:[],profile:[]},{handle:'same-display-name',display_name:'Mira Chen',email:'someone-else@example.com',authored:[],installed:[],profile:[]}];
 });
 const backend=createTauriBackend(f.bridge);
 const team=await backend.skill({ref:'deploy-check'});if(!team.ok)throw new Error(team.error);
 expect(team.value.author.handle).toBe('correct-handle');
 const library=await backend.library({scope:{kind:'global'}});if(!library.ok)throw new Error(library.error);
 const card=library.value.skills.find(skill=>skill.name==='deploy-check');if(!card?.path)throw new Error('Missing selected folder');
 const local=await backend.localSkill({path:card.path});if(!local.ok)throw new Error(local.error);
 expect(local.value.author).toMatchObject({name:'Mira Chen',handle:'correct-handle'});
 expect(local.value.path).toBe(card.path);expect(local.value.desc).toBe(card.desc);
 expect(local.value.summary).toEqual(card.summary);
 const model=shareCardModel(local.value);expect(model.author).toContain('@correct-handle');expect(model.reference).toBe('Global/deploy-check');
});
