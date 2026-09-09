import { useState } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { useBackend, useFeatures } from '../../backend';
import type { Catalog, InviteResult, TeamStatus } from '../../backend/types';
import { CliBox, HoverTip, IconButton, RichText, SectionLabel, Small } from '../../components/domain/Primitives';
import { InlineChoice, WorkflowDialog, WorkflowField } from '../../components/domain/WorkflowControls';
import { useWorkflow } from '../../components/domain/useWorkflow';

type InviteData={team:TeamStatus;copy:{INVITE_TIP:string;JOIN_BLOCK_NOTE:string;INVITEE?:string};catalog?:Catalog};
export function ShareInvite({close,data,error,retry,onDone}:{close:()=>void;data:InviteData|undefined;error:string|null;retry:()=>void;onDone:(line:string)=>void}){
  return data?<InviteForm close={close} {...data} onDone={onDone}/>:<WorkflowDialog title="Invite members" body={error??'Loading invitation…'} primary="Invite" command="npx -y terum-skills@latest invite <github-login>..." busy={!error} close={close} submit={retry} error={error}/>;
}
function InviteForm({close,team,copy,catalog,onDone}:InviteData&{close:()=>void;onDone:(line:string)=>void}){
  const backend=useBackend(),action=useWorkflow(),features=useFeatures();
  const projects=catalog?.projects??[];
  const [logins,setLogins]=useState(copy.INVITEE??''),[scope,setScope]=useState('project'),[project,setProject]=useState(projects[0]?.name??''),[role,setRole]=useState('Member'),[help,setHelp]=useState(false),[invalid,setInvalid]=useState<string|null>(null);
  const [outcomes,setOutcomes]=useState<string[]>([]);
  const selected=projects.find(p=>p.name===project);
  async function submit(){
    const seen=new Set<string>();
    const values=logins.split(/[\s,]+/).map(login=>login.trim()).filter(Boolean).filter(login=>{const key=login.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
    // Source of truth: src/lib/schema.ts githubLoginSchema; screens cannot import the CLI.
    if(!values.length||values.some(login=>!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login))){setInvalid('Enter valid GitHub logins, separated by commas or spaces.');return;}
    if(features?.inviteScoping&&scope==='project'&&!selected){setInvalid('Choose a project for this invitation.');return;}
    setInvalid(null);
    const result=await action.run(()=>backend.invite({team:team.key,logins:values,...(features?.inviteScoping?{scope:scope==='team'?'Global':project}:{}),...(features?.roles?{role:role.toLowerCase()}:{})}));
    if(!result)return;
    if(result.ok){onDone(outcomeLine(result.value));close();return;}
    if(result.value)setOutcomes(perLoginLines(result.value));
  }
  // Drawn-string change on the locked ShareInvite board: flag this body copy to Teddy in the PR.
  return <WorkflowDialog title="Invite members" body="Adds each login as a collaborator on the team repository. GitHub emails each invitation; they appear on the roster once they join." primary="Invite" command={'npx -y terum-skills@latest invite '+(logins||'<github-login>...')} width={520} close={close} submit={()=>void submit()} busy={action.busy} error={action.error??invalid} aside={<span className="invite-help" onMouseEnter={()=>setHelp(true)} onMouseLeave={()=>setHelp(false)}><IconButton icon="help-circle" label="Invitation help" onClick={()=>setHelp(!help)}/>{help&&<HoverTip>{<RichText text={copy.INVITE_TIP}/>}</HoverTip>}</span>}>
    <div className="invite-field"><SectionLabel>GitHub logins</SectionLabel><WorkflowField aria-label="GitHub logins" value={logins} aria-invalid={!!invalid} placeholder="octocat, another-login" onChange={e=>{setLogins(e.target.value);setInvalid(null);setOutcomes([]);}}/><Small>Their GitHub identity, not a team handle — they choose that when they join.</Small></div>
    {features?.inviteScoping&&catalog?<div className="invite-field"><SectionLabel>Invite scoping</SectionLabel><RadioGroup value={scope} onValueChange={value=>{if(typeof value==='string')setScope(value);}} aria-label="Invite scoping" className="invite-scopes">
      <label className="invite-scope" data-checked={scope==='team'||undefined}><span className="invite-radio-slot"><Radio.Root value="team" className="radio" aria-labelledby="invite-whole-team"><Radio.Indicator className="radio-dot"/></Radio.Root></span><span className="invite-scope-copy"><span id="invite-whole-team">Whole team</span><Small>They get the team's Global list when they join.</Small></span></label>
      <div className="invite-scope" data-checked={scope==='project'||undefined}><span className="invite-radio-slot"><Radio.Root value="project" className="radio" aria-label="Project"><Radio.Indicator className="radio-dot"/></Radio.Root></span><div className="invite-scope-copy"><span><InlineChoice label="Project" value={project} options={projects.map(p=>p.name)} onChange={value=>{setProject(value);setScope('project');}}/></span><Small>{selected?<RichText text={`${selected.desc} Its ${selected.skills} skills place when they sync inside the repo.`}/>:'No projects are available.'}</Small></div></div>
    </RadioGroup></div>:null}
    {features?.roles?<div className="invite-field"><SectionLabel>Role</SectionLabel><div className="invite-role"><Small>Admins invite and remove members.</Small><InlineChoice label="Role" value={role} options={['Member','Admin']} onChange={setRole}/></div></div>:null}
    <div className="invite-field"><SectionLabel>Send them this</SectionLabel>{team.joinCommand?<CliBox command={team.joinCommand}/>:<Small>{`terum-skills reports no join command for ${team.remote??'this team'}.`}</Small>}<Small><RichText text={copy.JOIN_BLOCK_NOTE}/></Small></div>
    {outcomes.length>0&&<div className="invite-outcomes" role="status">{outcomes.map(line=><div key={line}>{line}</div>)}</div>}
  </WorkflowDialog>;
}

function outcomeLine(value:InviteResult):string {
  return ((value.invited.length?`Invited ${value.invited.map(l=>'@'+l).join(', ')}.`:'')+(value.already.length?` ${value.already.map(l=>'@'+l).join(', ')} already ${value.already.length===1?'has':'have'} access.`:'')).trim();
}
function perLoginLines(value:InviteResult):string[] {
  return [...value.invited.map(login=>`Invited @${login}.`),...value.already.map(login=>`@${login} already has access.`),...value.failed.map(({login,error})=>`@${login}: ${error}`)];
}
