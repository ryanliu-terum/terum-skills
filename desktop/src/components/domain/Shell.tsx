import { createContext, useContext, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { useBackend } from '../../backend';
import { useUrlState } from '../../app/url-state';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { DialogContainer } from '../ui/Dialog';
const ShellReadyContext=createContext(true);
export function useShellReady(){return useContext(ShellReadyContext);}
export function Shell({selected='Global',counts,overlay,children}:PropsWithChildren<{selected?:string;counts?:Record<string,string>|null|undefined;overlay?:ReactNode}>){
 const [container,setContainer]=useState<HTMLDivElement|null>(null);
 const backend=useBackend();const state=useUrlState();const location=useLocation();
 const capabilities=useQuery({queryKey:['capabilities'],queryFn:()=>backend.capabilities()});
 const status=useQuery({queryKey:['status',state.mock],queryFn:()=>backend.status()});
 const value=status.data?.ok?status.data.value:undefined;
 // Keep the mock scenario when following a real shell link within this page.
 function navigate(event:React.MouseEvent<HTMLDivElement>){const target=event.target;if(!(target instanceof Element))return;const anchor=target.closest<HTMLAnchorElement>('a[href^="#/"]');if(!anchor||state.mock==='default')return;const url=anchor.hash;const [path,query='']=url.split('?');const params=new URLSearchParams(query);params.set('__mock',state.mock);anchor.href=path+'?'+params.toString();}
 return <ShellReadyContext value={!status.isPending}><div ref={setContainer} className="shell" onClickCapture={navigate} data-route={location.pathname}><DialogContainer container={container}><TopBar mode={capabilities.data?.windowChrome??'cosmetic'}/><div className="shell-row"><Sidebar selected={selected} counts={counts===undefined?value?.counts??null:counts} machine={value?.machine}/><main className="panel">{children}</main></div>{overlay}</DialogContainer></div></ShellReadyContext>;
}
