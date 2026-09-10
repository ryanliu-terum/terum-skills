import { expect, it } from 'vitest';
import { bodyExcerpt } from './body-excerpt';

it('returns null for a null or empty body', () => {
  expect(bodyExcerpt(null)).toBeNull();
  expect(bodyExcerpt('')).toBeNull();
  expect(bodyExcerpt('\n\n  \n')).toBeNull();
});

it('takes the first paragraph, dropping a leading H1 and leading blank lines', () => {
  expect(bodyExcerpt('\n\n# deploy-check\n\nChecks the deploy pipeline\nbefore every release.\n\nSecond paragraph.')).toBe('Checks the deploy pipeline before every release.');
});

it('keeps deeper headings: only an H1 is a title', () => {
  expect(bodyExcerpt('## When to use\n\nBody.')).toBe('## When to use');
});

it('returns null when the body is only an H1', () => {
  expect(bodyExcerpt('# Live body\n')).toBeNull();
});

it('normalizes CRLF line endings', () => {
  expect(bodyExcerpt('# T\r\n\r\nFirst line.\r\nSecond line.\r\n\r\nRest.')).toBe('First line. Second line.');
});

it('takes the first three non-empty lines when the body opens with a list', () => {
  expect(bodyExcerpt('- first item\n- second item\n\n- third item\n- fourth item')).toBe('first item second item third item');
  expect(bodyExcerpt('1. one\n2) two\n3. three\n4. four')).toBe('one two three');
});

it('flattens inline markdown: emphasis, code, links and blockquote markers', () => {
  expect(bodyExcerpt('> Run **terum** with `sync --prune` — see [the docs](https://example.com) or *ask*.')).toBe('Run terum with sync --prune — see the docs or ask.');
});

it('collapses interior whitespace to single spaces', () => {
  expect(bodyExcerpt('A   spaced\tout\nparagraph.')).toBe('A spaced out paragraph.');
});

it('clamps to about 200 characters with an ellipsis', () => {
  const excerpt = bodyExcerpt('word '.repeat(80))!;
  expect(excerpt.length).toBeLessThanOrEqual(200);
  expect(excerpt.endsWith('…')).toBe(true);
  expect(bodyExcerpt('short body')).toBe('short body');
});
