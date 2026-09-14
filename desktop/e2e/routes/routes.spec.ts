import { test, expect } from '@playwright/test';
import { BOARDS } from '../fidelity/boards';
import type { Board } from '../fidelity/boards';
import { prepare } from '../fidelity/determinism';
test.describe.configure({mode:'parallel'});
const extra:Board[]=[{name:'Redirect',route:'#/',klass:'screen',width:1440,height:900},{name:'Search',route:'#/search',klass:'screen',width:1440,height:900},{name:'SearchQuery',route:'#/search?q=deploy',klass:'screen',width:1440,height:900},{name:'Not found',route:'#/nope',klass:'screen',width:1440,height:900},{name:'LibraryFilters',route:'#/library/global?filters=open',klass:'screen',width:1440,height:900},{name:'LibrarySorted',route:'#/library/global?sort=name&q=deploy',klass:'screen',width:1440,height:900},{name:'LibrarySelect',route:'#/library/global?select=1',klass:'screen',width:1440,height:900},{name:'LibraryBulkPublishEmpty',route:'#/library/global?select=1&dialog=publish',klass:'screen',width:1440,height:900}];
for(const board of [...BOARDS,...extra])test(board.name,async({page})=>{
 const errors:string[]=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400)errors.push(response.status()+' '+response.url());});
 page.on('requestfailed',request=>errors.push(request.failure()?.errorText+' '+request.url()));
 await prepare(page,board);
 await expect(page.getByRole('main')).toBeVisible();
 await expect(page.locator('[data-error-boundary]')).toHaveCount(0);
 if(board.name==='Redirect')await expect(page).toHaveURL(/#\/library\/global$/);
 if(board.name==='Search')await expect(page.getByRole('textbox',{name:'Search skills, people, projects'})).toBeVisible();
 if(board.name==='SearchQuery')await expect(page.getByTestId('search-hit-skill-deploy-check')).toBeVisible();
 if(board.name==='Not found')await expect(page.getByText('No such page')).toBeVisible();
 if(board.name==='LibraryFilters'){await expect(page.locator('.market-filters')).toBeVisible();await expect(page.getByRole('button',{name:/^Filter/})).toHaveAttribute('aria-pressed','true');}
 if(board.name==='LibrarySelect'){await expect(page.getByRole('checkbox',{name:/^Select /})).toHaveCount(15);await expect(page.getByRole('toolbar',{name:'Selection'})).toContainText('0 of 15 selected');await expect(page.getByRole('button',{name:'Done'})).toHaveAttribute('aria-pressed','true');}
 if(board.name==='LibraryBulkPublishEmpty'){await expect(page.getByRole('dialog')).toContainText('No skills selected.');await expect(page.getByRole('dialog').getByRole('button')).toHaveCount(1);}
 if(board.name==='LibrarySorted'){await expect(page.getByRole('button',{name:'Name'})).toBeVisible();await expect(page.getByTestId(/^skill-card-/).first()).toBeVisible();}
 if(board.route.includes('__mock=error'))await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
 expect(errors).toEqual([]);
});
