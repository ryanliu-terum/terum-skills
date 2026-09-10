import { expect,it } from 'vitest';
import { isUnderRoot,normalizeSeparators,samePath } from './skill-path';
it('collapses every separator run and trailing separator into one spelling',()=>{
 for(const [input,expected] of [['/a/b','/a/b'],[String.raw`C:\a\b`,'C:/a/b'],[String.raw`\\wsl.localhost\Ubuntu\home\t`,'/wsl.localhost/Ubuntu/home/t'],['/a//b///','/a/b'],[String.raw`/a\b/c`,'/a/b/c'],['',''],['/',''],[String.raw`\\`,'']] as const)expect(normalizeSeparators(input)).toBe(expected);
});
it('keeps case, because both sides come from one ls --local payload',()=>{expect(normalizeSeparators('/A/b')).toBe('/A/b');expect(samePath('/a/b','/A/b')).toBe(false);});
it('matches a folder under its root on POSIX, Windows and WSL UNC spellings',()=>{
 for(const [root,path] of [['/repo','/repo/.claude/skills/x'],[String.raw`C:\Users\t\Projects\terum`,String.raw`C:\Users\t\Projects\terum\.claude\skills\x`],[String.raw`\\wsl.localhost\Ubuntu\home\teniroo`,String.raw`\\wsl.localhost\Ubuntu\home\teniroo\.claude\skills\adopt-agent-tooling`],['/repo/',String.raw`\repo\.claude\skills\x`]] as const)expect(isUnderRoot(path,root)).toBe(true);
});
it('refuses a sibling whose name merely starts with the root',()=>{expect(isUnderRoot('/repo-two/.claude/skills/x','/repo')).toBe(false);expect(isUnderRoot(String.raw`C:\repo-two\x`,String.raw`C:\repo`)).toBe(false);});
it('treats a path equal to its root as inside it, and an empty root as matching nothing',()=>{
 expect(isUnderRoot('/repo','/repo')).toBe(true);expect(isUnderRoot('/repo/','/repo')).toBe(true);
 expect(isUnderRoot('/anything','')).toBe(false);expect(isUnderRoot('/anything','/')).toBe(false);expect(isUnderRoot('','')).toBe(false);
});
it('compares two paths for the same folder across spellings and trailing slashes',()=>{expect(samePath('/a/b/','/a/b')).toBe(true);expect(samePath(String.raw`C:\a\b`,'C:/a/b')).toBe(true);expect(samePath('/a/b','/a/bc')).toBe(false);});
