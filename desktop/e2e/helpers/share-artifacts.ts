import { createHash } from 'node:crypto';
import { renameSync, writeFileSync, rmSync } from 'node:fs';
import { PNG } from 'pngjs';

/** Validate every PNG chunk/scanline before atomically replacing a preview a viewer may have open. */
export function publishSharePng(path:string,bytes:Buffer):string {
 PNG.sync.read(bytes,{checkCRC:true});
 const hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
 const versioned=path.replace(/\.png$/,`-${hash}.png`);
 publishShareFile(versioned,bytes);publishShareFile(path,bytes);
 return versioned;
}
export function publishShareFile(path:string,bytes:string|Buffer):void {
 const staging=path+'.pending';
 try{writeFileSync(staging,bytes);renameSync(staging,path);}
 finally{rmSync(staging,{force:true});}
}
