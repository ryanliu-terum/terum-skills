import { TERUM_MARK_HTML } from '../terum-mark';
import tokens from '../../../styles/tokens.css?raw';
import type { ShareCardModel, PassCount, ShareCardFormat } from './model';
import { chartMaximum } from './model';

const FONT='"Inter Variable", sans-serif';
/** Wrap without dropping content; the artboard grows to fit the measured lines. */
export function wrapText(ctx:CanvasRenderingContext2D,text:string,width:number):string[] {
 const words=text.replace(/\s+/g,' ').trim().split(' '),lines:string[]=[];let line='';
 for(const word of words){
  if(ctx.measureText(line?line+' '+word:word).width<=width){line=line?line+' '+word:word;continue;}
  if(line){lines.push(line);line='';}
  for(const ch of word){if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line='';}line+=ch;}
 }
 if(line)lines.push(line);
 return lines;
}
/** One measured layout drives both export and preview. No screenshots, remote fonts or generated copy. */
export async function renderShareCard(model:ShareCardModel,{format='light'}:{format?:ShareCardFormat}={}):Promise<Blob> {
 const horizontal=format.startsWith('horizontal');let width=horizontal?900:540;
 const palette=format.endsWith('dark')?tokens.split(':root[data-theme="light"]')[0]:tokens.split(':root[data-theme="light"]')[1];
 const color=(name:string):string=>{
  const value=palette?.match(new RegExp(`--tk-${name}:\\s*([^;]+);`))?.[1]?.trim();
  if(!value)throw new Error(`Missing share-card color: ${name}`);
  return value;
 };
 await document.fonts.load(`590 33px ${FONT}`);await document.fonts.ready;
 if(!document.fonts.check(`590 33px ${FONT}`))throw new Error('The card font could not be loaded. Try again.');
 const canvas=document.createElement('canvas');
 // The card paints its entire background; an opaque surface exports a standard RGB PNG.
 const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('PNG rendering is unavailable.');
 const lines=(value:string,size:number,available:number,weight=400)=>{ctx.font=`${weight} ${size}px ${FONT}`;return wrapText(ctx,value,available);};
 const layout=(artWidth:number)=>{
  const identityWidth=horizontal?Math.floor((artWidth-84)*.38):476;
  const reference=lines(model.reference,11,identityWidth),names=lines(model.name,33,identityWidth,590);
  const author=lines(model.author?'by '+model.author:'Author unavailable',11,identityWidth-25),description=lines(model.description,14,identityWidth);
  const nameY=79+reference.length*16+23,authorY=nameY+Math.max(0,names.length-1)*40+28;
  const descY=authorY+Math.max(0,author.length-1)*16+26,identityEnd=descY+Math.max(0,description.length-1)*22;
  const summaryY=identityEnd+36,status=lines(model.status??'',11,identityWidth);
  const summaryEnd=summaryY+78+(status.length?12+status.length*16:0);
  const graphX=horizontal?identityWidth+80:32,graphWidth=artWidth-32-graphX;
  const passesY=horizontal?82:summaryY,chartsY=horizontal?176:summaryEnd+22;
  const height=Math.max(summaryEnd+32,chartsY+98+80+32);
  return {identityWidth,reference,names,author,description,nameY,authorY,descY,identityEnd,summaryY,status,graphX,graphWidth,passesY,chartsY,height};
 };
 let measured=layout(width);
 // Long content expands the landscape artboard in both dimensions, retaining its orientation.
 while(horizontal&&width/measured.height<1.8&&width<8000){width+=200;measured=layout(width);}
 const {identityWidth,reference,names,author,description,nameY,authorY,descY,identityEnd,summaryY,status,graphX,graphWidth,passesY,chartsY,height}=measured;
 // Canvas has browser-specific limits. Fail explicitly before any partially drawn export escapes.
 if(height*2>16384||width*height*4>32_000_000)throw new Error('This skill has too much text for one PNG. Shorten its description and try again.');
 canvas.width=width*2;canvas.height=height*2;ctx.scale(2,2);
 const text=(value:string,x:number,y:number,size=11,ink='text1',weight=400)=>{ctx.font=`${weight} ${size}px ${FONT}`;ctx.fillStyle=color(ink);ctx.fillText(value,x,y);};
 const textLines=(items:string[],x:number,y:number,size:number,leading:number,ink='text1',weight=400)=>items.forEach((value,i)=>text(value,x,y+i*leading,size,ink,weight));
 const box=(x:number,y:number,w:number,h:number,ink:string,r=3)=>{ctx.fillStyle=color(ink);ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();};
 const rule=(x:number,y:number,x2:number,y2=y)=>{ctx.strokeStyle=color('border1');ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();};
 box(0,0,width,height,'chrome',0);box(12,12,width-24,height-24,'panel',8);
 ctx.strokeStyle=color('border1');ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(12.5,12.5,width-25,height-25,8);ctx.stroke();
 ctx.save();ctx.translate(32,28);ctx.scale(22/200,22/200);ctx.translate(-2190,-1925);ctx.fillStyle=color('text1');
 const mark=new DOMParser().parseFromString('<svg>'+TERUM_MARK_HTML+'</svg>','image/svg+xml');
 for(const path of mark.querySelectorAll('path'))ctx.fill(new Path2D(path.getAttribute('d')??''));
 ctx.strokeStyle=color('text1');ctx.lineWidth=2;ctx.beginPath();ctx.arc(2289.98,2025.81,92.07,0,Math.PI*2);ctx.stroke();ctx.restore();
 text('terum skills',62,43,13,'text1',590);ctx.textAlign='right';text('Benchmark',width-32,43,10,'text3');ctx.textAlign='left';
 textLines(reference,32,79,11,16,'text3');
 textLines(names,32,nameY,33,40,'text1',590);
 box(32,authorY-13,18,18,'brand',9);text(model.initials.slice(0,2),35,authorY,8,'onfill',500);
 textLines(author,57,authorY,11,16,'text3');
 textLines(description,32,descY,14,22,'text2');
 if(horizontal)rule(graphX-25,72,graphX-25,height-32);else rule(32,identityEnd+18,width-32);
 const summary=model.summary,partial=!!summary?.partial;
 const ink=partial||!summary?'text3':summary.verdict==='PASS'?'good':summary.verdict==='FAIL'?'bad':'text3';
 const lift=summary&&!partial?(summary.lift>0?'+':'')+summary.lift+'%':'—';
 // Preserve every digit while keeping exceptional lifts inside their allocated column.
 let liftSize=32;ctx.font=`590 ${liftSize}px ${FONT}`;
 while(ctx.measureText(lift).width>(horizontal?identityWidth:120)&&liftSize>10){liftSize--;ctx.font=`590 ${liftSize}px ${FONT}`;}
 text(lift,32,summaryY+28,liftSize,ink,590);
 const verdict=partial?'PARTIAL':summary?.verdict??'NO EVAL';
 box(32,summaryY+39,verdict.length*7+16,22,'bg3',4);text(verdict,40,summaryY+54,12,ink,590);
 text('Net lift vs. no skill',32,summaryY+76,10,'text3');
 textLines(status,32,summaryY+98,11,16,'text3');
 const passX=horizontal?graphX:172,passWidth=horizontal?graphWidth:336;
 text('Passed case-runs',passX,passesY+11,12,'text1',510);
 const passRow=(label:string,counts:PassCount|null,y:number,ink:string)=>{
  const value=counts?`${counts.passed} / ${counts.total}`:'—';
  ctx.font=`400 11px ${FONT}`;const valueWidth=Math.max(64,ctx.measureText(value).width+12);
  const start=passX+70,trackWidth=Math.max(10,passWidth-70-valueWidth);
  text(label,passX,y+9,11,'text3');ctx.textAlign='right';text(value,passX+passWidth,y+9,11);ctx.textAlign='left';
  if(!counts){box(start,y,trackWidth,10,'bg4',2);return;}
  if(counts.total>40){box(start,y,trackWidth,10,'bg4',2);if(counts.passed)box(start,y,trackWidth*counts.passed/counts.total,10,ink,2);return;}
  const gap=2,cell=(trackWidth-gap*(counts.total-1))/counts.total;
  for(let i=0;i<counts.total;i++)box(start+i*(cell+gap),y,cell,10,i<counts.passed?ink:'bg4',1);
 };
 passRow('With skill',model.candidate,passesY+24,'brand');passRow('No skill',model.baseline,passesY+46,'text3');
 model.metrics.forEach((metric,index)=>{
  const y=chartsY+index*98,maximum=chartMaximum(metric.candidate,metric.baseline,metric.unit);
  const valueText=(n:number|null)=>n===null?'—':metric.unit==='cost'?`$${n.toFixed(2)}`:`${Number(n.toFixed(2))} s`;
  text(metric.label,graphX,y+12,12,'text1',510);ctx.textAlign='right';text('Lower is better',graphX+graphWidth,y+12,10,'text3');ctx.textAlign='left';
  const trackX=graphX+102,trackWidth=graphWidth-194;
  for(const [i,label,value,ink] of [[0,'With skill',metric.candidate,'brand'],[1,'No skill',metric.baseline,'text3']] as const){
   const rowY=y+32+i*23;text(label,graphX,rowY+8,11,'text3');box(trackX,rowY,trackWidth,9,'bg4');
   if(value!==null&&value>0)box(trackX,rowY,trackWidth*value/maximum,9,ink);
   ctx.textAlign='right';text(valueText(value),graphX+graphWidth,rowY+8,11);ctx.textAlign='left';
  }
  text('0',trackX,y+80,9,'text3');ctx.textAlign='right';text(valueText(maximum),trackX+trackWidth,y+80,9,'text3');ctx.textAlign='left';
 });
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG generation failed. Try again.')),'image/png'));
}
