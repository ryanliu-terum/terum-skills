import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeBridge } from './fake-bridge';

export function detailRecording(name: string): string[] {
  return readFileSync(resolve('../.planning/codex-runs/mock-vs-real-2026-09-09/frames', name + '.jsonl'), 'utf8').trim().split('\n');
}
export type AmendResult = (name: string, value: Record<string, unknown>, frame: Record<string, unknown>) => void;
export function detailReplay(amend?: AmendResult) {
  return fakeBridge((args, emit) => {
    const verb = args[0];
    if (verb === 'install' || verb === 'uninstall-skill') {
      emit({kind:'stdout', line:detailRecording('status')[0]!});
      // The supplied recordings contain reads only; mutation envelopes follow the CLI contracts.
      emit({kind:'stdout', line:JSON.stringify({t:'result',verb,ok:true,exitCode:0,value:[{id:args.at(-1),team:'acme',removed:1}]})});
      return;
    }
    const name = verb === 'status' ? args.includes('--team') ? 'status-team' : 'status'
      : verb === 'ls' ? args.includes('--local') ? 'ls-local' : args[1] === 'project' ? `ls-project-${args[2]}` : args[1] === 'member' ? `ls-member-${args.at(-1)}` : 'ls'
      : verb === 'validate' || verb === 'eval-report' ? `${verb}-${args.at(-1)}` : verb!;
    for (const line of detailRecording(name)) {
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame.t === 'result' && amend) {
        amend(name, frame.value as Record<string, unknown>, frame);
        emit({kind:'stdout',line:JSON.stringify(frame)});
      } else emit({kind:'stdout',line});
    }
  });
}
