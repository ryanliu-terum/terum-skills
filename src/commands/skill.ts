/** Explicit Library file operations (§7.5). Team removal stays owned by uninstallMany. */
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import YAML from 'yaml';
import { createConfigStore, type ConfigStore } from '../lib/config.js';
import { writeJsonPrivate } from '../lib/fs.js';
import { canonicalLedger, localSkillRoots } from '../lib/local-skills.js';
import { appendExclude, lockTarget, moveDirectory, moveToQuarantine, place } from '../lib/placer.js';
import { isSkillsRoot } from '../lib/placer/agent-paths.js';
import { projectPath } from '../lib/projects.js';
import { snapshotSkillDirectory } from '../lib/placer/vendor/skillhub/skill-fingerprint.js';
import type { Prompter } from '../lib/prompt.js';
import { cancelled, failure, fromError, success, type Result } from '../lib/result.js';
import { systemRunner, type Runner } from '../lib/runner.js';
import { FRONTMATTER, isSkillName, type Config } from '../lib/schema.js';
import { planRepairs } from '../lib/skill-repair.js';
import { assessHygiene, formatHygieneFindings, HygieneRefused, offListCategory } from '../lib/evals/hygiene.js';
import { selectTeam } from '../lib/config.js';
import { teamCategory } from '../lib/categorize.js';
import { declaredCategory, readTeam, skillRecords } from '../lib/skills.js';
import { versionLabel } from '../lib/versions.js';
import { inspectSkillSource, scanSkillFolder, sourceFiles } from '../lib/skill-source.js';
import { invocation, type WithForm } from '../lib/invocation.js';
import { uninstallMany } from './uninstall.js';

export interface SkillArgs extends WithForm { kind: 'move' | 'copy' | 'rename' | 'delete' | 'fix' | 'category'; path: string; to?: string; config?: ConfigStore; home?: string; runner?: Runner }
export interface SkillResult { kind: SkillArgs['kind']; path: string; destination: string | null; quarantined: string | null; installed: boolean; notices: string[] }
interface Operation { source: string; ledgerPath?: string; destination: string | null; placement?: Config['placements'][string]; fingerprint: string | null; kept: string | null; destinationExisted: boolean; done: boolean; result?: SkillResult }

async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
/** Case-only spelling changes on a case-insensitive volume still name this one directory. */
async function sameFolder(from: string, to: string): Promise<boolean> {
  const [a, b] = await Promise.all([lstat(from), lstat(to)]);
  return a.isDirectory() && b.isDirectory() && !a.isSymbolicLink() && !b.isSymbolicLink() && a.ino !== 0 && a.ino === b.ino && a.dev === b.dev;
}
async function plainFolder(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing ${path}: not a plain folder (symlinks are not allowed).`);
  if ((await scanSkillFolder(path)).symlink) throw new Error(`Refusing ${path}: contains a symlink.`);
}
async function frontmatter(path: string): Promise<{ raw: string; document: YAML.Document; end: number } | null> {
  let raw: string;
  try { raw = await readFile(join(path, 'SKILL.md'), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const match = FRONTMATTER.exec(raw);
  if (!match) return null;
  const document = YAML.parseDocument(match[1]!);
  if (document.errors.length || !YAML.isMap(document.contents)) return null;
  return { raw, document, end: match[0].length };
}
async function rewriteName(path: string): Promise<void> {
  const fm = await frontmatter(path);
  // D16 includes folders without readable frontmatter: rename those without inventing skill bytes.
  if (!fm || fm.document.get('name') === basename(path)) return;
  fm.document.set('name', basename(path));
  await writeFile(join(path, 'SKILL.md'), `---\n${fm.document.toString()}---\n${fm.raw.slice(fm.end)}`);
}
/** D75: recovery joins ONLY by stable id. A read: the caller locks the match before `repairSibling` writes to it. */
async function findSibling(oldPath: string, row: Config['placements'][string]): Promise<string | undefined> {
  const matches: string[] = [];
  for (const entry of await readdir(dirname(oldPath), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const path = join(dirname(oldPath), entry.name);
    const fm = await frontmatter(path);
    if (fm?.document.getIn(['metadata', 'id']) === row.id) matches.push(path);
  }
  if (matches.length > 1) throw new Error(`Several sibling folders carry ${row.id}; cannot safely repair ${oldPath}.`);
  return matches[0];
}
/** D75: re-point the row at the sibling, or drop it when none carries the id. Never refresh the fingerprint: an edit stays edited. */
async function repairSibling(store: ConfigStore, oldPath: string, row: Config['placements'][string], path: string | undefined): Promise<string | undefined> {
  if (path === undefined) { await store.update(c => { delete c.placements[oldPath]; }); return undefined; }
  await plainFolder(path);
  await rewriteName(path);
  await store.update(c => { c.placements[path] = row; delete c.placements[oldPath]; });
  return path;
}

/**
 * `skill fix <path>`: apply every repair `planRepairs` covers to one Library folder, then run the
 * same inspection and hygiene gate `ls --local` and `validate` use and say what still needs the
 * author. There is no name to type: nothing moves, the folder is the user's own, and each change is
 * fixed by an authority outside the author's typing (YAML's grammar, the folder name, the team
 * policy, HYG2's invisible set, a file mode). `installed` is read from the ledger as the other kinds
 * report it; a placed folder's bytes now differ from the team's, which `ls` shows as edited.
 */
async function fix(args: SkillArgs, io: Prompter): Promise<Result<SkillResult>> {
  const store = args.config ?? createConfigStore();
  const source = resolve(args.path), name = basename(source);
  await plainFolder(source);
  const config = await store.read();
  const installed = config.placements[source] !== undefined;
  // The team's license is the only authority for `license:`; with no team there is none, and license stays.
  let policyLicense: string | null = null;
  try { policyLicense = (await readTeam(store.teamClone(selectTeam(config.teams, undefined, args.form)[0]))).policy.skill_license; } catch { /* No configured team: nothing to conform to. */ }
  const result = (notices: string[]): SkillResult => ({ kind: 'fix', path: source, destination: null, quarantined: null, installed, notices });
  // Hold the folder's lock across read and write so a concurrent rename cannot slip between them.
  const release = await lockTarget(dirname(source), name);
  try {
    if (!(await present(join(source, 'SKILL.md')))) throw new Error(`${source} has no SKILL.md; nothing to fix.`);
    const plan = planRepairs({ name, ...(await sourceFiles(source)), policyLicense });
    for (const [path, bytes] of plan.writes) await writeFile(join(source, path), bytes);
    for (const path of plan.clearExecutable) await chmod(join(source, path), (await stat(join(source, path))).mode & 0o7666);
    const notices = [...plan.repaired];
    // What the author still has to settle, from the two gates the folder must pass to be offered and published.
    const after = await sourceFiles(source);
    const inspection = inspectSkillSource(after.files.get('SKILL.md')!.toString('utf8'), name);
    const remaining: string[] = inspection.ok ? [] : [inspection.detail];
    try { assessHygiene(name, after, policyLicense, false, true); }
    catch (error) { if (!(error instanceof HygieneRefused)) throw error; for (const line of formatHygieneFindings(error.assessment.errors).split('\n')) if (line && !remaining.includes(line)) remaining.push(line); }
    if (remaining.length) notices.push(`Still needs you (${remaining.length}):`, ...remaining.map(line => `  ${line}`));
    else notices.push(plan.repaired.length ? `${name}: hygiene passes.` : `${name}: nothing to fix; hygiene passes.`);
    for (const line of notices) io.print(line);
    if (!plan.repaired.length && remaining.length) return failure(`${name}: nothing here is a fault fix covers; ${remaining.length} finding${remaining.length === 1 ? '' : 's'} still need${remaining.length === 1 ? 's' : ''} you (listed above).`, result(notices));
    return success(result(notices));
  } finally { await release(); }
}

/**
 * `skill category <path> --to <name>`: rewrite one Library folder's `metadata.terum-category`, then stop.
 *
 * The category is the one managed field a person legitimately changes their mind about, and
 * `publish --category` cannot do it: `injectManagedFields` FILLS a missing category and never
 * overwrites a declared one, so that flag is the default for a folder carrying none, not an editor.
 * This is the editor, and it edits nothing else — no publish, no network, no write to the team. What
 * reaches the team stays a decision the user makes afterwards, because a published category lives
 * inside an immutable `v<N>/SKILL.md` that guard row a′ refuses to modify: the only way to change
 * what the marketplace shows is a new version. So when the team already holds this name, the run says
 * what the team still shows and prints the publish that would mint the next one.
 *
 * The value is free text on purpose. `team.json.categories` is advice — HYG7 warns on an off-list
 * value and gates nothing — so an off-list category is written and given HYG7's own sentence beside
 * it. A value the team already spells differently takes the team's spelling, the rule every other
 * category source goes through (categorize.ts `teamCategory`), so `--to Ops` lands in the one `ops`
 * bucket instead of opening a second beside it.
 */
async function category(args: SkillArgs, io: Prompter): Promise<Result<SkillResult>> {
  const requested = args.to?.trim();
  if (!requested) throw new Error('--to must be a non-empty category name.');
  const store = args.config ?? createConfigStore();
  const source = resolve(args.path), name = basename(source);
  await plainFolder(source);
  const config = await store.read();
  const installed = config.placements[source] !== undefined;
  // Offline and read-only: the clone as the last sync left it. Both things it supplies are advice —
  // the team's spelling of the category, and what the team's newest version still declares — so no
  // configured team, an unreadable clone, or a name the team has never seen drops a line rather than
  // refusing an edit to the user's own folder. The name is the lineage key publish itself joins on.
  let categories: readonly string[] = [], published: { version: number; category: string } | undefined;
  try {
    const [team] = selectTeam(config.teams, undefined, args.form), clone = store.teamClone(team);
    categories = (await readTeam(clone)).categories;
    const record = (await skillRecords(clone, team)).find((record) => record.name === name);
    if (record) published = { version: record.latestVersion, category: record.frontmatter.metadata['terum-category'] };
  } catch { /* Nothing to compare against; the local edit stands on its own. */ }
  const chosen = teamCategory(requested, categories) ?? requested;
  // Hold the folder's lock across read and write, as `fix` does: a concurrent rename must not slip between them.
  const release = await lockTarget(dirname(source), name);
  try {
    if (!(await present(join(source, 'SKILL.md')))) throw new Error(`${source} has no SKILL.md; there is no category to change.`);
    const fm = await frontmatter(source);
    if (!fm) throw new Error(`${source}: SKILL.md frontmatter is not readable YAML; run \`${invocation(args.form, 'skill fix', source)}\` first.`);
    const current = declaredCategory(fm.raw);
    if (current === chosen) throw new Error(`${name} already declares ${chosen}; nothing to change.`);
    // A real YAML map for a folder with no `metadata:` block at all: `setIn` walks nodes and treats a
    // plain `{}` as a scalar, the same shape that used to crash the connect (skills.ts injectManagedFields).
    if (!YAML.isMap(fm.document.get('metadata'))) fm.document.set('metadata', fm.document.createNode({}));
    fm.document.setIn(['metadata', 'terum-category'], chosen);
    await writeFile(join(source, 'SKILL.md'), `---\n${fm.document.toString()}---\n${fm.raw.slice(fm.end)}`);
    const notices = [current === undefined ? `Set ${name} to ${chosen}; its SKILL.md declared no category.` : `Changed ${name} from ${current} to ${chosen}.`];
    if (categories.length && teamCategory(chosen, categories) === undefined) notices.push(offListCategory(chosen, categories));
    if (published?.category === chosen) notices.push(`The team already shows ${chosen}: ${versionLabel(published.version)} declares it too, so there is nothing to publish.`);
    else if (published) notices.push(
      `The team still shows ${published.category}: a published category lives inside ${versionLabel(published.version)}'s files, which never change.`,
      `Publish to mint ${versionLabel(published.version + 1)} with the new category:`,
      `  ${invocation(args.form, 'publish', name)}`);
    for (const line of notices) io.print(line);
    return success({ kind: 'category', path: source, destination: null, quarantined: null, installed, notices });
  } finally { await release(); }
}

export async function run(args: SkillArgs, io: Prompter): Promise<Result<SkillResult>> {
  if (args.kind === 'fix') return fix(args, io).catch(fromError);
  if (args.kind === 'category') return category(args, io).catch(fromError);
  const releases: Array<() => Promise<void>> = [];
  const locked = new Set<string>();
  // One non-waiting lock per folder (retries: 0): a second acquire on a folder this run already holds would refuse itself.
  const lock = async (path: string): Promise<void> => { if (locked.has(path)) return; locked.add(path); releases.push(await lockTarget(dirname(path), basename(path))); };
  try {
    const store = args.config ?? createConfigStore(), home = args.home ?? homedir(), runner = args.runner ?? systemRunner;
    const config = await store.read();
    const { roots } = await localSkillRoots(home, config.projects ?? []);
    const source = resolve(args.path), parent = dirname(source), name = basename(source);
    if (!isSkillsRoot(parent)) throw new Error(`Refusing ${source}: it must sit directly under a Library skills root.`);
    const canonical = await realpath(parent);
    const root = roots.find(r => resolve(r.root) === parent) ?? (await Promise.all(roots.map(async r => ({ r, path: await realpath(r.root).catch(() => r.root) })))).find(r => r.path === canonical)?.r;
    if (!root) throw new Error(`Refusing ${source}: its parent is not a registered Library root.`);
    let destination: string | null = null;
    let targetRoot = root;
    if (args.kind === 'rename') {
      if (!args.to || !isSkillName(args.to)) throw new Error('The new name must be 1–64 lowercase alphanumerics or single hyphens.');
      destination = join(parent, args.to);
    } else if (args.kind === 'move' || args.kind === 'copy') {
      // hybrid review r1 (high): `config.projects[].root` is stored realpath'd (addLibraryProject) while
      // `--to` arrives verbatim, so a registered project reached through a symlink (`~/dev -> /Volumes/…`)
      // was refused as unregistered. Match the way the source root is matched above: literal first, then
      // realpath on both sides — a hand-edited config may hold the alias, and a realpath'd `--to` the target.
      const to = args.to === undefined || args.to === 'global' ? undefined : await projectPath(args.to);
      const found = roots.find(r => args.to === 'global' ? r.scope === 'global' : r.repoRoot !== undefined && r.repoRoot === resolve(args.to ?? ''))
        ?? (to === undefined ? undefined : (await Promise.all(roots.map(async r => ({ r, path: r.repoRoot === undefined ? undefined : await projectPath(r.repoRoot) })))).find(r => r.path === to)?.r);
      if (!found || !args.to) throw new Error('Choose global or a registered project root; add the project with project add first.');
      targetRoot = found;
      destination = join(targetRoot.root, name);
    }
    if (destination === source) throw new Error('The source and destination are the same folder.');
    if (await present(source)) await plainFolder(source);
    if (destination && await present(destination) && !(args.kind === 'rename' && await present(source) && await sameFolder(source, destination))) await plainFolder(destination);
    // Only `delete` asks (Ryan, 2026-09-14, superseding §7.5's "the user must confirm by typing the
    // skill's name" for the other three). Move, copy and rename are reversible by a second run of this
    // same verb and nothing is ever overwritten — a displaced folder is kept in `old-skills` — so the
    // typed name bought friction, not safety. Deletion is the one that ends in quarantine or in the
    // team's copy being the only copy, and it keeps the ask. The remaining rails are unchanged: a
    // direct child of a registered Library root, no symlinks, and an explicit `--to`.
    if (args.kind === 'delete' && await io.text(`Type ${name} to ${args.kind} this folder`) !== name) return cancelled('The name did not match; nothing changed.');
    // Lock in deterministic order. uninstallMany owns the delete lock itself.
    if (args.kind !== 'delete') for (const path of [...new Set([source, destination!])].sort()) await lock(path);
    const journal = join(store.root, 'run', 'skill-files', createHash('sha256').update(JSON.stringify([args.kind, source, destination])).digest('hex') + '.json');
    let op: Operation | undefined;
    try { op = JSON.parse(await readFile(journal, 'utf8')) as Operation; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // A new folder at the old path starts a new explicit operation; otherwise a completed re-run is inert.
    if (op?.done && !(await present(source)) && op.result) { for (const line of op.result.notices) io.print(line); return success(op.result); }
    if (op?.done) op = undefined;
    if (!op) {
      const recorded = (await canonicalLedger(config)).placementPaths.find(row => row.target === source || row.canonical === join(canonical, name));
      const placement = recorded?.ref;
      let actual = source;
      if (!(await present(source)) && placement) {
        const sibling = await findSibling(recorded!.target, placement);
        // hybrid review r1 (high): the lock set above is keyed by the request's literal names, so a
        // sibling the user renamed to a third name (ledger `alpha`, folder now `gamma`, request
        // `rename alpha beta`) is a folder no lock covers — yet the repair rewrites its SKILL.md and
        // the rename/move body moves it. Lock it before the first write; released in the same
        // `finally`. Delete stays out: uninstallMany takes that folder's lock itself, and a second
        // acquire here would refuse it.
        if (sibling !== undefined && args.kind !== 'delete') await lock(sibling);
        actual = await repairSibling(store, recorded!.target, placement, sibling) ?? source;
      }
      if (!(await present(actual))) {
        if (args.kind !== 'delete') throw new Error(`${source} no longer exists and no sibling has its recorded metadata.id.`);
      }
      op = { source: actual, destination, ...(placement ? { placement, ledgerPath: actual === source ? recorded!.target : actual } : {}), destinationExisted: destination !== null && await present(destination), fingerprint: await present(actual) ? (await snapshotSkillDirectory(actual)).fingerprint : null, kept: null, done: false };
      await writeJsonPrivate(journal, op);
    // A journaled re-run resumes on the folder the first run resolved, which the literal names may not cover either.
    } else if (args.kind !== 'delete') await lock(op.source);
    const notices: string[] = [];
    let quarantined: string | null = null;
    if (args.kind === 'delete' && op.placement) {
      notices.push('This skill was installed from the team — deleting it also removes it from your installs.');
      const entry = op.placement, target = { id: entry.id, scope: entry.scope };
      await uninstallMany({ store, runner, home, team: entry.team, targets: [target], selections: [{ target, matching: [[op.ledgerPath ?? op.source, entry]], destination: root.scope === 'global' ? { kind: 'global' } : { kind: 'checkout', root: root.repoRoot! } }] }, { ...io, print: line => { notices.push(line); } });
    } else if (args.kind === 'delete') {
      const release = await lockTarget(parent, name);
      try {
        if (await present(op.source)) {
          op.destination ??= join(store.root, 'quarantine', new Date().toISOString().replace(/[:.]/g, '-'), name);
          await writeJsonPrivate(journal, op);
          quarantined = await moveToQuarantine(op.source, join(store.root, 'quarantine'), name, op.destination);
        } else quarantined = op.destination;
      } finally { await release(); }
      if (quarantined) notices.push(`Moved ${source} to ${quarantined}. Undo by moving it back before prune.`);
    } else {
      const dest = destination!;
      if (await present(op.source) && op.source !== dest) {
        if (await present(dest) && !(args.kind === 'rename' && await sameFolder(op.source, dest))) {
          const same = (await snapshotSkillDirectory(dest)).fingerprint === op.fingerprint;
          if (args.kind === 'rename') throw new Error(`${dest} already exists; choose another name.`);
          if (!same || op.destinationExisted) {
            const kept = join(dirname(targetRoot.root), 'old-skills', name);
            if (await present(kept)) throw new Error(`${kept} already exists; move the kept copy elsewhere before retrying.`);
            await mkdir(dirname(kept), { recursive: true });
            op.kept = kept;
            await writeJsonPrivate(journal, op);
            await moveDirectory(dest, kept);
            op.destinationExisted = false;
            await writeJsonPrivate(journal, op);
            if (targetRoot.repoRoot) await appendExclude(targetRoot.repoRoot, '.claude/old-skills/', runner);
          }
        }
        await mkdir(dirname(dest), { recursive: true });
        if (args.kind === 'rename') await rename(op.source, dest);
        // D18 for copy: the source stays where it is, so the bytes go through `place` — the same
        // staged copy-then-rename `install` uses, which never exposes a partial folder at the
        // destination. A journaled re-run finds its own finished copy already there and does nothing.
        else if (args.kind === 'copy') {
          if (!(await present(dest))) {
            // No `projectRoot`: `.git/info/exclude` is for folders Terum placed from the team, and a
            // copy of the user's own skill is theirs to commit or not — `move` leaves it alone too.
            const copied = await place(op.source, targetRoot.root, name, { quarantineRoot: join(store.root, 'quarantine') });
            notices.push(...copied.notices);
          }
        }
        else await moveDirectory(op.source, dest);
      }
      if (!(await present(dest))) throw new Error(`${dest} is missing; the operation could not be recovered.`);
      if (args.kind === 'rename') await rewriteName(dest);
      // A copy adds a folder and takes nothing away: the source keeps its ledger row, and the new
      // folder gets none. It is a plain Library folder the user now owns in a second root — the same
      // shape a hand-written skill has. Its `metadata.id` is the source's, so `ls` and the app still
      // join the two to one skill and `sync` sees a known id (a no-op), not a second skill to share.
      if (args.kind !== 'copy') await store.update(c => {
        if (op!.placement) c.placements[dest] = op!.placement;
        delete c.placements[source];
        if (op!.ledgerPath && op!.ledgerPath !== dest) delete c.placements[op!.ledgerPath];
        if (op!.source !== dest) delete c.placements[op!.source];
      });
      if (targetRoot.repoRoot && op.kept) await appendExclude(targetRoot.repoRoot, '.claude/old-skills/', runner);
      if (op.kept) notices.push(`Your previous copy is kept at ${op.kept}.`);
      notices.push(`${args.kind === 'rename' ? 'Renamed' : args.kind === 'copy' ? 'Copied' : 'Moved'} ${source} to ${dest}.`);
    }
    const result: SkillResult = { kind: args.kind, path: source, destination: args.kind === 'delete' ? op.destination : destination, quarantined, installed: op.placement !== undefined, notices };
    op.done = true; op.result = result;
    await writeJsonPrivate(journal, op);
    for (const line of notices) io.print(line);
    return success(result);
  } catch (error) { return fromError(error); }
  finally { for (const release of releases.reverse()) await release(); }
}
