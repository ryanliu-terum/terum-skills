import { createContext, useContext } from 'react';
import type { EvalResult, Result, Run } from '../backend/types';
export interface EvalRunState { ref:string;name:string;team:string|undefined;run:Run<EvalResult>;lines:string[];startedAt:number;state:'running'|'done'|'failed'|'stopped';result?:Result<EvalResult>;commit:boolean }
export interface EvalRunApi {
 current:EvalRunState|null;dialogOpen:boolean;
 start(args:{ref:string;name:string;team?:string;commit:boolean}):void;
 stop():Promise<void>;dismiss():void;show():void;
}
export const EvalRunContext=createContext<EvalRunApi>({current:null,dialogOpen:false,start:()=>{},stop:async()=>{},dismiss:()=>{},show:()=>{}});
export function useEvalRun(){return useContext(EvalRunContext);}
