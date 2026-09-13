import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeBridge } from './fake-bridge';
import { underFakeHome, withSeedCheckout } from './recording';

/** The mock-vs-real recording under the fake home (recording.ts), with the seed checkout its consumers exercise appended to `ls --local`. */
export function marketplaceRecorded(name: string): string[] {
  const lines = underFakeHome(readFileSync(resolve('../.planning/codex-runs/mock-vs-real-2026-09-09/frames', name + '.jsonl'), 'utf8').trim().split('\n'));
  return name === 'ls-local' ? withSeedCheckout(lines) : lines;
}
export function inventoryReplay(recorded: (name: string) => string[] = marketplaceRecorded) {
  return fakeBridge((args, emit) => {
    const name = args[0] === 'ls' ? args.includes('--local') ? 'ls-local' : args[1] === 'project' ? `ls-project-${args[2]}` : args[1] === 'member' ? `ls-member-${args.at(-1)}` : 'ls' : args[0] === 'validate' ? 'validate-deploy-check' : args[0]!;
    for (const line of recorded(name)) emit({ kind: 'stdout', line });
  });
}
