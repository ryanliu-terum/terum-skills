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

// sidebar-spacing (Teddy, 2026-09-10): the five values adopted from the realistic mock build. A revert of any one of
// them is a silent pixel regression that no jsdom test can see (vitest runs with css:false), so they are pinned here
// as text and again, as computed style, in e2e/routes/sidebar-spacing.spec.ts.
const escapeSelector = (selector: string): string => selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function soleRule(selector: string): string {
  // The boundary keeps `.nav-group` from matching inside `.sidebar-inner>.nav-group:nth-child(2)`.
  const matches = Array.from(css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escapeSelector(selector)}\\s*\\{([^{}]*)\\}`, 'g')));
  expect(matches, `expected exactly one "${selector}" rule in app.css`).toHaveLength(1);
  return matches[0]![1]!;
}

it('sizes the sidebar rows at the realistic mock’s 34px', () => {
  const body = soleRule('.nav-row');
  expect(body).toMatch(/(?:^|;)height:34px(?:;|$)/);
  expect(body).not.toMatch(/height:28px/);
});

it('gaps a nav group at 4px and the sidebar stack at 26px', () => {
  expect(soleRule('.nav-group')).toMatch(/(?:^|;)gap:4px(?:;|$)/);
  expect(soleRule('.sidebar-inner')).toMatch(/(?:^|;)gap:26px(?:;|$)/);
});

it('starts the sidebar 28px down, whichever padding shorthand is used', () => {
  const padding = /(?:^|;)padding:([^;]+)/.exec(soleRule('.sidebar-inner'))?.[1];
  expect(padding, 'the .sidebar-inner rule must declare a padding').toBeDefined();
  expect(padding!.trim().split(/\s+/)[0]).toBe('28px');
});

it('puts 56px above the Team group and scopes it to a direct child of .sidebar-inner', () => {
  const selector = '.sidebar-inner>.nav-group:nth-child(2)';
  expect(soleRule(selector)).toMatch(/(?:^|;)margin-top:56px(?:;|$)/);
  // Dropping the child combinator would match a second .nav-group anywhere in the app.
  expect(css).toContain(selector);
  expect(css).not.toMatch(/(?:^|[}\n])\s*\.nav-group:nth-child\(2\)\s*\{/);
});

it('keeps every sidebar margin on the Team rule alone', () => {
  expect(soleRule('.nav-group')).not.toMatch(/margin/);
  expect(soleRule('.sidebar-inner')).not.toMatch(/margin/);
});
