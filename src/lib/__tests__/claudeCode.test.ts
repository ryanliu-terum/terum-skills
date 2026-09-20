import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_COPY, CLAUDE_CODE_FORM_TITLE, claudeCodeIntegration, type ClaudeCodeOptions } from '../claudeCode.js';
import { editHookDestination, editHookInstalled, editHookState, installEditHook } from '../editHook.js';
import { hookInstalled } from '../hook.js';
import { installWrapper, wrapperDestination, wrapperState } from '../wrapper.js';
import type { FormField, Prompter } from '../prompt.js';
import { editHookFor, ScriptedPrompter, temporaryDirectory, wrapperFor } from './fixtures.js';

const OLD_WRAPPER = '---\nname: terum-skills\ndescription: an older bundled copy\nmetadata:\n  managed-by: terum-skills\n---\nold body\n';
const SOMEONE_ELSES = '---\nname: terum-skills\ndescription: someone else\'s skill under the same name\n---\n';

async function fixture(): Promise<{ root: string; home: string; options: ClaudeCodeOptions }> {
  const root = await temporaryDirectory('terum-claude-code-');
  const home = join(root, 'home');
  const settingsFile = join(root, 'settings.json');
  return { root, home, options: {
    hook: { settingsFile, backupDir: join(root, 'backups'), command: 'npx -y terum-skills@0.0.0 sync --hook' },
    wrapper: wrapperFor(home),
    editHook: editHookFor(join(root, 'state'), settingsFile),
  } };
}

/** A channel that draws forms: records the one form it was shown and answers it with `answer`. */
function formShell(answer: Record<string, string | boolean> | null): Prompter & { forms: { title: string; fields: readonly FormField[]; options: unknown }[]; lines: string[] } {
  const forms: { title: string; fields: readonly FormField[]; options: unknown }[] = [];
  const lines: string[] = [];
  return {
    interactive: true, channel: 'frames', forms, lines,
    confirm: async () => { throw new Error('a form shell is never asked one line at a time'); },
    text: async () => { throw new Error('a form shell is never asked one line at a time'); },
    select: async () => { throw new Error('a form shell is never asked one line at a time'); },
    form: async (title, fields, options) => { forms.push({ title, fields, options }); return answer; },
    print: (line) => { lines.push(line); },
  };
}

describe('the one Claude Code question (Ryan, 2026-09-19)', () => {
  it('offers the three pieces as checkboxes, all on, on one form with Install, and installs exactly what stayed checked', async () => {
    const { options } = await fixture();
    const io = formShell({ hook: true, wrapper: false, editHook: true });
    const outcomes = await claudeCodeIntegration(io, options);
    expect(io.forms).toHaveLength(1);
    const [form] = io.forms;
    expect(form!.title).toBe(CLAUDE_CODE_FORM_TITLE);
    expect(form!.options).toMatchObject({ submit: 'Install', skippable: true, skipLabel: 'Skip' });
    expect(form!.fields.map((field) => ({ id: field.id, kind: field.kind, label: field.label, default: field.default }))).toEqual([
      { id: 'hook', kind: 'checkbox', label: CLAUDE_CODE_COPY.hook, default: true },
      { id: 'wrapper', kind: 'checkbox', label: CLAUDE_CODE_COPY.wrapper, default: true },
      { id: 'editHook', kind: 'checkbox', label: CLAUDE_CODE_COPY.editHook, default: true },
    ]);
    // Every field says what it writes and where.
    expect(form!.fields.map((field) => field.note)).toEqual([`Edits ${options.hook.settingsFile}.`, `Writes ${wrapperDestination(options.wrapper.skillsRoot)}.`, `Installs ${editHookDestination(options.editHook.storeRoot)} and a Write/Edit hook in ${options.editHook.settingsFile}.`]);
    expect(outcomes).toEqual({ hook: 'installed', wrapper: 'declined', editHook: 'installed' });
    expect(await hookInstalled(options.hook.settingsFile)).toBe(true);
    expect(await wrapperState(options.wrapper)).toBe('absent');
    expect(await editHookInstalled(options.editHook)).toBe(true);
    expect(io.lines).toEqual([
      `Installed the session hook in ${options.hook.settingsFile}.`,
      'Skipped the /terum-skills skill; re-run setup to install it later.',
      `Installed the terum-skills edit hook at ${editHookDestination(options.editHook.storeRoot)} and a Write/Edit hook in ${options.editHook.settingsFile}.`,
    ]);
  });

  it('Skip installs nothing and says how to come back', async () => {
    const { options } = await fixture();
    const io = formShell(null);
    expect(await claudeCodeIntegration(io, options)).toEqual({ hook: 'declined', wrapper: 'declined', editHook: 'declined' });
    expect(await hookInstalled(options.hook.settingsFile)).toBe(false);
    expect(await wrapperState(options.wrapper)).toBe('absent');
    expect(await editHookState(options.editHook)).toBe('absent');
    expect(io.lines).toEqual(['Skipped the session hook; re-run setup to install it later.', 'Skipped the /terum-skills skill; re-run setup to install it later.', 'Skipped the edit hook; re-run setup to install it later.']);
  });

  it('a piece already installed is shown checked and disabled, and a shell cannot uncheck it', async () => {
    const { options } = await fixture();
    await claudeCodeIntegration(formShell({ hook: true, wrapper: true, editHook: true }), options);
    // The shell tries to answer false for a disabled field: the field's default stands and nothing is removed.
    const io = formShell({ hook: false, wrapper: false, editHook: false });
    const outcomes = await claudeCodeIntegration(io, options);
    // Everything is present, so there is nothing left to ask: no form, three lines saying so.
    expect(io.forms).toEqual([]);
    expect(outcomes).toEqual({ hook: 'present', wrapper: 'present', editHook: 'present' });
    expect(io.lines).toEqual([
      `${CLAUDE_CODE_COPY.hook} — Already installed in ${options.hook.settingsFile}.`,
      `${CLAUDE_CODE_COPY.wrapper} — Already installed at ${wrapperDestination(options.wrapper.skillsRoot)}.`,
      `${CLAUDE_CODE_COPY.editHook} — Already installed at ${editHookDestination(options.editHook.storeRoot)}.`,
    ]);
    expect(await hookInstalled(options.hook.settingsFile)).toBe(true);
  });

  it('refreshes an outdated copy of its own without asking, repairs a settings file that lost the edit-hook entry, and still offers what is absent', async () => {
    const { options } = await fixture();
    await installWrapper(options.wrapper);
    await installEditHook(options.editHook);
    await writeFile(join(wrapperDestination(options.wrapper.skillsRoot), 'SKILL.md'), OLD_WRAPPER);
    await writeFile(options.editHook.settingsFile, JSON.stringify({}));
    const io = formShell({ hook: true });
    const outcomes = await claudeCodeIntegration(io, options);
    expect(outcomes).toEqual({ hook: 'installed', wrapper: 'replaced', editHook: 'replaced' });
    expect(await readFile(join(wrapperDestination(options.wrapper.skillsRoot), 'SKILL.md'), 'utf8')).toBe(await readFile(options.wrapper.source, 'utf8'));
    expect(await editHookInstalled(options.editHook)).toBe(true);
    // The refreshed pieces appear on the form checked and disabled; only the hook was a live checkbox.
    expect(io.forms[0]!.fields.map((field) => [field.id, field.kind === 'checkbox' && field.disabled === true])).toEqual([['hook', false], ['wrapper', true], ['editHook', true]]);
    expect(io.lines.slice(0, 2)).toEqual([`Updated the /terum-skills Claude Code skill at ${wrapperDestination(options.wrapper.skillsRoot)}.`, `Updated the terum-skills edit hook at ${editHookDestination(options.editHook.storeRoot)}.`]);
  });

  it('a foreign folder and an unbundled copy are named, left alone, and get no checkbox', async () => {
    const { root, options } = await fixture();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(wrapperDestination(options.wrapper.skillsRoot), { recursive: true });
    await writeFile(join(wrapperDestination(options.wrapper.skillsRoot), 'SKILL.md'), SOMEONE_ELSES);
    const unbundled = { ...options, editHook: { ...options.editHook, source: join(root, 'nowhere', 'terum-skills-edit.mjs') } };
    const io = formShell({ hook: true });
    expect(await claudeCodeIntegration(io, unbundled)).toEqual({ hook: 'installed', wrapper: 'foreign', editHook: 'unavailable' });
    expect(io.forms[0]!.fields.map((field) => field.id)).toEqual(['hook']);
    expect(io.lines.slice(0, 2)).toEqual([
      `${wrapperDestination(options.wrapper.skillsRoot)} exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.`,
      `The terum-skills edit hook is not bundled in this copy of terum-skills (expected at ${unbundled.editHook.source}); skipped.`,
    ]);
    expect(await readFile(join(wrapperDestination(options.wrapper.skillsRoot), 'SKILL.md'), 'utf8')).toBe(SOMEONE_ELSES);
  });

  it('on a terminal the same form is one Y/n over the three lines, and a no asks each piece by its own line', async () => {
    const { options } = await fixture();
    const block = new ScriptedPrompter([], [true]);
    expect(await claudeCodeIntegration(block, options)).toEqual({ hook: 'installed', wrapper: 'installed', editHook: 'installed' });
    expect(block.asked).toEqual(['Install these?']);
    expect(block.details['Install these?']).toEqual([`[x] ${CLAUDE_CODE_COPY.hook}`, `[x] ${CLAUDE_CODE_COPY.wrapper}`, `[x] ${CLAUDE_CODE_COPY.editHook}`]);
    expect(block.lines[0]).toBe(CLAUDE_CODE_FORM_TITLE);

    const each = await fixture();
    const io = new ScriptedPrompter([], [false, false, true, false]);
    expect(await claudeCodeIntegration(io, each.options)).toEqual({ hook: 'declined', wrapper: 'installed', editHook: 'declined' });
    expect(io.asked).toEqual(['Install these?', CLAUDE_CODE_COPY.hook, CLAUDE_CODE_COPY.wrapper, CLAUDE_CODE_COPY.editHook]);
    expect(await hookInstalled(each.options.hook.settingsFile)).toBe(false);
    expect(await wrapperState(each.options.wrapper)).toBe('current');
  });
});
