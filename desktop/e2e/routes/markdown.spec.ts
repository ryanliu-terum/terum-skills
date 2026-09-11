import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

async function openPane(page:Page,route:string){
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,{name:'Markdown',route,klass:'screen',width:1440,height:900});
 return errors;
}

const route='#/skill/deploy-check?__mock=raw-md';

test('real SKILL.md body renders at the drawn body size',async({page})=>{
 const errors=await openPane(page,route);
 const paragraph=page.locator('.md-doc p.md-p').first();
 await expect(paragraph).toHaveCSS('font-size','13px');
 await expect(paragraph).toHaveCSS('line-height','20px');
 expect(errors).toEqual([]);
});
test("section headings carry the board's own weight and air",async({page})=>{
 const errors=await openPane(page,route);
 const heading=page.locator('.md-doc h2.md-h2').first();
 await expect(heading).toHaveCSS('font-size','14px');
 await expect(heading).toHaveCSS('font-weight','590');
 await expect(heading).toHaveCSS('line-height','20px');
 // RAW_MD begins with this h2, but the frontmatter block renders above the doc, so the heading keeps the
 // board's 6px (10px gap + 6px = the drawn 16px), exactly like the mock's first .md-h2 under its frontmatter.
 await expect(heading).toHaveCSS('margin-top','6px');
 expect(await heading.evaluate(element=>element.getBoundingClientRect().top-element.parentElement!.previousElementSibling!.getBoundingClientRect().bottom)).toBe(16);
 // Spec §4.4 removes top air from the first child only when the doc is the panel's first block (a SKILL.md
 // without frontmatter): take the frontmatter block away and the same heading sits flush.
 await page.getByTestId('frontmatter').evaluate(element=>element.remove());
 await expect(heading).toHaveCSS('margin-top','0px');
 // Exercise the same heading after a paragraph without changing the spec's literal RAW_MD document.
 await heading.evaluate(element=>{
  const paragraph=element.parentElement!.querySelector('p.md-p')!;
  element.before(paragraph.cloneNode(true));
 });
 await expect(heading).toHaveCSS('margin-top','6px');
 expect(await heading.evaluate(element=>element.getBoundingClientRect().top-element.previousElementSibling!.getBoundingClientRect().bottom)).toBe(16);
 expect(errors).toEqual([]);
});
test('code renders in the brand mono face',async({page})=>{
 const errors=await openPane(page,route);
 const code=page.locator('.md-doc pre.md-code');
 await expect(code).toHaveCSS('font-size','12px');
 const family=await code.evaluate(el=>getComputedStyle(el).fontFamily);
 expect(family).toContain('JetBrains Mono Variable');
 expect(await page.locator('.md-doc p code').first().evaluate(el=>getComputedStyle(el).fontFamily)).toBe(family);
 expect(errors).toEqual([]);
});
test('list markers occupy the drawn 16px column',async({page})=>{
 const errors=await openPane(page,route);
 const item=page.locator('.md-doc ol.md-list > li').first();
 await expect(item).toHaveCSS('display','flex');
 expect(await item.evaluate(el=>getComputedStyle(el,'::before').width)).toBe('16px');
 expect(await item.evaluate(el=>getComputedStyle(el,'::before').content)).toContain('"."');
 expect(errors).toEqual([]);
});
test('bold text stays on the type ramp',async({page})=>{
 const errors=await openPane(page,route);
 await expect(page.locator('.md-doc strong').first()).toHaveCSS('font-weight','590');
 expect(errors).toEqual([]);
});
test('links and images are inert',async({page})=>{
 const errors=await openPane(page,route);
 await expect(page.locator('.md-doc a')).toHaveCount(0);
 await expect(page.locator('.md-doc img')).toHaveCount(0);
 await expect(page.locator('link[rel="preload"]')).toHaveCount(0);
 await expect(page.locator('.md-url').first()).toHaveText('https://example.com/docs');
 expect(errors).toEqual([]);
});
test('no request leaves the app for an image in the document',async({page})=>{
 const requests:string[]=[];
 page.on('request',request=>{if(new URL(request.url()).hostname==='example.com')requests.push(request.url());});
 const errors=await openPane(page,route);
 await expect(page.locator('.md-img')).toContainText('https://example.com/shot.png');
 expect(requests).toEqual([]);
 expect(errors).toEqual([]);
});
test('the document keeps exactly one h1 and no unstyled heading',async({page})=>{
 const errors=await openPane(page,route);
 await expect(page.locator('h1')).toHaveCount(1);
 const headings=page.locator('.md-doc h2, .md-doc h3, .md-doc h4, .md-doc h5, .md-doc h6');
 await expect(headings).toHaveCount(3);
 for(const heading of await headings.all())expect(await heading.getAttribute('class')).toMatch(/^md-h/);
 expect(errors).toEqual([]);
});
