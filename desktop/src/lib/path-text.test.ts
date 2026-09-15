import { describe, expect, it } from 'vitest';
import { pathBase, pathDir, pathSeparator, shortenPath, skillRootLabel } from './path-text';

const unc = '\\\\wsl.localhost\\Ubuntu\\home\\teniroo\\.claude\\skills\\decision-walk';
const project = '\\\\wsl.localhost\\Ubuntu\\home\\teniroo\\Projects\\terum\\.claude\\skills\\handoff';

describe('path pieces', () => {
  it('picks the separator the path actually uses', () => {
    expect(pathSeparator(unc)).toBe('\\');
    expect(pathSeparator('/home/x/.claude/skills/a')).toBe('/');
    expect(pathSeparator('name-only')).toBe('/');
  });
  it('splits base and dir so they re-form the path', () => {
    expect(pathBase(unc)).toBe('decision-walk');
    expect(pathDir(unc) + pathBase(unc)).toBe(unc);
    expect(pathBase('/a/b/')).toBe('b');
    expect(pathBase('plain')).toBe('plain');
    expect(pathDir('plain')).toBe('');
  });
});

describe('shortenPath', () => {
  it('returns a short path untouched', () => { expect(shortenPath('/a/b', 40)).toBe('/a/b'); });
  it('keeps the folder name whole and cuts the middle', () => {
    const short = shortenPath(unc, 40);
    expect(short.length).toBeLessThanOrEqual(40);
    expect(short.endsWith('decision-walk')).toBe(true);
    expect(short.startsWith('\\\\wsl.localhost')).toBe(true);
    expect(short).toContain('…');
  });
  it('falls back to the base name when even that barely fits', () => {
    expect(shortenPath(unc, 10)).toBe('…sion-walk');
  });
});

describe('skillRootLabel', () => {
  it('names the home skills folder Global', () => {
    expect(skillRootLabel(unc)).toBe('Global');
    expect(skillRootLabel('/home/t/.claude/skills/x')).toBe('Global');
    expect(skillRootLabel('/Users/t/.claude/skills/x')).toBe('Global');
    expect(skillRootLabel('C:\\Users\\teddy\\.claude\\skills\\x')).toBe('Global');
    expect(skillRootLabel('~/.claude/skills/x')).toBe('Global');
  });
  it('names a project by its folder', () => {
    expect(skillRootLabel(project)).toBe('terum');
    expect(skillRootLabel('/srv/app/.claude/skills/x')).toBe('app');
  });
  it('falls back to the parent folder when the path is not under .claude/skills', () => {
    expect(skillRootLabel('/tmp/somewhere/x')).toBe('somewhere');
    expect(skillRootLabel('x')).toBe('—');
  });
});
