import { it, expect } from 'vitest';
import json from '../design.json';
import { parseDesign } from '../schema';
import { ICON_PATHS } from '../../components/ui/icon-paths';
it('validates the complete fixture without losing source fields',()=>expect(parseDesign(json)).toEqual(json));
it('reports a stale nested field path',()=>{const broken=structuredClone(json);Reflect.set(broken.DETAIL.receipt,'catalog','invalid');expect(()=>parseDesign(broken)).toThrow('DETAIL.receipt.catalog');});
it('transcribes exactly all 53 icon paths',()=>{expect(ICON_PATHS).toEqual(json.ICON_PATHS);expect(Object.keys(ICON_PATHS)).toHaveLength(53);});
it('exports the 29 tokens and the actual update-hover card',()=>{expect(Object.keys(json.TOKENS)).toHaveLength(29);expect(json.SKILLS[json.HOVER_INDEX]?.flags).toContain('update');});

it('rejects malformed per-case tuples and invalid inbox kinds',()=>{const malformed=structuredClone(json);Reflect.set(malformed.DETAIL.receipt.per_case[0]??[],'0',10);expect(()=>parseDesign(malformed)).toThrow('DETAIL.receipt.per_case.0.0');const invalidKind=structuredClone(json);Reflect.set(invalidKind.INBOX[0]??{},'kind','unsupported');expect(()=>parseDesign(invalidKind)).toThrow('INBOX.0.kind');});

it('requires verdict theme foreground/background pairs with precise field paths',()=>{
 for(const theme of ['dark','light','figma']){
  for(const invalid of ['red',['red'],['red',42],['red','blue','extra'],null]){
   const broken=structuredClone(json);Reflect.set(broken.VERDICT_STYLE.PASS,theme,invalid);
   expect(()=>parseDesign(broken)).toThrow('VERDICT_STYLE.PASS.'+theme);
  }
  const missing=structuredClone(json);Reflect.deleteProperty(missing.VERDICT_STYLE.PASS,theme);
  expect(()=>parseDesign(missing)).toThrow('VERDICT_STYLE.PASS.'+theme);
 }
});
