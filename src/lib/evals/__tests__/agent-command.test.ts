import { describe, expect, it } from 'vitest';
import { resolveAgentCommand, shimScripts, type AgentCommandEvidence } from '../agent-command.js';

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const ARGS = ['-p', 'line one\nline two "quoted" %PATH% ^caret', '--output-format', 'json'];

function evidence(files: readonly string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform = 'win32'): AgentCommandEvidence {
  const present = new Set(files.map((file) => file.toLowerCase()));
  return { platform, env, execPath: NODE, isFile: (path) => present.has(path.toLowerCase()) };
}

describe('resolveAgentCommand', () => {
  it.each(['darwin', 'linux'] as const)('spawns the name unchanged on %s even with an empty PATH', (platform) => {
    expect(resolveAgentCommand('claude', ARGS, evidence([], { PATH: '' }, platform))).toEqual({ ok: true, value: { file: 'claude', args: ARGS } });
    expect(resolveAgentCommand('/tmp/stub.sh', ARGS, evidence([], {}, platform))).toEqual({ ok: true, value: { file: '/tmp/stub.sh', args: ARGS } });
  });

  it('walks PATH in order and spawns a native claude.exe directly', () => {
    const env = { Path: 'C:\\Windows\\System32;"C:\\Users\\teddy\\.local\\bin";C:\\Users\\teddy\\AppData\\Roaming\\npm' };
    const result = resolveAgentCommand('claude', ARGS, evidence(['C:\\Users\\teddy\\.local\\bin\\claude.exe', 'C:\\Users\\teddy\\AppData\\Roaming\\npm\\claude.cmd'], env));
    expect(result).toEqual({ ok: true, value: { file: 'C:\\Users\\teddy\\.local\\bin\\claude.exe', args: ARGS } });
  });

  it('runs an npm shim through its cli.js on the current Node, arguments untouched', () => {
    const npm = 'C:\\Users\\teddy\\AppData\\Roaming\\npm';
    const result = resolveAgentCommand('claude', ARGS, evidence([`${npm}\\claude.cmd`, `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`], { PATH: `C:\\Windows;${npm}` }));
    expect(result).toEqual({ ok: true, value: { file: NODE, args: [`${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, ...ARGS] } });
  });

  it('prefers .exe over .cmd in the same directory by the default PATHEXT order, and follows a custom PATHEXT', () => {
    const dir = 'C:\\tools';
    const files = [`${dir}\\claude.exe`, `${dir}\\claude.cmd`, `${dir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`];
    expect(resolveAgentCommand('claude', [], evidence(files, { PATH: dir })).value).toEqual({ file: `${dir}\\claude.exe`, args: [] });
    expect(resolveAgentCommand('claude', [], evidence(files, { PATH: dir, PATHEXT: '.CMD;.EXE;.PY' })).value).toEqual({ file: NODE, args: [`${dir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`] });
  });

  it('refuses a batch shim it cannot bypass, naming the remedy', () => {
    const result = resolveAgentCommand('claude', ARGS, evidence(['C:\\volta\\bin\\claude.cmd'], { PATH: 'C:\\volta\\bin' }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error).toContain('C:\\volta\\bin\\claude.cmd');
    expect(result.error).toContain('native Windows installer');
    expect(result.error).toContain('TERUM_SKILLS_AGENT_CMD');
  });

  it('reports a command missing from PATH instead of letting spawn fail with ENOENT', () => {
    expect(resolveAgentCommand('claude', ARGS, evidence([], { PATH: 'C:\\Windows;C:\\nowhere' }))).toEqual({ ok: false, error: '`claude` was not found on PATH — is Claude Code installed?' });
    expect(resolveAgentCommand('claude', ARGS, evidence([], {}))).toEqual({ ok: false, error: '`claude` was not found on PATH — is Claude Code installed?' });
  });

  it('honours an explicit TERUM_SKILLS_AGENT_CMD path: exe as is, shim through cli.js, absent reported', () => {
    const exe = 'D:\\claude\\claude.exe';
    expect(resolveAgentCommand(exe, ARGS, evidence([exe], {}))).toEqual({ ok: true, value: { file: exe, args: ARGS } });
    const shim = 'D:\\npm\\claude.cmd';
    expect(resolveAgentCommand(shim, ARGS, evidence([shim, 'D:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'], {}))).toEqual({ ok: true, value: { file: NODE, args: ['D:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js', ...ARGS] } });
    expect(resolveAgentCommand(exe, ARGS, evidence([], {}))).toEqual({ ok: false, error: `\`${exe}\` was not found — is Claude Code installed?` });
  });

  it('tries the launchable extensions for an explicit path without one', () => {
    expect(resolveAgentCommand('D:\\claude\\claude', [], evidence(['D:\\claude\\claude.exe'], {}))).toEqual({ ok: true, value: { file: 'D:\\claude\\claude.exe', args: [] } });
  });
});

describe('resolveAgentCommand reads the shim when the conventional package path is absent', () => {
  const NVM = 'C:\\nvm4w\\nodejs';
  const withText = (files: readonly string[], text: string | null): AgentCommandEvidence => ({ ...evidence(files, { PATH: NVM }), readText: (path) => (path.toLowerCase() === `${NVM}\\claude.cmd`.toLowerCase() ? text : null) });

  it('launches the %~dp0-relative script an npm-style shim names, quoted or bare', () => {
    const quoted = `@ECHO off\r\nSETLOCAL\r\n"%~dp0\\node.exe"  "%~dp0\\node_modules\\claude-code\\cli.js" %*\r\n`;
    const target = `${NVM}\\node_modules\\claude-code\\cli.js`;
    expect(resolveAgentCommand('claude', ARGS, withText([`${NVM}\\claude.cmd`, target], quoted))).toEqual({ ok: true, value: { file: NODE, args: [target, ...ARGS] } });
    const bare = `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe" %dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.mjs %*\r\n) ELSE (\r\n  node %dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.mjs %*\r\n)`;
    const mjs = `${NVM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.mjs`;
    expect(resolveAgentCommand('claude', ARGS, withText([`${NVM}\\claude.cmd`, mjs], bare))).toEqual({ ok: true, value: { file: NODE, args: [mjs, ...ARGS] } });
  });

  it('lists the scripts a shim names in order and ignores paths not anchored at the shim folder', () => {
    const text = `node "C:\\elsewhere\\x.js"\r\n"%~dp0\\a\\one.cjs" "%dp0%\\two.js" %~dp0\\three.mjs`;
    expect(shimScripts(`${NVM}\\claude.cmd`, text)).toEqual([`${NVM}\\a\\one.cjs`, `${NVM}\\two.js`, `${NVM}\\three.mjs`]);
  });

  it('prefers the conventional package path when present, and reports what a shim launches when that is missing too', () => {
    const conventional = `${NVM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
    expect(resolveAgentCommand('claude', [], withText([`${NVM}\\claude.cmd`, conventional, `${NVM}\\other.js`], `"%~dp0\\other.js"`)).value).toEqual({ file: NODE, args: [conventional] });
    const missing = resolveAgentCommand('claude', [], withText([`${NVM}\\claude.cmd`], `"%~dp0\\gone.js" %*`));
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('expected a failure');
    expect(missing.error).toContain(`It launches ${NVM}\\gone.js, which does not exist.`);
    expect(missing.error).toContain('TERUM_SKILLS_AGENT_CMD');
    const unreadable = resolveAgentCommand('claude', [], withText([`${NVM}\\claude.cmd`], null));
    expect(unreadable.ok ? '' : unreadable.error).toContain('The shim could not be read.');
    const nothing = resolveAgentCommand('claude', [], withText([`${NVM}\\claude.cmd`], '@echo off\r\nexit /b 1'));
    expect(nothing.ok ? '' : nothing.error).toContain('The shim names no script this tool can launch.');
    // Without a reader at all (the pre-existing evidence shape), the refusal still names the remedy.
    const legacy = resolveAgentCommand('claude', [], evidence([`${NVM}\\claude.cmd`], { PATH: NVM }));
    expect(legacy.ok ? '' : legacy.error).toContain('native Windows installer');
  });
});
