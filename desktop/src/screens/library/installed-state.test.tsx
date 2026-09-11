import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';
beforeEach(()=>{localStorage.clear();useUiStore.setState({railOpen:true,overviewHidden:false,theme:'dark'});});
afterEach(()=>{cleanup();location.hash='';vi.restoreAllMocks();});
it('shows on-disk presence on cards without Install, Remove or a switch',async()=>{
 location.hash='#/library/global?__mock=on-disk-only';render(<Providers><App/></Providers>);
 const card=await screen.findByTestId('skill-card-deploy-check');
 expect(within(card).getByText('Installed · on this machine')).toBeInTheDocument();
 expect(within(card).queryByRole('button',{name:'Install'})).toBeNull();expect(within(card).queryByRole('switch')).toBeNull();
 fireEvent.click(within(card).getByRole('button',{name:'More actions for deploy-check'}));
 expect(screen.queryByRole('menuitem',{name:'Remove'})).toBeNull();
});
