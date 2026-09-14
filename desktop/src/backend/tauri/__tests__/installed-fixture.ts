import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeBridge } from './fake-bridge';
import { underFakeHome } from './recording';

/** installed-state's scans and m7-S7b's team reads, each moved under the fake home (recording.ts) so the S7b ledger placement and the installed-state row name the same folder, as they did on the machine they describe. */
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
  for(const line of underFakeHome(readFileSync(resolve('../.planning/codex-runs',file+'.jsonl'),'utf8').trim().split('\n'))) {
   const frame = JSON.parse(line) as Record<string, unknown>;
   if(frame.t==='hello') (frame.features as Record<string,boolean>).localIdentity=true;
   if(frame.t==='result' && !scan && !person && args[0]==='ls') {
    const value = frame.value as { people?: { handle: string; installed: unknown[]; profile: unknown[] }[]; skills?: { id: string; name: string; latest?: string | null }[] };
    const mira = value.people?.find(entry => entry.handle === 'mira');
    if(mira) {
     const installs = memberInstalls();
     mira.installed = installs;
     // §8.5 (amended 2026-09-13): the person page and `install member` both read `profile[]`, so the
     // recorded member list has to arrive as one. Projecting it from the SAME recorded installs is what
     // the machine this recording describes actually looks like — install offers the profile on every
     // placement (§9.1) and this member accepted. The one field the recording cannot supply is the
     // curated version, which comes from the frame's own skill row rather than being invented.
     mira.profile = installs.map(entry => {
      const skill = value.skills?.find(row => row.id === (entry as { id: string }).id);
      return { id: (entry as { id: string }).id, name: skill?.name ?? 'unknown', version: skill?.latest ?? 'v1', added: '2026-09-12', via: 'install' };
     });
    }
   }
   if(scan)change?.(frame);
   if(args[0] === 'status')changeStatus?.(frame);
   emit({kind:'stdout',line:JSON.stringify(frame)});
  }
 });
}
