import { test, expect } from '@playwright/test';
import { prepare } from '../fidelity/determinism';
test('setup shows eval descriptions and completes an overnight queue',async({page})=>{
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,{name:'SetupEvals',route:'#/onboarding/boot?start=1',klass:'screen',width:1440,height:900});
 let dialog=page.getByRole('dialog');await expect(dialog.getByRole('radio',{name:'Create a new team'})).toBeVisible();
 await dialog.getByRole('radio',{name:'Create a new team'}).check();await dialog.getByRole('button',{name:'Continue'}).click();
 await page.getByRole('dialog',{name:'Add a project?'}).getByRole('button',{name:'No',exact:true}).click();
 dialog=page.getByRole('dialog',{name:/Evaluate the 2 shared skills/});await expect(dialog.getByRole('radio')).toHaveCount(4);
 for(const text of ['Runs all 2, 4 at a time, in this terminal.','Asks how many at a time and checks in between batches.','Queues them; the app runs them between 01:00 and 05:00 while it is open and idle.','Evaluate any skill later with `npx -y terum-skills@latest eval <skill>`.'])await expect(dialog.getByText(text,{exact:true})).toBeVisible();
 await expect(dialog).toContainText('no earlier runs to estimate from');await expect(dialog.getByRole('radio',{name:'Skip'})).toBeChecked();await dialog.getByRole('radio',{name:'Overnight'}).check();await expect(dialog.getByRole('radio',{name:'Overnight'})).toBeChecked();await dialog.getByRole('button',{name:'Continue'}).click();
 const row=page.locator('.onboarding-progress-row').filter({hasText:'Evaluating shared skills'});await expect(row).toHaveAttribute('data-state','done');await expect(row).toContainText('Queued');expect(errors).toEqual([]);
});
