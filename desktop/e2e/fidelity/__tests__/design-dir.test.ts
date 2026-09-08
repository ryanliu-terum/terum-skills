import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { oraclePath, resolveDesignDir } from '../design-dir';

const dir = mkdtempSync(join(tmpdir(), 'terum-design-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveDesignDir', () => {
  it('returns undefined when TERUM_DESIGN_DIR is unset', () => {
    expect(resolveDesignDir({})).toBeUndefined();
  });

  it('returns undefined when TERUM_DESIGN_DIR is blank', () => {
    expect(resolveDesignDir({ TERUM_DESIGN_DIR: '  ' })).toBeUndefined();
  });

  it('rejects a configured directory that does not exist', () => {
    const missing = join(tmpdir(), `terum-design-missing-${randomUUID()}`);
    expect(() => resolveDesignDir({ TERUM_DESIGN_DIR: missing })).toThrow(
      `TERUM_DESIGN_DIR points at a missing directory: ${missing}`,
    );
  });

  it('resolves a configured directory and its oracle paths', () => {
    const expected = { dir, shots: join(dir, '.shots') };
    expect(resolveDesignDir({ TERUM_DESIGN_DIR: dir })).toEqual(expected);
    expect(resolveDesignDir({ TERUM_DESIGN_DIR: `  ${dir}  ` })).toEqual(expected);
    expect(oraclePath(expected.shots, 'Main')).toBe(join(dir, '.shots', 'Main.png'));
  });
});
