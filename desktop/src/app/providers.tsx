import { EvalQueueDrainer } from './EvalQueueDrainer';
import { PromptCancelledError } from '../backend/types';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext, PrintContext, PromptContext, pickBackend, useBackend, type PromptOptions } from '../backend';
import type { FormAnswers, FormField, PromptAnswer, PromptQuestion } from '../backend/types';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from '../components/ui/Dialog';
import { WorkflowPopup } from '../components/domain/WorkflowPopup';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { affects } from './invalidation';
import { MachineRemovalProvider } from './MachineRemovalProvider';
import { ContextMenuProvider } from '../components/domain/ContextMenu';
import { EvalRunProvider } from './EvalRunProvider';
import { PublishRunProvider } from './PublishRunProvider';
import { ThemeOverrideContext } from './theme-override';
import type { Theme } from '../backend/types';
import { applyTheme, useUiStore } from './store';
export function Providers({children}:PropsWithChildren){
 const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30_000,refetchOnWindowFocus:true,refetchOnReconnect:false,refetchOnMount:'always'}}}));const storedTheme=useUiStore(s=>s.theme),[override,setOverride]=useState<Theme|null>(null),theme=override??storedTheme;const backend=pickBackend();
 useEffect(()=>{const off=backend.subscribe(source=>{void client.invalidateQueries({predicate:q=>affects(source,q.queryKey)});});return off;},[backend,client]);
 useEffect(()=>{const stamp=()=>{applyTheme(theme,override===null);const color=getComputedStyle(document.documentElement).getPropertyValue('--tk-chrome').trim();if(color)void backend.setWindowBackground(color);};stamp();if(theme!=='system'||typeof matchMedia!=='function')return;const media=matchMedia('(prefers-color-scheme: light)');const change=stamp;media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[theme,override,backend]);
 useEffect(()=>{void backend.prefs.ready?.then(async()=>{await useUiStore.persist.rehydrate();});},[backend]);
 return <ThemeOverrideContext value={setOverride}><BackendContext value={backend}><QueryClientProvider client={client}><Tooltip.Provider><ContextMenuProvider><PromptProvider><EvalRunProvider><PublishRunProvider><EvalQueueDrainer/><MachineRemovalProvider>{children}</MachineRemovalProvider></PublishRunProvider></EvalRunProvider></PromptProvider></ContextMenuProvider></Tooltip.Provider></QueryClientProvider></BackendContext></ThemeOverrideContext>;
}

interface PendingPrompt {id:number;question:PromptQuestion;resolve:(value:PromptAnswer)=>void;reject:(error:Error)=>void}
export function PromptProvider({children}:PropsWithChildren){
 const [notice,setNotice]=useState<string|null>(null);
 const print=useCallback((line:string)=>{if(line.includes('GitHub CLI is installed but logged out.'))setNotice(line);},[]);
 const [pending,setPending]=useState<PendingPrompt[]>([]);const live=useRef<PendingPrompt[]>([]);const serial=useRef(0);
 const ask=useCallback((question:PromptQuestion,options?:PromptOptions)=>new Promise<PromptAnswer>((resolve,reject)=>{
  const signal=options?.signal;
  if(signal?.aborted){reject(new PromptCancelledError('The run ended before this question was asked.'));return;}
  const prompt:PendingPrompt={id:++serial.current,question,resolve:value=>{signal?.removeEventListener('abort',withdraw);resolve(value);},reject:error=>{signal?.removeEventListener('abort',withdraw);reject(error);}};
  // The run that asked has settled: the question is moot. Take it off the screen and tell the driver, which returns the run's own result.
  function withdraw(){if(!live.current.includes(prompt))return;live.current=live.current.filter(p=>p!==prompt);setPending(live.current);prompt.reject(new PromptCancelledError('The run ended before this question was answered.'));}
  signal?.addEventListener('abort',withdraw,{once:true});
  live.current=[...live.current,prompt];setPending(live.current);
 }),[]);
 useEffect(()=>()=>{for(const prompt of live.current)prompt.reject(new Error('Cancelled.'));live.current=[];},[]);
 function finish(value:PromptAnswer){const prompt=live.current[0];if(!prompt)return;live.current=live.current.slice(1);setPending(live.current);prompt.resolve(value);}
 function cancel(){const prompt=live.current[0];if(!prompt)return;live.current=live.current.slice(1);setPending(live.current);if(prompt.question.kind==='confirm')prompt.resolve(false);else prompt.reject(new PromptCancelledError('Cancelled.'));}
 const first=pending[0];
 return <PrintContext value={print}><PromptContext value={ask}>{children}{first?first.question.kind==='form'?<FormDialog key={first.id} question={first.question} answer={finish} cancel={cancel}/>:<PromptDialog key={first.id} question={first.question} answer={finish} cancel={cancel}/>:null}</PromptContext>{notice?<Dialog open onOpenChange={open=>{if(!open)setNotice(null);}}><WorkflowPopup><DialogTitle>Terminal action needed</DialogTitle><div role="alert" style={{color:'var(--tk-warn)'}}>{notice}</div><Button onClick={()=>setNotice(null)}>Close</Button></WorkflowPopup></Dialog>:null}</PrintContext>;
}
/**
 * §9.2 / D13: `path` is `text` with a folder chooser beside it. The field stays editable and the
 * typed answer is what is submitted, so a shell that cannot open a chooser is still a working prompt —
 * which is exactly what the protocol promises a consumer that treats `path` as `text`.
 */
/**
 * A `form` ask (frame protocol 2, 2026-09-19): every field on one screen, one confirm. A text field is prefilled and
 * editable, a read-only one is shown, a checkbox is a checkbox, and a disabled checkbox is checked and inert. A field
 * that `follows` another tracks it through the template until the person types in it. Per-field `errors` from the
 * CLI's last validation are shown under their fields. Skip answers null (only offered when the CLI said the form may
 * be skipped); Cancel is the dialog's usual cancellation and cancels the run.
 */
function FormDialog({question,answer,cancel}:{question:PromptQuestion;answer:(value:FormAnswers|null)=>void;cancel:()=>void}){
 const fields=question.fields??[];const idPrefix=useId();
 const [values,setValues]=useState<FormAnswers>(()=>Object.fromEntries(fields.map(field=>[field.id,field.kind==='checkbox'?field.default:field.default??''])));
 const [touched,setTouched]=useState<Set<string>>(()=>new Set(fields.filter(field=>field.kind==='text'&&field.follows&&field.default).map(field=>field.id)));
 const textField=(field:FormField):field is Extract<FormField,{kind:'text'}>=>field.kind==='text';
 function setText(field:Extract<FormField,{kind:'text'}>,value:string){
  setTouched(prev=>new Set(prev).add(field.id));
  setValues(prev=>{
   const next={...prev,[field.id]:value};
   // Every untouched field that follows this one is recomputed from the template.
   for(const other of fields)if(other.kind==='text'&&other.follows?.field===field.id&&!touched.has(other.id))next[other.id]=value===''?'':other.follows.template.replaceAll('{value}',value);
   return next;
  });
 }
 const missing=fields.some(field=>field.kind==='text'&&field.required&&!field.readOnly&&String(values[field.id]??'').trim()==='');
 return <Dialog open onOpenChange={open=>{if(!open)cancel();}}><DialogPopup><DialogTitle>{question.question}</DialogTitle>{question.detail?.length?<DialogDescription render={<div/>}>{question.detail.map((line,i)=><div key={i}>{line}</div>)}</DialogDescription>:null}
  <form onSubmit={event=>{event.preventDefault();if(missing)return;answer(values);}}>
   <div className="prompt-form">{fields.map((field,index)=>{
    const error=question.errors?.[field.id];const noteId=`${idPrefix}-${index}-note`;const errorId=`${idPrefix}-${index}-error`;
    const describedBy=[field.note?noteId:null,error?errorId:null].filter(Boolean).join(' ')||undefined;
    if(field.kind==='checkbox')return <div key={field.id} className="prompt-form-field" data-invalid={error?true:undefined}>
     <Checkbox label={field.label} checked={values[field.id]===true} disabled={field.disabled} aria-describedby={describedBy} onCheckedChange={checked=>{if(!field.disabled)setValues(prev=>({...prev,[field.id]:checked===true}));}}/>
     {field.note?<span id={noteId} className="prompt-form-note">{field.note}</span>:null}
     {error?<span id={errorId} role="alert" className="prompt-form-error">{error}</span>:null}
    </div>;
    if(!textField(field))return null;
    return <label key={field.id} className="prompt-form-field" data-invalid={error?true:undefined}>
     <span className="prompt-form-label">{field.label}{field.required&&!field.readOnly?<span aria-hidden="true"> *</span>:null}</span>
     <input aria-label={field.label} aria-describedby={describedBy} aria-invalid={error?true:undefined} className="prompt-field" value={String(values[field.id]??'')} readOnly={field.readOnly} onChange={event=>setText(field,event.target.value)}/>
     {field.note?<span id={noteId} className="prompt-form-note">{field.note}</span>:null}
     {error?<span id={errorId} role="alert" className="prompt-form-error">{error}</span>:null}
    </label>;
   })}</div>
   <div className="prompt-actions"><Button onClick={cancel}>Cancel</Button>{question.skippable?<Button onClick={()=>answer(null)}>{question.skipLabel??'Skip'}</Button>:null}<Button kind="primary" type="submit" disabled={missing}>{question.submit??'Continue'}</Button></div>
  </form></DialogPopup></Dialog>;
}
function PromptDialog({question,answer,cancel}:{question:PromptQuestion;answer:(value:string|boolean)=>void;cancel:()=>void}){
 const [value,setValue]=useState(question.default??'');const descriptionPrefix=useId();
 const backend=useBackend();const [pickError,setPickError]=useState<string|null>(null);
 async function choose(){
  setPickError(null);
  const picked=await backend.pickFolder();
  if(!picked.ok){setPickError(picked.error);return;}
  if(picked.value!==null)setValue(picked.value);
 }
 return <Dialog open onOpenChange={open=>{if(!open&&question.kind!=='confirm')cancel();}}><DialogPopup><DialogTitle>{question.question}</DialogTitle>{question.detail?.length?<DialogDescription render={<div/>}>{question.detail.map((line,i)=><div key={i}>{line}</div>)}</DialogDescription>:null}<form onSubmit={event=>{event.preventDefault();if(question.kind==='select'&&!question.choices?.includes(value))return;answer(question.kind==='confirm'?true:value);}}>{question.kind==='path'?<><div className="prompt-path"><input aria-label={question.question} value={value} onChange={event=>setValue(event.target.value)} className="prompt-field"/><Button onClick={()=>{void choose();}}>Choose folder…</Button></div>{pickError?<div role="alert" style={{fontSize:12,color:'var(--tk-bad)'}}>{pickError}</div>:null}</>:question.kind==='text'?<input aria-label={question.question} value={value} onChange={event=>setValue(event.target.value)} className="prompt-field"/>:question.kind==='select'?<div role="radiogroup" aria-label={question.question}>{question.choices?.map((choice,index)=><label key={choice} className="prompt-option"><input type="radio" name={question.question} aria-label={choice} aria-describedby={question.descriptions?.[index]?`${descriptionPrefix}-${index}`:undefined} value={choice} checked={value===choice} onChange={()=>setValue(choice)}/><span>{choice}{question.descriptions?.[index]&&<span id={`${descriptionPrefix}-${index}`} className="prompt-option-description">{question.descriptions[index]}</span>}</span></label>)}</div>:null}<div className="prompt-actions"><Button onClick={cancel}>{question.kind==='confirm'?'No':'Cancel'}</Button><Button kind="primary" type="submit" disabled={question.kind==='select'&&!question.choices?.includes(value)}>{question.kind==='confirm'?'Yes':'Continue'}</Button></div></form></DialogPopup></Dialog>;
}
