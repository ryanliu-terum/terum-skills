import type { EvalQueueItem, EvalQueueResult } from '../backend/eval-queue';
import { createContext, useContext } from 'react';
import type { EvalManyArgs, EvalManyResult, EvalResult, Result, Run, Frame } from '../backend/types';
export type EvalRunValue = EvalResult | EvalQueueResult | EvalManyResult;
/** `queue` marks an overnight drain, `many` a several-skills request (its arguments name the run); neither reads a skill detail. */
export interface EvalRunState { ref:string;name:string;team:string|undefined;queue?:boolean;many?:EvalManyArgs;/** IE6: the rival's name, set only for a head-to-head run. */vs?:string;run:Run<EvalRunValue>;lines:string[];startedAt:number;state:'running'|'done'|'failed'|'stopped';result?:Result<EvalRunValue>;progress?:Extract<Frame,{t:'progress'}> }
export interface EvalRunApi {
 current:EvalRunState|null;dialogOpen:boolean;
 /** IE6: `vs` + `brief` make it a head-to-head. The brief must already be reviewed — the app
  * derives it first and shows it, because a spawned CLI cannot ask the human itself. */
 start(args:{ref:string;name:string;team?:string;vs?:string;brief?:string}):void;
 /** Several skills at once, or every pending one; throws while another eval is running, like `start`. */
 startMany?(args:EvalManyArgs):void;
 isRunning?():boolean;
 startQueued?(item:EvalQueueItem):Promise<Result<EvalQueueResult>>;
 stop():Promise<void>;
 /** Closes the run's dialog and nothing else: a settled run keeps its top-bar chip until `clear` (UI policy §5). */
 dismiss():void;
 /** Forgets a settled run (the chip's ✕). A running run is never cleared; Stop is the only way out of one. */
 clear():void;
 show():void;
}
export const EvalRunContext=createContext<EvalRunApi>({current:null,dialogOpen:false,start:()=>{},stop:async()=>{},dismiss:()=>{},clear:()=>{},show:()=>{}});
export function useEvalRun(){return useContext(EvalRunContext);}
