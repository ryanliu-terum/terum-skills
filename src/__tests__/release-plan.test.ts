import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { temporaryDirectory } from '../lib/__tests__/fixtures.js';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = resolve(root, 'scripts/release-plan.mjs');
const SHA = '6f8a1d9ba29b482c32cc7c215dfb0478fc55c800';
const OTHER = '1111111111111111111111111111111111111111';
const LEGACY_SHA = 'dc891285a42d4b7794fe795e1d4effc75951490b';
const INTEGRITY = 'sha512-retained-artifact';

interface Publication {
  integrity: string;
  gitHead?: string;
  attestations?: boolean;
  sourceCommit?: string;
}
interface Observations {
  package: { name: string; version: string };
  tags: { name: string; commit: string }[];
  releases: { tag: string }[] | { error: string };
  registry: { versions: Record<string, Publication>; distTags: { latest?: string; next?: string } } | { error: string };
}
interface Result { code: number | string; stdout: string; stderr: string }

function world(version = '0.1.1', published = false, tagged = false, released = false): Observations {
  return {
    package: { name: 'terum-skills', version },
    tags: [{ name: 'v0.1.0', commit: LEGACY_SHA }, ...(tagged ? [{ name: `v${version}`, commit: SHA }] : [])],
    releases: [{ tag: 'v0.1.0' }, ...(released ? [{ tag: `v${version}` }] : [])],
    registry: {
      versions: { '0.1.0': { integrity: 'sha512-legacy' }, ...(published ? { [version]: { integrity: INTEGRITY, attestations: true } } : {}) },
      distTags: { latest: published && !version.includes('-') ? version : '0.1.0', ...(published && version.includes('-') ? { next: version } : {}) },
    },
  };
}

async function invoke(obs: Observations | Observations[], args: string[], live = false): Promise<Result> {
  const cwd = await temporaryDirectory('terum-release-plan-');
  const emptyPath = resolve(cwd, 'empty-path');
  const home = resolve(cwd, 'home');
  await mkdir(emptyPath);
  await mkdir(home);
  const env = { PATH: emptyPath + delimiter + dirname(process.execPath), HOME: home, RELEASE_PLAN_FAST: '1', NODE_NO_WARNINGS: '1' };
  const observations = resolve(cwd, 'observations.json');
  await writeFile(observations, JSON.stringify(obs));
  // Live mode must get past reading package.json to prove that git cannot be spawned.
  await writeFile(resolve(cwd, 'package.json'), JSON.stringify({ name: 'terum-skills', version: '0.1.1' }));
  return run(process.execPath, [script, ...args, ...(live ? [] : ['--observations', observations])], { env, cwd }).then(
    (result) => ({ ...result, code: 0 }),
    (error: { code?: number | string; stdout: string; stderr: string }) => ({ code: error.code ?? 1, stdout: error.stdout, stderr: error.stderr }),
  );
}

async function planned(obs: Observations, state: string, reason: string, version = obs.package.version, sha = SHA): Promise<string> {
  const result = await invoke(obs, ['--plan', '--version', version, '--sha', sha, '--github-output']);
  expect(result.stderr).toBe('');
  expect(result.code).toBe(state === 'refuse' || state === 'observation-error' ? 1 : 0);
  expect(result.stdout.split('\n')).toContain(`state=${state}`);
  expect(result.stdout.split('\n').find((line) => line.startsWith('reason='))).toContain(reason);
  return result.stdout;
}

async function audited(obs: Observations, code: number, verdict: string): Promise<string> {
  const result = await invoke(obs, ['--drift']);
  expect(result.stderr).toBe('');
  expect(result.code).toBe(code);
  expect(result.stdout).toContain(verdict);
  expect(result.stdout).toContain(code === 0 ? 'release state consistent\n' : 'drift state(s)\n');
  return result.stdout;
}

describe('release-plan CLI (R.5, hermetic observations)', () => {
  it('1: plans a fresh stable release with the previous tag', async () => {
    const output = await planned(world(), 'publish', 'is new: publish, verify, tag, release');
    for (const line of ['recovery=false', 'dist_tag=latest', 'previous_tag=v0.1.0', 'mark_latest=true']) expect(output.split('\n')).toContain(line);
  });

  it('2: recovers a publication with attestation but no tag', async () => {
    await planned(world('0.1.1', true), 'tag-only', `v0.1.1 is missing; tag ${SHA}`);
  });
  it('3: recovers a missing GitHub Release', async () => {
    await planned(world('0.1.1', true, true), 'release-only', 'GitHub Release missing');
  });
  it('4: no-ops when publication, tag and Release agree', async () => {
    await planned(world('0.1.1', true, true, true), 'noop', 'nothing to do');
  });
  it('5: retries the original tagged-but-unpublished candidate', async () => {
    expect(await planned(world('0.1.1', false, true), 'publish', 'false advertisement')).toContain('recovery=true\n');
  });
  it('6: refuses an existing tag at another commit, including later main', async () => {
    const output = await planned(world('0.1.1', true, true), 'refuse', `already points at ${SHA}, not ${OTHER}`, '0.1.1', OTHER);
    expect(output).toContain('Bump the version for a new release');
  });
  it.each(['gitHead', 'sourceCommit'] as const)('7: refuses conflicting registry %s', async (field) => {
    const obs = world();
    obs.registry = { versions: { '0.1.1': { integrity: INTEGRITY, attestations: true, [field]: OTHER } }, distTags: {} };
    await planned(obs, 'refuse', `on npm from ${OTHER}, not ${SHA}`);
  });
  it('8: refuses non-legacy publication without source evidence', async () => {
    const obs = world();
    obs.registry = { versions: { '0.1.1': { integrity: INTEGRITY } }, distTags: {} };
    await planned(obs, 'refuse', 'incident decision');
  });
  it('9: allows legacy tag-only and release-only recovery at its pinned commit', async () => {
    const obs = world('0.1.0');
    obs.tags = [];
    obs.releases = [];
    await planned(obs, 'tag-only', `tag ${LEGACY_SHA}`, '0.1.0', LEGACY_SHA);
    obs.tags = [{ name: 'v0.1.0', commit: LEGACY_SHA }];
    await planned(obs, 'release-only', 'GitHub Release missing', '0.1.0', LEGACY_SHA);
  });
  it('9: refuses a different dispatch commit when the pinned legacy tag exists', async () => {
    await planned(world('0.1.0'), 'refuse', `already points at ${LEGACY_SHA}, not ${OTHER}`, '0.1.0', OTHER);
  });
  it('10: refuses a package version different from the dispatch', async () => {
    await planned(world(), 'refuse', 'says 0.1.1, dispatch says 0.1.2', '0.1.2');
  });
  it('10: refuses a different package name', async () => {
    const obs = world();
    obs.package.name = 'other-package';
    await planned(obs, 'refuse', 'names other-package, not terum-skills');
  });
  it.each(['1.2', 'v1.2.3', '1.2.3.4'])('10: rejects %s before evaluating observation errors', async (version) => {
    const obs = world(version);
    obs.registry = { error: 'must not take precedence over input validation' };
    await planned(obs, 'refuse', 'not strict SemVer');
  });
  it('10: rejects a 39-hex SHA before evaluating observation errors', async () => {
    const obs = world();
    obs.registry = { error: 'must not take precedence over input validation' };
    await planned(obs, 'refuse', 'not a full 40-hex commit', '0.1.1', SHA.slice(1));
  });
  it('11: prereleases use next and cannot be Latest', async () => {
    const output = await planned(world('0.2.0-rc.1'), 'publish', 'is new');
    for (const line of ['prerelease=true', 'dist_tag=next', 'mark_latest=false']) expect(output.split('\n')).toContain(line);
  });
  it('11: compares prerelease numeric identifiers numerically', async () => {
    const obs = world('0.2.0-rc.10', true, true, true);
    obs.tags.push({ name: 'v0.2.0-rc.9', commit: OTHER });
    obs.releases = [{ tag: 'v0.1.0' }, { tag: 'v0.2.0-rc.9' }, { tag: 'v0.2.0-rc.10' }];
    obs.registry = { versions: { '0.1.0': { integrity: 'legacy' }, '0.2.0-rc.9': { integrity: 'older', gitHead: OTHER }, '0.2.0-rc.10': { integrity: INTEGRITY, attestations: true } }, distTags: { latest: '0.1.0', next: '0.2.0-rc.10' } };
    await audited(obs, 0, 'release state consistent');
  });
  it('11: compares minor versions numerically', async () => {
    const obs = world('0.10.0');
    obs.tags.push({ name: 'v0.9.0', commit: OTHER });
    expect(await planned(obs, 'publish', 'is new')).toContain('previous_tag=v0.9.0\n');
  });
  it('12: does not mark a stable backfill Latest', async () => {
    const obs = world();
    obs.registry = { versions: { '0.2.0': { integrity: 'newer', attestations: true } }, distTags: { latest: '0.2.0' } };
    expect(await planned(obs, 'publish', 'is new')).toContain('mark_latest=false\n');
  });
  it.each(['registry', 'releases'] as const)('13: %s unavailable is an observation error, never publish', async (field) => {
    const obs = world();
    obs[field] = { error: 'transport timeout' };
    expect(await planned(obs, 'observation-error', `${field}: transport timeout`)).not.toContain('state=publish\n');
  });

  it.each([
    { label: 'matching digest and attestation', pub: { integrity: INTEGRITY, attestations: true }, code: 0, reason: `served: integrity ${INTEGRITY}` },
    { label: 'missing attestation after all polls', pub: { integrity: INTEGRITY }, code: 1, reason: 'without a provenance attestation' },
    { label: 'conflicting source', pub: { integrity: INTEGRITY, attestations: true, gitHead: OTHER }, code: 1, reason: `source ${OTHER} != ${SHA}` },
  ])('14: verifies $label', async ({ pub, code, reason }) => {
    const obs = world();
    obs.registry = { versions: { '0.1.1': pub }, distTags: {} };
    const result = await invoke(obs, ['--verify-publication', '--version', '0.1.1', '--sha', SHA, '--integrity', INTEGRITY]);
    expect(result.code).toBe(code);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`${code === 0 ? 'verified' : 'unverified'}: `);
    expect(result.stdout).toContain(reason);
  });
  it('14: integrity mismatch fails immediately even if the next observation would succeed', async () => {
    const bad = world();
    bad.registry = { versions: { '0.1.1': { integrity: 'wrong', attestations: true } }, distTags: {} };
    const result = await invoke([bad, world('0.1.1', true)], ['--verify-publication', '--version', '0.1.1', '--sha', SHA, '--integrity', INTEGRITY]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`unverified: integrity wrong != packed ${INTEGRITY}\n`);
  });
  it('14: retries an observation error and succeeds on the second poll', async () => {
    const unavailable = world();
    unavailable.registry = { error: 'first-poll timeout' };
    const result = await invoke([unavailable, world('0.1.1', true)], ['--verify-publication', '--version', '0.1.1', '--sha', SHA, '--integrity', INTEGRITY]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`verified: 0.1.1 served: integrity ${INTEGRITY}, provenance true, gitHead absent\n`);
  });
  it('14: repeats the last sequenced observation until polls are exhausted', async () => {
    const unavailable = world();
    unavailable.registry = { error: 'persistent timeout' };
    const result = await invoke([unavailable], ['--verify-publication', '--version', '0.1.1', '--sha', SHA]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('unverified: observation-error persistent timeout\n');
  });

  it('15: reports tagged-unpublished', async () => {
    await audited(world('0.1.1', false, true), 1, `FAIL tagged-unpublished v0.1.1 -> ${SHA}`);
  });
  it('15: reports published-untagged', async () => {
    await audited(world('0.1.1', true), 1, 'FAIL published-untagged 0.1.1');
  });
  it.each(['gitHead', 'sourceCommit'] as const)('15: reports source-mismatch from %s', async (field) => {
    const obs = world('0.1.1', true, true, true);
    obs.registry = { versions: { '0.1.0': { integrity: 'legacy' }, '0.1.1': { integrity: INTEGRITY, attestations: true, [field]: OTHER } }, distTags: { latest: '0.1.1' } };
    await audited(obs, 1, `FAIL source-mismatch v0.1.1: npm says ${OTHER}, tag says ${SHA}`);
  });
  it('15: reports source-unverified for non-legacy', async () => {
    const obs = world('0.1.1', true, true, true);
    obs.registry = { versions: { '0.1.0': { integrity: 'legacy' }, '0.1.1': { integrity: INTEGRITY } }, distTags: { latest: '0.1.1' } };
    await audited(obs, 1, 'FAIL source-unverified v0.1.1');
  });
  it('15: reports release-missing', async () => {
    await audited(world('0.1.1', true, true), 1, 'FAIL release-missing v0.1.1');
  });
  it('15: reports latest rolled back behind the highest stable tag', async () => {
    const obs = world('0.1.1', true, true, true);
    obs.registry = { versions: { '0.1.0': { integrity: 'legacy' }, '0.1.1': { integrity: INTEGRITY, attestations: true } }, distTags: { latest: '0.1.0' } };
    await audited(obs, 1, 'FAIL channel-mismatch highest stable tag v0.1.1 vs dist-tag latest 0.1.0');
  });
  it('15: reports next ahead of prerelease tags', async () => {
    const obs = world('0.2.0-rc.1', true, true, true);
    obs.registry = { versions: { '0.1.0': { integrity: 'legacy' }, '0.2.0-rc.1': { integrity: INTEGRITY, attestations: true } }, distTags: { latest: '0.1.0', next: '0.2.0-rc.2' } };
    await audited(obs, 1, 'FAIL channel-mismatch highest prerelease tag v0.2.0-rc.1 vs dist-tag next 0.2.0-rc.2');
  });
  it.each(['v1.2', 'vfoo'])('15: reports malformed-ref %s', async (name) => {
    const obs = world();
    obs.tags.push({ name, commit: SHA });
    await audited(obs, 1, `FAIL malformed-ref ${name}`);
  });
  it('15: legacy source is informational and unreleased main is pending', async () => {
    const output = await audited(world(), 0, 'info source-unverified-legacy v0.1.0');
    expect(output).toContain('info pending main package.json 0.1.1 is not released yet');
    expect(output).not.toContain('FAIL');
  });
  it('15: a legacy tag at any other commit is a source mismatch', async () => {
    const obs = world('0.1.0');
    obs.tags = [{ name: 'v0.1.0', commit: OTHER }];
    await audited(obs, 1, `FAIL source-mismatch v0.1.0: legacy record expects ${LEGACY_SHA}`);
  });
  it('15: reports a consistent released world', async () => {
    await audited(world('0.1.1', true, true, true), 0, 'release state consistent');
  });
  it.each(['registry', 'releases'] as const)('15: %s observation errors exit 2', async (field) => {
    const obs = world();
    obs[field] = { error: 'API unavailable' };
    await audited(obs, 2, `FAIL observation-error ${field}: API unavailable`);
  });

  it('16: injected tag and registry errors stay printable and cannot start workflow directives', async () => {
    const tags = world();
    tags.tags.push({ name: 'v0.1.1\n::error::x', commit: SHA });
    const output = await audited(tags, 1, 'FAIL malformed-ref v0.1.1 ::error::x');
    const errors = world();
    errors.registry = { error: 'timeout\n::error::x\u001b[31m' };
    const driftOutput = await audited(errors, 2, 'FAIL observation-error registry: timeout ::error::x [31m');
    const planOutput = await planned(errors, 'observation-error', 'registry: timeout ::error::x [31m');
    for (const text of [output, driftOutput, planOutput]) {
      for (const line of text.trimEnd().split('\n')) {
        expect(line).toMatch(/^[\x20-\x7e]*$/);
        expect(line).not.toMatch(/^::/);
        expect(line.length).toBeLessThanOrEqual(500);
      }
    }
  });
  // R.5 case 17 is the orchestrator's manual guard-removal proof, not an automated case.
  it('18: removing --observations fails closed because live git cannot be spawned', async () => {
    const result = await invoke(world(), ['--plan', '--version', '0.1.1', '--sha', SHA], true);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/spawn(?:Sync)? git ENOENT/);
  });
});
