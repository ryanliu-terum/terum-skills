import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeBridge } from './fake-bridge';

export function installedReplay(local = 'on-disk-only', member = 'none', change?: (frame: Record<string, unknown>) => void, changeStatus?: (frame: Record<string, unknown>) => void) {
 return fakeBridge((args, emit) => {
  if(args[0] === 'validate') { emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'validate',ok:true,exitCode:0,value:{name:'deploy-check',findings:0,warnings:0}})});return; }
  const scan = args.includes('--local');
  const person = args[0] === 'ls' && args[1] === 'member';
  if(args[0] === 'install') { emit({kind:'stdout',line:JSON.stringify({t:'result',verb:'install',ok:true,exitCode:0,value:[]})});return; }
  const file = scan ? `installed-state/frames/ls-local-${local}` : person ? `installed-state/frames/ls-member-${member}` : `m7-S7b/frames/${args[0]}`;
  // §8.4 deleted the per-member read, so the member's installs arrive on the TEAM read's `people[]`
  // limb. The recorded per-member capture is still the source of truth for what they are — it is the
  // real CLI output — it just reaches the adapter by the route the CLI uses now.
  const memberInstalls = (): Record<string, unknown>[] => {
   const source = readFileSync(resolve('../.planning/codex-runs', `installed-state/frames/ls-member-${member}.jsonl`), 'utf8').trim().split('\n');
   for(const line of source) {
    const frame = JSON.parse(line) as { t?: string; value?: { member?: { installed?: Record<string, unknown>[] } } };
    if(frame.t === 'result') return frame.value?.member?.installed ?? [];
   }
   return [];
  };
  for(const line of readFileSync(resolve('../.planning/codex-runs',file+'.jsonl'),'utf8').trim().split('\n')) {
   const frame = JSON.parse(line) as Record<string, unknown>;
   if(frame.t==='hello') (frame.features as Record<string,boolean>).localIdentity=true;
   if(frame.t==='result' && !scan && !person && args[0]==='ls') {
    const people = (frame.value as { people?: { handle: string; installed: unknown[] }[] }).people;
    const mira = people?.find(entry => entry.handle === 'mira');
    if(mira) mira.installed = memberInstalls();
   }
   if(scan)change?.(frame);
   if(args[0] === 'status')changeStatus?.(frame);
   emit({kind:'stdout',line:JSON.stringify(frame)});
  }
 });
}
