import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { PromptContext } from '../backend';
import { PromptCancelledError } from '../backend/types';
import type { PromptAnswer } from '../backend/types';
import { PromptProvider } from './providers';

// A question never outlives its run (2026-09-14 review): the run that asked passes its signal, and when that aborts
// the provider withdraws the dialog and rejects the asker with PromptCancelledError.
afterEach(cleanup);
const outcomes:(PromptAnswer|Error)[]=[];
function Asker({signal}:{signal:AbortSignal}){
 const ask=useContext(PromptContext);
 return <button onClick={()=>{ask({kind:'confirm',question:'Continue with the next 1?'},{signal}).then(value=>outcomes.push(value),(error:unknown)=>outcomes.push(error instanceof Error?error:new Error(String(error))));}}>Ask</button>;
}

it('withdraws the question and rejects the asker when the run\'s signal aborts',async()=>{
 outcomes.length=0;
 const controller=new AbortController();
 render(<PromptProvider><Asker signal={controller.signal}/></PromptProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Ask'}));
 expect(await screen.findByRole('dialog',{name:'Continue with the next 1?'})).toBeVisible();
 controller.abort();
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await waitFor(()=>expect(outcomes).toHaveLength(1));
 expect(outcomes[0]).toBeInstanceOf(PromptCancelledError);
});

it('a question from a run that has already settled never shows',async()=>{
 outcomes.length=0;
 const controller=new AbortController();controller.abort();
 render(<PromptProvider><Asker signal={controller.signal}/></PromptProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Ask'}));
 await waitFor(()=>expect(outcomes).toHaveLength(1));
 expect(outcomes[0]).toBeInstanceOf(PromptCancelledError);
 expect(screen.queryByRole('dialog')).toBeNull();
});

it('an answered question resolves and leaves the signal alone',async()=>{
 outcomes.length=0;
 const controller=new AbortController();
 render(<PromptProvider><Asker signal={controller.signal}/></PromptProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Ask'}));
 fireEvent.click(await screen.findByRole('button',{name:'Yes'}));
 await waitFor(()=>expect(outcomes).toEqual([true]));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 // Aborting after the answer changes nothing: the listener went with the answer.
 controller.abort();
 expect(outcomes).toEqual([true]);
});

// A `form` ask (protocol 2, 2026-09-19) is one dialog: prefilled fields, a followed field that tracks its source until
// typed in, read-only and disabled fields that cannot change, per-field errors, and Skip answering null.
function FormAsker({skippable=false}:{skippable?:boolean}){
 const ask=useContext(PromptContext);
 return <button onClick={()=>{ask({kind:'form',question:'Create your team',submit:'Create team',...(skippable?{skippable:true,skipLabel:'Skip for now'}:{}),errors:{handle:'a handle is letters, digits and hyphens'},fields:[
  {id:'team',kind:'text',label:'Team name',required:true},
  {id:'repo',kind:'text',label:'GitHub repository name',follows:{field:'team',template:'{value}-shared-skills'}},
  {id:'login',kind:'text',label:'GitHub login',default:'alice',readOnly:true},
  {id:'handle',kind:'text',label:'Handle',default:'al ice'},
  {id:'hook',kind:'checkbox',label:'Auto-syncs team skills',default:true},
  {id:'wrapper',kind:'checkbox',label:'The /terum-skills skill',default:true,disabled:true},
 ]}).then(value=>outcomes.push(value),(error:unknown)=>outcomes.push(error instanceof Error?error:new Error(String(error))));}}>Ask</button>;
}
it('draws a form as one dialog and answers with every field; the followed field tracks the team name until typed in',async()=>{
 outcomes.length=0;
 render(<PromptProvider><FormAsker/></PromptProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Ask'}));
 const dialog=await screen.findByRole('dialog',{name:'Create your team'});
 expect(dialog).toBeVisible();
 // Required and empty: the confirm waits.
 const submit=screen.getByRole('button',{name:'Create team'});
 expect(submit).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Team name'),{target:{value:'alpha'}});
 expect((screen.getByLabelText('GitHub repository name') as HTMLInputElement).value).toBe('alpha-shared-skills');
 fireEvent.change(screen.getByLabelText('GitHub repository name'),{target:{value:'alpha-repo'}});
 fireEvent.change(screen.getByLabelText('Team name'),{target:{value:'beta'}});
 expect((screen.getByLabelText('GitHub repository name') as HTMLInputElement).value).toBe('alpha-repo');
 expect((screen.getByLabelText('GitHub login') as HTMLInputElement).readOnly).toBe(true);
 expect(screen.getByRole('alert')).toHaveTextContent('a handle is letters, digits and hyphens');
 fireEvent.change(screen.getByLabelText('Handle'),{target:{value:'alice'}});
 fireEvent.click(screen.getByRole('checkbox',{name:'Auto-syncs team skills'}));
 // A disabled checkbox is inert: clicking it changes nothing, and the answer below still carries its default.
 fireEvent.click(screen.getByRole('checkbox',{name:'The /terum-skills skill'}));
 expect(submit).toBeEnabled();
 fireEvent.click(submit);
 await waitFor(()=>expect(outcomes).toEqual([{team:'beta',repo:'alpha-repo',login:'alice',handle:'alice',hook:false,wrapper:true}]));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it('Skip answers null on a skippable form and is not offered otherwise',async()=>{
 outcomes.length=0;
 const {unmount}=render(<PromptProvider><FormAsker skippable/></PromptProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Ask'}));
 await screen.findByRole('dialog',{name:'Create your team'});
 fireEvent.click(screen.getByRole('button',{name:'Skip for now'}));
 await waitFor(()=>expect(outcomes).toEqual([null]));
 unmount();
 render(<PromptProvider><FormAsker/></PromptProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Ask'}));
 await screen.findByRole('dialog',{name:'Create your team'});
 expect(screen.queryByRole('button',{name:'Skip for now'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Skip'})).toBeNull();
});
