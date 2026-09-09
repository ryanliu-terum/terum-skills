import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { Providers } from '../../app/providers';
import { App } from '../../app/App';
import { useUiStore } from '../../app/store';
import { Shell } from './Shell';
import { ICON_PATHS } from '../ui/icon-paths';

beforeEach(()=>{useUiStore.setState({sidebarCollapsed:false,collapsedSections:[],overviewHidden:false});localStorage.clear();location.hash='#/library/global';});
afterEach(()=>{cleanup();vi.restoreAllMocks();location.hash='';useUiStore.setState({sidebarCollapsed:false,collapsedSections:[]});localStorage.clear();});
function openShell(){return render(<Providers><HashRouter><Shell/></HashRouter></Providers>);}
it('hides the sidebar, uses the inset, and reopens from the top bar',async()=>{
 openShell();const hide=screen.getByRole('button',{name:'Hide sidebar'});
 expect(hide).toHaveAttribute('aria-expanded','true');fireEvent.click(hide);
 expect(document.querySelector('.sidebar')).toBeNull();
 expect(screen.getByRole('main')).toHaveStyle({margin:'0 8px 8px 8px'});
 const show=screen.getByRole('button',{name:'Show sidebar'});
 expect(show).toHaveAttribute('aria-expanded','false');expect(show).toHaveStyle({width:'20px',height:'20px',color:'var(--tk-text4)'});
 expect(show.querySelector('svg')).toHaveAttribute('width','14');
 expect(show.previousElementSibling).toBe(screen.getByRole('button',{name:'Forward'}));
 expect(location.hash).toBe('#/library/global?sidebar=hidden');expect(useUiStore.getState().sidebarCollapsed).toBe(true);
 fireEvent.click(show);await screen.findByRole('navigation',{name:'Main navigation'});
 expect(location.hash).toBe('#/library/global');expect(useUiStore.getState().sidebarCollapsed).toBe(false);
 expect(screen.queryByRole('button',{name:'Show sidebar'})).toBeNull();
 expect(screen.getByRole('main').style.margin).toBe('');
});
it.each([
 ['projects','Projects',['Terum','SSM','MRF'],'#/marketplace/projects'],
 ['inbox','Inbox',['Pushes','Updates','Alerts'],'#/inbox'],
] as const)('collapses and restores %s without navigating, while its label stays a link',async(section,label,rows,href)=>{
 openShell();const collapse=await screen.findByRole('button',{name:'Collapse '+label});
 expect(collapse).toHaveAttribute('aria-expanded','true');expect(collapse.querySelector('svg')?.innerHTML).toBe(ICON_PATHS['chevron-down']);
 // Projects now renders before its roots resolve (it is there at zero checkouts), so the rows are awaited rather than read.
 for(const row of rows)expect(await screen.findByRole('link',{name:new RegExp('^'+row+' ')})).toBeVisible();
 fireEvent.click(collapse);const expand=screen.getByRole('button',{name:'Expand '+label});
 expect(location.hash).toBe('#/library/global?'+section+'=collapsed');
 expect(useUiStore.getState().collapsedSections).toEqual([section]);
 expect(expand).toHaveAttribute('aria-expanded','false');expect(expand.querySelector('svg')?.innerHTML).toBe(ICON_PATHS['chevron-right']);
 expect(expand).toHaveStyle({width:'12px',height:'12px'});
 for(const row of rows)expect(screen.queryByRole('link',{name:new RegExp('^'+row+' ')})).toBeNull();
 const link=expand.closest('a');expect(link).toHaveAttribute('href',href);
 fireEvent.click(expand);expect(useUiStore.getState().collapsedSections).toEqual([]);
 for(const row of rows)expect(screen.getByRole('link',{name:new RegExp('^'+row+' ')})).toBeVisible();
 fireEvent.click(link!.querySelector('span')!);await waitFor(()=>expect(location.hash).toBe(href));
});
it('does not save an unrelated URL-only collapsed section on control clicks',async()=>{
 location.hash='#/library/global?projects=collapsed';openShell();
 fireEvent.click(await screen.findByRole('button',{name:'Collapse Inbox'}));
 expect(useUiStore.getState().collapsedSections).toEqual(['inbox']);
 expect(screen.getByRole('button',{name:'Expand Projects'})).toBeVisible();
 expect(location.hash).toBe('#/library/global?projects=collapsed&inbox=collapsed');
});
it('renders persisted sidebar state on mount',()=>{
 useUiStore.getState().setSidebarCollapsed(true);openShell();
 expect(document.querySelector('.sidebar')).toBeNull();expect(screen.getByRole('button',{name:'Show sidebar'})).toBeVisible();
});
it('renders All clear with zero attention and retains the alerts link',async()=>{
 location.hash='#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fssm';render(<Providers><App/></Providers>);
 await screen.findByText('3 of 3');const attention=screen.getByText('Needs attention').closest('.stat-tile');
 expect(attention?.querySelector('.stat-value')).toHaveTextContent('0');
 expect(attention?.querySelector('.board-column')).toHaveTextContent('All clear');
 expect(attention?.querySelectorAll('.board-column > *')).toHaveLength(1);
 expect(screen.getByRole('link',{name:'Open alerts'})).toHaveAttribute('href','#/inbox?filter=alerts');
});
it('prints the mock eval k on Settings',async()=>{
 location.hash='#/settings/evals';render(<Providers><App/></Providers>);
 expect(await screen.findByText('k = 3 gates on the verdict band alone; k = 10 for a receipt whose sign test means something.')).toBeVisible();
});
