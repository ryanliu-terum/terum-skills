import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { PromptContext } from '../backend';
import { PromptCancelledError } from '../backend/types';
import { PromptProvider } from './providers';

// A question never outlives its run (2026-09-14 review): the run that asked passes its signal, and when that aborts
// the provider withdraws the dialog and rejects the asker with PromptCancelledError.
afterEach(cleanup);
const outcomes:(string|boolean|Error)[]=[];
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
