#!/usr/bin/env node
/** Dev-only: three isolated bare repositories; never touches the checkout's Git metadata.
 * npm run build && node scripts/bench-sync.mjs
 * Reports before (cold reconciliation) and after (unchanged fast path), not a historical binary comparison.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), 'terum-bench-sync-'));
const fixtureHome = join(root, 'home');
const env = { ...process.env, HOME: fixtureHome, USERPROFILE: fixtureHome, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:join(root,'no-git-config'), GIT_TERMINAL_PROMPT:'0' };
for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|COMMON_DIR|AUTHOR_|COMMITTER_)/.test(key)) delete env[key];
const command = (binary, args, cwd = root) => exec(binary, args, { cwd, env, timeout:120_000, maxBuffer:16 * 1024 * 1024 });
const git = (args, cwd) => command('git', args, cwd);
try {
  const store = join(fixtureHome, '.terum', 'skills');
  await mkdir(join(store,'teams'),{recursive:true});
  const teams = {}, placements = {};
  for (let index = 1; index <= 3; index++) {
    const name = `team${index}`, bare = join(root,`${name}.git`), seed = join(root,`${name}-seed`), clone = join(store,'teams',name);
    await git(['init','--bare','--initial-branch=main',bare]);
    await git(['clone',bare,seed]);
    await git(['config','user.name','Benchmark'],seed); await git(['config','user.email','bench@example.com'],seed);
    await mkdir(join(seed,'people'),{recursive:true}); await mkdir(join(seed,'skills'),{recursive:true});
    const installed=[];
    for (let skill=1; skill<=20; skill++) {
      const id=`${String(index).padStart(8,'0')}-0000-4000-8000-${String(skill).padStart(12,'0')}`;
      const folder=`sample-${index}-${skill}`;
      const directory=join(seed,'skills',folder), placement=join(fixtureHome,'.claude','skills',folder);
      await mkdir(directory,{recursive:true});
      await writeFile(join(directory,'SKILL.md'),`---\nname: ${folder}\ndescription: Benchmark fixture\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Benchmark <bench@example.com>\n  terum-category: testing\n---\nFixture ${skill}\n`);
      installed.push({id,scope:{kind:'global'},since:'2026-09-10T00:00:00Z',version:null});
      placements[placement]={id,team:name,scope:{kind:'global'},version:null,placed_at:'2026-09-10T00:00:00Z',fingerprint:'missing'};
    }
    await writeFile(join(seed,'team.json'),JSON.stringify({layout_version:2,name,categories:['testing'],global:[],projects:{},archived:[],policy:{publish:'pr',skill_license:'UNLICENSED'}}));
    await writeFile(join(seed,'people','bench.json'),JSON.stringify({handle:'bench',display_name:'Benchmark',email:'bench@example.com',github:'bench',bio:'',installed,declined:[]}));
    await git(['add','.'],seed); await git(['commit','-m','Benchmark fixture'],seed); await git(['push','origin','main'],seed);
    await git(['clone',bare,clone]);
    await git(['config','user.name','Benchmark'],clone); await git(['config','user.email','bench@example.com'],clone);
    teams[name]={remote:bare,handle:'bench'};
  }
  await writeFile(join(store,'config.json'),JSON.stringify({teams,placements,shared:{},approvals:{},pending:[],auto_share:false}));
  const entry=resolve(fileURLToPath(new URL('../dist/index.js',import.meta.url)));
  const inProcess = process.argv.includes('--in-process');
  if (inProcess) console.log('In-process CLI benchmark: includes module loading, excludes child startup.');
  for(const label of ['before (cold reconciliation)','after (unchanged fast path)']) {
    const at=performance.now();
    const {stdout}=inProcess ? await inProcessCli(entry, label) : await command(process.execPath,[entry,'sync','--auto','--frames']);
    if (!stdout.trim()) throw new Error('CLI child returned empty stdout. No measurements are valid. If child spawning is restricted, rerun with --in-process (excludes child startup).');
    const wall=performance.now()-at;
    const frames=stdout.trim().split('\n').map(line=>JSON.parse(line));
    if(frames.some(frame=>frame.t==='ask'))throw new Error('Automatic sync asked a question.');
    const result=frames.find(frame=>frame.t==='result');
    if(!result?.ok||result.value?.teams?.length!==3||result.value?.timings?.length!==12)throw new Error(`Missing successful timing result: ${stdout}`);
    console.log(`${label}: ${wall.toFixed(2)} ms total`);
    for(const timing of result.value.timings)console.log(`  ${timing.team} ${timing.phase}: ${timing.ms.toFixed(2)} ms`);
  }
} finally { await rm(root,{recursive:true,force:true}); }

/** Explicit fallback for restricted child execution: run the same bundled CLI/argv with isolated
 * fixture environment and frame streams. Never silently substitute these for subprocess timings. */
async function inProcessCli(entry, label) {
  const input = new PassThrough(), output = new PassThrough();
  const stdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  const stdout = Object.getOwnPropertyDescriptor(process, 'stdout');
  const argv = process.argv, originalEnv = { ...process.env }, cwd = process.cwd();
  let text = '';
  output.on('data', chunk => { text += chunk.toString(); });
  try {
    Object.defineProperty(process, 'stdin', { configurable: true, value: input });
    Object.defineProperty(process, 'stdout', { configurable: true, value: output });
    process.argv = [process.execPath, entry, 'sync', '--auto', '--frames'];
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env); process.chdir(root);
    await import(pathToFileURL(entry).href + '?' + encodeURIComponent(label));
    return { stdout: text };
  } finally {
    process.argv = argv;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv); process.chdir(cwd);
    Object.defineProperty(process, 'stdin', stdin); Object.defineProperty(process, 'stdout', stdout);
    input.destroy(); output.destroy();
  }
}
