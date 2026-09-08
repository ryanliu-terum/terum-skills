import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
const paths = [{name:'react-router-dom',message:'v8 removed it; import from react-router'}, {name:'lucide-react',message:'Use the design ICON_PATHS.'}];
const ioPatterns=[{group:['node:*','fs','fs/promises','path','os','child_process','net','http','https','worker_threads'],message:'no I/O outside the seam'}];
const ioSyntax={selector:'ImportExpression[source.value=/^(node:|fs$|fs\\u002fpromises$|path$|os$|child_process$|net$|http$|https$|worker_threads$)/]',message:'no I/O outside the seam'};
const seamSyntax={selector:'ImportExpression[source.value=/backend\\u002f(mock|tauri)|fixtures\\u002f|@tauri-apps/]',message:'the D23 seam: screens import src/backend/types and src/backend/index only'};
const seam = 'the D23 seam: screens import src/backend/types and src/backend/index only';
export default tseslint.config(
 {ignores:['dist/**','node_modules/**','e2e/out/**','src/fixtures/design.json','src-tauri/**']},
 js.configs.recommended, tseslint.configs.recommended,
 {rules:{'no-restricted-imports':['error',{paths}]}},
 {files:['e2e/**','tools/**','*.config.*'],languageOptions:{globals:globals.node}},
 {files:['src/**/*.{ts,tsx}'],languageOptions:{globals:globals.browser},plugins:{'react-hooks':hooks,'react-refresh':refresh},rules:{...hooks.configs.recommended.rules,'no-restricted-globals':['error',{name:'process',message:'Node globals stay outside src/.'}],'react-refresh/only-export-components':['error',{allowConstantExport:true}]}},
 {files:['src/**/*.{ts,tsx}'],ignores:['src/backend/tauri/**','**/*.test.*'],rules:{'no-restricted-imports':['error',{paths,patterns:ioPatterns}],'no-restricted-syntax':['error',ioSyntax]}},
 {files:['src/**/*.{ts,tsx}'],ignores:['src/backend/**','**/*.test.*'],rules:{'no-restricted-imports':['error',{paths,patterns:[...ioPatterns,{group:['@tauri-apps/*','**/backend/mock/**','**/backend/mock','**/backend/tauri/**','**/backend/tauri','**/fixtures/**','@/backend/mock*','@/fixtures*'],message:seam}]}],'no-restricted-syntax':['error',ioSyntax,seamSyntax]}},
 {files:['src/backend/**/*.{ts,tsx}'],ignores:['src/backend/tauri/**','**/*.test.*'],rules:{'no-restricted-imports':['error',{paths,patterns:[...ioPatterns,{group:['@tauri-apps/*'],message:seam}]}]}},
 {files:['src/components/domain/Shell.tsx'],rules:{'react-refresh/only-export-components':['error',{allowExportNames:['useShellReady']}]}}, // The readiness hook shares Shell's context without adding a component boundary.
 {files:['src/app/routes.tsx'],rules:{'react-refresh/only-export-components':'off'}}, // Route objects intentionally hold component elements for the single route table.
 {files:['**/*.test.*'],languageOptions:{globals:globals.node}}
);
