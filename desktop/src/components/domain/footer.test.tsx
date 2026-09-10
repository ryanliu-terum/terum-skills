import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { design } from '../../backend/mock/data';
import { Footer } from './Footer';
afterEach(cleanup);
// The machine name is the footer's second line whatever the machine registry does; that flag gates
// the "Other machines" row in Settings, not the name of the machine you are on.
async function mount(machineRegistry:boolean){
 const backend=createMockBackend();const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 client.setQueryData(['capabilities'],{...await backend.capabilities(),machineRegistry});
 const status=await backend.status();if(!status.ok)throw new Error(status.error);
 return render(<QueryClientProvider client={client}><BackendContext value={backend}><Footer machine={status.value.machine} me={status.value.me}/></BackendContext></QueryClientProvider>);
}
it.each([true,false])('names this machine in the footer with machineRegistry %s',async machineRegistry=>{
 const {container}=await mount(machineRegistry);
 expect(container.querySelector('.footer-machine')).toHaveTextContent(design.MACHINE.name);
 expect(container.querySelector('.footer-login')).toHaveTextContent(design.MACHINE.gh_login);
});
