#!/usr/bin/env node
// Regenerates CHANGELOG.md from the project's own release record.
//
// Every release is a `release/<version>` pull request merged to main, then a GitHub Release
// `v<version>` cut by release.yml with GitHub's generated notes. This script reads both through
// `gh` and writes one section per release, newest first:
//   - the release PR's own summary when the body carries one ("What ships", "Since v…"),
//   - the merged pull requests GitHub listed for the tag (the release PR itself is dropped),
//   - the compare link.
// It never edits by hand; run it after a release and commit the result.
//
// Usage:
//   node scripts/changelog.mjs           # rewrite CHANGELOG.md
//   node scripts/changelog.mjs --check   # exit 1 when CHANGELOG.md is out of date
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// execFile with an argument array: no shell, so nothing in a title or body is ever interpreted.
const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'ryanliu-terum/terum-skills';
const out = resolve(root, 'CHANGELOG.md');
const check = process.argv.includes('--check');

async function gh(args) {
  try {
    const { stdout } = await run('gh', args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`gh ${args.join(' ')} failed: ${detail}\nThis script needs the GitHub CLI logged in.\n`);
    process.exit(2);
  }
}

const releases = JSON.parse(await gh(['release', 'list', '--repo', REPO, '--limit', '500', '--json', 'tagName,publishedAt,isPrerelease']))
  .filter(release => /^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(release.tagName));
const pulls = JSON.parse(await gh(['pr', 'list', '--repo', REPO, '--state', 'merged', '--limit', '1000', '--json', 'number,title,body,headRefName,mergedAt,url']));
const releasePulls = new Map();
for (const pull of pulls) {
  const branch = /^release\/(\d+\.\d+\.\d+(?:[-+].*)?)$/.exec(pull.headRefName);
  const title = /^(?:release|chore\(release\)):\s*(\d+\.\d+\.\d+(?:[-+].*)?)/.exec(pull.title);
  const version = branch?.[1] ?? title?.[1];
  if (version && !releasePulls.has(version)) releasePulls.set(version, pull);
}

// Semantic-version order, newest first.
const parts = tag => tag.slice(1).split(/[-+]/)[0].split('.').map(Number);
releases.sort((a, b) => {
  const [x, y] = [parts(a.tagName), parts(b.tagName)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return b.tagName.localeCompare(a.tagName);
});

// The release PR's summary: the section under a heading that names what ships, or a
// "Since v…" paragraph followed by its bullets. Anything else is left to the PR list.
function summary(body) {
  if (!body) return null;
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const headingAt = index => /^(#{1,6})\s+(.*)$/.exec(lines[index]);
  for (let i = 0; i < lines.length; i++) {
    const heading = headingAt(i);
    if (heading && /ships|since v\d|what this releases/i.test(heading[2])) {
      const level = heading[1].length;
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = headingAt(j);
        if (next && next[1].length <= level) break;
        block.push(lines[j]);
      }
      return trim(block);
    }
    if (/^since v\d+\.\d+\.\d+/i.test(lines[i])) {
      const block = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || /^\s*[-*|]/.test(lines[j])); j++) block.push(lines[j]);
      return trim(block);
    }
  }
  return null;
}

function trim(block) {
  while (block.length && block[0].trim() === '') block.shift();
  while (block.length && block[block.length - 1].trim() === '') block.pop();
  return block.length ? block.join('\n') : null;
}

// GitHub's generated notes: keep the "* … in <pr url>" rows, drop the release PR itself.
function merged(notes, releaseNumber) {
  if (!notes) return [];
  return notes.replace(/\r\n/g, '\n').split('\n')
    .filter(line => /^\* .* by @[\w-]+ in https:\/\/github\.com\/.*\/pull\/\d+$/.test(line))
    .filter(line => !/made their first contribution/.test(line))
    .filter(line => releaseNumber === null || !line.endsWith(`/pull/${releaseNumber}`))
    .map(line => line.replace(/^\* /, '- ').replace(/ by @([\w-]+) in (https:\/\/\S+\/pull\/(\d+))$/, ' ([#$3]($2), @$1)'));
}

const sections = [];
for (let i = 0; i < releases.length; i++) {
  const release = releases[i];
  const version = release.tagName.slice(1);
  const notes = JSON.parse(await gh(['release', 'view', release.tagName, '--repo', REPO, '--json', 'body,url'])); // one call per tag; fine for a maintainer script
  const pull = releasePulls.get(version) ?? null;
  const date = release.publishedAt.slice(0, 10);
  const older = releases[i + 1]?.tagName ?? null;
  const lines = [`## ${version} (${date})${release.isPrerelease ? ' (pre-release)' : ''}`, ''];
  lines.push(`[Release](${notes.url})${pull ? ` · [release PR #${pull.number}](${pull.url})` : ''}${older ? ` · [changes since ${older}](https://github.com/${REPO}/compare/${older}...${release.tagName})` : ''}`, '');
  const highlights = summary(pull?.body);
  if (highlights) lines.push(highlights, '');
  const rows = merged(notes.body, pull?.number ?? null);
  if (rows.length) {
    if (highlights) lines.push('Merged pull requests:', '');
    lines.push(...rows, '');
  } else if (!highlights) {
    lines.push('No pull request list was recorded for this release.', '');
  }
  sections.push(lines.join('\n'));
}

const header = [
  '# Changelog',
  '',
  `Every release of terum-skills, newest first. Generated by \`node scripts/changelog.mjs\` from the merged \`release/<version>\` pull requests and the GitHub Releases of ${REPO}; do not edit by hand. Versions follow the npm package \`terum-skills\`; the desktop app ships with the same version number.`,
  '',
].join('\n');
const output = header + '\n' + sections.join('\n');

let current = null;
try { current = await readFile(out, 'utf8'); } catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
if (current === output) {
  process.stderr.write(`CHANGELOG.md is current (${releases.length} releases).\n`);
  process.exit(0);
}
if (check) {
  process.stderr.write('CHANGELOG.md is out of date; run `node scripts/changelog.mjs`.\n');
  process.exit(1);
}
await writeFile(out, output);
process.stderr.write(`Wrote CHANGELOG.md: ${releases.length} releases, ${releasePulls.size} release PRs matched.\n`);
