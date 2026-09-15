import { describe, expect, it } from 'vitest';
import { adviceCommands, splitAdvice } from './advice';

describe('splitAdvice', () => {
  it('turns the CLI indent into command segments and keeps the prose as text', () => {
    expect(splitAdvice(['Cache request recorded as: terum-skills@latest', "To request the registry's latest release, run:", '  npx -y terum-skills@latest <command>', 'This does not update other local or global installations.'])).toEqual([
      { kind: 'text', text: 'Cache request recorded as: terum-skills@latest' },
      { kind: 'text', text: "To request the registry's latest release, run:" },
      { kind: 'command', text: 'npx -y terum-skills@latest <command>' },
      { kind: 'text', text: 'This does not update other local or global installations.' },
    ]);
  });
  it('drops blank lines and trims tabs as well as spaces', () => {
    expect(splitAdvice(['', '\tnpm run build', '   '])).toEqual([{ kind: 'command', text: 'npm run build' }]);
  });
  it('yields nothing for empty advice', () => {
    expect(splitAdvice([])).toEqual([]);
    expect(adviceCommands([])).toEqual([]);
  });
  it('lists every command in order', () => {
    expect(adviceCommands(['a', '  one', 'b', '  two'])).toEqual(['one', 'two']);
  });
});
