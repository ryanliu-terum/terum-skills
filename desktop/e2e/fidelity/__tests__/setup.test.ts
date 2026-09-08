import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearFidelityOutput } from '../setup';
import { it, expect } from 'vitest';
it('removes stale fidelity rows and reports while preserving screenshots, including repeated setup',()=>{
 const root=mkdtempSync(join(tmpdir(),'s1a-fidelity-'));const output=join(root,'e2e/out/fidelity');
 try{
  mkdirSync(join(output,'rows'),{recursive:true});
  writeFileSync(join(output,'rows','stale.json'),'{}');writeFileSync(join(output,'report.json'),'[]');
  writeFileSync(join(output,'Main.actual.png'),'preserve');
  clearFidelityOutput(output);clearFidelityOutput(output);
  expect(existsSync(join(output,'rows'))).toBe(false);expect(existsSync(join(output,'report.json'))).toBe(false);
  expect(readFileSync(join(output,'Main.actual.png'),'utf8')).toBe('preserve');
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('fails setup when a malformed report path cannot be deleted as a file',()=>{
 const root=mkdtempSync(join(tmpdir(),'s1a-fidelity-'));const report=join(root,'e2e/out/fidelity/report.json');
 try{
  mkdirSync(report,{recursive:true});writeFileSync(join(report,'unexpected'),'preserve');
  expect(()=>clearFidelityOutput(join(root,'e2e/out/fidelity'))).toThrow('EISDIR');expect(readFileSync(join(report,'unexpected'),'utf8')).toBe('preserve');
 }finally{rmSync(root,{recursive:true,force:true});}
});
