import { expect,it } from 'vitest';
import type { ReceiptSummary } from '../../backend/types';
import { verdictToken } from './verdict';
const summary:ReceiptSummary={w:11,l:3,t:4,n:18,lift:44,verdict:'PASS',partial:null,signP:'0.057'};
it.each([['PASS','good','tint-good'],['NEUTRAL','text2','bg4'],['FAIL','bad','tint-bad']] as const)('maps %s to the design tokens',(verdict,fg,bg)=>expect(verdictToken({...summary,verdict})).toEqual({fg,bg}));
it('mutes both partial and disabled verdicts',()=>{expect(verdictToken({...summary,partial:[18,21]})).toEqual({fg:'text3',bg:'bg3'});expect(verdictToken(summary,{muted:true})).toEqual({fg:'text3',bg:'bg3'});});
it('demotes missing receipts',()=>expect(verdictToken(null)).toEqual({fg:'text3',bg:'bg3'}));
