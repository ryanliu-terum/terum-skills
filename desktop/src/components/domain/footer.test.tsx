import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import type { StatusResult } from '../../backend/types';
import { Footer } from './Footer';
afterEach(cleanup);
// The footer carries one text line: your name (footerLabel — gh login, else the team handle, else the
// default handle), which the design canvas draws on 79 of 99 boards. The second line stays out: the
// machine name that belongs there is never reported by the adapter, and the clone-state sentence that
// used to win that slot clipped unreadably at the sidebar's width and now lives only in Settings ▸ Teams.
async function mount(me?:StatusResult['me']){
 const backend=createMockBackend();const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 client.setQueryData(['capabilities'],await backend.capabilities());
 const status=await backend.status();if(!status.ok)throw new Error(status.error);
 return render(<QueryClientProvider client={client}><BackendContext value={backend}><Footer me={me??status.value.me}/></BackendContext></QueryClientProvider>);
}
it('shows the avatar, your name, and the Settings gear',async()=>{
 const {container,getByLabelText}=await mount();
 expect(container.querySelector('.footer-login')?.textContent).toBe('teniroo');
 expect(container.querySelector('.avatar')?.textContent).toBe('TZ');
 expect(getByLabelText('Settings')).toHaveAttribute('href','#/settings/account');
});
it('draws no second line: no machine name and no clone-state sentence',async()=>{
 const {container}=await mount();
 expect(container.querySelector('.footer-machine')).toBeNull();
 expect(container.querySelectorAll('.footer-lines>span')).toHaveLength(1);
 expect(container.querySelector('footer')?.textContent).not.toContain('teddy-mbp');
 expect(container.querySelector('footer')?.textContent).not.toContain('Clone:');
 expect(container.querySelector('footer')?.textContent).not.toContain('local clone');
});
// A real install with no gh login, no team handle and no default handle reports footerLabel:''; the
// line matches the avatar's own fallback rather than collapsing the footer to a bare circle.
it('falls back to an em dash when the adapter reports no label',async()=>{
 const backend=createMockBackend();const status=await backend.status();if(!status.ok)throw new Error(status.error);
 const {container}=await mount({...status.value.me,footerLabel:'',initials:''});
 expect(container.querySelector('.footer-login')?.textContent).toBe('—');
 expect(container.querySelector('.avatar')?.textContent).toBe('—');
});
it('links the avatar and the name to your own profile',async()=>{
 const {getByLabelText}=await mount();
 const link=getByLabelText('Your profile');
 expect(link).toHaveAttribute('href',expect.stringContaining('#/marketplace/people/'));
 expect(link.querySelector('.footer-login')).not.toBeNull();
});
