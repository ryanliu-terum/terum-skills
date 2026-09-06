import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { stampIsFresh } from '../lib/hook.js';
import { Prompter } from '../lib/prompt.js';
import { failure, Result, success } from '../lib/result.js';
import { readPerson, readTeam, skillRecords } from '../lib/skills.js';
import { installCounts, latestTree, shortHash, skillEndorsement } from '../lib/readme.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { format as formatSkill } from './ls.js';

export interface SearchArgs { term: string; category?: string; author?: string; project?: string; config?: ConfigStore; runner?: Runner; now?: () => number; }
export interface SearchHit { team: string; id: string; name: string; author: string; category: string; installs: number; latest: string; endorsed: string; }

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
        // Each hit's latest tree, eight at a time (the fan-out is the size of the match list, so it is
        // bounded rather than one child per hit at once); one unresolvable folder — present on disk but
        // not in HEAD — costs one row and one reported line, never the team's other hits. The print
        // order is the filter order.
        const latest: PromiseSettledResult<string>[] = [];
        for (let index = 0; index < filtered.length; index += 8) latest.push(...await Promise.allSettled(filtered.slice(index, index + 8).map((skill) => latestTree(runner, clone, skill.name))));
        const counts = installCounts(people);
        for (const [index, skill] of filtered.entries()) {
        const endorsed = skillEndorsement(teamJson, skill.id);
        const settled = latest[index]!;
        if (settled.status === 'rejected') io.print(`${team}/${skill.name}: ${settled.reason instanceof Error ? settled.reason.message : String(settled.reason)}`);
        const hit = { team, id: skill.id, name: skill.name, author: skill.frontmatter.metadata.author, category: skill.frontmatter.metadata['terum-category'], installs: counts.get(skill.id) ?? 0, latest: settled.status === 'fulfilled' ? shortHash(settled.value) : '—', endorsed };
        hits.push(hit);
        io.print(formatSkill({ id: hit.id, name: hit.name, author: hit.author, category: hit.category, installs: hit.installs, latest: hit.latest, endorsement: hit.endorsed }));
        }
        await staleNotice(store, team, io, args.now ?? Date.now);
        // Per-row degradation covers ONE unresolvable folder. When every hit in the team failed to
        // resolve, the git side itself is unusable — git not on PATH, an unborn HEAD, a corrupt object
        // store — and the team is as unsearched as the catch below would have called it, so the exit
        // gate must still see it rather than exiting 0 on a page of '—' rows.
        if (filtered.length && latest.every((settled) => settled.status === 'rejected')) failures.push(`${team}: no skill version could be read; see the per-skill reasons above.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${team}: ${message}`);
        io.print(`${team}:`);
        io.print(isMissing(error) ? `${team} is not cloned yet; run \`terum-skills sync\`.` : `${team} could not be searched: ${message}`);
      }
    }
    if (failures.length === Object.keys(config.teams).length && failures.length) return failure(failures.join('\n'));
    if (!hits.length) io.print('No skills found.');
    return success(hits);
  } catch (error) { return failure(error instanceof Error ? error.message : String(error)); }
}

function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

/** One definition of "fresh" for `run/<team>.stamp` — the §8 predicate the hook uses; an unreadable stamp is not evidence of a recent sync either. */
async function staleNotice(store: ConfigStore, team: string, io: Prompter, now: () => number): Promise<void> {
  let fresh = false;
  try { fresh = await stampIsFresh(store.root, team, now); } catch { /* an unreadable stamp is not evidence of a recent sync */ }
  if (!fresh) io.print(`${team} may be stale; run \`terum-skills sync\`.`);
}
