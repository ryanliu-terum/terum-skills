import { test, expect } from '@playwright/test';
import { BOARDS } from '../fidelity/boards';
import type { Board } from '../fidelity/boards';
import { prepare } from '../fidelity/determinism';
test.describe.configure({mode:'parallel'});
const extra:Board[]=[{name:'Redirect',route:'#/',klass:'screen',width:1440,height:900},{name:'Search',route:'#/search',klass:'screen',width:1440,height:900},{name:'Not found',route:'#/nope',klass:'screen',width:1440,height:900}];
for(const board of [...BOARDS,...extra])test(board.name,async({page})=>{
 const errors:string[]=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,board);
 await expect(page.getByRole('main')).toBeVisible();
 await expect(page.locator('[data-error-boundary]')).toHaveCount(0);
 if(board.name==='Redirect')await expect(page).toHaveURL(/#\/library\/global$/);
 if(board.name==='Search')await expect(page.getByText('Search is coming')).toBeVisible();
 if(board.name==='Not found')await expect(page.getByText('No such page')).toBeVisible();
 if(board.route.includes('__mock=error'))await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
 expect(errors).toEqual([]);
});
