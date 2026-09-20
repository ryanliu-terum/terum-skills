// terum-skills managed hook: PostToolUse(Write|Edit). Installed and refreshed by `terum-skills
// setup`; removed by `terum-skills uninstall`. Edits here are overwritten — change
// assets/claude/hooks/terum-skills-edit.mjs in the package instead.
//
// Why a placed script rather than `npx -y terum-skills@latest <verb>`: this runs on EVERY Write and
// Edit in every project the agent touches. npx costs about a second a call even with a warm cache;
// a node process that bails on the first path test costs milliseconds. So this file imports nothing
// from the package, reads no network, and does no work at all unless the edited path is inside a
// `.claude/skills/` folder.
//
// What it is for: a skill edited in a session is a skill only this machine has. Nothing in the CLI
// is watching, so without this the change sits in the Library until someone remembers to publish
// it. Measured 2026-09-14 on the author's machine: 0 model-initiated invocations of the
// `terum-skills` skill across 7,158 session transcripts — passive availability was not enough.
//
// Contract: reads the Claude Code hook payload on stdin, writes `{"additionalContext": "…"}` on
// stdout, and always exits 0. Any failure is silence: a reminder is not worth interrupting an edit.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep, resolve } from 'node:path';

const SKILLS_SEGMENT = `${sep}.claude${sep}skills${sep}`;
/** One reminder per skill per session. Bumped only when the message changes enough to be worth repeating. */
const NOTE_VERSION = 1;
/** Session note files older than this are swept on the next write; a machine is not a log server. */
const NOTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const file = input?.tool_input?.file_path;
  if (typeof file !== 'string' || file === '') return;

  // The one cheap test, before any other syscall: every Library root is `<root>/.claude/skills`,
  // so an edit that is not under one cannot be an edit to a skill.
  const path = resolve(file);
  const at = path.indexOf(SKILLS_SEGMENT);
  if (at < 0) return;
  const rest = path.slice(at + SKILLS_SEGMENT.length);
  const first = rest.split(sep)[0];
  // A skill is a FOLDER under the root, so the edited file must be strictly inside one: no first
  // segment, or nothing after it, means a loose file in the skills root, which is not a skill.
  if (!first || first === rest) return;
  const folder = path.slice(0, at + SKILLS_SEGMENT.length) + first;

  const storeRoot = join(homedir(), '.terum', 'skills');
  let config;
  try { config = JSON.parse(readFileSync(join(storeRoot, 'config.json'), 'utf8')); }
  catch { return; } // terum-skills is not set up on this machine; say nothing.
  const teams = Object.keys(config?.teams ?? {});
  if (teams.length === 0) return; // No team to publish to.

  const name = folder.slice(folder.lastIndexOf(sep) + 1);
  const session = typeof input?.session_id === 'string' && input.session_id !== '' ? input.session_id : 'default';
  if (alreadyNoted(storeRoot, session, folder)) return;

  const placement = config?.placements?.[folder];
  const version = typeof placement?.version === 'string' ? placement.version : null;
  const lines = [
    `You edited ${name}, a skill in this machine's terum-skills Library (${folder}).`,
    placement
      ? `That folder is an installed copy${version === null ? '' : ` of ${version}`} from team ${placement.team}; the edit is local to this machine until it is published as a new version.`
      : 'The edit is local to this machine: teammates see the published version until a new one is published.',
    `To share it: run npx -y terum-skills@latest publish ${name} here through Bash once the user agrees; it rewrites the folder's managed frontmatter and writes an immutable version to team main. Its only question is a confirm when the latest local eval of these bytes failed, which refuses without a terminal before anything is written; hand the command to a terminal only then.`,
    `To check the change first: npx -y terum-skills@latest eval ${name} (paid agent runs — confirm with the user before starting one).`,
    'Shown once per skill per session by the terum-skills edit hook.',
  ];
  note(storeRoot, session, folder);
  process.stdout.write(JSON.stringify({ additionalContext: lines.join('\n') }));
}

function notePath(storeRoot, session) {
  // The session id comes from the harness; keep it out of the path shape whatever it contains.
  return join(storeRoot, 'run', 'edit-hints', `${Buffer.from(session).toString('base64url')}.json`);
}

function alreadyNoted(storeRoot, session, folder) {
  try { return JSON.parse(readFileSync(notePath(storeRoot, session), 'utf8'))[String(NOTE_VERSION)]?.includes(folder) === true; }
  catch { return false; }
}

function note(storeRoot, session, folder) {
  const path = notePath(storeRoot, session);
  let seen = {};
  try { seen = JSON.parse(readFileSync(path, 'utf8')); } catch { /* first note of the session */ }
  const key = String(NOTE_VERSION);
  seen[key] = [...new Set([...(seen[key] ?? []), folder])];
  mkdirSync(join(storeRoot, 'run', 'edit-hints'), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(seen), { encoding: 'utf8', mode: 0o600 });
  sweep(join(storeRoot, 'run', 'edit-hints'));
}

/** Sessions end without telling anyone, so old note files are swept on the rare write, not tracked. */
function sweep(directory) {
  const cutoff = Date.now() - NOTE_TTL_MS;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    try { if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true }); } catch { /* raced with another session */ }
  }
}

try { main(); } catch { /* A reminder is never worth failing an edit over. */ }
