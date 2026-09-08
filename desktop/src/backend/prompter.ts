import type { PromptQuestion, Prompter } from './types';
export type Question=PromptQuestion;
export interface ScriptedPrompter extends Prompter {readonly lines:readonly string[]}
export function scriptedPrompter(answers:Record<string,boolean|string>,onUnexpected:(q:Question)=>Promise<boolean|string>):ScriptedPrompter {
 const lines:string[]=[];
 async function answer(q:Question):Promise<boolean|string>{
  let value=Object.hasOwn(answers,q.question)?answers[q.question]:undefined;
  const valid=(v:unknown)=>q.kind==='confirm'?typeof v==='boolean':typeof v==='string'&&(q.kind!=='select'||!!q.choices?.includes(v));
  if(!valid(value))value=await onUnexpected(q);
  if(!valid(value))throw new Error('Invalid answer to: '+q.question);
  return value as boolean|string;
 }
 return {interactive:true,lines,confirm:async question=>(await answer({kind:'confirm',question}))===true,text:async(question,defaultValue)=>String(await answer({kind:'text',question,...(defaultValue===undefined?{}:{default:defaultValue})})),select:async(question,choices)=>String(await answer({kind:'select',question,choices})),print:line=>{lines.push(line);}};
}
