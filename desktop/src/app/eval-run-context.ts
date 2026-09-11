import type { EvalQueueItem, EvalQueueResult } from '../backend/eval-queue';
import { createContext, useContext } from 'react';
import type { EvalResult, Result, Run, Frame } from '../backend/types';
export type EvalRunValue = EvalResult | EvalQueueResult;
export interface EvalRunState { ref:string;name:string;team:string|undefined;queue?:boolean;run:Run<EvalRunValue>;lines:string[];startedAt:number;state:'running'|'done'|'failed'|'stopped';result?:Result<EvalRunValue>;progress?:Extract<Frame,{t:'progress'}> }
export interface EvalRunApi {
 current:EvalRunState|null;dialogOpen:boolean;
 start(args:{ref:string;name:string;team?:string}):void;
 isRunning?():boolean;
 startQueued?(item:EvalQueueItem):Promise<Result<EvalQueueResult>>;
 stop():Promise<void>;dismiss():void;show():void;
}
export const EvalRunContext=createContext<EvalRunApi>({current:null,dialogOpen:false,start:()=>{},stop:async()=>{},dismiss:()=>{},show:()=>{}});
export function useEvalRun(){return useContext(EvalRunContext);}
