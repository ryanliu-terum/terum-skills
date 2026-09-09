import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { InboxScreen } from './InboxScreen';
afterEach(()=>{cleanup();localStorage.clear();location.hash='';vi.restoreAllMocks();});
it('keeps a disappeared selected item in its pane with one neutral return action',async()=>{
 const backend=createMockBackend(),client=new QueryClient({defaultOptions:{queries:{retry:false}}});location.hash='#/inbox';
 const result=await backend.inbox();if(!result.ok)throw new Error(result.error);
 render(<BackendContext value={backend}><QueryClientProvider client={client}><HashRouter><InboxScreen/></HashRouter></QueryClientProvider></BackendContext>);
 await screen.findByLabelText('Inbox report');
 vi.spyOn(backend,'inbox').mockResolvedValue({ok:true,value:[]});await client.invalidateQueries({queryKey:['inbox']});
 expect(await screen.findByText('This item is no longer in the list')).toBeInTheDocument();expect(screen.getByLabelText('Inbox report')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Back to the list'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Sync now'})).toBeNull();
});
it('a user selection records only seen state, not a repo action',async()=>{
 const backend=createMockBackend(),client=new QueryClient();location.hash='#/inbox';
 render(<BackendContext value={backend}><QueryClientProvider client={client}><HashRouter><InboxScreen/></HashRouter></QueryClientProvider></BackendContext>);
 const rows=await screen.findAllByTestId(/^inbox-row-/);fireEvent.click(rows[0]!);
 await waitFor(()=>expect(backend.prefs.get<string[]>('inbox:seen',[])).toHaveLength(1));
 expect([...Array(localStorage.length)].map((_,i)=>localStorage.key(i)).some(key=>key?.includes('acted'))).toBe(false);
});
