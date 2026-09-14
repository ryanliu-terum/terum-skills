import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConfigStore } from '../../lib/config.js';
import { bareTeam, cloneWithIdentity, ScriptedPrompter, temporaryDirectory } from '../../lib/__tests__/fixtures.js';
import { receiptSchema } from '../../lib/evals/receipt.js';
import { canonicalDigest, skillContentDigest } from '../../lib/skills.js';
import { versionDigests } from '../../lib/version-digests.js';
import { run } from '../ls.js';

/**
 * Cross-mirror overlays spec §4.1 / §8: a Library row joins the team clone by CONTENT DIGEST — the
 * version whose committed bytes equal the folder, and the newest committed receipt for those bytes —
 * never by name. Nothing here fetches, and nothing here writes.
 */
const ID = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const skillMd = (name: string, id: string, extra = '') => `---\nname: ${name}\ndescription: ${name} skill\nlicense: UNLICENSED\nmetadata:\n  id: ${id}\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\n# ${name}\n${extra}`;

function receipt(overrides: { content_digest: string; run_id: string; version: string; runner_handle?: string; skill_id?: string }) {
  return receiptSchema.parse({
    schema_version: 2, skill_id: overrides.skill_id ?? ID, skill_name: 'a', version: overrides.version, run_id: overrides.run_id, verdict: 'PASS',
    attribution: 'overlay fixture', execution_status: 'complete', expected_rows: 4, scored_rows: 4, content_digest: overrides.content_digest,
    comparisons: { 'candidate-vs-baseline': { win: 3, loss: 1, tie: 0, net_lift: 0.4, sign_p: 0.1 } }, arm_scores: { candidate: 0.8, baseline: 0.5 }, triggers: null, efficiency: {},
    provenance: { engine_version: 'test', engine_commit: 'unknown', cc_version: 'test', model: 'sonnet', judge_model: 'sonnet', k: 1, cases: ['one'], arm_skill_lists: {}, timestamp: '2026-01-02T00:00:00Z', runner_handle: overrides.runner_handle ?? 'alice' },
  });
}

async function fixture() {
  const team = await bareTeam();
  const home = await temporaryDirectory();
  const store = createConfigStore(join(team.root, 'state'));
  const clone = await cloneWithIdentity(team.bare, store.teamClone('team'));
  await store.update((config) => { config.teams.team = { remote: team.bare, handle: 'seed' }; });
  // Two committed versions of `a`: v2 differs from v1 by one file, and only v2 has a receipt.
  for (const [folder, extra] of [['v1', ''], ['v2', 'more\n']] as const) {
    await mkdir(join(clone, 'skills', 'a', folder), { recursive: true });
    await writeFile(join(clone, 'skills', 'a', folder, 'SKILL.md'), skillMd('a', ID, extra));
    if (folder === 'v2') await writeFile(join(clone, 'skills', 'a', folder, 'notes.md'), 'v2 notes\n');
  }
  const v2 = await canonicalDigest(join(clone, 'skills', 'a', 'v2'));
  await mkdir(join(clone, 'evals', ID, 'v2'), { recursive: true });
  await writeFile(join(clone, 'evals', ID, 'v2', '20260102T000000Z.json'), JSON.stringify(receipt({ content_digest: v2, run_id: '20260102T000000Z', version: 'v2' })));
  return { team, home, store, clone, v2 };
}

async function local(home: string, name: string, from?: string, raw?: string) {
  const path = join(home, '.claude', 'skills', name);
  if (from) await cp(from, path, { recursive: true });
  else { await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), raw!); }
  return path;
}

describe('ls --local cross-mirror overlay', () => {
  it('the two digest entry points agree on a version folder with managed fields present', async () => {
    const { clone, v2 } = await fixture();
    const dir = join(clone, 'skills', 'a', 'v2');
    const files = new Map<string, Buffer>();
    for (const name of await readdir(dir)) files.set(name, await readFile(join(dir, name)));
    expect(skillContentDigest(files)).toBe(v2);
    expect([...(await versionDigests(clone, ['a'])).values()].map((entry) => [entry.folder, entry.digest === v2])).toEqual([['v2', true], ['v1', false]]);
  });

  it('a hand-copied folder joins by bytes: version, the team receipt attributed to its runner, and knownToTeam', async () => {
    const { home, store, clone, v2 } = await fixture();
    const copied = await local(home, 'a', join(clone, 'skills', 'a', 'v2'));
    const other = await local(home, 'zeta', undefined, skillMd('zeta', OTHER));
    const configBefore = await readFile(join(store.root, 'config.json'), 'utf8');
    const io = new ScriptedPrompter();
    const result = await run({ local: true, home, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [
      { name: 'a', path: copied, placement: null, matchedVersion: 'v2', matchedName: 'a', matchedTeam: 'team', knownToTeam: true, localEval: null, localEvalStale: false,
        teamEval: { run_id: '20260102T000000Z', version: 'v2', content_digest: v2, team: 'team', mine: false, path: join(clone, 'evals', ID, 'v2', '20260102T000000Z.json') } },
      { name: 'zeta', path: other, matchedVersion: null, matchedName: null, matchedTeam: null, knownToTeam: false, teamEval: null, localEval: null, localEvalStale: false },
    ] }] } });
    // The prose row is unchanged: the overlay is data for the card, not a new sentence.
    expect(io.lines).toContain(`  a — untracked locally; path: ${copied}`);
    expect(await readFile(join(store.root, 'config.json'), 'utf8')).toBe(configBefore);
  });

  it('an edited copy of a known skill matches no version but is still known to the team, and reads as evaluated before the edit', async () => {
    const { home, store, clone } = await fixture();
    const edited = await local(home, 'a', join(clone, 'skills', 'a', 'v2'));
    await writeFile(join(edited, 'notes.md'), 'my edit\n');
    const result = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [
      { name: 'a', matchedVersion: null, knownToTeam: true, teamEval: null, localEval: null, localEvalStale: true },
    ] }] } });
  });

  // Review walk D1: the bytes decide the version on both mirrors — the card shows v1, no Edited chip.
  it('a placed copy whose bytes equal an older version matches that version, whatever the ledger recorded; matched-and-edited is a reachable row', async () => {
    const { home, store, clone } = await fixture();
    const placed = await local(home, 'a', join(clone, 'skills', 'a', 'v1'));
    await store.update((config) => { config.placements[placed] = { id: ID, team: 'team', version: 'v2', fingerprint: '', scope: { kind: 'global' }, placed_at: '' }; });
    const result = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'a', placement: { version: 'v2' }, matchedVersion: 'v1', teamEval: null, knownToTeam: true, edited: true }] }], problems: [] } });
  });

  // Review walk D3: `mine` on BOTH receipts, computed here and nowhere else — for the own store, "ran by any
  // handle this machine holds", because an own-store receipt names no team.
  it('an own-store receipt says whether this machine ran it, so a seeded teammate copy is never attributed to you', async () => {
    const { home, store, clone, v2 } = await fixture();
    await local(home, 'a', join(clone, 'skills', 'a', 'v2'));
    const ownRun = async (id: string, handle: string) => {
      const runDir = join(store.root, 'evals', 'local', v2.slice('sha256:'.length), id);
      await mkdir(runDir, { recursive: true });
      await writeFile(join(runDir, 'receipt.json'), JSON.stringify(receipt({ content_digest: v2, run_id: id, version: 'v2', runner_handle: handle })));
    };
    await ownRun('20260109T000000Z', 'seed');
    const byMe = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(byMe).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'a', localEval: { run_id: '20260109T000000Z', mine: true } }] }] } });
    await ownRun('20260110T000000Z', 'alice');
    const seededByAlice = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(seededByAlice).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'a', localEval: { run_id: '20260110T000000Z', mine: false }, teamEval: { mine: false } }] }] } });
  });

  it('a committed receipt run by this handle is marked mine, and the newest run for the digest wins', async () => {
    const { home, store, clone, v2 } = await fixture();
    await writeFile(join(clone, 'evals', ID, 'v2', '20260105T000000Z.json'), JSON.stringify(receipt({ content_digest: v2, run_id: '20260105T000000Z', version: 'v2', runner_handle: 'seed' })));
    await local(home, 'a', join(clone, 'skills', 'a', 'v2'));
    const result = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'a', teamEval: { run_id: '20260105T000000Z', mine: true } }] }] } });
  });

  it('a local run and a team receipt for the same bytes are both reported; the card picks the newer', async () => {
    const { home, store, clone, v2 } = await fixture();
    await local(home, 'a', join(clone, 'skills', 'a', 'v2'));
    const runDir = join(store.root, 'evals', 'local', v2.slice('sha256:'.length), '20260109T000000Z');
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'receipt.json'), JSON.stringify(receipt({ content_digest: v2, run_id: '20260109T000000Z', version: 'v2', runner_handle: 'seed' })));
    const result = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'a', localEval: { run_id: '20260109T000000Z' }, teamEval: { run_id: '20260102T000000Z' }, localEvalStale: false }] }] } });
  });

  it('unreadable and pre-migration receipts are skipped and named, never fatal', async () => {
    const { home, store, clone, v2 } = await fixture();
    await writeFile(join(clone, 'evals', ID, 'v2', '20260103T000000Z.json'), 'not json');
    const legacy = { ...receipt({ content_digest: v2, run_id: '20260104T000000Z', version: 'v2' }), schema_version: 1 } as Record<string, unknown>;
    delete legacy.content_digest;
    await writeFile(join(clone, 'evals', ID, 'v2', '20260104T000000Z.json'), JSON.stringify(legacy));
    await local(home, 'a', join(clone, 'skills', 'a', 'v2'));
    const io = new ScriptedPrompter();
    const result = await run({ local: true, home, config: store }, io);
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'a', teamEval: { run_id: '20260102T000000Z' } }] }] } });
    expect(io.lines).toContain('team/a: unreadable receipt v2/20260103T000000Z.json; not considered.');
    expect(io.lines.some((line) => line.includes('20260104T000000Z'))).toBe(false);
  });

  it('identical bytes in two teams with no placement match nothing and are reported; a placement decides', async () => {
    const { home, store, clone } = await fixture();
    await cp(clone, store.teamClone('other'), { recursive: true });
    await store.update((config) => { config.teams.other = { remote: 'https://github.com/acme/other', handle: 'seed' }; });
    const copied = await local(home, 'a', join(clone, 'skills', 'a', 'v2'));
    const first = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(first).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'a', matchedVersion: null, knownToTeam: true }], problems: [{ path: copied, reason: 'identical bytes exist in more than one team; no version is shown' }] }] } });
    await store.update((config) => { config.placements[copied] = { id: ID, team: 'other', version: 'v2', fingerprint: '', scope: { kind: 'global' }, placed_at: '' }; });
    const second = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(second).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'a', matchedVersion: 'v2', matchedTeam: 'other' }], problems: [] }] } });
  });

  it('an own run made with no team binding at all is still mine, so the card never reads "run by local"', async () => {
    const home = await temporaryDirectory();
    const store = createConfigStore(join(home, 'state'));
    const path = await local(home, 'solo', undefined, skillMd('solo', OTHER));
    const digest = await canonicalDigest(path);
    const runDir = join(store.root, 'evals', 'local', digest.slice('sha256:'.length), '20260111T000000Z');
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'receipt.json'), JSON.stringify(receipt({ content_digest: digest, run_id: '20260111T000000Z', version: 'v1', runner_handle: 'local', skill_id: OTHER })));
    const result = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'solo', localEval: { run_id: '20260111T000000Z', mine: true }, teamEval: null }] }] } });
  });

  it('a team whose clone is missing contributes nothing and the Library still lists every folder', async () => {
    const home = await temporaryDirectory();
    const store = createConfigStore(join(home, 'state'));
    await store.update((config) => { config.teams.team = { remote: 'https://github.com/acme/team', handle: 'seed' }; });
    const path = await local(home, 'solo', undefined, skillMd('solo', OTHER));
    const result = await run({ local: true, home, config: store }, new ScriptedPrompter());
    expect(result).toMatchObject({ ok: true, value: { local: [{ rows: [{ name: 'solo', path, matchedVersion: null, teamEval: null, knownToTeam: false }] }] } });
  });
});
