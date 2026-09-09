import { afterEach, expect, it, vi } from 'vitest';
import { createMockBackend } from '../mock';
import { FEATURE_KEYS } from '../types';
import type { CloneState } from '../types';
import { attentionCounts, cloneStateCopy } from '../mock/derive';
import { design } from '../mock/fixture';
import { githubUrl } from '../paths';
afterEach(()=>vi.restoreAllMocks());
it('advertises all thirteen mock feature switches',async()=>{expect(await createMockBackend().features()).toEqual(Object.fromEntries(FEATURE_KEYS.map(key=>[key,true])));});
it('opens external URLs through the browser seam with noopener',async()=>{const open=vi.spyOn(window,'open').mockReturnValue(null);expect(await createMockBackend().openUrl('https://github.com/acme/team')).toEqual({ok:true,value:undefined});expect(open).toHaveBeenCalledWith('https://github.com/acme/team','_blank','noopener');});
it('reports browser opening failures',async()=>{vi.spyOn(window,'open').mockImplementation(()=>{throw new Error('Blocked');});expect(await createMockBackend().openUrl('https://github.com/acme/team')).toEqual({ok:false,error:'Blocked'});});
it('reveals paths as a harmless mock no-op',async()=>{expect(await createMockBackend().revealPath('/a')).toEqual({ok:true,value:undefined});});
it('scopes Library attention: 6 = 2 + 2 + 2, with Inbox Updates 3 and Alerts 8',async()=>{
 const counts=attentionCounts();expect(counts).toEqual({failingEvals:2,updatesAvailable:2,notEvaluated:2,attention:6});
 expect(counts.attention).toBe(counts.failingEvals+counts.updatesAvailable+counts.notEvaluated);
 expect(Number(design.LIBRARY_OVERVIEW.attention)).toBe(counts.attention);
 const result=await createMockBackend().status();expect(result.ok&&result.value.counts).toMatchObject({Updates:'3',Alerts:'8'});
});
it.each([
 [{state:'absent'},true,'Clone: /clone is missing.'],
 [{state:'incomplete',reason:'not-a-repository'},true,'Clone: /clone exists but is not a complete clone.'],
 [{state:'incomplete',reason:'no-team-json'},true,'Clone: /clone exists but is not a complete clone.'],
 [{state:'incomplete',reason:'unverifiable',error:'git unavailable'},true,'Clone: /clone could not be verified (git unavailable); check that git is installed before repairing anything.'],
 [{state:'foreign',origin:'github.com/other/repo'},true,'Clone: /clone is a clone of github.com/other/repo, not github.com/acme/team.'],
 [{state:'ok',origin:'github.com/acme/team'},true,'From the local clone; GitHub access is not checked.'],
 [{state:'ok',origin:'github.com/acme/team'},false,'Local team details could not be read.'],
] satisfies [CloneState,boolean,string][])('describes %j readable=%s', (state,readable,expected)=>{expect(cloneStateCopy(state,'/clone','github.com/acme/team',readable)).toBe(expected);expect(expected).not.toContain('another window');});
it.each(['git@github.com:acme/team.git','https://github.com/acme/team','github.com/acme/team','ssh://git@github.com/acme/team.git'])('normalizes GitHub remote %s',remote=>{expect(githubUrl(remote)).toBe('https://github.com/acme/team');});
it('does not fabricate a GitHub URL for another host',()=>{expect(githubUrl('gitlab.com/acme/team')).toBeNull();});
