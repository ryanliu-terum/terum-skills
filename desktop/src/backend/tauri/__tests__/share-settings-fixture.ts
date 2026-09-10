import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeBridge } from './fake-bridge';

export function shareSettingsReplay(change?: (frame: Record<string, unknown>, name: string) => void) {
 return fakeBridge((args, emit) => {
  const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : 'ls' : args[0]!;
  for (const line of readFileSync(resolve('../.planning/codex-runs/mock-vs-real-2026-09-09/frames', name + '.jsonl'), 'utf8').trim().split('\n')) {
   const frame = JSON.parse(line) as Record<string, unknown>;
   change?.(frame, name);
   emit({kind:'stdout', line:JSON.stringify(frame)});
  }
 });
}
export interface LocalValue {
 local: {rows: {name:string;path:string;tracked:boolean;connected?:boolean;shared:{id:string;team:string}[];placement:{id:string;team:string;version:string|null}|null;health:string;placed?:boolean}[]}[];
 skills: {id:string;name:string;grantsHash:string|null;grants:string|null}[];
}
export interface StatusValue {
 teams: {clone:Record<string,unknown>;readable:boolean;team:string;memberCount:number|null}[];
 ledger: {placements:{path:string;version:string|null}[];shared:{id:string;source:string;team:string}[];approvals:unknown[]};
}
