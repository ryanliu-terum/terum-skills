import { describe, expect, it } from 'vitest';
import { systemRunner } from '../runner.js';
import { temporaryDirectory } from './fixtures.js';

describe('systemRunner', () => {
  it('captures stdout, stderr, and the exit code, and never lets git prompt on a piped run', async () => {
    const cwd = await temporaryDirectory();
    const ok = await systemRunner.run('git', ['init', '-q'], { cwd });
    expect(ok).toEqual({ code: 0, stdout: '', stderr: '' });
    const failed = await systemRunner.run('git', ['rev-parse', '--verify', 'nope'], { cwd });
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain('fatal');
    const env = await systemRunner.run('git', ['var', 'GIT_COMMITTER_IDENT'], { cwd, env: { GIT_COMMITTER_NAME: 'Piped', GIT_COMMITTER_EMAIL: 'p@x.test' } });
    expect(env.stdout).toContain('Piped <p@x.test>');
    // vitest's own env sets GIT_TERMINAL_PROMPT=0, which would make this assertion vacuous; the child must see 0 because the runner injects it.
    const ambient = process.env.GIT_TERMINAL_PROMPT;
    process.env.GIT_TERMINAL_PROMPT = '1';
    try {
      const prompt = await systemRunner.run('git', ['-c', 'alias.p=!printf "%s" "$GIT_TERMINAL_PROMPT"', 'p'], { cwd });
      expect(prompt.stdout).toBe('0');
    } finally {
      if (ambient === undefined) delete process.env.GIT_TERMINAL_PROMPT; else process.env.GIT_TERMINAL_PROMPT = ambient;
    }
  });

  it('rejects with ENOENT when the tool is not installed instead of resolving a fake result', async () => {
    const missing = { ...systemRunner };
    await expect(missing.run('gh' as 'git', [], { env: { PATH: '/nonexistent' } })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('decodes multi-byte UTF-8 output correctly', async () => {
    const cwd = await temporaryDirectory();
    const result = await systemRunner.run('git', ['-c', 'alias.u=!printf "héllo wörld — ✓"', 'u'], { cwd });
    expect(result.stdout).toBe('héllo wörld — ✓');
  });
});
