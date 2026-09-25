import { describe, expect, it } from 'vitest';
import { resolveAgentCommand, resolvePosixShell, SCRIPT_VAR, shellCommand, shimScripts, type AgentCommandEvidence, type PosixShell } from '../agent-command.js';

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

describe('resolveAgentCommand follows a shim to a native binary (Claude Code ≥ 2.1 ships bin\\claude.exe in the npm package)', () => {
  // Teddy's machine, 2026-09-15: nvm-windows puts C:\nvm4w\nodejs first on PATH, whose claude.cmd is
  //   "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
  // There is no cli.js in that package any more, so every eval died at preflight in 13 ms.
  const nvm = 'C:\\nvm4w\\nodejs';
  const exe = `${nvm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
  const shim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
  const withShim = (files: readonly string[], env: NodeJS.ProcessEnv): AgentCommandEvidence => ({ ...evidence(files, env), readText: (path) => path.toLowerCase() === `${nvm}\\claude.cmd`.toLowerCase() ? shim : null });

  it('launches the .exe the shim names directly, arguments untouched', () => {
    expect(shimScripts(`${nvm}\\claude.cmd`, shim)).toEqual([exe]);
    expect(resolveAgentCommand('claude', ARGS, withShim([`${nvm}\\claude.cmd`, exe], { PATH: `C:\\Windows;${nvm}` }))).toEqual({ ok: true, value: { file: exe, args: ARGS } });
  });

  it('still runs a script target on the current Node, and reports a named .exe that does not exist', () => {
    const result = resolveAgentCommand('claude', ARGS, withShim([`${nvm}\\claude.cmd`], { PATH: nvm }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error).toContain(`It launches ${exe}, which does not exist.`);
  });

  it('falls back to the native installer\'s %USERPROFILE%\\.local\\bin\\claude.exe when the shim is opaque, but never ahead of PATH or for an explicit command', () => {
    const home = 'C:\\Users\\teddy', native = `${home}\\.local\\bin\\claude.exe`;
    const opaque = resolveAgentCommand('claude', ARGS, evidence(['C:\\volta\\bin\\claude.cmd', native], { PATH: 'C:\\volta\\bin', USERPROFILE: home }));
    expect(opaque).toEqual({ ok: true, value: { file: native, args: ARGS } });
    // PATH order still wins when the shim can be followed.
    expect(resolveAgentCommand('claude', ARGS, withShim([`${nvm}\\claude.cmd`, exe, native], { PATH: nvm, USERPROFILE: home }))).toEqual({ ok: true, value: { file: exe, args: ARGS } });
    // An explicit TERUM_SKILLS_AGENT_CMD shim that cannot be followed is reported, not silently swapped.
    const explicit = resolveAgentCommand('C:\\volta\\bin\\claude.cmd', ARGS, evidence(['C:\\volta\\bin\\claude.cmd', native], { USERPROFILE: home }));
    expect(explicit.ok).toBe(false);
    // Nothing native installed: the original remedy stands.
    const none = resolveAgentCommand('claude', ARGS, evidence(['C:\\volta\\bin\\claude.cmd'], { PATH: 'C:\\volta\\bin', USERPROFILE: home }));
    expect(none.ok).toBe(false);
    if (none.ok) throw new Error('expected a failure');
    expect(none.error).toContain('native Windows installer');
  });
});

describe('resolvePosixShell (case setup, requires probes, command_succeeds)', () => {
  const GIT = 'C:\\Program Files\\Git';
  const LAUNCHER = `${GIT}\\bin\\sh.exe`, RAW = `${GIT}\\usr\\bin\\sh.exe`;
  const shell = (file: string, path: string[] = []): PosixShell => ({ file, path });

  it.each(['darwin', 'linux'] as const)('is /bin/sh on %s', (platform) => {
    expect(resolvePosixShell(evidence([], { PATH: '' }, platform))).toEqual(shell('/bin/sh'));
  });

  it('prefers the install\'s bin\\sh.exe launcher over the raw usr\\bin shell, from any of its folders', () => {
    const files = [LAUNCHER, RAW, `${GIT}\\usr\\bin\\bash.exe`, `${GIT}\\cmd\\git.exe`, `${GIT}\\mingw64\\bin\\git.exe`];
    const nowhere = { ProgramFiles: 'C:\\Nowhere' };
    expect(resolvePosixShell(evidence(files, { ...nowhere, CLAUDE_CODE_GIT_BASH_PATH: `"${GIT}\\usr\\bin\\bash.exe"`, PATH: 'C:\\Windows' }))).toEqual(shell(LAUNCHER));
    expect(resolvePosixShell(evidence(files, { ...nowhere, Path: `C:\\Windows;${GIT}\\usr\\bin` }))).toEqual(shell(LAUNCHER));
    expect(resolvePosixShell(evidence(files, { ...nowhere, PATH: `C:\\Windows;${GIT}\\cmd` }))).toEqual(shell(LAUNCHER));
    expect(resolvePosixShell(evidence(files, { ...nowhere, PATH: `${GIT}\\mingw64\\bin` }))).toEqual(shell(LAUNCHER));
  });

  it('runs a raw shell with its usr\\bin and mingw64\\bin first on PATH when the install has no launcher (MinGit)', () => {
    const min = 'D:\\MinGit';
    expect(resolvePosixShell(evidence([`${min}\\cmd\\git.exe`, `${min}\\usr\\bin\\sh.exe`], { PATH: `${min}\\cmd`, ProgramFiles: 'C:\\Nowhere' })))
      .toEqual(shell(`${min}\\usr\\bin\\sh.exe`, [`${min}\\usr\\bin`, `${min}\\mingw64\\bin`]));
  });

  it('takes CLAUDE_CODE_GIT_BASH_PATH\'s install first, and runs that bash when it is all there is', () => {
    const portable = 'D:\\PortableGit';
    const env = { CLAUDE_CODE_GIT_BASH_PATH: `${portable}\\bin\\bash.exe`, PATH: `${GIT}\\cmd` };
    expect(resolvePosixShell(evidence([`${portable}\\bin\\sh.exe`, `${portable}\\bin\\bash.exe`, LAUNCHER, `${GIT}\\cmd\\git.exe`], env))).toEqual(shell(`${portable}\\bin\\sh.exe`));
    expect(resolvePosixShell(evidence(['E:\\tools\\bash.exe'], { CLAUDE_CODE_GIT_BASH_PATH: 'E:\\tools\\bash.exe', PATH: 'C:\\Windows', ProgramFiles: 'C:\\Nowhere' }))).toEqual(shell('E:\\tools\\bash.exe'));
  });

  it('falls back to the default install, a loose sh.exe on PATH, and /bin/sh when there is none', () => {
    expect(resolvePosixShell(evidence([LAUNCHER], { PATH: 'C:\\Windows' }))).toEqual(shell(LAUNCHER));
    expect(resolvePosixShell(evidence(['C:\\busybox\\sh.exe'], { PATH: 'C:\\busybox', ProgramFiles: 'C:\\Nowhere' }))).toEqual(shell('C:\\busybox\\sh.exe'));
    expect(resolvePosixShell(evidence([], { PATH: 'C:\\Windows' }))).toEqual(shell('/bin/sh'));
  });
});

describe('shellCommand', () => {
  it('passes the script as the argument on POSIX', () => {
    const run = shellCommand('mkdir out\ntouch out/x', '-ce', [], { file: '/bin/sh', path: [] }, 'linux', { PATH: '/usr/bin' });
    expect(run).toEqual({ file: '/bin/sh', args: ['-ce', 'mkdir out\ntouch out/x'], env: { PATH: '/usr/bin' } });
  });

  it('on Windows, keeps the script off the MSYS command line and puts the raw shell\'s folders first on the existing PATH key', () => {
    const run = shellCommand('true\nfalse', '-c', ['probe', 'git'], { file: 'D:\\MinGit\\usr\\bin\\sh.exe', path: ['D:\\MinGit\\usr\\bin', 'D:\\MinGit\\mingw64\\bin'] }, 'win32', { Path: 'C:\\Windows' });
    expect(run.args).toEqual(['-c', `eval "$${SCRIPT_VAR}"`, 'probe', 'git']);
    expect(run.env).toEqual({ Path: 'D:\\MinGit\\usr\\bin;D:\\MinGit\\mingw64\\bin;C:\\Windows', [SCRIPT_VAR]: 'true\nfalse' });
  });
});
