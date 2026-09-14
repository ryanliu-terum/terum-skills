import * as privateFs from '../../lib/fs.js';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { run, type SkillArgs } from '../skill.js';
import { run as list } from '../ls.js';
import { createConfigStore } from '../../lib/config.js';
import { fsForTests, lockTarget } from '../../lib/placer.js';
import { snapshotSkillDirectory } from '../../lib/placer/vendor/skillhub/skill-fingerprint.js';
import { bareTeam, cloneWithIdentity, person, pushFromSeed, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>() }));
afterEach(()=>vi.restoreAllMocks());
const id='11111111-1111-4111-8111-111111111111';
const raw=(name='alpha')=>`---\nname: ${name}\ndescription: a skill\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nOriginal bytes\n`;
async function fixture(placed=true){
 const home=await temporaryDirectory(),store=createConfigStore(join(home,'.terum','skills')),root=join(home,'.claude','skills'),path=join(root,'alpha'),project=join(home,'project');
 await fs.mkdir(path,{recursive:true});await fs.mkdir(project,{recursive:true});await fs.writeFile(join(path,'SKILL.md'),raw());
 const fingerprint=(await snapshotSkillDirectory(path)).fingerprint;
 await store.update(c=>{c.projects=[{root:project,label:'Project'}];if(placed)c.placements[path]={id,team:'team',version:'v1',fingerprint,scope:{kind:'global'},placed_at:'2026-09-13'};});
 const invoke=(kind:SkillArgs['kind'],to?:string)=>run({kind,path,...(to?{to}:{}),home,config:store},new ScriptedPrompter(['alpha']));
 return {home,store,root,path,project,fingerprint,invoke};
}
describe('skill fix',()=>{
 const broken=`---\nname: alpha\ndescription: Audits a spec. Ends in a triage: every finding sorted. Args: <path>\nmetadata:\n  terum-category: testing # kept\n---\nBody: stays\n`;
 const fix=(f:Awaited<ReturnType<typeof fixture>>,path=f.path)=>run({kind:'fix',path,home:f.home,config:f.store},new ScriptedPrompter([]));
 it('quotes the offending line, keeps every other byte, and is inert on a second run',async()=>{
  const f=await fixture(false);await fs.writeFile(join(f.path,'SKILL.md'),broken);
  expect(await fix(f)).toMatchObject({ok:true,value:{kind:'fix',path:f.path,destination:null,quarantined:null,installed:false,notices:['Quoted `description` in SKILL.md so the frontmatter parses; the text is unchanged.','alpha: hygiene passes.']}});
  const after=await fs.readFile(join(f.path,'SKILL.md'),'utf8');
  expect(YAML.parse(after.split('---')[1]!)).toEqual({name:'alpha',description:'Audits a spec. Ends in a triage: every finding sorted. Args: <path>',metadata:{'terum-category':'testing'}});
  expect(after).toContain('  terum-category: testing # kept\n');expect(after.endsWith('---\nBody: stays\n')).toBe(true);
  expect(await fix(f)).toMatchObject({ok:true,value:{notices:['alpha: nothing to fix; hygiene passes.']}});
  expect(await fs.readFile(join(f.path,'SKILL.md'),'utf8')).toBe(after);
 });
 it('applies every covered repair in one pass and lists what still needs the author',async()=>{
  const f=await fixture(false);
  await fs.writeFile(join(f.path,'SKILL.md'),`---\nname: other\ndescription: Ends in a triage: every finding\n---\nSee\u200B notes. token ghp_abcdefghijklmnopqrstuvwxyz0123456789\n`);
  await fs.writeFile(join(f.path,'notes.txt'),'plain');await fs.chmod(join(f.path,'notes.txt'),0o755);
  const result=await fix(f);
  expect(result).toMatchObject({ok:true,value:{notices:[
   'Quoted `description` in SKILL.md so the frontmatter parses; the text is unchanged.',
   'Set name to `alpha` to match the folder (was `other`).',
   'Removed 1 invisible character from SKILL.md.',
   'Cleared the executable mode on notes.txt.',
   'Still needs you (1):',
   expect.stringMatching(/^ {2}HYG3 SKILL\.md.*credential-shaped/),
  ]}});
  expect((await fs.stat(join(f.path,'notes.txt'))).mode&0o111).toBe(0);
  const after=await fs.readFile(join(f.path,'SKILL.md'),'utf8');
  expect(YAML.parse(after.split('---')[1]!)).toEqual({name:'alpha',description:'Ends in a triage: every finding'});
  expect(after).toContain('See notes.');
 });
 it('reports a placement as installed and the ledger keeps its fingerprint, so ls shows the edit',async()=>{
  const f=await fixture(true);await fs.writeFile(join(f.path,'SKILL.md'),broken);
  expect(await fix(f)).toMatchObject({ok:true,value:{installed:true}});
  expect((await f.store.read()).placements[f.path]).toMatchObject({fingerprint:f.fingerprint});
 });
 it('fails without writing when nothing here is a fault it covers, and refuses a missing SKILL.md or a symlinked folder',async()=>{
  const f=await fixture(false);
  await fs.writeFile(join(f.path,'SKILL.md'),'---\nname: [\ndescription: x\n---\n');
  expect(await fix(f)).toMatchObject({ok:false,error:expect.stringMatching(/^alpha: nothing here is a fault fix covers; \d+ findings? still needs? you \(listed above\)\.$/),value:{notices:expect.arrayContaining([expect.stringMatching(/^Still needs you \(\d+\):$/),expect.stringMatching(/not valid YAML/)])}});
  expect(await fs.readFile(join(f.path,'SKILL.md'),'utf8')).toBe('---\nname: [\ndescription: x\n---\n');
  await fs.rm(join(f.path,'SKILL.md'));
  expect(await fix(f)).toMatchObject({ok:false,error:`${f.path} has no SKILL.md; nothing to fix.`});
  const link=join(f.root,'linked');await fs.symlink(f.path,link);
  expect(await fix(f,link)).toMatchObject({ok:false,error:expect.stringContaining('not a plain folder')});
 });
});
describe('D6 Library file operations',()=>{
 it.each(['move','rename'] as const)('%s retains edited local bytes and rekeys the placement without team I/O',async kind=>{
  const f=await fixture();await fs.appendFile(join(f.path,'SKILL.md'),'user edit\n');
  const to=kind==='move'?f.project:'beta',dest=kind==='move'?join(f.project,'.claude','skills','alpha'):join(f.root,'beta');
  expect(await f.invoke(kind,to)).toMatchObject({ok:true,value:{destination:dest}});
  expect(await fs.readFile(join(dest,'SKILL.md'),'utf8')).toContain('user edit');
  expect((await f.store.read()).placements).toEqual({[dest]:expect.objectContaining({id,fingerprint:f.fingerprint})});
  expect(await f.invoke(kind,to)).toMatchObject({ok:true,value:{destination:dest}});
 });
 it.each(['directory','frontmatter','ledger'] as const)('rename re-runs after the %s write',async point=>{
  const f=await fixture(),dest=join(f.root,'beta');let fired=false;
  const oldRename=fs.rename,oldWrite=fs.writeFile,oldUpdate=f.store.update;
  if(point==='directory')vi.spyOn(fs,'rename').mockImplementation(async(...args)=>{await oldRename(...args);if(args[0]===f.path&&!fired){fired=true;throw new Error('interrupted directory');}});
  if(point==='frontmatter')vi.spyOn(fs,'writeFile').mockImplementation(async(...args)=>{await oldWrite(...args);if(args[0]===join(dest,'SKILL.md')&&!fired){fired=true;throw new Error('interrupted frontmatter');}});
  if(point==='ledger')vi.spyOn(f.store,'update').mockImplementation(async(...args)=>{const c=await oldUpdate(...args);if(c.placements[dest]&&!fired){fired=true;throw new Error('interrupted ledger');}return c;});
  expect(await f.invoke('rename','beta')).toMatchObject({ok:false});expect(fired).toBe(true);vi.restoreAllMocks();
  expect(await f.invoke('rename','beta')).toMatchObject({ok:true});
  expect(YAML.parse((await fs.readFile(join(dest,'SKILL.md'),'utf8')).split('---')[1]!).name).toBe('beta');
  expect((await f.store.read()).placements).toEqual({[dest]:expect.objectContaining({id,fingerprint:f.fingerprint})});
 });
 it.each([false,true])('D75 repairs a stale ledger by metadata.id (frontmatter already renamed: %s)',async rewritten=>{
  const f=await fixture(),dest=join(f.root,'beta');await fs.appendFile(join(f.path,'SKILL.md'),'edited before rename\n');await fs.rename(f.path,dest);
  if(rewritten)await fs.writeFile(join(dest,'SKILL.md'),raw('beta')+'edited before rename\n');
  expect(await f.invoke('rename','beta')).toMatchObject({ok:true});
  expect((await f.store.read()).placements).toEqual({[dest]:expect.objectContaining({id,fingerprint:f.fingerprint})});
  const result=await list({local:true,config:f.store,home:f.home},new ScriptedPrompter());
  expect(result.ok&&result.value.local?.[0]?.rows[0]).toMatchObject({name:'beta',edited:true});
 });
 it('D75 locks the externally-renamed sibling before repairing it: a busy folder refuses instead of moving',async()=>{
  // Ledger says alpha, the folder is now gamma, the request is alpha→beta: gamma is the one folder the
  // literal-name lock set never covered (hybrid review r1, high), yet it is the folder that gets moved.
  const f=await fixture(),gamma=join(f.root,'gamma'),dest=join(f.root,'beta');await fs.rename(f.path,gamma);
  const release=await lockTarget(f.root,'gamma');
  try{expect(await f.invoke('rename','beta')).toMatchObject({ok:false});}finally{await release();}
  expect(await fs.readdir(f.root)).toEqual(['gamma']);
  expect((await f.store.read()).placements).toEqual({[f.path]:expect.objectContaining({id})});
  expect(await f.invoke('rename','beta')).toMatchObject({ok:true,value:{destination:dest}});
  expect((await f.store.read()).placements).toEqual({[dest]:expect.objectContaining({id,fingerprint:f.fingerprint})});
 });
 it('drops a missing ledger row only when no sibling has the stable ID',async()=>{const f=await fixture();await fs.rm(f.path,{recursive:true});expect(await f.invoke('rename','beta')).toMatchObject({ok:false});expect((await f.store.read()).placements).toEqual({});});
 it.each(['directory','ledger'] as const)('move re-runs after the %s write',async point=>{
  const f=await fixture(),dest=join(f.project,'.claude','skills','alpha');let fired=false;const rename=fsForTests.rename,update=f.store.update;
  if(point==='directory')vi.spyOn(fsForTests,'rename').mockImplementation(async(...args)=>{await rename(...args);if(args[0]===f.path&&!fired){fired=true;throw new Error('interrupted');}});
  else vi.spyOn(f.store,'update').mockImplementation(async(...args)=>{const c=await update(...args);if(c.placements[dest]&&!fired){fired=true;throw new Error('interrupted');}return c;});
  expect(await f.invoke('move',f.project)).toMatchObject({ok:false});vi.restoreAllMocks();expect(await f.invoke('move',f.project)).toMatchObject({ok:true});expect((await f.store.read()).placements[dest]?.id).toBe(id);
 });
 it('completes an EXDEV copy left at both paths without losing edits',async()=>{
  const f=await fixture(),dest=join(f.project,'.claude','skills','alpha');await fs.appendFile(join(f.path,'SKILL.md'),'edit\n');
  vi.spyOn(fsForTests,'rename').mockRejectedValue(Object.assign(new Error('cross-device'),{code:'EXDEV'}));vi.spyOn(fsForTests,'rm').mockRejectedValue(new Error('interrupted after copy'));
  expect(await f.invoke('move',f.project)).toMatchObject({ok:false});expect(await fs.readFile(join(dest,'SKILL.md'),'utf8')).toContain('edit');vi.restoreAllMocks();
  expect(await f.invoke('move',f.project)).toMatchObject({ok:true});await expect(fs.lstat(f.path)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('keeps a collision in the destination root’s old-skills directory and excludes it locally',async()=>{
  const f=await fixture(false),dest=join(f.project,'.claude','skills','alpha');await fs.mkdir(dest,{recursive:true});await fs.writeFile(join(dest,'SKILL.md'),'other bytes');
  const runner={run:vi.fn(async()=>({code:0,stdout:'.git/info/exclude\n',stderr:''}))};
  expect(await run({kind:'move',path:f.path,to:f.project,home:f.home,config:f.store,runner},new ScriptedPrompter(['alpha']))).toMatchObject({ok:true});
  expect(await fs.readFile(join(f.project,'.claude','old-skills','alpha','SKILL.md'),'utf8')).toBe('other bytes');expect(await fs.readFile(join(f.project,'.git/info/exclude'),'utf8')).toContain('.claude/old-skills/');
 });
 it('copy leaves the source where it is, lands the edited bytes in the other root, and gives the new folder no ledger row',async()=>{
  const f=await fixture(),dest=join(f.project,'.claude','skills','alpha');await fs.appendFile(join(f.path,'SKILL.md'),'user edit\n');
  const runner={run:vi.fn(async()=>({code:0,stdout:'.git/info/exclude\n',stderr:''}))};
  expect(await run({kind:'copy',path:f.path,to:f.project,home:f.home,config:f.store,runner},new ScriptedPrompter(['alpha']))).toMatchObject({ok:true,value:{kind:'copy',destination:dest,notices:[`Copied ${f.path} to ${dest}.`]}});
  expect(await fs.readFile(join(f.path,'SKILL.md'),'utf8')).toContain('user edit');
  expect(await fs.readFile(join(dest,'SKILL.md'),'utf8')).toBe(await fs.readFile(join(f.path,'SKILL.md'),'utf8'));
  // The source keeps its install; the copy is a plain local folder carrying the same metadata.id.
  expect((await f.store.read()).placements).toEqual({[f.path]:expect.objectContaining({id,fingerprint:f.fingerprint})});
  expect(YAML.parse((await fs.readFile(join(dest,'SKILL.md'),'utf8')).split('---')[1]!).metadata.id).toBe(id);
 });
 it('copy keeps a colliding destination in that root’s old-skills directory and never half-writes the new folder',async()=>{
  const f=await fixture(false),dest=join(f.project,'.claude','skills','alpha');await fs.mkdir(dest,{recursive:true});await fs.writeFile(join(dest,'SKILL.md'),'other bytes');
  const runner={run:vi.fn(async()=>({code:0,stdout:'.git/info/exclude\n',stderr:''}))};
  expect(await run({kind:'copy',path:f.path,to:f.project,home:f.home,config:f.store,runner},new ScriptedPrompter(['alpha']))).toMatchObject({ok:true});
  expect(await fs.readFile(join(f.project,'.claude','old-skills','alpha','SKILL.md'),'utf8')).toBe('other bytes');
  expect(await fs.readFile(join(dest,'SKILL.md'),'utf8')).toBe(raw());
  expect(await fs.readFile(join(f.project,'.git/info/exclude'),'utf8')).toContain('.claude/old-skills/');
 });
 it('copy re-runs after an interrupted placement and refuses a destination that is not a registered root',async()=>{
  const f=await fixture(false),dest=join(f.project,'.claude','skills','alpha'),rename=fsForTests.rename;let fired=false;
  const copy=(to:string)=>run({kind:'copy',path:f.path,to,home:f.home,config:f.store},new ScriptedPrompter(['alpha']));
  vi.spyOn(fsForTests,'rename').mockImplementation(async(...args)=>{if(args[1]===dest&&!fired){fired=true;throw new Error('interrupted');}return rename(...args);});
  expect(await copy(f.project)).toMatchObject({ok:false});expect(fired).toBe(true);
  await expect(fs.lstat(dest)).rejects.toMatchObject({code:'ENOENT'});vi.restoreAllMocks();
  expect(await copy(f.project)).toMatchObject({ok:true,value:{destination:dest}});
  expect(await fs.readFile(join(f.path,'SKILL.md'),'utf8')).toBe(raw());
  expect(await copy(join(f.home,'elsewhere'))).toMatchObject({ok:false,error:expect.stringContaining('Choose global or a registered project root')});
  expect(await copy('global')).toMatchObject({ok:false,error:'The source and destination are the same folder.'});
 });
 it.each(['directory','journal'] as const)('non-placement delete is quarantined and re-runnable after %s',async point=>{
  const f=await fixture(false),rename=fsForTests.rename,journalWrite=privateFs.writeJsonPrivate;let fired=false;
  if(point==='directory')vi.spyOn(fsForTests,'rename').mockImplementation(async(...args)=>{await rename(...args);if(args[0]===f.path&&!fired){fired=true;throw new Error('interrupted');}});
  if(point==='journal')vi.spyOn(privateFs,'writeJsonPrivate').mockImplementation(async(path,value)=>{await journalWrite(path,value);if((value as {done?:boolean}).done&&!fired){fired=true;throw new Error('interrupted after journal');}});
  const first=await f.invoke('delete');expect(first.ok).toBe(false);expect(fired).toBe(true);vi.restoreAllMocks();const second=await f.invoke('delete');expect(second).toMatchObject({ok:true,value:{installed:false,quarantined:expect.any(String)}});if(second.ok)expect(await fs.readFile(join(second.value.quarantined!,'SKILL.md'),'utf8')).toBe(raw());
 });
 it.each(['outside','nested','symlink','wrong-name'] as const)('refuses %s without changing the folder',async mode=>{
  const f=await fixture(false);let path=f.path;
  if(mode==='outside')path=join(f.home,'outside');if(mode==='nested')path=join(f.path,'nested');if(mode==='symlink'){path=join(f.root,'link');await fs.symlink(f.path,path);}
  expect(await run({kind:'delete',path,home:f.home,config:f.store},new ScriptedPrompter(['wrong']))).toMatchObject({ok:false});expect(await fs.readFile(join(f.path,'SKILL.md'),'utf8')).toBe(raw());
 });
 it('renames a D16 folder without SKILL.md without inventing frontmatter',async()=>{const f=await fixture(false);await fs.rm(join(f.path,'SKILL.md'));expect(await f.invoke('rename','beta')).toMatchObject({ok:true});expect(await fs.readdir(join(f.root,'beta'))).toEqual([]);});
 it.each([false,true])('placement delete delegates the complete uninstall contract (edited %s)',async edited=>{
  const f=await fixture(),team=await bareTeam();await pushFromSeed(team.seed,'skills/alpha/v1/SKILL.md',raw());await pushFromSeed(team.seed,'people/seed.json',JSON.stringify(person('seed',{installed:[{id,version:'v1',scope:{kind:'global'},since:'2026-09-13'}]})));
  await cloneWithIdentity(team.bare,f.store.teamClone('team'));await f.store.update(c=>{c.teams.team={remote:team.bare,handle:'seed'};});if(edited)await fs.appendFile(join(f.path,'SKILL.md'),'edit\n');
  const outcome=await f.invoke('delete');expect(outcome,JSON.stringify(outcome)).toMatchObject({ok:true});expect((await f.store.read()).placements).toEqual({});expect(JSON.parse(await fs.readFile(join(f.store.teamClone('team'),'people/seed.json'),'utf8')).installed).toEqual([]);
  if(edited){expect(outcome.ok&&outcome.value.notices.join('\n')).toContain('moved to');expect(await fs.readdir(join(f.store.root,'quarantine'))).toHaveLength(1);}else await expect(fs.lstat(join(f.store.root,'quarantine'))).rejects.toMatchObject({code:'ENOENT'});
 });
});

it.each([false,true].flatMap(edited=>['directory','ledger','team-write'].map(point=>({edited,point}))))('placement delete repairs after $point (edited $edited)',async({edited,point})=>{
 const f=await fixture(),team=await bareTeam();
 await pushFromSeed(team.seed,'skills/alpha/v1/SKILL.md',raw());
 await pushFromSeed(team.seed,'people/seed.json',JSON.stringify(person('seed',{installed:[{id,version:'v1',scope:{kind:'global'},since:'2026-09-13'}]})));
 await cloneWithIdentity(team.bare,f.store.teamClone('team'));await f.store.update(c=>{c.teams.team={remote:team.bare,handle:'seed'};});
 if(edited)await fs.appendFile(join(f.path,'SKILL.md'),'edit before delete');
 let fired=false;const update=f.store.update,rm=fs.rm,rename=fsForTests.rename;
 if(point==='directory'&&edited)vi.spyOn(fsForTests,'rename').mockImplementation(async(...args)=>{await rename(...args);if(args[0]===f.path&&!fired){fired=true;throw new Error('after quarantine move');}});
 if(point==='directory'&&!edited)vi.spyOn(fs,'rm').mockImplementation(async(...args)=>{await rm(...args);if(args[0]===f.path&&!fired){fired=true;throw new Error('after removal');}});
 if(point!=='directory')vi.spyOn(f.store,'update').mockImplementation(async(...args)=>{const c=await update(...args);if(!c.placements[f.path]&&(point==='ledger'||c.pending.length===0)&&!fired){fired=true;throw new Error('after '+point);}return c;});
 expect(await f.invoke('delete')).toMatchObject({ok:false});expect(fired).toBe(true);vi.restoreAllMocks();
 expect(await f.invoke('delete')).toMatchObject({ok:true});expect((await f.store.read()).placements).toEqual({});expect((await f.store.read()).pending).toEqual([]);
 expect(JSON.parse(await fs.readFile(join(f.store.teamClone('team'),'people/seed.json'),'utf8')).installed).toEqual([]);
 if(edited){const dirs=await fs.readdir(join(f.store.root,'quarantine'));expect(dirs).toHaveLength(1);expect(await fs.readFile(join(f.store.root,'quarantine',dirs[0]!,'alpha','SKILL.md'),'utf8')).toContain('edit before delete');}
});

it('permits a case-only rename when both spellings address the same directory',async()=>{
 const f=await fixture(false),source=join(f.root,'Alpha');await fs.rename(f.path,source);
 const original=fs.lstat;
 // Model a case-insensitive volume even when this fixture runs on Linux.
 vi.spyOn(fs,'lstat').mockImplementation(async(...args)=>{try{return await original(...args);}catch(error){if(args[0]===f.path&&(error as NodeJS.ErrnoException).code==='ENOENT')return original(source);throw error;}});
 expect(await run({kind:'rename',path:source,to:'alpha',config:f.store,home:f.home},new ScriptedPrompter(['Alpha']))).toMatchObject({ok:true});
 expect(await fs.readFile(join(f.path,'SKILL.md'),'utf8')).toContain('name: alpha');
});

it('accepts a registered project reached through a symlink as the move destination',async()=>{
 // hybrid review r1 (high): config.projects[].root is stored realpath'd while --to arrived verbatim, so
 // a project behind any symlink component was refused as unregistered.
 const f=await fixture(false),alias=join(await temporaryDirectory(),'proj');await fs.symlink(f.project,alias,'dir');
 const dest=join(f.project,'.claude','skills','alpha');
 expect(await run({kind:'move',path:f.path,to:alias,home:f.home,config:f.store},new ScriptedPrompter(['alpha']))).toMatchObject({ok:true,value:{destination:dest}});
 expect(await fs.readFile(join(dest,'SKILL.md'),'utf8')).toBe(raw());
});

it('rekeys ledger provenance when the registered root is reached through an alias',async()=>{
 const f=await fixture(),alias=join(await temporaryDirectory(),'home');await fs.symlink(f.home,alias,'dir');
 const path=join(alias,'.claude','skills','alpha'),destination=join(alias,'.claude','skills','beta');
 expect(await run({kind:'rename',path,to:'beta',config:f.store,home:alias},new ScriptedPrompter(['alpha']))).toMatchObject({ok:true});
 expect((await f.store.read()).placements).toEqual({[destination]:expect.objectContaining({id,fingerprint:f.fingerprint})});
 expect(await run({kind:'rename',path,to:'beta',config:f.store,home:alias},new ScriptedPrompter(['alpha']))).toMatchObject({ok:true});
});
