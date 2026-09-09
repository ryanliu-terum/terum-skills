import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('never sends shell commands or URLs to the editor and exposes no workflow open helper',()=>{
 const workflow='src/components/domain/useWorkflow.ts';
 const paths=[...ts.sys.readDirectory('src/screens',['.tsx'],undefined,['**/*.tsx']),workflow];
 const commandOpener=/openInEditor\(\s*['"`](npx |gh |https:\/\/)/;
 expect(paths.filter(path=>commandOpener.test(readFileSync(path,'utf8')))).toEqual([]);
 expect(readFileSync(workflow,'utf8')).not.toMatch(/return\s*\{[^}]*\bopen\s*:/);
});
