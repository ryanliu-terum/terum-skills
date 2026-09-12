import { execFile, spawn } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bareTeam } from '../lib/__tests__/fixtures.js';
import type { Frame } from '../lib/frames.js';
const run=promisify(execFile);
const root=resolve(fileURLToPath(import.meta.url),'../../..');
const tsc=resolve(dirname(createRequire(import.meta.url).resolve('typescript')),'../bin/tsc');
describe('the bundled bin (W-02)',()=>{
  let out='',bin='',tree='',home='';let env:Record<string,string>={};
  beforeAll(async()=>{
    out=await realpath(await mkdtemp(join(tmpdir(),'w02-bundle-')));home=join(out,'home');await mkdir(home);
    await run(process.execPath,[tsc,'-p',join(root,'tsconfig.build.json'),'--outDir',join(out,'dist'),'--sourceMap','false','--declarationMap','false'],{cwd:root});
    await writeFile(join(out,'package.json'),await readFile(join(root,'package.json')));await symlink(join(root,'node_modules'),join(out,'node_modules'),'dir');
    tree=join(out,'unbundled');await mkdir(tree);await cp(join(out,'dist'),join(tree,'dist'),{recursive:true});await cp(join(out,'package.json'),join(tree,'package.json'));await symlink(join(root,'node_modules'),join(tree,'node_modules'),'dir');
    await run(process.execPath,[join(root,'scripts/bundle-cli.mjs'),'--out',join(out,'dist')],{cwd:root});
    await run(process.execPath,[join(root,'scripts/bundle-skill.mjs'),'--out',join(out,'dist')],{cwd:root});
    bin=join(out,'dist/index.js');

    env={PATH:process.env.PATH??'',HOME:home,USERPROFILE:home,GH_CONFIG_DIR:join(home,'.config/gh'),NODE_NO_WARNINGS:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
  });
  afterAll(async()=>{if(out)await rm(out,{recursive:true,force:true});});
  // File-backed stdout/stderr also preserve diagnostics on hosts where Node's socket-backed
  // child stdout drops buffered writes at exit. No CLI output is discarded or rewritten.
  async function capture(args:string[],entry=bin,childEnv=env){
    const dir=await mkdtemp(join(out,'capture-'));const stdout=await open(join(dir,'stdout'),'w+'),stderr=await open(join(dir,'stderr'),'w+');
    const child=spawn(process.execPath,[entry,...args],{cwd:out,env:childEnv,stdio:['pipe',stdout.fd,stderr.fd]});
    child.stdin?.end();
    try{const code=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});return {code,stdout:await readFile(join(dir,'stdout'),'utf8'),stderr:await readFile(join(dir,'stderr'),'utf8')};}
    finally{await stdout.close();await stderr.close();}
  }
  async function framed(args:string[],entry=bin){const result=await capture(['--frames',...args],entry);expect(result.code,result.stderr).toBe(0);return result.stdout.trim().split('\n').map(line=>JSON.parse(line) as Frame);}
  it('emits one bundle with a map and only the external Node built-in dynamic import',async()=>{
    const files=await readdir(join(out,'dist'));expect(files).toContain('index.js');expect(files).toContain('index.js.map');expect(files).not.toContain('.bundle');
    // tsc's cli.js is intentionally retained with the emitted tree (D16); esbuild emits only index.js.
    expect(files.filter(f=>f.endsWith('.js')).sort()).toEqual(['cli.js','index.js']);
    const dynamic = [...(await readFile(bin,'utf8')).matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(match=>match[1]);
    expect(dynamic).toEqual(['node:fs/promises']);
    // The map is emitted beside a staged copy one directory down and moved up with the bundle, so its
    // `sources` have to be re-anchored: a map whose paths are one level too high resolves to nothing and
    // the readable stack traces sourcemap:true was turned on for (D17) are silently lost.
    expect((await readFile(bin,'utf8')).trim().split('\n').at(-1)).toBe('//# sourceMappingURL=index.js.map');
    const map = JSON.parse(await readFile(`${bin}.map`,'utf8')) as { sources: string[] };
    expect(map.sources.length).toBeGreaterThan(0);
    const unresolved = (await Promise.all(map.sources.map(source => access(resolve(dirname(bin), source)).then(() => null, () => source)))).filter(source => source !== null);
    expect(unresolved).toEqual([]);
  });
  it('keeps the shebang as the first line and stays executable as the bin',async()=>{expect((await readFile(bin,'utf8')).split('\n')[0]).toBe('#!/usr/bin/env node');const result=await capture(['--version']);expect(result.code,result.stderr).toBe(0);expect(result.stdout.trim()).toBe(JSON.parse(await readFile(join(root,'package.json'),'utf8')).version);});
  it('reports its own version in the hello frame',async()=>{const frames=await framed(['status']);expect(frames[0]).toMatchObject({t:'hello',version:JSON.parse(await readFile(join(root,'package.json'),'utf8')).version});});
  it('arms the push guard with the bundled entry, not the npx fallback',async()=>{
    const fixture=await bareTeam();const isolated=join(out,'join-home');await mkdir(isolated);
    const result=await capture(['--frames','team','join','--as','team','--',fixture.bare],bin,{...env,HOME:isolated,USERPROFILE:isolated,GH_CONFIG_DIR:join(isolated,'.config/gh')});
    // Clone setup arms the guard before the first identity prompt. EOF intentionally stops there.
    expect(result.code).toBe(1);expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toMatchObject({t:'result',ok:false,error:expect.stringContaining('Input ended before')});
    const hook=await readFile(join(isolated,'.terum/skills/teams/team/.git/hooks/pre-push'),'utf8');expect(hook).toContain(bin);expect(hook.split('\n').find(line=>line.startsWith('exec '))).not.toContain('npx');
  });
  it('resolves the bundled wrapper SKILL.md',async()=>{expect(await readFile(join(out,'dist/claude/skills/terum-skills/SKILL.md'),'utf8')).toContain('name: terum-skills');expect(JSON.stringify(await framed(['status']))).not.toMatch(/wrapper source missing/i);});
  it('produces the same frames as the unbundled tree for a read verb',async()=>{expect(await framed(['ls','--local'])).toEqual(await framed(['ls','--local'],join(tree,'dist/index.js')));});
  it('runs a verb that needs proper-lockfile, yaml, zod and commander from the bundle',async()=>{
    const project=join(out,'project');await mkdir(project);await mkdir(join(project,'.git'));
    expect((await framed(['project','add','--',project])).at(-1)).toMatchObject({t:'result',ok:true});
    expect(JSON.stringify(await framed(['project','list']))).toContain(project);
    const skill=join(home,'.claude/skills/example');await mkdir(skill,{recursive:true});await writeFile(join(skill,'SKILL.md'),'---\nname: example\ndescription: YAML from the bundle\n---\n');
    expect(JSON.stringify(await framed(['ls','--local']))).toContain('YAML from the bundle');
  });
});
