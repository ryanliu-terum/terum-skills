import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createTauriBackend } from '../../backend/tauri';
import { fakeBridge } from '../../backend/tauri/__tests__/fake-bridge';
import { createRun } from '../../backend/mock/run';
import { Sidebar } from './Sidebar';
import { Shell } from './Shell';

afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

it('omits the entire Inbox group when its surface is unavailable', async () => {
  const surfaces = { ...await createMockBackend().surfaces(), inbox: false };
  render(<BackendContext value={createMockBackend()}><QueryClientProvider client={new QueryClient()}><HashRouter><Sidebar selected="Global" counts={null} machine={undefined} surfaces={surfaces}/></HashRouter></QueryClientProvider></BackendContext>);
  for (const name of ['Inbox', 'Pushes', 'Updates', 'Alerts']) expect(screen.queryByRole('link', { name })).toBeNull();
  expect(screen.getByRole('link', { name: 'Share' })).toBeVisible();
});

it.each([true, false])('renders served navigation and hides Inbox until its surface resolves: %s', async loaded => {
  const status = await createMockBackend().status();
  render(<QueryClientProvider client={new QueryClient()}><HashRouter><Sidebar selected="Global" counts={null} machine={undefined} surfaces={loaded ? await createMockBackend().surfaces() : undefined} roots={status.ok ? status.value.roots ?? undefined : undefined}/></HashRouter></QueryClientProvider>);
  for (const name of ['Global', 'Projects', 'Terum', 'SSM', 'MRF', 'Marketplace', 'Share']) expect(screen.getByRole('link', { name })).toBeVisible();
  for (const name of ['Inbox','Pushes','Updates','Alerts']) { if (loaded) expect(screen.getByRole('link',{name})).toBeVisible(); else expect(screen.queryByRole('link',{name})).toBeNull(); }
  expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
});

it('renders Global, Share and Marketplace navigation for the real adapter, retaining the settings gear', async () => {
  const backend = createTauriBackend(fakeBridge(() => undefined).bridge);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
  // The real adapter serves no project list here (status has no frames), so Projects renders empty; wait for the surfaces read.
  await waitFor(() => expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(4));
  expect(screen.getByRole('link', { name: 'Projects' })).toBeVisible();
  expect(screen.getByText('0 projects')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Add project' })).toBeNull(); // this fake CLI answers no features, so registration is not offered
  expect(screen.getByRole('link', { name: 'Global' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Marketplace' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Share' })).toBeVisible();
  expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
  expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible();
});

it('reads sidebar counts from the served status counts and roots and omits missing counts', async () => {
  const backend = createMockBackend();
  const status = await backend.status();
  if (!status.ok) throw new Error(status.error);
  vi.spyOn(backend, 'status').mockResolvedValue({ ok: true, value: { ...status.value, counts: { Global: '917', Pushes: '0' } } });
  render(<QueryClientProvider client={new QueryClient()}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole('link', { name: 'Global 917' })).toBeVisible());
  expect([...document.querySelectorAll('.nav-count')].map(node => node.textContent)).toEqual(['917', '8', '3', '2', '0']);
});

it('passes the query signal to status and aborts it when the shell unmounts', async () => {
  const backend = createMockBackend();
  let signal: AbortSignal | undefined;
  vi.spyOn(backend, 'status').mockImplementation((_query, options) => { signal = options?.signal; return new Promise(() => {}); });
  const view = render(<QueryClientProvider client={new QueryClient()}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
  expect(signal).toBeDefined();
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it('renders no Global number when the served status omits its count', async () => {
 const backend=createMockBackend();
 const status=await backend.status();
 if(!status.ok)throw new Error(status.error);
 vi.spyOn(backend,'status').mockResolvedValue({ok:true,value:{...status.value,counts:{Pushes:'2'}}});
 render(<QueryClientProvider client={new QueryClient()}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
 await screen.findByRole('link',{name:'Pushes 2'});
 const global=screen.getByRole('link',{name:'Global'});
 expect(global).toHaveTextContent(/^Global$/);
 expect(global.querySelector('.nav-count')).toBeNull();
});

function openSidebar(backend=createMockBackend(),selected='Global',counts:Record<string,string>|null={Global:'15'}) {
 return backend.status().then(status=>{if(!status.ok)throw new Error(status.error);return render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient()}><HashRouter><Sidebar selected={selected} roots={status.value.roots} counts={counts} machine={undefined}/></HashRouter></QueryClientProvider></BackendContext>);});
}
it('keys and selects same-label checkouts by canonical root',async()=>{
 const backend=createMockBackend(),status=await backend.status();if(!status.ok)throw new Error(status.error);
 vi.spyOn(backend,'status').mockResolvedValue({ok:true,value:{...status.value,roots:['/a/app','/b/app'].map(root=>({id:root,kind:'checkout',root,label:'app',registered:true,detected:false}))}});
 await openSidebar(backend,'/b/app');
 const links=screen.getAllByRole('link',{name:'app'});
 expect(links.map(a=>a.getAttribute('href'))).toEqual(['#/library/checkout?root=%2Fa%2Fapp','#/library/checkout?root=%2Fb%2Fapp']);
 expect(links[0]).not.toHaveAttribute('aria-current');expect(links[1]).toHaveAttribute('aria-current','page');
});
it('adds a detected root without navigating and shows errors below its row',async()=>{
 location.hash='#/library/global?__mock=detected-root';const backend=createMockBackend();
 const add=vi.spyOn(backend.checkouts,'add').mockImplementation(()=>createRun(async()=>({ok:false,error:'Cannot register this folder'})));
 await openSidebar(backend);fireEvent.click(await screen.findByRole('button',{name:'Add SSM to your library'}));
 expect(add).toHaveBeenCalledWith('/Users/you/code/ssm');expect(await screen.findByRole('alert')).toHaveTextContent('Cannot register this folder');
 expect(screen.getByRole('alert').previousElementSibling).toHaveTextContent('SSM');
 expect(location.hash).toBe('#/library/global?__mock=detected-root');
});
it('hides detected Add when the CLI does not support registration',async()=>{
 location.hash='#/library/global?__mock=detected-root';const backend=createMockBackend();
 vi.spyOn(backend,'features').mockResolvedValue({...await backend.features(),checkouts:false});
 await openSidebar(backend);await screen.findByRole('link',{name:'SSM 3'});
 expect(screen.queryByRole('button',{name:'Add SSM to your library'})).toBeNull();

 expect(screen.queryByRole('button',{name:'Add project'})).toBeNull();
});
it.each([false,true])('shows an absent root dash only with counts enabled (hidden=%s)',async hidden=>{
 location.hash='#/library/global?__mock=missing-root';await openSidebar(createMockBackend(),'Global',hidden?null:{Global:'15'});
 expect(screen.getByRole('link',{name:hidden?'SSM':'SSM —'})).toBeVisible();
 if(hidden)expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
});
it('keeps Projects and its Add button with zero checkouts, and says 0 projects',async()=>{
 location.hash='#/library/global?__mock=no-projects';await openSidebar();
 expect(screen.getByRole('link',{name:'Projects'})).toBeVisible();
 expect(screen.getByText('0 projects')).toBeVisible();
 expect(await screen.findByRole('button',{name:'Add project'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Terum 8'})).toBeNull();
});
it('registers the folder the chooser returns, and leaves the library alone when the chooser is cancelled',async()=>{
 const backend=createMockBackend();
 const add=vi.spyOn(backend.checkouts,'add');
 const pick=vi.spyOn(backend,'pickFolder').mockResolvedValue({ok:true,value:null});
 await openSidebar(backend);
 fireEvent.click(await screen.findByRole('button',{name:'Add project'}));
 await waitFor(()=>expect(pick).toHaveBeenCalled());
 expect(add).not.toHaveBeenCalled();
 pick.mockResolvedValue({ok:true,value:'/Users/you/code/new-project'});
 fireEvent.click(await screen.findByRole('button',{name:'Add project'}));
 await waitFor(()=>expect(add).toHaveBeenCalledWith('/Users/you/code/new-project'));
});
it('clears a failed add error when the next sidebar action starts, even a cancelled chooser',async()=>{
 location.hash='#/library/global?__mock=detected-root';const backend=createMockBackend();
 vi.spyOn(backend.checkouts,'add').mockImplementation(()=>createRun(async()=>({ok:false,error:'Cannot register this folder'})));
 vi.spyOn(backend,'pickFolder').mockResolvedValue({ok:true,value:null});
 await openSidebar(backend);
 fireEvent.click(await screen.findByRole('button',{name:'Add SSM to your library'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Cannot register this folder');
 fireEvent.click(screen.getByRole('button',{name:'Add project'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});
it('moves the error to the action that failed last, never stacking two',async()=>{
 location.hash='#/library/global?__mock=detected-root';const backend=createMockBackend();
 vi.spyOn(backend,'pickFolder').mockResolvedValue({ok:false,error:'No folder chooser on this shell'});
 vi.spyOn(backend.checkouts,'add').mockImplementation(()=>createRun(async()=>({ok:false,error:'Cannot register this folder'})));
 await openSidebar(backend);
 fireEvent.click(await screen.findByRole('button',{name:'Add project'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('No folder chooser on this shell');
 fireEvent.click(screen.getByRole('button',{name:'Add SSM to your library'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Cannot register this folder'));
 expect(screen.getAllByRole('alert')).toHaveLength(1);
 expect(screen.getByRole('alert').previousElementSibling).toHaveTextContent('SSM');
});
it('reports a chooser failure below the Add row without calling checkout add',async()=>{
 const backend=createMockBackend();
 const add=vi.spyOn(backend.checkouts,'add');
 vi.spyOn(backend,'pickFolder').mockResolvedValue({ok:false,error:'No folder chooser on this shell'});
 await openSidebar(backend);
 fireEvent.click(await screen.findByRole('button',{name:'Add project'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('No folder chooser on this shell');
 expect(add).not.toHaveBeenCalled();
});
