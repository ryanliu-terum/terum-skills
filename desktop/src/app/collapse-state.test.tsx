import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { useUiStore } from './store';
import { useUrlState } from './url-state';

beforeEach(()=>{useUiStore.setState({sidebarCollapsed:false,collapsedSections:[]});localStorage.clear();});
afterEach(()=>{cleanup();vi.restoreAllMocks();useUiStore.setState({sidebarCollapsed:false,collapsedSections:[]});localStorage.clear();});
it('persists and restores both collapse preferences with their setters',async()=>{
 useUiStore.getState().setSidebarCollapsed(true);
 useUiStore.getState().setCollapsedSections(['projects','inbox']);
 const saved=localStorage.getItem('terum-skills-app:ui');
 expect(JSON.parse(saved!).state).toMatchObject({sidebarCollapsed:true,collapsedSections:['projects','inbox']});
 useUiStore.setState({sidebarCollapsed:false,collapsedSections:[]});
 localStorage.setItem('terum-skills-app:ui',saved!);
 await useUiStore.persist.rehydrate();
 expect(useUiStore.getState()).toMatchObject({sidebarCollapsed:true,collapsedSections:['projects','inbox']});
 useUiStore.getState().setSidebarCollapsed(false);useUiStore.getState().setCollapsedSections([]);
 expect(JSON.parse(localStorage.getItem('terum-skills-app:ui')!).state).toMatchObject({sidebarCollapsed:false,collapsedSections:[]});
});
it.each([null,'projects',42,['projects',false]])('rejects invalid stored sections %j without losing actions',async collapsedSections=>{
 localStorage.setItem('terum-skills-app:ui',JSON.stringify({state:{sidebarCollapsed:'yes',collapsedSections,setSidebarCollapsed:1,setCollapsedSections:2},version:0}));
 await useUiStore.persist.rehydrate();
 expect(useUiStore.getState()).toMatchObject({sidebarCollapsed:false,collapsedSections:[]});
 expect(typeof useUiStore.getState().setSidebarCollapsed).toBe('function');
 expect(typeof useUiStore.getState().setCollapsedSections).toBe('function');
});
it('copies and deduplicates section preferences',()=>{
 const sections=['projects','projects'];useUiStore.getState().setCollapsedSections(sections);sections.push('inbox');
 expect(useUiStore.getState().collapsedSections).toEqual(['projects']);
});
it('keeps controls usable when preference storage is denied',()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Storage denied');});
 expect(()=>{useUiStore.getState().setSidebarCollapsed(true);useUiStore.getState().setCollapsedSections(['inbox']);}).not.toThrow();
 expect(useUiStore.getState()).toMatchObject({sidebarCollapsed:true,collapsedSections:['inbox']});
});
function Probe(){const state=useUrlState(),navigate=useNavigate();return <><output>{JSON.stringify({sidebarCollapsed:state.sidebarCollapsed,collapsedSections:state.collapsedSections})}</output><button onClick={()=>navigate('/library/global')}>Clear URL</button></>;}
it.each([
 ['sidebar=hidden',true,[]],['projects=collapsed',false,['projects']],['inbox=collapsed',false,['inbox']],
 ['sidebar=hidden&projects=collapsed&inbox=collapsed',true,['projects','inbox']],
 ['sidebar=invalid&projects=invalid&inbox=invalid',false,[]],
] as const)('applies %s only to the view and restores preferences without params', (query,sidebarCollapsed,collapsedSections)=>{
 const before=localStorage.getItem('terum-skills-app:ui');
 render(<MemoryRouter initialEntries={['/library/global?'+query]}><Probe/></MemoryRouter>);
 expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({sidebarCollapsed,collapsedSections});
 expect(useUiStore.getState()).toMatchObject({sidebarCollapsed:false,collapsedSections:[]});
 expect(localStorage.getItem('terum-skills-app:ui')).toBe(before);
 fireEvent.click(screen.getByRole('button',{name:'Clear URL'}));
 expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({sidebarCollapsed:false,collapsedSections:[]});
 expect(localStorage.getItem('terum-skills-app:ui')).toBe(before);
});
it('combines URL overrides with saved sections without persisting the override',()=>{
 useUiStore.setState({sidebarCollapsed:true,collapsedSections:['inbox']});
 const before=localStorage.getItem('terum-skills-app:ui');
 render(<MemoryRouter initialEntries={['/library/global?projects=collapsed']}><Probe/></MemoryRouter>);
 expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({sidebarCollapsed:true,collapsedSections:['inbox','projects']});
 fireEvent.click(screen.getByRole('button',{name:'Clear URL'}));
 expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({sidebarCollapsed:true,collapsedSections:['inbox']});
 expect(localStorage.getItem('terum-skills-app:ui')).toBe(before);
});
