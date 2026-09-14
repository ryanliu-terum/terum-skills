import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeBridge } from './fake-bridge';
import { underFakeHome } from './recording';

export function shareSettingsReplay(change?: (frame: Record<string, unknown>, name: string) => void) {
 return fakeBridge((args, emit) => {
  // The recorded hello advertises `refresh`, so the adapter runs one background fetch behind every board in this
  // file. This batch recorded no `sync` and needs none — the verb touches nothing these boards read — but it must
  // still answer the way the shipping CLI does: left to fall through, it would read a `sync.jsonl` that does not
  // exist, and the adapter would republish the stamp-driven boards over a failure that is this fixture's, not the app's.
  if (args[0] === 'sync') { emit({kind:'stdout', line:JSON.stringify({t:'result',verb:'sync',ok:true,exitCode:0,value:{changed:false,notices:[],teams:[]}})}); return; }
  const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : 'ls' : args[0]!;
  for (const line of underFakeHome(readFileSync(resolve('../.planning/codex-runs/mock-vs-real-2026-09-09/frames', name + '.jsonl'), 'utf8').trim().split('\n'))) {
   const frame = JSON.parse(line) as Record<string, unknown>;
   if (frame.t === 'result' && name === 'status') {
    delete ((frame.value as {ledger?:Record<string,unknown>}).ledger?.shared);
   }
   if (frame.t === 'result' && name === 'ls-local') {
    for (const section of (frame.value as {local?:{rows?:Record<string,unknown>[]}[]}).local ?? []) {
     for (const row of section.rows ?? []) { delete row.shared; delete row.connected; }
    }
   }
   change?.(frame, name);
   emit({kind:'stdout', line:JSON.stringify(frame)});
  }
 });
}
export interface LocalValue {
 local: {rows: {name:string;path:string;tracked:boolean;placement:{id:string;team:string;version:string|null}|null;health:string;placed?:boolean}[]}[];
 skills: {id:string;name:string;grantsHash:string|null;grants:string|null}[];
}
export interface StatusValue {
 teams: {clone:Record<string,unknown>;readable:boolean;team:string;memberCount:number|null}[];
 ledger: {placements:{path:string;version:string|null}[];approvals:unknown[]};
}
