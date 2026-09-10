import { afterEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext } from '../../index';
import { App } from '../../../app/App';
import { useUiStore } from '../../../app/store';
import { createTauriBackend } from '../index';
import { detailReplay,type AmendResult } from './skill-detail-replay';

afterEach(()=>{cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});
function open(route:string,amend?:AmendResult) {
  useUiStore.setState({railOpen:true,overviewHidden:false});
  const f=detailReplay(amend),backend=createTauriBackend(f.bridge);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  location.hash=route;
  render(<BackendContext value={backend}><QueryClientProvider client={client}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
  return {f,backend,client};
}

it('renders the recorded detail in the board shapes with one heading and real provenance',async()=>{
  open('#/skill/deploy-check?menu=files');
  await screen.findByText('Use this skill when a deploy needs a pre-flight checklist.');
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
it('renders a not-found board with the raw error and no Remove action',async()=>{
  open('#/skill/nope');
  expect(await screen.findByText("Couldn't find nope")).toBeVisible();
  expect(screen.getByText('No skill named nope is shared in this team.')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('No unambiguous skill nope in team acme.');
  expect(screen.queryByRole('button',{name:/Remove/})).toBeNull();
  expect(screen.getAllByRole('button',{name:'Back to library'})).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Open marketplace'}));
  await waitFor(()=>expect(location.hash).toBe('#/marketplace'));
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
it('makes the eval command follow the commit choice',async()=>{
  open('#/skill/deploy-check?dialog=run-eval');
  const dialog=await screen.findByRole('dialog');
  expect(dialog.querySelector('.terminal-hint .board-mono')).toHaveTextContent('npx -y terum-skills@latest eval deploy-check --commit');
  fireEvent.click(within(dialog).getByRole('checkbox',{name:'Commit the receipt to the team'}));
  expect(dialog.querySelector('.terminal-hint .board-mono')?.textContent).toBe('npx -y terum-skills@latest eval deploy-check');
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
