import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { TEMP_DIRS } from './fixtures.js';

// Ambient state the fixtures must never see or touch (vitest's `env` can set, not unset).
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_COMMON_DIR',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE',
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST']) delete process.env[name];
// A throwaway home per worker: the default ConfigStore root and gh's config dir both live under it.
const home = mkdtempSync(join(tmpdir(), 'terum-test-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.GH_CONFIG_DIR = join(home, '.config', 'gh');

// Every fixture directory is removed after the test that created it; one failure does not strand the rest.
afterEach(async () => {
  for (const dir of TEMP_DIRS.splice(0)) {
    try { await rm(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
