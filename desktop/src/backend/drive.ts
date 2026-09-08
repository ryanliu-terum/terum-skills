import type { PromptQuestion, Result, Run } from './types';
import { scriptedPrompter } from './prompter';
/** Consume replayable frames and answer every prompt before waiting for completion. */
export async function driveRun<T>(run:Run<T>,answers:Record<string,string|boolean>,onUnexpected:(question:PromptQuestion)=>Promise<string|boolean>,onPrint?:(line:string)=>void):Promise<Result<T>>{
 const prompter=scriptedPrompter(answers,onUnexpected);
 try{
  for await(const frame of run.frames){
   if(frame.t==='print')onPrint?.(frame.line);
   if(frame.t==='ask'){
    const value=frame.kind==='confirm'?await prompter.confirm(frame.question):frame.kind==='select'?await prompter.select(frame.question,frame.choices??[]):await prompter.text(frame.question,frame.default);
    run.answer(frame.id,value);
   }
  }
  return await run.done;
 }catch(error){await run.cancel();return {ok:false,error:error instanceof Error?error.message:'Operation failed.'};}
}
