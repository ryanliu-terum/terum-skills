import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

// sidebar-spacing (Teddy, 2026-09-10). The vitest sibling pins the five values as text; this pins that a real
// Chromium actually applies them, including the one rule whose correctness depends on the sidebar's DOM order.
async function openSidebar(page:Page,route='#/library/global'){
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,{name:'Sidebar spacing',route,klass:'screen',width:1440,height:900});
 await expect(page.locator('.sidebar-inner')).toBeVisible();
 return errors;
}

test('applies the realistic mock’s five sidebar spacing values',async({page})=>{
 const errors=await openSidebar(page);
 const inner=page.locator('.sidebar-inner');
 await expect(inner).toHaveCSS('row-gap','26px');
 await expect(inner).toHaveCSS('padding-top','28px');
 await expect(inner).toHaveCSS('padding-left','8px');
 const groups=page.locator('.sidebar-inner > .nav-group');
 await expect(groups).toHaveCount(2);
 await expect(groups.first()).toHaveCSS('row-gap','4px');
 await expect(groups.first()).toHaveCSS('margin-top','0px');
 await expect(groups.nth(1)).toHaveCSS('row-gap','4px');
 await expect(groups.nth(1)).toHaveCSS('margin-top','56px');
 await expect(page.locator('.sidebar').getByRole('link',{name:/^Global/})).toHaveCSS('height','34px');
 await expect(page.locator('.sidebar').getByRole('link',{name:'Marketplace'})).toHaveCSS('height','34px');
 expect(errors).toEqual([]);
});

test('leaves 82px of air between the Library group and the Team group',async({page})=>{
 const errors=await openSidebar(page);
 const groups=page.locator('.sidebar-inner > .nav-group');
 const inner=await page.locator('.sidebar-inner').boundingBox();
 const first=await groups.first().boundingBox();
 const second=await groups.nth(1).boundingBox();
 if(!inner||!first||!second)throw new Error('Sidebar spacing assertion target has no bounding box.');
 expect(Math.round(first.y-inner.y)).toBe(28);                       // the 28px top padding
 expect(Math.round(second.y-(first.y+first.height))).toBe(82);       // 26px stack gap + 56px Team margin
 expect(errors).toEqual([]);
});

test('keeps the Team group second, and unspaced, when the Inbox section is folded away',async({page})=>{
 const errors=await openSidebar(page,'#/library/global?inbox=collapsed');
 const groups=page.locator('.sidebar-inner > .nav-group');
 await expect(groups).toHaveCount(2);
 await expect(groups.nth(1)).toContainText('Team');
 await expect(groups.nth(1)).toHaveCSS('margin-top','56px');
 expect(errors).toEqual([]);
});

test('does not widen the sidebar or move the panel',async({page})=>{
 const errors=await openSidebar(page);
 await expect(page.locator('.sidebar')).toHaveCSS('width','240px');
 const panel=await page.locator('.panel').boundingBox();
 if(!panel)throw new Error('The panel has no bounding box.');
 expect(Math.round(panel.x)).toBe(240);
 expect(errors).toEqual([]);
});
