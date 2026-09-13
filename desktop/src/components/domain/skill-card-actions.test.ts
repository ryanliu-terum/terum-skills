import { expect, it } from 'vitest';
import { cardActions, detailPath } from './skill-card-actions';
import type { SkillCard, TeamState } from '../../backend/types';

function card(over:Partial<SkillCard>={}):SkillCard {
 return {localEval:null,localEvalStale:false,installedVersion:null,latestVersion:null,evalVersion:null,evalStale:false,latestEvalState:null,profileVersion:null,teamed:true,path:null,updated:null,grants:null,normalizedGrants:null,grantsHash:null,project:'Terum',category:'infra',name:'deploy-check',desc:'',size:'2k',installs:'3 installs',favorite:false,flags:[],flagText:{},enabled:true,installed:'placed',placed:true,onDiskOnly:false,teamState:'endorsed',paths:[],wlt:null,summary:null,installsN:3,tokensK:2,indicators:{} as SkillCard['indicators'],...over};
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
 expect(cardActions(card({path:'~/.claude/skills/deploy-check'}),{runEvalInApp:true}).find(a=>a.key==='run-eval')?.to).toBe('/skill/deploy-check?tab=evals&dialog=run-eval');
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

// §11.4: the gate is the local folder alone. A skill the team already holds IS publishable — that is
// how its next version ships (§5.1 step 9 mints highest+1; identical bytes mint nothing).
it('enables Publish for any card with a local folder, whatever the team state, and says why otherwise', () => {
 for(const teamState of ['endorsed','shared','unshared','unknown'] as TeamState[]) {
  expect(find(card({teamState,path:'~/.claude/skills/deploy-check'}),'publish')).toMatchObject({to:'/skill/deploy-check?dialog=publish',reason:null});
 }
 const missing=find(card({teamState:'shared',path:null}),'publish');
 expect(missing.to).toBeNull();
 expect(missing.reason).toBe('This skill is not on this machine, so there is nothing to publish.');
});

it('gates Run eval on the local folder with a reason, keeping the row', () => {
 expect(cardActions(card({path:'~/.claude/skills/deploy-check'}),{runEvalInApp:true}).find(a=>a.key==='run-eval')).toMatchObject({to:'/skill/deploy-check?tab=evals&dialog=run-eval',reason:null});
 expect(cardActions(card({path:null}),{runEvalInApp:true}).find(a=>a.key==='run-eval')).toMatchObject({to:null,reason:'Install it first — evals run against the copy on your machine.'});
});

it('keeps the same five rows whatever the state, so the menu does not change shape', () => {
 for(const skill of [card(),card({placed:false,installed:'absent',teamState:'unshared'}),card({placed:false,onDiskOnly:true,teamState:'shared'})]) {
  expect(cardActions(skill,{runEvalInApp:true}).map(a=>a.key)).toEqual(['open','run-eval','move','place','publish']);
 }
});

it('rides a checkout origin exactly as it rides the marketplace one',()=>{
 const origin='root=%2FUsers%2Fyou%2Fcode%2Fterum',rows=cardActions(card(),{origin});
 expect(rows.find(a=>a.key==='open')?.to).toBe('/skill/deploy-check?'+origin);
 expect(rows.find(a=>a.key==='place')?.to).toBe('/skill/deploy-check?dialog=remove&'+origin);
 const local=cardActions(card({teamed:false,path:'~/.claude/skills/notes'}),{origin});
 expect(local.find(a=>a.key==='open')?.to).toBe('/skill/local?path='+encodeURIComponent('~/.claude/skills/notes'));
 expect(local.find(a=>a.key==='place')?.to).toBe('/skill/local?path='+encodeURIComponent('~/.claude/skills/notes')+'&dialog=remove');
});
