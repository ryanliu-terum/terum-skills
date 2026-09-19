import type { Result } from './types';
export function imageFile(png:Blob,name:string):File {
 if(png.type!=='image/png'||png.size===0||png.size>20*1024*1024)throw new Error('Expected a PNG image smaller than 20 MB.');
 if(!/^[a-zA-Z0-9_-]{1,100}\.png$/.test(name))throw new Error('Invalid PNG filename.');
 return new File([png],name,{type:'image/png'});
}
export function canShareImage(png:Blob):boolean {
 try{return typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[imageFile(png,'benchmark.png')]});}
 catch{return false; /* An unsupported file or host means the explicit copy/save actions are used. */}
}
export async function shareImage(png:Blob,name:string):Promise<Result<void>> {
 try{
  if(!canShareImage(png))return {ok:false,error:'Native image sharing is unavailable. Choose a destination, copy, or save the PNG.'};
  await navigator.share({files:[imageFile(png,name)]});return {ok:true,value:undefined};
 }catch(error){return typeof error==='object'&&error!==null&&'name' in error&&error.name==='AbortError'?{ok:false,cancelled:true,error:'Sharing cancelled.'}:{ok:false,error:error instanceof Error?error.message:'Could not share the PNG.'};}
}
export async function saveBrowserImage(png:Blob,name:string):Promise<Result<void>> {
 let url:string|undefined;
 try{
  imageFile(png,name);url=URL.createObjectURL(png);
  const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.append(a);
  try{a.click();}finally{a.remove();}
  return {ok:true,value:undefined};
 }catch(error){return {ok:false,error:error instanceof Error?error.message:'Could not save the PNG.'};}
 finally{if(url){const allocated=url;setTimeout(()=>URL.revokeObjectURL(allocated),60_000);}}
}
