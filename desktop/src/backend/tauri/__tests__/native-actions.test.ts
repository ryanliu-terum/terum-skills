import { afterEach, expect, it, vi } from 'vitest';
import { openUrl, revealItemInDir, openPath } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createTauriBackend } from '../index';
import { fakeBridge } from './fake-bridge';
vi.mock('@tauri-apps/plugin-opener',()=>({openUrl:vi.fn(),revealItemInDir:vi.fn(),openPath:vi.fn()}));
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
it('routes URL and Finder actions through native plugins, expanding home in the seam',async()=>{
 const backend=createTauriBackend(fakeBridge(()=>{}).bridge);
 expect(await backend.openUrl('https://github.com/acme/team')).toEqual({ok:true,value:undefined});
 expect(openUrl).toHaveBeenCalledWith('https://github.com/acme/team');
 expect(await backend.revealPath('~/.terum/skills')).toEqual({ok:true,value:undefined});
 expect(revealItemInDir).toHaveBeenCalledWith('/Users/teddy/.terum/skills');
 await backend.openInEditor('~/Projects/skill');expect(openPath).toHaveBeenCalledWith('/Users/teddy/Projects/skill');
});
it('dispatches window actions without introducing a bridge command',async()=>{
 const toggleMaximize=vi.fn(),startDragging=vi.fn();vi.mocked(getCurrentWindow).mockReturnValue({toggleMaximize,startDragging} as unknown as ReturnType<typeof getCurrentWindow>);
 const f=fakeBridge(()=>{}),backend=createTauriBackend(f.bridge);
 expect(await backend.windowAction('toggle-maximize')).toEqual({ok:true,value:undefined});await backend.windowAction('start-drag');
 expect(toggleMaximize).toHaveBeenCalledOnce();expect(startDragging).toHaveBeenCalledOnce();expect(f.spawns).toHaveLength(0);
});
it('reports native failures through Results',async()=>{
 vi.mocked(openUrl).mockRejectedValue(new Error('Could not open URL'));vi.mocked(revealItemInDir).mockRejectedValue(new Error('Could not reveal path'));
 const backend=createTauriBackend(fakeBridge(()=>{}).bridge);
 expect(await backend.openUrl('https://github.com/acme/team')).toEqual({ok:false,error:'Could not open URL'});
 expect(await backend.revealPath('/a')).toEqual({ok:false,error:'Could not reveal path'});
});
