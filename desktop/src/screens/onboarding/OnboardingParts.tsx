import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import type { PropsWithChildren, ReactNode } from 'react';
import type { Onboarding } from '../../backend/types';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import type { IconName } from '../../components/ui/icon-paths';
import { Kbd } from '../../components/ui/Kbd';
import { RichText } from '../../components/domain/Primitives';
import { TrafficLights } from '../../components/domain/TrafficLights';
import { TerumMark } from '../../components/domain/TerumMark';

export function OnboardingFrame({children,steps,current,skipped}:{children:ReactNode;steps:readonly string[];current:string|null;skipped:readonly string[]}){
  const backend=useBackend();
  const capabilities=useQuery({queryKey:['capabilities'],queryFn:()=>backend.capabilities()});
  const mode=capabilities.data?.windowChrome??'cosmetic';
  const reached=current?steps.indexOf(current):-1;
  return <div className="onboarding-frame"><div className="onboarding-bar">{mode==='cosmetic'?<TrafficLights/>:mode==='mac-overlay'?<div style={{width:52,flexShrink:0}}/>:null}<div className="mark-slot"><TerumMark/></div></div><div className="onboarding-map-band">{current&&<div className="onboarding-map" aria-label="Onboarding progress">{steps.map((name,index)=><span key={name} aria-label={name} aria-current={name===current?'step':undefined} data-skipped={skipped.includes(name)||undefined} data-state={skipped.includes(name)?'skipped':index<reached?'done':index===reached?'current':'pending'} title={name+(skipped.includes(name)?' (skipped)':'')}/>)}</div>}</div><main className="onboarding-main">{children}</main></div>;
}
export function OnboardingColumn({children}:PropsWithChildren){return <div className="onboarding-column">{children}</div>;}
export function OnboardingTile({icon,mark=false,good=false}:{icon?:IconName;mark?:boolean;good?:boolean}){return <div className="onboarding-tile-slot">{(icon||mark)&&<div className="onboarding-tile">{mark?<TerumMark size={18} color="var(--tk-text3)"/>:icon?<Icon name={icon} size={18} color={good?'var(--tk-good)':'currentColor'}/>:null}</div>}</div>;}
export function OnboardingTitle({children}:PropsWithChildren){return <h1 className="onboarding-title">{children}</h1>;}
export function OnboardingPara({children,bright=false}:PropsWithChildren<{bright?:boolean}>){return <span className="onboarding-para" style={bright?{color:'var(--tk-text2)'}:undefined}>{typeof children==='string'?<RichText text={children}/>:children}</span>;}
export function OnboardingActions({primary,secondary,icon,onPrimary,onSecondary,busy=false}:{primary:string;secondary?:string;icon?:IconName;onPrimary:()=>void;onSecondary?:()=>void;busy?:boolean}){return <div className="onboarding-actions"><Button kind="primary" height={32} {...(icon?{icon}:{})} onClick={onPrimary} disabled={busy}>{primary}</Button>{secondary&&<Button height={32} onClick={onSecondary} disabled={busy}>{secondary}</Button>}</div>;}
export function OnboardingKeys({pairs,back}:{pairs:[string,string][];back?:()=>void}){return <div className="onboarding-keys">{pairs.map(([key,what])=>back&&key==='esc'?<button type="button" aria-label="Back" key={key} onClick={back}><Kbd>{key}</Kbd><span>{what}</span></button>:<span key={key}><Kbd>{key}</Kbd><span>{what}</span></span>)}</div>;}
export function ProgressCard({rows,placed,total,failed=false}:{rows:Onboarding['bootRows'];placed:number;total:number|null;failed?:boolean}){return <div className="onboarding-progress">{rows.map(([kind,text,right],index)=><div className="onboarding-progress-row" key={index} data-state={kind}>{kind==='pending'?<span className="onboarding-pending"/>:<Icon name={kind==='done'?'check-circle':kind==='failed'?'alert':'refresh'} size={16} stroke="1.75" color={`var(--tk-${kind==='done'?'good':kind==='failed'?'bad':'brand'})`}/>}<span><RichText text={text}/></span><span>{right}</span></div>)}<div className="onboarding-progress-track-slot"><div className="onboarding-progress-track" role="progressbar" aria-label="Skills placed" aria-valuemin={0} {...(total!==null?{'aria-valuemax':total}:{})} aria-valuenow={placed} data-failed={failed||undefined}>{placed>0&&total!==null&&total>0&&<span style={{width:`calc(100% * ${placed} / ${total})`}}/>}</div></div></div>;}
