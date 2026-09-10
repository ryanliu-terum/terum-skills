import { expect, it } from 'vitest';
import { createTauriBackend } from '../index';
import { overviewCopy } from '../../../lib/overview-copy';
import { chromeLibraryReplay, underHome } from './chrome-library-fixture';

const global = {scope:{kind:'global'} as const};

it('serves the recorded scan coverage abbreviated from the real roots, never a literal (L5)',async()=>{
 const backend=createTauriBackend(chromeLibraryReplay({local:underHome}).bridge);
 const result=await backend.library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.scanned).toEqual(['~/.claude/skills','~/code/seed']);
});
it('leaves a root outside the home directory unabbreviated',async()=>{
 const backend=createTauriBackend(chromeLibraryReplay().bridge);
 const result=await backend.library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.scanned).toHaveLength(2);
 for(const root of result.value.scanned??[])expect(root).not.toContain('~');
 expect(result.value.scanned?.[0]).toMatch(/\/\.claude\/skills$/);
});
it('drops an absent root from the scanned line but keeps unreadable ones (L6)',async()=>{
 const absent=createTauriBackend(chromeLibraryReplay({local:value=>underHome(value,'absent')}).bridge);
 expect((await absent.library(global)).value?.scanned).toEqual(['~/.claude/skills']);
 const unreadable=createTauriBackend(chromeLibraryReplay({local:value=>underHome(value,'unreadable')}).bridge);
 expect((await unreadable.library(global)).value?.scanned).toEqual(['~/.claude/skills','~/code/seed']);
});
it('serves the four zero captions as app copy and grammatical install counts (L7, L9)',async()=>{
 const backend=createTauriBackend(chromeLibraryReplay().bridge);
 const result=await backend.library(global);
 expect(result.ok).toBe(true);if(!result.ok)throw new Error(result.error);
 expect(result.value.overview.zero).toEqual(overviewCopy);
 expect(result.value.skills.map(card=>card.name)).toEqual(['deploy-check']);
 for(const card of result.value.skills)expect(card.installs).toMatch(/^\d+ installs?$/);
});
it('shares the same scan coverage with Marketplace (M23)',async()=>{
 const backend=createTauriBackend(chromeLibraryReplay({local:value=>underHome(value,'absent')}).bridge);
 const catalog=await backend.catalog();
 expect(catalog.ok).toBe(true);if(!catalog.ok)throw new Error(catalog.error);
 expect(catalog.value.scanned).toEqual(['~/.claude/skills']);
 expect(catalog.value.scanned).toEqual((await backend.library(global)).value?.scanned);
});
