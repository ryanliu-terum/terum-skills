import { afterEach,expect,it } from 'vitest';
import { cleanup,render,screen,waitFor } from '@testing-library/react';
import { BOARDS } from '../../../e2e/fidelity/boards';
import { App } from '../../app/App';
import { Providers } from '../../app/providers';
import { useUiStore } from '../../app/store';

afterEach(()=>{cleanup();location.hash='';localStorage.clear();});
it.each(BOARDS.filter(board=>board.route.startsWith('#/skill/')))('keeps the locked status and subtitle for $name',async({route})=>{
  useUiStore.setState({railOpen:true,overviewHidden:false,theme:'dark'});
  location.hash=route;
  render(<Providers><App/></Providers>);
  if(route.includes('__mock=loading')){
    await waitFor(()=>expect(document.documentElement.dataset.appReady).toBe('true'));
    expect(document.querySelector('.detail-status')?.textContent).toBe('');
    expect(document.querySelector('.detail-title h1')).toBeNull();
    return;
  }
  if(route.includes('__mock=error')){
    expect(await screen.findByText("Couldn't read deploy-check")).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Sync now'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Remove from Global'})).toBeInTheDocument();
    return;
  }
  await waitFor(()=>expect(document.querySelector('.detail-title h1')).not.toBeNull());
  if(route.includes('rail=closed')){
    expect(document.querySelector('.detail-status')).toBeNull();
    return;
  }
  const uninstalled=route.includes('__mock=not-installed'),disabled=route.includes('__mock=disabled');
  const status=document.querySelector('.detail-status>div');
  expect(status?.children[1]?.textContent).toBe(uninstalled?'Not installed':disabled?'Disabled':'Enabled');
  expect(status?.children[2]?.textContent).toBe(uninstalled?'Install to load it in sessions':disabled?'On disk, not loaded':'Loaded in every session');
  expect(document.querySelector('.detail-repo>span')?.textContent).toBe('skills/'+document.querySelector('.detail-title h1')?.textContent);
});
