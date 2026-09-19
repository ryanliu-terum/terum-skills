import { useEffect, useRef, useState } from 'react';
import type { LibraryScope, Result } from '../../../backend/types';
import { useBackend } from '../../../backend';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { Dialog, DialogPopup, DialogTitle } from '../../ui/Dialog';
import { ErrorLine } from '../Primitives';
import type { ShareCardFormat } from './model';
import { shareFilename } from './model';
import { SHARE_DESTINATIONS, loadSharePng } from './load';
import type { ShareSkillSource } from './load';
import './share-skill.css';
import redditLogo from './logos/reddit.svg';
import xLogo from './logos/x.svg';
import instagramLogo from './logos/instagram.svg';
import linkedinLogo from './logos/linkedin.svg';
const logos={Reddit:redditLogo,X:xLogo,Instagram:instagramLogo,LinkedIn:linkedinLogo};

export function ShareSkillButton({skill,scope}:{skill:ShareSkillSource;scope?:LibraryScope}) {
 const [open,setOpen]=useState(false);
 return <><button type="button" className="icon-button skill-share-trigger" aria-label={'Share '+skill.name} title="Share benchmark image" onClick={event=>{event.stopPropagation();setOpen(true);}}><Icon name="external-link" size={16}/></button>{open?<ShareSkillDialog skill={skill} scope={scope} onClose={()=>setOpen(false)}/>:null}</>;
}
export function ShareSkillDialog({skill,scope,onClose}:{skill:ShareSkillSource;scope:LibraryScope|undefined;onClose:()=>void}) {
 const [format,setFormat]=useState<ShareCardFormat>('light');
 const backend=useBackend(),[attempt,setAttempt]=useState(0),[asset,setAsset]=useState<{png:Blob;url:string}|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
 const actionLock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  const controller=new AbortController();let url:string|undefined;
  void loadSharePng(backend,skill,scope,controller.signal,format).then(png=>{
   if(controller.signal.aborted)return;
   url=URL.createObjectURL(png);setAsset({png,url});
  }).catch((reason:unknown)=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Could not generate the image.');});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[backend,skill,scope,attempt,format]);
 async function perform(action:()=>Promise<Result<void>>,success:string){
  if(actionLock.current)return;actionLock.current=true;setBusy(true);setError(null);setMessage(null);
  try{const result=await action();if(!mounted.current)return;if(result.ok)setMessage(success);else if(!result.cancelled)setError(result.error);}
  catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Sharing failed. Try again.');}
  finally{actionLock.current=false;if(mounted.current)setBusy(false);}
 }
 const filename=shareFilename(skill.name,format);
 const layout=format.startsWith('horizontal')?'horizontal':'square',appearance=format.endsWith('dark')?'dark':'light';
 function choose(nextLayout:typeof layout,nextAppearance:typeof appearance){
  const next:ShareCardFormat=nextLayout==='horizontal'?(nextAppearance==='dark'?'horizontal-dark':'horizontal'):nextAppearance;
  if(next!==format){setAsset(null);setError(null);setMessage(null);setFormat(next);}
 }
 return <Dialog open onOpenChange={value=>{if(!value)onClose();}}><DialogPopup style={{width:600,maxWidth:'calc(100vw - 32px)',maxHeight:'calc(100vh - 32px)',overflow:'auto'}}>
  <div className="skill-share-heading"><DialogTitle>Share {skill.name}</DialogTitle><button type="button" className="icon-button" aria-label="Close share" onClick={onClose}><Icon name="x" size={16}/></button></div>
  <div className="skill-share-options">
   <div className="skill-share-formats" role="group" aria-label="Image layout">{(['square','horizontal'] as const).map(option=><Button key={option} disabled={busy} aria-pressed={layout===option} kind={layout===option?'primary':'secondary'} onClick={()=>choose(option,appearance)}>{option==='square'?'Square':'Horizontal'}</Button>)}</div>
   <div className="skill-share-formats" role="group" aria-label="Image appearance">{(['light','dark'] as const).map(option=><Button key={option} disabled={busy} aria-pressed={appearance===option} kind={appearance===option?'primary':'secondary'} onClick={()=>choose(layout,option)}>{option==='light'?'Light':'Dark'}</Button>)}</div>
  </div>
  {asset?<div className="skill-share-preview-frame"><img className="skill-share-preview" src={asset.url} alt={'Benchmark image for '+skill.name}/></div>:!error?<div className="skill-share-loading" role="status">Generating image…</div>:null}
  {error?<ErrorLine>{error}</ErrorLine>:null}
  {!asset&&error?<Button onClick={()=>{setError(null);setAttempt(n=>n+1);}}>Try again</Button>:null}
  {asset?<div className="skill-share-destinations" role="group" aria-label="Share destinations">
   {SHARE_DESTINATIONS.map(destination=><button type="button" className="skill-share-circle" key={destination.name} aria-label={destination.name} title={destination.name} disabled={busy} onClick={()=>void perform(async()=>{
    const prepared=destination.method==='save'?await backend.saveImage(asset.png,filename):await backend.copyImage(asset.png);if(!prepared.ok)return prepared;
    return backend.openUrl(destination.url);
   },destination.method==='save'?`PNG saved. Upload it to a new ${destination.name} post.`:`Image copied. Paste it into your ${destination.name} post.`)}><img className="skill-share-platform-logo" src={logos[destination.name]} alt="" aria-hidden="true"/></button>)}
   <span className="skill-share-action-divider" aria-hidden="true"/>
   <button type="button" className="skill-share-circle" aria-label="Copy image" title="Copy image" disabled={busy} onClick={()=>void perform(()=>backend.copyImage(asset.png),'Image copied.')}><Icon name="copy" size={22}/></button>
   <button type="button" className="skill-share-circle" aria-label="Save PNG" title="Save PNG" disabled={busy} onClick={()=>void perform(()=>backend.saveImage(asset.png,filename),'PNG saved.')}><Icon name="arrow-down-to-line" size={22}/></button>
   {backend.canShareImage(asset.png)?<button type="button" className="skill-share-circle" aria-label="More sharing options" title="More sharing options" disabled={busy} onClick={()=>void perform(()=>backend.shareImage(asset.png,filename),'Share sheet opened.')}><Icon name="more" size={22}/></button>:null}
  </div>:null}
  {message?<p className="skill-share-notice" role="status">{message}</p>:null}
 </DialogPopup></Dialog>;
}
