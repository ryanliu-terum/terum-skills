import type { Frame, PromptQuestion, Result, Run } from './types';
import { PromptCancelledError } from './types';
import { scriptedPrompter } from './prompter';
/** Consume replayable frames and answer every prompt before waiting for completion. */
export async function driveRun<T>(run:Run<T>,answers:Record<string,string|boolean>,onUnexpected:(question:PromptQuestion)=>Promise<string|boolean>,onPrint?:(line:string)=>void,onProgress?:(frame:Extract<Frame,{t:'progress'}>)=>void,onAsk?:(question:PromptQuestion)=>void):Promise<Result<T>>{
 const prompter=scriptedPrompter(answers,onUnexpected);
 try{
  for await(const frame of run.frames){
   if(frame.t==='print')onPrint?.(frame.line);
   if(frame.t==='progress')onProgress?.(frame);
   if(frame.t==='ask'){
    const question:PromptQuestion={kind:frame.kind,question:frame.question,...(frame.choices===undefined?{}:{choices:frame.choices}),...(frame.default===undefined?{}:{default:frame.default}),...(frame.detail===undefined?{}:{detail:frame.detail}),...(frame.descriptions===undefined?{}:{descriptions:frame.descriptions})};
    onAsk?.(question);
    const options = [{ ...(frame.detail===undefined?{}:{detail:frame.detail}), ...(frame.descriptions===undefined?{}:{descriptions:frame.descriptions}), ...(frame.default===undefined?{}:{default:frame.default}) }];
    const value=frame.kind==='confirm'?await prompter.confirm(frame.question,options[0]):frame.kind==='select'?await prompter.select(frame.question,frame.choices??[],options[0]):await prompter.text(frame.question,frame.default,options[0]);
    run.answer(frame.id,value);
   }
  }
  return await run.done;
 }catch(error){await run.cancel();return error instanceof PromptCancelledError ? {ok:false,error:'Setup was cancelled.',cancelled:true} : {ok:false,error:error instanceof Error?error.message:'Operation failed.'};}
}
