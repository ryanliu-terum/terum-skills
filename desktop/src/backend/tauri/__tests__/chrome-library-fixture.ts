import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { fakeBridge } from './fake-bridge';
import { seedCheckout as recordedSeedCheckout } from './recording';

// The recorded 0.1.7 `ls --local` shape: only the keys a test may rewrite are typed; everything else passes through.
const section = z.object({root:z.string(),repoRoot:z.string().optional(),scope:z.string(),label:z.string().optional(),rootState:z.string().optional(),counts:z.object({skillFolders:z.number(),connectable:z.number()}).passthrough().optional(),notOffered:z.array(z.object({}).passthrough()).optional(),rows:z.array(z.object({}).passthrough())}).passthrough();
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
/** Replays the S7g recording as re-recorded on 2026-09-13: team `acme`, one placed global row `deploy-check`, and — §7.2, `ls --local` lists registered checkouts only and the fixture registers none — no project section. Tests that exercise a checkout append one with `seedCheckout`. */
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
/** The seed checkout the derived S7g frames used to carry (the recording machine's cwd), appended in the shape the CLI records for a registered checkout (recording.ts); returned so a test can shape it. */
export function seedCheckout(value:LocalRecording,rootState:'scanned'|'absent'|'unreadable'='absent'):LocalRecording['local'][number] {
 const section=recordedSeedCheckout('/Users/teddy',rootState);
 value.local.push(section);
 return section;
}
/** Moves the recording's global root under the fake bridge's home (`/Users/teddy`) so abbreviation is observable, and appends the seed checkout there. */
export function underHome(value:LocalRecording, projectState?:'scanned'|'absent'|'unreadable'):void {
 const [global]=value.local;
 if(!global||value.local.length!==1)throw new Error('Expected the recorded global section alone');
 global.root='/Users/teddy/.claude/skills';global.rootState='scanned';
 seedCheckout(value,projectState??'scanned');
}
