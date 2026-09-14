import type { EvalQueueItem, EvalQueueResult } from '../backend/eval-queue';
import { createContext, useContext } from 'react';
import type { EvalManyArgs, EvalManyResult, EvalResult, Result, Run, Frame } from '../backend/types';
export type EvalRunValue = EvalResult | EvalQueueResult | EvalManyResult;
/** `queue` marks an overnight drain, `many` a several-skills request (its arguments name the run); neither reads a skill detail. */
export interface EvalRunState { ref:string;name:string;team:string|undefined;queue?:boolean;many?:EvalManyArgs;run:Run<EvalRunValue>;lines:string[];startedAt:number;state:'running'|'done'|'failed'|'stopped';result?:Result<EvalRunValue>;progress?:Extract<Frame,{t:'progress'}> }
export interface EvalRunApi {
 current:EvalRunState|null;dialogOpen:boolean;
 start(args:{ref:string;name:string;team?:string}):void;
 /** Several skills at once, or every pending one; throws while another eval is running, like `start`. */
 startMany?(args:EvalManyArgs):void;
 isRunning?():boolean;
 startQueued?(item:EvalQueueItem):Promise<Result<EvalQueueResult>>;
 stop():Promise<void>;dismiss():void;show():void;
}
export const EvalRunContext=createContext<EvalRunApi>({current:null,dialogOpen:false,start:()=>{},stop:async()=>{},dismiss:()=>{},show:()=>{}});
export function useEvalRun(){return useContext(EvalRunContext);}
