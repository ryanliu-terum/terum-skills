import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { FRAME_VERBS } from '../frames.js';

/**
 * Every CLI child the desktop adapter spawns goes through one function — `run(argv, schema, …)` in
 * `desktop/src/backend/tauri/index.ts`, with `cached()` wrapping it for reads. The verb is the
 * leading run of string literals in `argv`.
 *
 * Nothing checks those literals against the verbs the CLI actually registers. When B1 folded
 * `refresh` into `sync`, the adapter kept spawning `run(['refresh'], …)`: the CLI answered with a
 * commander "unknown command" error on every launch and every window focus, and not one test went
 * red — the desktop suite fakes the bridge, and the CLI suite never sees desktop source. This is the
 * one class of the four that shipped.
 *
 * The rule: the longest leading operand prefix of each spawned argv must be a verb in `FRAME_VERBS`
 * — the same longest-prefix rule `attemptedVerb()` uses to name a verb on the CLI side.
 *
 * Like [the feature-key tripwire](./feature-keys-tripwire.test.ts) this reads the desktop source as
 * TEXT rather than importing it: `desktop/` is a browser bundle behind its own tsconfig, and reading
 * the source is the pattern every cross-tree pin in this repo already uses. It lives in the root
 * suite because root gates run on every batch, and the break is usually a CLI-side verb change made
 * without opening the desktop tree.
 */

const adapter = new URL('../../../desktop/src/backend/tauri/index.ts', import.meta.url);

/**
 * The leading string literals of every `run([…])` / `cached([…])` argv. Matching only the opening run
 * of quoted literals stops naturally at the first spread or expression (`...(team ? ['--team', …])`),
 * which is exactly where the verb prefix ends — so no bracket matching is needed.
 */
function spawnedArgvs(source: string): string[][] {
  return [...source.matchAll(/\b(?:run|cached)\(\s*\[\s*((?:'[^']*'\s*,\s*)*'[^']*')/g)]
    .map(match => [...match[1]!.matchAll(/'([^']*)'/g)].map(literal => literal[1]!));
}

/** The longest leading prefix that names a verb — `attemptedVerb()`'s rule, applied to source text. */
function verbPrefix(argv: string[]): string | null {
  let prefix = '';
  let verb: string | null = null;
  for (const operand of argv) {
    if (operand.startsWith('-')) break;
    prefix = prefix ? `${prefix} ${operand}` : operand;
    if ((FRAME_VERBS as readonly string[]).includes(prefix)) verb = prefix;
  }
  return verb;
}

it('every verb the desktop adapter spawns is one the CLI actually registers', () => {
  const argvs = spawnedArgvs(readFileSync(adapter, 'utf8'));
  // A regex that quietly matched nothing would make the check pass vacuously.
  expect(argvs.length).toBeGreaterThan(15);
  const unregistered = argvs.filter(argv => verbPrefix(argv) === null).map(argv => argv.join(' '));
  expect(unregistered).toEqual([]);
});
