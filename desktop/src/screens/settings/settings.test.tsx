import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import { design } from '../../backend/mock/data';
const backend=createMockBackend();
function open(route:string){location.hash=route;return render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);}
beforeEach(()=>{localStorage.clear();useUiStore.getState().setTheme('dark');});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});
it.each([['account','Account'],['teams','Teams'],['machine','This machine'],['sync','Sync'],['updates','Updates'],['inbox','Inbox'],['evals','Evals'],['sharing','Sharing'],['appearance','Appearance'],['advanced','Advanced'],['about','About']])('renders the %s settings head and nav',async(section,title)=>{open('#/settings/'+section);expect(await screen.findByRole('heading',{name:title})).toBeInTheDocument();expect(within(screen.getByRole('navigation',{name:'Settings sections'})).getAllByRole('link')).toHaveLength(11);await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));expect(screen.queryByText(/S1b builds this/)).toBeNull();});
it('defaults unknown sections to Account',async()=>{open('#/settings/no-such-section');expect(await screen.findByRole('heading',{name:'Account'})).toBeInTheDocument();});
it('renders Leave and preanswers its exact confirmation',async()=>{const leave=vi.spyOn(backend,'team');open('#/settings/teams?dialog=leave');const dialog=await screen.findByRole('dialog');expect(within(dialog).getByRole('heading')).toHaveTextContent('Leave Terum on this machine?');expect([...dialog.querySelectorAll('.settings-leave-bullet>span:last-child')].map(node=>node.textContent)).toEqual([
 "Its placed skills leave ~/.claude/skills and the project checkouts on this machine (30 global, 69 in checkouts) — a copy you edited by hand is moved to quarantine instead of deleted, and a folder that is also a skill's authoring source is left where it is",
 `The clone at ${design.TEAMS[0]?.clone} and this team's entry in config.json — a clone holding uncommitted or unpushed work is moved to quarantine instead`,
 'Its connected skill records and any pending operations on this machine',
 'This is your last team here, so the session-start hook is removed from ~/.claude/settings.json; if that file cannot be written the leave still finishes and says so',
 `Your people file in the team repo stays: you remain a member (an admin archives that with team remove ${design.ME.handle}), and setup brings this machine back`,
]);fireEvent.click(within(dialog).getByRole('button',{name:'Leave'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(leave).toHaveBeenCalledWith({kind:'leave'});expect(location.hash).toBe('#/settings/teams');});
it.each([
  ['0','0 global, 99 in checkouts'],
  ['99','99 global, 0 in checkouts'],
  [undefined,'— global, — in checkouts'],
  ['','— global, — in checkouts'],
  ['many','— global, — in checkouts'],
  ['-1','— global, — in checkouts'],
  ['30.5','— global, — in checkouts'],
  ['100','— global, — in checkouts'],
  ['9007199254740992','— global, — in checkouts'],
])('renders Leave placement counts safely for Global=%s',async(globalCount,expected)=>{
  const status=await backend.status();
  if(!status.ok)throw new Error(status.error);
  if(globalCount===undefined)delete status.value.counts.Global;
  else status.value.counts.Global=globalCount;
  vi.spyOn(backend,'status').mockResolvedValue(status);
  open('#/settings/teams?dialog=leave');
  expect(await screen.findByRole('dialog')).toHaveTextContent(`(${expected})`);
});
it('renders every prune path and preanswers Delete N quarantined items',async()=>{const sync=vi.spyOn(backend,'sync');open('#/settings/machine?dialog=prune');const dialog=await screen.findByRole('dialog');expect(dialog).toHaveTextContent('Delete 2 quarantined folders?');for(const [when,name] of design.QUARANTINE)expect(dialog).toHaveTextContent(`quarantine/${when}/${name}`);fireEvent.click(within(dialog).getByRole('button',{name:'Delete'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(sync).toHaveBeenCalledWith({prune:true});expect(location.hash).toBe('#/settings/machine');});
it('keeps failed prune open',async()=>{vi.spyOn(backend,'sync').mockImplementation(()=>createRun(async()=>({ok:false,error:'Prune failed.'})));open('#/settings/machine?dialog=prune');fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Delete'}));expect(await screen.findByRole('alert')).toHaveTextContent('Prune failed.');expect(screen.getByRole('dialog')).toBeInTheDocument();});
it('renders the CLI config error line with hidden counts',async()=>{open('#/settings/account?__mock=error');expect(await screen.findByRole('alert')).toHaveTextContent("Invalid ~/.terum/skills/config.json: Expected property name or '}' in JSON at position 412 (line 14 column 3)");expect(document.querySelectorAll('.nav-count')).toHaveLength(0);});
it('commits the loading skeleton with hidden sidebar counts',async()=>{open('#/settings/account?__mock=loading');expect(screen.getByTestId('settings-skeleton')).toBeInTheDocument();await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));expect(document.querySelectorAll('.nav-count')).toHaveLength(0);});
it('changes data-theme from Appearance and updates an existing URL theme',async()=>{open('#/settings/appearance?theme=dark');fireEvent.click(await screen.findByRole('button',{name:'Light'}));await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('light'));expect(useUiStore.getState().theme).toBe('light');expect(location.hash).toContain('theme=light');});
it('persists the hook toggle and updates its explanation',async()=>{open('#/settings/sync');fireEvent.click(await screen.findByRole('switch',{name:'Sync at session start'}));expect(backend.prefs.get('sync:hook',true)).toBe(false);expect(screen.getByText(/Not installed. Run sync yourself/)).toBeInTheDocument();});
it('persists each inbox kind independently',async()=>{open('#/settings/inbox');const controls=await screen.findAllByRole('checkbox');expect(controls).toHaveLength(7);fireEvent.click(screen.getByRole('checkbox',{name:'Alert'}));expect(backend.prefs.get('inbox:kind:alert',true)).toBe(false);expect(backend.prefs.get('inbox:kind:share',true)).toBe(true);});
it('writes k without deriving a new statistic',async()=>{open('#/settings/evals');fireEvent.click(await screen.findByRole('combobox',{name:'Repetitions per case'}));const option=await screen.findByRole('option',{name:'10'});fireEvent.pointerDown(option,{pointerType:'mouse'});fireEvent.click(option);expect(backend.prefs.get('eval:k','')).toBe('10');});
it('runs Sync now with an empty argument',async()=>{const sync=vi.spyOn(backend,'sync');open('#/settings/sync');fireEvent.click(await screen.findByRole('button',{name:'Sync now'}));await waitFor(()=>expect(sync).toHaveBeenCalledWith({}));});
it('opens the exact update command',async()=>{const editor=vi.spyOn(backend,'openInEditor');open('#/settings/updates');fireEvent.click(await screen.findByRole('button',{name:'Show update command'}));await waitFor(()=>expect(editor).toHaveBeenCalledWith('npx -y terum-skills@latest update'));});
it('opens the local storage path in Finder',async()=>{const editor=vi.spyOn(backend,'revealPath');open('#/settings/advanced');fireEvent.click(await screen.findByRole('button',{name:'Show in Finder'}));await waitFor(()=>expect(editor).toHaveBeenCalledWith('~/.terum/skills'));});
it('declines machine removal and leaves the screen intact',async()=>{const uninstall=vi.spyOn(backend,'uninstallMachine');open('#/settings/advanced');fireEvent.click(await screen.findByRole('button',{name:'Remove…'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Remove…'})).toBeEnabled());expect(uninstall).toHaveBeenCalledWith({});expect(screen.queryByRole('alert')).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('heading',{name:'Advanced'})).toBeInTheDocument();});
it('does not change a toggle when its preference write fails',async()=>{open('#/settings/sync');const control=await screen.findByRole('switch',{name:'Sync at session start'});vi.spyOn(backend.prefs,'set').mockImplementation(()=>{throw new Error('Storage denied.');});fireEvent.click(control);expect(await screen.findByRole('alert')).toHaveTextContent('Storage denied.');expect(control).toHaveAttribute('aria-checked','true');});
it('surfaces failed editor results',async()=>{vi.spyOn(backend,'openInEditor').mockResolvedValue({ok:false,error:'Editor unavailable.'});open('#/settings/updates');fireEvent.click(await screen.findByRole('button',{name:'Show update command'}));expect(await screen.findByRole('alert')).toHaveTextContent('Editor unavailable.');});
it('renders the placement hover selector and every raw placement',async()=>{open('#/settings/machine');expect(await screen.findByTestId('placement-row-1')).toHaveTextContent('pr-review');expect(screen.getAllByTestId(/^placement-row-/)).toHaveLength(design.PLACEMENTS.length);});
it('rejects malformed placement data with its field path',async()=>{const settings=await backend.settings();if(!settings.ok)throw new Error(settings.error);settings.value.PLACEMENTS=[['broken']];vi.spyOn(backend,'settings').mockResolvedValue(settings);const consoleError=vi.spyOn(console,'error').mockImplementation(()=>{ /* React reports the intentionally malformed DTO caught by ErrorBoundary. */ });open('#/settings/machine');expect(await screen.findByRole('alert')).toHaveTextContent('PLACEMENTS');expect(consoleError).toHaveBeenCalled();});

it.each(['teams?dialog=leave','machine?dialog=prune'])('keeps the page landmark accessible for %s',async(route)=>{open('#/settings/'+route);const dialog=await screen.findByRole('dialog');const main=screen.getByRole('main');expect(main).toBeInTheDocument();expect(main.closest('[aria-hidden="true"], [inert]')).toBeNull();expect(main.closest('.shell')).not.toBeNull();expect(dialog.closest('.shell')).toBe(main.closest('.shell'));expect(main).not.toContainElement(dialog);});


it.each([['Name','name','Ryan Liu'],['Email','email','ryan@example.com'],['Default handle','defaultHandle','ryan']])('saves Account %s through the seam and shows the returned notice without print frames',async(label,key,value)=>{
 const notice='The next sync refreshes connected skills on this machine.';
 const save=vi.spyOn(backend,'setIdentity').mockImplementation(()=>createRun(async()=>({ok:true,value:{updated:[{key:key==='defaultHandle'?'default-handle':key,value}],notice}})));
 const pref=vi.spyOn(backend.prefs,'set');open('#/settings/account');
 const field=await screen.findByRole('textbox',{name:label});fireEvent.change(field,{target:{value}});expect(save).not.toHaveBeenCalled();fireEvent.blur(field);
 await waitFor(()=>expect(save.mock.calls).toEqual([[{[key]:value}]]));
 expect(await screen.findByRole('dialog')).toHaveTextContent(notice);expect(pref).not.toHaveBeenCalled();expect(field).toHaveValue(value);
});
it('shows a failed Account write and retains the draft for correction',async()=>{
 vi.spyOn(backend,'setIdentity').mockImplementation(()=>createRun(async()=>({ok:false,error:'Invalid email.'})));
 open('#/settings/account');const field=await screen.findByRole('textbox',{name:'Email'});fireEvent.change(field,{target:{value:'bad'}});fireEvent.blur(field);
 expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email.');expect(field).toHaveValue('bad');expect(screen.queryByRole('dialog')).toBeNull();
});
it('uses settings identity rather than stale identity preferences',async()=>{
 backend.prefs.set('identity:name','Stale name');open('#/settings/account');expect(await screen.findByRole('textbox',{name:'Name'})).toHaveValue(design.ME.name);
});


it('keeps the team display name separate from its command identifier',async()=>{
 const status=await backend.status();if(!status.ok)throw new Error(status.error);
 const team=status.value.teams[0];if(!team)throw new Error('Expected team');team.name='Acme Team';team.key='acme-key';
 vi.spyOn(backend,'status').mockResolvedValue(status);
 open('#/settings/teams');expect(await screen.findByText('Acme Team')).toBeInTheDocument();expect(document.querySelector('.terminal-hint .board-mono')?.textContent).toBe('npx -y terum-skills@latest team leave acme-key');
});
it('uses the status team display name on Account',async()=>{
 const status=await backend.status();if(!status.ok)throw new Error(status.error);
 const team=status.value.teams[0];if(!team)throw new Error('Expected team');team.name='Acme Team';team.key='acme-key';
 vi.spyOn(backend,'status').mockResolvedValue(status);
 open('#/settings/account');expect(await screen.findByText('Handle on Acme Team')).toBeInTheDocument();
});
it('renders team category strings without reading the catalog',async()=>{
 const status=await backend.status(),settings=await backend.settings();
 if(!status.ok||!settings.ok)throw new Error('mock data expected');
 status.value.teams[0]!.categories=['ops','engineering','debugging'];
 settings.value.TEAM_POLICY.categoriesNote='From team.json; an admin extends it by pull request.';
 vi.spyOn(backend,'status').mockResolvedValue(status);vi.spyOn(backend,'settings').mockResolvedValue(settings);
 const catalog=vi.spyOn(backend,'catalog').mockResolvedValue({ok:false,error:'Catalog unavailable.'});
 open('#/settings/teams');
 expect(await screen.findByText('From team.json; an admin extends it by pull request.')).toBeInTheDocument();
 const row=screen.getByText('Categories').closest('.setting-row')??screen.getByText('Categories').parentElement!.parentElement!;
 for(const category of ['ops','engineering','debugging'])expect(within(row as HTMLElement).getByText(category)).toBeInTheDocument();
 expect(catalog).not.toHaveBeenCalled();
});
it('serves Settings alongside the status error and discloses absent stamps and unfinished work',async()=>{
 const status=await backend.status(),settings=await backend.settings();
 if(!status.ok||!settings.ok)throw new Error('mock data expected');
 status.value.teams[0]!.last_sync=null;status.value.teams[0]!.stamp=null;
 status.value.teams[0]!.pending=[{op:'install',id:'id',scope:{kind:'global'},version:null,started:'2026-09-01'}];
 settings.value.syncNote='The recorded timestamp is shown without clock-skew correction.';
 vi.spyOn(backend,'status').mockResolvedValue({ok:false,error:'Unreadable clone.',value:status.value});
 vi.spyOn(backend,'settings').mockResolvedValue({ok:false,error:'Unreadable clone.',value:settings.value});
 open('#/settings/sync');
 expect(await screen.findByRole('heading',{name:'Sync'})).toBeInTheDocument();
 expect(screen.getByText(/Last sync No sync recorded on this machine/)).toBeInTheDocument();
 expect(screen.getByText('Work left undone; run sync')).toBeInTheDocument();
 expect(screen.getByText(/without clock-skew correction/)).toBeInTheDocument();
 expect(screen.getAllByText('Unreadable clone.').length).toBeGreaterThan(0);
});
it('shows tool presence without claiming an authenticated GitHub account',async()=>{
 open('#/settings/account');
 expect(await screen.findByText('git present · gh present')).toBeInTheDocument();
 expect(screen.queryByText(/Signed in as/)).toBeNull();
});
