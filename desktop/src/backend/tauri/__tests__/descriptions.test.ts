import { expect, it } from 'vitest';
import { parseCliFrame } from '../frames';
import { createTauriBackend } from '../index';
import { driveRun } from '../../drive';
import { fakeBridge } from './fake-bridge';
const ask={t:'ask',id:'1',kind:'select',question:'Choose',choices:['Now','Overnight'],default:'Overnight',detail:['Estimate'],descriptions:['Run now','Run later']};
it.each([['Run now',3],['Only one'],'bad'])('drops malformed descriptions without moving choices: %j',descriptions=>{
 const diagnostics:string[]=[];const parsed=parseCliFrame(JSON.stringify({...ask,descriptions}),line=>diagnostics.push(line));expect(diagnostics).toEqual(['Malformed ask descriptions from terum-skills; descriptions omitted.']);expect(parsed).toMatchObject({choices:ask.choices,detail:ask.detail});expect(parsed).not.toHaveProperty('descriptions');
});
it('preserves descriptions, detail and default through the real adapter and driver',async()=>{
 const h=fakeBridge((_args,emit)=>emit({kind:'stdout',line:JSON.stringify(ask)}));
 h.bridge.write=async()=>{h.emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'setup',ok:true,exitCode:0,value:{role:'creator',team:'t',steps:{evals:'queued'}}})});h.emit({kind:'exit',code:0});};
 const result=await driveRun(createTauriBackend(h.bridge).setup({}),{},async question=>{expect(question).toEqual({kind:'select',question:'Choose',choices:ask.choices,default:'Overnight',detail:ask.detail,descriptions:ask.descriptions});return 'Overnight';});expect(result.ok).toBe(true);
});
