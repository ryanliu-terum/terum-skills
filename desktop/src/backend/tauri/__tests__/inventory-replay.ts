import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeBridge } from './fake-bridge';

export function marketplaceRecorded(name: string): string[] {
  return readFileSync(resolve('../.planning/codex-runs/mock-vs-real-2026-09-09/frames', name + '.jsonl'), 'utf8').trim().split('\n');
}
export function inventoryReplay(recorded: (name: string) => string[] = marketplaceRecorded) {
  return fakeBridge((args, emit) => {
    const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : args[1] === 'project' ? `ls-project-${args[2]}` : args[1] === 'member' ? `ls-member-${args.at(-1)}` : 'ls' : args[0] === 'validate' ? 'validate-deploy-check' : args[0]!;
    for (const line of recorded(name)) emit({ kind: 'stdout', line });
  });
}
