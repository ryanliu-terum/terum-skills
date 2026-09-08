import type { Onboarding } from '../../backend/types';
import { SkillCard } from '../../components/domain/SkillCard';
import { Avatar, Facepile, LiftFigure, ShareBlock, Small } from '../../components/domain/Primitives';
import { BarGroup } from '../../components/domain/ScoreRow';
import { Icon } from '../../components/ui/Icon';
import { Kbd } from '../../components/ui/Kbd';
import { z } from 'zod';
const laterRows=z.array(z.tuple([z.string(),z.string()]));
export function OnboardingBasics({data:d,tab}:{data:Onboarding;tab:string}){
  if(tab==='Manage')return <div style={{width:440}}><SkillCard skill={d.skill}/></div>;
  if(tab==='Eval')return <div className="onboarding-eval"><div><LiftFigure summary={d.summary} size={32} width={104}/><BarGroup label="Quality" caption="share of checks passed" rows={d.summary?[['with skill',d.arm.candidate,d.arm.candidate.toFixed(2),true],['without',d.arm.baseline,d.arm.baseline.toFixed(2),false]]:[['with skill',null,'—',true],['without',null,'—',false]]}/></div><div style={{textAlign:'center'}}><Small>From the latest receipt for {d.skill.name}; the app only reads it</Small></div></div>;
  if(tab==='Share')return <div className="onboarding-share"><ShareBlock command={d.shareCommand} width={440}/><Facepile initials={d.used_by} total={d.installs_n} label={`${d.installs_n} teammates use this`}/></div>;
  if(tab==='Search')return <div className="onboarding-search"><div className="onboarding-search-field"><Icon name="search"/><span>deploy<span className="onboarding-caret"/></span><Kbd>⌘K</Kbd></div><div className="onboarding-search-results">{d.searchResults.map((row,index)=><div key={row.kind} data-hovered={index===0||undefined}>{row.kind==='person'?<Avatar initials={row.initials??''} size={16}/>:<Icon name={row.kind==='skill'?'box':'folder'} size={16} color="var(--tk-text3)"/>}<span>{row.name}</span><span>{row.meta}</span></div>)}</div></div>;
  return <div className="onboarding-later">{laterRows.parse(d.ONBOARD_LATER).map(([title,sub])=><div key={title}><div><Icon name="sparkle" size={15}/></div><div><span>{title}</span><span>{sub}</span></div></div>)}</div>;
}
