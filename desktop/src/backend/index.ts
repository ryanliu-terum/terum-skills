import { createContext, useContext } from 'react';
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
export const PromptContext=createContext<(question:PromptQuestion)=>Promise<string|boolean>>(async()=>{throw new Error('Prompt provider unavailable.');});
export function usePrompter(answers:Record<string,string|boolean>):ScriptedPrompter{return scriptedPrompter(answers,useContext(PromptContext));}

export { driveRun } from './drive';
export { selectedInboxId, defaultInboxId } from './mock/data';
