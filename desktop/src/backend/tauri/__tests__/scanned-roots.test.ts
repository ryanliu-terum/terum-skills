import { expect, it } from 'vitest';
import { scannedRoots } from '../scanned-roots';
it('includes existing, unreadable and legacy roots but excludes absent roots',()=>{
 expect(scannedRoots({local:[{root:'/home/me/custom/skills',rootState:'scanned'},{root:'/home/me/missing',rootState:'absent'},{root:'/home/me/repo/.claude/skills',repoRoot:'/home/me/repo',rootState:'unreadable'},{root:'/outside/skills'}]},'/home/me')).toEqual(['~/custom/skills','~/repo','/outside/skills']);
});
it('handles missing sections and unknown home without inventing a path',()=>{
 expect(scannedRoots({},'/home/me')).toEqual([]);
 expect(scannedRoots({local:[{root:'/home/me/skills'}]},'')).toEqual(['/home/me/skills']);
});
it('abbreviates Windows homes and preserves neighboring prefixes',()=>{
 expect(scannedRoots({local:[{root:'C:/Users/me/skills'},{root:'C:/Users/me-other/skills'}]},'C:/Users/me')).toEqual(['~/skills','C:/Users/me-other/skills']);
});
