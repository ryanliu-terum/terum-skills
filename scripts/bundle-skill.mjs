#!/usr/bin/env node
// Bundle the terum-skills skills into the build output. Reports on stderr: this runs under prepack,
// and `npm pack --json` output must stay parseable.
//
// The canonical copies are .claude/skills/<name>/SKILL.md — the files this repository's own Claude
// Code harness loads. npm cannot ship them from there (listing a dot-directory in `files` also drags
// the harness README and the review tools along), so `npm run build` copies every file carrying the
// `metadata.managed-by: terum-skills` marker, byte for byte, to dist/claude/skills/<name>/SKILL.md,
// where src/lib/wrapper.ts resolves them from dist/lib. Unmarked skills (the review tools) are never
// bundled. A marked file is checked here because setup and uninstall recognise their copies by the
// marker, Codex reads `metadata.short-description`, and an unquoted description is the HYG1 defect
// that would keep the skill from ever being shared.
//
//   node scripts/bundle-skill.mjs [--out <dist-dir>]
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outIndex = process.argv.indexOf('--out');
const out = outIndex >= 0 && process.argv[outIndex + 1] ? resolve(process.argv[outIndex + 1]) : join(root, 'dist');
const sources = join(root, '.claude', 'skills');
const target = join(out, 'claude', 'skills');
const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MARKER = /^\s+managed-by:\s*terum-skills\s*$/m;
const QUOTED_OR_BLOCK_DESCRIPTION = /^description:[ \t]*(["'|>])/m;
const ALLOWED_KEYS = ['name', 'description', 'metadata'];
const ALLOWED_METADATA = ['managed-by', 'short-description'];

const problems = [];
const bundled = [];
const entries = (await readdir(sources, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));
for (const entry of entries) {
  const source = join(sources, entry.name, 'SKILL.md');
  let raw;
  try {
    raw = await readFile(source, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }
  const match = FRONTMATTER.exec(raw);
  if (!match || !MARKER.test(match[1])) continue;
  const fail = (why) => problems.push(`${source}: ${why}`);
  let parsed;
  try {
    parsed = YAML.parse(match[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    fail(`frontmatter is not valid YAML: ${message}`);
    continue;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('frontmatter must be a mapping');
    continue;
  }
  if (parsed.name !== entry.name) fail(`name must equal the folder name ${entry.name} (found ${JSON.stringify(parsed.name)})`);
  if (typeof parsed.description !== 'string' || !parsed.description.trim()) fail('description is required');
  else if (!QUOTED_OR_BLOCK_DESCRIPTION.test(match[1])) fail('description must be a quoted or block scalar (HYG1: a bare scalar with a colon breaks YAML readers)');
  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_KEYS.includes(key)) fail(`top-level key ${key} is not allowed (only ${ALLOWED_KEYS.join(', ')})`);
  }
  const metadata = parsed.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('metadata must be a mapping');
  } else {
    if (metadata['managed-by'] !== 'terum-skills') fail('metadata.managed-by must be terum-skills; setup could not recognise its own copy without it');
    if (typeof metadata['short-description'] !== 'string' || !metadata['short-description'].trim()) fail('metadata.short-description is required (Codex reads it)');
    for (const key of Object.keys(metadata)) {
      if (!ALLOWED_METADATA.includes(key)) fail(`metadata key ${key} is not allowed (only ${ALLOWED_METADATA.join(', ')})`);
    }
  }
  bundled.push({ name: entry.name, source, raw });
}
if (!bundled.length && !problems.length) problems.push(`${sources}: no SKILL.md carries metadata.managed-by: terum-skills; nothing to bundle`);
if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'}; nothing bundled.`);
  process.exit(1);
}
// The folder is entirely this script's: a skill removed from the set must not linger in dist/ from an earlier build.
await rm(target, { recursive: true, force: true });
for (const skill of bundled) {
  const destination = join(target, skill.name, 'SKILL.md');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, skill.raw);
  console.error(`Bundled ${skill.source} -> ${destination}`);
}

// The PostToolUse edit hook (src/lib/editHook.ts) ships the same way. Its canonical copy is a plain
// asset rather than a file in .claude/: it is placed under the user's STATE root and run as
// `node <path>`, so this repository's own harness has no use for it and never loads it.
// The marker is asserted here for the same reason as the frontmatter above — install, refresh and
// uninstall all recognise their own copy by it, and a script without it is left alone forever.
const hookSource = join(root, 'assets', 'claude', 'hooks', 'terum-skills-edit.mjs');
const hookTarget = join(out, 'claude', 'hooks', 'terum-skills-edit.mjs');
const hook = await readFile(hookSource, 'utf8');
if (!hook.startsWith('// terum-skills managed hook')) {
  console.error(`${hookSource}: must begin with "// terum-skills managed hook"; install and uninstall could not recognise their own copy without it.`);
  process.exit(1);
}
await mkdir(dirname(hookTarget), { recursive: true });
await writeFile(hookTarget, hook);
console.error(`Bundled ${hookSource} -> ${hookTarget}`);
