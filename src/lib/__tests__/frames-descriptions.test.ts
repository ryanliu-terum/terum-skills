import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import { frameChannel, type Frame } from '../frames.js';
it('carries select descriptions and estimate detail without changing question text',async()=>{
 const input=new PassThrough(),output=new PassThrough(),frames:Frame[]=[];
 output.on('data',(chunk:Buffer)=>{const frame=JSON.parse(chunk.toString()) as Frame;frames.push(frame);if(frame.t==='ask')input.write(JSON.stringify({t:'answer',id:frame.id,value:'Overnight'})+'\n');});
 const channel=frameChannel({input,output});
 expect(await channel.io.select('Evaluate them',['Now','Overnight'],'Overnight',{detail:['Estimate'],descriptions:['Run now','Run later']})).toBe('Overnight');
 expect(frames.find(frame=>frame.t==='ask')).toMatchObject({question:'Evaluate them',choices:['Now','Overnight'],default:'Overnight',detail:['Estimate'],descriptions:['Run now','Run later']});
 channel.result({verb:'setup',ok:true,exitCode:0});
});
