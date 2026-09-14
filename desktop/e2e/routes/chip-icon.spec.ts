import { test, expect } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

// chip-icon (Ajay, 2026-09-13; retargeted 2026-09-14). `Icon` carries an inline `display:block`, which beat the
// `.chip-label>svg{vertical-align:middle}` rule and laid a chip's tick out as its own block line above the text —
// clipped to a sliver by the label's `overflow:hidden` and spilling past the card's padding. app.css now forces
// `.chip-label>svg` to `inline-block` past the inline style. The card chip that carried the tick ("Installed · on
// this machine") left with #199 the same day, so no chip in the app draws an icon today and the original target
// never rendered again; the rule still guards every chip that takes one (Chip.test.tsx pins the markup: the svg is
// the label's first child). So this spec builds that exact markup — `<Chip><Icon size={12}/>text</Chip>`, inline
// style included — inside a real card's chip row under the live stylesheet: jsdom has no layout, so only a real
// engine can see the line break.
test('lays a chip icon out on the same line as its chip text',async({page})=>{
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await prepare(page,{name:'Chip icon',route:'#/library/global',klass:'screen',width:1440,height:900});
 const card=page.getByTestId('skill-card-deploy-check');
 const first=card.locator('.chip').first();
 await expect(first).toBeVisible();
 await first.evaluate(sibling=>{
  const chip=document.createElement('span');chip.className='chip';chip.setAttribute('data-probe','chip-icon');
  const label=document.createElement('span');label.className='chip-label';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of [['aria-hidden','true'],['width','12'],['height','12'],['viewBox','0 0 24 24'],['fill','none'],['stroke','currentColor'],['stroke-width','2']])svg.setAttribute(key,value);
  svg.style.cssText='color:inherit;flex-shrink:0;display:block'; // Icon.tsx's inline style, the thing the rule has to beat
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M20 6 9 17l-5-5');svg.append(path);
  label.append(svg,document.createTextNode('Installed · on this machine'));chip.append(label);
  sibling.parentElement?.append(chip);
 });
 const chip=card.locator('.chip[data-probe="chip-icon"]');
 await expect(chip).toBeVisible();
 await expect(chip.locator('svg')).toHaveCSS('display','inline-block');

 // One line: the label's content never grows past the 20px line box it is allowed to paint in.
 const label=chip.locator('.chip-label');
 const fits=await label.evaluate(node=>node.scrollHeight<=node.clientHeight);
 expect(fits).toBe(true);

 // And the tick paints inside the pill, ahead of the text, rather than above it.
 const pill=await chip.boundingBox(),tick=await chip.locator('svg').boundingBox();
 if(!pill||!tick)throw new Error('The probe chip has no bounding box.');
 expect(tick.y).toBeGreaterThanOrEqual(pill.y);
 expect(tick.y+tick.height).toBeLessThanOrEqual(pill.y+pill.height);
 // `vertical-align:middle` centres on the baseline plus half an x-height, so a pixel low is on-spec.
 expect(Math.abs((tick.y+tick.height/2)-(pill.y+pill.height/2))).toBeLessThanOrEqual(1);
 const text=await label.evaluate(node=>{const range=document.createRange();range.selectNodeContents(node.lastChild as Node);const box=range.getBoundingClientRect();return {x:box.x,y:box.y};});
 expect(text.x).toBeGreaterThanOrEqual(tick.x+tick.width);
 expect(Math.abs(text.y-pill.y)).toBeLessThanOrEqual(pill.height);
 expect(errors).toEqual([]);
});
