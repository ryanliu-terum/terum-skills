import { useState } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { useBackend, useFeatures } from '../../backend';
import type { Catalog, Onboarding } from '../../backend/types';
import { CliBox, HoverTip, IconButton, RichText, SectionLabel, Small } from '../../components/domain/Primitives';
import { InlineChoice, WorkflowDialog, WorkflowField } from '../../components/domain/WorkflowControls';
import { useWorkflow } from '../../components/domain/useWorkflow';

export function ShareInvite({close,data,error,retry}:{close:()=>void;data:{onboarding:Onboarding;catalog:Catalog}|undefined;error:string|null;retry:()=>void}){
  return data?<InviteForm close={close} data={data.onboarding} catalog={data.catalog}/>:<WorkflowDialog title="Invite members" body={error??'Loading invitation…'} primary="Invite" command="npx -y terum-skills@latest invite <github-login>..." busy={!error} close={close} submit={retry} error={error}/>;
}
function InviteForm({close,data,catalog}:{close:()=>void;data:Onboarding;catalog:Catalog}){
  const backend=useBackend(),action=useWorkflow(),features=useFeatures();
  const [logins,setLogins]=useState(data.INVITEE),[scope,setScope]=useState('project'),[project,setProject]=useState(catalog.projects[0]?.name??''),[role,setRole]=useState('Member'),[help,setHelp]=useState(false),[invalid,setInvalid]=useState<string|null>(null);
  const selected=catalog.projects.find(p=>p.name===project);
  function submit(){const values=logins.split(/[\s,]+/).filter(Boolean);if(!values.length||values.some(login=>! /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login))){setInvalid('Enter valid GitHub logins, separated by commas or spaces.');return;}if(features?.inviteScoping&&scope==='project'&&!selected){setInvalid('Choose a project for this invitation.');return;}setInvalid(null);void action.run(()=>backend.invite({logins:values,...(features?.inviteScoping?{scope:scope==='team'?'Global':project}:{}),...(features?.roles?{role:role.toLowerCase()}:{})}),{},close);}
  return <WorkflowDialog title="Invite members" body="Adds each login as a collaborator on the team repo and lists the invitation on the roster until they join." primary="Invite" command={'npx -y terum-skills@latest invite '+(logins||'<github-login>...')} width={520} close={close} submit={submit} busy={action.busy} error={action.error??invalid} aside={<span className="invite-help" onMouseEnter={()=>setHelp(true)} onMouseLeave={()=>setHelp(false)}><IconButton icon="help-circle" label="Invitation help" onClick={()=>setHelp(!help)}/>{help&&<HoverTip>{<RichText text={data.INVITE_TIP}/>}</HoverTip>}</span>}>
    <div className="invite-field"><SectionLabel>GitHub logins</SectionLabel><WorkflowField aria-label="GitHub logins" value={logins} aria-invalid={!!invalid} placeholder="octocat, another-login" onChange={e=>{setLogins(e.target.value);setInvalid(null);}}/><Small>Their GitHub identity, not a team handle — they choose that when they join.</Small></div>
    {features?.inviteScoping?<div className="invite-field"><SectionLabel>Invite scoping</SectionLabel><RadioGroup value={scope} onValueChange={value=>{if(typeof value==='string')setScope(value);}} aria-label="Invite scoping" className="invite-scopes">
      <label className="invite-scope" data-checked={scope==='team'||undefined}><span className="invite-radio-slot"><Radio.Root value="team" className="radio" aria-labelledby="invite-whole-team"><Radio.Indicator className="radio-dot"/></Radio.Root></span><span className="invite-scope-copy"><span id="invite-whole-team">Whole team</span><Small>They get the team's Global list when they join.</Small></span></label>
      <div className="invite-scope" data-checked={scope==='project'||undefined}><span className="invite-radio-slot"><Radio.Root value="project" className="radio" aria-label="Project"><Radio.Indicator className="radio-dot"/></Radio.Root></span><div className="invite-scope-copy"><span><InlineChoice label="Project" value={project} options={catalog.projects.map(p=>p.name)} onChange={value=>{setProject(value);setScope('project');}}/></span><Small>{selected?<RichText text={`${selected.desc} Its ${selected.skills} skills place when they sync inside the repo.`}/>:'No projects are available.'}</Small></div></div>
    </RadioGroup></div>:null}
    {features?.roles?<div className="invite-field"><SectionLabel>Role</SectionLabel><div className="invite-role"><Small>Admins invite and remove members.</Small><InlineChoice label="Role" value={role} options={['Member','Admin']} onChange={setRole}/></div></div>:null}
    <div className="invite-field"><SectionLabel>Send them this</SectionLabel><CliBox command={data.joinBlock}/><Small><RichText text={data.JOIN_BLOCK_NOTE}/></Small></div>
  </WorkflowDialog>;
}
