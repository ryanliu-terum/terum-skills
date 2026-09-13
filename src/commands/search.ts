import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { staleLine } from '../lib/hook.js';
import { Prompter } from '../lib/prompt.js';
import { fromError, failure, Result, success } from '../lib/result.js';
import { readPerson, readTeam, skillRecords } from '../lib/skills.js';
import { installCounts, latestChange, skillEndorsement } from '../lib/readme.js';
import { versionFolderName } from '../lib/versions.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { format as formatSkill } from './ls.js';

export interface SearchArgs extends WithForm { term: string; category?: string; author?: string; project?: string; config?: ConfigStore; runner?: Runner; now?: () => number; }
export interface SearchHit {
  team: string; id: string; name: string; author: string; category: string; installs: number;
  /** §8.4: the `v<N>` FOLDER of the highest version — data, not the rendered label (see `LsSkill.latest`). */
  latest: string; endorsed: string;
  description: string; grants: string | null; grantsHash: string | null; updated: string;
}

/** Read-only clone search: git reads only (the latest tree hash), no prompts, no placement, no safeWrite. */
export async function run(args: SearchArgs, io: Prompter): Promise<Result<SearchHit[]>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const term = args.term.toLowerCase();
    const hits: SearchHit[] = [];
    const many = Object.keys(config.teams).length > 1;
    const failures: string[] = [];
    for (const [team] of Object.entries(config.teams)) {
      try {
        const clone = store.teamClone(team);
        const teamJson = await readTeam(clone);
        const records = await skillRecords(clone, team, { onProblem: (problem) => io.print(`${team}/${problem.name}: ${problem.message}`) });
        // The roster feeds only the cosmetic install count: one unreadable member file is reported and skipped, never fatal for the team.
        const people = (await Promise.all((await readdir(join(clone, 'people'))).filter((file) => file.endsWith('.json')).map((file) => readPerson(clone, file.slice(0, -5)).catch((error: unknown) => { io.print(`${team}/people/${file}: ${error instanceof Error ? error.message : String(error)}`); return undefined; })))).filter((person) => person !== undefined);
      const filtered = records.filter((skill) => {
        const category = skill.frontmatter.metadata['terum-category'];
        const author = skill.frontmatter.metadata.author;
        const inProject = !args.project || (Object.hasOwn(teamJson.projects, args.project) && teamJson.projects[args.project]!.skills.includes(skill.id));
        return (!term || [skill.name, skill.frontmatter.description, category].some((value) => value.toLowerCase().includes(term)))
          && (!args.category || category.toLowerCase().includes(args.category.toLowerCase()))
          && (!args.author || author.toLowerCase().includes(args.author.toLowerCase())) && Boolean(inProject);
      });
        if (many && filtered.length) io.print(`${team}:`);
        // `unresolved` is deleted with the tree-hash lookup (§4.1): `skillRecords` already drops any
        // name holding no `v<N>` folder, so a hit that cannot resolve a version never reaches search.
        // `latestVersion` rides along on the record; no second read, no fan-out, no per-row failure.
        const dates: PromiseSettledResult<string>[] = [];
        for (let index = 0; index < filtered.length; index += 8) dates.push(...await Promise.allSettled(filtered.slice(index, index + 8).map((skill) => latestChange(runner, clone, skill.name))));
        const counts = installCounts(people);
        for (const [index, skill] of filtered.entries()) {
        const endorsed = skillEndorsement(teamJson, skill.id);
        const date = dates[index]!;
        if (date.status === 'rejected') io.print(`${team}/${skill.name}: ${date.reason instanceof Error ? date.reason.message : String(date.reason)}`);
        const hit: SearchHit = { team, description: skill.frontmatter.description, grants: skill.grants.ok ? skill.grants.normalized : null, grantsHash: skill.grants.ok ? skill.grants.hash : null, updated: date.status === 'fulfilled' ? date.value : '—', id: skill.id, name: skill.name, author: skill.frontmatter.metadata.author, category: skill.frontmatter.metadata['terum-category'], installs: counts.get(skill.id) ?? 0, latest: versionFolderName(skill.latestVersion), endorsed };
        hits.push(hit);
        io.print(formatSkill({ id: hit.id, name: hit.name, author: hit.author, category: hit.category, characters: skill.characters, installs: hit.installs, latest: hit.latest, endorsement: hit.endorsed, description: hit.description, grants: hit.grants, grantsHash: hit.grantsHash, installedBy: [], body: null, frontmatter: null, updated: hit.updated, receipt: null, versionCount: skill.versionCount }));
        }
        const stale = await staleLine(store.root, team, args.now, args.form);
        if (stale) io.print(stale);
        // Per-row degradation covers ONE unresolvable folder. When every hit in the team failed to
        // resolve, the git side itself is unusable — git not on PATH, an unborn HEAD, a corrupt object
        // store — and the team is as unsearched as the catch below would have called it, so the exit
        // gate must still see it rather than exiting 0 on a page of '—' rows.
        if (filtered.length && dates.every((settled) => settled.status === 'rejected')) failures.push(`${team}: no skill history could be read; see the per-skill reasons above.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${team}: ${message}`);
        io.print(`${team}:`);
        io.print(isMissing(error) ? `${team} is not cloned yet; run \`${invocation(args.form, 'sync')}\`.` : `${team} could not be searched: ${message}`);
      }
    }
    if (failures.length === Object.keys(config.teams).length && failures.length) return failure(failures.join('\n'));
    if (!hits.length) io.print('No skills found.');
    return success(hits);
  } catch (error) { return fromError(error); }
}

function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

