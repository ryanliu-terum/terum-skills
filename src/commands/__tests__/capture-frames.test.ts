import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { format } from '../ls.js';
import { parseVersionFolder, versionLabel } from '../../lib/versions.js';

/**
 * The capture frames under `.planning/codex-runs/` are the desktop's replay fixtures: the app's
 * tests drive the real adapter against them instead of a process. That makes them an oracle, and an
 * oracle nothing checks is one that can drift without a single test going red — which is exactly
 * what happened when layout 3 re-keyed their DTO halves to version folders and left every printed
 * line speaking layout 2 (`43bf7396`, ` @43bf7396`, a `global` endorsement that `skillEndorsement`
 * can no longer return). 76 frame files across 13 sets were inconsistent with the CLI that produced
 * their shape, and the whole desktop suite stayed green.
 *
 * This asserts the two properties a recording of a real run cannot violate:
 *   1. a printed skill line is exactly what `format()` makes of the row it describes, and
 *   2. `people[]` rides the bare `ls` branch alone (`ls.ts:149`) — `showMember`, `showProject` and
 *      `showLocal` each return a shape without it.
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

function read(path: string): Frame[] {
  return readFileSync(path, 'utf8').trim().split('\n').flatMap((line) => {
    try { return [JSON.parse(line) as Frame]; } catch { return []; }
  });
}

/** `ls.ts:278`, the only writer of a local row's state. */
function stateOf(placement: { team: string; version?: string | null } | null | undefined): string {
  if (!placement) return 'untracked locally';
  const ordinal = placement.version === null || placement.version === undefined ? null : parseVersionFolder(placement.version);
  return `placement recorded from ${placement.team}${ordinal === null ? '' : ` (${versionLabel(ordinal)})`}`;
}

const files = frameFiles();

describe('capture frames stay consistent with the CLI that recorded them', () => {
  it('has frames to check at all — an empty walk would make every assertion below vacuous', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { id, path } of files) {
    const rows = read(path);
    const result = rows.find((row) => row.t === 'result' && row.ok === true);
    if (!result || (result.verb !== 'ls' && result.verb !== 'search')) continue;
    const value = result.value as Record<string, unknown> | unknown[] | null;
    if (value === null || value === undefined) continue;
    const skills = (Array.isArray(value) ? value : value['skills']) as Record<string, unknown>[] | undefined;

    it(`${id}: every printed skill line is what format() makes of its row`, () => {
      const localRows = Array.isArray(value) ? [] : ((value['local'] as { rows?: Record<string, unknown>[]; notOffered?: Record<string, unknown>[] }[] | undefined) ?? [])
        .flatMap((section) => [...(section.rows ?? []), ...(section.notOffered ?? [])]);
      for (const row of rows) {
        if (row.t !== 'print' || typeof row.line !== 'string') continue;
        const local = /^(\s*)([A-Za-z0-9._-]+) — (?:placement recorded from |untracked locally)/.exec(row.line);
        if (local) {
          const match = localRows.find((candidate) => candidate['name'] === local[2]);
          if (!match) continue;
          const rest = /; path: .*$/.exec(row.line);
          expect(row.line, id).toBe(`${local[1] ?? ''}${local[2]} — ${stateOf(match['placement'] as never)}${rest ? rest[0] : ''}`);
          continue;
        }
        const printed = /^(\s*)([A-Za-z0-9._-]+) — .*; \d+ installs; /.exec(row.line);
        if (!printed) continue;
        const found = skills?.find((skill) => skill['name'] === printed[2]);
        if (!found) continue;
        // `search.ts:61` hands its hit to this same `format()`, mapping `endorsed` to `endorsement`.
        const skill = found['endorsement'] === undefined ? { ...found, endorsement: found['endorsed'] } : found;
        // `format()` supplies its own two-space indent; a nested list adds two more in front of it.
        const indent = printed[1] ?? '';
        expect(row.line, id).toBe(indent.slice(0, Math.max(0, indent.length - 2)) + format(skill as never));
      }
    });

    if (!Array.isArray(value)) {
      const scoped = value['member'] !== undefined || value['local'] !== undefined || /ls-project/.test(id);
      if (scoped) it(`${id}: a scoped ls carries no people[] — only the bare branch returns one`, () => {
        expect(value['people'], id).toBeUndefined();
      });
      const people = value['people'] as { handle: string; email: string; display_name: string }[] | undefined;
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
