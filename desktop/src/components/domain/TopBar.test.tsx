import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BackendContext } from '../../backend';
import { createMockBackend } from '../../backend/mock';
import { TopBar } from './TopBar';
import type { Capabilities } from '../../backend/types';
afterEach(cleanup);
it.each([['cosmetic',76],['mac-overlay',76],['native',16]] as const)('%s keeps the mark slot at x=%i', (mode:Capabilities['windowChrome'],expected)=>{
 const css=readFileSync('src/styles/app.css','utf8');
 const rule=css.match(/\.topbar-left \{[^}]+\}/)?.[0];expect(rule).toBeDefined();
 const {container}=render(<><style>{rule}</style><TopBar mode={mode}/></>);
 const left=container.querySelector<HTMLElement>('.topbar-left')!,mark=left.querySelector('.mark-slot')!;
 const style=getComputedStyle(left),before=Array.from(left.children).slice(0,Array.from(left.children).indexOf(mark));
 const widths=before.map(el=>{const element=el as HTMLElement;if(element.style.width)return parseFloat(element.style.width);const children=Array.from(element.children) as HTMLElement[];return children.reduce((sum,child)=>sum+parseFloat(child.style.width),0)+(children.length-1)*parseFloat(element.style.gap);});
 // jsdom has no layout engine: assert the CSS box-model inputs and their resulting x-coordinate.
 expect(parseFloat(style.paddingLeft)+widths.reduce((a,b)=>a+b,0)+before.length*parseFloat(style.gap)).toBe(expected);
 expect(container.querySelector('.window-controls')).toBeNull();
 expect(before).toHaveLength(mode==='native'?0:1);
});
it('routes drag and double click through the seam only on empty native regions',()=>{
 const backend=createMockBackend(),action=vi.spyOn(backend,'windowAction');const {container,rerender}=render(<BackendContext value={backend}><TopBar mode="mac-overlay"/></BackendContext>);
 const empty=container.querySelector('.topbar-right')!;
 expect(empty).toHaveAttribute('data-tauri-drag-region');fireEvent.mouseDown(empty,{button:0,detail:1});fireEvent.doubleClick(empty);
 expect(action.mock.calls).toEqual([['start-drag'],['toggle-maximize']]);
 fireEvent.doubleClick(screen.getByRole('button',{name:'Back'}));expect(action).toHaveBeenCalledTimes(2);
 rerender(<BackendContext value={backend}><TopBar mode="cosmetic"/></BackendContext>);fireEvent.doubleClick(container.querySelector('.topbar-right')!);expect(action).toHaveBeenCalledTimes(2);
});
it('keeps OS decorations and the locked minimum dimensions, with macOS overlay settings',()=>{
 const config=JSON.parse(readFileSync('src-tauri/tauri.conf.json','utf8'));
 expect(config.app.windows[0]).toMatchObject({decorations:true,minWidth:960,minHeight:600,titleBarStyle:'Overlay',hiddenTitle:true,trafficLightPosition:{x:16,y:14}});
 const permissions=JSON.parse(readFileSync('src-tauri/capabilities/default.json','utf8')).permissions;
 expect(permissions).toContain('core:window:allow-toggle-maximize');expect(permissions).toContain('core:window:allow-internal-toggle-maximize');
 expect(permissions).not.toContain('opener:default');expect(permissions).toContainEqual({identifier:'opener:allow-open-url',allow:[{url:'https://github.com/*'}]});
});
