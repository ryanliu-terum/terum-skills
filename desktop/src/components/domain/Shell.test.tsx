import { it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useLayoutEffect } from 'react';
import { HashRouter } from 'react-router';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { useUiStore } from '../../app/store';
import { Shell } from './Shell';
import { ScreenFrame } from './ScreenFrame';
import { TopBar } from './TopBar';
afterEach(()=>{cleanup();location.hash='';useUiStore.getState().setTheme('dark');vi.restoreAllMocks();});
it('renders the frame shell, selected Global, sidebar and fixture machine identity',async()=>{location.hash='#/frame';render(<Providers><App/></Providers>);expect(screen.getByRole('main')).toBeInTheDocument();expect(await screen.findByText('teniroo')).toBeInTheDocument();expect(screen.getByText('teddy-mbp')).toBeInTheDocument();for(const name of ['Global','Projects','Terum','SSM','MRF','Pushes','Updates','Alerts','Marketplace','Share'])expect(screen.getByRole('link',{name:new RegExp(name)})).toBeInTheDocument();const global=screen.getByRole('link',{name:/Global/});expect(global).toHaveAttribute('aria-current','page');expect(global.style.background).toBe('var(--tk-bg3)');expect(document.documentElement.dataset.appReady).toBe('true');cleanup();expect(document.documentElement.dataset.appReady).toBeUndefined();});
it('supports all capability-driven chrome modes',()=>{const view=render(<TopBar mode="cosmetic"/>);expect(view.container.querySelectorAll('[aria-hidden="true"] div')).toHaveLength(3);view.rerender(<TopBar mode="mac-overlay"/>);expect(view.container.querySelector('.topbar-left')?.firstElementChild).toHaveStyle({width:'78px'});view.rerender(<TopBar mode="drawn-controls"/>);expect(view.container.querySelectorAll('.window-controls span')).toHaveLength(3);});
it('renders backend failures as visible alerts',async()=>{location.hash='#/library/global?__mock=error';render(<Providers><App/></Providers>);expect(await screen.findByRole('alert')).toHaveTextContent("EACCES: permission denied, scandir '~/.terum/skills'");expect(document.querySelector('[data-error-boundary]')).toBeNull();});

it('retains footer identity while Library error counts are hidden',async()=>{
 location.hash='#/library/global?__mock=error';render(<Providers><App/></Providers>);
 expect(await screen.findByText('teniroo')).toBeInTheDocument();expect(screen.getByText('teddy-mbp')).toBeInTheDocument();
 expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
});
it.each([
 ['/library/global','loading',null],['/library/global','error',null],['/library/global','empty',['0','22','15','32','3','3','8']],
 ['/skill/deploy-check','loading',null],['/skill/deploy-check','error',['30','22','15','32','3','3','8']],
 ['/inbox','loading',null],['/inbox','error',null],['/inbox','empty',['30','22','15','32']],
 ['/marketplace','loading',null],['/marketplace','error',['30','22','15','32','3','3','8']],
 ['/marketplace?q=missing','default',['30','22','15','32','3','3','8']],
 ['/share','loading',null],['/share','error',null],['/share','empty',['30','22','15','32','3','3','8']],
 ['/settings/account','loading',null],['/settings/account','error',null],
] as const)('uses board counts for %s %s',async(route,scenario,counts)=>{
 location.hash='#'+route+(route.includes('?')?'&':'?')+'__mock='+scenario;
 render(<Providers><App/></Providers>);await screen.findByText('teniroo');
 expect([...document.querySelectorAll('.nav-count')].map(node=>node.textContent)).toEqual(counts??[]);
});
it.each(['loading','error','empty','default'])('onboarding %s has a main landmark and no sidebar',scenario=>{
 location.hash='#/onboarding/welcome?__mock='+scenario;render(<Providers><App/></Providers>);
 expect(screen.getByRole('main')).toBeVisible();expect(document.querySelector('aside')).toBeNull();
 expect(screen.queryByRole('complementary')).toBeNull();expect(screen.queryByRole('navigation')).toBeNull();
});
it.each([undefined,null,{Global:'99'}])('treats explicit Shell counts as authoritative: %j',async counts=>{
 location.hash='#/frame?__mock=error';render(<Providers><HashRouter><Shell counts={counts}><ScreenFrame/></Shell></HashRouter></Providers>);
 await screen.findByText('teniroo');expect([...document.querySelectorAll('.nav-count')].map(node=>node.textContent)).toEqual(counts===undefined?['30','22','15','32','3','3','8']:counts===null?[]:['99']);
});
it('marks a light frame ready only after the URL theme is applied and status resolves',async()=>{
 useUiStore.getState().setTheme('dark');location.hash='#/frame?theme=light';
 const backend=createMockBackend();const status=await backend.status();
 let resolve!: (value:typeof status)=>void;
 vi.spyOn(backend,'status').mockImplementation(()=>new Promise(done=>{resolve=done;}));
 const snapshots:{ready:string|undefined;theme:string|undefined}[]=[];
 function Probe(){useLayoutEffect(()=>{snapshots.push({ready:document.documentElement.dataset.appReady,theme:document.documentElement.dataset.theme});},[]);return null;}
 const root=document.documentElement;
 const changes:MutationRecord[]=[];const observer=new MutationObserver(records=>changes.push(...records));
 observer.observe(root,{attributes:true,attributeOldValue:true,attributeFilter:['data-app-ready','data-theme']});
 try{
  render(<Providers><BackendContext value={backend}><App/><Probe/></BackendContext></Providers>);
  expect(snapshots).toEqual([{ready:undefined,theme:'dark'}]);
  await waitFor(()=>expect(root.dataset.theme).toBe('light'));
  expect(root.dataset.appReady).toBeUndefined();
  await act(async()=>resolve(status));
  await waitFor(()=>expect(root.dataset.appReady).toBe('true'));
  changes.push(...observer.takeRecords());
  let theme:string|null='dark';let sawReady=false;
  for(const [index,change] of changes.entries()){
   const attribute=change.attributeName;if(!attribute)throw new Error('Expected attribute mutation');
   const next=changes.slice(index+1).find(record=>record.attributeName===attribute);
   const value=next?next.oldValue:root.getAttribute(attribute);
   if(attribute==='data-theme')theme=value;
   if(attribute==='data-app-ready'&&value==='true'){expect(theme).toBe('light');sawReady=true;}
  }
  expect(sawReady).toBe(true);
 }finally{observer.disconnect();}
});
it('waits for a rejected status query to settle before marking the frame ready',async()=>{
 location.hash='#/frame';const backend=createMockBackend();let reject!:(reason:Error)=>void;
 vi.spyOn(backend,'status').mockImplementation(()=>new Promise((_resolve,fail)=>{reject=fail;}));
 render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 expect(document.documentElement.dataset.appReady).toBeUndefined();
 await act(async()=>reject(new Error('Status unavailable')));
 await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));
 expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
});
