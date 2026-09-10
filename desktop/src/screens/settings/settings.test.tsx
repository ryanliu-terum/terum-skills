import { useMachineRemoval, type MachineRemovalApi } from '../../app/machine-removal-context';
import { StrictMode } from 'react';
import { MachineRemovalProvider } from '../../app/MachineRemovalProvider';
import { EvalRunContext, type EvalRunApi } from '../../app/eval-run-context';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend, MOCK_REMOVE_DETAIL, MOCK_REMOVE_ADVICE } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import { design } from '../../backend/mock/data';
const backend=createMockBackend();
function open(route:string,evalRun?:EvalRunApi){
 location.hash=route;const app=<MachineRemovalProvider><App/></MachineRemovalProvider>;
 return render(<Providers><BackendContext value={backend}>{evalRun?<EvalRunContext value={evalRun}>{app}</EvalRunContext>:app}</BackendContext></Providers>);
}
beforeEach(()=>{localStorage.clear();useUiStore.getState().setTheme('dark');});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});
it.each([['account','Account'],['teams','Team'],['machine','This machine'],['sync','Sync'],['updates','Updates'],['inbox','Inbox'],['evals','Evals'],['sharing','Sharing'],['appearance','Appearance'],['advanced','Advanced'],['about','About']])('renders the %s settings head and nav',async(section,title)=>{open('#/settings/'+section);expect(await screen.findByRole('heading',{name:title})).toBeInTheDocument();expect(within(screen.getByRole('navigation',{name:'Settings sections'})).getAllByRole('link')).toHaveLength(11);await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));expect(screen.queryByText(/S1b builds this/)).toBeNull();});
it('defaults unknown sections to Account',async()=>{open('#/settings/no-such-section');expect(await screen.findByRole('heading',{name:'Account'})).toBeInTheDocument();});
it('renders Leave and asks the CLI confirmation',async()=>{const leave=vi.spyOn(backend,'team');open('#/settings/teams?dialog=leave');const dialog=await screen.findByRole('dialog');expect(within(dialog).getByRole('heading')).toHaveTextContent('Leave Terum on this machine?');expect([...dialog.querySelectorAll('.settings-leave-bullet>span:last-child')].map(node=>node.textContent)).toEqual([
 "Its placed skills on this machine leave ~/.claude/skills and the project checkouts — a copy you edited by hand is moved to quarantine instead of deleted, and a folder that is also a skill's authoring source is left where it is",
 `The clone at ${design.TEAMS[0]?.clone} and this team's entry in config.json — a clone holding uncommitted or unpushed work is moved to quarantine instead`,
 'Its connected skill records and any pending operations on this machine',
 'This is your last team here, so the session-start hook is removed from ~/.claude/settings.json; if that file cannot be written the leave still finishes and says so',
 "Consent you gave for skills' tool permissions may need to be given again for a new team",
 `Your people file in the team repo stays: you remain a member (an admin archives that with team remove ${design.ME.handle}), and setup brings this machine back`,
]);fireEvent.click(within(dialog).getByRole('button',{name:'Leave'}));const prompt=await screen.findByRole('dialog',{name:`Leave terum? This removes ${design.PLACEMENTS_N} placed skill(s) from this machine.`});fireEvent.click(within(prompt).getByRole('button',{name:'Yes'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(leave).toHaveBeenCalledWith({kind:'leave',name:'terum'});expect(location.hash).toBe('#/settings/teams');});
it('renders every prune path and preanswers Delete N quarantined items',async()=>{const sync=vi.spyOn(backend,'sync');open('#/settings/machine?dialog=prune');const dialog=await screen.findByRole('dialog');expect(dialog).toHaveTextContent('Delete 2 quarantined folders?');for(const [when,name] of design.QUARANTINE)expect(dialog).toHaveTextContent(`quarantine/${when}/${name}`);fireEvent.click(within(dialog).getByRole('button',{name:'Delete'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(sync).toHaveBeenCalledWith({prune:true});expect(location.hash).toBe('#/settings/machine');});
it('keeps failed prune open',async()=>{vi.spyOn(backend,'sync').mockImplementation(()=>createRun(async()=>({ok:false,error:'Prune failed.'})));open('#/settings/machine?dialog=prune');fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Delete'}));expect(await screen.findByRole('alert')).toHaveTextContent('Prune failed.');expect(screen.getByRole('dialog')).toBeInTheDocument();});
it('renders the CLI config error line with hidden counts',async()=>{open('#/settings/account?__mock=error');expect(await screen.findByRole('alert')).toHaveTextContent("Invalid ~/.terum/skills/config.json: Expected property name or '}' in JSON at position 412 (line 14 column 3)");expect(document.querySelectorAll('.nav-count')).toHaveLength(0);});
it('commits the loading skeleton with hidden sidebar counts',async()=>{open('#/settings/account?__mock=loading');expect(screen.getByTestId('settings-skeleton')).toBeInTheDocument();await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));expect(document.querySelectorAll('.nav-count')).toHaveLength(0);});
it('changes data-theme from Appearance and updates an existing URL theme',async()=>{open('#/settings/appearance?theme=dark');fireEvent.click(await screen.findByRole('button',{name:'Light'}));await waitFor(()=>expect(document.documentElement.dataset.theme).toBe('light'));expect(useUiStore.getState().theme).toBe('light');expect(location.hash).toContain('theme=light');});
it('persists the hook toggle and updates its explanation',async()=>{open('#/settings/sync');fireEvent.click(await screen.findByRole('switch',{name:'Sync at session start'}));expect(backend.prefs.get('sync:hook',true)).toBe(false);expect(screen.getByText(/Not installed. Run sync yourself/)).toBeInTheDocument();});
it('persists each inbox kind independently',async()=>{open('#/settings/inbox');const controls=await screen.findAllByRole('checkbox');expect(controls).toHaveLength(7);fireEvent.click(screen.getByRole('checkbox',{name:'Alert'}));expect(backend.prefs.get('inbox:kind:alert',true)).toBe(false);expect(backend.prefs.get('inbox:kind:share',true)).toBe(true);});
it('writes k without deriving a new statistic',async()=>{open('#/settings/evals');fireEvent.click(await screen.findByRole('combobox',{name:'Repetitions per case'}));const option=await screen.findByRole('option',{name:'10'});fireEvent.pointerDown(option,{pointerType:'mouse'});fireEvent.click(option);expect(backend.prefs.get('eval:k','')).toBe('10');});
it('runs Sync now without a team selector through the workflow popup from a user action',async()=>{const sync=vi.spyOn(backend,'sync');open('#/settings/sync');fireEvent.click(await screen.findByRole('button',{name:'Sync now'}));expect(await screen.findByRole('dialog')).toHaveTextContent('Sync now');await waitFor(()=>expect(sync).toHaveBeenCalledWith({}));});
it('renders update advice verbatim from the DTO without opening a command in an editor',async()=>{
 const report=await backend.update();if(!report.ok)throw new Error(report.error);
 report.value.advice=['Running from a source checkout.','  custom build <command> & preserve spacing'];
 vi.spyOn(backend,'update').mockResolvedValue(report);const editor=vi.spyOn(backend,'openInEditor');
 open('#/settings/updates');fireEvent.click(await screen.findByRole('button',{name:'Show update command'}));
 const dialog=await screen.findByRole('dialog');await waitFor(()=>expect(dialog.querySelector('pre')?.textContent).toBe(report.value.advice.join('\n')));
 expect(editor).not.toHaveBeenCalled();expect(location.hash).toContain('dialog=update');
 fireEvent.click(within(dialog).getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('opens the local storage path in Finder',async()=>{const editor=vi.spyOn(backend,'revealPath');open('#/settings/advanced');fireEvent.click(await screen.findByRole('button',{name:'Show in Finder'}));await waitFor(()=>expect(editor).toHaveBeenCalledWith('~/.terum/skills'));});
it('declines machine removal after showing the CLI disclosure and keeps Advanced intact',async()=>{
 const uninstall=vi.spyOn(backend,'uninstallMachine');open('#/settings/advanced');
 fireEvent.click(await screen.findByRole('button',{name:'Remove…'}));
 const dialog=await screen.findByRole('dialog',{name:'Remove terum-skills from this machine?'});
 await waitFor(()=>expect([...dialog.querySelectorAll('.settings-bullet')].map(n=>n.textContent)).toEqual(MOCK_REMOVE_DETAIL));
 expect(uninstall).toHaveBeenCalledExactlyOnceWith({});
 const run=uninstall.mock.results[0]!.value;const answer=vi.spyOn(run,'answer');
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(answer).toHaveBeenCalledExactlyOnceWith(expect.any(String),false);
 expect(await run.done).toEqual({ok:false,cancelled:true,error:'Uninstall was cancelled.'});
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('Uninstall was cancelled.');
 expect(screen.getByRole('heading',{name:'Advanced'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Remove…'})).toBeEnabled();
});
it('accepts machine removal once, renders the complete CLI outcome, and quits',async()=>{
 const uninstall=vi.spyOn(backend,'uninstallMachine'),quit=vi.spyOn(backend,'quit').mockResolvedValue(),reveal=vi.spyOn(backend,'revealPath');
 open('#/settings/advanced');fireEvent.click(await screen.findByRole('button',{name:'Remove…'}));
 const dialog=await screen.findByRole('dialog',{name:'Remove terum-skills from this machine?'});
 const remove=await within(dialog).findByRole('button',{name:'Remove'});
 const run=uninstall.mock.results[0]!.value,answer=vi.spyOn(run,'answer');fireEvent.click(remove);
 const region=await screen.findByRole('region',{name:'terum-skills was removed from this machine'});
 expect(uninstall).toHaveBeenCalledExactlyOnceWith({});expect(answer).toHaveBeenCalledExactlyOnceWith(expect.any(String),true);
 for(const line of [`Left: ${design.TEAMS.map(t=>t.key).join(', ')}`,`Placed skills removed: ${design.PLACEMENTS_N}`,'Hook: removed','/terum-skills skill: removed','config.json: removed','Kept: ~/.terum/skills/backups','Record: ~/.terum/skills/backups/uninstall.2026-09-09T12-00-00-000Z.json',...MOCK_REMOVE_ADVICE])expect(within(region).getByText(line,{exact:true})).toBeInTheDocument();
 const lines=["Wrote a record of this machine's terum-skills state to ~/.terum/skills/backups/uninstall.2026-09-09T12-00-00-000Z.json.",...design.TEAMS.flatMap(t=>[`Leaving ${t.key}…`,`Left ${t.key}.`])];
 expect(within(region).getByRole('log').textContent).toBe(lines.join('\n'));
 fireEvent.click(within(region).getByRole('button',{name:'Show in Finder'}));expect(reveal).toHaveBeenCalledWith('~/.terum/skills/backups/uninstall.2026-09-09T12-00-00-000Z.json');
 fireEvent.click(within(region).getByRole('button',{name:'Quit'}));expect(quit).toHaveBeenCalledOnce();
});
it('renders a partial removal failure and allows closing it',async()=>{
 const error='Done: a\nRemaining: b, config.json\nRe-run `npx -y terum-skills@latest uninstall` to continue.';
 vi.spyOn(backend,'uninstallMachine').mockImplementation(()=>createRun(async ctx=>{
  await ctx.ask('confirm','Remove terum-skills from this machine?',{detail:['x']});ctx.print('Done: a');return {ok:false,error};
 }));
 open('#/settings/advanced');fireEvent.click(await screen.findByRole('button',{name:'Remove…'}));
 fireEvent.click(await screen.findByRole('button',{name:'Remove'}));
 expect((await screen.findByRole('alert')).textContent).toBe(error);expect(screen.getByRole('log')).toHaveTextContent('Done: a');
 fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 expect(screen.getByRole('button',{name:'Remove…'})).toBeEnabled();
});
it('refuses removal while an eval is running and offers to show it',async()=>{
 const uninstall=vi.spyOn(backend,'uninstallMachine'),show=vi.fn();
 open('#/settings/advanced',{current:{state:'running',ref:'deploy-check',name:'deploy-check',team:undefined,run:createRun(async()=>({ok:true,value:{name:'deploy-check',runDir:'/eval',executionStatus:'complete',commit:null}})),lines:[],startedAt:0,commit:false},dialogOpen:false,start:()=>{},stop:async()=>{},dismiss:()=>{},show});
 fireEvent.click(await screen.findByRole('button',{name:'Remove…'}));
 const dialog=await screen.findByRole('dialog',{name:'Stop the running eval first'});expect(uninstall).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Show eval'}));expect(show).toHaveBeenCalledOnce();
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('starts a removal URL only once under StrictMode replay',async()=>{
 const uninstall=vi.spyOn(backend,'uninstallMachine');let removal!:MachineRemovalApi;
 function RemovalAccess(){removal=useMachineRemoval();return null;}
 location.hash='#/settings/advanced?dialog=remove';
 render(<StrictMode><Providers><BackendContext value={backend}><MachineRemovalProvider><RemovalAccess/><App/></MachineRemovalProvider></BackendContext></Providers></StrictMode>);
 await waitFor(()=>expect(removal.current?.phase).toBe('asking'));
 expect(uninstall).toHaveBeenCalledExactlyOnceWith({});expect(location.hash).toBe('#/settings/advanced');
 await act(async()=>{removal.answer(false);expect(await uninstall.mock.results[0]!.value.done).toMatchObject({ok:false,cancelled:true});});
 expect(removal.current).toBeNull();expect(removal.notice).toBe('Uninstall was cancelled.');
});
it('does not change a toggle when its preference write fails',async()=>{open('#/settings/sync');const control=await screen.findByRole('switch',{name:'Sync at session start'});vi.spyOn(backend.prefs,'set').mockImplementation(()=>{throw new Error('Storage denied.');});fireEvent.click(control);expect(await screen.findByRole('alert')).toHaveTextContent('Storage denied.');expect(control).toHaveAttribute('aria-checked','true');});
it('renders the placement hover selector and every raw placement',async()=>{open('#/settings/machine');expect(await screen.findByTestId('placement-row-1')).toHaveTextContent('pr-review');expect(screen.getAllByTestId(/^placement-row-/)).toHaveLength(design.PLACEMENTS.length);});
it('rejects malformed placement data with its field path',async()=>{const settings=await backend.settings();if(!settings.ok)throw new Error(settings.error);settings.value.PLACEMENTS=[['broken']];vi.spyOn(backend,'settings').mockResolvedValue(settings);const consoleError=vi.spyOn(console,'error').mockImplementation(()=>{ /* React reports the intentionally malformed DTO caught by ErrorBoundary. */ });open('#/settings/machine');expect(await screen.findByRole('alert')).toHaveTextContent('PLACEMENTS');expect(consoleError).toHaveBeenCalled();});

it.each(['teams?dialog=leave','machine?dialog=prune'])('keeps the page landmark accessible for %s',async(route)=>{open('#/settings/'+route);const dialog=await screen.findByRole('dialog');const main=screen.getByRole('main');expect(main).toBeInTheDocument();expect(main.closest('[aria-hidden="true"], [inert]')).toBeNull();expect(main.closest('.shell')).not.toBeNull();expect(dialog.closest('.shell')).toBe(main.closest('.shell'));expect(main).not.toContainElement(dialog);});

it('reads the app version from capabilities rather than settings',async()=>{
 const capabilities=await backend.capabilities();vi.spyOn(backend,'capabilities').mockResolvedValue({...capabilities,appVersion:'9.8.7'});
 open('#/settings/updates');expect(await screen.findByText('9.8.7 · no update channel yet.')).toBeInTheDocument();
});
it('shows an update failure without substituting fixture advice',async()=>{
 vi.spyOn(backend,'update').mockResolvedValue({ok:false,error:'Cannot read release state.'});
 open('#/settings/updates?dialog=update');const dialog=await screen.findByRole('dialog');
 await waitFor(()=>expect(dialog).toHaveTextContent('Cannot read release state.'));
 expect(within(dialog).getByRole('alert')).toHaveTextContent('Cannot read release state.');
 expect((await screen.findByRole('dialog')).querySelector('pre')).toBeNull();
});

it('waits for update data before declaring the Updates board ready',async()=>{
 const report=await backend.update();let finish!:(value:typeof report)=>void;
 vi.spyOn(backend,'update').mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 open('#/settings/updates');expect(await screen.findByRole('button',{name:'Show update command'})).toBeInTheDocument();
 expect(document.documentElement.dataset.appReady).not.toBe('true');
 await act(async()=>{finish(report);});
 await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));
});

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

it('does not claim agent authentication when the adapter reports unknown',async()=>{
 const result=await backend.settings();if(!result.ok)throw new Error('Expected settings');
 vi.spyOn(backend,'settings').mockResolvedValue({ok:true,value:{...result.value,AGENT_CLI_AUTH:'unknown'}});
 open('#/settings/evals');await screen.findByRole('heading',{name:'Evals'});
 expect(screen.getByText(result.value.AGENT_CLI)).toBeInTheDocument();
 expect(screen.queryByText(/· signed in/)).toBeNull();
});
async function teamFixture(count:number){
 const status=await backend.status(),settings=await backend.settings();
 if(!status.ok||!settings.ok)throw new Error('Expected fixture');
 const team=status.value.teams[0]!;
 status.value.teams=Array.from({length:count},(_,index)=>({...team,name:index?'Other Team':'Acme Team',key:index?'other-key':'acme-key',clone:`~/.terum/skills/teams/${index?'other-key':'acme-key'}`}));
 settings.value.TEAMS=status.value.teams;
 const statusSpy=vi.spyOn(backend,'status').mockResolvedValue(status);
 const settingsSpy=vi.spyOn(backend,'settings').mockResolvedValue(settings);
 return {statusSpy,settingsSpy};
}
it('joins only from a zero-team machine, validates input, streams invitations and refreshes reads',async()=>{
 const {statusSpy,settingsSpy}=await teamFixture(0),editor=vi.spyOn(backend,'openInEditor');
 const invitation='Accept the invitation at https://github.com/acme/skills/invitations before continuing.';
 const setup=vi.spyOn(backend,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print(invitation);await ctx.ask('confirm','Invitation accepted?');return {ok:true,value:{team:'acme',role:'joiner'}};
 }));
 open('#/settings/teams');fireEvent.click(await screen.findByRole('button',{name:'Join'}));
 const dialog=await screen.findByRole('dialog',{name:'Join a team'});
 fireEvent.change(within(dialog).getByRole('textbox',{name:'Team repository'}),{target:{value:'  '}});
 fireEvent.click(within(dialog).getByRole('button',{name:'Join'}));
 expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the team as <org>/<repo> or a remote URL.');expect(setup).not.toHaveBeenCalled();
 fireEvent.change(within(dialog).getByRole('textbox',{name:'Team repository'}),{target:{value:'  acme/skills  '}});
 const statusCalls=statusSpy.mock.calls.length,settingsCalls=settingsSpy.mock.calls.length;
 fireEvent.click(within(dialog).getByRole('button',{name:'Join'}));
 expect(await within(dialog).findByText(invitation)).toBeInTheDocument();
 expect(setup).toHaveBeenCalledExactlyOnceWith({target:'acme/skills'});
 const prompt=await screen.findByRole('dialog',{name:'Invitation accepted?'});fireEvent.click(within(prompt).getByRole('button',{name:'Yes'}));
 expect(await within(dialog).findByRole('status')).toHaveTextContent('Joined acme');
 await waitFor(()=>{expect(statusSpy.mock.calls.length).toBeGreaterThan(statusCalls);expect(settingsSpy.mock.calls.length).toBeGreaterThan(settingsCalls);});
 expect(within(dialog).getByRole('button',{name:'Close'})).toBeEnabled();expect(editor).not.toHaveBeenCalled();
});
it('keeps Join mounted after the status refetch adds the joined team until Close',async()=>{
 const joinedStatus=await backend.status();if(!joinedStatus.ok)throw new Error(joinedStatus.error);
 joinedStatus.value.teams[0]!.name='Acme Team';
 const {statusSpy,settingsSpy}=await teamFixture(0);
 const line='Joined repository acme/skills.';
 vi.spyOn(backend,'setup').mockImplementation(()=>createRun(async ctx=>{
  ctx.print(line);return {ok:true,value:{team:'acme/skills',role:'joiner'}};
 }));
 open('#/settings/teams');fireEvent.click(await screen.findByRole('button',{name:'Join'}));
 const dialog=await screen.findByRole('dialog',{name:'Join a team'});
 fireEvent.change(within(dialog).getByRole('textbox',{name:'Team repository'}),{target:{value:'acme/skills'}});
 const statusCalls=statusSpy.mock.calls.length,settingsCalls=settingsSpy.mock.calls.length;
 statusSpy.mockResolvedValue(joinedStatus);
 fireEvent.click(within(dialog).getByRole('button',{name:'Join'}));
 await screen.findByText('Acme Team');
 await waitFor(()=>{expect(statusSpy.mock.calls.length).toBeGreaterThan(statusCalls);expect(settingsSpy.mock.calls.length).toBeGreaterThan(settingsCalls);});
 expect(screen.getByRole('dialog',{name:'Join a team'})).toBe(dialog);
 expect(within(dialog).getByText(line)).toBeInTheDocument();
 expect(within(dialog).getByRole('status')).toHaveTextContent('Joined acme/skills');
 expect(within(dialog).getByRole('button',{name:'Close'})).toBeEnabled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Close'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(screen.getByText('Acme Team').closest('.setting-card')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Join'})).toBeNull();
});
it('rejects a direct Join dialog URL with the default configured team',async()=>{
 open('#/settings/teams?dialog=join');await screen.findByRole('heading',{name:'Team'});
 expect(screen.queryByRole('dialog')).toBeNull();
});
it('requires leaving the configured team first and never starts setup',async()=>{
 await teamFixture(1);const setup=vi.spyOn(backend,'setup');open('#/settings/teams');
 fireEvent.click(await screen.findByRole('button',{name:'Leave Acme Team first'}));
 expect(await screen.findByRole('dialog',{name:'Leave Acme Team on this machine?'})).toBeInTheDocument();
 expect(location.hash).toContain('dialog=leave&team=acme-key');expect(setup).not.toHaveBeenCalled();
});
it('renders two legacy team cards with keyed Leave actions and no Join button',async()=>{
 await teamFixture(2);open('#/settings/teams');await screen.findByRole('heading',{name:'Team'});
 expect(screen.getByRole('link',{name:'Team'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Join'})).toBeNull();
 for(const [name,key] of [['Acme Team','acme-key'],['Other Team','other-key']]){
  const card=screen.getByText(name!).closest('.setting-card');if(!card)throw new Error('Expected card');
  fireEvent.click(within(card as HTMLElement).getByRole('button',{name:'Leave'}));
  const dialog=await screen.findByRole('dialog',{name:`Leave ${name} on this machine?`});
  expect(location.hash).toContain(`dialog=leave&team=${key}`);expect(dialog).toHaveTextContent(`~/.terum/skills/teams/${key}`);expect(dialog).not.toHaveTextContent('This is your last team here');
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 }
});
it.each([1,2])('rejects a direct Join dialog URL with %i teams',async count=>{
 await teamFixture(count);open('#/settings/teams?dialog=join');await screen.findByRole('heading',{name:'Team'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not infer a Leave target on a legacy multi-team machine',async()=>{
 await teamFixture(2);open('#/settings/teams?dialog=leave');await screen.findByRole('heading',{name:'Team'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('removes the second-team handle suggestion from Account',async()=>{
 open('#/settings/account');await screen.findByRole('heading',{name:'Account'});expect(screen.queryByText(/A second team can use a different one/)).toBeNull();
});
it('runs diagnostics once in a Status dialog and never opens a command path',async()=>{
 const lines=['terum-skills test-version','Acme · remote · handle · counts · last sync'];
 const diagnostics=vi.spyOn(backend,'diagnostics').mockImplementation(()=>createRun(async ctx=>{for(const line of lines)ctx.print(line);return {ok:true,value:undefined};}));
 const editor=vi.spyOn(backend,'openInEditor');open('#/settings/advanced');fireEvent.click(await screen.findByRole('button',{name:'Run'}));
 const dialog=await screen.findByRole('dialog',{name:'Status'});await waitFor(()=>expect(within(dialog).getByRole('status')).toHaveTextContent('Done.'));
 for(const line of lines)expect(within(dialog).getByText(line)).toBeInTheDocument();expect(diagnostics).toHaveBeenCalledTimes(1);expect(editor).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'Close'}));await waitFor(()=>expect(location.hash).not.toContain('dialog='));
});
it('routes About Check to the Updates dialog with verbatim advice and preserves mock mode',async()=>{
 const report=await backend.update();if(!report.ok)throw new Error(report.error);
 vi.spyOn(backend,'update').mockResolvedValue(report);open('#/settings/about?__mock=empty');fireEvent.click(await screen.findByRole('button',{name:'Check'}));
 const dialog=await screen.findByRole('dialog');await waitFor(()=>expect(dialog.querySelector('pre')?.textContent).toBe(report.value.advice.join('\n')));
 expect(location.hash).toContain('/settings/updates?dialog=update&__mock=empty');
});
it('names the known latest CLI release on About',async()=>{
 open('#/settings/about');expect(await screen.findByText(`${design.CLI_LATEST} available`)).toBeInTheDocument();
});
it('omits the "available" clause when the latest CLI release is unknown',async()=>{
 const settings=await backend.settings();if(!settings.ok)throw new Error(settings.error);
 vi.spyOn(backend,'settings').mockResolvedValue({ok:true,value:{...settings.value,CLI_LATEST:'—'}});
 open('#/settings/about');await screen.findByText('terum-skills CLI');
 expect(screen.queryByText(/available/)).toBeNull();expect(screen.queryByText(/—\s*available/)).toBeNull();
});
it('derives the About latest from the update check the Updates section already fetched',async()=>{
 const settings=await backend.settings();if(!settings.ok)throw new Error(settings.error);
 vi.spyOn(backend,'settings').mockResolvedValue({ok:true,value:{...settings.value,CLI_LATEST:'—'}});
 const report=await backend.update();if(!report.ok)throw new Error(report.error);
 vi.spyOn(backend,'update').mockResolvedValue({ok:true,value:{...report.value,latest:'9.9.9'}});
 open('#/settings/updates');await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));
 fireEvent.click(within(screen.getByRole('navigation',{name:'Settings sections'})).getByRole('link',{name:'About'}));
 expect(await screen.findByText('9.9.9 available')).toBeInTheDocument();
});
it('copies the sign-out command from its terminal instructions',async()=>{
 const copy=vi.spyOn(backend,'copyToClipboard').mockResolvedValue({ok:true,value:undefined}),editor=vi.spyOn(backend,'openInEditor');
 open('#/settings/account');fireEvent.click(await screen.findByRole('button',{name:'Sign out'}));
 const dialog=await screen.findByRole('dialog',{name:'Sign out from a terminal'});fireEvent.click(within(dialog).getByRole('button',{name:'Copy command'}));
 await waitFor(()=>expect(copy).toHaveBeenCalledWith('gh auth logout'));expect(editor).not.toHaveBeenCalled();
});
it('syncs without a team selector even on a legacy two-team machine',async()=>{
 await teamFixture(2);const sync=vi.spyOn(backend,'sync');open('#/settings/sync');fireEvent.click(await screen.findByRole('button',{name:'Sync now'}));
 await screen.findByRole('dialog');await waitFor(()=>expect(sync).toHaveBeenCalledWith({}));expect(screen.queryByRole('combobox',{name:'Team to sync'})).toBeNull();
});
it('leaves the keyed team, renders inventory and delegates confirmation to the real prompt',async()=>{
 await teamFixture(2);const completed=vi.fn();
 const leave=vi.spyOn(backend,'team').mockImplementation(()=>createRun(async ctx=>{
  ctx.print('Inventory: acme-key has placed skills.');const confirmed=await ctx.ask('confirm','Really leave acme-key on this machine?');completed(confirmed);return {ok:true,value:{name:'acme-key',kind:'leave'}};
 }));
 open('#/settings/teams?dialog=leave&team=acme-key');const dialog=await screen.findByRole('dialog',{name:'Leave Acme Team on this machine?'});
 fireEvent.click(within(dialog).getByRole('button',{name:'Leave'}));
 expect(await within(dialog).findByText('Inventory: acme-key has placed skills.')).toBeInTheDocument();
 const prompt=await screen.findByRole('dialog',{name:'Really leave acme-key on this machine?'});expect(completed).not.toHaveBeenCalled();fireEvent.click(within(prompt).getByRole('button',{name:'Yes'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(leave).toHaveBeenCalledExactlyOnceWith({kind:'leave',name:'acme-key'});expect(completed).toHaveBeenCalledWith(true);expect(location.hash).not.toContain('dialog=');
});

it('hides Checkouts on the mock machine board',async()=>{
 open('#/settings/machine');await screen.findByRole('heading',{name:'This machine'});
 expect(screen.queryByText('Checkouts')).toBeNull();expect(screen.queryByRole('textbox',{name:'Checkout path'})).toBeNull();
});
it('lists checkout paths and forgets only the selected root',async()=>{
 vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),checkouts:true});const remove=vi.spyOn(backend.checkouts,'remove');
 open('#/settings/machine');await screen.findByText('Checkouts');
 for(const name of ['terum','ssm','mrf'])expect(screen.getByText('/Users/you/code/'+name)).toBeVisible();
 fireEvent.click(screen.getAllByRole('button',{name:'Remove'})[0]!);await waitFor(()=>expect(remove).toHaveBeenCalledWith('/Users/you/code/terum'));
 expect(screen.getByText(/Registering a folder is not sharing/)).toHaveTextContent('connects nothing and approves no tool grant');
 expect(screen.getByText(/Registering a folder is not sharing/)).toHaveTextContent('Detected · not registered');
});
it.each(['click','enter'])('adds a typed checkout by %s and clears the field',async mode=>{
 vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),checkouts:true});const add=vi.spyOn(backend.checkouts,'add');
 open('#/settings/machine');const field=await screen.findByRole('textbox',{name:'Checkout path'});fireEvent.change(field,{target:{value:'  /tmp/x  '}});
 if(mode==='click')fireEvent.click(screen.getByRole('button',{name:'Add'}));else fireEvent.keyDown(field,{key:'Enter'});
 await waitFor(()=>expect(add).toHaveBeenCalledWith('/tmp/x'));await waitFor(()=>expect(field).toHaveValue(''));
});
it('adds a detected checkout and reports one action error',async()=>{
 vi.spyOn(backend,'surfaces').mockResolvedValue({...await backend.surfaces(),checkouts:true});const add=vi.spyOn(backend.checkouts,'add').mockImplementation(()=>createRun(async()=>({ok:false,error:'Registration denied'})));
 open('#/settings/machine?__mock=detected-root');await screen.findByText('Checkouts');
 fireEvent.click(within(screen.getByText('/Users/you/code/ssm').closest('.setting-row')!).getByRole('button',{name:'Add'}));
 expect(add).toHaveBeenCalledWith('/Users/you/code/ssm');expect(await screen.findByRole('alert')).toHaveTextContent('Registration denied');expect(screen.getAllByRole('alert')).toHaveLength(1);
});
