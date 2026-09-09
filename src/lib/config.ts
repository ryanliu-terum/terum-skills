import { invocation, getStartedLines, type InvocationForm } from './invocation.js';
import { access, open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { mkdirPrivate } from './fs.js';
import { Config, configSchema, emptyConfig, parseJson, parseOrExplain, teamNameSchema } from './schema.js';

/** §5.4 `~/.terum/skills/config.json` — never committed, mode 0600 (it names your teams, identity, and every placed path); deleted only through `remove`, by `uninstall`. */
export interface ConfigStore {
  readonly root: string;
  read(): Promise<Config>;
  /** Read-modify-write under a lock, written atomically. The only way to change the file; `remove` is the only way to delete it. */
  update(mutate: (config: Config) => void | Promise<void>, options?: { preserveUnchanged: boolean }): Promise<Config>;
  remove(guard: (config: Config) => boolean): Promise<'removed' | 'kept' | 'absent'>;
  /** Create the private root (0700) before anything else writes under it. */
  ensureRoot(): Promise<void>;
  teamClone(team: string): string;
}

/** Resolve the configured team in one place so verbs cannot drift on ambiguity handling. */
export function selectTeam<T extends { remote: string }>(teams: Record<string, T>, requested?: string, form?: InvocationForm): [string, T] {
  // An own key only: the record inherits Object.prototype, and `constructor` is a legal team name.
  if (requested) { if (!Object.hasOwn(teams, requested)) throw new Error(`Team ${requested} is not configured.`); return [requested, teams[requested]!]; }
  const entries = Object.entries(teams);
  if (entries.length === 1) return entries[0]!;
  if (entries.length === 0) throw new Error(getStartedLines(form).join('\n'));
  throw new Error(`This machine is configured for teams ${entries.map(([name]) => name).join(', ')}; Terum Skills keeps one team per machine. Run \`${invocation(form, 'team leave', { raw: '<name>' })}\` for each you no longer want; until then name one with --team.`);
}

export interface ConfigStoreOptions {
  /** Test knob: the lock's stale window in ms (proper-lockfile floors it at 2000 and checks the lock every half window). */
  lockStale?: number;
}

export function createConfigStore(root = join(homedir(), '.terum', 'skills'), options: ConfigStoreOptions = {}): ConfigStore {
  const path = join(root, 'config.json');
  const read = async (): Promise<Config> => {
    try { return parseJson(configSchema, await readFile(path, 'utf8'), path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig();
      throw error;
    }
  };
  const ensureRoot = async (): Promise<void> => {
    await mkdirPrivate(root);
    await mkdirPrivate(join(root, 'teams'));
  };
  // Both mutation and deletion use one lock policy and abort before touching the file if compromised.
  async function underLock<T>(action: (assertHeld: () => void) => Promise<T>): Promise<T> {
    let compromised = false;
    const release = await lockfile.lock(path, {
      lockfilePath: `${path}.lock`,
      realpath: false,
      stale: options.lockStale ?? 30_000,
      retries: { retries: 20, minTimeout: 25, maxTimeout: 250 },
      onCompromised: () => { compromised = true; },
    });
    const assertHeld = (): void => {
      if (compromised) throw new Error(`Lost the lock on ${path} to another process; nothing was written — retry the command.`);
    };
    try { return await action(assertHeld); }
    finally { await release().catch(() => undefined); } // Never replace the outcome with a compromised-release error.
  }
  return {
    root,
    read,
    ensureRoot,
    async update(mutate, writeOptions) {
      await ensureRoot();
      return underLock(async (assertHeld) => {
        const config = await read();
        const before = structuredClone(config);
        let original: string | undefined;
        if (writeOptions?.preserveUnchanged) {
          try { original = await readFile(path, 'utf8'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        await mutate(config);
        assertHeld();
        await writeAtomically(path, original === undefined ? `${JSON.stringify(config, null, 2)}\n` : patchConfig(original, before, config));
        return config;
      });
    },
    async remove(guard) {
      try { await access(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'; throw error; }
      return underLock(async (assertHeld) => {
        const config = await read();
        if (!guard(config)) return 'kept';
        assertHeld();
        await rm(path, { force: true });
        return 'removed';
      });
    },
    teamClone(team) {
      return join(root, 'teams', parseOrExplain(teamNameSchema, team, 'team name'));
    },
  };
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Preserve the bytes of untouched top-level values, including hand formatting and unknown keys.
 * Input was already parsed by read(); this scan locates JSON value spans, it does not validate JSON.
 */
function patchConfig(source: string, before: Config, after: Config): string {
  const changes = new Map(Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(key => [key, JSON.stringify(after[key])]));
  for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) throw new Error('A preserving config update cannot delete fields.');
  const tokens = [...source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g)];
  const edits: { start: number; end: number; value: string }[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token[0] === '{' || token[0] === '[') depth++;
    else if (token[0] === '}' || token[0] === ']') depth--;
    else if (depth === 1 && token[0].startsWith('"') && tokens[i + 1]?.[0] === ':') {
      const key = JSON.parse(token[0]) as string;
      const value = changes.get(key);
      if (value === undefined) continue;
      const start = tokens[i + 2]!;
      let end = i + 2, nested = 0;
      do {
        const text = tokens[end]![0];
        if (text === '{' || text === '[') nested++;
        if (text === '}' || text === ']') nested--;
        if (nested > 0) end++;
      } while (nested > 0);
      edits.push({ start: start.index, end: tokens[end]!.index + tokens[end]![0].length, value });
    }
  }
  const existing = JSON.parse(source) as Record<string, unknown>;
  const added = [...changes].filter(([key]) => !Object.hasOwn(existing, key)).map(([key, value]) => `${JSON.stringify(key)}:${value}`);
  if (added.length) edits.push({ start: source.lastIndexOf('}'), end: source.lastIndexOf('}'), value: `${Object.keys(existing).length ? ',' : ''}${added.join(',')}` });
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}
