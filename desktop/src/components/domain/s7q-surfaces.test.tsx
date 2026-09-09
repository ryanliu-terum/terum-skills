import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import type { Capabilities, FeatureKey, Features } from '../../backend/types';
import { createMockBackend } from '../../backend/mock';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { fakeBridge } from '../../backend/tauri/__tests__/fake-bridge';
import { createTauriBackend } from '../../backend/tauri';
import { Mark } from '../../screens/marketplace/market-components';

beforeEach(()=>{localStorage.clear();useUiStore.setState({railOpen:true,overviewHidden:false,theme:'dark'});});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});
async function open(route:string){
 const backend=createMockBackend();const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 client.setQueryData(['features'],await backend.features());client.setQueryData(['capabilities'],await backend.capabilities());
 location.hash='#'+route;
 const view=render(<QueryClientProvider client={client}><BackendContext value={backend}><App/></BackendContext></QueryClientProvider>);
 await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));
 return {backend,client,...view};
}
// Round-trip each flag on the mounted board: false degrades its surface; true restores its exact markup.
// Base UI allocates new IDs when a hidden control remounts; only those opaque IDs are normalized.
const html=(selector:string)=>Array.from(document.querySelectorAll(selector)).map(el=>el.outerHTML.replace(/(?:id|aria-labelledby|aria-controls|aria-describedby)="[^"]*"/g,'id="opaque"')).join('');
type Case={key:FeatureKey|keyof Capabilities;cap?:boolean;route:string;selector:string;absentText?:string;falseText?:string};
const cases:Case[]=[
 {key:'favorites',route:'/library/global',selector:'[aria-label="Favorite deploy-check"]'},
 {key:'favorites',route:'/skill/deploy-check',selector:'[aria-label="Favorite skill"]'},
 {key:'favorites',route:'/marketplace/projects/terum',selector:'.market-favorite'},
 {key:'follow',route:'/marketplace/people',selector:'.market-follow'},
 {key:'follow',route:'/marketplace/people/ryan',selector:'.market-follow',absentText:'Followers'},
 {key:'roles',route:'/share',selector:'.member-role'},
 {key:'memberRole',route:'/share',selector:'[data-testid="member-row-0"] .member-identity',falseText:'Ryan Liu'},
 {key:'memberRole',route:'/marketplace/people',selector:'.market-person-ident',absentText:'founder'},
 {key:'lastSeen',route:'/share',selector:'.member-row:not([data-testid="invited-row"]) > [role="cell"]:last-child',falseText:'—'},
 {key:'installScope',route:'/skill/deploy-check?__mock=not-installed&dialog=install',selector:'.skill-install-scopes',falseText:'Global'},
 {key:'inviteScoping',route:'/share?dialog=invite',selector:'.invite-scopes',absentText:'Invite scoping'},
 {key:'disablePerMachine',cap:true,route:'/library/global',selector:'[aria-label="Enable deploy-check"]'},
 {key:'disablePerMachine',cap:true,route:'/skill/deploy-check?__mock=disabled',selector:'[aria-label="Enable skill"]',absentText:'On disk, not loaded'},
 {key:'projectMembers',route:'/marketplace/projects/terum',selector:'.market-project-heading .board-facepile'},
 {key:'memberRole',route:'/share',selector:'.member-row:not([data-testid="invited-row"]) > [role="cell"]:nth-child(4)',falseText:'—'},
 {key:'liftOnCards',route:'/library/global',selector:'[data-testid="skill-card-deploy-check"] .lift-figure',falseText:'—'},
 {key:'runEvalInApp',route:'/skill/deploy-check?tab=evals',selector:'.tab-head button'},
 {key:'runEvalInApp',route:'/skill/deploy-check?tab=evals&dialog=run-eval',selector:'[role="dialog"]'},
 {key:'perCaseEvalTables',cap:true,route:'/skill/deploy-check?tab=evals',selector:'.report-block:has(.report-caption) .board-table',falseText:'per-case'},
 {key:'perCaseEvalTables',cap:true,route:'/inbox/eval-deploy-check',selector:'.report-block:has(.report-caption) .board-table',falseText:'per-case'},
 {key:'offtargetKind',cap:true,route:'/inbox',selector:'[data-testid="inbox-row-alert-offtarget-deploy-check"]'},
 {key:'offtargetKind',cap:true,route:'/settings/inbox',selector:'[aria-label="Alert"]'},
 {key:'machineRegistry',cap:true,route:'/settings/machine',selector:'.footer-machine',falseText:'—',absentText:'Other machines'},
];
it.each(cases)('$key: $route hides/degrades false and restores the true DOM',async c=>{
 const {client}=await open(c.route);
 // Dialogs and detail reads may mount after the shell has settled.
 await waitFor(()=>expect(document.querySelector(c.selector)).not.toBeNull());
 const before=html(c.selector);expect(before).not.toBe('');
 const queryKey=c.cap?'capabilities':'features';const original=client.getQueryData<Features|Capabilities>([queryKey])!;
 await act(async()=>{client.setQueryData([queryKey],{...original,[c.key]:false});});
 await waitFor(()=>{
  if(c.key==='perCaseEvalTables'){
   expect(screen.getByText('Per-case rows are not in the committed receipt.')).toBeVisible();
   expect(screen.queryByText('Per-case check pass rate and round record, candidate vs baseline.',{exact:false})).toBeNull();
  }else if(c.key==='memberRole'){
   expect(html(c.selector)).not.toContain('founder');expect(html(c.selector)).not.toBe(before);
  }else if(c.falseText){
   expect(document.querySelector(c.selector)).toHaveTextContent(c.falseText);
   if(c.key==='liftOnCards')expect(document.querySelector(c.selector)?.querySelector('.chip')).toBeNull();
   if(c.key==='installScope'){expect(screen.queryAllByRole('radio')).toHaveLength(0);expect(document.querySelector(c.selector)).toHaveStyle({height:'123px'});}
  }else expect(document.querySelector(c.selector)).toBeNull();
  if(c.absentText)expect(screen.queryByText(c.absentText)).toBeNull();
 });
 if(c.key==='lastSeen')expect(screen.getByRole('columnheader',{name:'Last seen'})).toBeVisible();
 if(c.key==='disablePerMachine'&&c.route.includes('/skill/'))expect(screen.getByText('Loaded in every session')).toBeVisible();
 await act(async()=>{client.setQueryData([queryKey],original);});
 await waitFor(()=>expect(html(c.selector)).toBe(before));
});
it('never reads a favorite preference when favorites are false',async()=>{
 const backend=createMockBackend();const library=await backend.library({scope:{kind:'global'}});if(!library.ok)throw new Error(library.error);
 vi.spyOn(backend,'library').mockResolvedValue(library);const pref=vi.spyOn(backend.prefs,'get');
 const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity}}});client.setQueryData(['features'],{...await backend.features(),favorites:false});
 location.hash='#/library/global';render(<QueryClientProvider client={client}><BackendContext value={backend}><App/></BackendContext></QueryClientProvider>);
 await screen.findByTestId('skill-card-deploy-check');expect(pref.mock.calls.filter(([key])=>key.startsWith('favorite'))).toEqual([]);
});
it('opens the skill deep link through the backend',async()=>{
 const {backend}=await open('/skill/deploy-check');const openUrl=vi.spyOn(backend,'openUrl').mockResolvedValue({ok:true,value:undefined});
 const result=await backend.skill({ref:'deploy-check'});if(!result.ok)throw new Error(result.error);
 const s=result.value,url=`https://github.com/${s.repo}/tree/${s.version_full}/skills/${s.name}/`;
 const anchor=document.querySelector<HTMLAnchorElement>('.detail-repo a')!;expect(anchor.href).toBe(url);fireEvent.click(anchor);expect(openUrl).toHaveBeenCalledWith(url);
});
it('opens the project remote, with no hard-coded repository target',async()=>{
 const {backend}=await open('/marketplace/projects/terum');const call=vi.spyOn(backend,'openUrl').mockResolvedValue({ok:true,value:undefined});
 const anchor=document.querySelector<HTMLAnchorElement>('.market-repo a')!;expect(anchor.href).toBe('https://github.com/terum/terum');fireEvent.click(anchor);expect(call).toHaveBeenCalledWith(anchor.href);
});
it('Connect opens the bare connect picker through the Prompter',async()=>{
 location.hash='#/library/global';const backend=createMockBackend(),call=vi.spyOn(backend,'connect');
 render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect'}));
 expect(await screen.findByRole('dialog')).toHaveTextContent('Connect a local skill folder');expect(call).toHaveBeenCalledWith({});
});
it('renders the recorded gh-login PRINT as a highlighted workflow popup even when no question is asked',async()=>{
 const line='GitHub CLI is installed but logged out. Run `gh auth login` in a terminal, then try again.';
 const recorded=JSON.stringify({t:'print',level:'info',line});
 const f=fakeBridge((_args,emit)=>{emit({kind:'stdout',line:recorded});emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'connect',ok:false,error:'GitHub CLI is logged out.'})});});
 const backend=createMockBackend();backend.connect=createTauriBackend(f.bridge).connect;
 location.hash='#/library/global';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect'}));
 const popup=await screen.findByRole('dialog');expect(within(popup).getByRole('alert')).toHaveTextContent(line);expect(within(popup).getByRole('alert')).toHaveStyle({color:'var(--tk-warn)'});
 expect(screen.queryByRole('combobox')).toBeNull();
});
it('unknown category icons render the neutral tag without throwing',()=>{const {container}=render(<Mark name="new-category"/>);expect(container.querySelector('svg path')).toHaveAttribute('d','M3 3h7l11 11-7 7L3 10Z');});
it('Settings and footer consume the same clone-state copy',async()=>{
 const backend=createMockBackend(),status=await backend.status();if(!status.ok)throw new Error(status.error);
 status.value.teams=status.value.teams.map(team=>({...team,cloneState:{state:'absent'}}));vi.spyOn(backend,'status').mockResolvedValue(status);
 location.hash='#/settings/teams';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 await waitFor(()=>expect(screen.getAllByText(`Clone: ${status.value.teams[0]!.clone} is missing.`)).toHaveLength(2));
});
it('Onboarding Eval is receipt-only even with runEvalInApp false, retaining its terminal hint',async()=>{
 const {client}=await open('/onboarding/basics?tab=eval');await act(async()=>{client.setQueryData(['features'],{...client.getQueryData<Features>(['features']),runEvalInApp:false});});
 expect(screen.queryByRole('button',{name:'Run eval'})).toBeNull();expect(document.querySelector('.onboarding-hint-slot')).toHaveTextContent('npx -y terum-skills@latest eval deploy-check --commit');
});

it('Account sign-in hands the command to the user without opening it as a file or changing credentials',async()=>{
 const backend=createMockBackend(),status=await backend.status();if(!status.ok)throw new Error(status.error);
 status.value.machine.gh_login='';vi.spyOn(backend,'status').mockResolvedValue(status);
 const copy=vi.spyOn(backend,'copyToClipboard').mockResolvedValue({ok:true,value:undefined}),openEditor=vi.spyOn(backend,'openInEditor');
 location.hash='#/settings/account';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 fireEvent.click(await screen.findByRole('button',{name:'Open gh'}));
 const popup=await screen.findByRole('dialog');expect(popup).toHaveTextContent('Run gh auth login in a terminal');
 fireEvent.click(within(popup).getByRole('button',{name:'Copy command'}));
 expect(copy).toHaveBeenCalledWith('gh auth login');expect(openEditor).not.toHaveBeenCalled();
});
it.each(['/library/global','/skill/deploy-check','/marketplace','/share','/settings/account','/inbox'])('error remedy %s does not offer credential changes or sign-in',async route=>{
 await open(route+'?__mock=error');
 expect(document.querySelector('.state-body')?.textContent).not.toMatch(/sign in|change (?:the |your )?token|other credentials|probe access/i);
 expect(screen.queryByRole('button',{name:/sign in|change.*token/i})).toBeNull();
});
