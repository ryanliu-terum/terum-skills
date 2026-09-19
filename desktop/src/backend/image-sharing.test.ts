import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareImage, imageFile, saveBrowserImage, shareImage } from './image-sharing';
const png=new Blob(['png'],{type:'image/png'});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('image sharing',()=>{
 it('validates images and filenames',()=>{expect(()=>imageFile(new Blob([],{type:'image/png'}),'x.png')).toThrow();expect(()=>imageFile(new Blob(['x']),'x.png')).toThrow();expect(()=>imageFile(png,'../x.png')).toThrow();expect(imageFile(png,'skill.png').name).toBe('skill.png');});
 it('enforces the same filename length limit as native saving',()=>{expect(imageFile(png,'a'.repeat(100)+'.png').name).toHaveLength(104);expect(()=>imageFile(png,'a'.repeat(101)+'.png')).toThrow('Invalid PNG filename');});
 it('detects unsupported native sharing',async()=>{vi.stubGlobal('navigator',{});expect(canShareImage(png)).toBe(false);expect((await shareImage(png,'x.png')).ok).toBe(false);});
 it('passes the PNG file to the system sheet',async()=>{const share=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{canShare:()=>true,share});expect(await shareImage(png,'skill.png')).toEqual({ok:true,value:undefined});expect(share.mock.calls[0]?.[0].files[0]).toMatchObject({name:'skill.png',type:'image/png'});});
 it('treats cancellation separately from errors',async()=>{vi.stubGlobal('navigator',{canShare:()=>true,share:vi.fn().mockRejectedValue(new DOMException('cancel','AbortError'))});expect(await shareImage(png,'x.png')).toMatchObject({ok:false,cancelled:true});vi.stubGlobal('navigator',{canShare:()=>true,share:vi.fn().mockRejectedValue(new Error('Permission denied'))});expect(await shareImage(png,'x.png')).toEqual({ok:false,error:'Permission denied'});});
 it('catches capability probe failures',()=>{vi.stubGlobal('navigator',{share:vi.fn(),canShare:()=>{throw new Error('Not supported');}});expect(canShareImage(png)).toBe(false);});
 it('rejects invalid browser downloads',async()=>{expect((await saveBrowserImage(png,'bad/name.png')).ok).toBe(false);});
});
