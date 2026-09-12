import { invocation } from '../lib/invocation.js';
import type { WithForm } from '../lib/invocation.js';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalLedger, localRootLabel, candidatesOf, localSkillRoots, localSkills, resolveLibrarySkill } from '../lib/local-skills.js';
import type { Config } from '../lib/schema.js';
import { ConfigStore, createConfigStore } from '../lib/config.js';
import { Prompter } from '../lib/prompt.js';
import { fromError, CancelledError, Result, success } from '../lib/result.js';
import { GLOBAL_PROJECT, parseJson, parseSkillFrontmatter, teamSchema } from '../lib/schema.js';
import { Runner, systemRunner } from '../lib/runner.js';
import { DEFAULT_CATEGORY, declaredCategory, declaredSkillId, injectManagedFields, readTeam, skillContentDigest, skillRecords } from '../lib/skills.js';
import { openTeamRepo, refreshClone, SafeWriteOptions, treeText, lockWait } from '../lib/teamRepo.js';
import { teamForReference } from './install.js';
import { assertNotInsideStateRoot, assertSkillDirectory, sourceFiles } from '../lib/skill-source.js';
import { assessHygiene, HygieneRefused, reportHygieneWarnings } from '../lib/evals/hygiene.js';
import { versionFolderName, versionLabel, versionsInTree } from '../lib/versions.js';
import { localReceiptsFor } from '../lib/evals/receipt-store.js';
import { offerProfileEntry } from '../lib/profile-entry.js';

export interface PublishArgs extends WithForm {
  ref: string;
  project?: string;
  team?: string;
  category?: string;
  /** Pre-answers §5.1 step 6a's regression question, for the desktop and for scripts. */
  allowRegression?: boolean;
  /** Pre-answers the profile prompt, for the desktop and for tests. */
  yesProfile?: boolean;
  /** The home the local skills root is derived from (tests); defaults to homedir(). */
  home?: string;
  cwd?: string;
  config?: ConfigStore;
  runner?: Runner;
  safeWrite?: Pick<SafeWriteOptions, 'deadlineMs' | 'backoff' | 'now' | 'sleep'>;
}

export interface PublishResult {
  team: string; id: string; name: string; project: string;
  /** `'v4'`, or null when the bytes were identical to an existing version. */
  version: string | null;
  created: boolean;
  /** `'v2'` when this publish was refused as identical. */
  identicalTo: string | null;
  attachedEvals: number;
  profileAdded: boolean;
  /** This publish appended the uuid to `projects[project].skills`. */
  projectAdded: boolean;
}

/**
 * §5: publish copies ONE local skill folder into the team repo as its next immutable version.
 *
 * It is the only bridge between the two mirrors and the only thing that can write a skill. Everything
 * before `safeWrite` reads and asks; the mutation itself is pure.
 */
export async function run(args: PublishArgs, io: Prompter): Promise<Result<PublishResult>> {
  try {
    const store = args.config ?? createConfigStore();
    const runner = args.runner ?? systemRunner;
    const config = await store.read();
    const team = await teamForReference(config, args.team, undefined, args.ref, args.form);
    const binding = config.teams[team]!;
    if (!binding.handle) throw new Error(`Team ${team} has no joined handle.`);
    const clone = store.teamClone(team);
    await refreshClone(runner, clone, { label: team, ...lockWait(io) });
    const teamJson = await readTeam(clone);

    // 1. Resolve the ref to a LOCAL folder. You publish what is on your machine, never what is in
    //    the clone — that is the whole direction of this refactor.
    const found = await resolveLibrarySkill(args.home ?? homedir(), config, store.root, args.ref);
    if (!found) throw new Error(await notFoundLocally(args, config, team, args.ref, store.root));

    // 2. Refuse a nested symlink or a non-directory before reading a byte.
    assertNotInsideStateRoot(found.path, store.root);
    await assertSkillDirectory(found.path);

    // 3. One map of every file, eval cases included (D9) — they are skill bytes like any other.
    const { files, executable } = await sourceFiles(found.path);
    const skillMd = files.get('SKILL.md');
    if (skillMd === undefined) throw new Error(`${found.path} has no SKILL.md.`);

    // 4. Managed fields, resolved into the IN-MEMORY SKILL.md before anything is hygiene-checked or
    //    digested. The category precedence is declared > --category > DEFAULT_CATEGORY; the model
    //    call that sits between the last two arrives with B9 (auto-category, D28).
    const declared = declaredCategory(skillMd.toString('utf8'));
    const category = declared ?? args.category ?? DEFAULT_CATEGORY;
    if (declared === undefined) io.print(`metadata.terum-category: ${category} (${args.category ? 'from --category' : 'default'}; edit SKILL.md any time)`);
    // The REPOSITORY is the authority on which uuid a published name carries, not the local file.
    // Reading the id only from the folder was wrong in both directions: `existingId` parsed through
    // the `.strict()` `skillFrontmatterSchema`, so a published folder whose user deleted the injected
    // `license:` line minted a FRESH uuid and orphaned every receipt, install and profile entry keyed
    // to the old one; and a folder COPIED from another skill kept that skill's declared uuid, landing
    // this publish's receipts in that skill's eval history.
    const catalogue = await skillRecords(clone, team);
    const published = catalogue.find((record) => record.name === found.name);
    const declaredId = declaredSkillId(skillMd.toString('utf8'));
    const id = published?.id
      // A declared id already belonging to a DIFFERENT name means a copied folder: mint instead of
      // grafting onto that skill's identity. §5.1 step 4's "minted at v1" is exactly this case.
      ?? (declaredId !== undefined && !catalogue.some((record) => record.id === declaredId) ? declaredId : randomUUID());
    const author = `${config.display_name ?? binding.handle} <${config.email ?? ''}>`.trim();
    const injected = Buffer.from(injectManagedFields(skillMd.toString('utf8'), { license: teamJson.policy.skill_license, id, author, category }));
    files.set('SKILL.md', injected);

    // 5. Hygiene on the INJECTED map, never before — `skillFrontmatterSchema` is strict and requires
    //    the managed fields, so a never-published folder would fail HYG1 on fields publish is about
    //    to write.
    const assessment = assessHygiene(found.name, { files, executable }, teamJson.policy.skill_license, true);
    reportHygieneWarnings((line) => io.print(line), assessment);

    // 6. The comparison digest, taken AFTER injection so it is post-normalization.
    const candidate = skillContentDigest(files);

    // 6a. The local regression gate (D19). Absence of a receipt never blocks; nothing moves here.
    const local = await localReceiptsFor(store.root, candidate);
    // D19 asks about the LATEST eval of these exact bytes. `localReceiptsFor` sorts run ids ascending
    // and run ids are UTC stamps, so `.find(FAIL)` returned the OLDEST failure: once a run failed, no
    // amount of passing re-runs of the same bytes could ever clear the gate again.
    const newest = local.at(-1);
    const failing = newest?.receipt.verdict === 'FAIL' ? newest : undefined;
    if (failing && !args.allowRegression) {
      const against = failing.receipt.version ? versionLabel(Number(failing.receipt.version.slice(1))) : 'the previous version';
      if (!(await io.confirm(`Your latest eval of these exact bytes failed against ${against}. Publish anyway?`))) {
        throw new CancelledError('Publish was cancelled.');
      }
    }

    // 6b. The project question is a REFUSAL, so it belongs ABOVE the write-back: it throws on an
    //     unknown `--project`, and its `io.select` can be cancelled or throw on a team whose projects
    //     do not include `Global`. The comment below asserted this ordering while the code had the
    //     opposite — a mistyped `--project` rewrote the user's SKILL.md on a publish that never ran.
    const project = await chooseProject(args, teamJson, io);

    // 6c. The local write-back, AFTER the last refusal (OF-2): a publish refused at any question
    //     leaves the folder byte-identical. A safeWrite failure after this point leaves the injected
    //     SKILL.md on disk with nothing published — the safe side of the boundary, and idempotent,
    //     because every injected field is re-derived identically on the next attempt.
    await writeFile(join(found.path, 'SKILL.md'), injected);

    const repo = openTeamRepo(clone, binding.remote, runner);
    let outcome: { version: string | null; identicalTo: string | null; attached: number; projectAdded: boolean } = { version: null, identicalTo: null, attached: 0, projectAdded: false };
    const written = await repo.safeWrite((tree) => {
      const teamSource = tree.before('team.json');
      if (teamSource === undefined) throw new Error('This repository has no team.json; it is not a terum-skills team repo.');
      const fresh = parseJson(teamSchema, treeText(teamSource), 'team.json');
      if (!Object.hasOwn(fresh.projects, project)) throw new Error(`Unknown project ${project}.`);

      // 7. Enumerate this name's versions from the TREE, not with listVersions: a pure mutation may
      //    only see the post-image. Walk descending and stop at the first digest equal to candidate.
      const existing = versionsInTree(tree, found.name);
      // 7a. This name already has a lineage: prove it is THIS skill's before appending to it.
      //     `origin/main` refused here and the refusal was lost in the layout-3 rewrite. Row a' cannot
      //     stand in for it — it proves the path is an add and says outright that ownership is not
      //     consulted. Without this, two members whose Library both hold a folder called `deploy`
      //     publish into one lineage: `skillRecords` resolves a name to its newest version, so the
      //     team's `deploy` silently becomes the second member's skill, the first member's uuid stays
      //     in team.json reachable through no name, their eval history drops out of `ls`, and every
      //     machine holding their install reads `gone-from-repo`.
      const incumbent = existing[0];
      if (incumbent !== undefined) {
        const head = tree.after(`skills/${found.name}/${incumbent.folder}/SKILL.md`);
        const parsed = head === undefined ? undefined : parseSkillFrontmatter(treeText(head));
        if (!parsed?.ok || parsed.data.metadata.id !== id) {
          throw new Error(`${found.name} is no longer in the repository as ${id.slice(0, 8)}; run sync and retry.`);
        }
      }
      let identical: string | null = null;
      for (const version of existing) {
        const prefix = `skills/${found.name}/${version.folder}/`;
        const committed = new Map<string, Buffer>();
        for (const path of tree.paths(prefix)) {
          const contents = tree.after(path);
          // The prefix MUST be stripped: tree.paths() returns full repo-relative paths while §3.3's
          // record stream is skill-folder-relative. Feed it unstripped and no version ever compares
          // equal, so every publish mints forever and step 8's refusal is unreachable.
          if (contents !== undefined) committed.set(path.slice(prefix.length), Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
        }
        if (committed.size && skillContentDigest(committed) === candidate) { identical = version.folder; break; }
      }

      const target = identical ?? versionFolderName((existing[0]?.n ?? 0) + 1); // never count + 1
      // §4.5/D10: carry the mode across with the bytes. `sourceFiles` already detects it
      // (`skill-source.ts`'s `lstat(next).mode & 0o111`); before this the set was read for hygiene
      // and then dropped, so every published `scripts/*.sh` arrived 0644 and would not run.
      if (identical === null) for (const [key, contents] of files) {
        const path = `skills/${found.name}/${target}/${key}`;
        tree.set(path, contents);
        if (executable.has(key)) tree.setExecutable(path, true);
      }

      // 9. Attach every local receipt taken of these exact bytes, as a COPY stamped with the publish
      //    uuid and this version — never a plain file copy. The stamping is what makes §8.1's
      //    misfiled check meaningful. The local run itself is not rewritten: it is local state.
      let attached = 0;
      for (const entry of local) {
        const path = `evals/${id}/${target}/${entry.runId}.json`;
        if (tree.before(path) !== undefined) continue;
        tree.set(path, `${JSON.stringify({ ...entry.receipt, skill_id: id, version: target }, null, 2)}\n`);
        attached += 1;
      }

      // 9a. Project membership, whether or not a version was minted: the project list records where
      //     the team exposes a skill, the version records its bytes.
      const list = fresh.projects[project]!.skills;
      const projectAdded = !list.includes(id);
      if (projectAdded) { list.push(id); tree.set('team.json', `${JSON.stringify(fresh, null, 2)}\n`); }

      outcome = { version: identical === null ? target : null, identicalTo: identical, attached, projectAdded };
      return assessment;
    }, {
      action: 'publish',
      handle: binding.handle,
      message: `${binding.handle}: publish ${found.name}`,
      ...args.safeWrite,
      ...lockWait(io),
    });
    void written;

    const at = outcome.version ?? outcome.identicalTo!;
    if (outcome.version !== null) {
      io.print(`Published ${found.name} as ${versionLabel(Number(at.slice(1)))} in ${project}. Attached ${outcome.attached} eval run(s).`);
    } else if (outcome.projectAdded) {
      io.print(`Added ${found.name} to ${project}. It is identical to ${versionLabel(Number(at.slice(1)))} of the skill already in the team repository.`);
    } else if (outcome.attached === 0) {
      io.print(`Nothing to publish: ${found.name} is identical to ${versionLabel(Number(at.slice(1)))} and already in ${project}.`);
    } else {
      io.print(`The skill you tried to publish is identical to ${versionLabel(Number(at.slice(1)))} of the skill already in the team repository.`);
    }
    const unmatched = local.length - outcome.attached;
    if (outcome.version !== null && unmatched > 0) io.print(`${unmatched} local eval run(s) were not attached — they evaluated this folder before its first publish.`);

    // 10. Publishing is not installing (D5). The only people-file write here is the profile prompt.
    //     It is a SECOND, independent safeWrite that runs after the version is committed and pushed,
    //     so its failure must not be reported as a failed publish: the version is durable in the
    //     shared repo and the success lines are already on screen. Before this, a missing people
    //     file, a lock timeout or a network blip returned a failure Result carrying no
    //     PublishResult, for a publish that fully succeeded.
    let profileAdded = false;
    try {
      profileAdded = await offerProfileEntry({ store, clone, team, handle: binding.handle, remote: binding.remote, runner, id, name: found.name, version: at, via: 'publish', preAnswered: args.yesProfile }, io);
    } catch (error) {
      io.print(`Published ${found.name}, but could not add it to your profile: ${error instanceof Error ? error.message : String(error)}`);
    }

    return success({ team, id, name: found.name, project, version: outcome.version, created: outcome.version !== null, identicalTo: outcome.identicalTo, attachedEvals: outcome.attached, profileAdded, projectAdded: outcome.projectAdded });
  } catch (error) {
    if (error instanceof HygieneRefused) reportHygieneWarnings((line) => io.print(line), error.assessment);
    return fromError(error);
  }
}


/** A choice list defaulting to Global when the team has more than one project and --project is absent. */
async function chooseProject(args: PublishArgs, teamJson: Awaited<ReturnType<typeof readTeam>>, io: Prompter): Promise<string> {
  if (args.project !== undefined) {
    if (!Object.hasOwn(teamJson.projects, args.project)) throw new Error(`Unknown project ${args.project}.`);
    return args.project;
  }
  const names = Object.keys(teamJson.projects).sort();
  if (names.length <= 1) return names[0] ?? GLOBAL_PROJECT;
  return io.select('Which project?', names, GLOBAL_PROJECT);
}

/** The miss supplies read-only local discovery guidance, never an import or tracking write. */
async function notFoundLocally(args: PublishArgs, config: Config, team: string, name: string, stateRoot: string): Promise<string> {
  const discovery = await localSkillRoots(args.home ?? homedir(), config.projects ?? []);
  const ledger = await canonicalLedger(config);
  const inventories = await Promise.all(discovery.roots.map((root) => localSkills(root.root, config, { scope: root.scope, stateRoot, ledger })));
  const found = inventories.flatMap((inventory, index) => candidatesOf(inventory).filter((entry) => entry.name === name).map((entry) => ({ ...entry, label: localRootLabel(discovery.roots[index]!) })));
  const unreadable = discovery.problems.length + inventories.reduce((count, inventory) => count + inventory.problems.length + inventory.entries.filter((entry) => entry.inspection.kind === 'failed').length, 0);
  const note = unreadable ? ` (${unreadable} local folder(s) under ${discovery.roots.map((root) => root.root).join(' or ')} could not be read.)` : '';
  if (found.length) return `${name} was found at ${found.map((entry) => entry.path).join(', ')} but could not be published to ${team}.${note}`;
  return `No local skill folder named ${name} in your library. Inspect it with \`${invocation(args.form, 'ls --local')}\`, or add the project holding it with \`${invocation(args.form, 'project add')}\`.${note}`;
}
