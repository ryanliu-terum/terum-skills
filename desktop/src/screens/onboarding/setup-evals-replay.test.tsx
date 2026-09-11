import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
afterEach(()=>{cleanup();localStorage.clear();location.hash='';vi.useRealTimers();vi.restoreAllMocks();});
async function reachEvals(){
 const backend=createMockBackend();vi.spyOn(backend,'launchContext').mockResolvedValue(null);vi.spyOn(backend,'refreshLaunch').mockResolvedValue(null);
 location.hash='#/onboarding/boot?start=1';render(<Providers><BackendContext value={backend}><App/></BackendContext></Providers>);
 let dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('radio',{name:'Create a new team'}));fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));
 dialog=await screen.findByRole('dialog',{name:/Connect a local skill folder/});fireEvent.click(within(dialog).getByRole('radio',{name:'Skip'}));fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));
 dialog=await screen.findByRole('dialog',{name:'Look for skill folders on this machine and add them to your library?'});fireEvent.click(within(dialog).getByRole('button',{name:'No'}));
 return screen.findByRole('dialog',{name:/Evaluate the 2 shared skills/});
}
it('replays an explicit overnight choice with estimate, four descriptions and a completed Queued row',async()=>{
 const dialog=await reachEvals();expect(within(dialog).getAllByRole('radio')).toHaveLength(4);expect(dialog).toHaveTextContent('no earlier runs to estimate from');
 expect(dialog.querySelectorAll('.prompt-option-description')).toHaveLength(4);expect(within(dialog).getByRole('radio',{name:'Skip'})).toBeChecked();fireEvent.click(within(dialog).getByRole('radio',{name:'Overnight'}));expect(within(dialog).getByRole('radio',{name:'Overnight'})).toBeChecked();
 fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));await screen.findByRole('heading',{name:'Setup finished'});
 const row=screen.getByText('Evaluating shared skills').parentElement;expect(row).toHaveAttribute('data-state','done');expect(row).toHaveTextContent('Queued');
});
it('replays Now with both progress frames and success and failure output',async()=>{
 const dialog=await reachEvals();vi.useFakeTimers();fireEvent.click(within(dialog).getByRole('radio',{name:'Now'}));fireEvent.click(within(dialog).getByRole('button',{name:'Continue'}));
 await act(async()=>{});const row=screen.getByText('Evaluating shared skills',{selector:'.onboarding-progress-row span'});expect(row.parentElement).toHaveTextContent('1 of 2');
 expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','1');expect(screen.getByText('✓ deploy-check')).toHaveClass('setup-output-ok');
 await act(()=>vi.advanceTimersByTimeAsync(150));expect(row.parentElement).toHaveTextContent('2 of 2');expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','2');
 expect(screen.getByText('✗ release-notes: Hygiene failed for release-notes')).toHaveClass('setup-output-bad');
 await act(()=>vi.advanceTimersByTimeAsync(150));expect(screen.getByRole('heading',{name:'Setup finished'})).toBeInTheDocument();expect(row.parentElement).toHaveTextContent('Done');expect(row.parentElement).not.toHaveTextContent('2 of 2');
});
