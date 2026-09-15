import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { Prompter } from '../lib/prompt.js';
import { CancelledError, fromError, Result, success } from '../lib/result.js';
import { parseJson, personSchema, teamSchema } from '../lib/schema.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { declaredSkillId } from '../lib/skills.js';
import { listVersions, lockWait, openTeamRepo, refreshClone, SafeWriteOptions, treeText } from '../lib/teamRepo.js';
import { teamForReference } from './install.js';

export interface UnpublishArgs extends WithForm {
  /** The skill's name in the marketplace — the `skills/<name>/` folder, never a local path. */
  ref: string;
  team?: string;
  /**
   * Skips the typed-name confirmation. The desktop passes it because its own dialog already made the
   * person name what they are removing; a script passes it because there is nobody to ask.
   */
  yes?: boolean;
  config?: ConfigStore;
  runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}

export interface UnpublishResult {
  team: string;
  id: string;
  name: string;
  /** The version folders removed, newest first — `['v4','v3','v2','v1']`. */
  versions: string[];
  /** Files removed from the mutable `skills/<name>/evals/` folder. */
  evalAssets: number;
  /** Receipt files removed from `evals/<id>/`. */
  receipts: number;
  /** Projects whose `skills` list dropped the uuid. */
  projects: string[];
  /** People files whose `profile[]` dropped the skill. */
  profiles: number;
}

/**
 * `unpublish <skill>` — retract a skill from the team marketplace.
 *
 * This is the one verb that removes published bytes, and it is deliberately the inverse of `publish`
 * rather than a second kind of write. Publish mints an immutable version folder; unpublish removes
 * every version folder the skill has, plus the three other places the repository names it:
 *
 *   skills/<name>/v1..vN/**   the versions themselves
 *   skills/<name>/evals/**    the mutable eval assets beside them
 *   evals/<id>/**             the receipts publish attached to those versions
 *   team.json                 the uuid, dropped from every project's skill list
 *   people/*.json             the uuid, dropped from every member's `profile[]`
 *
 * **Anyone in the team may run it** (2026-09-14): there is no ownership check and no approval, by
 * decision, because the team is small and trusted and a wrong publish needs to be retractable by
 * whoever notices it. The typed-name confirmation is the whole brake, which is why `--yes` is the
 * only way past it and why the desktop must ask its own question before passing that flag.
 *
 * What it does NOT do:
 *
 * - **It does not rewrite history.** The bytes stay reachable in the git history of the team repo;
 *   this removes them from the working tree, which is what every reader — the catalog, `ls`, the
 *   README, install — actually reads. A team that needs the history gone needs a force-push, which
 *   is not a thing this CLI does.
 * - **It does not touch anyone's machine.** Installed copies stay where they are and keep working;
 *   the next `sync` reports them as `gone-from-repo` ("removed from the team" in the app), which is
 *   the state the product already had for a skill that vanished from the repository.
 * - **It does not free the name for a fresh lineage.** Republishing the same folder starts again at
 *   `v1` with a new uuid, so receipts keyed to the old ordinals do not come back.
 */
export async function runUnpublish(args: UnpublishArgs, io: Prompter): Promise<Result<UnpublishResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const team = await teamForReference(config, args.team, undefined, undefined, args.form);
    const binding = config.teams[team]!;
    if (!binding.handle) throw new Error(`Team ${team} has no joined handle.`);
    const clone = store.teamClone(team);
    // Refreshed before anything is read or asked: the count in the question and the identity check
    // below must both describe the repository as it is now, not as this machine last left it.
    await refreshClone(runner, clone, { label: team, ...lockWait(io) });

    const name = args.ref.trim();
    if (name === '') throw new Error('Specify a skill name.');
    const versions = await listVersions(clone, name);
    if (versions.length === 0) {
      throw new Error(`${team} has no published skill named ${name}. List what is published with \`${invocation(args.form, 'ls')}\`.`);
    }

    // The uuid is read from the newest version's own frontmatter rather than from team.json: a skill
    // that was published but never added to a project is in no list at all, and the version folder is
    // the marketplace copy. This is also the pairing row k checks — name and uuid must name one skill.
    const newest = versions[0]!;
    const head = await readVersionSkillMd(clone, name, newest.folder);
    const id = declaredSkillId(head);
    if (id === undefined) throw new Error(`${name} ${newest.folder} has no metadata.id in its SKILL.md; it cannot be unpublished by uuid.`);

    if (!args.yes) {
      if (!io.interactive) throw new Error(`Refusing to unpublish ${name} without confirmation; pass --yes.`);
      const count = versions.length === 1 ? '1 version' : `${versions.length} versions`;
      io.print(`This removes ALL ${count} of ${name} from the ${team} marketplace, for everyone.`);
      io.print('Installed copies keep working until each machine syncs, and the git history is not rewritten.');
      const typed = await io.text(`Type the skill name to confirm:`);
      if (typed.trim() !== name) throw new CancelledError(`${name} was not unpublished.`);
    }

    const repo = openTeamRepo(clone, binding.remote, runner);
    let outcome = { versions: [] as string[], evalAssets: 0, receipts: 0, projects: [] as string[], profiles: 0 };
    const written = await repo.safeWrite((tree) => {
      // safeWrite replays the mutation against a freshly reset tree, so every count restarts here and
      // every path is re-enumerated — a teammate may have published a new version in between.
      const removedVersions = new Set<string>();
      let evalAssets = 0;
      let receipts = 0;

      // 1. The skill's own bytes: every version folder and the mutable eval assets beside them. The
      //    prefix is enumerated from the post-image so a version added since `listVersions` ran is
      //    caught too — retracting a skill must not leave its newest version behind.
      const prefix = `skills/${name}/`;
      const owned = tree.paths(prefix);
      if (owned.length === 0) throw new Error(`${name} is no longer in the ${team} repository; nothing to unpublish.`);
      for (const path of owned) {
        const folder = path.slice(prefix.length).split('/')[0];
        if (folder === undefined) continue;
        if (folder === 'evals') evalAssets += 1; else removedVersions.add(folder);
        tree.remove(path);
      }

      // 2. The testimony publish attached to those versions. Keyed by uuid, not by name, because a
      //    receipt names the skill it evaluated and never the folder it happened to live in.
      for (const path of tree.paths(`evals/${id}/`)) { tree.remove(path); receipts += 1; }

      // 3. The uuid, dropped from every project list that named it. `team.json` is rewritten once,
      //    and only when a list actually changed, so an unlisted skill leaves the file untouched.
      const source = tree.before('team.json');
      if (source === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');
      const fresh = parseJson(teamSchema, treeText(source), 'team.json');
      const projects: string[] = [];
      for (const [project, record] of Object.entries(fresh.projects)) {
        const kept = record.skills.filter((skill) => skill.toLowerCase() !== id.toLowerCase());
        if (kept.length === record.skills.length) continue;
        record.skills = kept;
        projects.push(project);
      }
      if (projects.length) tree.set('team.json', `${JSON.stringify(fresh, null, 2)}\n`);

      // 4. The endorsement, dropped from every member's profile — the one write here that touches a
      //    file that is not the actor's own, admitted by row k because the skill is gone for the team.
      //    `installed[]` is left alone on purpose: it is a claim about a machine, not about the repo.
      let profiles = 0;
      for (const path of tree.paths('people/')) {
        const person = tree.before(path);
        if (person === undefined || !/^people\/[^/]+\.json$/.test(path)) continue;
        const parsed = parseJson(personSchema, treeText(person), path);
        if (parsed.profile === undefined) continue;
        const kept = parsed.profile.filter((entry) => entry.id.toLowerCase() !== id.toLowerCase());
        if (kept.length === parsed.profile.length) continue;
        tree.set(path, `${JSON.stringify({ ...parsed, profile: kept }, null, 2)}\n`);
        profiles += 1;
      }

      outcome = {
        versions: [...removedVersions].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))),
        evalAssets, receipts, projects, profiles,
      };
    }, {
      action: 'unpublish',
      handle: binding.handle,
      targetSkill: name,
      targetSkillId: id,
      message: `${binding.handle}: unpublish ${name}`,
      ...args.safeWrite,
      ...lockWait(io),
    });
    if (!written.changed) throw new Error(`Nothing was written for ${name}; rerun the command.`);

    const count = outcome.versions.length === 1 ? '1 version' : `${outcome.versions.length} versions`;
    io.print(`Unpublished ${name} from the ${team} marketplace: removed ${count}.`);
    const also = [
      outcome.evalAssets > 0 ? `${outcome.evalAssets} eval asset file(s)` : null,
      outcome.receipts > 0 ? `${outcome.receipts} eval receipt(s)` : null,
    ].filter((part): part is string => part !== null);
    if (also.length) io.print(`Also removed ${also.join(' and ')}.`);
    if (outcome.projects.length) io.print(`Removed it from ${outcome.projects.join(', ')}.`);
    if (outcome.profiles > 0) io.print(`Removed it from ${outcome.profiles} member profile(s).`);
    io.print(`Machines that installed ${name} keep their copy until they sync, which reports it as removed from the team.`);

    return success({ team, id, name, ...outcome });
  } catch (error) {
    return fromError(error);
  }
}

/** The newest version's SKILL.md, read from the clone — the file carrying the uuid row k is scoped to. */
function readVersionSkillMd(clone: string, name: string, folder: string): Promise<string> {
  return readFile(join(clone, 'skills', name, folder, 'SKILL.md'), 'utf8');
}
