import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as testingRender, screen, waitFor } from '@testing-library/react';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { TopBar } from './TopBar';
import type { Capabilities } from '../../backend/types';
const clients:QueryClient[]=[];
function render(node:ReactNode,client=new QueryClient()) {clients.push(client);return testingRender(node,{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});}
afterEach(()=>{cleanup();for(const client of clients)client.clear();clients.length=0;vi.restoreAllMocks();location.hash='';});
it.each([['cosmetic',76],['mac-overlay',76],['native',16]] as const)('%s keeps the mark slot at x=%i', (mode:Capabilities['windowChrome'],expected)=>{
 const css=readFileSync('src/styles/app.css','utf8');
 const rule=css.match(/\.topbar-left \{[^}]+\}/)?.[0];expect(rule).toBeDefined();
 const {container}=render(<><style>{rule}</style><TopBar mode={mode}/></>);
 const left=container.querySelector<HTMLElement>('.topbar-left')!,mark=left.querySelector('.mark-slot')!;
 const style=getComputedStyle(left),before=Array.from(left.children).slice(0,Array.from(left.children).indexOf(mark));
 const widths=before.map(el=>{const element=el as HTMLElement;if(element.style.width)return parseFloat(element.style.width);const children=Array.from(element.children) as HTMLElement[];return children.reduce((sum,child)=>sum+parseFloat(child.style.width),0)+(children.length-1)*parseFloat(element.style.gap);});
 // jsdom has no layout engine: assert the CSS box-model inputs and their resulting x-coordinate.
 expect(parseFloat(style.paddingLeft)+widths.reduce((a,b)=>a+b,0)+before.length*parseFloat(style.gap)).toBe(expected);
 expect(container.querySelector('.window-controls')).toBeNull();
 expect(before).toHaveLength(mode==='native'?0:1);
});
it('routes drag and double click through the seam only on empty native regions',()=>{
 const backend=createMockBackend(),action=vi.spyOn(backend,'windowAction');const {container,rerender}=render(<BackendContext value={backend}><TopBar mode="mac-overlay"/></BackendContext>);
 const empty=container.querySelector('.topbar-right')!;
 expect(empty).toHaveAttribute('data-tauri-drag-region');fireEvent.mouseDown(empty,{button:0,detail:1});fireEvent.doubleClick(empty);
 expect(action.mock.calls).toEqual([['start-drag'],['toggle-maximize']]);
 fireEvent.doubleClick(screen.getByRole('button',{name:'Back'}));expect(action).toHaveBeenCalledTimes(2);
 rerender(<BackendContext value={backend}><TopBar mode="cosmetic"/></BackendContext>);fireEvent.doubleClick(container.querySelector('.topbar-right')!);expect(action).toHaveBeenCalledTimes(2);
});
it('keeps OS decorations and the locked minimum dimensions, with macOS overlay settings',()=>{
 const config=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
 expect(config.app.windows[0]).toMatchObject({decorations:true,minWidth:960,minHeight:600,titleBarStyle:'Overlay',hiddenTitle:true,trafficLightPosition:{x:16,y:14}});
 const permissions=JSON.parse(readFileSync('src-tauri/capabilities/default.json','utf8')).permissions;
 expect(permissions).toContain('core:window:allow-toggle-maximize');expect(permissions).toContain('core:window:allow-internal-toggle-maximize');
 expect(permissions).not.toContain('opener:default');expect(permissions).toContainEqual({identifier:'opener:allow-open-url',allow:[{url:'https://github.com/*'},{url:'https://discord.gg/*'}]});
});

it.each(['absent','available','ready','unsupported','current','checking','mock'] as const)('update chip: %s',async state=>{
 const backend=createMockBackend();
 vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),appUpdate:state!=='mock'});
 const check=vi.spyOn(backend.appUpdate,'check'),client=new QueryClient();
 client.setQueryData(['surfaces'],await backend.surfaces());
 if(state!=='absent')client.setQueryData(['app-update'],{ok:true,value:{supported:state!=='unsupported',newer:state!=='current',latest:'0.12.2',staged:state==='ready'?'0.12.2':null}});
 if(state==='checking')void client.fetchQuery({queryKey:['app-update'],queryFn:()=>new Promise(()=>{})}).catch(()=>{/* Clearing this deliberately pending check cancels it. */});
 render(<BackendContext value={backend}><TopBar mode="cosmetic"/></BackendContext>,client);
 await waitFor(()=>expect(backend.surfaces).toHaveBeenCalled());
 if(state==='available'||state==='ready'){
  const chip=await screen.findByRole('button',{name:`Update ${state==='ready'?'ready':'available'} · 0.12.2`});
  expect(chip).toHaveClass('eval-chip','update-chip');fireEvent.click(chip);expect(location.hash).toBe('#/settings/updates');
 }else expect(screen.queryByRole('button',{name:/Update (ready|available)/})).toBeNull();
 expect(check).not.toHaveBeenCalled();
});

it('reflects staging changes in the launch cache without invoking a check',async()=>{
 const backend=createMockBackend(),check=vi.spyOn(backend.appUpdate,'check'),client=new QueryClient();
 client.setQueryData(['surfaces'],{...await backend.surfaces(),appUpdate:true});
 client.setQueryData(['app-update'],{ok:true,value:{supported:true,newer:true,latest:'0.12.2',staged:null}});
 render(<BackendContext value={backend}><TopBar mode="cosmetic"/></BackendContext>,client);
 expect(screen.getByRole('button',{name:'Update available · 0.12.2'})).toBeVisible();
 act(()=>{client.setQueryData(['app-update'],{ok:true,value:{supported:true,newer:true,latest:'0.12.2',staged:'0.12.2'}});});
 expect(screen.getByRole('button',{name:'Update ready · 0.12.2'})).toBeVisible();expect(check).not.toHaveBeenCalled();
});
