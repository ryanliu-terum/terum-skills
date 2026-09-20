import { editHookState, installEditHook, type ResolvedEditHookOptions, editHookDestination } from './editHook.js';
import { eventHookInstalled, hookInstalled, installHook, type HookOptions } from './hook.js';
import { askForm, type FormCheckboxField, type Prompter } from './prompt.js';
import { installWrapper, wrapperDestination, wrapperState, type WrapperOptions } from './wrapper.js';

/**
 * Setup's one Claude Code question (Ryan, 2026-09-19): three checkboxes on one screen, all on, one Install.
 * The three pieces stay separate installers — the session hook (hook.ts) edits `~/.claude/settings.json` to
 * fetch the team clone at session start; the /terum-skills skill (wrapper.ts) is a folder Claude reads; the
 * edit hook (editHook.ts) is a script plus a Write|Edit settings entry — and this module only decides what to
 * offer and applies the answers. A piece already installed is shown checked and disabled; an outdated copy of
 * our own is refreshed without asking (that consent was given when it was installed); a foreign folder or an
 * unbundled copy is printed and left out. Nothing is installed that was not checked.
 */
export const CLAUDE_CODE_FORM_TITLE = 'Claude Code integration';

export const CLAUDE_CODE_COPY = {
  hook: 'Auto-syncs what skills your team has published in the marketplace when a Claude Code session starts.',
  wrapper: 'Evaluate, publish, and discover skills in Claude Code through a /terum-skills skill.',
  editHook: 'After editing a skill, suggests publishing that skill to your team.',
} as const;

export type ClaudeCodePiece = keyof typeof CLAUDE_CODE_COPY;
export type ClaudeCodeOutcome = 'installed' | 'replaced' | 'present' | 'declined' | 'foreign' | 'unavailable';
export type ClaudeCodeOutcomes = Record<ClaudeCodePiece, ClaudeCodeOutcome>;

export interface ClaudeCodeOptions {
  hook: Required<HookOptions>;
  wrapper: Required<WrapperOptions>;
  editHook: ResolvedEditHookOptions;
}

export async function claudeCodeIntegration(io: Prompter, options: ClaudeCodeOptions): Promise<ClaudeCodeOutcomes> {
  const outcomes: ClaudeCodeOutcomes = { hook: 'declined', wrapper: 'declined', editHook: 'declined' };
  const fields: FormCheckboxField[] = [];
  const offer = (piece: ClaudeCodePiece, present: boolean, note?: string): void => {
    fields.push({ id: piece, kind: 'checkbox', label: CLAUDE_CODE_COPY[piece], default: true, ...(present ? { disabled: true, note: note ?? 'Already installed.' } : {}), ...(!present && note ? { note } : {}) });
  };

  // Its first read throws on a hand-edited settings.json by design: setup treats an unusable settings file as a
  // resumable stopping point (the same rule the old per-piece offer followed).
  if (await hookInstalled(options.hook.settingsFile)) { outcomes.hook = 'present'; offer('hook', true, `Already installed in ${options.hook.settingsFile}.`); }
  else offer('hook', false, `Edits ${options.hook.settingsFile}.`);

  const wrapperAt = wrapperDestination(options.wrapper.skillsRoot);
  const wrapper = await wrapperState(options.wrapper);
  if (wrapper === 'unavailable') { io.print(`The /terum-skills Claude Code skill is not bundled in this copy of terum-skills (expected at ${options.wrapper.source}); skipped.`); outcomes.wrapper = 'unavailable'; }
  else if (wrapper === 'foreign') { io.print(`${wrapperAt} exists and is not the bundled /terum-skills skill; left alone. Move it aside and re-run setup to install the bundled one.`); outcomes.wrapper = 'foreign'; }
  else if (wrapper === 'current') { outcomes.wrapper = 'present'; offer('wrapper', true, `Already installed at ${wrapperAt}.`); }
  else if (wrapper === 'outdated') { await installWrapper(options.wrapper); io.print(`Updated the /terum-skills Claude Code skill at ${wrapperAt}.`); outcomes.wrapper = 'replaced'; offer('wrapper', true, `Updated at ${wrapperAt}.`); }
  else offer('wrapper', false, `Writes ${wrapperAt}.`);

  const editHookAt = editHookDestination(options.editHook.storeRoot);
  const editHook = await editHookState(options.editHook);
  if (editHook === 'unavailable') { io.print(`The terum-skills edit hook is not bundled in this copy of terum-skills (expected at ${options.editHook.source}); skipped.`); outcomes.editHook = 'unavailable'; }
  else if (editHook === 'foreign') { io.print(`${editHookAt} exists and is not the bundled terum-skills edit hook; left alone. Move it aside and re-run setup to install it.`); outcomes.editHook = 'foreign'; }
  // `current` still checks the settings entry: a script the settings file no longer names never runs.
  else if (editHook === 'current' && await eventHookInstalled(options.editHook.settingsFile, 'PostToolUse')) { outcomes.editHook = 'present'; offer('editHook', true, `Already installed at ${editHookAt}.`); }
  else if (editHook === 'outdated' || editHook === 'current') { await installEditHook(options.editHook); io.print(`Updated the terum-skills edit hook at ${editHookAt}.`); outcomes.editHook = 'replaced'; offer('editHook', true, `Updated at ${editHookAt}.`); }
  else offer('editHook', false, `Installs ${editHookAt} and a Write/Edit hook in ${options.editHook.settingsFile}.`);

  if (fields.every((field) => field.disabled)) {
    for (const field of fields) io.print(`${field.label} — ${field.note ?? 'already installed.'}`);
    return outcomes;
  }
  const answers = await askForm(io, CLAUDE_CODE_FORM_TITLE, fields, { submit: 'Install', skippable: true, skipLabel: 'Skip', confirmQuestion: 'Install these?' });
  const chosen = (piece: ClaudeCodePiece): boolean => answers !== null && answers[piece] === true && fields.some((field) => field.id === piece && !field.disabled);

  if (chosen('hook')) {
    outcomes.hook = await installHook(options.hook);
    io.print(`Installed the session hook in ${options.hook.settingsFile}.`);
  } else if (outcomes.hook === 'declined') io.print('Skipped the session hook; re-run setup to install it later.');

  if (chosen('wrapper')) {
    outcomes.wrapper = await installWrapper(options.wrapper);
    io.print(`Installed the /terum-skills Claude Code skill at ${wrapperAt}.`);
  } else if (outcomes.wrapper === 'declined') io.print('Skipped the /terum-skills skill; re-run setup to install it later.');

  if (chosen('editHook')) {
    outcomes.editHook = await installEditHook(options.editHook);
    io.print(`Installed the terum-skills edit hook at ${editHookAt} and a Write/Edit hook in ${options.editHook.settingsFile}.`);
  } else if (outcomes.editHook === 'declined') io.print('Skipped the edit hook; re-run setup to install it later.');

  return outcomes;
}
