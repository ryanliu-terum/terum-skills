/**
 * `team move <owner/repo>`: this machine follows a team whose repository moved. The one-team-per-machine
 * rule (Ryan, 2026-09-08) otherwise makes a moved repository a three-command chore — `team leave`, then
 * `setup`/`team join`, then `install` for every skill that was placed — and on 2026-09-13 every machine
 * bound to terum-shared-skills hit exactly that when the owner recreated it as shared-skills. Move does
 * the three in order: it tears the old team down locally (leave's own teardown, no confirmation of its
 * own), joins the target (join's own flow: invitation, clone, roster), then re-places every skill the
 * old team had placed here that the new team also shares, at the same scope. Skill consent records
 * survive the move: the grants are keyed by skill content, and a re-placed skill with the same content
 * must not ask twice. The old repository is never touched — it may not even exist any more.
 */
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ConfigStore, createConfigStore, selectTeam } from '../lib/config.js';
import { type Identity, teamByRemote } from '../lib/auth.js';
import { invocation, type WithForm } from '../lib/invocation.js';
import type { Prompter } from '../lib/prompt.js';
import { normalizeRemote, repositoryUrl, stripRemoteCredentials } from '../lib/remote.js';
import { CancelledError, fromError, type Result, success } from '../lib/result.js';
import { type Runner, systemRunner } from '../lib/runner.js';
import type { HookOptions } from '../lib/hook.js';
import type { Config, Destination } from '../lib/schema.js';
import { installOne } from './install.js';
import { teardownTeam } from './leave.js';
import { parseJoinTarget, run as team } from './team.js';

export interface MoveArgs extends WithForm {
  /** `<owner>/<repo>` on GitHub, or any git remote URL: where the team lives now. */
  target: string;
  /** The configured team to move away from; required only when more than one is configured. */
  from?: string;
  /** Skip the one confirmation (a shell that already asked, or a script). Without it, a non-interactive run fails closed. */
  yes?: boolean;
  config?: ConfigStore;
  runner?: Runner;
  hook?: HookOptions;
  /** Where placements resolve (test knob; installOne's `home`). */
  home?: string;
}

export interface MoveResult {
  from: string;
  fromRemote: string;
  to: string;
  toRemote: string;
  handle: string;
  /** Skill names placed again from the new team, at the scope they had. */
  restored: string[];
  /** Skill names the old team had placed here that the new team does not share; their folders were removed with the old team. */
  missing: string[];
  /** Skills the new team shares whose re-placement failed, with the reason; the move itself succeeded. */
  failed: { name: string; error: string }[];
}

interface Placement { name: string; scope: { kind: 'global' } | { kind: 'project'; project: string }; destination: Destination; }

export async function run(args: MoveArgs, io: Prompter): Promise<Result<MoveResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const [from, binding] = selectTeam(config.teams, args.from, args.form);
    const target = parseJoinTarget(args.target);
    const toRemote = normalizeRemote(target.remote);
    const fromRemote = stripRemoteCredentials(binding.remote);
    if (teamByRemote(config, toRemote)?.[0] === from) throw new Error(`Team ${from} is already on ${repositoryUrl(toRemote)}; nothing to move. If its clone is broken, run \`${invocation(args.form, 'team join', args.target)}\`.`);
    const placements = rememberPlacements(config, from);
    const approvals = structuredClone(config.approvals);

    const summary = `Move this machine from ${from} (${repositoryUrl(fromRemote)}) to ${repositoryUrl(toRemote)}?`;
    const detail = [
      `${placements.length} placed skill(s) from ${from} will be removed, then placed again from the new team where it shares them.`,
      'The local clone is replaced; your membership in the old repository is unchanged (it may no longer exist).',
    ];
    if (!args.yes && !(await io.confirm(summary, { detail }))) throw new CancelledError('Move was cancelled.');

    // 1. Leave locally. The session hook stays: the next step binds a team again within the same run.
    const torn = await teardownTeam(store, from, io, runner);
    for (const kept of torn.kept) io.print(`Kept ${kept}.`);

    // 2. Join. Consent records were cleared by the teardown (last team on the machine); put them back
    //    before any re-placement asks, because the same skill content carries the same grants hash.
    if (Object.keys(approvals).length > 0) await store.update((fresh) => { fresh.approvals = { ...approvals, ...fresh.approvals }; });
    // The identity this machine already proved to the old team is carried over unasked; a machine that never
    // finished recording one is asked by join, exactly as a first join would.
    const identity: Identity | undefined = config.display_name && config.email
      ? { handle: binding.handle, displayName: config.display_name, email: config.email, github: config.github ?? '' }
      : undefined;
    const joined = await team({ form: args.form, kind: 'join', target: args.target, config: store, runner, hook: args.hook, offerHook: false, identity }, io);
    if (!joined.ok) throw new Error(`Left ${from}, but joining ${repositoryUrl(toRemote)} failed: ${joined.error} Run \`${invocation(args.form, 'team join', args.target)}\` to finish the move.`);
    const to = joined.value.team;

    // 3. Re-place. A skill the new team does not share is reported, not invented.
    const clone = store.teamClone(to);
    const restored: string[] = [];
    const missing: string[] = [];
    const failed: { name: string; error: string }[] = [];
    for (const placement of placements) {
      if (!existsSync(join(clone, 'skills', placement.name))) { missing.push(placement.name); continue; }
      try {
        await installOne({ team: to, reference: placement.name, scope: placement.scope, destination: placement.destination, store, runner, home: args.home }, io);
        restored.push(placement.name);
      } catch (error) { failed.push({ name: placement.name, error: error instanceof Error ? error.message : String(error) }); }
    }
    io.print(`Moved to ${to} as ${joined.value.handle}: ${restored.length} skill(s) placed again${missing.length ? `, ${missing.length} not shared there (${missing.join(', ')})` : ''}${failed.length ? `, ${failed.length} failed` : ''}.`);
    for (const entry of failed) io.print(`  ${entry.name}: ${entry.error}`);
    return success({ from, fromRemote, to, toRemote, handle: joined.value.handle, restored, missing, failed });
  } catch (error) { return fromError(error); }
}

/**
 * What the old team had placed here, as install inputs: the skill's folder name (names are unique
 * within a team; ids may differ across a re-created repository), its scope, and the destination the
 * scope implies. A project placement lives at `<checkout>/.claude/skills/<name>`, so the checkout root
 * is two folders up; a placement whose parent is gone is skipped by install's own checks later.
 */
export function rememberPlacements(config: Config, team: string): Placement[] {
  const placements: Placement[] = [];
  for (const [path, entry] of Object.entries(config.placements)) {
    if (entry.team !== team) continue;
    const name = basename(path);
    if (entry.scope.kind === 'global') placements.push({ name, scope: { kind: 'global' }, destination: { kind: 'global' } });
    else placements.push({ name, scope: { kind: 'project', project: entry.scope.project }, destination: { kind: 'checkout', root: dirname(dirname(dirname(path))) } });
  }
  return placements.sort((a, b) => a.name.localeCompare(b.name));
}
