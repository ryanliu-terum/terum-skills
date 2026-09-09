import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
// Pairs ported from the design generator check_contrast (2026-09-08), no duplicated palette.
const pairs: [string,string,string,string|null,number,number][] = [
 [
  "body text3 on panel",
  "text3",
  "panel",
  null,
  1.0,
  4.5
 ],
 [
  "body text3 on bg2 (tiles/cards)",
  "text3",
  "bg2",
  null,
  1.0,
  4.5
 ],
 [
  "text2 on panel",
  "text2",
  "panel",
  null,
  1.0,
  4.5
 ],
 [
  "PASS chip text on tint",
  "good",
  "good",
  "panel",
  0.12,
  4.5
 ],
 [
  "FAIL chip text on tint",
  "bad",
  "bad",
  "panel",
  0.12,
  4.5
 ],
 [
  "partial chip text3 on bg3",
  "text3",
  "bg3",
  null,
  1.0,
  4.5
 ],
 [
  "good figure on panel (24px bold)",
  "good",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "bad figure on panel (24px bold)",
  "bad",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "warn icon on panel",
  "warn",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "info icon on panel",
  "info",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "neutral meter segment vs track",
  "text3",
  "bg4",
  null,
  1.0,
  3.0
 ],
 [
  "tooltip text",
  "tooltipfg",
  "tooltipbg",
  null,
  1.0,
  4.5
 ],
 [
  "link text on bg2",
  "link",
  "bg2",
  null,
  1.0,
  4.5
 ],
 [
  "button text white on brand",
  "#ffffff",
  "brand",
  null,
  1.0,
  4.5
 ],
 [
  "button text white on brand hover",
  "#ffffff",
  "brandhover",
  null,
  1.0,
  4.5
 ],
 [
  "button text white on brand pressed",
  "#ffffff",
  "brandpressed",
  null,
  1.0,
  4.5
 ],
 [
  "danger button text on tint",
  "bad",
  "bad",
  "panel",
  0.12,
  4.5
 ],
 [
  "disabled name text3 on panel",
  "text3",
  "panel",
  null,
  1.0,
  4.5
 ],
 [
  "disabled figure text3 on panel (24px)",
  "text3",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "provenance text3 on bg2",
  "text3",
  "bg2",
  null,
  1.0,
  4.5
 ],
 [
  "bar fill brand vs track bg4",
  "brand",
  "bg4",
  null,
  1.0,
  3.0
 ],
 [
  "good strip cell on bg2",
  "good",
  "bg2",
  null,
  1.0,
  3.0
 ],
 [
  "bad strip cell on bg2",
  "bad",
  "bg2",
  null,
  1.0,
  3.0
 ],
 [
  "text2 on bg2 (code, tables)",
  "text2",
  "bg2",
  null,
  1.0,
  4.5
 ],
 [
  "text3 on modal",
  "text3",
  "modal",
  null,
  1.0,
  4.5
 ],
 [
  "field error bad on modal",
  "bad",
  "modal",
  null,
  1.0,
  4.5
 ],
 [
  "text1 on modal",
  "text1",
  "modal",
  null,
  1.0,
  4.5
 ],
 [
  "link text on panel",
  "link",
  "panel",
  null,
  1.0,
  4.5
 ],
 [
  "text1 on bg4 (avatar initials)",
  "text1",
  "bg4",
  null,
  1.0,
  4.5
 ],
 [
  "record count on win segment",
  "onfill",
  "good",
  null,
  1.0,
  4.5
 ],
 [
  "record count on tie segment",
  "onfill",
  "text3",
  null,
  1.0,
  4.5
 ],
 [
  "record count on loss segment",
  "onfill",
  "bad",
  null,
  1.0,
  4.5
 ],
 [
  "MISS line bad on panel",
  "bad",
  "panel",
  null,
  1.0,
  4.5
 ],
 [
  "unread dot brand on panel",
  "brand",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "unread dot brand on bg4 (selected row)",
  "brand",
  "bg4",
  null,
  1.0,
  3.0
 ],
 [
  "unread dot info on bg4",
  "info",
  "bg4",
  null,
  1.0,
  3.0
 ],
 [
  "unread dot warn on bg4",
  "warn",
  "bg4",
  null,
  1.0,
  3.0
 ],
 [
  "unread dot bad on bg4",
  "bad",
  "bg4",
  null,
  1.0,
  3.0
 ],
 [
  "unread dot text3 on bg4",
  "text3",
  "bg4",
  null,
  1.0,
  3.0
 ],
 [
  "acted line good on bg4 (12px)",
  "good",
  "bg4",
  null,
  1.0,
  4.5
 ],
 [
  "acted line good on panel (12px)",
  "good",
  "panel",
  null,
  1.0,
  4.5
 ],
 [
  "kind badge bad on bg3",
  "bad",
  "bg3",
  null,
  1.0,
  3.0
 ],
 [
  "kind badge warn on bg3",
  "warn",
  "bg3",
  null,
  1.0,
  3.0
 ],
 [
  "kind badge text3 on bg3",
  "text3",
  "bg3",
  null,
  1.0,
  3.0
 ],
 [
  "text2 on bg4 (selected row)",
  "text2",
  "bg4",
  null,
  1.0,
  4.5
 ],
 [
  "text3 on bg3 (hovered row, 12px)",
  "text3",
  "bg3",
  null,
  1.0,
  4.5
 ],
 [
  "added grant chip bad on tint over panel",
  "bad",
  "bad",
  "panel",
  0.12,
  4.5
 ],
 [
  "unchecked control ring on modal",
  "control",
  "modal",
  null,
  1.0,
  3.0
 ],
 [
  "toggle-off track border on bg2 (status card)",
  "control",
  "bg2",
  null,
  1.0,
  3.0
 ],
 [
  "dashed unscored box on panel",
  "control",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "selected history row text2 on bg4 (12px)",
  "text2",
  "bg4",
  null,
  1.0,
  4.5
 ],
 [
  "partial lift on selected history row text2 on bg4 (12px)",
  "text2",
  "bg4",
  null,
  1.0,
  4.5
 ],
 [
  "radio caption text2 on bg4 (12px, pressed / checked+hover)",
  "text2",
  "bg4",
  null,
  1.0,
  4.5
 ],
 [
  "radio caption text3 on bg3 (12px, checked / hover)",
  "text3",
  "bg3",
  null,
  1.0,
  4.5
 ],
 [
  "unchecked ring text3 on bg3 (hovered radio)",
  "text3",
  "bg3",
  null,
  1.0,
  3.0
 ],
 [
  "unchecked ring text3 on bg4 (pressed radio)",
  "text3",
  "bg4",
  null,
  1.0,
  3.0
 ],
 [
  "slider knob and fill brand on modal",
  "brand",
  "modal",
  null,
  1.0,
  3.0
 ],
 [
  "checkbox fill brand on modal",
  "brand",
  "modal",
  null,
  1.0,
  3.0
 ],
 [
  "filter chip text2 on modal",
  "text2",
  "modal",
  null,
  1.0,
  4.5
 ],
 [
  "segmented option text2 on bg2",
  "text2",
  "bg2",
  null,
  1.0,
  4.5
 ],
 [
  "category and project icon text2 on bg3",
  "text2",
  "bg3",
  null,
  1.0,
  3.0
 ],
 [
  "install hint text3 on panel (11px)",
  "text3",
  "panel",
  null,
  1.0,
  4.5
 ],
 [
  "installed mark good on panel (14px icon)",
  "good",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "person tile text3 on bg2 (hover)",
  "text3",
  "bg2",
  null,
  1.0,
  4.5
 ],
 [
  "onboarding title text1 on chrome",
  "text1",
  "chrome",
  null,
  1.0,
  4.5
 ],
 [
  "onboarding paragraph text3 on chrome",
  "text3",
  "chrome",
  null,
  1.0,
  4.5
 ],
 [
  "onboarding copy text2 on chrome",
  "text2",
  "chrome",
  null,
  1.0,
  4.5
 ],
 [
  "step map done brand on chrome",
  "brand",
  "chrome",
  null,
  1.0,
  3.0
 ],
 [
  "step map to-come control on chrome",
  "control",
  "chrome",
  null,
  1.0,
  3.0
 ],
 [
  "step map skipped text3 on chrome",
  "text3",
  "chrome",
  null,
  1.0,
  3.0
 ],
 [
  "progress glyph good on panel",
  "good",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "progress glyph bad on panel",
  "bad",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "progress glyph brand on panel",
  "brand",
  "panel",
  null,
  1.0,
  3.0
 ],
 [
  "progress text1 on panel",
  "text1",
  "panel",
  null,
  1.0,
  4.5
 ],
 [
  "progress bar brand on bad tint (failed track)",
  "brand",
  "bad",
  "panel",
  0.12,
  3.0
 ],
 [
  "done tile check good on bg3",
  "good",
  "bg3",
  null,
  1.0,
  3.0
 ],
 [
  "selected theme card brand disc on bg3",
  "brand",
  "bg3",
  null,
  1.0,
  3.0
 ],
 [
  "later list text1 on bg2 (on panel)",
  "text1",
  "bg2",
  null,
  1.0,
  4.5
 ],
 [
  "theme card label text1 on bg3",
  "text1",
  "bg3",
  null,
  1.0,
  4.5
 ],
 [
  "search result text1 on bg3 (hovered row on modal)",
  "text1",
  "bg3",
  null,
  1.0,
  4.5
 ]
];
const css=readFileSync('src/styles/tokens.css','utf8');
function rgb(hex:string):number[]{if(!/^#[a-f\d]{6}$/i.test(hex))throw new Error('Expected RGB token: '+hex);return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);}
function luminance(rgb:number[]):number{return rgb.map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*([0.2126,0.7152,0.0722][i]??0),0);}
for(const theme of ['dark','light']){
 const block=css.split('}').find(block=>block.includes(theme==='dark'?':root':'data-theme="light"'));
 if(!block)throw new Error('Missing token palette '+theme);
 const tokens=Object.fromEntries([...block.matchAll(/--tk-([\w]+):\s*(#[a-f\d]{6});/gi)].map(m=>[m[1],m[2]]));
 const color=(key:string)=>rgb(key.startsWith('#')?key:tokens[key]??'missing '+key);
 it.each(pairs)(theme+' %s',(label,fg,bg,over,alpha,floor)=>{
  const back=color(bg),under=over?color(over):null;
  const a=luminance(color(fg)),b=luminance(under?back.map((c,i)=>c*alpha+(under[i]??0)*(1-alpha)):back);
  expect((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),label).toBeGreaterThanOrEqual(floor);
 });
}
