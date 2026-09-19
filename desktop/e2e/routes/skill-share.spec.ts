import { expect, test } from '@playwright/test';
import type { Download } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishShareFile, publishSharePng } from '../helpers/share-artifacts';

async function downloadBytes(download:Download):Promise<Buffer> {
 const stream=await download.createReadStream(),chunks:Buffer[]=[];
 for await(const chunk of stream)chunks.push(Buffer.from(chunk));
 return Buffer.concat(chunks);
}
async function publishDownload(download:Download):Promise<{path:string;bytes:Buffer}> {
 const bytes=await downloadBytes(download),path=publishSharePng('e2e/out/share/'+download.suggestedFilename(),bytes);
 return {path,bytes};
}

test('all four PNGs preserve every canvas pixel and the circular sharing sheet works',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/#/marketplace');await expect(page.locator('html')).toHaveAttribute('data-app-ready','true');
 await page.evaluate(()=>{
  const original=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
   const pixels=this.getContext('2d')!.getImageData(0,0,this.width,this.height).data;
   (window as Window & {sharePixelHash?:Promise<string>}).sharePixelHash=crypto.subtle.digest('SHA-256',pixels).then(hash=>Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''));
   original.call(this,callback,type,quality);
  };
 });
 const cards=page.locator('.skill-card');await expect(cards.first()).toBeVisible();
 expect(await page.getByRole('button',{name:/^Share /}).count()).toBe(await cards.count());
 await page.getByRole('button',{name:'Share deploy-check',exact:true}).click();
 const dialog=page.getByRole('dialog'),preview=dialog.getByAltText('Benchmark image for deploy-check');await expect(preview).toBeVisible();
 for(const name of ['Reddit','X','Instagram','LinkedIn','Copy image','Save PNG']){
  const button=dialog.getByRole('button',{name,exact:true});await expect(button).toBeVisible();await expect(button).toHaveCSS('border-radius','50%');expect(await button.innerText()).toBe('');
 }
 await expect(dialog.getByText('Your benchmark as a PNG.')).toHaveCount(0);
 mkdirSync('e2e/out/share',{recursive:true});const exports:{label:string;file:string}[]=[],windowsPixels:{file:string;width:number;height:number;bgraSha256:string}[]=[];
 for(const [layout,appearance,suffix] of [['Square','Light',''],['Square','Dark','-dark'],['Horizontal','Dark','-horizontal-dark'],['Horizontal','Light','-horizontal']] as const){
  await dialog.getByRole('button',{name:layout,exact:true}).click();await expect(preview).toBeVisible();
  await dialog.getByRole('button',{name:appearance,exact:true}).click();await expect(preview).toBeVisible();
  await expect(dialog.getByRole('button',{name:layout,exact:true})).toHaveAttribute('aria-pressed','true');await expect(dialog.getByRole('button',{name:appearance,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(preview).toHaveJSProperty('naturalWidth',layout==='Horizontal'?1800:1080);
  const next=page.waitForEvent('download');await dialog.getByRole('button',{name:'Save PNG',exact:true}).click();
  const download=await next;expect(download.suggestedFilename()).toBe(`deploy-check-benchmark${suffix}.png`);
  const {path,bytes}=await publishDownload(download),png=PNG.sync.read(bytes,{checkCRC:true});
  expect(bytes[25]).toBe(2); // RGB PNG: no transparency or palette decoding needed.
  const expectedHash=await page.evaluate(()=>(window as Window & {sharePixelHash?:Promise<string>}).sharePixelHash);
  expect(createHash('sha256').update(png.data).digest('hex')).toBe(expectedHash);
  const bgra=Buffer.from(png.data);
  for(let offset=0;offset<bgra.length;offset+=4){const red=bgra[offset]!;bgra[offset]=bgra[offset+2]!;bgra[offset+2]=red;}
  windowsPixels.push({file:download.suggestedFilename(),width:png.width,height:png.height,bgraSha256:createHash('sha256').update(bgra).digest('hex')});
  const background=appearance==='Dark'?[15,16,17,255]:[248,248,248,255];
  for(let x=0;x<png.width;x++)expect([...png.data.subarray(((png.height-1)*png.width+x)*4,((png.height-1)*png.width+x)*4+4)]).toEqual(background);
  if(layout==='Horizontal')expect(png.width/png.height).toBeGreaterThan(1.7);else expect([png.width,png.height]).toEqual([1080,1080]);
  exports.push({label:layout+' · '+appearance,file:basename(path)});
 }
 publishShareFile('e2e/out/share/windows-pixels.json',JSON.stringify(windowsPixels,null,2));
 // Show the clean sharing sheet, without a transient saved confirmation.
 await dialog.getByRole('button',{name:'Dark',exact:true}).click();await expect(preview).toBeVisible();
 const desktop=publishSharePng('e2e/out/share/share-dialog.png',await page.screenshot());
 await page.setViewportSize({width:390,height:720});await expect(dialog).toBeVisible();
 const bounds=await dialog.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);
 await expect(preview).toHaveCSS('object-fit','contain');await preview.scrollIntoViewIfNeeded();await expect(preview).toBeInViewport({ratio:1});
 const mobile=publishSharePng('e2e/out/share/share-dialog-mobile.png',await page.screenshot());
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/#/skill/deploy-check');await expect(page.locator('html')).toHaveAttribute('data-app-ready','true');
 const trigger=page.locator('.detail-actions').getByRole('button',{name:'Share deploy-check',exact:true});
 await expect(trigger).toBeVisible();expect(await trigger.innerText()).toBe('');await expect(trigger).toHaveAttribute('title','Share benchmark image');
 const skillPage=publishSharePng('e2e/out/share/skill-page-share.png',await page.screenshot());
 const skillHeader=publishSharePng('e2e/out/share/skill-page-share-header.png',await page.locator('.detail-head').screenshot());
 await trigger.focus();await page.keyboard.press('Enter');await expect(preview).toBeVisible();
 const detailDownload=page.waitForEvent('download');await dialog.getByRole('button',{name:'Save PNG',exact:true}).click();
 const downloaded=await publishDownload(await detailDownload);expect(PNG.sync.read(downloaded.bytes,{checkCRC:true}).width).toBe(1080);
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 await page.goto('/#/skill/deploy-check?rail=closed&theme=light');await expect(trigger).toBeVisible();
 await trigger.click();await expect(preview).toBeVisible();await page.keyboard.press('Escape');
 publishSharePng('e2e/out/share/deploy-check-benchmark-flat.png',readFileSync('e2e/out/share/deploy-check-benchmark-horizontal.png'));
 const previews=[...exports,{label:'Skill page share button',file:basename(skillHeader)},{label:'Skill page',file:basename(skillPage)},{label:'Updated sharing dialog',file:basename(desktop)},{label:'Sharing dialog on a phone',file:basename(mobile)}];
 publishShareFile('e2e/out/share/index.html','<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current skill sharing previews</title><style>body{margin:24px;background:#18191b;color:#f7f8f8;font:15px system-ui}main{max-width:1100px;margin:auto}figure{margin:32px 0}img{display:block;width:100%;height:auto;object-fit:contain}figure:nth-of-type(-n+2){max-width:640px}h1{font-size:24px}h2{font-size:18px}a{color:#9296ff}</style><main><h1>Current skill sharing previews</h1><p>Square and Horizontal, each in Light and Dark. Example data from the dashboard mock backend.</p>'+previews.map(({label,file})=>`<figure><h2>${label}</h2><a href="${file}"><img src="${file}" alt="${label}"></a><p><a href="${file}" download>Download PNG</a></p></figure>`).join('')+'</main></html>');
 await page.goto(pathToFileURL(resolve('e2e/out/share/index.html')).href);
 await page.locator('img').evaluateAll(async images=>Promise.all(images.map(img=>(img as HTMLImageElement).decode())));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('long identities, missing metrics, and partial evaluations produce bounded PNGs',async({page})=>{
 await page.goto('/#/library/global');await expect(page.locator('html')).toHaveAttribute('data-app-ready','true');
 const images=await page.evaluate(async()=>{
  const renderPath='/src/components/domain/skill-share/render.ts',modelPath='/src/components/domain/skill-share/model.ts',backendPath='/src/backend/mock/index.ts';
  const {renderShareCard}=await import(/* @vite-ignore */renderPath);
  const {shareCardModel}=await import(/* @vite-ignore */modelPath);
  const {createMockBackend}=await import(/* @vite-ignore */backendPath);
  const result=await createMockBackend().skill({ref:'deploy-check'});if(!result.ok)throw new Error(result.error);
  const model=shareCardModel(result.value);
  const cases=[{...model,name:'very-long-skill-name-'.repeat(20),description:'A long description '.repeat(120),candidate:{passed:99,total:120}}, {...model,summary:null,status:'Not evaluated',candidate:null,baseline:null,metrics:model.metrics.map((m:{label:string;unit:string})=>({...m,candidate:null,baseline:null}))}, {...model,summary:{...model.summary,partial:[18,24]},status:'Partial evaluation'}];
  const output=[];
  for(const item of cases){const png:Blob=await renderShareCard(item);output.push(await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('read failed'));r.readAsDataURL(png);}));}
  return output;
 });
 expect(images).toHaveLength(3);
 for(const url of images){const png=PNG.sync.read(Buffer.from(url.split(',')[1]!, 'base64'));expect(png.width).toBe(1080);expect(png.height).toBeLessThan(16384);}
});

test('each social destination receives a real saved or copied PNG before opening',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 const destinations=[['Reddit','https://www.reddit.com/submit','save'],['X','https://twitter.com/intent/tweet','copy'],['Instagram','https://www.instagram.com/','save'],['LinkedIn','https://www.linkedin.com/feed/','copy']] as const;
 // Verify the browser handoff without contacting or publishing to a social account.
 for(const [,url] of destinations)await context.route(url,route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Sharing destination</title>'}));
 await page.goto('/#/skill/deploy-check');
 await page.getByRole('button',{name:'Share deploy-check',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByAltText('Benchmark image for deploy-check')).toBeVisible();
 for(const [name,url,method] of destinations){
  const opened=context.waitForEvent('page'),download=method==='save'?page.waitForEvent('download'):null;
  await dialog.getByRole('button',{name,exact:true}).click();
  const destination=await opened;await destination.waitForURL(url);
  if(download){const saved=await download;expect(saved.suggestedFilename()).toBe('deploy-check-benchmark.png');const bytes=await downloadBytes(saved);expect(PNG.sync.read(bytes,{checkCRC:true}).width).toBe(1080);}
  else {
   await page.bringToFront();
   const copied=await page.evaluate(async()=>{
    const items=await navigator.clipboard.read(),item=items.find(value=>value.types.includes('image/png'));
    if(!item)throw new Error('Clipboard did not contain the benchmark PNG');
    const blob=await item.getType('image/png'),bitmap=await createImageBitmap(blob),size={width:bitmap.width,height:bitmap.height};bitmap.close();return size;
   });
   expect(copied).toEqual({width:1080,height:1080});
  }
  await destination.close();await page.bringToFront();
  await expect(dialog.getByRole('status')).toContainText(method==='save'?'Upload it':'Paste it');
 }
});

test('long text remains complete and inside the exported artboard in every format',async({page})=>{
 await page.goto('/#/marketplace');await expect(page.locator('html')).toHaveAttribute('data-app-ready','true');
 const results=await page.evaluate(async()=>{
  const renderPath='/src/components/domain/skill-share/render.ts',modelPath='/src/components/domain/skill-share/model.ts',backendPath='/src/backend/mock/index.ts';
  const {renderShareCard}=await import(/* @vite-ignore */renderPath),{shareCardModel}=await import(/* @vite-ignore */modelPath),{createMockBackend}=await import(/* @vite-ignore */backendPath);
  const detail=await createMockBackend().skill({ref:'deploy-check'});if(!detail.ok)throw new Error(detail.error);
  const model={...shareCardModel(detail.value),name:'long-skill-name-'.repeat(12)+'NAME_END',description:'The selected skill description is preserved in full. '.repeat(30)+'DESCRIPTION_END',author:'Name '.repeat(22)+'@AUTHOR_END'};
  const original=CanvasRenderingContext2D.prototype.fillText,results=[];
  for(const format of ['light','dark','horizontal','horizontal-dark']){
   const drawn:string[]=[],outside:string[]=[];
   CanvasRenderingContext2D.prototype.fillText=function(value,x,y,maxWidth){
    drawn.push(value);const measured=this.measureText(value).width,right=this.textAlign==='right'?x:x+measured,left=this.textAlign==='right'?x-measured:x;
    if(left<0||right>this.canvas.width/2||y>this.canvas.height/2)outside.push(value);
    if(maxWidth===undefined)original.call(this,value,x,y);else original.call(this,value,x,y,maxWidth);
   };
   try{const png:Blob=await renderShareCard(model,{format}),bitmap=await createImageBitmap(png);results.push({format,text:drawn.join(''),outside,width:bitmap.width,height:bitmap.height});bitmap.close();}
   finally{CanvasRenderingContext2D.prototype.fillText=original;}
  }
  return results;
 });
 for(const result of results){expect(result.text).toContain('NAME_END');expect(result.text).toContain('DESCRIPTION_END');expect(result.text).toContain('@AUTHOR_END');expect(result.outside).toEqual([]);if(result.format.startsWith('horizontal'))expect(result.width/result.height).toBeGreaterThanOrEqual(1.8);}
});
