import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createTauriBackend } from '../../backend/tauri';
import { fakeBridge } from '../../backend/tauri/__tests__/fake-bridge';
import type { Surfaces } from '../../backend/types';
import { createRun } from '../../backend/mock/run';
import { Sidebar } from './Sidebar';
import { Shell } from './Shell';

afterEach(() => { cleanup(); location.hash = ''; vi.restoreAllMocks(); });

it('omits the entire Inbox group when its surface is unavailable', async () => {
  const surfaces = { ...await createMockBackend().surfaces(), inbox: false };
  render(<BackendContext value={createMockBackend()}><QueryClientProvider client={new QueryClient()}><HashRouter><Sidebar selected="Global" counts={null} machine={undefined} surfaces={surfaces}/></HashRouter></QueryClientProvider></BackendContext>);
  for (const name of ['Inbox', 'Pushes', 'Updates', 'Alerts']) expect(screen.queryByRole('link', { name })).toBeNull();
  expect(screen.getByRole('link', { name: 'Members' })).toBeVisible();
});

it.each([true, false])('renders served navigation and hides Inbox until its surface resolves: %s', async loaded => {
  const status = await createMockBackend().status();
  render(<QueryClientProvider client={new QueryClient()}><HashRouter><Sidebar selected="Global" counts={null} machine={undefined} surfaces={loaded ? await createMockBackend().surfaces() : undefined} roots={status.ok ? status.value.roots ?? undefined : undefined}/></HashRouter></QueryClientProvider>);
  for (const name of ['Global', 'Projects', 'Terum', 'SSM', 'MRF', 'Marketplace', 'Members']) expect(screen.getByRole('link', { name })).toBeVisible();
  for (const name of ['Inbox','Pushes','Updates','Alerts']) { if (loaded) expect(screen.getByRole('link',{name})).toBeVisible(); else expect(screen.queryByRole('link',{name})).toBeNull(); }
  expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
});

it('renders Global, Members and Marketplace navigation for the real adapter, retaining the settings gear', async () => {
  const backend = createTauriBackend(fakeBridge(() => undefined).bridge);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
  // The real adapter serves no project list here (status has no frames), so Projects renders empty; wait for the surfaces read.
  await waitFor(() => expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(4));
  expect(screen.getByRole('link', { name: 'Projects' })).toBeVisible();
  expect(screen.getByText('0 projects')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Add project' })).toBeNull(); // this fake CLI answers no features, so registration is not offered
  expect(screen.getByRole('link', { name: 'Global' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Marketplace' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Members' })).toBeVisible();
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
it('keys and selects same-label projects by canonical root',async()=>{
 const backend=createMockBackend(),status=await backend.status();if(!status.ok)throw new Error(status.error);
 vi.spyOn(backend,'status').mockResolvedValue({ok:true,value:{...status.value,roots:['/a/app','/b/app'].map(root=>({id:root,kind:'checkout',root,label:'app',registered:true}))}});
 await openSidebar(backend,'/b/app');
 const links=screen.getAllByRole('link',{name:'app'});
 expect(links.map(a=>a.getAttribute('href'))).toEqual(['#/library/checkout?root=%2Fa%2Fapp','#/library/checkout?root=%2Fb%2Fapp']);
 expect(links[0]).not.toHaveAttribute('aria-current');expect(links[1]).toHaveAttribute('aria-current','page');
});
/**
 * §7.2: nothing can be "detected but not registered" any more, so the per-row "+ Add" is gone. The
 * only way a project reaches this list is the Add project button, and that is the only control to hide
 * when the CLI is too old to have `project add`.
 */
it('offers no per-row Add, because every row is a project you added',async()=>{
 await openSidebar();
 await screen.findByRole('link',{name:'Terum 8'});
 expect(screen.queryByRole('button',{name:/^Add .+ to your library$/})).toBeNull();
 expect(await screen.findByRole('button',{name:'Add project'})).toBeVisible();
});
it('hides Add project when the CLI does not support it',async()=>{
 const backend=createMockBackend();
 vi.spyOn(backend,'features').mockResolvedValue({...await backend.features(),libraryProjects:false});
 await openSidebar(backend);await screen.findByRole('link',{name:'SSM 3'});
 expect(screen.queryByRole('button',{name:'Add project'})).toBeNull();
});
it.each([false,true])('shows an absent root dash only with counts enabled (hidden=%s)',async hidden=>{
 location.hash='#/library/global?__mock=missing-root';await openSidebar(createMockBackend(),'Global',hidden?null:{Global:'15'});
 expect(screen.getByRole('link',{name:hidden?'SSM':'SSM —'})).toBeVisible();
 if(hidden)expect(document.querySelectorAll('.nav-count')).toHaveLength(0);
});
it('keeps Projects and its Add button with zero projects, and says 0 projects',async()=>{
 location.hash='#/library/global?__mock=no-projects';await openSidebar();
 expect(screen.getByRole('link',{name:'Projects'})).toBeVisible();
 expect(screen.getByText('0 projects')).toBeVisible();
 expect(await screen.findByRole('button',{name:'Add project'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Terum 8'})).toBeNull();
});
it('registers the folder the chooser returns, and leaves the library alone when the chooser is cancelled',async()=>{
 const backend=createMockBackend();
 const add=vi.spyOn(backend.projects,'add');
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
 const backend=createMockBackend();
 vi.spyOn(backend.projects,'add').mockImplementation(()=>createRun(async()=>({ok:false,error:'Cannot add this folder'})));
 const pick=vi.spyOn(backend,'pickFolder').mockResolvedValue({ok:true,value:'/Users/you/code/new-project'});
 await openSidebar(backend);
 fireEvent.click(await screen.findByRole('button',{name:'Add project'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Cannot add this folder');
 pick.mockResolvedValue({ok:true,value:null});
 fireEvent.click(screen.getByRole('button',{name:'Add project'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});
it('replaces the last error rather than stacking two',async()=>{
 const backend=createMockBackend();
 const pick=vi.spyOn(backend,'pickFolder').mockResolvedValue({ok:false,error:'No folder chooser on this shell'});
 vi.spyOn(backend.projects,'add').mockImplementation(()=>createRun(async()=>({ok:false,error:'Cannot add this folder'})));
 await openSidebar(backend);
 fireEvent.click(await screen.findByRole('button',{name:'Add project'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('No folder chooser on this shell');
 pick.mockResolvedValue({ok:true,value:'/Users/you/code/new-project'});
 fireEvent.click(screen.getByRole('button',{name:'Add project'}));
 await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Cannot add this folder'));
 expect(screen.getAllByRole('alert')).toHaveLength(1);
});
it('reports a chooser failure below the Add row without calling project add',async()=>{
 const backend=createMockBackend();
 const add=vi.spyOn(backend.projects,'add');
 vi.spyOn(backend,'pickFolder').mockResolvedValue({ok:false,error:'No folder chooser on this shell'});
 await openSidebar(backend);
 fireEvent.click(await screen.findByRole('button',{name:'Add project'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('No folder chooser on this shell');
 expect(add).not.toHaveBeenCalled();
});

// sidebar-spacing (Teddy, 2026-09-10): app.css puts the 56px Team margin on
// `.sidebar-inner>.nav-group:nth-child(2)`. These pin the DOM shape that makes that selector name the Team group —
// and only the Team group — in every state the sidebar can reach.
function groupsOf(container:HTMLElement){return [...container.querySelectorAll('.sidebar-inner > .nav-group')];}

const surfaceCases:{label:string;of:(base:Surfaces)=>Surfaces|undefined}[]=[
 {label:'surfaces are still loading',of:()=>undefined},
 {label:'every surface is available',of:base=>base},
 {label:'the Inbox surface is unavailable',of:base=>({...base,inbox:false})},
 {label:'the Projects surface is unavailable',of:base=>({...base,library:false})},
 {label:'only the Marketplace row is available',of:base=>({...base,roster:false})},
 {label:'only the Members row is available',of:base=>({...base,catalog:false})},
];

it.each(surfaceCases)('renders the Team group as the second .nav-group when $label',async({of})=>{
 const surfaces=of(await createMockBackend().surfaces());
 const {container}=render(<BackendContext value={createMockBackend()}><QueryClientProvider client={new QueryClient()}><HashRouter><Sidebar selected="Global" counts={null} machine={undefined} surfaces={surfaces}/></HashRouter></QueryClientProvider></BackendContext>);
 const groups=groupsOf(container);
 expect(groups).toHaveLength(2);
 expect(groups[0]).toHaveTextContent('Library');
 expect(groups[1]).toHaveTextContent('Team');
 expect(groups[1]?.previousElementSibling).toBe(groups[0]);
});

it('renders no second .nav-group when neither Team surface is available, so nothing takes the 56px margin',async()=>{
 const surfaces={...await createMockBackend().surfaces(),catalog:false,roster:false};
 const {container}=render(<BackendContext value={createMockBackend()}><QueryClientProvider client={new QueryClient()}><HashRouter><Sidebar selected="Global" counts={null} machine={undefined} surfaces={surfaces}/></HashRouter></QueryClientProvider></BackendContext>);
 const groups=groupsOf(container);
 expect(groups).toHaveLength(1);
 expect(groups[0]).toHaveTextContent('Library');
 expect(screen.queryByRole('link',{name:'Marketplace'})).toBeNull();
 expect(screen.queryByRole('link',{name:'Members'})).toBeNull();
});

it('keeps the Inbox rows inside the Library group, so folding Inbox never changes the group count',async()=>{
 const surfaces=await createMockBackend().surfaces();
 for(const collapsed of [[],['inbox'],['projects'],['inbox','projects']]){
  const {container,unmount}=render(<BackendContext value={createMockBackend()}><QueryClientProvider client={new QueryClient()}><HashRouter><Sidebar selected="Global" counts={null} machine={undefined} surfaces={surfaces} collapsedSections={collapsed}/></HashRouter></QueryClientProvider></BackendContext>);
  expect(groupsOf(container),collapsed.join('+')||'nothing collapsed').toHaveLength(2);
  expect(groupsOf(container)[1]).toHaveTextContent('Team');
  unmount();
 }
});

it('keeps the Team group second on the real adapter, where a bare CLI answers no features',async()=>{
 const backend=createTauriBackend(fakeBridge(()=>undefined).bridge);
 const {container}=render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BackendContext value={backend}><HashRouter><Shell/></HashRouter></BackendContext></QueryClientProvider>);
 await waitFor(()=>expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(4));
 const groups=groupsOf(container);
 expect(groups).toHaveLength(2);
 expect(groups[1]).toHaveTextContent('Team');
});
