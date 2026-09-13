import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVersionFolder, versionLabel } from '../../lib/versions.js';

/**
 * The capture frames under `.planning/codex-runs/` are the desktop's replay fixtures: the app's
 * tests drive the real adapter against them instead of a process. That makes them an oracle, and an
 * oracle nothing checks is one that can drift without a single test going red — which is what
 * happened when layout 3 re-keyed their DTO halves to version folders and left every printed line
 * saying the 40-hex tree hash it replaced.
 *
 * **These files are RECORDINGS.** Different sets were captured by different CLI builds, so their
 * printed lines legitimately carry different field sets — an older `search` line ends at the
 * endorsement where a newer one carries `updated` too. The invariant is therefore NOT "the line
 * equals today's `format()` of the row": that is false for every older recording, and asserting it
 * is how the first version of this file came to bake a literal `undefined` into five frame sets
 * whose DTO has no `updated` field. It was self-consistent — `format()` on both sides — and wrong.
 *
 * What actually holds, for a recording of any vintage:
 *   1. no printed line contains the string `undefined` — a real CLI never interpolates one;
 *   2. the version token in a printed skill line is the `Version N` of that row's own `latest`;
 *   3. a local row's printed state carries no ` @<8 hex>` suffix — D1 deleted that spelling;
 *   4. `people[]` rides the bare `ls` branch alone (`ls.ts:149`) — `showMember` (`:220`),
 *      `showProject` (`:228`) and `showLocal` (`:348`) each return a shape without it;
 *   5. `display_name` is the byline `authored[]` and showMember's "Authored:" line are matched on
 *      (`:121`, `:135-137`, `:215`), which the handle can never satisfy;
 *   6. `people[].installed` and a skill's `installedBy` agree, because `ls.ts:117-131` builds both
 *      from the same parsed people — one cannot name a handle the other leaves with nothing;
 *   7. a placement whose recorded INPUT is a 40-hex tree hash comes out as `version: null` with no
 *      `(Version N)` in its state — `configFileSchema`'s preprocess maps the hash to null before any
 *      verb sees it (`schema.ts:243-248`, spec §3.4), `status.ts:54` copies that null into the ledger
 *      and `ls.ts:270-278`'s `stateOf` then says nothing rather than inventing an ordinal — and, for a
 *      recording of ANY provenance, `placement.version`, `state` and the printed row line are three
 *      renderings of one value, so they agree in both directions (D70: the layout-3 re-key wrote
 *      `v1` / `(Version 1)` over the fixture's tree hash, a value the CLI can never emit for it).
 */
const ROOT = '.planning/codex-runs';
type Frame = { t: string; verb?: string; ok?: boolean; line?: string; value?: unknown };

function frameFiles(): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  let dirs: string[];
  try { dirs = readdirSync(ROOT); } catch { return out; }
  for (const dir of dirs.sort()) {
    const frames = join(ROOT, dir, 'frames');
    let files: string[];
    try { files = readdirSync(frames); } catch { continue; }
    for (const file of files.sort()) {
      const path = join(frames, file);
      if (file.endsWith('.jsonl') && statSync(path).isFile()) out.push({ id: `${dir}/${file}`, path });
    }
  }
  return out;
}

const read = (path: string): Frame[] =>
  readFileSync(path, 'utf8').trim().split('\n').flatMap((line) => {
    try { return [JSON.parse(line) as Frame]; } catch { return []; }
  });

const files = frameFiles();

describe('capture frames stay consistent with the CLI that recorded them', () => {
  it('has frames to check at all — an empty walk would make every assertion below vacuous', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  // (1) covers EVERY verb, not only the two below: a `publish` or `status` line can carry an
  // interpolated hole just as easily, and this is the assertion that catches a bad repair.
  it('never prints the string `undefined` — no CLI interpolates one', () => {
    const offenders: string[] = [];
    for (const { id, path } of files) {
      for (const row of read(path)) {
        if (row.t === 'print' && typeof row.line === 'string' && row.line.includes('undefined')) offenders.push(`${id}: ${row.line.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  for (const { id, path } of files) {
    const rows = read(path);
    const result = rows.find((row) => row.t === 'result' && row.ok === true);
    if (!result || (result.verb !== 'ls' && result.verb !== 'search')) continue;
    const value = result.value as Record<string, unknown> | unknown[] | null;
    if (value === null || value === undefined) continue;
    const skills = (Array.isArray(value) ? value : value['skills']) as Record<string, unknown>[] | undefined;

    it(`${id}: the printed version token is its row's own version, and no local state keeps the @<8 hex> suffix`, () => {
      for (const row of rows) {
        if (row.t !== 'print' || typeof row.line !== 'string') continue;
        const printed = /^\s*([A-Za-z0-9._-]+) — .*?; \d+ installs; ([^;]+)/.exec(row.line);
        if (printed) {
          const found = skills?.find((skill) => skill['name'] === printed[1]);
          const latest = found?.['latest'];
          const n = typeof latest === 'string' ? parseVersionFolder(latest) : null;
          // A row whose `latest` is not a version folder is an older recording: nothing to check.
          if (n !== null) expect(printed[2], `${id} / ${printed[1]}`).toBe(versionLabel(n));
        }
        // D1: `Version N` is the only form a version takes in a user-facing string. The suffix
        // sliced a tree hash, and slicing a version folder would print `@v1`.
        expect(row.line, id).not.toMatch(/placement recorded from \S+ @[0-9a-f]{8}/);
      }
    });

    if (!Array.isArray(value)) {
      const scoped = value['member'] !== undefined || value['local'] !== undefined || /ls-project/.test(id);
      if (scoped) it(`${id}: a scoped ls carries no people[] — only the bare branch returns one`, () => {
        expect(value['people'], id).toBeUndefined();
      });
      const people = value['people'] as { handle: string; email: string; display_name: string; installed?: unknown[] }[] | undefined;
      if (people) it(`${id}: people[].installed agrees with installedBy — both come from the same read`, () => {
        for (const person of people) {
          const installs = (skills ?? []).filter((skill) => ((skill['installedBy'] as { handle: string }[] | undefined) ?? []).some((p) => p.handle === person.handle));
          if (installs.length === 0) continue;
          const rows = (person.installed ?? []) as { id: string; version: unknown; scope: unknown; since?: string }[];
          expect(rows, `${id} / ${person.handle} installed ${installs.map((s) => s['name']).join(', ')}`).toHaveLength(installs.length);
          // Length alone cannot catch a fabricated FIELD, which is how a guessed `version: "v1"`
          // survived the first cut of this assertion. `installedBy` carries the same `scope` and
          // `since` for the same install, so those are checkable against it; `version` is not on
          // `installedBy` at all, which is precisely why it must never be invented — `ls.ts:277-279`.
          for (const skill of installs) {
            const mine = ((skill['installedBy'] as { handle: string; scope: unknown; since?: string }[]).find((p) => p.handle === person.handle))!;
            const row = rows.find((r) => r.id === skill['id']);
            expect(row, `${id} / ${person.handle} has no installed[] row for ${skill['name']}`).toBeDefined();
            expect(row!.scope, `${id} / ${person.handle} / ${skill['name']} scope`).toEqual(mine.scope);
            if (mine.since !== undefined) expect(row!.since, `${id} / ${person.handle} / ${skill['name']} since`).toBe(mine.since);
          }
        }
      });
      if (people) it(`${id}: display_name matches the byline authored[] and "Authored:" are matched on`, () => {
        const byEmail = new Map<string, string>();
        for (const skill of skills ?? []) {
          const match = /^(.*) <([^>]+)>$/.exec(String(skill['author'] ?? ''));
          if (match) byEmail.set(match[2]!, match[1]!);
        }
        for (const person of people) {
          const derived = byEmail.get(person.email);
          if (derived !== undefined) expect(person.display_name, `${id} / ${person.handle}`).toBe(derived);
        }
      });
    }
  }
});

const LEGACY_TREE_HASH = /^[0-9a-f]{40}$/;
const VERSION_PROSE = /\(Version \d+\)/;
type LocalRow = { name: string; path: string; state: string; placement?: { id: string; team: string; version: unknown } | null };
type LedgerRow = { path: string; id: string; team: string; version: unknown };

/**
 * What a set's OWN committed inputs say a placement's version was: the ids and folder names every
 * `fixture.sh` seeds with `$VER` (a `git rev-parse HEAD:skills/<x>` tree hash) and every
 * `config-*.json` still holding a 40-hex value. Read from the inputs rather than from a list kept
 * here, so a set genuinely re-recorded from a fixture that places at `v1` (D70's delegated
 * re-recording) turns the legacy half off by itself, and a set with no committed input at all
 * (installed-state, mock-vs-real-2026-09-09) is held by the self-consistency half alone.
 */
function legacyPlacements(dir: string): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>();
  const names = new Set<string>();
  const set = join(ROOT, dir);
  let fixture = '';
  try { fixture = readFileSync(join(set, 'fixture.sh'), 'utf8'); } catch { /* no generator committed */ }
  for (const hit of fixture.matchAll(/rev-parse HEAD:skills\/([a-z0-9-]+)/g)) names.add(hit[1]!);
  if (names.size) {
    // `"id":"$ID_DEPLOY",…,"version":"$VER"` — the id is a shell variable assigned earlier in the script.
    const vars = new Map([...fixture.matchAll(/\b([A-Z_]+)=([0-9a-f-]{36})\b/g)].map((hit) => [hit[1]!, hit[2]!]));
    for (const hit of fixture.matchAll(/"id":"(\$)?([A-Za-z0-9_-]+)"[^{}]*"version":"\$VER"/g)) {
      const id = hit[1] ? vars.get(hit[2]!) : hit[2];
      if (id !== undefined) ids.add(id);
    }
  }
  let entries: string[] = [];
  try { entries = readdirSync(set); } catch { return { ids, names }; }
  for (const file of entries) {
    if (!/^config.*\.json$/.test(file)) continue;
    let config: { placements?: Record<string, { id?: unknown; version?: unknown } | null> };
    try { config = JSON.parse(readFileSync(join(set, file), 'utf8')) as typeof config; } catch { continue; }
    for (const [path, entry] of Object.entries(config.placements ?? {})) {
      if (typeof entry?.version !== 'string' || !LEGACY_TREE_HASH.test(entry.version)) continue;
      if (typeof entry.id === 'string') ids.add(entry.id);
      names.add(basename(path));
    }
  }
  return { ids, names };
}

// (7) D70. The legacy half is keyed to each set's committed inputs; the self-consistency half runs on
// every set, because `placement.version` and `state` are one value rendered twice (`ls.ts:270-278`)
// and the printed row line is `state` verbatim (`ls.ts:330`) — a value invented in one limb and not
// the others is the exact shape the re-key left behind.
describe('no invented version for a legacy hash (D70)', () => {
  const legacy = new Map<string, ReturnType<typeof legacyPlacements>>();
  const legacyOf = (dir: string): ReturnType<typeof legacyPlacements> => {
    let hit = legacy.get(dir);
    if (!hit) legacy.set(dir, hit = legacyPlacements(dir));
    return hit;
  };
  let exercised = 0; // rows and ledger entries the legacy half actually judged

  for (const { id, path } of files) {
    const dir = id.split('/')[0]!;
    const rows = read(path);
    const result = rows.find((row) => row.t === 'result' && row.ok === true);
    const value = (result?.value ?? null) as Record<string, unknown> | null;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const local = ((value['local'] ?? []) as { rows?: LocalRow[] }[]).flatMap((section) => section.rows ?? []);
    const ledger = (value['ledger'] as { placements?: LedgerRow[] } | undefined)?.placements ?? [];
    if (!local.length && !ledger.length) continue;
    const { ids, names } = legacyOf(dir);
    const prints = rows.flatMap((row) => (row.t === 'print' && typeof row.line === 'string' ? [row.line] : []));
    exercised += local.filter((row) => (row.placement ? ids.has(row.placement.id) : row.placement === undefined && names.has(row.name))).length + ledger.filter((entry) => ids.has(entry.id)).length;

    it(`${id}: a tree-hash placement comes out as version null, and version, state and the printed line agree`, () => {
      for (const row of local) {
        const where = `${id} / ${row.name}`;
        const placement = row.placement;
        // Both directions of `stateOf`: a folder version carries exactly its ordinal's label, null carries
        // none, and no placement at all is "untracked locally". An older recording omits `placement`
        // entirely; its state is still checkable against the set's inputs by folder name below.
        if (placement === null) expect(row.state, `${where}: no placement`).toBe('untracked locally');
        else if (placement) {
          if (placement.version === null) expect(row.state, `${where}: a null version renders no ordinal`).not.toMatch(VERSION_PROSE);
          else {
            const n = typeof placement.version === 'string' ? parseVersionFolder(placement.version) : null;
            expect(n, `${where}: placement.version ${JSON.stringify(placement.version)} is neither null nor a version folder`).not.toBeNull();
            expect(row.state, `${where}: state carries its own ordinal`).toContain(`(${versionLabel(n!)})`);
          }
        }
        // The legacy half: this set's own inputs recorded the placement with a tree hash (§3.4 → null).
        if (placement ? ids.has(placement.id) : placement === undefined && names.has(row.name)) {
          if (placement) expect(placement.version, `${where}: recorded with a tree hash, so §3.4 maps it to null`).toBeNull();
          expect(row.state, `${where}: recorded with a tree hash, so stateOf says nothing`).not.toMatch(VERSION_PROSE);
        }
        // The printed row line is `state` verbatim; an older recording may carry no print lines at all.
        const printed = prints.map((line) => /^\s*(.+?) — (.+?)(?:; source problem: .*?)?; path: (.+)$/.exec(line)).find((hit) => hit !== null && hit[3] === row.path);
        if (printed) expect(printed[2], `${where}: the printed state is the row's state`).toBe(row.state);
      }
      for (const entry of ledger) {
        const where = `${id} / ledger ${entry.id}`;
        if (entry.version !== null) expect(typeof entry.version === 'string' ? parseVersionFolder(entry.version) : null, `${where}: version ${JSON.stringify(entry.version)} is neither null nor a version folder`).not.toBeNull();
        if (ids.has(entry.id)) expect(entry.version, `${where}: recorded with a tree hash, so §3.4 maps it to null`).toBeNull();
        // `status` prints no ledger row, so the only mirror a print line can offer is not inventing one.
        if (entry.version === null) for (const line of prints) expect(line, where).not.toMatch(new RegExp(`placement recorded from ${entry.team} \\(Version`));
      }
    });
  }

  it('judged at least one recorded placement by its set\'s own inputs — otherwise the legacy half above is vacuous', () => {
    expect(exercised).toBeGreaterThan(0);
  });
});
