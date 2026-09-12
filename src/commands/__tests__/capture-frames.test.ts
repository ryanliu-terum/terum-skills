import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
 *      from the same parsed people — one cannot name a handle the other leaves with nothing.
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
          expect(person.installed ?? [], `${id} / ${person.handle} installed ${installs.map((s) => s['name']).join(', ')}`).toHaveLength(installs.length);
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
