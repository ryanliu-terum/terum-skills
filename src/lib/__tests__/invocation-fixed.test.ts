import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { pushGuardHook } from '../teamRepo.js';
import { temporaryDirectory } from './fixtures.js';

it('keeps both push guard warnings fixed npx and executes the missing-launcher recovery with exit zero', async () => {
  const root = await temporaryDirectory(); const entry = join(root, 'launcher/index.js');
  await mkdir(join(root, 'launcher')); await writeFile(entry, 'throw new Error("must not execute")');
  const launcher = { node: process.execPath, entry };
  const warning = 'Re-run `npx -y terum-skills@latest team join <remote>` to re-arm it.';
  expect(pushGuardHook(null)).toContain(warning);
  const hook = pushGuardHook(launcher); expect(hook).toContain(warning);
  await writeFile(join(root, 'pre-push'), hook); await rm(entry);
  const result = await promisify(execFile)('/bin/sh', [join(root, 'pre-push')]);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`terum-skills push guard: ${entry} is gone, so this push was NOT checked. ${warning}\n`);
});
