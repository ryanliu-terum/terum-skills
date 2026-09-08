import { it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { join, relative } from 'node:path';
function imports(text:string):string[]{
 const found:string[]=[];const source=ts.createSourceFile('source.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(node:ts.Node){
  const specifier=ts.isImportDeclaration(node)||ts.isExportDeclaration(node)?node.moduleSpecifier:ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword?node.arguments[0]:undefined;
  if(specifier&&ts.isStringLiteralLike(specifier))found.push(specifier.text);
  ts.forEachChild(node,visit);
 }
 visit(source);return found;
}
const builtins=/^(?:node:|fs$|fs\/promises$|path$|os$|child_process$|net$|http$|https$|worker_threads$)/;
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
it('keeps native I/O, mock imports and platform probes behind the seam',()=>{
 const source=files('src').filter(p=>/\.(tsx?|md)$/.test(p)).map(path=>({path:relative('.',path),text:readFileSync(path,'utf8')}));
 const native='@tauri'+'-apps';const probe='is'+'Tauri(';
 expect(source.filter(f=>!f.path.startsWith('src/backend/tauri/')&&f.text.includes(native)).map(f=>f.path)).toEqual([]);
 expect(source.filter(f=>!f.path.startsWith('src/backend/')&&!/\.test\./.test(f.path)&&imports(f.text).some(path=>/backend\/(?:mock|tauri)|fixtures\//.test(path)||path.startsWith(native))).map(f=>f.path)).toEqual([]);
 expect(source.filter(f=>!f.path.startsWith('src/backend/tauri/')&&!/\.test\./.test(f.path)&&imports(f.text).some(path=>builtins.test(path))).map(f=>f.path)).toEqual([]);
 expect(source.filter(f=>f.text.includes(probe)).map(f=>f.path)).toEqual([]);
});

const eslint=new ESLint();
it.each(['../../backend/mock','../../backend/mock/data','../../backend/tauri','../../backend/tauri/client','../../fixtures/design.json','@tauri'+'-apps/api'])('blocks static and dynamic seam imports of %s',async path=>{
 for(const code of [`import '${path}';`,`void import('${path}');`]){
  const [result]=await eslint.lintText(code,{filePath:'src/screens/library/Probe.ts'});
  expect(result?.messages.some(message=>message.ruleId==='no-restricted-imports'||message.ruleId==='no-restricted-syntax'),code).toBe(true);
  expect(imports(code)).toEqual([path]);
 }
});
it.each(['node:fs','fs','fs/promises','path','os','child_process','net','http','https','worker_threads'])('blocks static and dynamic built-in imports of %s outside tauri',async path=>{
 for(const filePath of ['src/screens/library/Probe.ts','src/backend/mock/probe.ts','src/fixtures/probe.ts']){
  for(const code of [`import '${path}';`,`void import('${path}');`]){
   const [result]=await eslint.lintText(code,{filePath});
   expect(result?.messages.some(message=>message.message.includes('no I/O outside the seam')),filePath+': '+code).toBe(true);
   expect(imports(code).some(specifier=>builtins.test(specifier))).toBe(true);
  }
 }
});
it('allows native adapter I/O, test I/O and public backend imports',async()=>{
 for(const [filePath,code] of [
  ['src/backend/tauri/probe.ts',"import 'node:fs'; void import('fs/promises');"],
  ['src/components/domain/probe.test.ts',"import 'node:fs'; void import('../../backend/mock');"],
  ['src/screens/library/Probe.ts',"import '../../backend'; import '../../backend/types';"],
 ]){
  if(!filePath||!code)throw new Error('Expected lint fixture');
  const [result]=await eslint.lintText(code,{filePath});expect(result?.messages).toEqual([]);
 }
});
