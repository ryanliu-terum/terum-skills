import { createContext, useContext } from 'react';
import type { MachineUninstallResult, Result } from '../backend/types';

export type RemovalPhase = 'reading'|'asking'|'removing'|'done'|'failed'|'cancelled'|'refused';
export type RemovalState = { phase:RemovalPhase; question?:string; detail:string[]; lines:string[]; result?:Result<MachineUninstallResult> };
export type MachineRemovalApi = { current:RemovalState|null; notice:string|null; start():void; answer(v:boolean):void; dismiss():void };
export const MachineRemovalContext=createContext<MachineRemovalApi>({current:null,notice:null,start:()=>{},answer:()=>{},dismiss:()=>{}});
export function useMachineRemoval(){return useContext(MachineRemovalContext);}
