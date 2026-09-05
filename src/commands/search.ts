import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { Prompter } from '../lib/prompt.js';
import { failure, Result, success } from '../lib/result.js';
import { readPerson, readTeam, skillRecords } from '../lib/skills.js';
import { skillEndorsement } from '../lib/readme.js';

export interface SearchArgs { term: string; category?: string; author?: string; project?: string; config?: ConfigStore; now?: () => number; }
export interface SearchHit { team: string; name: string; author: string; category: string; installs: number; endorsed: string; }

/** Read-only clone search: no runner, no prompts, no placement, no safeWrite. */
export async function run(args: SearchArgs, io: Prompter): Promise<Result<SearchHit[]>> {
  try {
    const store = args.config ?? createConfigStore();
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
        const people = await Promise.all((await readdir(join(clone, 'people'))).filter((file) => file.endsWith('.json')).map((file) => readPerson(clone, file.slice(0, -5))));
      const filtered = records.filter((skill) => {
        const category = skill.frontmatter.metadata['terum-category'];
        const author = skill.frontmatter.metadata.author;
        const inProject = !args.project || teamJson.projects[args.project]?.skills.includes(skill.id);
        return (!term || [skill.name, skill.frontmatter.description, category].some((value) => value.toLowerCase().includes(term)))
          && (!args.category || category.toLowerCase().includes(args.category.toLowerCase()))
          && (!args.author || author.toLowerCase().includes(args.author.toLowerCase())) && Boolean(inProject);
      });
        if (many && filtered.length) io.print(`${team}:`);
        for (const skill of filtered) {
        const endorsed = skillEndorsement(teamJson, skill.id);
        const hit = { team, name: skill.name, author: skill.frontmatter.metadata.author, category: skill.frontmatter.metadata['terum-category'], installs: people.reduce((count, person) => count + Number(person.installed.some((item) => item.id === skill.id)), 0), endorsed };
        hits.push(hit);
        io.print(`${skill.name}  ${hit.author}  ${hit.category}  installs:${hit.installs}  ${hit.endorsed}`);
        }
        await staleNotice(store, team, io, args.now ?? Date.now);
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

async function staleNotice(store: ConfigStore, team: string, io: Prompter, now: () => number): Promise<void> {
  try { if (now() - (await stat(join(store.root, 'run', `${team}.stamp`))).mtimeMs > 3_600_000) io.print(`${team} may be stale; run \`terum-skills sync\`.`); }
  catch { io.print(`${team} may be stale; run \`terum-skills sync\`.`); }
}
