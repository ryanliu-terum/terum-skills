import { useBackend } from '../backend';
import { useEffect, useState } from 'react';
import { useUiStore } from './store';
import { HashRouter, useLocation, useRoutes, useNavigate } from 'react-router';
import { useSyncAction } from '../components/domain/useSyncAction';
import { LaunchCoordinator } from './LaunchCoordinator';
import { routes } from './routes';
function RouteView(){const location=useLocation();const setLastRoute=useUiStore(s=>s.setLastRoute);useEffect(()=>setLastRoute(location.pathname+location.search),[location.pathname,location.search,setLastRoute]);return useRoutes(routes);}
function Shortcuts(){
 const navigate=useNavigate(),location=useLocation(),sync=useSyncAction();
 useEffect(()=>{
  function key(event:KeyboardEvent){
   if(event.defaultPrevented||!event.metaKey||event.altKey||event.ctrlKey||event.shiftKey||event.repeat)return;
   if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]'))return;
   const k=event.key.toLowerCase();
   if(location.pathname.startsWith('/onboarding')&&k!=='k')return;
   if(!['k',',','r','[',']'].includes(k))return;
   event.preventDefault();
   if(k==='k')navigate('/search');else if(k===',')navigate('/settings/account');else if(k==='r')sync.open();else if(k==='[')navigate(-1);else navigate(1);
  }
  document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
 },[navigate,location.pathname,sync]);
 return sync.popup;
}
export function App(){const backend=useBackend(),[ready,setReady]=useState(!backend.prefs.ready);useEffect(()=>{void backend.prefs.ready?.then(()=>setReady(true));},[backend]);if(!ready)return null;return <HashRouter><span aria-hidden="true" style={{position:'absolute',width:0,height:0,overflow:'hidden',fontFamily:'var(--font-mono)'}}>0</span><Shortcuts/><LaunchCoordinator/><RouteView/></HashRouter>;}
