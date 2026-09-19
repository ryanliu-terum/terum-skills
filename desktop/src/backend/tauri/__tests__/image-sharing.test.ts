import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { saveNativeImage } from '../image-sharing';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
const png=new Blob(['png'],{type:'image/png'});
// jsdom's Blob lacks arrayBuffer; this emulates the browser's immutable byte read.
Object.defineProperty(png,'arrayBuffer',{value:async()=>new Uint8Array([137,80,78,71]).buffer});
it('sends image bytes to the native save dialog, never a destination path',async()=>{vi.mocked(invoke).mockResolvedValue(true);expect(await saveNativeImage(png,'test.png')).toEqual({ok:true,value:undefined});expect(invoke).toHaveBeenCalledWith('save_share_image',{name:'test.png',bytes:[137,80,78,71]});});
it('handles save cancellation and filesystem failure',async()=>{vi.mocked(invoke).mockResolvedValue(false);expect(await saveNativeImage(png,'x.png')).toMatchObject({ok:false,cancelled:true});vi.mocked(invoke).mockRejectedValue('Disk full');expect(await saveNativeImage(png,'x.png')).toEqual({ok:false,error:'Disk full'});});
it('rejects unsafe filenames before invoking native code',async()=>{expect((await saveNativeImage(png,'../x.png')).ok).toBe(false);expect(invoke).not.toHaveBeenCalled();});
