import { createContext, useContext, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router';
import { useBackend } from '../../backend';
import { useUiStore } from '../../app/store';
import { useUrlState } from '../../app/url-state';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { DialogContainer } from '../ui/Dialog';
const ShellReadyContext=createContext(true);
export function useShellReady(){return useContext(ShellReadyContext);}
export function Shell({selected='Global',counts,overlay,children,projects}:PropsWithChildren<{selected?:string;counts?:Record<string,string>|null|undefined;overlay?:ReactNode;projects?:readonly string[]|undefined}>){
 const [container,setContainer]=useState<HTMLDivElement|null>(null);
 const backend=useBackend();const state=useUrlState();const location=useLocation();const [search,setSearch]=useSearchParams();
 function param(key:string,value:string|null){const next=new URLSearchParams(search);if(value)next.set(key,value);else next.delete(key);setSearch(next);}
 function setSidebar(collapsed:boolean){useUiStore.getState().setSidebarCollapsed(collapsed);param('sidebar',collapsed?'hidden':null);}
 function toggleSection(section:string){const collapsed=!state.collapsedSections.includes(section);const saved=useUiStore.getState();saved.setCollapsedSections(collapsed?[...saved.collapsedSections,section]:saved.collapsedSections.filter(value=>value!==section));param(section,collapsed?'collapsed':null);}
 const capabilities=useQuery({queryKey:['capabilities'],queryFn:()=>backend.capabilities()});
 const features=useQuery({queryKey:['features'],queryFn:()=>backend.features()});
 const surfaces=useQuery({queryKey:['surfaces'],queryFn:()=>backend.surfaces()});
 const status=useQuery({queryKey:['status',state.mock],queryFn:({signal})=>backend.status(undefined,{signal})});
 const value=status.data?.value;
 // Keep the mock scenario when following a real shell link within this page.
 function navigate(event:React.MouseEvent<HTMLDivElement>){const target=event.target;if(!(target instanceof Element))return;const anchor=target.closest<HTMLAnchorElement>('a[href^="#/"]');if(!anchor||state.mock==='default')return;const url=anchor.hash;const [path,query='']=url.split('?');const params=new URLSearchParams(query);params.set('__mock',state.mock);anchor.href=path+'?'+params.toString();}
 return <ShellReadyContext value={!status.isPending&&!features.isPending&&!capabilities.isPending}><div ref={setContainer} className="shell" onClickCapture={navigate} data-route={location.pathname}><DialogContainer container={container}><TopBar sidebarCollapsed={state.sidebarCollapsed} onShowSidebar={()=>setSidebar(false)} mode={capabilities.data?.windowChrome??'cosmetic'} inboxAvailable={surfaces.data?.inbox===true}/><div className="shell-row">{!state.sidebarCollapsed&&<Sidebar collapsedSections={state.collapsedSections} onToggleSection={toggleSection} onHide={()=>setSidebar(true)} selected={selected} counts={counts===undefined?value?.counts??null:counts} machine={value?.machine} me={value?.me} team={value?.teams[0]} surfaces={surfaces.data} projects={projects??value?.projects??undefined}/>}<main className="panel" style={state.sidebarCollapsed?{margin:'0 8px 8px 8px'}:undefined}>{status.data?.ok===false&&<div role="alert">{status.data.error}</div>}{children}</main></div>{overlay}</DialogContainer></div></ShellReadyContext>;
}
