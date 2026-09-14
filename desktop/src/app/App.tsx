import { useBackend, useCapabilities } from '../backend';
import { ctrlIsShortcutModifier } from '../lib/shortcuts';
import { useContext, useEffect, useState } from 'react';
import { ThemeOverrideContext, themeOverride } from './theme-override';
import { useUiStore } from './store';
import { HashRouter, useLocation, useRoutes, useNavigate } from 'react-router';
import { useSyncAction } from '../components/domain/useSyncAction';
import { LaunchCoordinator } from './LaunchCoordinator';
import { routes } from './routes';
import { MachineRemovalHost } from './MachineRemovalHost';
import { EvalRunDialogHost } from './EvalRunDialogHost';
function RouteView(){const location=useLocation(),setOverride=useContext(ThemeOverrideContext);useEffect(()=>{setOverride(themeOverride(location.search));},[location.search,setOverride]);const setLastRoute=useUiStore(s=>s.setLastRoute);useEffect(()=>setLastRoute(location.pathname+location.search),[location.pathname,location.search,setLastRoute]);return useRoutes(routes);}
function Shortcuts(){
 const navigate=useNavigate(),location=useLocation(),sync=useSyncAction();
 // Which modifier fires these is platform-shaped, so it comes from the seam's windowChrome and never
 // from a platform probe (AGENTS invariant 1). Every shortcut here answers to the same one: ⌘ alone on
 // macOS, Ctrl as well everywhere else — which is why ⌘K did nothing on Windows before this.
 const ctrl=ctrlIsShortcutModifier(useCapabilities()?.windowChrome);
 useEffect(()=>{
  function key(event:KeyboardEvent){
   const modifier=event.metaKey||(ctrl&&event.ctrlKey);
   // Both modifiers at once is a chord this app does not bind, not a sloppy ⌘.
   if(event.defaultPrevented||!modifier||(event.metaKey&&event.ctrlKey)||event.altKey||event.shiftKey||event.repeat)return;
   if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]'))return;
   const k=event.key.toLowerCase();
   if(location.pathname.startsWith('/onboarding')&&k!=='k')return;
   if(!['k',',','r','[',']'].includes(k))return;
   event.preventDefault();
   if(k==='k')navigate('/search');else if(k===',')navigate('/settings/account');else if(k==='r')sync.open();else if(k==='[')navigate(-1);else navigate(1);
  }
  document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
 },[navigate,location.pathname,sync,ctrl]);
 return sync.popup;
}
export function App(){const backend=useBackend(),[ready,setReady]=useState(!backend.prefs.ready);useEffect(()=>{void backend.prefs.ready?.then(()=>setReady(true));},[backend]);if(!ready)return null;return <HashRouter><span aria-hidden="true" style={{position:'absolute',width:0,height:0,overflow:'hidden',fontFamily:'var(--font-mono)'}}>0</span><Shortcuts/><LaunchCoordinator/><RouteView/><EvalRunDialogHost/><MachineRemovalHost/></HashRouter>;}
