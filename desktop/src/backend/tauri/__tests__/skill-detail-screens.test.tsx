import { afterEach,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import { EvalRunProvider } from '../../../app/EvalRunProvider';
import { createRun } from '../../mock/run';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { createTauriBackend } from '../index';
import { detailReplay,type AmendResult } from './skill-detail-replay';
import { STATE } from './fake-bridge';

afterEach(()=>{cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});
function open(route:string,amend?:AmendResult,launch:'fresh'|'consumed'='fresh') {
  useUiStore.setState({railOpen:true,overviewHidden:false});
  const f=detailReplay(amend),backend=createTauriBackend(f.bridge);
  // LaunchCoordinator sends an *unconsumed* launch request to onboarding when the machine has no
  // team, replacing whatever route was asked for. A screen reached by in-app navigation has already
  // consumed that request, so a test serving no teams says 'consumed' rather than racing the
  // redirect for its assertions.
  if(launch==='consumed')backend.prefs.set('launch:consumedWrittenAt',STATE.writtenAt);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  location.hash=route;
  render(<BackendContext value={backend}><QueryClientProvider client={client}><Tooltip.Provider><EvalRunProvider><App/></EvalRunProvider></Tooltip.Provider></QueryClientProvider></BackendContext>);
  return {f,backend,client};
}

it('renders the recorded detail in the board shapes with one heading and real provenance',async()=>{
  open('#/skill/deploy-check?menu=files');
  // Description and SKILL.md body both carry the first body paragraph now that desc derives from the body (re-land of #111).
  await screen.findAllByText('Use this skill when a deploy needs a pre-flight checklist.');
  expect(document.querySelectorAll('h1')).toHaveLength(1);
  expect(document.querySelector('.detail-crumbs')?.textContent).toBe('Global/acme/ops/deploy-check');
  // The recording's viewer is `seed`, one of the two installers, so the viewer is named (PR 104).
  expect(screen.getAllByText('Installed by you and 1 teammate').length).toBeGreaterThan(0);
  expect(screen.getByText('Global · since 2026-08-20')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'acme/team'})).toHaveAttribute('href','https://github.com/acme/team/tree/43bf7396d9edbdcfba751bc63dbe1c74055125ae/skills/deploy-check/');
  expect(screen.getByText('skills/deploy-check')).toBeVisible();
  expect(document.querySelector('.detail-author')).toHaveTextContent('Mira Chenmira');
  expect(document.querySelector('.skill-md-meta')).not.toHaveTextContent(' · —');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.queryByRole('button',{name:'Show files'})).toBeNull();
  expect(screen.getByText('Installed',{selector:'.detail-status span'})).toBeVisible();
  fireEvent.click(screen.getByRole('tab',{name:'Quality'}));
  expect(screen.getByText('Hygiene checks · passed on connect · free, no model calls')).toBeVisible();
  expect(screen.getByText('Per-check results are not reported by this terum-skills version.')).toBeVisible();
  expect(screen.getByText('No tool grants requested')).toBeVisible();
  expect(screen.queryByText('none')).toBeNull();
  fireEvent.click(screen.getByRole('tab',{name:'Activity'}));
  expect(screen.getByText('0 events')).toBeVisible();
  expect(screen.getByText('No recorded activity on this machine.')).toBeVisible();
});
it('shows the global install destination and full team-version prefix for an unplaced skill',async()=>{
  open('#/skill/tdd?dialog=install');
  const dialog=await screen.findByRole('dialog');
  expect(within(dialog).getByRole('radio',{name:/Global/})).toBeVisible();
  expect(within(dialog).getByText(/Copies the team's current version \(db604968dcc6\)/)).toBeVisible();
  expect(within(dialog).queryByText('Approved once per machine; a changed grant set asks again.')).toBeNull();
  expect(screen.queryByRole('button',{name:'Edit'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Open in editor'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Manage with Terum…'})).toBeNull();
});
it('renders a not-found board that offers the library first and the marketplace second',async()=>{
  open('#/skill/nope');
  expect(await screen.findByText("Couldn't find nope")).toBeVisible();
  expect(screen.getByText('No team skill and no folder terum-skills can open carry this name. It may have been renamed, be a symlink, or live in a checkout that is not registered.')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('No skill named nope is shared in team acme, and no readable folder of that name is in your Library roots.');
  expect(screen.queryByRole('button',{name:/Remove/})).toBeNull();
  expect(screen.getAllByRole('button',{name:'Back to library'})).toHaveLength(2);
  expect(screen.queryByRole('button',{name:'Open marketplace'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Search the marketplace'}));
  await waitFor(()=>expect(location.hash).toBe('#/marketplace?q=nope'));
});
it('renders an unreadable board and refetches from Try again',async()=>{
  let fail=true;
  open('#/skill/deploy-check',(name,_value,frame)=>{
    if(name==='ls'&&fail){frame.ok=false;frame.error='Read failed.';delete frame.value;}
  });
  expect(await screen.findByText("Couldn't read deploy-check")).toBeVisible();
  expect(screen.getByText('terum-skills could not read the team clone or the skills folder. Check the path in Settings, then try again.')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Read failed.');
  expect(screen.getByRole('button',{name:'Open settings'})).toBeVisible();
  expect(screen.queryByRole('button',{name:/Remove/})).toBeNull();
  fail=false;
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  expect(await screen.findByRole('heading',{name:'deploy-check'})).toBeVisible();
});
it('renders the no-team board when status serves no teams, with no missing-folder story and no Remove',async()=>{
  open('#/skill/deploy-check',(name,value)=>{if(name==='status')value.teams=[];},'consumed');
  expect(await screen.findByText('No team on this machine')).toBeVisible();
  expect(screen.getByText('Create a team or join the one you were invited to. Setup runs here in the app.')).toBeVisible();
  expect(screen.queryByText(/listed in your people file/)).toBeNull();
  expect(screen.queryByRole('button',{name:/Remove/})).toBeNull();
  expect(document.querySelector('.detail-body .terminal-hint')).toHaveTextContent('npx -y terum-skills@latest setup');
  fireEvent.click(screen.getByRole('button',{name:'Start setup'}));
  await waitFor(()=>expect(location.hash).toBe('#/onboarding/boot?start=1'));
});
it('tells the user to pick a team when status serves two, with the CLI naming them and no Remove',async()=>{
  open('#/skill/deploy-check',(name,value)=>{const teams=value.teams as Record<string,unknown>[];if(name==='status')value.teams=[...teams,{...teams[0]!,team:'zeta'}];});
  expect(await screen.findByText('Choose a team')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('This machine is configured for teams acme, zeta');
  expect(screen.queryByText(/listed in your people file/)).toBeNull();
  expect(screen.queryByRole('button',{name:/Remove/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Open settings'}));
  await waitFor(()=>expect(location.hash).toBe('#/settings/teams'));
});
it.each([[0,'Nobody has installed this yet'],[1,'Installed by you'],[2,'Installed by you and 1 teammate']] as const)('renders the installer count %s as %j (the viewer `seed` is an installer)',async(count,label)=>{
  open('#/skill/deploy-check',(name,value)=>{if(name==='ls')(value.skills as Record<string,unknown>[])[0]!.installs=count;});
  await screen.findByRole('heading',{name:'deploy-check'});
  expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Installed by \d+ teammates?/)).toBeNull();
});

it.each([0,1,2])('keeps a successful validation with %s warnings in Quality and refreshes the detail',async warnings=>{
  const {backend,client}=open('#/skill/deploy-check?tab=quality');
  await screen.findByText('Hygiene checks · passed on connect · free, no model calls');
  const invalidate=vi.spyOn(client,'invalidateQueries');
  vi.spyOn(backend,'validate').mockResolvedValue({ok:true,value:{name:'deploy-check',findings:0,warnings}});
  fireEvent.click(screen.getByRole('button',{name:'Validate'}));
  expect(await screen.findByText(`hygiene passed${warnings?` · ${warnings} warning${warnings===1?'':'s'}`:''}`)).toBeVisible();
  expect(invalidate).toHaveBeenCalledWith({queryKey:['skill','deploy-check']});
  expect(screen.getByRole('heading',{name:'deploy-check'})).toBeVisible();
});
it.each([true,false])('keeps validation failure (with value=%s) in Quality',async hasValue=>{
  const {backend}=open('#/skill/deploy-check?tab=quality');
  await screen.findByText('Hygiene checks · passed on connect · free, no model calls');
  vi.spyOn(backend,'validate').mockResolvedValue({ok:false,error:'Cannot validate.',...(hasValue?{value:{name:'deploy-check',findings:2,warnings:1}}:{})});
  fireEvent.click(screen.getByRole('button',{name:'Validate'}));
  expect(await screen.findByText(hasValue?'2 findings · 1 warning':'Cannot validate.')).toBeVisible();
  expect(screen.getByRole('heading',{name:'deploy-check'})).toBeVisible();
  expect(screen.queryByText("Couldn't read deploy-check")).toBeNull();
});
it('keeps a rejected validation in Quality',async()=>{
  const {backend}=open('#/skill/deploy-check?tab=quality');
  await screen.findByText('Hygiene checks · passed on connect · free, no model calls');
  vi.spyOn(backend,'validate').mockRejectedValue(new Error('Validation unavailable.'));
  fireEvent.click(screen.getByRole('button',{name:'Validate'}));
  expect(await screen.findByText('Validation unavailable.')).toHaveClass('board-error-line');
  expect(screen.getByRole('heading',{name:'deploy-check'})).toBeVisible();
});
it('shows the local eval command without a receipt commit choice',async()=>{
  open('#/skill/deploy-check?dialog=run-eval');
  const dialog=await screen.findByRole('dialog');
  expect(dialog.querySelector('.terminal-hint .board-mono')).toHaveTextContent('npx -y terum-skills@latest eval deploy-check');
  expect(dialog.querySelector('[role="checkbox"]')).toBeNull();
});
it.each(['global','project'])('passes the selected %s copy to Remove',async scope=>{
  const {f}=open('#/skill/deploy-check?dialog=remove',(name,value)=>{
    if(name==='ls-local'&&scope==='project'){
      const sections=value.local as {scope:string;root:string;repoRoot?:string;label:string;rootState:string;rows:unknown[]}[];
      sections[1]!.rootState='scanned';sections[1]!.rows=sections[0]!.rows;sections[0]!.rows=[];
    }
  });
  const dialog=await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:'Remove'}));
  await waitFor(()=>expect(f.spawns.find(spawn=>spawn.args[0]==='uninstall-skill')?.args).toEqual(['uninstall-skill','--team','acme','--from',scope==='global'?'global':'/Users/teddy/code/seed','--','deploy-check']));
});

it('shows teammates\' committed runs when this version has no receipt of its own',async()=>{
  open('#/skill/deploy-check?tab=evals',(name,value)=>{
    if(name==='eval-report-deploy-check')value.history=[
      {version:'a'.repeat(40),run_id:'20260910T060851Z',timestamp:'2026-09-10T06:08:51Z',runner_handle:'ajayw36',comparison:null,verdict:'NEUTRAL',execution_status:'complete'},
      {version:'b'.repeat(40),run_id:'20260910T053814Z',timestamp:'2026-09-10T05:38:14Z',runner_handle:'ryanliu-terum',comparison:null,verdict:'NEUTRAL',execution_status:'complete'},
    ];
  });
  expect(await screen.findByText('No receipt for this version',{selector:'.state-title'})).toBeVisible();
  expect(screen.getByText('This version has not been evaluated. Older runs for earlier versions are listed in History; they are never compared or merged with this version.')).toBeVisible();
  expect(screen.getByText('History')).toBeVisible();
  expect(screen.getByText(/ajayw36/)).toBeVisible();expect(screen.getByText(/ryanliu-terum/)).toBeVisible();
  expect(screen.queryByText('Not evaluated',{selector:'.state-title'})).toBeNull();expect(document.querySelectorAll('[data-showing]')).toHaveLength(0);
  expect(document.querySelector('.history-figure')).toBeNull();expect(document.querySelector('.history-rail .row-strip')).toBeNull();
});
it('keeps the drawn empty state exactly when there is no history at all',async()=>{
  open('#/skill/deploy-check?tab=evals');
  expect(await screen.findByText('Not evaluated',{selector:'.state-title'})).toBeVisible();
  expect(screen.getByText('Run an eval to score this skill against a baseline with no skill.')).toBeVisible();
  expect(screen.queryByText('History')).toBeNull();expect(document.querySelector('.evals-body')).toBeNull();
});
it('renders a team SKILL.md through the drawn Markdown vocabulary',async()=>{
  open('#/skill/deploy-check',(name,value)=>{
    if(name==='ls')(value.skills as Record<string,unknown>[])[0]!.body=
      '\n# deploy-check\n\n## When to use\n\nBefore a **deploy**, see [docs](https://x.dev/a).\n\n---\n\n1. one\n2. two\n\n```bash\nverify.sh\n```\n\n![shot](https://evil.example/p.png)\n';
  });
  await screen.findByRole('heading',{name:'deploy-check'});
  // The leading H1 is stripped (it matches the name) and a document H1 would become h2.md-h1 anyway.
  expect(document.querySelectorAll('h1')).toHaveLength(1);
  expect(document.querySelector('.md-doc .md-h1')).toBeNull();
  expect(document.querySelector('.md-doc > h2')).toHaveClass('md-h2');
  expect(document.querySelector('.md-doc ol')).toHaveClass('md-list');
  expect(document.querySelector('.md-doc pre')).toHaveClass('md-code');
  expect(document.querySelector('.md-doc hr')).toHaveClass('md-hr');
  expect(document.querySelectorAll('.md-doc a')).toHaveLength(0);
  expect(document.querySelectorAll('.md-doc img')).toHaveLength(0);
  expect(document.querySelector('.skill-md-meta')).toHaveTextContent('17 lines');
});
const uncRoot=String.raw`\\wsl.localhost\Ubuntu\home\teniroo`,uncPath=uncRoot+String.raw`\.claude\skills\adopt-agent-tooling`;
function localFolder(root=uncRoot,invalid=false):AmendResult{return (name,value)=>{
 if(name!=='ls-local')return;
 const sections=value.local as Record<string,unknown>[];
 const separator=root===uncRoot?String.raw`\\`.slice(0,1):'/';
 const folder=root+separator+'.claude'+separator+'skills',path=folder+separator+'adopt-agent-tooling';
 Object.assign(sections[1]!,{root:folder,repoRoot:root,label:'teniroo',rootState:'scanned',registered:false,detected:true,rows:invalid?[]:[{name:'adopt-agent-tooling',path,state:'untracked locally',tracked:false,placement:null,health:'untracked'}],notOffered:invalid?[{name:'adopt-agent-tooling',path,reason:'invalid-yaml'}]:[]});
};}
it.each([['UNC',uncRoot,uncPath],['POSIX','/home/teniroo','/home/teniroo/.claude/skills/adopt-agent-tooling']] as const)('names the checkout in the crumb and the sidebar when a %s payload holds the folder',async(_label,root,path)=>{
 open('#/skill/local?path='+encodeURIComponent(path),localFolder(root));
 await screen.findByRole('heading',{name:'adopt-agent-tooling'});
 expect(document.querySelector('.detail-crumbs')?.textContent).toBe('teniroo/adopt-agent-tooling');
 expect(screen.getByRole('link',{name:/^teniroo/})).toHaveAttribute('aria-current','page');
 expect(screen.getByRole('link',{name:/^Global/})).not.toHaveAttribute('aria-current');
});
it('opens a folder the CLI could not parse, by path, and still names its checkout',async()=>{
 open('#/skill/local?path='+encodeURIComponent(uncPath),localFolder(uncRoot,true));
 await screen.findByRole('heading',{name:'adopt-agent-tooling'});
 expect(document.querySelector('.detail-crumbs')?.textContent).toBe('teniroo/adopt-agent-tooling');
 expect(screen.getByRole('link',{name:/^teniroo/})).toHaveAttribute('aria-current','page');
 expect(screen.getByText('Not connectable · invalid-yaml')).toBeVisible();
});
it('sends the folder, not the route segment, to validate',async()=>{
 const {backend,client}=open('#/skill/local?path='+encodeURIComponent(uncPath)+'&tab=quality',localFolder());
 await screen.findByRole('heading',{name:'adopt-agent-tooling'});
 const validate=vi.spyOn(backend,'validate').mockResolvedValue({ok:true,value:{name:'adopt-agent-tooling',findings:0,warnings:0}}),invalidate=vi.spyOn(client,'invalidateQueries');
 fireEvent.click(screen.getByRole('button',{name:'Validate'}));
 expect(await screen.findByText('hygiene passed')).toBeVisible();
 expect(validate).toHaveBeenCalledExactlyOnceWith({ref:uncPath});
 expect(invalidate).toHaveBeenCalledWith({queryKey:['skill','local:'+uncPath]});
});
it('sends the skill name, not the route segment, to eval',async()=>{
 const {backend}=open('#/skill/local?path='+encodeURIComponent(uncPath)+'&tab=evals&dialog=run-eval',localFolder());
 const dialog=await screen.findByRole('dialog');
 const evaluate=vi.spyOn(backend,'eval').mockImplementation(()=>createRun(async()=>({ok:false,error:'Eval failed for this test.'})));
 fireEvent.click(within(dialog).getByRole('button',{name:'Run eval'}));
 await waitFor(()=>expect(evaluate).toHaveBeenCalledExactlyOnceWith({ref:'adopt-agent-tooling'}));
 await waitFor(()=>expect(new URLSearchParams(location.hash.split('?')[1]).has('dialog')).toBe(false));
 // Successful runs dismiss themselves; retain a failed run to exercise the host's URL dismissal.
 await screen.findByText('Eval failed for this test.');
 await act(async()=>{location.hash+='&dialog=run-eval';fireEvent(window,new PopStateEvent('popstate'));});
 const running=await screen.findByRole('dialog');
 fireEvent.click(await within(running).findByRole('button',{name:'Close'}));
 await waitFor(()=>expect(new URLSearchParams(location.hash.split('?')[1]).has('dialog')).toBe(false));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
const seedRoot='/Users/teddy/code/seed',seedOrigin='root='+encodeURIComponent(seedRoot);
function projectCopy(both=false,duplicateLabel=false):AmendResult{return (name,value)=>{
 if(name!=='ls-local')return;
 const sections=value.local as {root:string;repoRoot?:string;label:string;rootState:string;rows:Record<string,unknown>[]}[];
 const project=sections[1]!;
 project.rootState='scanned';project.rows=sections[0]!.rows.map(row=>({...row,path:project.root+'/'+row.name}));
 if(!both)sections[0]!.rows=[];
 if(duplicateLabel)sections.push({...project,root:'/another/seed/.claude/skills',repoRoot:'/another/seed',rows:[]});
};}
it('returns to the checkout library from a scoped page and from its error board',async()=>{
 open('#/skill/deploy-check?'+seedOrigin,projectCopy());
 await screen.findByRole('heading',{name:'deploy-check'});
 fireEvent.click(screen.getByRole('button',{name:'Back to library'}));
 await waitFor(()=>expect(location.hash).toBe('#/library/checkout?'+seedOrigin));
 cleanup();open('#/skill/nope?'+seedOrigin,projectCopy());
 await screen.findByText("Couldn't find nope");
 fireEvent.click(within(document.querySelector('.centered-state') as HTMLElement).getByRole('button',{name:'Back to library'}));
 await waitFor(()=>expect(location.hash).toBe('#/library/checkout?'+seedOrigin));
});
it('renders the ambiguous board when two team ids share a prefix',async()=>{
 open('#/skill/ab',(name,value)=>{if(name==='ls'){const skills=value.skills as Record<string,unknown>[];skills[0]!.id='ab-one';skills[1]!.id='ab-two';}});
 expect(await screen.findByText('More than one skill matches')).toBeVisible();
 expect(screen.getByText('This reference is the start of more than one skill ID in your team. Open the one you want from the marketplace, where each skill has its own page.')).toBeVisible();
 expect(screen.getByRole('alert')).toHaveTextContent('2 team skills in acme have an ID starting with ab; open the one you want from the marketplace.');
 const panel=document.querySelector('.centered-state') as HTMLElement;
 expect(within(panel).getAllByRole('button')[0]).toHaveTextContent('Open marketplace');
 fireEvent.click(within(panel).getByRole('button',{name:'Open marketplace'}));
 await waitFor(()=>expect(location.hash).toBe('#/marketplace'));
});
it.each([false,true])('removes the copy in the root the URL named (both roots and duplicate labels=%s)',async both=>{
 const {f}=open('#/skill/deploy-check?'+seedOrigin+'&dialog=remove',projectCopy(both,both));
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Remove'}));
 await waitFor(()=>expect(f.spawns.find(spawn=>spawn.args[0]==='uninstall-skill')?.args).toEqual(['uninstall-skill','--team','acme','--from',seedRoot,'--','deploy-check']));
 await waitFor(()=>expect(location.hash).toBe('#/library/checkout?'+seedOrigin));
});
it('keeps the by-path remove argv unchanged',async()=>{
 const {f}=open('#/skill/local?path='+encodeURIComponent(seedRoot+'/.claude/skills/deploy-check')+'&dialog=remove',projectCopy());
 fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Remove'}));
 await waitFor(()=>expect(f.spawns.find(spawn=>spawn.args[0]==='uninstall-skill')?.args).toEqual(['uninstall-skill','--team','acme','--','deploy-check']));
});
it('validates the team name on a qualified name route, not its placed folder or qualified ref',async()=>{
 const {backend}=open('#/skill/acme%2Fdeploy-check?'+seedOrigin+'&tab=quality',projectCopy());
 await screen.findByRole('heading',{name:'deploy-check'});
 const validate=vi.spyOn(backend,'validate').mockResolvedValue({ok:true,value:{name:'deploy-check',findings:0,warnings:0}});
 fireEvent.click(screen.getByRole('button',{name:'Validate'}));
 await waitFor(()=>expect(validate).toHaveBeenCalledWith({ref:'deploy-check',team:'acme'}));
 expect(validate.mock.calls.every(([args])=>args.ref==='deploy-check')).toBe(true);
});


it('renders the real adapter frontmatter exactly as the CLI read it', async () => {
 const frontmatter='---\n# Keep the file formatting\ndescription: "Deploy: carefully"\nname: deploy-check\nmetadata:\n  author: "Mira <mira@example.com>"\n---';
 open('#/skill/deploy-check',(name,value)=>{
  if(name==='ls')for(const row of value.skills as Record<string,unknown>[])row.frontmatter=frontmatter;
 });
 const block=await screen.findByTestId('frontmatter');
 expect(block.textContent).toBe(frontmatter);
 expect(block).toHaveClass('md-code','md-frontmatter');
 expect(document.querySelector('.md-doc')?.textContent).not.toContain('# Keep the file formatting');
});
