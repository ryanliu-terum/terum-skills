import { useQuery } from '@tanstack/react-query';
import { useBackend } from '../../backend';
import type { PropsWithChildren } from 'react';
import type { Library } from '../../backend/types';
import { BoardSkeleton,Small } from './Primitives';
import './Analytics.css';
export function StatTile({label,value,grow=1,children}:{label:string;value:string;grow?:number}&PropsWithChildren){return <div className="stat-tile" style={{flexGrow:grow}}><span className="stat-label">{label}</span><span className="stat-value">{value}</span>{children}</div>;}
/** A tile's big number is the authority for its own empty state: a leading digit run is the real count
 *  ('13 of 15' counts 13), and anything else — the '—' a backend draws when it cannot support a number,
 *  a blank — is an UNKNOWN the tile must never turn into a "nothing yet" claim. A genuine zero arrives
 *  as '0', or as the row-wide `zero` prop. Loading is a third state that never reaches here:
 *  LibraryScreen draws <AnalyticsSkeleton/> while the read is pending. */
function tileCount(value:string):number|null{const digits=/^\d[\d,]*/.exec(value.trim());return digits?Number(digits[0].replaceAll(',','')):null;}
export function Analytics({overview:o,zero=false,provenance='sonnet · agent CLI 2.34.0 · k=3'}:{overview:Library['overview'];zero?:boolean;provenance?:string}){
 const backend=useBackend(),surfaces=useQuery({queryKey:['surfaces'],queryFn:()=>backend.surfaces()});
 const m=o.meter,evaluated=zero?0:tileCount(o.evaluated),unpublished=zero?0:tileCount(o.unpublished);
 // Belt and braces for the tile that had the bug: the zero caption is this row's own copy, so the
 // tile can refuse to draw it over a nonzero count even if a backend hands it down anyway.
 const meterText=evaluated===0||o.meter_text!==o.zero.evaluated?o.meter_text:'';
 return <div className="analytics-row">
  <StatTile label="Skills" value={zero?'0':o.skills}>{zero?<Small>{o.zero.skills}</Small>:<Small>{o.skills_note}</Small>}</StatTile>
  <StatTile label="Evaluated" value={zero?'—':o.evaluated}>{zero?<Small>{o.zero.evaluated}</Small>:evaluated===0?
   // Genuinely nothing evaluated: the zero caption alone, no meter and no provenance to attach it to.
   (meterText?<Small>{meterText}</Small>:null)
   :<>{m.total>0?<div className="analytics-meter">{[[m.pass_,'good'],[m.neutral,'text3'],[m.fail,'bad'],[m.total-m.pass_-m.neutral-m.fail,'bg4']].map(([n,color],i)=><span key={i} style={{flexGrow:Number(n),background:`var(--tk-${color})`}}/>)}</div>:null}{meterText?<Small>{meterText}</Small>:null}{provenance?<Small>{provenance}</Small>:null}</>}</StatTile>
  <StatTile label="Unpublished" value={zero?'0':o.unpublished} grow={2}>{zero||unpublished===0?<Small>{o.zero.unpublished}</Small>:<Small>{o.unpublished_note}</Small>}</StatTile>
  <StatTile label="Needs attention" value={zero?'0':o.attention}>{zero?<Small>{o.zero.attention}</Small>:<><div className="board-column">{o.attention_lines.map(line=><Small key={line}>{line}</Small>)}</div>{o.attention_link&&surfaces.data?.inbox===true?<a href="#/inbox?filter=alerts" style={{fontSize:12}}>{o.attention_link}</a>:null}</>}</StatTile>
 </div>;
}
export function AnalyticsSkeleton(){return <div className="analytics-row">{[1,1,2,1].map((grow,i)=><div key={i} className="stat-tile" style={{flexGrow:grow,gap:10}}><BoardSkeleton width={56} height={10}/><BoardSkeleton width={84} height={20}/><BoardSkeleton width="70%" height={10}/></div>)}</div>;}
export function AnalyticsDivider(){return <div className="analytics-divider"><div/></div>;}
