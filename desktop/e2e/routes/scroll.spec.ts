import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

async function openPane(page:Page,route:string){
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,{name:'Scroll panes',route,klass:'screen',width:1440,height:900});
 return errors;
}

async function boxOf(locator:Locator){
 const box=await locator.boundingBox();
 if(!box)throw new Error('Scroll assertion target has no bounding box.');
 return box;
}

async function wheelPane(page:Page,pane:Locator){
 const box=await boxOf(pane);
 // Pointer input must scroll the owning pane, not programmatically scroll a hidden child.
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.wheel(0,2000);
 await expect.poll(()=>pane.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);
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
  const connect=header.getByRole('button',{name:'Connect',exact:true});
  const titleBefore=await boxOf(title),connectBefore=await boxOf(connect);
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
  expect((await boxOf(connect)).y).toBe(connectBefore.y);
  expect(errors).toEqual([]);
 });
}

test('SKILL.md scrolls to its last block while the details rail stays pinned',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check');
 const main=page.locator('.detail-main'),rail=page.locator('.detail-rail');
 const last=page.locator('.skill-md-blocks > :last-child');
 await expect(main).toHaveCSS('overflow-y','auto');
 await expect(main).toHaveCSS('scrollbar-width','none');
 expect(await main.evaluate(element=>element.scrollTop)).toBe(0);
 await expect(rail).toBeVisible();
 const railBefore=await boxOf(rail);
 await expect(last).not.toBeInViewport({ratio:1});
 await wheelPane(page,main);
 await expect(last).toBeInViewport({ratio:1});
 expect(await boxOf(rail)).toEqual(railBefore);
 expect(errors).toEqual([]);
});

test('Evals scrolls through provenance with its receipt head and History',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals');
 const main=page.locator('.detail-main'),rail=page.locator('.detail-rail');
 const head=page.locator('.evals-tab > .tab-head');
 const history=page.locator('.history-rail');
 const coverage=page.locator('.report-heading').filter({hasText:'Coverage and provenance'});
 const last=page.locator('.evaluation-report > :last-child');
 await expect(head).toContainText('Latest receipt');
 await expect(head).toBeInViewport({ratio:1});
 await expect(last).not.toBeInViewport({ratio:1});
 await expect(main).toHaveCSS('overflow-y','auto');
 await expect(main).toHaveCSS('scrollbar-width','none');
 expect(await main.evaluate(element=>element.scrollTop)).toBe(0);
 const railBefore=await boxOf(rail),historyBefore=await boxOf(history);
 await wheelPane(page,main);
 await expect(coverage).toBeInViewport({ratio:1});
 await expect(last).toBeInViewport({ratio:1});
 await expect(head).not.toBeInViewport();
 expect(await boxOf(rail)).toEqual(railBefore);
 const historyAfter=await boxOf(history);
 expect(historyAfter.width).toBe(historyBefore.width);
 expect(historyAfter.x).toBe(historyBefore.x);
 expect(historyAfter.y).toBeLessThan(historyBefore.y);
 expect(errors).toEqual([]);
});

for(const tab of ['quality','activity']){
 test(`${tab} keeps its final content reachable in the main column`,async({page})=>{
  const errors=await openPane(page,'#/skill/deploy-check?tab='+tab);
  const main=page.locator('.detail-main'),rail=page.locator('.detail-rail');
  const last=page.locator(tab==='quality'?'.quality-tab > :last-child':'.activity-row:last-child');
  const railBefore=await boxOf(rail);
  await expect(main).toHaveCSS('overflow-y','auto');
  await expect(main).toHaveCSS('scrollbar-width','none');
  const fits=await main.evaluate(element=>element.scrollHeight===element.clientHeight);
  if(fits){
   expect(await main.evaluate(element=>element.scrollTop)).toBe(0);
  }else{
   await wheelPane(page,main);
  }
  // This also catches hidden descendants clipping a tab whose outer column claims to fit.
  await expect(last).toBeInViewport({ratio:1});
  expect(await boxOf(rail)).toEqual(railBefore);
  expect(errors).toEqual([]);
 });
}

test('full Evals retains visible overflow and the complete report height',async({page})=>{
 const errors=await openPane(page,'#/skill/deploy-check?tab=evals&rail=closed&full=1');
 const main=page.locator('.detail-body.full .detail-main');
 await expect(page.locator('.detail-rail')).toHaveCount(0);
 await expect(main).toHaveCSS('overflow-y','visible');
 await expect(page.locator('.evals-tab')).toHaveCSS('overflow-y','visible');
 await expect(page.locator('.evals-body')).toHaveCSS('overflow-y','visible');
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
