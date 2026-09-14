import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

// 960x600 is the smallest window the shell allows (src-tauri/tauri.conf.json minWidth/minHeight); 1440x900 is the
// board size. A card must hold its own content at both: before 2026-09-14 the Library grid sized every row from the
// card's `min-height` (148px), so a wrapped footer or a tall identity block painted below the card's bottom border —
// at 960 every card on this board overflowed by 26-74px, and at board width the stale-eval card overflowed by 22.
const WINDOWS=[{width:960,height:600},{width:1440,height:900}];

async function open(page:Page,route:string,size:{width:number;height:number}){
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 await prepare(page,{name:'Card fit',route,klass:'screen',...size});
 await page.waitForSelector('.skill-card');
 return errors;
}

/** Per card: how far its content spills past its own box. `scrollHeight` is the content, `clientHeight` the box; a
 *  card that cannot grow reports a positive difference, which is exactly the clipped chip a reader sees. */
async function overflow(page:Page){
 return page.$$eval('.skill-card',cards=>cards.map(card=>({
  id:(card as HTMLElement).dataset.testid??'',
  spill:card.scrollHeight-card.clientHeight,
 })).filter(row=>row.spill>0));
}

// `?__mock=overlays` puts the second Library card into §3.1 state 2 (edited, its only receipt older than the edit):
// the longest footer the Library can draw, and the state Ryan hit on his own machine.
for(const route of ['#/library/global','#/library/global?__mock=overlays'] as const){
 for(const size of WINDOWS){
  test(`no Library card spills out of its box on ${route} at ${size.width}x${size.height}`,async({page})=>{
   const errors=await open(page,route,size);
   expect(await overflow(page)).toEqual([]);
   expect(errors).toEqual([]);
  });
 }
}

// The same card component on the Marketplace, which reaches its grid through `.market-card-wrap` and so never had
// the fault — asserted so a later simplification of that wrapper cannot reintroduce it silently.
test('no Marketplace card spills out of its box at the smallest window',async({page})=>{
 const errors=await open(page,'#/marketplace',WINDOWS[0]!);
 expect(await overflow(page)).toEqual([]);
 expect(errors).toEqual([]);
});
