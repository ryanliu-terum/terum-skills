import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { BOARDS } from './boards';
import { readFidelity } from './fidelity-md';
import { TOLERANCE, PIXELMATCH_OPTIONS } from './tolerance';
import { prepare } from './determinism';
import { oraclePath, resolveDesignDir } from './design-dir';
const statuses=readFidelity();
const design = resolveDesignDir();
for(const board of BOARDS){test.describe(()=>{
 const status=statuses.get(board.name);if(!status)throw new Error('Missing fidelity status: '+board.name);
 const locked=status==='locked';
 test.skip(design === undefined, 'TERUM_DESIGN_DIR is not set: no fidelity oracle on this machine');
 test.skip(!locked&&!process.env.FIDELITY_ALL,'not locked'); // Declaration-time skip avoids creating a browser or page for todo rows.
 test(board.name,async({page})=>{
 if (!design) throw new Error('unreachable: fidelity test ran without TERUM_DESIGN_DIR');
 const baseline=PNG.sync.read(readFileSync(oraclePath(design.shots, board.name)));
 expect({width:baseline.width,height:baseline.height},'Oracle viewport mismatch: '+board.name).toEqual({width:board.width,height:board.height});
 const {hoverTargetMissing}=await prepare(page,board,locked);
 const actualBytes=await page.screenshot({animations:'disabled',caret:'hide',scale:'css',fullPage:false});const actual=PNG.sync.read(actualBytes);
 const diff=new PNG({width:board.width,height:board.height});
 const diffPixels=pixelmatch(baseline.data,actual.data,diff.data,board.width,board.height,PIXELMATCH_OPTIONS);
 const ratio=diffPixels/(board.width*board.height);const tolerance=board.exact?0:TOLERANCE[board.klass];const pass=board.exact?diffPixels===0:ratio<=tolerance;
 const dir='e2e/out/fidelity';mkdirSync(dir+'/rows',{recursive:true});
 function write(path:string,content:Buffer|string){writeFileSync(path,content);expect(readFileSync(path)).toEqual(Buffer.from(content));}
 write(`${dir}/${board.name}.actual.png`,actualBytes);write(`${dir}/${board.name}.diff.png`,PNG.sync.write(diff));
 write(`${dir}/rows/${board.name}.json`,JSON.stringify({name:board.name,route:board.route,klass:board.klass,width:board.width,height:board.height,diffPixels,ratio,tolerance,pass,locked,hoverTargetMissing},null,2)+'\n');
 if(locked)expect(pass,`${board.name}: ${diffPixels} pixels, ratio ${ratio}, tolerance ${tolerance}; ${dir}/${board.name}.diff.png`).toBe(true);
});});}
