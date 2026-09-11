import * as fs from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { packageRoot } from '../package-root.js';
import { temporaryDirectory } from './fixtures.js';
vi.hoisted(() => { vi.resetModules(); });
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>() }));
const manifest = '{"name":"terum-skills","version":"9.9.9"}';
describe('layout independent package root', () => {
  it.each(['src/lib/package-root.ts','dist/lib/package-root.js','dist/index.js'])('resolves the package root from %s', async from => {
    const root=await temporaryDirectory();await writeFile(join(root,'package.json'),manifest);expect(packageRoot(join(root,from))).toBe(resolve(root));
  });
  it('returns null when no manifest names this package above the caller', async()=>{const root=await temporaryDirectory();expect(packageRoot(join(root,'dist/index.js'))).toBeNull();});
  it('walks past a manifest belonging to someone else',async()=>{const root=await temporaryDirectory();await writeFile(join(root,'package.json'),manifest);await mkdir(join(root,'nested'));await writeFile(join(root,'nested/package.json'),'{"name":"my-app"}');expect(packageRoot(join(root,'nested/index.js'))).toBe(root);});
  it('ignores a manifest that is not valid JSON',async()=>{const root=await temporaryDirectory();await writeFile(join(root,'package.json'),manifest);await mkdir(join(root,'nested'));await writeFile(join(root,'nested/package.json'),'not json');expect(packageRoot(join(root,'nested/index.js'))).toBe(root);});
  it.skipIf(process.platform==='win32'||process.getuid?.()===0)('ignores a manifest it cannot read',async()=>{const root=await temporaryDirectory();await writeFile(join(root,'package.json'),manifest);await mkdir(join(root,'nested'));const path=join(root,'nested/package.json');await writeFile(path,manifest);await chmod(path,0);try{expect(packageRoot(join(root,'nested/index.js'))).toBe(root);}finally{await chmod(path,0o600);}});
  it('memoises per caller path',async()=>{const root=await temporaryDirectory();await writeFile(join(root,'package.json'),manifest);const spy=vi.spyOn(fs,'readFileSync');try{const from=join(root,'dist/index.js');expect(packageRoot(from)).toBe(root);const count=spy.mock.calls.length;expect(count).toBeGreaterThan(0);expect(packageRoot(from)).toBe(root);expect(spy).toHaveBeenCalledTimes(count);}finally{spy.mockRestore();}});
});
