import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkflowDialog } from './WorkflowControls';
afterEach(cleanup);
it('replaces busy Cancel with Stop and streams lines and status',()=>{
 const stop=vi.fn();render(<WorkflowDialog title="Eval" body="Body" command="eval" primary="Run" busy onStop={stop} close={()=>{}} submit={()=>{}} lines={['one','two']} status="Running…"/>);
 fireEvent.click(screen.getByRole('button',{name:'Stop'}));expect(stop).toHaveBeenCalledOnce();expect(screen.queryByRole('button',{name:'Cancel'})).toBeNull();expect(screen.getByRole('log')).toHaveTextContent('one two');expect(screen.getByRole('status')).toHaveTextContent('Running…');
});
it.each([true,false])('busy Escape dismissal respects dismissKeepsRunning=%s',async keeps=>{
 const close=vi.fn();render(<WorkflowDialog title="Eval" body="Body" command="eval" primary="Run" busy dismissKeepsRunning={keeps} close={close} submit={()=>{}}/>);
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 if(keeps)await waitFor(()=>expect(close).toHaveBeenCalledOnce());else expect(close).not.toHaveBeenCalled();
});
it('renders only Close when primary is null',()=>{
 render(<WorkflowDialog title="Eval" body="Body" command="eval" primary={null} closeLabel="Close" close={()=>{}} submit={()=>{}}/>);
 expect(screen.getAllByRole('button')).toHaveLength(1);expect(screen.getByRole('button',{name:'Close'})).toBeVisible();
});
