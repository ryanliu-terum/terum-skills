import { invoke } from '@tauri-apps/api/core';
import type { Result } from '../types';
import { imageFile } from '../image-sharing';
export async function saveNativeImage(png:Blob,name:string):Promise<Result<void>> {
 try{
  imageFile(png,name);
  const saved=await invoke<boolean>('save_share_image',{name,bytes:Array.from(new Uint8Array(await png.arrayBuffer()))});
  return saved?{ok:true,value:undefined}:{ok:false,cancelled:true,error:'Saving cancelled.'};
 }catch(error){return {ok:false,error:error instanceof Error?error.message:String(error)};}
}
