import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pythonAvailable = spawnSync('python3', ['--version']).status === 0;
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(join(tmpdir(), 'terum-export-design-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!pythonAvailable)(pythonAvailable ? 'export-design configuration errors' : 'export-design configuration errors (python3 not found)', () => {
  it('fails without a configured design directory and without a traceback', () => {
    const env = { ...process.env };
    delete env.TERUM_DESIGN_DIR;
    const result = spawnSync('python3', ['tools/export-design.py', '--check'], { cwd, env, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('TERUM_DESIGN_DIR is not set');
    expect(result.stderr).not.toContain('Traceback');
  });

  it('fails when --design has no build.py and without a traceback', () => {
    const env = { ...process.env };
    delete env.TERUM_DESIGN_DIR;
    const result = spawnSync('python3', ['tools/export-design.py', '--check', '--design', dir], { cwd, env, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`no build.py under ${dir}`);
    expect(result.stderr).not.toContain('Traceback');
  });
});
