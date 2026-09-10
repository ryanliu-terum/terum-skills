import { expect,test } from '@playwright/test';
import { prepare } from '../fidelity/determinism';

test.describe.configure({mode:'parallel'});

test('SkillDetailNoReceipt keeps the drawn empty state and draws no History rail',async({page})=>{
 const errors:string[]=[];
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,{name:'SkillDetailNoReceipt',route:'#/skill/onboarding-tour?tab=evals',klass:'screen',width:1440,height:900});
 await expect(page.locator('.state-title').filter({hasText:'Not evaluated'})).toBeVisible();
 await expect(page.getByText('History')).toHaveCount(0);
 await expect(page.locator('.history-rail')).toHaveCount(0);
 await expect(page.locator('.evals-body')).toHaveCount(0);
 expect(errors).toEqual([]);
});
