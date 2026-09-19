import { spawn } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_EDIT_HOOK_SOURCE, editHookFor, ScriptedPrompter, SYMLINKS_SUPPORTED, temporaryDirectory,
} from './fixtures.js';
import {
  editHookCommand, editHookDestination, editHookInstalled, editHookState, inspectEditHook,
  installEditHook, isManagedEditHook, offerEditHook, removeEditHook,
} from '../editHook.js';

const ID = '31313131-3131-4131-8131-313131313131';

async function fixture() {
  const root = await temporaryDirectory('terum-edit-hook-');
  const storeRoot = join(root, 'state');
  const options = editHookFor(storeRoot, join(root, 'settings.json'));
  return { root, storeRoot, options };
}

/** The placed script, driven the way Claude Code drives it: one JSON object on stdin, JSON or nothing on stdout. */
function runHook(script: string, home: string, payload: unknown): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // The hook finds home through `os.homedir()`, which reads HOME on POSIX and USERPROFILE on Windows.
    const child = spawn(process.execPath, [script], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, code }));
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}

/** A home with terum-skills configured, one own skill folder and one installed placement. */
async function hookHome(placement = true) {
  const home = await temporaryDirectory('terum-edit-hook-home-');
  const skills = join(home, 'proj', '.claude', 'skills');
  await mkdir(join(skills, 'mine'), { recursive: true });
  await mkdir(join(skills, 'installed'), { recursive: true });
  await mkdir(join(home, '.terum', 'skills'), { recursive: true });
  const config = {
    teams: { acme: { remote: 'https://github.com/acme/team.git', handle: 'seed' } },
    shared: {}, approvals: {}, pending: [],
    placements: placement
      ? { [join(skills, 'installed')]: { id: ID, team: 'acme', version: 'v3', scope: { kind: 'global' }, placed_at: '2026-09-14', fingerprint: 'sha256:x' } }
      : {},
  };
  await writeFile(join(home, '.terum', 'skills', 'config.json'), JSON.stringify(config));
  return { home, skills };
}

describe('the edit hook script', () => {
  it('says nothing at all about a file outside a skills root — the path every other edit takes', async () => {
    const { home } = await hookHome();
    const result = await runHook(BUNDLED_EDIT_HOOK_SOURCE, home, { session_id: 's', tool_input: { file_path: join(home, 'proj', 'src', 'index.ts') } });
    expect(result).toEqual({ stdout: '', code: 0 });
  });

  it('names the skill, the local-only consequence and the publish command for a folder of your own', async () => {
    const { home, skills } = await hookHome();
    const result = await runHook(BUNDLED_EDIT_HOOK_SOURCE, home, { session_id: 's', tool_input: { file_path: join(skills, 'mine', 'SKILL.md') } });
    expect(result.code).toBe(0);
    const context = (JSON.parse(result.stdout) as { additionalContext: string }).additionalContext;
    expect(context).toContain('You edited mine');
    expect(context).toContain('teammates see the published version until a new one is published');
    expect(context).toContain('npx -y terum-skills@latest publish mine');
    // Publish needs a terminal (the manual's Table B); the hook must not invite the agent to run it.
    expect(context).toContain('needs a real terminal');
  });

  it('tells an installed copy apart, with the version and team it came from', async () => {
    const { home, skills } = await hookHome();
    const result = await runHook(BUNDLED_EDIT_HOOK_SOURCE, home, { session_id: 's', tool_input: { file_path: join(skills, 'installed', 'SKILL.md') } });
    const context = (JSON.parse(result.stdout) as { additionalContext: string }).additionalContext;
    expect(context).toContain('an installed copy of v3 from team acme');
  });

  it('speaks once per skill per session, and again in a new session', async () => {
    const { home, skills } = await hookHome();
    const edit = (session: string, file: string) => runHook(BUNDLED_EDIT_HOOK_SOURCE, home, { session_id: session, tool_input: { file_path: file } });
    expect((await edit('one', join(skills, 'mine', 'SKILL.md'))).stdout).not.toBe('');
    // A second edit to the SAME skill in the same session is the case that would become wallpaper.
    expect((await edit('one', join(skills, 'mine', 'reference.md'))).stdout).toBe('');
    // A different skill in that session still gets its own reminder.
    expect((await edit('one', join(skills, 'installed', 'SKILL.md'))).stdout).not.toBe('');
    expect((await edit('two', join(skills, 'mine', 'SKILL.md'))).stdout).not.toBe('');
  });

  it('stays silent where there is nothing to say: a loose file in the skills root, no config, no team', async () => {
    const { home, skills } = await hookHome();
    const loose = await runHook(BUNDLED_EDIT_HOOK_SOURCE, home, { session_id: 's', tool_input: { file_path: join(skills, 'README.md') } });
    expect(loose.stdout).toBe('');

    const bare = await temporaryDirectory('terum-edit-hook-bare-');
    await mkdir(join(bare, 'proj', '.claude', 'skills', 'mine'), { recursive: true });
    const unconfigured = await runHook(BUNDLED_EDIT_HOOK_SOURCE, bare, { session_id: 's', tool_input: { file_path: join(bare, 'proj', '.claude', 'skills', 'mine', 'SKILL.md') } });
    expect(unconfigured.stdout).toBe('');

    await mkdir(join(bare, '.terum', 'skills'), { recursive: true });
    await writeFile(join(bare, '.terum', 'skills', 'config.json'), JSON.stringify({ teams: {}, shared: {}, approvals: {}, pending: [], placements: {} }));
    const teamless = await runHook(BUNDLED_EDIT_HOOK_SOURCE, bare, { session_id: 's', tool_input: { file_path: join(bare, 'proj', '.claude', 'skills', 'mine', 'SKILL.md') } });
    expect(teamless.stdout).toBe('');
  });

  it('exits 0 on anything it cannot read, because a reminder must never fail an edit', async () => {
    const { home, skills } = await hookHome();
    for (const payload of ['not json', '', {}, { tool_input: {} }, { tool_input: { file_path: 42 } }]) {
      expect(await runHook(BUNDLED_EDIT_HOOK_SOURCE, home, payload)).toEqual({ stdout: '', code: 0 });
    }
    // A config.json that is not JSON is the same case: the tool is unusable, so the hook is silent.
    await writeFile(join(home, '.terum', 'skills', 'config.json'), '{ broken');
    expect(await runHook(BUNDLED_EDIT_HOOK_SOURCE, home, { session_id: 's', tool_input: { file_path: join(skills, 'mine', 'SKILL.md') } })).toEqual({ stdout: '', code: 0 });
  });
});

describe('placing the edit hook', () => {
  it('installs both halves, reports current, and removes both', async () => {
    const { storeRoot, options } = await fixture();
    expect(await editHookState(options)).toBe('absent');
    expect(await editHookInstalled(options)).toBe(false);

    expect(await installEditHook(options)).toBe('installed');
    expect(await editHookState(options)).toBe('current');
    expect(await editHookInstalled(options)).toBe(true);
    expect(await readFile(editHookDestination(storeRoot), 'utf8')).toBe(await readFile(BUNDLED_EDIT_HOOK_SOURCE, 'utf8'));
    const settings = JSON.parse(await readFile(options.settingsFile, 'utf8')) as { hooks: { PostToolUse: unknown[] } };
    expect(settings.hooks.PostToolUse).toEqual([{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: editHookCommand(storeRoot), timeout: 10 }] }]);

    expect(await installEditHook(options)).toBe('replaced');
    expect(JSON.parse(await readFile(options.settingsFile, 'utf8')).hooks.PostToolUse).toHaveLength(1);

    expect(await removeEditHook(options)).toBe('removed');
    expect(await editHookState(options)).toBe('absent');
    expect(JSON.parse(await readFile(options.settingsFile, 'utf8'))).toEqual({});
  });

  it('leaves another program\'s SessionStart entry and another program\'s script alone', async () => {
    const { storeRoot, options } = await fixture();
    await writeFile(options.settingsFile, JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node /other/thing.js' }] }] } }));
    await installEditHook(options);
    const after = JSON.parse(await readFile(options.settingsFile, 'utf8')) as { hooks: { PostToolUse: { hooks: { command: string }[] }[] } };
    expect(after.hooks.PostToolUse).toHaveLength(2);
    await removeEditHook(options);
    const removed = JSON.parse(await readFile(options.settingsFile, 'utf8')) as { hooks: { PostToolUse: { hooks: { command: string }[] }[] } };
    expect(removed.hooks.PostToolUse).toEqual([{ matcher: 'Write', hooks: [{ type: 'command', command: 'node /other/thing.js' }] }]);
    void storeRoot;
  });

  it('refuses a foreign file at its path, and never removes it', async () => {
    const { storeRoot, options } = await fixture();
    await mkdir(join(storeRoot, 'hooks'), { recursive: true });
    await writeFile(editHookDestination(storeRoot), '// somebody else\n');
    expect(await editHookState(options)).toBe('foreign');
    await expect(installEditHook(options)).rejects.toThrow('is not the bundled terum-skills edit hook');
    expect(await removeEditHook(options)).toBe('foreign');
    expect(await readFile(editHookDestination(storeRoot), 'utf8')).toBe('// somebody else\n');
  });

  it.skipIf(!SYMLINKS_SUPPORTED)('treats a symbolic link as foreign — the repo rule everywhere: refuse, never follow', async () => {
    const { storeRoot, options } = await fixture();
    await mkdir(join(storeRoot, 'hooks'), { recursive: true });
    await writeFile(join(storeRoot, 'elsewhere.mjs'), await readFile(BUNDLED_EDIT_HOOK_SOURCE, 'utf8'));
    await symlink(join(storeRoot, 'elsewhere.mjs'), editHookDestination(storeRoot));
    expect(await inspectEditHook(storeRoot)).toEqual({ kind: 'foreign', why: 'it is a symbolic link' });
    expect(await editHookState(options)).toBe('foreign');
  });

  it('reports an unbundled copy of the package instead of failing', async () => {
    const { options } = await fixture();
    const unbundled = { ...options, source: join(options.storeRoot, 'no-bundle', 'terum-skills-edit.mjs') };
    expect(await editHookState(unbundled)).toBe('unavailable');
    const io = new ScriptedPrompter();
    expect(await offerEditHook(io, unbundled)).toBe('unavailable');
    expect(io.asked).toEqual([]);
  });
});

describe('offering the edit hook', () => {
  it('asks once, installs on yes, and writes nothing on no', async () => {
    const declined = await fixture();
    const no = new ScriptedPrompter([], [false]);
    expect(await offerEditHook(no, declined.options)).toBe('declined');
    expect(no.asked).toHaveLength(1);
    expect(await editHookState(declined.options)).toBe('absent');

    const accepted = await fixture();
    const yes = new ScriptedPrompter([], [true]);
    expect(await offerEditHook(yes, accepted.options)).toBe('installed');
    expect(await editHookInstalled(accepted.options)).toBe(true);
  });

  it('refreshes its own copy without a second question, and repairs a settings file that lost the entry', async () => {
    const { options } = await fixture();
    await installEditHook(options);

    // Outdated: a copy of ours this CLI has moved past. Consent was given when it was installed.
    await writeFile(editHookDestination(options.storeRoot), '// terum-skills managed hook\n// an older release\n');
    const refresh = new ScriptedPrompter();
    expect(await offerEditHook(refresh, options)).toBe('replaced');
    expect(refresh.asked).toEqual([]);
    expect(await editHookState(options)).toBe('current');

    // A current script the settings file no longer names never runs; that is not "present".
    await writeFile(options.settingsFile, JSON.stringify({}));
    const repair = new ScriptedPrompter();
    expect(await offerEditHook(repair, options)).toBe('replaced');
    expect(repair.asked).toEqual([]);
    expect(await editHookInstalled(options)).toBe(true);

    const settled = new ScriptedPrompter();
    expect(await offerEditHook(settled, options)).toBe('present');
    expect(settled.asked).toEqual([]);
  });

  it('is judged managed only by its first line', () => {
    expect(isManagedEditHook('// terum-skills managed hook: PostToolUse\n')).toBe(true);
    expect(isManagedEditHook('#!/usr/bin/env node\n// terum-skills managed hook\n')).toBe(false);
    expect(isManagedEditHook('')).toBe(false);
  });
});
