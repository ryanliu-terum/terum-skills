import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext, PrintContext, PromptContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { createRun } from '../../backend/mock/run';
import type { EvalResult, Run } from '../../backend/types';
import { App } from '../../app/App';
import { EvalRunProvider } from '../../app/EvalRunProvider';
const value:EvalResult={name:'deploy-check',runDir:'/tmp/run',executionStatus:'complete',commit:null};
const runs:Run<EvalResult>[]=[];
afterEach(async()=>{for(const run of runs.splice(0))await run.cancel();cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});
async function open(choice=true,estimate?:string){
 const backend=createMockBackend(),caps=await backend.capabilities();
 vi.spyOn(backend,'capabilities').mockResolvedValue({...caps,evalCommitChoice:choice});
 if(estimate!==undefined){const detail=await backend.skill({ref:'deploy-check'});if(!detail.ok)throw new Error(detail.error);vi.spyOn(backend,'skill').mockResolvedValue({ok:true,value:{...detail.value,evalEstimateText:estimate}});}
 const evalSpy=vi.spyOn(backend,'eval');
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const ask=vi.fn(async()=>true),print=vi.fn();
 location.hash='#/skill/deploy-check?tab=evals&dialog=run-eval';
 render(<BackendContext value={backend}><QueryClientProvider client={client}><Tooltip.Provider><PromptContext value={ask}><PrintContext value={print}><EvalRunProvider><App/></EvalRunProvider></PrintContext></PromptContext></Tooltip.Provider></QueryClientProvider></BackendContext>);
 await screen.findByRole('dialog');
 if(choice)await screen.findByRole('checkbox',{name:'Commit the receipt to the team'});
 return {backend,evalSpy,client,ask,print};
}
function longRun(){const run=createRun<EvalResult>(async ctx=>{ctx.print('preflight ok');await ctx.sleep(60_000);return {ok:true,value};});runs.push(run);return {run,cancel:vi.spyOn(run,'cancel')};}
function start(){fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Run eval'}));}
it('keeps the eval alive across navigation and reopens its streamed output from the chip',async()=>{
 const {evalSpy}=await open();const {run,cancel}=longRun();evalSpy.mockReturnValue(run);start();
 await screen.findByText('preflight ok');
 await act(async()=>{location.hash='#/library/global';});
 await screen.findByText('Eval running · deploy-check');
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(cancel).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Eval running · deploy-check'}));
 expect(await within(await screen.findByRole('dialog')).findByText('preflight ok')).toBeVisible();
 expect(cancel).not.toHaveBeenCalled();
});
it('stops once and retains a Stopped result with Close',async()=>{
 const {evalSpy}=await open();const {run,cancel}=longRun();evalSpy.mockReturnValue(run);start();
 await screen.findByText('preflight ok');
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Stop'}));
 expect(await screen.findByText('Stopped')).toBeVisible();expect(cancel).toHaveBeenCalledTimes(1);
 expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Close'})).toBeVisible();
});
it('keeps local commit failures and both lines visible, and invalidates skill reads',async()=>{
 const {evalSpy,client}=await open();const invalidate=vi.spyOn(client,'invalidateQueries');
 evalSpy.mockImplementation(()=>createRun(async ctx=>{ctx.print('first line');ctx.print('second line');return {ok:false,error:'push refused',value:{...value,commit:{ok:false,error:'push refused'}}};}));start();
 expect(await screen.findByText('Evaluated locally; committing the receipt failed: push refused')).toBeVisible();
 expect(screen.getByRole('log')).toHaveTextContent('first line second line');
 expect(screen.getByRole('button',{name:'Close'})).toBeVisible();
 expect(invalidate).toHaveBeenCalled();expect(invalidate.mock.calls[0]?.[0]?.predicate?.({queryKey:['skill','deploy-check']} as never)).toBe(true);
});
it('preserves the locked mock confirmation copy and omits the checkbox',async()=>{
 await open(false);const dialog=screen.getByRole('dialog');
 expect(within(dialog).queryByRole('checkbox')).toBeNull();
 expect(within(dialog).getByText(/The receipt is committed to the team repo when it completes\.$/)).toBeVisible();
 expect(within(dialog).getByRole('button',{name:'Cancel'})).toBeVisible();
});
it.each([true,false])('passes the explicit commit choice %s',async commit=>{
 const {evalSpy}=await open();const {run}=longRun();evalSpy.mockReturnValue(run);
 const checkbox=screen.getByRole('checkbox',{name:'Commit the receipt to the team'});expect(checkbox).toBeChecked();
 if(!commit)fireEvent.click(checkbox);start();expect(evalSpy).toHaveBeenCalledWith({ref:'deploy-check',commit});
});
it('uses the exact honest cost sentence without an estimate',async()=>{
 await open(true,'');expect(screen.getByText('No previous run to estimate from. This uses your Claude account and can take a while.')).toBeVisible();
});
it('forwards unexpected questions and print notices, and closes on success',async()=>{
 const {evalSpy,ask,print}=await open();evalSpy.mockImplementation(()=>createRun(async ctx=>{ctx.print('GitHub CLI is installed but logged out.');await ctx.ask('confirm','Unexpected eval question?');return {ok:true,value};}));start();
 await waitFor(()=>expect(ask).toHaveBeenCalledWith({kind:'confirm',question:'Unexpected eval question?'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(print).toHaveBeenCalledWith('GitHub CLI is installed but logged out.');
});

it('refuses a second skill run while the first is active',async()=>{
 const {evalSpy}=await open();const {run}=longRun();evalSpy.mockReturnValue(run);start();await screen.findByText('preflight ok');
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await act(async()=>{location.hash='#/skill/migration-guard?tab=evals&dialog=run-eval';});
 await screen.findByRole('dialog');start();
 expect(await screen.findByText('An eval is already running for deploy-check')).toBeVisible();expect(evalSpy).toHaveBeenCalledTimes(1);
});
it('shows invalid newest with history, never an older report',async()=>{
 const backend=createMockBackend();location.hash='#/skill/deploy-check?tab=evals&__mock=invalid-newest';
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient()}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 expect(await screen.findByText('The newest receipt for this version is invalid')).toBeVisible();expect(screen.getByText('History')).toBeVisible();expect(document.querySelector('.evaluation-report')).toBeNull();
});
it('shows an uncommitted local report and its history marker',async()=>{
 const backend=createMockBackend(),detail=await backend.skill({ref:'deploy-check'});if(!detail.ok)throw new Error(detail.error);
 vi.spyOn(backend,'skill').mockResolvedValue({ok:true,value:{...detail.value,latestState:'none',history:detail.value.history.map(h=>({...h,local:true}))}});
 location.hash='#/skill/deploy-check?tab=evals';render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient()}><Tooltip.Provider><App/></Tooltip.Provider></QueryClientProvider></BackendContext>);
 expect(await screen.findByText('Local run, not committed · '+detail.value.receipt?.run_id)).toBeVisible();expect(screen.getAllByText('· local, not committed').length).toBeGreaterThan(0);
});

it('reopens the running dialog from the Evals tab URL and survives a failed detail refresh',async()=>{
 const {evalSpy,backend,client}=await open();const {run}=longRun();evalSpy.mockReturnValue(run);start();await screen.findByText('preflight ok');
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'Run eval'}));expect(await screen.findByRole('dialog')).toHaveTextContent('preflight ok');
 vi.spyOn(backend,'skill').mockResolvedValue({ok:false,error:'clone unavailable'});
 await act(async()=>{await client.invalidateQueries({queryKey:['skill']});});
 expect(screen.getByRole('dialog')).toHaveTextContent('preflight ok');expect(within(screen.getByRole('dialog')).getByRole('button',{name:'Stop'})).toBeVisible();
});
