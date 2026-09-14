import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { Footer } from './Footer';
afterEach(cleanup);
// The footer carries no text: the gh login and the machine-name / clone-state line were removed
// (the latter clipped unreadably at the sidebar's width). Only the avatar and the Settings gear remain.
async function mount(){
 const backend=createMockBackend();const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 client.setQueryData(['capabilities'],await backend.capabilities());
 const status=await backend.status();if(!status.ok)throw new Error(status.error);
 return render(<QueryClientProvider client={client}><BackendContext value={backend}><Footer me={status.value.me}/></BackendContext></QueryClientProvider>);
}
it('shows the avatar and the Settings gear, and no text lines',async()=>{
 const {container,getByLabelText}=await mount();
 expect(container.querySelector('.footer-lines')).toBeNull();
 expect(container.querySelector('.footer-login')).toBeNull();
 expect(container.querySelector('.footer-machine')).toBeNull();
 expect(container.querySelector('.avatar')).not.toBeNull();
 expect(getByLabelText('Settings')).toHaveAttribute('href','#/settings/account');
 expect(container.querySelector('footer')?.textContent?.trim()).toBe(container.querySelector('.avatar')?.textContent?.trim());
});
it('links the avatar to your own profile',async()=>{
 const {getByLabelText}=await mount();
 expect(getByLabelText('Your profile')).toHaveAttribute('href',expect.stringContaining('#/marketplace/people/'));
});
