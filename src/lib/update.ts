import { randomUUID } from 'node:crypto';
import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { RELEASE_PROBE_POLICY } from './constants.js';
import { mkdirPrivate } from './fs.js';
import type { Launch } from './launch.js';
import { APPROVED_UPSTREAM, PACKAGE_NAME, packageMetadata } from './package.js';
import { isGitHubRemote, stripRemoteCredentials } from './remote.js';
import type { Runner } from './runner.js';
import type { Config } from './schema.js';

export type ProbePolicy = 'github-teams' | 'everyone' | 'nobody';
const DAY = 24 * 60 * 60_000;
const stamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const observation = { version: z.string(), at: stamp };
const stateSchema = z.object({
  schema: z.literal(1), package: z.literal(PACKAGE_NAME), upstream: z.string(),
  running: z.object({ ...observation, entry: z.string() }).nullable(),
  registry: z.object({ ...observation, source: z.literal('npx-latest-cache'), entry: z.string() }).nullable(),
  advertisement: z.object({ ...observation, source: z.literal('git-tags') }).nullable(),
  attempt: z.object({ at: stamp, ok: z.boolean(), error: z.string().nullable() }).nullable(),
  ack: z.object(observation).nullable(),
});
export type ReleaseState = z.infer<typeof stateSchema>;
export interface ReleaseStateStore {
  readonly upstream: string;
  read(): Promise<ReleaseState | null>;
  update(mutate: (state: ReleaseState) => void | Promise<void>): Promise<boolean>;
}
const emptyState = (upstream: string): ReleaseState => ({ schema: 1, package: PACKAGE_NAME, upstream, running: null, registry: null, advertisement: null, attempt: null, ack: null });

/** Unknown/corrupt state is absent to readers but never overwritten. The user may delete it. */
export function createReleaseState(root: string, upstream = APPROVED_UPSTREAM): ReleaseStateStore {
  const path = join(root, 'run', 'latest-version.json');
  async function load(): Promise<{ state: ReleaseState | null; writable: boolean }> {
    try {
      const parsed = stateSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (!parsed.success || parsed.data.upstream !== upstream || packageMetadata().name !== PACKAGE_NAME) return { state: null, writable: false };
      return { state: parsed.data, writable: true };
    } catch (error) { return { state: null, writable: (error as NodeJS.ErrnoException).code === 'ENOENT' }; }
  }
  return {
    upstream,
    async read() { return (await load()).state; },
    async update(mutate) {
      await mkdirPrivate(root); await mkdirPrivate(join(root, 'run'));
      let compromised = false;
      let release: () => Promise<void>;
      try { release = await lockfile.lock(path, { realpath: false, stale: 5000, retries: 0, onCompromised: () => { compromised = true; } }); }
      catch { return false; }
      let temporary: string | undefined;
      try {
        // Deliberately read only after acquiring the lock, including acknowledgment merges.
        const current = await load(); if (!current.writable) return false;
        const state = current.state ?? emptyState(upstream); const before = JSON.stringify(state);
        await mutate(state);
        if (JSON.stringify(state) === before) return true;
        if (compromised) return false;
        temporary = `${path}.${randomUUID()}.tmp`;
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        if (compromised) return false;
        await rename(temporary, path); temporary = undefined;
        return true;
      } finally {
        if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
        await release().catch(() => undefined);
      }
    },
  };
}

/** Stable-channel comparison without a dependency or numeric precision loss. */
function compare(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b || !/^\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+$/.test(b)) return null;
  const left = a.split('.').map(BigInt); const right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) { if (left[i]! > right[i]!) return 1; if (left[i]! < right[i]!) return -1; }
  return 0;
}
function validStamp(at: string, now: number): boolean { const time = Date.parse(at); return Number.isFinite(time) && time <= now + 60_000; }
function fresh(at: string | undefined, now: number): boolean { return at !== undefined && validStamp(at, now) && now - Date.parse(at) < DAY; }

/** A configured GitHub team authorizes the approved public upstream, not arbitrary destinations. */
export function probePolicy(config: Pick<Config, 'teams'>, policy: ProbePolicy = RELEASE_PROBE_POLICY): ProbePolicy {
  if (policy === 'everyone' || policy === 'nobody') return policy;
  return Object.values(config.teams).some((team) => isGitHubRemote(team.remote)) ? 'github-teams' : 'nobody';
}

export interface ObservationArgs { state: ReleaseStateStore; launch?: Launch; running: string | null; now?: () => number; }
export async function recordRunningAndRegistry(args: ObservationArgs): Promise<void> {
  const at = new Date((args.now ?? Date.now)()).toISOString();
  const launch = args.launch;
  let registry: ReleaseState['registry'] = null;
  if (launch?.kind === 'npx' && launch.request === `${PACKAGE_NAME}@latest`) {
    try {
      const entry = launch.path.replace(/[\\/]dist[\\/]index\.js$/, '');
      const path = join(entry, 'package.json');
      const cache: unknown = JSON.parse(await readFile(join(launch.cacheDir, 'package.json'), 'utf8'));
      const request = z.object({ _npx: z.object({ packages: z.tuple([z.literal(`${PACKAGE_NAME}@latest`)]) }) }).safeParse(cache);
      const manifest: unknown = JSON.parse(await readFile(path, 'utf8'));
      const details = await stat(path);
      if (request.success && manifest && typeof manifest === 'object' && 'name' in manifest && manifest.name === PACKAGE_NAME && 'version' in manifest && typeof manifest.version === 'string' && compare(manifest.version, manifest.version) === 0) {
        registry = { version: manifest.version, at: details.mtime.toISOString(), source: 'npx-latest-cache', entry };
      }
    } catch { /* Cache evidence is optional; do not erase another cache's observation on missing I/O. */ }
  }
  await args.state.update((state) => {
    const entry = launch?.path ?? '';
    if (args.running && (state.running?.version !== args.running || state.running.entry !== entry)) state.running = { version: args.running, at, entry };
    if (registry && JSON.stringify(state.registry) !== JSON.stringify(registry)) state.registry = registry;
  });
}

export type ProbeResult = { ok: true; version: string | null; prereleases: boolean } | { ok: false; error: string };
function sanitizedReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const first = stripVTControlCharacters(text).split(/[\r\n]/, 1)[0] ?? '';
  const cleaned = Array.from(first).filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('');
  return stripRemoteCredentials(cleaned).slice(0, 500) || 'git ls-remote failed';
}
export async function probeAdvertisement(runner: Runner, upstream: string, options: { deadlineMs: number }): Promise<ProbeResult> {
  try {
    const result = await runner.run('git', ['-c', `url.${upstream}.insteadOf=${upstream}`, 'ls-remote', '--tags', '--', upstream], { deadlineMs: options.deadlineMs, maxOutputBytes: 65536 });
    if (result.code !== 0) return { ok: false, error: sanitizedReason(result.stderr) };
    let version: string | null = null; let prereleases = false;
    for (const line of result.stdout.split('\n')) {
      const match = /^[0-9a-f]{40}\trefs\/tags\/v(\d+\.\d+\.\d+)$/.exec(line);
      if (match && (version === null || compare(match[1]!, version) === 1)) version = match[1]!;
      if (/^[0-9a-f]{40}\trefs\/tags\/v\d+\.\d+\.\d+-[^\s^]+$/.test(line)) prereleases = true;
    }
    return { ok: true, version, prereleases };
  } catch (error) { return { ok: false, error: sanitizedReason(error) }; }
}

export interface MaintenanceArgs extends ObservationArgs { runner: Runner; upstream?: string; probe: ProbePolicy; force?: boolean; }
export async function maintainReleaseState(args: MaintenanceArgs): Promise<ProbeResult | null> {
  await recordRunningAndRegistry(args).catch(() => undefined);
  const upstream = args.upstream ?? APPROVED_UPSTREAM;
  if (upstream !== args.state.upstream) return { ok: false, error: 'Release upstream does not match the state namespace.' };
  if (args.probe === 'nobody' || !packageMetadata().upstreamApproved) return null;
  const now = (args.now ?? Date.now)();
  const state = await args.state.read();
  if (!args.force && fresh(state?.attempt?.at, now)) return null;
  const result = await probeAdvertisement(args.runner, upstream, { deadlineMs: 10000 });
  const at = new Date((args.now ?? Date.now)()).toISOString();
  await args.state.update((current) => {
    current.attempt = { at, ok: result.ok, error: result.ok ? null : result.error };
    if (result.ok) current.advertisement = result.version ? { version: result.version, at, source: 'git-tags' } : null;
  }).catch(() => undefined);
  return result;
}

export interface ReleaseCandidate { version: string; at: string; source: 'git-tags' | 'npx-latest-cache'; }
/** All human surfaces share this source selection. Running observations never advertise a release. */
export function describeUpdate(state: ReleaseState | null, running: string | null, now = Date.now()) {
  const advertisement = state?.advertisement && validStamp(state.advertisement.at, now) && compare(state.advertisement.version, state.advertisement.version) === 0 ? state.advertisement : null;
  const registry = state?.registry && validStamp(state.registry.at, now) && compare(state.registry.version, state.registry.version) === 0 ? state.registry : null;
  const highest = registry && (!advertisement || compare(registry.version, advertisement.version) === 1) ? registry : advertisement;
  const candidate: ReleaseCandidate | null = highest && compare(highest.version, running) === 1 ? highest : null;
  return { advertisement, registry, candidate, registryNewer: Boolean(registry && (!advertisement || compare(registry.version, advertisement.version) === 1)), matches: Boolean(advertisement && compare(advertisement.version, running) === 0) };
}
export function noticeLine(candidate: ReleaseCandidate, running: string, launch?: Launch): string {
  const prefix = `Newer terum-skills release ${candidate.source === 'git-tags' ? 'advertised' : 'observed'}: ${candidate.version} (running ${running}). `;
  if (launch?.kind === 'local') return `${prefix}If installed locally with npm, run npm install ${launch.dependencyKind === 'devDependencies' ? '--save-dev ' : ''}terum-skills@latest in ${launch.root}.`;
  if (launch?.kind === 'global') return `${prefix}If installed globally with npm, run npm install -g terum-skills@latest.`;
  return `${prefix}This copy: ${launch?.path ?? 'unknown'}. Run the latest release with npx -y terum-skills@latest <command>.`;
}
export async function updateNotice(args: ObservationArgs & { stderr(line: string): void }): Promise<void> {
  try {
    const state = await args.state.read(); const now = (args.now ?? Date.now)();
    const candidate = describeUpdate(state, args.running, now).candidate;
    if (!candidate || !args.running || (state?.ack?.version === candidate.version && fresh(state.ack.at, now))) return;
    args.stderr(noticeLine(candidate, args.running, args.launch));
    await args.state.update((current) => { current.ack = { version: candidate.version, at: new Date(now).toISOString() }; }).catch(() => undefined);
  } catch { /* A failed notice must never affect the command's result or exit code. */ }
}
