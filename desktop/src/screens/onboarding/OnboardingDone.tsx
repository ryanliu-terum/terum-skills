import type { Onboarding } from '../../backend/types';
import { LibraryScreen } from '../library/LibraryScreen';
import { Facepile } from '../../components/domain/Primitives';
import { Dialog, DialogTitle, DialogDescription } from '../../components/ui/Dialog';
import { WorkflowPopup } from '../../components/domain/WorkflowPopup';
import { OnboardingActions, OnboardingKeys, OnboardingTile } from './OnboardingParts';
export function OnboardingDone({data:d,openLibrary}:{data:Onboarding;openLibrary:()=>void}){
  const url='https://github.com/'+d.TEAM_REPO;
  return <><LibraryScreen/><Dialog open onOpenChange={open=>{if(!open)openLibrary();}}><WorkflowPopup initialFocus={false} style={{width:520,padding:'28px 24px 24px',alignItems:'center',gap:8,textAlign:'center'}}><OnboardingTile icon="check-circle" good/><DialogTitle style={{fontSize:24,lineHeight:'30px',letterSpacing:'-.02em'}}>Good to go!</DialogTitle><DialogDescription style={{fontSize:13,lineHeight:'20px',maxWidth:440}}>{`Your Library is ready: the team's ${d.GLOBAL_SET.length} Global skills are placed and in sync. Sharing and the Marketplace are in the sidebar; evals live on each skill's page. The Claude Code session-start hook is set up by \`setup\` in the terminal; Settings ▸ Sync shows this machine's answer.`}</DialogDescription><div className="onboarding-done-details"><div><Facepile initials={d.rosterInitials.slice(0,5)} total={d.teamN} label={`${d.teamN} members on ${d.team.key}`}/></div>{[['Repository',url],['README',url+'/blob/main/README.md']].map(([label,value])=><div key={label}><span>{label}</span><span>{value}</span></div>)}</div><OnboardingActions primary="Open the Library" onPrimary={openLibrary}/><OnboardingKeys pairs={[["↵","to open"],["⌘K","to search, any time"]]}/></WorkflowPopup></Dialog></>;
}
