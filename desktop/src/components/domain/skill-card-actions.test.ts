import { expect, it } from 'vitest';
import { cardActions, detailPath } from './skill-card-actions';
import type { SkillCard, TeamState } from '../../backend/types';

function card(over:Partial<SkillCard>={}):SkillCard {
 return {teamed:true,path:null,updated:null,grants:null,normalizedGrants:null,grantsHash:null,project:'Terum',category:'infra',name:'deploy-check',desc:'',size:'2k',installs:'3 installs',favorite:false,flags:[],flagText:{},enabled:true,installed:'placed',placed:true,onDiskOnly:false,teamState:'endorsed',paths:[],wlt:null,summary:null,installsN:3,tokensK:2,indicators:{} as SkillCard['indicators'],...over};
}
function find(skill:SkillCard,key:string){const action=cardActions(skill).find(a=>a.key===key);if(!action)throw new Error('no action '+key);return action;}

it('addresses a team skill by name and a local folder by path', () => {
 expect(detailPath(card())).toBe('/skill/deploy-check');
 expect(detailPath(card({teamed:false,path:'~/.claude/skills/notes'}))).toBe('/skill/local?path=' + encodeURIComponent('~/.claude/skills/notes'));
});

it('carries the marketplace origin into every row it links to', () => {
 const rows=cardActions(card({placed:false,installed:'absent',teamState:'endorsed'}),{origin:'root=marketplace'});
 expect(rows.find(a=>a.key==='open')?.to).toBe('/skill/deploy-check?root=marketplace');
 expect(rows.find(a=>a.key==='place')?.to).toBe('/skill/deploy-check?dialog=install&root=marketplace');
});

it('keeps the marketplace origin off the local-folder route, which has no marketplace', () => {
 const rows=cardActions(card({teamed:false,path:'~/.claude/skills/notes',placed:true}),{origin:'root=marketplace'});
 expect(rows.find(a=>a.key==='open')?.to).toBe('/skill/local?path=' + encodeURIComponent('~/.claude/skills/notes'));
 expect(rows.find(a=>a.key==='place')?.to).toBe('/skill/local?path=' + encodeURIComponent('~/.claude/skills/notes') + '&dialog=remove');
});

it('offers Run eval only when the feature is on', () => {
 expect(cardActions(card()).some(a=>a.key==='run-eval')).toBe(false);
 expect(cardActions(card(),{runEvalInApp:true}).find(a=>a.key==='run-eval')?.to).toBe('/skill/deploy-check?tab=evals&dialog=run-eval');
});

it('moves only a copy Terum placed', () => {
 expect(find(card({placed:true}),'move').to).toBe('/skill/deploy-check?dialog=move');
 expect(find(card({placed:false,onDiskOnly:true}),'move').reason).toMatch(/Terum did not place it/);
 expect(find(card({placed:false,installed:'absent',onDiskOnly:false}),'move').reason).toBe('Install it before moving it.');
});

it('turns the one place row into Install or Uninstall by state', () => {
 expect(find(card({placed:true}),'place')).toMatchObject({label:'Uninstall…',to:'/skill/deploy-check?dialog=remove'});
 expect(find(card({placed:false,installed:'absent'}),'place')).toMatchObject({label:'Install…',to:'/skill/deploy-check?dialog=install'});
 const onDisk=find(card({placed:false,onDiskOnly:true}),'place');
 expect(onDisk.to).toBeNull();
 expect(onDisk.reason).toMatch(/Terum did not place/);
});

it('offers Reinstall, and says so, for a skill the people file records with nothing on this machine', () => {
 const row=find(card({placed:false,onDiskOnly:false,installed:'recorded'}),'place');
 expect(row).toMatchObject({label:'Reinstall…',to:'/skill/deploy-check?dialog=install'});
 expect(row.reason).toBe('Installed · not on this machine.');
});

it('enables Publish only for a skill the team repo holds but has not endorsed', () => {
 const reasons=Object.fromEntries((['endorsed','shared','unshared','unknown'] as TeamState[]).map(teamState=>[teamState,find(card({teamState}),'publish')]));
 expect(reasons.shared!.to).toBe('/skill/deploy-check?dialog=publish');
 expect(reasons.shared!.reason).toBeNull();
 expect(reasons.endorsed!.to).toBeNull();
 expect(reasons.endorsed!.reason).toBe('Already published to the team.');
 expect(reasons.unshared!.reason).toMatch(/Not shared with the team yet/);
 expect(reasons.unknown!.reason).toMatch(/could not read this team/);
});

it('keeps the same five rows whatever the state, so the menu does not change shape', () => {
 for(const skill of [card(),card({placed:false,installed:'absent',teamState:'unshared'}),card({placed:false,onDiskOnly:true,teamState:'shared'})]) {
  expect(cardActions(skill,{runEvalInApp:true}).map(a=>a.key)).toEqual(['open','run-eval','move','place','publish']);
 }
});
