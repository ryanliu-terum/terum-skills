import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

async function openCards(page:Page,route:string){
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,{name:'Card clicks',route,klass:'screen',width:1440,height:900});
 return errors;
}

async function clickBody(page:Page,body:Locator){
 await expect(body).toBeVisible();
 await body.scrollIntoViewIfNeeded();
 const box=await body.boundingBox();
 if(!box)throw new Error('Card body has no bounding box.');
 // Use real pointer coordinates: the stretched title link covers the body.
 await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
}

test('skill body click opens the skill',async({page})=>{
 const errors=await openCards(page,'#/library/global');
 await clickBody(page,page.getByTestId('skill-card-deploy-check').locator('.skill-card-desc'));
 await expect(page).toHaveURL(/#\/skill\/deploy-check$/);
 expect(errors).toEqual([]);
});

test('switch click toggles without navigating',async({page})=>{
 const errors=await openCards(page,'#/library/global');
 const toggle=page.getByTestId('skill-card-deploy-check').getByRole('switch');
 await expect(toggle).toHaveAttribute('aria-checked','true');
 await toggle.click();
 await expect(page).toHaveURL(/#\/library\/global$/);
 await expect(toggle).toHaveAttribute('aria-checked','false');
 expect(errors).toEqual([]);
});

test('favorite click toggles without navigating',async({page})=>{
 const errors=await openCards(page,'#/library/global');
 const favorite=page.getByTestId('skill-card-deploy-check').getByRole('button',{name:'Favorite deploy-check'});
 await expect(favorite).toHaveAttribute('aria-pressed','true');
 await favorite.click();
 await expect(page).toHaveURL(/#\/library\/global$/);
 await expect(favorite).toHaveAttribute('aria-pressed','false');
 expect(errors).toEqual([]);
});

test('flag hover still shows the update tooltip',async({page})=>{
 const errors=await openCards(page,'#/library/global');
 const flag=page.getByTestId('skill-card-pr-review').locator('[data-flag="update"]');
 await flag.hover();
 await expect(flag.locator('.board-hover-tip')).toBeVisible();
 await expect(page).toHaveURL(/#\/library\/global$/);
 expect(errors).toEqual([]);
});

test('the marketplace card menu opens the install dialog',async({page})=>{
 const errors=await openCards(page,'#/marketplace/skills');
 const card=page.getByTestId('skill-card-a11y-audit');
 await card.hover();
 await expect(page.locator('.market-card-install')).toHaveCount(0);
 await card.getByRole('button',{name:'More actions for a11y-audit'}).click();
 await page.getByRole('menuitem',{name:'Install…',exact:true}).click();
 await expect(page).toHaveURL(/#\/skill\/a11y-audit\?dialog=install&root=marketplace$/);
 await expect(page.getByRole('dialog')).toBeVisible();
 expect(errors).toEqual([]);
});

test('More actions opens Uninstall',async({page})=>{
 const errors=await openCards(page,'#/library/global');
 const card=page.getByTestId('skill-card-deploy-check');
 await card.hover();
 await card.getByRole('button',{name:'More actions for deploy-check'}).click();
 await page.getByRole('menuitem',{name:'Uninstall…',exact:true}).click();
 await expect(page).toHaveURL(/dialog=remove/);
 expect(errors).toEqual([]);
});

test('More actions opens Move, and says why Publish cannot run',async({page})=>{
 const errors=await openCards(page,'#/library/global');
 const card=page.getByTestId('skill-card-deploy-check');
 await card.hover();
 await card.getByRole('button',{name:'More actions for deploy-check'}).click();
 await expect(page.getByRole('menuitem',{name:/Publish to team/})).toContainText('Already published to the team.');
 await page.getByRole('menuitem',{name:/Move to/}).click();
 await expect(page).toHaveURL(/dialog=move/);
 await expect(page.getByRole('dialog')).toBeVisible();
 expect(errors).toEqual([]);
});

test('keyboard focus puts the focus ring on the card',async({page})=>{
 const errors=await openCards(page,'#/library/global');
 const supported=await page.evaluate(()=>CSS.supports('selector(:has(a))'));
 expect(errors).toEqual([]);
 test.skip(!supported,'Card focus ring requires :has(); older WebViews retain the anchor outline.');
 const card=page.getByTestId('skill-card-deploy-check');
 const title=card.getByRole('link',{name:'deploy-check',exact:true});
 await expect(title).toBeVisible();
 for(let presses=0;presses<60;presses++){
  await page.keyboard.press('Tab');
  if(await title.evaluate(anchor=>document.activeElement===anchor))break;
 }
 await expect(title).toBeFocused();
 const shadow=await card.evaluate(article=>getComputedStyle(article).boxShadow);
 expect(shadow).not.toBe('none');
 expect(shadow).toContain('0px 0px 0px 2px');
 await expect(title).toHaveCSS('outline-style','none');
 expect(errors).toEqual([]);
});

test('marketplace-origin skill body click keeps the root',async({page})=>{
 const errors=await openCards(page,'#/marketplace/people/ryan');
 await clickBody(page,page.locator('[data-testid^="skill-card-"]').first().locator('.skill-card-desc'));
 await expect(page).toHaveURL(/root=marketplace/);
 await expect(page).toHaveURL(/#\/skill\/[^?]+\?root=marketplace$/);
 expect(errors).toEqual([]);
});

test('person body click opens the person',async({page})=>{
 const errors=await openCards(page,'#/marketplace/people');
 await clickBody(page,page.getByTestId('person-card-ryan').locator('.market-person-lines'));
 await expect(page).toHaveURL(/#\/marketplace\/people\/ryan$/);
 expect(errors).toEqual([]);
});

test('person Follow toggles without navigating',async({page})=>{
 const errors=await openCards(page,'#/marketplace/people');
 const card=page.getByTestId('person-card-ryan');
 await card.getByRole('button',{name:'Follow ryan',exact:true}).click();
 await expect(page).toHaveURL(/#\/marketplace\/people$/);
 await expect(card.getByRole('button',{name:'Unfollow ryan',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(errors).toEqual([]);
});
