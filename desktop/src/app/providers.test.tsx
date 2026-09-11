import { it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Providers } from './providers';
import { usePrompter } from '../backend';
import type { Prompter } from '../backend/types';
afterEach(cleanup);
function PromptTrigger({ask,onResult}:{ask:(prompter:Prompter)=>Promise<string|boolean>;onResult:(value:string|boolean)=>void}){const prompter=usePrompter({});return <button onClick={()=>{void ask(prompter).then(onResult,error=>onResult(error instanceof Error?error.message:String(error)));}}>Ask</button>;}
it('opens a new dialog for an unexpected confirmation and resolves its answer',async()=>{const result=vi.fn();const user=userEvent.setup();render(<Providers><PromptTrigger ask={p=>p.confirm('Unplanned consent?')} onResult={result}/></Providers>);await user.click(screen.getByRole('button',{name:'Ask'}));expect(await screen.findByRole('dialog')).toHaveTextContent('Unplanned consent?');await user.click(screen.getByRole('button',{name:'Yes'}));await waitFor(()=>expect(result).toHaveBeenCalledWith(true));});
it('collects text with its default and returns the edited value',async()=>{const result=vi.fn();const user=userEvent.setup();render(<Providers><PromptTrigger ask={p=>p.text('Workspace name','Terum')} onResult={result}/></Providers>);await user.click(screen.getByRole('button',{name:'Ask'}));const input=await screen.findByRole('textbox');expect(input).toHaveValue('Terum');await user.clear(input);await user.type(input,'Docs');await user.click(screen.getByRole('button',{name:'Continue'}));await waitFor(()=>expect(result).toHaveBeenCalledWith('Docs'));});
it('handles selecting a choice and cancelling a text prompt',async()=>{const result=vi.fn();const user=userEvent.setup();const view=render(<Providers><PromptTrigger ask={p=>p.select('Role',['Admin','Member'])} onResult={result}/></Providers>);await user.click(screen.getByRole('button',{name:'Ask'}));await user.click(await screen.findByRole('radio',{name:'Member'}));await user.click(screen.getByRole('button',{name:'Continue'}));await waitFor(()=>expect(result).toHaveBeenCalledWith('Member'));view.rerender(<Providers><PromptTrigger ask={p=>p.text('Name')} onResult={result}/></Providers>);await user.click(screen.getByRole('button',{name:'Ask'}));await user.click(await screen.findByRole('button',{name:'Cancel'}));await waitFor(()=>expect(result).toHaveBeenCalledWith('Cancelled.'));});

it('shows each decision line as description and keeps confirms open on Escape and backdrop',async()=>{
 const result=vi.fn(),user=userEvent.setup(),detail=['Identity: @me — Me <me@x.test>','GitHub: octocat'];
 render(<Providers><PromptTrigger ask={p=>p.confirm('Use this identity?',{detail})} onResult={result}/></Providers>);
 await user.click(screen.getByRole('button',{name:'Ask'}));
 const dialog=await screen.findByRole('dialog'),description=dialog.querySelector('.dialog-description');
 expect(description).not.toBeNull();expect([...description!.children].map(child=>[child.tagName,child.textContent])).toEqual(detail.map(line=>['DIV',line]));
 expect(screen.getByRole('button',{name:'Yes'})).toBeInTheDocument();
 await user.keyboard('{Escape}');expect(result).not.toHaveBeenCalled();expect(dialog).toBeInTheDocument();
 const backdrop=document.querySelector('.dialog-backdrop');expect(backdrop).not.toBeNull();
 await user.click(backdrop!);expect(result).not.toHaveBeenCalled();expect(dialog).toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'No'}));await waitFor(()=>expect(result).toHaveBeenCalledExactlyOnceWith(false));
});

it('renders descriptions, preselects the default, and submits radio choices with Enter',async()=>{
 const result=vi.fn(),user=userEvent.setup();render(<Providers><PromptTrigger ask={p=>p.select('Evaluate them',['Now','Overnight'],{default:'Overnight',detail:['Estimated cost'],descriptions:['Run in this terminal.','Run while open and idle.']})} onResult={result}/></Providers>);
 await user.click(screen.getByRole('button',{name:'Ask'}));expect(await screen.findByRole('radio',{name:'Overnight'})).toBeChecked();
 expect(screen.getByRole('dialog')).toHaveTextContent('Estimated cost');expect(screen.getByText('Run while open and idle.')).toHaveClass('prompt-option-description');
 await user.click(screen.getByRole('radio',{name:'Now'}));await user.keyboard('{Enter}');await waitFor(()=>expect(result).toHaveBeenCalledWith('Now'));
});
