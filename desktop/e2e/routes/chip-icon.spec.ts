import { test, expect } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

// chip-icon (Ajay, 2026-09-13). `Icon` carries an inline `display:block`, which beat the
// `.chip-label>svg{vertical-align:middle}` rule and laid the tick out as its own block line above the
// text — clipped to a sliver by the label's `overflow:hidden` and spilling past the card's padding.
// The vitest sibling (Chip.test.tsx) asserts the tick and text are siblings in the label, which stayed
// true the whole time: jsdom has no layout, so only a real engine can see this one.
test('lays the installed tick out on the same line as its chip text',async({page})=>{
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await prepare(page,{name:'Chip icon',route:'#/library/global?__mock=on-disk-only',klass:'screen',width:1440,height:900});
 const chip=page.getByTestId('skill-card-deploy-check').locator('.chip',{hasText:'Installed · on this machine'});
 await expect(chip).toBeVisible();
 await expect(chip.locator('svg')).toHaveCSS('display','inline-block');

 // One line: the label's content never grows past the 20px line box it is allowed to paint in.
 const label=chip.locator('.chip-label');
 const fits=await label.evaluate(node=>node.scrollHeight<=node.clientHeight);
 expect(fits).toBe(true);

 // And the tick paints inside the pill, ahead of the text, rather than above it.
 const pill=await chip.boundingBox(),tick=await chip.locator('svg').boundingBox();
 if(!pill||!tick)throw new Error('The installed chip has no bounding box.');
 expect(tick.y).toBeGreaterThanOrEqual(pill.y);
 expect(tick.y+tick.height).toBeLessThanOrEqual(pill.y+pill.height);
 // `vertical-align:middle` centres on the baseline plus half an x-height, so a pixel low is on-spec.
 expect(Math.abs((tick.y+tick.height/2)-(pill.y+pill.height/2))).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});
