import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Board } from './boards';
export async function prepare(page:Page,board:Board,locked=false):Promise<{hoverTargetMissing:boolean}>{
 await page.addInitScript(()=>{
  let seed=42;
  Math.random=()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const NativeDate=Date;const now=NativeDate.parse('2026-09-06T12:00:00Z');
  globalThis.Date=new Proxy(NativeDate,{construct(target,args){return Reflect.construct(target,args.length?args:[now]);},apply(){return new NativeDate(now).toString();},get(target,key,receiver){return key==='now'?()=>now:Reflect.get(target,key,receiver);}});
  const inject=()=>{const style=document.createElement('style');style.textContent='*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';document.documentElement.append(style);};
  if(document.documentElement)inject();else document.addEventListener('DOMContentLoaded',inject,{once:true});
 });
 await page.setViewportSize({width:board.width,height:board.height});
 await page.goto('/'+board.route);
 await page.waitForSelector('html[data-app-ready="true"]');
 await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.fonts.check('13px "Inter Variable"'))).toBe(true);
 expect(await page.evaluate(()=>document.fonts.check('12px "JetBrains Mono Variable"'))).toBe(true);
 let hoverTargetMissing=false;
 if(board.hover){const target=page.locator(board.hover);hoverTargetMissing=await target.count()===0;if(hoverTargetMissing){if(locked)throw new Error(`Locked board ${board.name} has no hover target ${board.hover}`);}else{await target.hover();await page.waitForTimeout(150);}}
 return {hoverTargetMissing};
}
