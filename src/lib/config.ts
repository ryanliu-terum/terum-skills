import { open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { mkdirPrivate } from './fs.js';
import { Config, configSchema, emptyConfig, parseJson, parseOrExplain, teamNameSchema } from './schema.js';

/** §5.4 `~/.terum/skills/config.json` — never committed, safe to delete, mode 0600 (it names your teams, identity, and every placed path). */
export interface ConfigStore {
  readonly root: string;
  read(): Promise<Config>;
  /** Read-modify-write under a lock, written atomically. The only way to change the file. */
  update(mutate: (config: Config) => void | Promise<void>): Promise<Config>;
  /** Create the private root (0700) before anything else writes under it. */
  ensureRoot(): Promise<void>;
  teamClone(team: string): string;
}

/** Resolve the configured team in one place so verbs cannot drift on ambiguity handling. */
export function selectTeam<T extends { remote: string }>(teams: Record<string, T>, requested?: string): [string, T] {
  if (requested) { const value = teams[requested]; if (!value) throw new Error(`Team ${requested} is not configured.`); return [requested, value]; }
  const entries = Object.entries(teams);
  if (entries.length === 1) return entries[0]!;
  if (entries.length === 0) throw new Error('No team is configured. Run `team join` first.');
  throw new Error(`More than one team is configured; pass --team <name> (${entries.map(([name]) => name).join(', ')}).`);
}

export function createConfigStore(root = join(homedir(), '.terum', 'skills')): ConfigStore {
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
  return {
    root,
    read,
    ensureRoot,
    async update(mutate) {
      await ensureRoot();
      // The default handler throws from a timer and crashes the CLI. Instead the compromise is
      // recorded, and the write below is skipped: a snapshot read before another process took the
      // lock must not be renamed over that process's write.
      let compromised = false;
      const release = await lockfile.lock(path, {
        lockfilePath: `${path}.lock`,
        realpath: false,
        stale: 30_000,
        retries: { retries: 20, minTimeout: 25, maxTimeout: 250 },
        onCompromised: () => { compromised = true; },
      });
      try {
        const config = await read();
        await mutate(config);
        if (compromised) throw new Error(`Lost the lock on ${path} to another process; nothing was written — retry the command.`);
        await writeAtomically(path, `${JSON.stringify(config, null, 2)}\n`);
        return config;
      } finally {
        // A compromised lock rejects on release ('Lock is already released'); that must never replace the real outcome.
        await release().catch(() => undefined);
      }
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
