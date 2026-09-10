/** Root and path comparison for paths the CLI emitted. `ls --local` builds every path with
 *  node:path.join (src/lib/placer/agent-paths.ts:11-12, src/lib/local-skills.ts:121), so a Windows
 *  payload is `C:\…\.claude\skills\x` and a WSL one is `\\wsl.localhost\…\x`, while a POSIX payload
 *  is `/…/x`. These helpers compare the two spellings as one. They are pure string functions: no
 *  node:path, no platform probe, so screens may use them (desktop/AGENTS.md invariant 1). */

/** One spelling: every run of separators becomes a single `/`, and trailing separators are dropped.
 *  Casing is deliberately untouched — the section root and the row path in one `ls --local` payload
 *  always share a spelling, and lower-casing would be wrong on POSIX and on WSL. */
export function normalizeSeparators(path:string):string{return path.replace(/[\\/]+/g,'/').replace(/\/+$/,'');}

/** True when both strings name the same folder, whatever separators or trailing slashes they carry.
 *  Two empty strings are the same folder — callers that must reject an empty root use isUnderRoot. */
export function samePath(a:string,b:string):boolean{return normalizeSeparators(a)===normalizeSeparators(b);}

/** True when `path` is `root` itself or sits underneath it. An empty root matches nothing, so a
 *  section with no root cannot swallow the whole machine; a sibling whose name merely starts with
 *  the root's (`/repo-two` under `/repo`) is not inside it, because the boundary `/` is required. */
export function isUnderRoot(path:string,root:string):boolean{
 const a=normalizeSeparators(path),b=normalizeSeparators(root);
 return b!==''&&(a===b||a.startsWith(b+'/'));
}
