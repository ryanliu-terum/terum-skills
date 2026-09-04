// ESLint flat config. Vendored skillhub code (src/lib/placer/vendor/) is third-party and is
// not linted against our rules; it keeps upstream's style and its attribution header.
// .claude/ and .planning/ are the Claude Code harness and planning docs, not product code.
import tseslint from 'typescript-eslint';

// §3 / §12 "prompter": a verb or lib module never talks to a human except through the Prompter.
// Banned, in every spelling the tests probe: the readline/process/console modules (static and
// dynamic import), the console global, process.stdin/stdout/stderr, reaching them via globalThis,
// and aliasing `process` into a local first. src/lib/prompt.ts is the one implementation of the
// channel and src/index.ts is the bin entry that owns the exit code; both are exempt.
const IO_MODULES = '^(node:)?(readline(/promises)?|process|console)$';
// esquery regex literals end at the first unescaped slash.
const IO_MODULES_SELECTOR = IO_MODULES.replace('/', '\\/');
const PROMPTER_BOUNDARY = {
  files: ['src/**/*.ts'],
  ignores: ['src/lib/prompt.ts', 'src/index.ts', 'src/lib/placer/vendor/**', 'src/**/__tests__/**'],
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ regex: IO_MODULES, message: 'Use the Prompter (src/lib/prompt.ts).' }] }],
    'no-restricted-globals': ['error', { name: 'console', message: 'Use Prompter.print instead.' }],
    'no-restricted-properties': ['error',
      { object: 'process', property: 'stdin', message: 'Use the Prompter instead.' },
      { object: 'process', property: 'stdout', message: 'Use the Prompter instead.' },
      { object: 'process', property: 'stderr', message: 'Use the Prompter instead.' },
      { object: 'globalThis', property: 'console', message: 'Use Prompter.print instead.' },
      { object: 'globalThis', property: 'process', message: 'Use the Prompter instead.' },
    ],
    'no-restricted-syntax': ['error',
      { selector: `ImportExpression[source.value=/${IO_MODULES_SELECTOR}/]`, message: 'Use the Prompter (src/lib/prompt.ts).' },
      { selector: `CallExpression[callee.name='require'][arguments.0.value=/${IO_MODULES_SELECTOR}/]`, message: 'Use the Prompter (src/lib/prompt.ts).' },
      { selector: "VariableDeclarator[init.name='process']", message: 'Do not alias process; use the Prompter for I/O.' },
      { selector: "VariableDeclarator[init.name='globalThis']", message: 'Do not alias globalThis; use the Prompter for I/O.' },
      { selector: "VariableDeclarator[id.type='ObjectPattern'][init.name='process']", message: 'Do not destructure process; use the Prompter for I/O.' },
      { selector: "MemberExpression[object.name='globalThis'][property.name=/^(console|process)$/]", message: 'Use the Prompter instead.' },
      { selector: "MemberExpression[object.type='MemberExpression'][object.object.name='globalThis']", message: 'Use the Prompter instead.' },
    ],
  },
};

export default [
  { ignores: ['dist/**', 'node_modules/**', '.claude/**', '.planning/**', 'src/lib/placer/vendor/**'] },
  ...tseslint.configs.recommended,
  PROMPTER_BOUNDARY,
];
