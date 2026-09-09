import type { InputHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icon-paths';
import { Dialog, DialogDescription, DialogTitle } from '../ui/Dialog';
import { WorkflowPopup } from './WorkflowPopup';
import { RichText, TerminalHint } from './Primitives';

export function WorkflowHeader({ title, icon, subtitle, children }: PropsWithChildren<{ title: string; icon: IconName; subtitle?: string | undefined }>) {
  return <div className="board-view-header"><div><Icon name={icon} size={16} color="var(--tk-text3)"/><span style={{fontWeight:510}}>{title}</span>{subtitle && <span style={{color:'var(--tk-text3)'}}>{subtitle}</span>}</div><div>{children}</div></div>;
}
export function WorkflowDialog({ title, body, primary, command, children, close, submit, busy = false, error, width = 440, danger = false, aside, onStop, dismissKeepsRunning = false, lines, status, closeLabel = 'Cancel', hideBusyClose = false }: PropsWithChildren<{title:string;body:string;primary:string|null;command:string;close:()=>void;submit:()=>void;busy?:boolean;error?:string|null;width?:number;danger?:boolean;aside?:ReactNode;onStop?:()=>void;dismissKeepsRunning?:boolean;lines?:readonly string[];status?:ReactNode;closeLabel?:string;hideBusyClose?:boolean}>) {
  return <Dialog open onOpenChange={open=>{if(!open&&(!busy||dismissKeepsRunning))close();}}><WorkflowPopup style={{width,maxHeight:'calc(100vh - 32px)',overflowY:'auto'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><DialogTitle>{title}</DialogTitle>{aside}</div><DialogDescription><RichText text={body}/></DialogDescription>{lines?.length?<pre className="board-mono workflow-lines" role="log" aria-live="polite">{lines.join('\n')}</pre>:null}{status?<div role="status">{status}</div>:null}{children}<TerminalHint command={command}/>{error && <div role="alert" style={{fontSize:12,color:'var(--tk-bad)'}}>{error}</div>}<div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:4}}><>{busy&&onStop?<Button kind="danger" onClick={onStop}>Stop</Button>:busy&&hideBusyClose?null:<Button onClick={close} disabled={busy}>{closeLabel}</Button>}</>{primary!==null?<Button kind={danger?'danger':'primary'} onClick={submit} disabled={busy}>{primary}</Button>:null}</div></WorkflowPopup></Dialog>;
}
export function WorkflowField(props:InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{height:32,padding:'0 10px',borderRadius:6,background:'var(--tk-bg2)',border:'1px solid var(--tk-border1)',fontSize:13,color:'var(--tk-text1)',boxSizing:'border-box',minWidth:0,...props.style}}/>;
}
export function InlineChoice({label,value,options,onChange}:{label:string;value:string;options:readonly string[];onChange:(value:string)=>void}) {
  return <BaseSelect.Root value={value} onValueChange={next=>{if(next!==null)onChange(next);}}><BaseSelect.Trigger aria-label={label} style={{display:'inline-flex',alignItems:'center',gap:6,height:24,padding:'0 6px 0 8px',borderRadius:6,background:'var(--tk-bg2)',border:'1px solid var(--tk-border1)',fontSize:12,fontWeight:500,color:'var(--tk-text1)',whiteSpace:'nowrap',boxSizing:'border-box'}}><BaseSelect.Value/ ><Icon name="chevron-down" size={12} stroke="2" color="var(--tk-text3)"/></BaseSelect.Trigger><BaseSelect.Portal><BaseSelect.Positioner align="end" sideOffset={4} alignItemWithTrigger={false} style={{zIndex:20}}><BaseSelect.Popup className="floating-panel" style={{minWidth:180}}>{options.map(option=><BaseSelect.Item key={option} value={option} className="menu-item"><span style={{width:14}}>{option===value?<Icon name="check" size={14} stroke="2"/>:null}</span><BaseSelect.ItemText>{option}</BaseSelect.ItemText></BaseSelect.Item>)}</BaseSelect.Popup></BaseSelect.Positioner></BaseSelect.Portal></BaseSelect.Root>;
}
