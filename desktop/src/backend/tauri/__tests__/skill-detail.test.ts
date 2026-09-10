import { expect, it } from 'vitest';
import { createTauriBackend } from '../index';
import { detailReplay } from './skill-detail-replay';

it('serves the recorded detail metadata without invented file or grant data', async () => {
  const backend = createTauriBackend(detailReplay().bridge);
  const result = await backend.skill({ref:'deploy-check'});
  expect(result).toMatchObject({ok:true,value:{
    repo:'acme/team',repoPath:'skills/deploy-check',version:'43bf7396d9ed',
    version_full:'43bf7396d9edbdcfba751bc63dbe1c74055125ae',
    // Six lines: the fixture's seventh split element is the ignored trailing newline.
    lines:6,files:null,grants:[],normalizedGrants:'none',author:{name:'Mira Chen',handle:'mira',role:''},
    shareCommand:'npx -y terum-skills@latest install acme/team/deploy-check@43bf7396d9ed',
    hygieneStatus:'pass',hygieneWhen:null,hygieneCaption:null,path:'/Users/teddy/.claude/skills/deploy-check',
  }});
  expect(result.value?.users[0]?.[2]).toBe('Global · since 2026-08-20');
  expect(await backend.features()).toMatchObject({checkouts:true});
});

it('uses the full team version for an unplaced skill and excludes absent project roots', async () => {
  expect(await createTauriBackend(detailReplay().bridge).skill({ref:'tdd'})).toMatchObject({ok:true,value:{
    version:'db604968dcc6',version_full:expect.stringMatching(/^[a-f0-9]{40}$/),path:null,pathLabel:'—',
    installScopes:[['Global','every session · ~/.claude/skills']],
    shareCommand:'npx -y terum-skills@latest install acme/team/tdd@db604968dcc6',
  }});
});

it('distinguishes a missing skill from an unreadable inventory', async () => {
  expect(await createTauriBackend(detailReplay().bridge).skill({ref:'nope'})).toMatchObject({ok:false,reason:'not-found'});
});
it.each(['ls','ls-local','validate-deploy-check'])('classifies a failed %s read as unreadable', async failed => {
  const f = detailReplay((name,_value,frame) => {
    if (name === failed) { frame.ok=false; frame.error='Cannot read the folder.'; delete frame.value; }
  });
  expect(await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).toMatchObject({ok:false,reason:'unreadable',error:expect.stringMatching(/^Cannot read the folder\./)});
});

it.each([undefined,'Global'])('installs into global explicitly for scope %s', async scope => {
  const f = detailReplay();
  const result = await createTauriBackend(f.bridge).install({ref:'tdd',team:'acme',...(scope ? {scope} : {})}).done;
  expect(result).toMatchObject({ok:true,value:[{scope:'Global'}]});
  expect(f.spawns.map(spawn => spawn.args)).toEqual([['install','--team','acme','--into','global','--','tdd']]);
});
it('maps a scanned project label to its absolute destination for install and removal', async () => {
  const f = detailReplay((name,value) => {
    if (name === 'ls-local') (value.local as Record<string,unknown>[])[1]!.rootState='scanned';
  });
  const backend = createTauriBackend(f.bridge);
  const detail = await backend.skill({ref:'tdd'});
  expect(detail.value?.installScopes).toEqual([['Global','every session · ~/.claude/skills'],['seed','project · ~/code/seed']]);
  expect(detail.value?.installScopePaths).toEqual({seed:'/Users/teddy/code/seed'});
  expect((await backend.install({ref:'tdd',scope:'seed'}).done).ok).toBe(true);
  expect(f.spawns.at(-1)?.args).toEqual(['install','--into','/Users/teddy/code/seed','--','tdd']);
});
it.each(['nope','seed'])('refuses unknown or absent install destination %s before the mutation spawns', async scope => {
  const f = detailReplay();
  const run = createTauriBackend(f.bridge).install({ref:'tdd',scope});
  expect(await run.done).toEqual({ok:false,error:`Unknown install destination ${scope}.`});
  expect(f.spawns.map(spawn => spawn.args)).toEqual([['ls','--local']]);
  const frames=[];for await (const frame of run.frames) frames.push(frame);
  expect(frames).toEqual([{t:'result',ok:false,error:`Unknown install destination ${scope}.`}]);
});
it('passes the removal destination before the ref', async () => {
  const f = detailReplay();
  expect((await createTauriBackend(f.bridge).uninstallSkill({ref:'deploy-check',team:'acme',from:'global'}).done).ok).toBe(true);
  expect(f.spawns[0]?.args).toEqual(['uninstall-skill','--team','acme','--from','global','--','deploy-check']);
});

it('falls back to ls latest when eval-report cannot be read', async () => {
  const f=detailReplay((name,_value,frame)=>{if(name==='eval-report-tdd'){frame.ok=false;frame.error='No report.';delete frame.value;}});
  expect(await createTauriBackend(f.bridge).skill({ref:'tdd'})).toMatchObject({ok:true,value:{version:'db604968',version_full:'db604968',evalReportError:'No report.',shareCommand:'npx -y terum-skills@latest install acme/team/tdd@db604968'}});
});
it.each([undefined,'',null])('omits the since clause when the date is %s', async since => {
  const f=detailReplay((name,value)=>{
    if(name==='ls') for(const row of value.skills as {installedBy:Record<string,unknown>[]}[]) for(const person of row.installedBy) person.since=since;
  });
  expect((await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).value?.users[0]?.[2]).toBe('Global');
});
it.each([
  ['Mira Chen <other@example.com>','mira'],
  ['Different name <ravi@example.com>','ravi'],
  ['Different name <nobody@example.com>',''],
])('resolves author %s to the recorded handle %s', async (author,handle) => {
  const f=detailReplay((name,value)=>{if(name==='ls') (value.skills as Record<string,unknown>[])[0]!.author=author;});
  expect((await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).value?.author.handle).toBe(handle);
});
it.each([['git@github.com:acme/team.git','acme/team'],['https://gitlab.com/Acme/Team.git','gitlab.com/Acme/Team']])('normalizes remote %s', async (repository,repo) => {
  const f=detailReplay((name,value)=>{if(name.startsWith('status')) (value.teams as Record<string,unknown>[])[0]!.repository=repository;});
  expect((await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).value?.repo).toBe(repo);
});
it.each([[null,null],['Read\nBash',['Read','Bash']]] as const)('preserves grants %s without manufacturing chips', async (grants,expected) => {
  const f=detailReplay((name,value)=>{if(name==='ls') (value.skills as Record<string,unknown>[])[0]!.grants=grants;});
  expect((await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).value?.grants).toEqual(expected);
});
it.each([[null,null],['',1],['one\n',1],['one\n\n',2],['one\ntwo',2]] as const)('counts only known body lines for %s', async (body,lines) => {
  const f=detailReplay((name,value)=>{if(name==='ls') (value.skills as Record<string,unknown>[])[0]!.body=body;});
  expect((await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).value?.lines).toBe(lines);
});
it('keeps hygiene findings as a readable detail', async () => {
  const f=detailReplay((name,value,frame)=>{if(name==='validate-deploy-check'){value.findings=2;frame.ok=false;frame.error='Hygiene failed.';}});
  expect(await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).toMatchObject({ok:true,value:{hygieneStatus:'fail'}});
});
it.each(['duplicate','missing-root'])('refuses an ambiguous or incomplete project destination (%s)',async mode=>{
  const f=detailReplay((name,value)=>{
    if(name!=='ls-local')return;
    const local=value.local as Record<string,unknown>[];
    local[1]!.rootState='scanned';
    if(mode==='duplicate')local.push({...local[1],repoRoot:'/another/seed'});
    else delete local[1]!.repoRoot;
  });
  const backend=createTauriBackend(f.bridge);
  expect((await backend.skill({ref:'tdd'})).value?.installScopePaths).toEqual({});
  expect(await backend.install({ref:'tdd',scope:'seed'}).done).toEqual({ok:false,error:'Unknown install destination seed.'});
  expect(f.spawns.some(spawn=>spawn.args[0]==='install')).toBe(false);
});
it('does not install when reading destinations fails',async()=>{
  const f=detailReplay((name,_value,frame)=>{if(name==='ls-local'){frame.ok=false;frame.error='Destination scan failed.';delete frame.value;}});
  expect(await createTauriBackend(f.bridge).install({ref:'tdd',scope:'seed'}).done).toMatchObject({ok:false,error:expect.stringMatching(/^Destination scan failed\./)});
  expect(f.spawns.map(spawn=>spawn.args)).toEqual([['ls','--local']]);
});
it('omits an unknown author handle and remote rather than inventing a share ref',async()=>{
  const f=detailReplay((name,value)=>{
    if(name.startsWith('status')){const team=(value.teams as Record<string,unknown>[])[0]!;delete team.members;team.repository=null;}
  });
  expect(await createTauriBackend(f.bridge).skill({ref:'deploy-check'})).toMatchObject({ok:true,value:{author:{handle:''},repo:null,shareCommand:'—'}});
});
