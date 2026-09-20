import type { FormAnswer, PromptAnswer, PromptQuestion, Prompter } from './types';
export type Question=PromptQuestion;
export interface ScriptedPrompter extends Prompter {readonly lines:readonly string[]}
/** An object of string and boolean answers, or null (Skip): the two shapes a form ask accepts. */
export function isFormAnswer(value:unknown):value is FormAnswer{return value===null||(typeof value==='object'&&!Array.isArray(value)&&Object.values(value as Record<string,unknown>).every(entry=>typeof entry==='string'||typeof entry==='boolean'));}
export function scriptedPrompter(answers:Record<string,PromptAnswer>,onUnexpected:(q:Question)=>Promise<PromptAnswer>):ScriptedPrompter {
 const lines:string[]=[];
 async function answer(q:Question):Promise<PromptAnswer>{
  let value=Object.hasOwn(answers,q.question)?answers[q.question]:undefined;
  const valid=(v:unknown)=>q.kind==='confirm'?typeof v==='boolean':q.kind==='form'?isFormAnswer(v):typeof v==='string'&&(q.kind!=='select'||!!q.choices?.includes(v));
  if(!valid(value))value=await onUnexpected(q);
  if(!valid(value))throw new Error('Invalid answer to: '+q.question);
  return value as PromptAnswer;
 }
 return {interactive:true,lines,confirm:async(question,options)=>(await answer({kind:'confirm',question,...(options?.detail?.length?{detail:options.detail}:{}),...(options?.descriptions?{descriptions:options.descriptions}:{}),...(options?.default===undefined?{}:{default:options.default})}))===true,text:async(question,defaultValue,options)=>{
  const offered=defaultValue??options?.default??'';
  const value=String(await answer({kind:'text',question,...(options?.detail?.length?{detail:options.detail}:{}),...(options?.descriptions?{descriptions:options.descriptions}:{}),...(options?.default===undefined?{}:{default:options.default}),...(defaultValue===undefined?{}:{default:defaultValue})}));
  // The terminal prompter resolves a blank answer to the offered default (src/lib/prompt.ts); the frames
  // channel promises the same contract, or a cleared field answers '' and setup resolves it against cwd.
  return value.trim()||offered;
 },select:async(question,choices,options)=>String(await answer({kind:'select',question,choices,...(options?.detail?.length?{detail:options.detail}:{}),...(options?.descriptions?{descriptions:options.descriptions}:{}),...(options?.default===undefined?{}:{default:options.default})})),
 // A form is keyed by its title; the pre-answer is the whole object (or null for Skip), never a string.
 form:async(title,fields,options)=>{const value=await answer({kind:'form',question:title,fields,...(options?.detail?.length?{detail:options.detail}:{}),...(options?.submit===undefined?{}:{submit:options.submit}),...(options?.skippable?{skippable:true}:{}),...(options?.skipLabel===undefined?{}:{skipLabel:options.skipLabel}),...(options?.errors&&Object.keys(options.errors).length?{errors:options.errors}:{})});return isFormAnswer(value)?value:null;},
 print:line=>{lines.push(line);}};
}
