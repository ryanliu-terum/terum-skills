import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { Backend } from '../../backend/Backend';
import { design } from '../../backend/mock/data';
function open(route:string){location.hash=route;return render(<Providers><App/></Providers>);}
beforeEach(()=>{localStorage.clear();useUiStore.setState({railOpen:true,overviewHidden:false,theme:'dark'});});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();vi.unstubAllGlobals();});
it('renders the Global title, 15 cards and the fixture hover target',async()=>{open('#/library/global');expect(await screen.findByText('15 skills')).toBeInTheDocument();expect(screen.getAllByTestId(/^skill-card-/)).toHaveLength(15);expect(screen.getByTestId('skill-card-'+design.SKILLS[design.HOVER_INDEX]!.name).querySelector('[data-flag="update"]')).not.toBeNull();});
it('renders the no-results query and clears it',async()=>{open('#/library/global?q=deploy%20prod');expect(await screen.findByText('No skills match “deploy prod”')).toBeInTheDocument();fireEvent.click(screen.getAllByRole('button',{name:'Clear search'}).at(-1)!);expect(await screen.findByTestId('skill-card-deploy-check')).toBeInTheDocument();});
it('renders the default SKILL.md with four tabs and frontmatter',async()=>{open('#/skill/deploy-check');expect(await screen.findByRole('heading',{name:'deploy-check'})).toBeInTheDocument();expect(screen.getAllByRole('tab')).toHaveLength(4);expect(screen.getByTestId('frontmatter')).toHaveTextContent('name: deploy-check');expect(screen.getByTestId('frontmatter')).toHaveTextContent('<ajay@terum.ai>');});
it('renders the eval report',async()=>{open('#/skill/deploy-check?tab=evals');expect(await screen.findByText(/Evaluation of deploy-check/)).toBeInTheDocument();});
it('renders all four install scope rows and keeps the Marketplace root after install',async()=>{open('#/skill/deploy-check?__mock=not-installed&dialog=install');const dialog=await screen.findByRole('dialog');expect(within(dialog).getAllByRole('radio')).toHaveLength(4);fireEvent.click(within(dialog).getByRole('button',{name:'Install'}));const approval=await screen.findByRole('dialog',{name:'Approve these tools for deploy-check?'});fireEvent.click(within(approval).getByRole('button',{name:'Yes'}));await waitFor(()=>expect(location.hash).toBe('#/skill/deploy-check?root=marketplace'));expect(await screen.findByText('Enabled')).toBeInTheDocument();await waitFor(()=>expect(document.querySelector('.detail-crumbs')).toHaveTextContent('Marketplace'));});
it('renders the partial banner',async()=>{open('#/skill/migration-guard?tab=evals');expect(await screen.findByText('Partial run · 7 of 9 rounds scored · the verdict is greyed until a complete run lands')).toBeInTheDocument();});
it('renders the no-receipt eval state',async()=>{open('#/skill/onboarding-tour?tab=evals');expect(await screen.findByText('Not evaluated', {selector:'.state-title'})).toBeInTheDocument();expect(screen.getByText('Never')).toBeInTheDocument();});
it('removes a skill through the run and returns to Library',async()=>{open('#/skill/deploy-check?dialog=remove');const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Remove'}));await waitFor(()=>expect(location.hash).toBe('#/library/global'));});
it('closes eval dialog after a successful run',async()=>{open('#/skill/deploy-check?tab=evals&dialog=run-eval');const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Run eval'}));await waitFor(()=>expect(location.hash).toBe('#/skill/deploy-check?tab=evals'));});
it('persists card switches and favorites',async()=>{open('#/library/global');const card=await screen.findByTestId('skill-card-deploy-check');fireEvent.click(within(card).getByRole('switch'));expect(within(card).getByRole('switch')).toHaveAttribute('aria-checked','false');expect(localStorage.getItem('terum-skills-app:pref:enabled:deploy-check')).toBe('false');fireEvent.click(within(card).getByRole('button',{name:'Favorite deploy-check'}));expect(localStorage.getItem('terum-skills-app:pref:favorite:deploy-check')).toBe('false');});
it('renders unknown skill errors with a settled readiness marker',async()=>{open('#/skill/unknown-skill');expect(await screen.findByRole('alert')).toHaveTextContent('No skill named unknown-skill.');await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));});
it('uses the default tab for unknown values',async()=>{open('#/skill/deploy-check?tab=unexpected');expect(await screen.findByTestId('frontmatter')).toBeInTheDocument();expect(screen.getByRole('tab',{name:'SKILL.md'})).toHaveAttribute('aria-selected','true');});
it('renders disabled status without opacity fading',async()=>{open('#/skill/deploy-check?__mock=disabled');expect(await screen.findByText('Disabled')).toBeInTheDocument();expect(screen.getByText('On disk, not loaded')).toBeInTheDocument();expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','false');});
it('commits the loading skeleton and readiness without waiting on a pending query',async()=>{open('#/skill/deploy-check?__mock=loading');await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));expect(screen.queryByText(/S1b builds this/)).toBeNull();expect(screen.queryByRole('heading')).toBeNull();});
it('cancels install without running it',async()=>{open('#/skill/deploy-check?__mock=not-installed&dialog=install');const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(location.hash).toBe('#/skill/deploy-check?__mock=not-installed');expect(screen.getByText('Not installed')).toBeInTheDocument();});
it('dismisses a dialog with Escape',async()=>{open('#/skill/deploy-check?dialog=remove');await screen.findByRole('dialog');fireEvent.keyDown(document.activeElement??document.body,{key:'Escape'});await waitFor(()=>expect(location.hash).toBe('#/skill/deploy-check'));});
it('surfaces failed preference writes without changing the switch',async()=>{open('#/library/global');const card=await screen.findByTestId('skill-card-deploy-check');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Storage full.');});fireEvent.click(within(card).getByRole('switch'));expect(within(card).getByRole('alert')).toHaveTextContent('Storage full.');expect(within(card).getByRole('switch')).toHaveAttribute('aria-checked','true');});
it('copies the exact share command and expires its confirmation',async()=>{const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',Object.assign(Object.create(navigator),{clipboard:{writeText}}));open('#/skill/deploy-check');await screen.findByRole('heading',{name:'deploy-check'});fireEvent.click(screen.getByRole('button',{name:'Copy command'}));expect(await screen.findByRole('tooltip')).toHaveTextContent('Copied');expect(writeText).toHaveBeenCalledWith('npx -y terum-skills@latest install terum/team-skills/deploy-check@5f0e12ab9c3d');await waitFor(()=>expect(screen.queryByRole('tooltip')).toBeNull(),{timeout:2000});vi.unstubAllGlobals();});
it.each([
 ['#/library/global?__mock=empty','No skills in your global library'],
 ['#/library/global?__mock=error',"Couldn't read your library"],
 ['#/skill/deploy-check?__mock=error',"Couldn't read deploy-check"],
 ['#/skill/deploy-check?tab=quality','Tool grants'],
 ['#/skill/deploy-check?tab=activity','10 events'],
 ['#/skill/deploy-check?menu=files','3 files'],
 ['#/skill/deploy-check?tab=evals&rail=closed&full=1','Coverage and provenance'],
])('reaches the real board content at %s',async(route,text)=>{open(route);expect(await screen.findByText(text)).toBeInTheDocument();expect(screen.queryByText(/S1b builds this/)).toBeNull();await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));});
it('can reopen persisted collapsed overview and rail',async()=>{useUiStore.setState({overviewHidden:true});open('#/library/global');await screen.findByText('15 skills');fireEvent.click(screen.getByRole('button',{name:'Show overview'}));expect(await screen.findByText('Team installs')).toBeInTheDocument();cleanup();useUiStore.setState({railOpen:false});open('#/skill/deploy-check');await screen.findByRole('heading',{name:'deploy-check'});fireEvent.click(screen.getByRole('button',{name:'Open details rail'}));expect(await screen.findByText('Status')).toBeInTheDocument();});
it('binds the inbox placeholder to the share selection and clears unknown ids',async()=>{const view=open('#/inbox');await waitFor(()=>expect(view.container.querySelector('[data-selected-id="share-secret-scan"]')).not.toBeNull());cleanup();const unknown=open('#/inbox/unknown');await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));expect(unknown.container.querySelector('[data-selected-id]')).toBeNull();});

it('offers app setup on the additive no-team board',async()=>{
 open('#/library/global?__mock=no-team');
 expect(await screen.findByText('No team on this machine')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Start setup'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Copy terminal command'})).toBeInTheDocument();
});
it('keeps the skill title as the only link without making the article interactive',async()=>{
 open('#/library/global');
 const card=await screen.findByTestId('skill-card-deploy-check');
 expect(within(card).getAllByRole('link')).toHaveLength(1);
 expect(within(card).getByRole('link',{name:'deploy-check'})).toHaveAttribute('href','#/skill/deploy-check');
 expect(card.tagName).toBe('ARTICLE');
 expect(card).not.toHaveAttribute('role');
 expect(card).not.toHaveAttribute('tabindex');
});
it('keeps switch and favorite clicks on the library route',async()=>{
 open('#/library/global');
 const card=await screen.findByTestId('skill-card-deploy-check');
 const toggle=within(card).getByRole('switch');
 expect(toggle.closest('a')).toBeNull();
 fireEvent.click(toggle);
 expect(toggle).toHaveAttribute('aria-checked','false');
 expect(location.hash).toBe('#/library/global');
 const favorite=within(card).getByRole('button',{name:'Favorite deploy-check'});
 expect(favorite.tagName).toBe('BUTTON');
 expect(favorite.closest('a')).toBeNull();
 fireEvent.click(favorite);
 expect(favorite).toHaveAttribute('aria-pressed','false');
 expect(location.hash).toBe('#/library/global');
});
it('keeps the marketplace skill link and install button destinations distinct',async()=>{
 open('#/marketplace/people/lena');
 const card=await screen.findByTestId('skill-card-a11y-audit');
 expect(within(card).getAllByRole('link')).toHaveLength(1);
 expect(within(card).getByRole('link',{name:'a11y-audit'})).toHaveAttribute('href','#/skill/a11y-audit?root=marketplace');
 const install=within(card).getByRole('button',{name:'Install'});
 expect(install).toHaveClass('card-install');
 fireEvent.click(install);
 await waitFor(()=>expect(location.hash).toBe('#/skill/a11y-audit?dialog=install&root=marketplace'));
 expect(await screen.findByRole('dialog',{name:'Install a11y-audit'})).toBeVisible();
});

function openWith(route:string,backend:Backend){location.hash=route;return render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);}
it('preserves checkout root and URL state across search and overview changes',async()=>{
 const root='/Users/you/code/mrf';open('#/library/checkout?root='+encodeURIComponent(root)+'&q=migration&overview=0&__mock=detected-root&theme=light');
 expect(await screen.findByRole('link',{name:'MRF 2'})).toHaveAttribute('aria-current','page');
 await screen.findByText('2 skills');
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'csv'}});
 fireEvent.click(screen.getByRole('button',{name:'Show overview'}));
 await waitFor(()=>{const params=new URLSearchParams(location.hash.split('?')[1]);expect(params.get('root')).toBe(root);expect(params.get('q')).toBe('csv');expect(params.get('overview')).toBeNull();expect(params.get('__mock')).toBe('detected-root');expect(params.get('theme')).toBe('light');});
 fireEvent.click(screen.getByRole('button',{name:'Hide overview'}));
 await waitFor(()=>expect(new URLSearchParams(location.hash.split('?')[1]).get('overview')).toBe('0'));
});
it('requires a checkout root before calling library',async()=>{
 const backend=createMockBackend(),library=vi.spyOn(backend,'library');openWith('#/library/checkout',backend);
 expect(await screen.findByRole('alert')).toHaveTextContent('No checkout selected.');expect(library).not.toHaveBeenCalled();
 await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));
});
// `project` carries the root a folder lives in ('Global', or a checkout's basename) and says
// nothing about team membership, so these fixtures keep a realistic root label: a card that
// routes by path only because the test typed the word 'local' into `project` would pass even
// after the adapter stopped emitting it, which is how the route broke in the first place.
it('opens a local card and its Open menu by folder path',async()=>{
 const backend=createMockBackend(),result=await backend.library({scope:{kind:'global'}});if(!result.ok)throw new Error(result.error);
 const path='/a folder/.claude/skills/deploy-check';result.value.skills=[{...result.value.skills[0]!,name:'deploy-check',project:'Global',teamed:false,path}];
 vi.spyOn(backend,'library').mockResolvedValue(result);openWith('#/library/global',backend);
 const card=await screen.findByTestId('skill-card-deploy-check');expect(within(card).getByRole('link')).toHaveAttribute('href','#/skill/local?path='+encodeURIComponent(path));
 fireEvent.click(within(card).getByRole('button',{name:'More actions for deploy-check'}));fireEvent.click(await screen.findByRole('menuitem',{name:'Open'}));
 await waitFor(()=>expect(location.hash).toBe('#/skill/local?path='+encodeURIComponent(path)));
});
it.each([['Run eval','&tab=evals&dialog=run-eval'],['Remove','&dialog=remove']])('routes %s on a local card by path, not by name',async(item,query)=>{
 const backend=createMockBackend(),result=await backend.library({scope:{kind:'global'}});if(!result.ok)throw new Error(result.error);
 const path='/a folder/.claude/skills/deploy-check';
 result.value.skills=[{...result.value.skills[0]!,name:'deploy-check',project:'Global',teamed:false,placed:true,path}];
 vi.spyOn(backend,'library').mockResolvedValue(result);openWith('#/library/global',backend);
 const card=await screen.findByTestId('skill-card-deploy-check');
 fireEvent.click(within(card).getByRole('button',{name:'More actions for deploy-check'}));
 fireEvent.click(await screen.findByRole('menuitem',{name:item}));
 await waitFor(()=>expect(location.hash).toBe('#/skill/local?path='+encodeURIComponent(path)+query));
});
it('sends a team card by name and keeps the marketplace origin',async()=>{
 const backend=createMockBackend();openWith('#/marketplace',backend);
 const card=await screen.findByTestId('skill-card-deploy-check');
 expect(within(card).getByRole('link')).toHaveAttribute('href','#/skill/deploy-check?root=marketplace');
});
// The old screen answered every name-route failure with "listed in your people file but its
// folder is missing", and offered Sync and Remove. A name the team does not share is now reported
// as not-found, where both halves of that sentence would be false and both buttons wrong, so
// neither may come back on this branch.
it('never claims a missing folder or offers Sync/Remove when a name is not in the team',async()=>{
 const backend=createMockBackend(),error='No unambiguous skill diagnose in team acme.';
 vi.spyOn(backend,'skill').mockResolvedValue({ok:false,error,reason:'not-found' as const});
 openWith('#/skill/diagnose',backend);
 expect(await screen.findByText("Couldn't find diagnose")).toBeVisible();
 expect(screen.getByRole('alert')).toHaveTextContent(error);
 expect(screen.queryByText(/listed in your people file/)).toBeNull();
 expect(screen.queryByText(/folder is missing from this machine/)).toBeNull();
 expect(screen.queryByRole('button',{name:'Sync now'})).toBeNull();
 expect(screen.queryByRole('button',{name:/^Remove/})).toBeNull();
 const panel=document.querySelector('.centered-state')!;
 expect(within(panel as HTMLElement).getByRole('button',{name:'Back to library'})).toBeVisible();
 expect(within(panel as HTMLElement).getByRole('button',{name:'Open marketplace'})).toBeVisible();
});
it('reports an unreadable name-route failure with the CLI message and can retry',async()=>{
 const backend=createMockBackend(),error='fatal: could not read the team clone';
 vi.spyOn(backend,'skill').mockResolvedValue({ok:false,error,reason:'unreadable' as const});
 openWith('#/skill/deploy-check',backend);
 expect(await screen.findByText("Couldn't read deploy-check")).toBeVisible();
 expect(screen.getByRole('alert')).toHaveTextContent(error);
 expect(screen.queryByText(/listed in your people file/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));
 await waitFor(()=>expect(backend.skill).toHaveBeenCalledTimes(2));
});
it.each([true,false])('keeps a local error honest and never offers checkout removal (typed=%s)',async typed=>{
 const backend=createMockBackend(),error='Raw CLI failure for /tmp/a';
 vi.spyOn(backend,'localSkill').mockResolvedValue({ok:false,error,...(typed?{reason:'not-in-library' as const}:{})});
 const remove=vi.spyOn(backend.checkouts,'remove');openWith('#/skill/local?path=%2Ftmp%2Fa',backend);
 expect(await screen.findByText(typed?'Not in your library':"Couldn't read a")).toBeVisible();
 expect(screen.getByRole('alert')).toHaveTextContent(error);
 expect(screen.queryByRole('button',{name:/Remove|Forget/i})).toBeNull();expect(remove).not.toHaveBeenCalled();
 const board=document.querySelector('.centered-state')??screen.getByText(typed?'Not in your library':"Couldn't read a").parentElement!;
 expect(within(board as HTMLElement).getByRole('button',{name:'Back to library'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Try again'})!==null).toBe(!typed);
 if(!typed){fireEvent.click(screen.getByRole('button',{name:'Try again'}));await waitFor(()=>expect(backend.localSkill).toHaveBeenCalledTimes(2));}
});
it('selects the longest registered checkout for local details and uses its label in crumbs',async()=>{
 const backend=createMockBackend(),status=await backend.status();if(!status.ok)throw new Error(status.error);
 vi.spyOn(backend,'status').mockResolvedValue({ok:true,value:{...status.value,roots:['/repo','/repo/nested'].map(root=>({id:root,root,label:root==='/repo'?'Outer':'Inner',kind:'checkout',registered:true,detected:false}))}});
 openWith('#/skill/local?path='+encodeURIComponent('/repo/nested/.claude/skills/deploy-check'),backend);
 await screen.findByRole('heading',{name:'deploy-check'});expect(screen.getByRole('link',{name:'Inner'})).toHaveAttribute('aria-current','page');expect(screen.getByRole('link',{name:'Outer'})).not.toHaveAttribute('aria-current');expect(document.querySelector('.detail-crumbs')).toHaveTextContent('Inner');
});

it.each(['none-with-skills','none-empty','unreadable'] as const)('shows the appropriate Library board for %s',async mode=>{
 const backend=createMockBackend(),result=await backend.library({scope:{kind:'global'}});if(!result.ok)throw new Error(result.error);
 result.value.team=mode==='unreadable'?{kind:'unreadable',message:'clone denied'}:{kind:'none'};
 if(mode==='none-empty')result.value.skills=[];
 vi.spyOn(backend,'library').mockResolvedValue(result);openWith('#/library/global',backend);
 if(mode==='none-empty'){expect(await screen.findByText('No team on this machine')).toBeVisible();expect(screen.getByRole('button',{name:'Start setup'})).toBeVisible();}
 else {expect(await screen.findByTestId('skill-card-deploy-check')).toBeVisible();expect(screen.queryByText('No team on this machine')).toBeNull();}
 if(mode==='unreadable')expect(screen.getByText('Team unreadable: clone denied · cards show local state only')).toBeVisible();
});
it('removes a placed local detail by the skill name, never the local route token',async()=>{
 const backend=createMockBackend(),remove=vi.spyOn(backend,'uninstallSkill');
 openWith('#/skill/local?path=%2Ftmp%2Fdeploy-check&dialog=remove',backend);
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Remove'}));
 await waitFor(()=>expect(remove).toHaveBeenCalledWith({ref:'deploy-check'}));
 await waitFor(()=>expect(location.hash).toBe('#/library/global'));
});
it('resets a local action error when navigating to another path',async()=>{
 const backend=createMockBackend();vi.spyOn(backend,'openInEditor').mockResolvedValue({ok:false,error:'Editor refused first folder'});
 openWith('#/skill/local?path=%2Ffirst%2Fdeploy-check',backend);
 fireEvent.click(await screen.findByRole('button',{name:'Edit'}));expect(await screen.findByRole('alert')).toHaveTextContent('Editor refused first folder');
 location.hash='#/skill/local?path=%2Fsecond%2Fdeploy-check';fireEvent(window,new HashChangeEvent('hashchange'));
 expect(await screen.findByRole('heading',{name:'deploy-check'})).toBeVisible();expect(screen.queryByRole('alert')).toBeNull();
 expect(document.querySelector('.detail-repo')).toHaveTextContent('/second/deploy-check');
});
// The Library Connect CTA was removed on 2026-09-10 (ratified override, .planning/specs/
// 2026-09-10-library-mirror-id-sync.md): global skills auto-share at sync by ID check, and the
// empty state's primary is the manual project path — the sidebar's native Add project flow (#102).
it('the empty library offers Add project as its primary and drives the chooser into checkout add',async()=>{
 const backend=createMockBackend();const pick=vi.spyOn(backend,'pickFolder');const add=vi.spyOn(backend.checkouts,'add');
 openWith('#/library/global?__mock=empty',backend);
 await screen.findByText('No skills in your global library');
 expect(screen.queryByRole('button',{name:'Connect'})).toBeNull();
 fireEvent.click(screen.getAllByRole('button',{name:'Add project'}).at(-1)!);
 await waitFor(()=>expect(add).toHaveBeenCalledWith('/Users/you/code/new-project'));
 expect(pick).toHaveBeenCalledOnce();
});
it('the empty library degrades its primary to the marketplace link when the CLI has no checkout add',async()=>{
 const backend=createMockBackend();const features=await backend.features();
 vi.spyOn(backend,'features').mockResolvedValue({...features,checkouts:false});
 openWith('#/library/global?__mock=empty',backend);
 await screen.findByText('No skills in your global library');
 expect(screen.queryByRole('button',{name:'Add project'})).toBeNull();
 fireEvent.click(screen.getAllByRole('button',{name:'Open marketplace'}).at(-1)!);
 await waitFor(()=>expect(location.hash).toBe('#/marketplace'));
});

it('preserves the mock breadcrumb and fixture hygiene caption',async()=>{
 open('#/skill/deploy-check');
 await screen.findByRole('heading',{name:'deploy-check'});
 expect(document.querySelector('.detail-crumbs')?.textContent).toBe('Global/terum/infra/deploy-check');
 fireEvent.click(screen.getByRole('tab',{name:'Quality'}));
 expect(screen.getByText('Hygiene checks · passed on connect, 12 days ago · free, no model calls')).toBeVisible();
});
