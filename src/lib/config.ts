import { open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { mkdirPrivate } from './fs.js';
import { Config, configSchema, emptyConfig, parseJson, parseOrExplain, teamNameSchema } from './schema.js';

/** §5.4 `~/.terum/skills/config.json` — never committed, safe to delete, mode 0600 (it holds tokens). */
export interface ConfigStore {
  readonly root: string;
  read(): Promise<Config>;
  /** Read-modify-write under a lock, written atomically. The only way to change the file. */
  update(mutate: (config: Config) => void | Promise<void>): Promise<Config>;
  /** Create the private root (0700) before anything else writes under it. */
  ensureRoot(): Promise<void>;
  teamClone(team: string): string;
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
      const release = await lockfile.lock(path, {
        lockfilePath: `${path}.lock`,
        realpath: false,
        stale: 30_000,
        retries: { retries: 20, minTimeout: 25, maxTimeout: 250 },
        // The default handler throws from a timer and crashes the CLI; the write below is short
        // and atomic, so a compromised lock cannot corrupt the file, only reorder two writers.
        onCompromised: () => undefined,
      });
      try {
        const config = await read();
        await mutate(config);
        await writeAtomically(path, `${JSON.stringify(config, null, 2)}\n`);
        return config;
      } finally {
        await release();
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
