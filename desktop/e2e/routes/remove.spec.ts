import { test, expect } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

// The mock's disclosure fixture (src/backend/mock MOCK_REMOVE_DETAIL) is asserted by literal lines here: Playwright's
// loader cannot import the mock module (design.json needs an import attribute), and the fixture's shape is pinned by mock.test.ts.
const FIRST_LINE='terum-skills will be removed from this machine.';
const LAUNCH_STATE_LINE='  Desktop launch state in ~/.terum/skills/run (app.json, latest-version.json)';
const LAST_LINE='The package itself is not removed by this command; the last line tells you how.';

test('Remove URL shows the CLI disclosure and Cancel returns to Advanced',async({page})=>{
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,{name:'Remove',route:'#/settings/advanced?dialog=remove',klass:'screen',width:1440,height:900});
 const dialog=page.getByRole('dialog',{name:'Remove terum-skills from this machine?'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Remove',exact:true})).toHaveAttribute('data-kind','danger');
 await expect.poll(()=>dialog.locator('.settings-bullet').allTextContents()).toHaveLength(14);
 const lines=await dialog.locator('.settings-bullet').allTextContents();
 expect(lines[0]).toBe(FIRST_LINE);expect(lines).toContain(LAUNCH_STATE_LINE);expect(lines.at(-1)).toBe(LAST_LINE);
 await dialog.getByRole('button',{name:'Cancel'}).click();
 await expect(dialog).not.toBeVisible();await expect(page).toHaveURL(/#\/settings\/advanced$/);
 await expect(page.getByRole('heading',{name:'Advanced'})).toBeVisible();
 await expect(page.getByRole('status')).toHaveText('Uninstall was cancelled.');
 await expect(page.getByRole('button',{name:'Remove…'})).toBeEnabled();
 expect(errors).toEqual([]);
});
