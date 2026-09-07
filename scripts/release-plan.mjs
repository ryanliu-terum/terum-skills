#!/usr/bin/env node
// scripts/release-plan.mjs — release state planner + drift auditor for .github/workflows/{release,release-drift}.yml.
// CI-only; not product code. The CLI never touches the registry (AGENTS.md:30); this runs on the git host's
// compute, which the build spec's North Star allows (§1 :14). No dependencies; Node >= 22.
//
//   --plan --version V --sha SHA [--dist-tag T] [--github-output]   one row of the recovery table (see investigation §R.3)
//     T is the npm dist-tag a publish would use (default latest; a stable version older than the newest published
//     stable is refused under latest — pass another tag to backfill; prereleases use next unless T overrides it)
//   --verify-publication --version V --sha SHA [--integrity I]   bounded poll until the registry serves V with I, gitHead SHA + provenance
//
// Source evidence: only a registry gitHead or sourceCommit equal to the dispatched commit proves where a published
// tarball came from. A provenance attestation is advisory: it proves a trusted workflow built the tarball, not which
// commit it built. The build job stamps gitHead into the packed manifest so every workflow publication carries it.
//   --drift                                              audit every tag/registry/Release pair; exit 1 on drift, 2 on observation error
//   --observations FILE                                  hermetic mode: read the world from JSON (tests); no git/npm/gh is spawned
//
// Observations: { package:{name,version}, tags:[{name,commit}], releases:[{tag}],
//                 registry:{ versions:{ "0.1.0":{ integrity, gitHead, attestations:boolean, sourceCommit } }, distTags:{latest,next} } | { error } }
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PACKAGE = 'terum-skills';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
const SHA40 = /^[0-9a-f]{40}$/;

// Narrow legacy record: one version, one tag, one commit. It never widens and never permits a publish.
export const LEGACY = Object.freeze({
  '0.1.0': Object.freeze({ tag: 'v0.1.0', commit: 'dc891285a42d4b7794fe795e1d4effc75951490b',
    reason: 'published by hand on 2026-09-06 before release.yml existed: registry has no gitHead and no provenance; exact source relationship unverified' }),
});

const sanitize = (s) => String(s).replace(/[^\x20-\x7e]/g, ' ').slice(0, 500);
const parse = (v) => { const m = SEMVER.exec(v); return m && { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : null }; };
export function compare(a, b) {
  const A = parse(a), B = parse(b);
  if (!A || !B) throw new Error(`not SemVer: ${!A ? a : b}`);
  for (const k of ['major', 'minor', 'patch']) if (A[k] !== B[k]) return A[k] < B[k] ? -1 : 1;
  if (!A.pre && !B.pre) return 0; if (!A.pre) return 1; if (!B.pre) return -1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i], y = B.pre[i]; if (x === undefined) return -1; if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return +x < +y ? -1 : 1; } else if (nx !== ny) return nx ? -1 : 1; else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function args() { const out = {}; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] !== undefined && !a[i + 1].startsWith('--') ? a[++i] : true; out[k] = v; } } return out; }
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, ...opts });

function observeLive() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const tags = sh('git', ['ls-remote', '--tags', 'origin']).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const peeled = new Map(tags.filter(([, r]) => r.endsWith('^{}')).map(([c, r]) => [r.slice('refs/tags/'.length, -3), c]));
  const tagList = tags.filter(([, r]) => !r.endsWith('^{}')).map(([c, r]) => { const name = r.slice('refs/tags/'.length); return { name, commit: peeled.get(name) ?? c }; });
  let registry;
  try {
    const list = JSON.parse(sh('npm', ['view', PACKAGE, 'versions', 'dist-tags', '--json']));
    const versions = {};
    for (const v of [].concat(list.versions ?? [])) {
      const dist = JSON.parse(sh('npm', ['view', `${PACKAGE}@${v}`, 'dist', 'gitHead', '--json']));
      versions[v] = { integrity: dist.dist?.integrity ?? null, gitHead: dist.gitHead ?? null, attestations: Boolean(dist.dist?.attestations), sourceCommit: null };
    }
    registry = { versions, distTags: list['dist-tags'] ?? {} };
  } catch (error) { registry = { error: sanitize(error.stderr || error.message) }; }
  let releases;
  try { releases = JSON.parse(sh('gh', ['release', 'list', '--limit', '200', '--json', 'tagName'])).map((r) => ({ tag: r.tagName })); }
  catch (error) { releases = { error: sanitize(error.stderr || error.message) }; }
  return { package: { name: pkg.name, version: pkg.version }, tags: tagList, releases, registry };
}

function sourceEvidence(pub, commit) {
  if (!pub) return 'absent';
  if (pub.sourceCommit) return pub.sourceCommit === commit ? 'verified' : 'mismatch';
  if (pub.gitHead) return pub.gitHead === commit ? 'verified' : 'mismatch';
  return 'unverified'; // an attestation alone is advisory (Codex review of #18, ruling 2026-09-07): it names a builder, not this commit
}
const advisory = (pub) => (pub.attestations ? ' (a provenance attestation is present; that is advisory, not source evidence)' : '');
const DIST_TAG = /^[A-Za-z][A-Za-z0-9._-]*$/; // npm also rejects anything readable as a semver range, e.g. v1 or 1.x

export function plan(obs, { version, sha, distTag = 'latest' }) {
  const out = { state: 'refuse', reason: '', version, tag: `v${version}`, prerelease: 'false', dist_tag: 'latest', previous_tag: '', mark_latest: 'false' };
  const done = (state, reason) => ({ ...out, state, reason: sanitize(reason) });
  if (!SEMVER.test(version)) return done('refuse', `${version} is not strict SemVer`);
  if (!SHA40.test(sha)) return done('refuse', `sha ${sha} is not a full 40-hex commit`);
  if (!DIST_TAG.test(distTag) || /^v\d/i.test(distTag)) return done('refuse', `dist_tag ${distTag} is not a valid npm dist-tag (letters, digits, . _ -; not a version or range)`);
  if (obs.package.name !== PACKAGE) return done('refuse', `package.json names ${obs.package.name}, not ${PACKAGE}`);
  if (obs.package.version !== version) return done('refuse', `package.json at ${sha} says ${obs.package.version}, dispatch says ${version}`);
  if (obs.registry.error) return done('observation-error', `registry: ${obs.registry.error}`);
  if (obs.releases.error) return done('observation-error', `releases: ${obs.releases.error}`);
  const pre = Boolean(parse(version).pre);
  out.prerelease = String(pre); out.dist_tag = pre && distTag === 'latest' ? 'next' : distTag;
  const stableTags = obs.tags.map((t) => t.name).filter((n) => /^v/.test(n) && SEMVER.test(n.slice(1)) && !parse(n.slice(1)).pre).map((n) => n.slice(1));
  const older = stableTags.filter((v) => compare(v, version) < 0).sort(compare);
  out.previous_tag = older.length ? `v${older.at(-1)}` : '';
  const publishedStable = Object.keys(obs.registry.versions).filter((v) => !parse(v)?.pre);
  const newerStable = publishedStable.filter((v) => compare(v, version) > 0).sort(compare);
  out.mark_latest = String(!pre && newerStable.length === 0);
  const tag = obs.tags.find((t) => t.name === out.tag);
  const pub = obs.registry.versions[version];
  const rel = obs.releases.find((r) => r.tag === out.tag);
  if (tag && tag.commit !== sha) return done('refuse', `${out.tag} already points at ${tag.commit}, not ${sha}; tags are never moved. Bump the version for a new release, or dispatch with sha ${tag.commit} to recover that one`);
  if (pub) {
    const ev = sourceEvidence(pub, sha);
    if (ev === 'mismatch') return done('refuse', `${version} is on npm from ${pub.sourceCommit ?? pub.gitHead}, not ${sha}`);
    if (ev === 'unverified' && !LEGACY[version]) return done('refuse', `${version} is on npm without a gitHead or sourceCommit linking it to ${sha}${advisory(pub)}; tagging it is an incident decision, not a workflow action`);
    if (!tag) return done('tag-only', `${version} is on npm (integrity ${pub.integrity}) but ${out.tag} is missing; tag ${sha}`);
    if (!rel) return done('release-only', `${out.tag} and npm ${version} agree; GitHub Release missing`);
    return done('noop', `${version} is published, tagged at ${sha}, and released; nothing to do`);
  }
  if (!pre && distTag === 'latest' && newerStable.length) return done('refuse', `${version} is older than published stable ${newerStable.at(-1)}; publishing it under latest would move the channel backwards. Re-dispatch with dist_tag set to another tag (for example previous) to backfill it`);
  if (tag) return { ...done('publish', `${out.tag} exists at ${sha} but ${version} is not on npm (false advertisement); retrying the original candidate`), recovery: 'true' };
  return { ...done('publish', `${version} is new: publish, verify, tag, release`), recovery: 'false' };
}

export function drift(obs) {
  const failures = [], info = [];
  if (obs.registry.error) return { failures: [`observation-error registry: ${obs.registry.error}`], info, code: 2 };
  if (obs.releases.error) return { failures: [`observation-error releases: ${obs.releases.error}`], info, code: 2 };
  const canonical = [];
  for (const t of obs.tags) {
    if (!t.name.startsWith('v')) continue;
    const v = t.name.slice(1);
    if (!SEMVER.test(v)) { failures.push(`malformed-ref ${t.name}`); continue; }
    canonical.push({ ...t, version: v });
  }
  for (const t of canonical) {
    const pub = obs.registry.versions[t.version];
    if (!pub) { failures.push(`tagged-unpublished ${t.name} -> ${t.commit}`); continue; }
    const legacy = LEGACY[t.version];
    if (legacy && (legacy.tag !== t.name || legacy.commit !== t.commit)) failures.push(`source-mismatch ${t.name}: legacy record expects ${legacy.commit}`);
    const ev = sourceEvidence(pub, t.commit);
    if (ev === 'mismatch') failures.push(`source-mismatch ${t.name}: npm says ${pub.sourceCommit ?? pub.gitHead}, tag says ${t.commit}`);
    else if (ev === 'unverified') (legacy ? info : failures).push(`${legacy ? 'source-unverified-legacy' : 'source-unverified'} ${t.name}${legacy ? ` (${legacy.reason})` : advisory(pub)}`);
    if (!obs.releases.some((r) => r.tag === t.name)) failures.push(`release-missing ${t.name}`);
  }
  for (const v of Object.keys(obs.registry.versions)) if (!canonical.some((t) => t.version === v)) failures.push(`published-untagged ${v}`);
  const stable = canonical.map((t) => t.version).filter((v) => !parse(v).pre).sort(compare);
  const latest = obs.registry.distTags.latest;
  if (stable.length && latest && compare(stable.at(-1), latest) !== 0) failures.push(`channel-mismatch highest stable tag v${stable.at(-1)} vs dist-tag latest ${latest}`);
  const pres = canonical.map((t) => t.version).filter((v) => parse(v).pre).sort(compare);
  const next = obs.registry.distTags.next;
  if (next && pres.length && compare(pres.at(-1), next) !== 0) failures.push(`channel-mismatch highest prerelease tag v${pres.at(-1)} vs dist-tag next ${next}`);
  if (SEMVER.test(obs.package.version) && !canonical.some((t) => t.version === obs.package.version)) info.push(`pending main package.json ${obs.package.version} is not released yet`);
  return { failures, info, code: failures.length ? 1 : 0 };
}

async function verifyPublication(obs0, { version, sha, integrity }, observe) {
  const delays = [2, 4, 8, 15, 30, 30, 60, 60, 60, 60];
  let last = '';
  for (let i = 0; i < delays.length; i++) {
    const obs = i === 0 ? obs0 : observe();
    if (obs.registry.error) { last = `observation-error ${obs.registry.error}`; }
    else {
      const pub = obs.registry.versions[version];
      if (!pub) last = `${version} not served yet`;
      else if (integrity && pub.integrity !== integrity) return { ok: false, reason: `integrity ${pub.integrity} != packed ${integrity}` };
      else if (sourceEvidence(pub, sha) === 'mismatch') return { ok: false, reason: `source ${pub.sourceCommit ?? pub.gitHead} != ${sha}` };
      else if (sourceEvidence(pub, sha) === 'unverified' && !LEGACY[version]) return { ok: false, reason: `${version} is served without a gitHead or sourceCommit equal to ${sha}${advisory(pub)}` };
      else if (!pub.attestations && !LEGACY[version]) last = `${version} served without a provenance attestation`;
      else return { ok: true, reason: `${version} served: integrity ${pub.integrity}, provenance ${pub.attestations}, gitHead ${pub.gitHead ?? 'absent'}` };
    }
    if (i < delays.length - 1) await new Promise((r) => setTimeout(r, delays[i] * 1000 * (process.env.RELEASE_PLAN_FAST ? 0 : 1)));
  }
  return { ok: false, reason: last };
}

const a = args();
let observationIndex = 0;
const observe = a.observations ? () => {
  const observations = JSON.parse(readFileSync(a.observations, 'utf8'));
  return Array.isArray(observations) ? observations[Math.min(observationIndex++, observations.length - 1)] : observations;
} : observeLive;
if (a.plan) {
  const result = plan(observe(), { version: String(a.version), sha: String(a.sha), distTag: a['dist-tag'] !== undefined ? String(a['dist-tag']) : 'latest' });
  const lines = Object.entries(result).map(([k, v]) => `${k}=${v}`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exitCode = result.state === 'refuse' || result.state === 'observation-error' ? 1 : 0;
} else if (a['verify-publication']) {
  const result = await verifyPublication(observe(), { version: String(a.version), sha: String(a.sha), integrity: a.integrity ? String(a.integrity) : null }, observe);
  process.stdout.write(`${result.ok ? 'verified' : 'unverified'}: ${result.reason}\n`);
  process.exitCode = result.ok ? 0 : 1;
} else if (a.drift) {
  const result = drift(observe());
  for (const line of result.info) process.stdout.write(`${sanitize(`info ${line}`)}\n`);
  for (const line of result.failures) process.stdout.write(`${sanitize(`FAIL ${line}`)}\n`);
  process.stdout.write(sanitize(result.failures.length ? `${result.failures.length} drift state(s)` : 'release state consistent') + '\n');
  process.exitCode = result.code;
} else { process.stderr.write('usage: release-plan.mjs --plan|--verify-publication|--drift [--observations FILE]\n'); process.exitCode = 64; }
