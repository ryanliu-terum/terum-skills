import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Backend } from './Backend';
import { createMockBackend } from './mock';
import { isNativeShell } from './tauri/detect';
import { createTauriBackend } from './tauri';
export { readScenario as mockScenario } from './mock/scenario';
// Inside the Tauri shell the real adapter drives the CLI; in a browser (dev, gates, fidelity) the mock renders every board.
const backend=isNativeShell()?createTauriBackend():createMockBackend();
export function pickBackend():Backend{return backend;}
export const BackendContext=createContext<Backend>(backend);
export function useBackend():Backend{return useContext(BackendContext);}

import { scriptedPrompter } from './prompter';
import type { ScriptedPrompter } from './prompter';
import type { PromptQuestion } from './types';
export const PrintContext=createContext<(line:string)=>void>(()=>{});
export const PromptContext=createContext<(question:PromptQuestion)=>Promise<string|boolean>>(async()=>{throw new Error('Prompt provider unavailable.');});
export function usePrompter(answers:Record<string,string|boolean>):ScriptedPrompter{return scriptedPrompter(answers,useContext(PromptContext));}

export function useFeatures(){const backend=useBackend();return useQuery({queryKey:['features'],queryFn:()=>backend.features()}).data;}
export function useCapabilities(){const backend=useBackend();return useQuery({queryKey:['capabilities'],queryFn:()=>backend.capabilities()}).data;}

export { githubUrl } from './paths';
export { cloneStateCopy } from './mock/derive';
export { driveRun } from './drive';
export { selectedInboxId, defaultInboxId } from './mock/data';

export function usePreference<T>(key:string,fallback:T):T {
 const {prefs}=useBackend();
 const json=useSyncExternalStore(listener=>prefs.subscribe?.(listener)??(()=>{}),()=>JSON.stringify(prefs.get(key,fallback)));
 return JSON.parse(json) as T;
}

export { setupSession, existingSetupSession, activeSetupSession, SETUP_STEP_TO_BOARD } from './setup-session';
export function useLaunchContext(){const backend=useBackend();return useQuery({queryKey:['launch-context'],queryFn:async()=>{await backend.prefs.ready;return backend.launchContext();},staleTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false});}
