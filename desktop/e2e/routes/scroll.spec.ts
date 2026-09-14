import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

// 960x600 is the smallest window the shell allows (src-tauri/tauri.conf.json minWidth/minHeight), which is
// where the column fallback and the floor under every tab box have to hold.
const SMALLEST={width:960,height:600};

async function openPane(page:Page,route:string,size:{width:number;height:number}={width:1440,height:900}){
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,{name:'Scroll panes',route,klass:'screen',...size});
 return errors;
}

/** The short-window fallback: scroll the column to its end so the tab box is fully in the window. */
async function scrollColumnToEnd(page:Page){
 const main=page.locator('.detail-main');
 await main.evaluate(element=>{element.scrollTop=element.scrollHeight;});
 await expect.poll(()=>main.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(1);
}

async function boxOf(locator:Locator){
 const box=await locator.boundingBox();
 if(!box)throw new Error('Scroll assertion target has no bounding box.');
 return box;
}

async function wheelPane(page:Page,pane:Locator,toEnd=false){
 const box=await boxOf(pane);
 // Pointer input must scroll the owning pane, not programmatically scroll a hidden child.
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.wheel(0,2000);
 await expect.poll(()=>pane.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
 if(!toEnd)return;
 // The eval report is ~1450px of content in a ~480px pane, so reaching its last line takes more than one wheel.
 for(let i=0;i<8;i++){
  if(await pane.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop<=1))break;
  await page.mouse.wheel(0,2000);
 }
 await expect.poll(()=>pane.evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop)).toBeLessThanOrEqual(1);
}

// The pane scrolls; the panel's clipped bottom edge never touches the last line (spec A, 2026-09-13: 28px).
const CLEARANCE=8;
async function clearanceUnder(pane:Locator,last:Locator){
 const paneBox=await boxOf(pane),lastBox=await boxOf(last);
 return paneBox.y+paneBox.height-(lastBox.y+lastBox.height);
}

async function columnIsPinned(page:Page){
 const main=page.locator('.detail-main');
 // The detail column keeps overflow:auto as the fallback for a window shorter than its pinned parts, but at
 // 1440x900 the constrained tab bodies leave it nothing to scroll.
 await expect(main).toHaveCSS('overflow-y','auto');
 await expect(main).toHaveCSS('scrollbar-width','none');
 expect(await main.evaluate(element=>element.scrollTop)).toBe(0);
 expect(await main.evaluate(element=>element.scrollHeight)).toBe(await main.evaluate(element=>element.clientHeight));
}

for(const {scope,route,count} of [
 {scope:'Global',route:'#/library/global',count:15},
 {scope:'Terum',route:'#/library/checkout?root=%2FUsers%2Fyou%2Fcode%2Fterum',count:8},
]){
 test(`Library ${scope} exposes its last card and keeps the header pinned`,async({page})=>{
  const errors=await openPane(page,route);
  const grid=page.locator('.library-grid');
  const cards=grid.locator('.skill-card');
  await expect(cards).toHaveCount(count);
  await expect(grid).toHaveCSS('overflow-y','auto');
  await expect(grid).toHaveCSS('scrollbar-width','none');
  expect(await grid.evaluate(element=>element.scrollTop)).toBe(0);
  const header=page.locator('.board-view-header');
  const title=header.getByText(scope,{exact:true});
  // The Connect CTA left this header on 2026-09-10 (spec 2026-09-10-library-mirror-id-sync); the
  // overview toggle is the remaining pinned header control.
  const overview=header.getByRole('button',{name:/overview/});
  const titleBefore=await boxOf(title),overviewBefore=await boxOf(overview);
  const last=cards.last();
  const fits=await grid.evaluate(element=>element.scrollHeight===element.clientHeight);
  if(scope==='Terum'&&fits){
   // A project that fits needs no synthetic overflow or wheel event.
   expect(await grid.evaluate(element=>element.scrollHeight)).toBe(await grid.evaluate(element=>element.clientHeight));
   expect(await grid.evaluate(element=>element.scrollTop)).toBe(0);
  }else{
   await expect(last).not.toBeInViewport({ratio:1});
   await wheelPane(page,grid);
  }
  await expect(last).toBeInViewport({ratio:1});
  expect((await boxOf(title)).y).toBe(titleBefore.y);
  expect((await boxOf(overview)).y).toBe(overviewBefore.y);
  expect(errors).toEqual([]);
 });
}

test('SKILL.md scrolls its own blocks while the meta row and the details rail stay pinned',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check');
 const rail=page.locator('.detail-rail'),tab=page.locator('.skill-md-tab');
 const blocks=page.locator('.skill-md-blocks'),meta=page.locator('.skill-md-meta');
 const last=page.locator('.skill-md-blocks > :last-child');
 await expect(blocks).toHaveCSS('overflow-y','auto');
 await expect(blocks).toHaveCSS('scrollbar-width','none');
 // The tab is the height-constraining box: it clips, so the meta row above the blocks cannot be scrolled away.
 await expect(tab).toHaveCSS('overflow-y','hidden');
 expect(await blocks.evaluate(element=>element.scrollTop)).toBe(0);
 await expect(rail).toBeVisible();
 const metaBefore=await boxOf(meta),railBefore=await boxOf(rail);
 await expect(last).not.toBeInViewport({ratio:1});
 await wheelPane(page,blocks,true);
 await expect(last).toBeInViewport({ratio:1});
 expect(await clearanceUnder(blocks,last)).toBeGreaterThanOrEqual(CLEARANCE);
 expect(await boxOf(meta)).toEqual(metaBefore);
 expect(await boxOf(rail)).toEqual(railBefore);
 await columnIsPinned(page);
 expect(errors).toEqual([]);
});

test('Evals scrolls the report to its last line with the receipt head, History and the rail pinned',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals');
 const rail=page.locator('.detail-rail');
 const head=page.locator('.evals-tab > .tab-head');
 const report=page.locator('.evals-main'),history=page.locator('.history-rail');
 const coverage=page.locator('.report-heading').filter({hasText:'Coverage and provenance'});
 const last=page.locator('.evaluation-report > :last-child');
 await expect(head).toContainText('Latest receipt');
 await expect(head).toBeInViewport({ratio:1});
 await expect(last).not.toBeInViewport({ratio:1});
 await expect(report).toHaveCSS('overflow-y','auto');
 await expect(report).toHaveCSS('scrollbar-width','none');
 // Both boxes above the report clip, which is what keeps the head row and the score row in place.
 await expect(page.locator('.evals-tab')).toHaveCSS('overflow-y','hidden');
 await expect(page.locator('.evals-body')).toHaveCSS('overflow-y','hidden');
 // History is pinned beside the report and owns its own scrollbar-free scroller.
 await expect(history).toHaveCSS('overflow-y','auto');
 await expect(history).toHaveCSS('scrollbar-width','none');
 expect(await report.evaluate(element=>element.scrollTop)).toBe(0);
 const headBefore=await boxOf(head),historyBefore=await boxOf(history),railBefore=await boxOf(rail);
 await wheelPane(page,report,true);
 await expect(coverage).toBeInViewport({ratio:1});
 await expect(last).toBeInViewport({ratio:1});
 expect(await clearanceUnder(report,last)).toBeGreaterThanOrEqual(CLEARANCE);
 await expect(head).toBeInViewport({ratio:1});
 expect((await boxOf(head)).y).toBe(headBefore.y);
 expect(await boxOf(history)).toEqual(historyBefore);
 expect(await boxOf(rail)).toEqual(railBefore);
 await columnIsPinned(page);
 expect(errors).toEqual([]);
});

for(const tab of ['quality','activity']){
 test(`${tab} scrolls inside its own tab, never the column`,async({page})=>{
  const errors=await openPane(page,'#/skill/deploy-check?tab='+tab);
  const rail=page.locator('.detail-rail'),pane=page.locator('.'+tab+'-tab');
  const last=page.locator(tab==='quality'?'.quality-tab > :last-child':'.activity-row:last-child');
  const railBefore=await boxOf(rail);
  await expect(pane).toHaveCSS('overflow-y','auto');
  await expect(pane).toHaveCSS('scrollbar-width','none');
  const fits=await pane.evaluate(element=>element.scrollHeight===element.clientHeight);
  if(fits){
   expect(await pane.evaluate(element=>element.scrollTop)).toBe(0);
  }else{
   await wheelPane(page,pane,true);
   expect(await clearanceUnder(pane,last)).toBeGreaterThanOrEqual(CLEARANCE);
  }
  // This also catches hidden descendants clipping a tab whose outer column claims to fit.
  await expect(last).toBeInViewport({ratio:1});
  expect(await boxOf(rail)).toEqual(railBefore);
  await columnIsPinned(page);
  expect(errors).toEqual([]);
 });
}

test('an invalid newest receipt keeps its state and History inside the tab',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals&__mock=invalid-newest');
 const body=page.locator('.evals-body'),history=page.locator('.history-rail');
 // No receipt renders, so there is no `.evals-main` inside: the body itself is this state's scroller.
 await expect(page.locator('.evals-main')).toHaveCount(0);
 await expect(body).toHaveCSS('overflow-y','auto');
 await expect(body).toHaveCSS('scrollbar-width','none');
 await expect(page.locator('.state-title')).toHaveText('The newest receipt for this version is invalid');
 await expect(page.locator('.centered-state')).toBeInViewport({ratio:1});
 // At this size it still fits, and the auto-margin centring must leave it centred exactly as before.
 expect(await body.evaluate(element=>element.scrollHeight)).toBe(await body.evaluate(element=>element.clientHeight));
 await expect(history).toHaveCSS('overflow-y','auto');
 expect(await history.evaluate(element=>element.scrollTop)).toBe(0);
 await columnIsPinned(page);
 expect(errors).toEqual([]);
});

test('an invalid newest receipt keeps its whole state reachable in the smallest window',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals&__mock=invalid-newest',SMALLEST);
 const body=page.locator('.evals-body');
 const first=page.locator('.centered-state > :first-child'),action=page.locator('.centered-state button').first();
 // The body is this state's tab box, so it carries the floor; without it the state was clipped top AND
 // bottom with no scroll container anywhere in the subtree.
 const bodyBox=await boxOf(body);
 expect(bodyBox.height).toBeGreaterThanOrEqual(240);
 await scrollColumnToEnd(page);
 // Centred content that outgrows its box overflows both ways and the leading half is unreachable; the
 // auto-margin centring start-aligns instead, so the icon is never above the pane's top edge.
 expect((await boxOf(first)).y).toBeGreaterThanOrEqual((await boxOf(body)).y);
 // The floor is tall enough for this state's stack on the mock; a longer CLI message on the real adapter
 // overflows it, and then the pane — not the panel — is what scrolls.
 if(await body.evaluate(element=>element.scrollHeight>element.clientHeight))await wheelPane(page,body,true);
 const pane=await boxOf(body),button=await boxOf(action);
 expect(button.y).toBeGreaterThanOrEqual(pane.y);
 expect(button.y+button.height).toBeLessThanOrEqual(pane.y+pane.height);
 await expect(action).toBeInViewport({ratio:1});
 expect(errors).toEqual([]);
});

test('the smallest window scrolls the column instead of collapsing the report',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals',SMALLEST);
 const main=page.locator('.detail-main'),tab=page.locator('.evals-tab'),report=page.locator('.evals-main');
 const last=page.locator('.evaluation-report > :last-child');
 // Every other child of `.detail-main` is flex-shrink:0, so without a floor the tab box absorbs the whole
 // deficit: the report pane was left 39px tall while the column reported nothing to scroll.
 expect((await boxOf(tab)).height).toBeGreaterThanOrEqual(240);
 expect(await main.evaluate(element=>element.scrollHeight)).toBeGreaterThan(await main.evaluate(element=>element.clientHeight));
 await scrollColumnToEnd(page);
 await wheelPane(page,report,true);
 await expect(last).toBeInViewport({ratio:1});
 expect(await clearanceUnder(report,last)).toBeGreaterThanOrEqual(CLEARANCE);
 expect(errors).toEqual([]);
});

test('the History rail keeps its last line off the clipped edge once it is squeezed',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals',{width:1440,height:600});
 const history=page.locator('.history-rail'),last=page.locator('.history-rail > :last-child');
 await expect(history).toHaveCSS('padding-bottom','28px');
 expect(await history.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
 await scrollColumnToEnd(page);
 await wheelPane(page,history,true);
 // The rail is a scroller like the tab bodies, so its last line may not sit on the panel's clipped edge.
 expect(await clearanceUnder(history,last)).toBeGreaterThanOrEqual(CLEARANCE);
 await expect(last).toBeInViewport({ratio:1});
 expect(errors).toEqual([]);
});

test('a skill with no receipt shows its empty state with nothing to scroll',async({page})=>{
 const errors=await openPane(page,'#/skill/onboarding-tour?tab=evals');
 await expect(page.locator('.evals-tab')).toHaveCount(0);
 await expect(page.locator('.evaluation-report')).toHaveCount(0);
 await expect(page.locator('.state-title')).toHaveText('Not evaluated');
 await expect(page.locator('.centered-state')).toBeInViewport({ratio:1});
 await columnIsPinned(page);
 expect(errors).toEqual([]);
});

test('a failed skill read renders the CLI message with no pane to scroll',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?__mock=error');
 // The error state replaces the column entirely, so no tab-body scroller exists to hide the message.
 await expect(page.locator('.detail-main')).toHaveCount(0);
 await expect(page.locator('.state-title')).toHaveText("Couldn't read deploy-check");
 await expect(page.locator('.board-error-line')).toBeInViewport({ratio:1});
 await expect(page.locator('.centered-state')).toBeInViewport({ratio:1});
 expect(errors).toEqual([]);
});

test('cancelling a run-eval leaves the report pane scrollable to its last line',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals&dialog=run-eval');
 const report=page.locator('.evals-main'),last=page.locator('.evaluation-report > :last-child');
 await expect(page.locator('.dialog-popup')).toHaveCount(1);
 await page.locator('.dialog-popup').getByRole('button',{name:'Cancel'}).click();
 await expect(page.locator('.dialog-popup')).toHaveCount(0);
 await expect(report).toHaveCSS('overflow-y','auto');
 await wheelPane(page,report,true);
 await expect(last).toBeInViewport({ratio:1});
 expect(await clearanceUnder(report,last)).toBeGreaterThanOrEqual(CLEARANCE);
 await columnIsPinned(page);
 expect(errors).toEqual([]);
});

test('full Evals retains visible overflow and the complete report height',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals&rail=closed&full=1');
 const main=page.locator('.detail-body.full .detail-main');
 await expect(page.locator('.detail-rail')).toHaveCount(0);
 await expect(main).toHaveCSS('overflow-y','visible');
 await expect(page.locator('.evals-tab')).toHaveCSS('overflow-y','visible');
 await expect(page.locator('.evals-body')).toHaveCSS('overflow-y','visible');
 // The panes that scroll in the windowed modes render in one piece here, with no bottom padding of their own.
 await expect(page.locator('.evals-main')).toHaveCSS('overflow-y','visible');
 await expect(page.locator('.evals-main')).toHaveCSS('padding-bottom','0px');
 await expect(page.locator('.history-rail')).toHaveCSS('overflow-y','visible');
 const last=page.locator('.evaluation-report > :last-child');
 await expect(last).toContainText('agent CLI');
 const mainBox=await boxOf(main),lastBox=await boxOf(last);
 // The full fixture exposes document overflow inside the existing fixed-height shell.
 const contentHeight=await main.evaluate(element=>element.scrollHeight);
 expect(contentHeight).toBeGreaterThan(900);
 expect(lastBox.y+lastBox.height).toBeGreaterThan(900);
 expect(contentHeight).toBeGreaterThanOrEqual(Math.floor(lastBox.y+lastBox.height-mainBox.y));
 expect(errors).toEqual([]);
});
