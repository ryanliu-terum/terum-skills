import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../cli.js';
import { parseRenderOptions } from '../lib/render/options.js';
import { FRONTMATTER } from '../lib/schema.js';
import { isManagedSkill } from '../lib/wrapper.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skillsRoot = resolve(root, '.claude', 'skills');
const EXPECTED = ['eval', 'eval-report', 'list-skills', 'search-skills', 'skill-info', 'skill-status', 'sync-skills', 'terum-skills'];

/** The four rules every shipped skill carries, verbatim (spec §9 item 4). */
const RULES = `## Rules

- No TTY: never pipe \`y\`, never drive the CLI with \`expect\`, never add \`--frames\` to dodge a question. A question the CLI asks means the verb belongs in a terminal: say so and hand over the command.
- Never use the skill-file \`\` !\`command\` \`\` injection; run every command with your shell tool and read its output.
- Do not \`cd\`; run from the current working directory and pass absolute paths.
- Exit 1 is a result, not a retry: show the failure block, do not re-run, and do not claim earlier steps were rolled back.
`;
/** The Codex sandbox rule (spec §9 item 5), verbatim; Task 10 of the plan verified --prefer-offline before this shipped. */
const SANDBOX = `## Sandbox

When \`CODEX_SANDBOX_NETWORK_DISABLED=1\` is set and the command starts with \`npx\`, add \`--prefer-offline\` after \`npx\` so a cached package resolves without the registry; if npx still reports a network error, ask the user to run the command in a terminal. In that sandbox the verbs that need the network — \`sync\`, \`install\`, \`publish\`, \`invite\`, \`eval\`, and \`update\`'s release probe — are handed to a terminal with the reason.
`;
/** Host-specific tool names a one-file-both-hosts skill must never use (spec D13). */
const HOST_TOOLS = /Bash\(|AskUserQuestion|request_user_input|run_in_background/;
/** A bare binary, a checkout entry, or the built entry: never an invocation form (spec §9 item 1). */
const FORBIDDEN_INVOCATIONS = /node dist\/index\.js|`terum-skills [a-z-]+/;
const COMMAND = /npx (?:--prefer-offline )?-y terum-skills@latest ([^\n`]+)/g;
const TERMINAL = { isTTY: false, colorCapable: false };

interface Skill { name: string; raw: string; frontmatter: string; parsed: Record<string, unknown>; body: string }

async function shipped(): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let raw: string;
    try { raw = await readFile(resolve(skillsRoot, entry.name, 'SKILL.md'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    if (!isManagedSkill(raw)) continue;
    const match = FRONTMATTER.exec(raw)!;
    skills.push({ name: entry.name, raw, frontmatter: match[1]!, parsed: YAML.parse(match[1]!) as Record<string, unknown>, body: raw.slice(match[0].length) });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether `tokens` starts with a command registered on the CLI (one or two levels: `ls`, `ls skill`, `team project create`). */
function registered(program: Command, tokens: string[]): boolean {
  let commands = program.commands;
  let depth = 0;
  for (const token of tokens) {
    const found = commands.find((command) => command.name() === token);
    if (!found) return depth > 0;
    commands = found.commands; depth += 1;
    if (!commands.length) return true;
  }
  return depth > 0;
}

describe('the shipped skills', () => {
  it('are exactly the eight, each marked and named after its folder, with the frontmatter contract', async () => {
    const skills = await shipped();
    expect(skills.map((skill) => skill.name)).toEqual(EXPECTED);
    for (const { name, parsed, frontmatter } of skills) {
      expect(Object.keys(parsed).sort(), name).toEqual(['description', 'metadata', 'name']);
      expect(parsed['name'], name).toBe(name);
      expect(frontmatter, `${name}: description must be a quoted scalar`).toMatch(/^description: "/m);
      const description = parsed['description'];
      expect(typeof description === 'string' && description.trim().length > 0, name).toBe(true);
      expect([...(description as string)].length, `${name}: Claude Code caps description at 1024 characters`).toBeLessThanOrEqual(1024);
      const metadata = parsed['metadata'] as Record<string, unknown>;
      expect(Object.keys(metadata).sort(), name).toEqual(['managed-by', 'short-description']);
      const short = metadata['short-description'];
      expect(typeof short === 'string' && short.trim().length > 0, name).toBe(true);
      expect([...(short as string)].length, `${name}: short-description is meant to be short`).toBeLessThanOrEqual(100);
    }
  });

  it('carry the Rules and Sandbox blocks verbatim, Rules first, and $ARGUMENTS exactly once', async () => {
    for (const { name, body } of await shipped()) {
      expect(body, name).toContain(RULES);
      expect(body, name).toContain(SANDBOX);
      const offline = body.match(/When \`CODEX_SANDBOX_NETWORK_DISABLED=1\`[^\n]*/g) ?? [];
      expect(offline.length, name).toBe(1);
      expect(body.indexOf(RULES), name).toBeLessThan(body.indexOf(SANDBOX));
      expect(body.split('$ARGUMENTS').length - 1, name).toBe(1);
      expect(body, name).toContain('Arguments: everything after the command (in Claude Code this arrives as "$ARGUMENTS")');
    }
  });

  it('never name a host-specific tool, a bare binary, a checkout entry, or node dist/index.js', async () => {
    for (const { name, body } of await shipped()) {
      expect(body, name).not.toMatch(HOST_TOOLS);
      expect(body, name).not.toMatch(FORBIDDEN_INVOCATIONS);
    }
  });

  it('every npx command names a registered verb, and every --format md command parses through the pre-parser', async () => {
    const program = buildProgram(async () => {});
    for (const { name, body } of await shipped()) {
      const commands = [...body.matchAll(COMMAND)].map((match) => match[1]!.trim());
      expect(commands.length, name).toBeGreaterThan(0);
      for (const command of commands) {
        const tokens = command.split(/\s+/);
        if (tokens[0] === '…') continue; // the Sandbox block's elided example
        expect(registered(program, tokens.slice(0, 3)), `${name}: ${command}`).toBe(true);
        if (!tokens.includes('--format')) continue;
        const parsed = parseRenderOptions(tokens, {}, TERMINAL);
        expect(parsed.ok, `${name}: ${command}`).toBe(true);
        if (parsed.ok) expect(parsed.options.format, `${name}: ${command}`).toBe('md');
      }
    }
  });

  it('the named skills run --format md; the manual invokes --format md for its runnable verbs', async () => {
    for (const { name, body } of await shipped()) {
      const commands = [...body.matchAll(COMMAND)].map((match) => match[1]!.trim()).filter((command) => !command.startsWith('…'));
      if (name === 'terum-skills') { expect(commands.some((command) => command.includes('--format md')), name).toBe(true); continue; }
      for (const command of commands) expect(command, `${name}: ${command}`).toContain('--format md');
    }
  });
});
