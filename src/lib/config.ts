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
  update(mutate: (config: Config) => void | Promise<void>): Promise<Config>;
  remove(guard: (config: Config) => boolean): Promise<'removed' | 'kept' | 'absent'>;
  /** Create the private root (0700) before anything else writes under it. */
  ensureRoot(): Promise<void>;
  teamClone(team: string): string;
}

/** Resolve the configured team in one place so verbs cannot drift on ambiguity handling. */
export function selectTeam<T extends { remote: string }>(teams: Record<string, T>, requested?: string): [string, T] {
  // An own key only: the record inherits Object.prototype, and `constructor` is a legal team name.
  if (requested) { if (!Object.hasOwn(teams, requested)) throw new Error(`Team ${requested} is not configured.`); return [requested, teams[requested]!]; }
  const entries = Object.entries(teams);
  if (entries.length === 1) return entries[0]!;
  if (entries.length === 0) throw new Error('No team is configured. Run `team join` first.');
  throw new Error(`More than one team is configured; pass --team <name> (${entries.map(([name]) => name).join(', ')}).`);
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
    async update(mutate) {
      await ensureRoot();
      return underLock(async (assertHeld) => {
        const config = await read();
        await mutate(config);
        assertHeld();
        await writeAtomically(path, `${JSON.stringify(config, null, 2)}\n`);
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
