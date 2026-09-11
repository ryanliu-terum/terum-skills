import { afterEach, expect, it } from 'vitest';
import { createMockBackend } from './index';
import { RAW_MD } from './raw-md';

afterEach(() => { location.hash = ''; localStorage.clear(); });

it('splits the raw document at its closing fence and preserves the default fixture', async () => {
  location.hash = '#/skill/deploy-check';
  const fixture = await createMockBackend().skill({ ref: 'deploy-check' });
  if (!fixture.ok) throw new Error(fixture.error);
  const frontmatter = fixture.value.skillMd.frontmatter;
  expect(frontmatter).toMatch(/^---\n[\s\S]+\n---$/);
  expect(RAW_MD.startsWith(frontmatter + '\n\n')).toBe(true);

  location.hash = '#/skill/deploy-check?__mock=raw-md';
  const raw = await createMockBackend().skill({ ref: 'deploy-check' });
  if (!raw.ok) throw new Error(raw.error);
  expect(raw.value.skillMd).toEqual({ frontmatter, body: [], markdown: RAW_MD.slice(frontmatter.length + 1) });
  expect(raw.value.skillMd.markdown).toContain('\n---\n\n### Steps');

  location.hash = '#/skill/deploy-check';
  const unchanged = await createMockBackend().skill({ ref: 'deploy-check' });
  if (!unchanged.ok) throw new Error(unchanged.error);
  expect(unchanged.value.skillMd).toEqual(fixture.value.skillMd);
});
