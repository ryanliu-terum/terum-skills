import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorLine } from './Primitives';

// The real adapter joins several CLI failures with '\n' (backend/tauri/index.ts `errors.join('\n')`, and
// status/search/invite in the CLI do the same). The error cards' ErrorLine must keep those line breaks:
// without `white-space: pre-wrap` the browser collapses them into one run-on paragraph. vitest runs with
// css:false, so the rule is pinned as text here and the newline survives the DOM as a second check.
const css = readFileSync('src/components/domain/Primitives.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function soleRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = Array.from(css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^{}]*)\\}`, 'g')));
  expect(matches, `expected exactly one "${selector}" rule in Primitives.css`).toHaveLength(1);
  return matches[0]![1]!;
}

describe('ErrorLine', () => {
  it('preserves the CLI’s line breaks and still wraps long tokens', () => {
    const body = soleRule('.board-error-line');
    expect(body).toMatch(/(?:^|;)white-space:pre-wrap(?:;|$)/);
    expect(body).toMatch(/(?:^|;)overflow-wrap:anywhere(?:;|$)/);
    expect(body).not.toMatch(/white-space:nowrap/);
  });

  it('renders a multi-line error with its newline intact', () => {
    render(<ErrorLine>{'fatal: could not read Username\nfatal: unable to access the team clone'}</ErrorLine>);
    const line = screen.getByText(/could not read Username/);
    expect(line).toHaveClass('board-error-line');
    expect(line.textContent).toBe('fatal: could not read Username\nfatal: unable to access the team clone');
  });
});
