import { EvalQueueDrainer } from './EvalQueueDrainer';
import { PromptCancelledError } from '../backend/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext, PrintContext, PromptContext, pickBackend } from '../backend';
import type { PromptQuestion } from '../backend/types';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../components/ui/Dialog';
import { WorkflowPopup } from '../components/domain/WorkflowPopup';
import { Button } from '../components/ui/Button';
import { affects } from './invalidation';
import { MachineRemovalProvider } from './MachineRemovalProvider';
import { EvalRunProvider } from './EvalRunProvider';
import { ThemeOverrideContext } from './theme-override';
import type { Theme } from '../backend/types';
import { applyTheme, useUiStore } from './store';
export function Providers({children}:PropsWithChildren){
 const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30_000,refetchOnWindowFocus:true,refetchOnReconnect:false,refetchOnMount:'always'}}}));const storedTheme=useUiStore(s=>s.theme),[override,setOverride]=useState<Theme|null>(null),theme=override??storedTheme;const backend=pickBackend();
 useEffect(()=>{const off=backend.subscribe(source=>{void client.invalidateQueries({predicate:q=>affects(source,q.queryKey)});});return off;},[backend,client]);
 useEffect(()=>{const stamp=()=>{applyTheme(theme,override===null);const color=getComputedStyle(document.documentElement).getPropertyValue('--tk-chrome').trim();if(color)void backend.setWindowBackground(color);};stamp();if(theme!=='system'||typeof matchMedia!=='function')return;const media=matchMedia('(prefers-color-scheme: light)');const change=stamp;media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[theme,override,backend]);
 useEffect(()=>{void backend.prefs.ready?.then(async()=>{await useUiStore.persist.rehydrate();});},[backend]);
 return <ThemeOverrideContext value={setOverride}><BackendContext value={backend}><QueryClientProvider client={client}><Tooltip.Provider><PromptProvider><EvalRunProvider><EvalQueueDrainer/><MachineRemovalProvider>{children}</MachineRemovalProvider></EvalRunProvider></PromptProvider></Tooltip.Provider></QueryClientProvider></BackendContext></ThemeOverrideContext>;
}

interface PendingPrompt {id:number;question:PromptQuestion;resolve:(value:string|boolean)=>void;reject:(error:Error)=>void}
function PromptProvider({children}:PropsWithChildren){
 const [notice,setNotice]=useState<string|null>(null);
 const print=useCallback((line:string)=>{if(line.includes('GitHub CLI is installed but logged out.'))setNotice(line);},[]);
 const [pending,setPending]=useState<PendingPrompt[]>([]);const live=useRef<PendingPrompt[]>([]);const serial=useRef(0);
 const ask=useCallback((question:PromptQuestion)=>new Promise<string|boolean>((resolve,reject)=>{const prompt={id:++serial.current,question,resolve,reject};live.current=[...live.current,prompt];setPending(live.current);}),[]);
 useEffect(()=>()=>{for(const prompt of live.current)prompt.reject(new Error('Cancelled.'));live.current=[];},[]);
 function finish(value:string|boolean){const prompt=live.current[0];if(!prompt)return;live.current=live.current.slice(1);setPending(live.current);prompt.resolve(value);}
 function cancel(){const prompt=live.current[0];if(!prompt)return;live.current=live.current.slice(1);setPending(live.current);if(prompt.question.kind==='confirm')prompt.resolve(false);else prompt.reject(new PromptCancelledError('Cancelled.'));}
 const first=pending[0];
 return <PrintContext value={print}><PromptContext value={ask}>{children}{first?<PromptDialog key={first.id} question={first.question} answer={finish} cancel={cancel}/>:null}</PromptContext>{notice?<Dialog open onOpenChange={open=>{if(!open)setNotice(null);}}><WorkflowPopup><DialogTitle>Terminal action needed</DialogTitle><div role="alert" style={{color:'var(--tk-warn)'}}>{notice}</div><Button onClick={()=>setNotice(null)}>Close</Button></WorkflowPopup></Dialog>:null}</PrintContext>;
}
function PromptDialog({question,answer,cancel}:{question:PromptQuestion;answer:(value:string|boolean)=>void;cancel:()=>void}){
 const [value,setValue]=useState(question.default??'');
 return <Dialog open onOpenChange={open=>{if(!open&&question.kind!=='confirm')cancel();}}><DialogPopup><DialogTitle>{question.question}</DialogTitle>{question.detail?.length?<DialogDescription render={<div/>}>{question.detail.map((line,i)=><div key={i}>{line}</div>)}</DialogDescription>:null}<form onSubmit={event=>{event.preventDefault();if(question.kind==='select'&&!question.choices?.includes(value))return;answer(question.kind==='confirm'?true:value);}}>{question.kind==='text'?<input aria-label={question.question} value={value} onChange={event=>setValue(event.target.value)} className="prompt-field"/>:question.kind==='select'?<div role="radiogroup" aria-label={question.question}>{question.choices?.map((choice,index)=><label key={choice} className="prompt-option"><input type="radio" name={question.question} aria-label={choice} value={choice} checked={value===choice} onChange={()=>setValue(choice)}/><span>{choice}{question.descriptions?.[index]&&<span className="prompt-option-description">{question.descriptions[index]}</span>}</span></label>)}</div>:null}<div className="prompt-actions"><Button onClick={cancel}>{question.kind==='confirm'?'No':'Cancel'}</Button><Button kind="primary" type="submit" disabled={question.kind==='select'&&!question.choices?.includes(value)}>{question.kind==='confirm'?'Yes':'Continue'}</Button></div></form></DialogPopup></Dialog>;
}
