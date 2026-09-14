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
 // Cross-mirror overlays spec §5 M1.5 (ledger D5): the chip's words are gone from every card; a Library card carries
 // the version line instead and never the Marketplace's installed check.
 expect(within(card).queryByText('Installed · on this machine')).toBeNull();
 expect(within(card).queryByRole('img',{name:'Installed on this machine'})).toBeNull();
 expect(within(card).queryByRole('button',{name:'Install'})).toBeNull();expect(within(card).queryByRole('switch')).toBeNull();
 fireEvent.click(within(card).getByRole('button',{name:'More actions for deploy-check'}));
 expect(screen.queryByRole('menuitem',{name:'Remove'})).toBeNull();
});
