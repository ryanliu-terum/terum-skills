import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

// docs/ui-policy.md §1 and §7: a command the app prints is copyable, so it renders only through the primitives that
// carry a copy. Pure modules that BUILD command strings (bulk-eval.ts, skill-card-actions.ts, the mock) are not
// surfaces and are exempt; a component file that contains a command string must import a copyable primitive.
const COMMAND = /npx -y terum-skills@latest|gh auth (login|logout)/;
const PRIMITIVES = /\b(CliBox|TerminalHint|CollapsibleCommand|AdviceBlock|WorkflowDialog|ShareBlock)\b/;
const surfaces = () => [...ts.sys.readDirectory('src/screens', ['.tsx'], undefined, ['**/*.tsx']), ...ts.sys.readDirectory('src/components', ['.tsx'], undefined, ['**/*.tsx']), ...ts.sys.readDirectory('src/app', ['.tsx'], undefined, ['**/*.tsx'])].filter(path => !/\.test\.tsx$/.test(path) && !path.includes('__tests__'));

it('a component that prints a command imports a copyable command primitive (docs/ui-policy.md §1)', () => {
  const offenders = surfaces().filter(path => { const source = readFileSync(path, 'utf8'); return COMMAND.test(source) && !PRIMITIVES.test(source); });
  expect(offenders).toEqual([]);
});

it('no surface renders a bare <pre> that is not a log pane with a copy menu (docs/ui-policy.md §1)', () => {
  // A <pre> is allowed only when it carries role="log" (the streaming pane, whose ref is the copy menu) or is the
  // SKILL.md renderer's code block, which is user-selectable by the `pre` rule in app.css.
  const offenders = surfaces().filter(path => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(/<pre\b[^>]*>/g)].some(match => !/role="log"/.test(match[0]) && !/className="md-code/.test(match[0]));
  });
  expect(offenders).toEqual([]);
});

it('no surface renders a bare role="alert" div with the settings error class — it is an AlertText (docs/ui-policy.md §1)', () => {
  const offenders = surfaces().filter(path => /<div role="alert" className="settings-action-error"/.test(readFileSync(path, 'utf8')));
  expect(offenders).toEqual([]);
});

it('the policy document names every primitive the guard accepts', () => {
  const policy = readFileSync('docs/ui-policy.md', 'utf8');
  for (const name of ['CliBox', 'TerminalHint', 'CollapsibleCommand', 'AdviceBlock', 'PathText', 'AlertText', 'ErrorLine', 'useCopyMenu', 'skillRootLabel', 'reasonHeading', 'runStatus']) expect(policy).toContain(name);
});
