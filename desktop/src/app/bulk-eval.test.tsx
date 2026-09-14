import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from '@base-ui/react/tooltip';
import { BackendContext, PrintContext, PromptContext } from '../backend';
import { createMockBackend } from '../backend/mock';
import { createRun } from '../backend/mock/run';
import type { EvalManyResult, Run } from '../backend/types';
import { App } from './App';
import { EvalRunProvider } from './EvalRunProvider';

const runs:Run<EvalManyResult>[]=[];
afterEach(async()=>{for(const run of runs.splice(0))await run.cancel();cleanup();location.hash='';localStorage.clear();vi.restoreAllMocks();});
function open(hash:string,answer=true){
 const backend=createMockBackend(),spy=vi.spyOn(backend,'evalMany');
 const ask=vi.fn(async()=>answer),print=vi.fn();
 location.hash=hash;
 render(<BackendContext value={backend}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Tooltip.Provider><PromptContext value={ask}><PrintContext value={print}><EvalRunProvider><App/></EvalRunProvider></PrintContext></PromptContext></Tooltip.Provider></QueryClientProvider></BackendContext>);
 return {backend,spy,ask,print};
}
const question=()=>screen.findByRole('dialog',{name:/Evaluate .*\?/});
// The command renders as a copyable CliBox (UI policy §1) through CommandText, one span per token, so it is matched as a whole line.
const hint=(root:HTMLElement)=>root.querySelector('.cli-box .board-mono');

it('lists the chosen skills, runs them now, and streams the CLI into one dialog the URL no longer names',async()=>{
 const {spy}=open('#/library/global?dialog=bulk-eval&ref=deploy-check&ref=migration-guard');
 const ask=await question();
 expect(ask).toHaveAccessibleName('Evaluate 2 skills?');
 expect(within(ask).getByText(/deploy-check, migration-guard\. Each eval uses your Claude account/)).toBeVisible();
 expect(hint(ask)).toHaveTextContent('npx -y terum-skills@latest eval deploy-check migration-guard');
 expect(within(ask).getByRole('radio',{name:'Now'})).toBeChecked();
 fireEvent.click(within(ask).getByRole('button',{name:'Run evals'}));
 expect(spy).toHaveBeenCalledWith({refs:['deploy-check','migration-guard'],mode:'now'});
 const running=await screen.findByRole('dialog',{name:'Evaluating 2 skills'});
 expect(await within(running).findByRole('log')).toHaveTextContent('Evaluated 2 of 2; 0 failed.');
 expect(within(running).getByRole('status')).toHaveTextContent('Evaluated 2 of 2; 0 failed.');
 expect(location.hash).toBe('#/library/global');
 fireEvent.click(within(running).getByRole('button',{name:'Close'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});

it('In batches takes a size, passes --batch, forwards the question between batches, and shows the queued remainder when declined',async()=>{
 const {spy,ask}=open('#/library/global?dialog=bulk-eval&ref=deploy-check&ref=migration-guard',false);
 const q=await question();
 fireEvent.click(within(q).getByRole('radio',{name:'In batches'}));
 const size=within(q).getByRole('spinbutton',{name:'Batch size'});
 expect(size).toHaveValue(4);
 fireEvent.change(size,{target:{value:'0'}});
 expect(within(q).getByRole('alert')).toHaveTextContent('A batch is a whole number of at least 1.');
 expect(within(q).getByRole('button',{name:'Run evals'})).toBeDisabled();
 fireEvent.change(size,{target:{value:'1'}});
 expect(hint(q)).toHaveTextContent('npx -y terum-skills@latest eval deploy-check migration-guard --batch 1');
 fireEvent.click(within(q).getByRole('button',{name:'Run evals'}));
 expect(spy).toHaveBeenCalledWith({refs:['deploy-check','migration-guard'],mode:'batches',batch:1});
 await waitFor(()=>expect(ask).toHaveBeenCalledWith({kind:'confirm',question:'Continue with the next 1? (1 of 2 done, 1 left)'}));
 const running=await screen.findByRole('dialog',{name:'Evaluating 2 skills'});
 await within(running).findByText('Evaluated 1 of 2; 0 failed. 1 queued for later.',{selector:'[role=status]'});
 expect(within(running).getByRole('log')).toHaveTextContent('Queued 1 eval for later.');
});

it('Overnight queues instead of running and says so',async()=>{
 const {spy}=open('#/library/global?dialog=bulk-eval&ref=deploy-check&ref=migration-guard');
 const q=await question();
 fireEvent.click(within(q).getByRole('radio',{name:'Overnight'}));
 expect(hint(q)).toHaveTextContent('npx -y terum-skills@latest eval deploy-check migration-guard --window overnight');
 fireEvent.click(within(q).getByRole('button',{name:'Queue for overnight'}));
 expect(spy).toHaveBeenCalledWith({refs:['deploy-check','migration-guard'],mode:'overnight'});
 const queued=await screen.findByRole('dialog',{name:'Queueing 2 skills'});
 await within(queued).findByText('Queued 2 evals for overnight.',{selector:'[role=status]'});
 expect(within(queued).getByRole('log')).toHaveTextContent('the app runs them in parallel between 01:00 and 05:00');
});

it('keeps streaming across navigation, names the run in the top bar, and refuses a second request while it runs',async()=>{
 const {spy}=open('#/library/global?dialog=bulk-eval&ref=deploy-check&ref=migration-guard');
 const run=createRun<EvalManyResult>(async ctx=>{ctx.print('Evaluating 2 skills, 2 at a time…');ctx.progress(1,2,'evaluated');await ctx.sleep(60_000);return {ok:true,value:{mode:'ran',team:null,skills:['deploy-check','migration-guard'],ok:2,failed:0,queued:[]}};});
 runs.push(run);spy.mockReturnValue(run);const cancel=vi.spyOn(run,'cancel');
 fireEvent.click(within(await question()).getByRole('button',{name:'Run evals'}));
 const running=await screen.findByRole('dialog',{name:'Evaluating 2 skills'});
 expect(await within(running).findByText('1 of 2 evaluated')).toBeVisible();
 fireEvent.keyDown(running,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(cancel).not.toHaveBeenCalled();
 await act(async()=>{location.hash='#/settings/evals?dialog=bulk-eval&ref=onboarding-tour';});
 const again=await question();
 fireEvent.click(within(again).getByRole('button',{name:'Run evals'}));
 expect(await within(again).findByRole('alert')).toHaveTextContent('An eval is already running for deploy-check');
 expect(spy).toHaveBeenCalledTimes(1);
 fireEvent.click(within(again).getByRole('button',{name:'Cancel'}));
 fireEvent.click(await screen.findByRole('button',{name:/^(Starting eval|Evaluating) · .*2 skills$|^Evaluating · \d+ of \d+$/}));
 const reopened=await screen.findByRole('dialog',{name:'Evaluating 2 skills'});
 fireEvent.click(within(reopened).getByRole('button',{name:'Stop'}));
 expect(await within(reopened).findByText('Stopped')).toBeVisible();expect(cancel).toHaveBeenCalledTimes(1);
});

it('Settings ▸ Evals asks the pending question and passes --pending',async()=>{
 const {spy}=open('#/settings/evals');
 fireEvent.click(await screen.findByRole('button',{name:'Evaluate pending…'}));
 expect(location.hash).toBe('#/settings/evals?dialog=bulk-eval&pending=1');
 const q=await question();
 expect(q).toHaveAccessibleName('Evaluate pending skills?');
 expect(within(q).getByText(/Every shared skill with no receipt for its current version — what setup offered\. Each eval uses/)).toBeVisible();
 expect(hint(q)).toHaveTextContent('npx -y terum-skills@latest eval --pending');
 fireEvent.click(within(q).getByRole('button',{name:'Run evals'}));
 expect(spy).toHaveBeenCalledWith({refs:[],mode:'now',pending:true});
 const running=await screen.findByRole('dialog',{name:'Evaluating pending skills'});
 expect(await within(running).findByRole('status')).toHaveTextContent(/Evaluated \d+ of \d+; 0 failed\./);
 expect(location.hash).toBe('#/settings/evals');
});

it('the pending row waits for a team',async()=>{
 open('#/settings/evals?__mock=no-team');
 const button=await screen.findByRole('button',{name:'Evaluate pending…'});
 expect(button).toBeDisabled();
 expect(screen.getByText('Needs a team: this evaluates every shared skill with no receipt for its current version.')).toBeVisible();
});

it('an empty request offers nothing but Close',async()=>{
 const {spy}=open('#/library/global?dialog=bulk-eval');
 const q=await screen.findByRole('dialog',{name:'Evaluate 0 skills?'});
 expect(within(q).getByText('Nothing to evaluate: choose skills in the Library first.')).toBeVisible();
 expect(within(q).getAllByRole('button').map(button=>button.textContent)).toEqual(['Close']);
 fireEvent.click(within(q).getByRole('button',{name:'Close'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(location.hash).toBe('#/library/global');expect(spy).not.toHaveBeenCalled();
});
