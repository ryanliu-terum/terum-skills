import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { fakeBridge } from './fake-bridge';

// The recorded 0.1.7 `ls --local` shape: only the keys a test may rewrite are typed; everything else passes through.
const section = z.object({root:z.string(),repoRoot:z.string().optional(),scope:z.string(),label:z.string().optional(),rootState:z.string().optional(),counts:z.object({skillFolders:z.number(),connectable:z.number()}).passthrough().optional(),rows:z.array(z.object({}).passthrough())}).passthrough();
const local = z.object({local:z.array(section)}).passthrough();
export type LocalRecording = z.infer<typeof local>;
export interface ReplayOptions {
 /** Rewrite the recorded `ls --local` value before it is replayed (roots, rootState, rows). */
 local?: (value:LocalRecording)=>void;
 /** Fail the `status` read with this error; every other verb still replays. */
 statusError?: string;
 /** Fail the `ls --local` read with this error; every other verb still replays. */
 localError?: string;
}
const framesDirectory = resolve('../.planning/codex-runs/m7-S7g/frames');
function frameName(args: readonly string[]): string {
 if (args[0] === 'ls') return args.includes('--local') ? 'ls-local' : args[1] === 'project' ? 'ls-project-terum' : args[1] === 'member' ? 'ls-member-mira' : 'ls';
 if (args[0] === 'validate') return 'validate-deploy-check';
 return args[0]!;
}
/** Replays the S7g recording (team `acme`, one placed global row `deploy-check`, an empty project section `seed`). */
export function chromeLibraryReplay(options:ReplayOptions={}) {
 return fakeBridge((args,emit)=>{
  const name=frameName(args);
  const lines=readFileSync(resolve(framesDirectory,name+'.jsonl'),'utf8').trim().split('\n');
  for(const line of lines){
   const frame=z.object({t:z.string(),value:z.unknown().optional()}).passthrough().parse(JSON.parse(line));
   if(frame.t==='result'){
    if(name==='ls-local'&&options.local){const value=local.parse(frame.value);options.local(value);frame.value=value;}
    const error=name==='status'?options.statusError:name==='ls-local'?options.localError:undefined;
    if(error)Object.assign(frame,{ok:false,error,exitCode:1,value:undefined});
   }
   emit({kind:'stdout',line:JSON.stringify(frame)});
  }
 });
}
/** Moves the recording's roots under the fake bridge's home (`/Users/teddy`) so abbreviation is observable. */
export function underHome(value:LocalRecording, projectState?:'scanned'|'absent'|'unreadable'):void {
 const [global,project]=value.local;
 if(!global||!project)throw new Error('Expected the recorded global and project sections');
 global.root='/Users/teddy/.claude/skills';global.rootState='scanned';
 project.root='/Users/teddy/code/seed/.claude/skills';project.repoRoot='/Users/teddy/code/seed';
 if(projectState)project.rootState=projectState;
}
