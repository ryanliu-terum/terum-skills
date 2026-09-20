import { describe, expect, it } from 'vitest';
import { shellArg } from '../cells.js';

describe('render/cells', () => {
  it('shellArg leaves a SAFE_ARG token raw for invocation() and hands anything else to it as a plain string to shell-quote', () => {
    expect(shellArg('deploy')).toEqual({ raw: 'deploy' });
    expect(shellArg('deploy check')).toBe('deploy check');
  });
});
