import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('src/styles/app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// S1b-2-fix3: fixed dialog layers disable Chromium LCD text and break workflow dialog fidelity.
it.each(['dialog-backdrop', 'dialog-popup'])('keeps .%s free of fixed positioning', className => {
  const rules = Array.from(css.matchAll(new RegExp(`\\.${className}\\s*\\{([^{}]*)\\}`, 'g')));
  expect(rules.length).toBeGreaterThan(0);
  for (const rule of rules) {
    expect(rule[1]).not.toMatch(/\bposition\s*:\s*fixed\b/i);
  }
});
