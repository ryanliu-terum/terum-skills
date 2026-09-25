import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARGV_PROMPT_LIMIT, AgentRunError, Transcript, preflight, systemAgent } from '../agent.js';

let scratch: string;
const saved = process.env['TERUM_SKILLS_AGENT_CMD'];

beforeEach(async () => { scratch = await mkdtemp(join(tmpdir(), 'agent-')); });
afterEach(() => {
  if (saved === undefined) delete process.env['TERUM_SKILLS_AGENT_CMD'];
  else process.env['TERUM_SKILLS_AGENT_CMD'] = saved;
});

// The stub below is a `/bin/sh` script run by its shebang. Windows cannot launch one (spawn EFTYPE; the
// resolver only launches .exe/.cmd/.bat/.com), so every test that spawns the stub is POSIX-only here.
const POSIX = process.platform !== 'win32';

/** §3: the binary name comes from TERUM_SKILLS_AGENT_CMD so tests never spawn the real `claude`. */
async function stub(script: string): Promise<void> {
  const path = join(scratch, 'stub.sh');
  await writeFile(path, `#!/bin/sh\n${script}\n`);
  await chmod(path, 0o755);
  process.env['TERUM_SKILLS_AGENT_CMD'] = path;
}

const STREAM = [
  '{"type":"system","subtype":"init","skills":["deploy-preflight"]}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"},{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}',
  'not json — skipped, never fatal',
  '{"type":"result","result":"done","num_turns":4,"duration_ms":9400,"total_cost_usd":0.12}',
].join('\n');

describe('Transcript parsing (port of runner.py)', () => {
  it('collects text and tool_use blocks, bash commands, the result, efficiency, and the init skill list', () => {
    const transcript = Transcript.fromStream(STREAM);
    expect(transcript.bashCommands()).toEqual(['npm test']);
    expect(transcript.toolUses()).toEqual(['Bash']);
    expect(transcript.allText()).toContain('hello');
    expect(transcript.allText()).toContain('done');
    expect(transcript.allText()).toContain('npm test'); // tool inputs are searchable text
    expect(transcript.efficiency()).toEqual({ turns: 4, duration_ms: 9400, cost_usd: 0.12 });
    expect(transcript.skillList()).toEqual(['deploy-preflight']);
  });

  it('skillList is null when the init event lacks the field (VE1 pending)', () => {
    expect(Transcript.fromStream('{"type":"system","subtype":"init"}').skillList()).toBeNull();
    expect(Transcript.fromStream('').skillList()).toBeNull();
    expect(Transcript.fromStream('{"type":"result"}').efficiency()).toEqual({ turns: null, duration_ms: null, cost_usd: null });
  });
});

describe.skipIf(!POSIX)('runAgent through a stub binary (§7.1)', () => {
  it('parses the stream and persists the transcript', async () => {
    await stub(`cat <<'EOF'\n${STREAM}\nEOF`);
    const transcriptPath = join(scratch, 'out.jsonl');
    const transcript = await systemAgent.runAgent('task', scratch, { transcriptPath });
    expect(transcript.bashCommands()).toEqual(['npm test']);
    expect(await readFile(transcriptPath, 'utf8')).toContain('"num_turns":4');
  });

  it('nonzero exit with empty stdout raises AgentRunError', async () => {
    await stub('echo "broken pipe" >&2; exit 7');
    await expect(systemAgent.runAgent('task', scratch)).rejects.toThrow(AgentRunError);
    await expect(systemAgent.runAgent('task', scratch)).rejects.toThrow(/rc=7.*broken pipe/s);
  });

  it('nonzero exit with partial stream-json still raises AgentRunError (§17.8)', async () => {
    await stub(`printf '%s\\n' '${STREAM.split('\n')[0]}' >&1; echo broken >&2; exit 7`);
    await expect(systemAgent.runAgent('task', scratch)).rejects.toThrow(AgentRunError);
  });
});

describe.skipIf(!POSIX)('askJson through a stub binary (§7.2 / §7.5)', () => {
  it('unwraps the outer result envelope and extracts the first JSON object', async () => {
    await stub(`printf '%s' '{"type":"result","result":"Sure: {\\"selected\\": [\\"deploy-preflight\\"]}"}'`);
    expect(await systemAgent.askJson('which skills?')).toEqual({ selected: ['deploy-preflight'] });
  });

  it('no JSON in the reply raises AgentRunError carrying the text (refusals surface upstream)', async () => {
    await stub(`printf '%s' '{"type":"result","result":"I cannot help with that due to usage policy."}'`);
    await expect(systemAgent.askJson('judge')).rejects.toThrow(/did not return JSON.*usage policy/s);
  });

  it('nonzero exit raises AgentRunError', async () => {
    await stub('exit 3');
    await expect(systemAgent.askJson('judge')).rejects.toThrow(AgentRunError);
  });
});

describe('preflight (§7.4, VE7-adjacent)', () => {
  it('fails fast and clearly when the binary is missing', async () => {
    process.env['TERUM_SKILLS_AGENT_CMD'] = join(scratch, 'no-such-binary');
    const outcome = await preflight();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('not runnable');
  });

  it.skipIf(!POSIX)('records the CLI version and runs one smoke task', async () => {
    await stub(`case "$1" in --version) echo "2.34.0 (stub)";; *) printf '%s' '{"type":"result","result":"ok"}';; esac`);
    const outcome = await preflight();
    expect(outcome).toMatchObject({ ok: true, value: { ccVersion: '2.34.0 (stub)' } });
  });

  it.skipIf(!POSIX)('reports a failing smoke task as a login/model problem, before paid work', async () => {
    await stub(`case "$1" in --version) echo "2.34.0";; *) echo "Not logged in" >&2; exit 1;; esac`);
    const outcome = await preflight();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('logged in');
  });
});

/**
 * A Node stub that records its argv and stdin, so these run on Windows too, where the bug was: a
 * `.cmd` shim naming `%~dp0\stub.cjs` resolves to the current Node (agent-command.ts); a POSIX
 * script execs the same file.
 */
async function recorder(): Promise<{ argv(): Promise<string[]>; stdin(): Promise<string> }> {
  const script = join(scratch, 'stub.cjs');
  await writeFile(script, [
    "const fs = require('node:fs'), path = require('node:path');",
    "fs.writeFileSync(path.join(__dirname, 'argv.json'), JSON.stringify(process.argv.slice(2)));",
    "let input = ''; process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => { fs.writeFileSync(path.join(__dirname, 'stdin.txt'), input, 'utf8'); process.stdout.write(JSON.stringify({ type: 'result', result: '{\"ok\": true}' })); });",
  ].join('\n'));
  let launcher: string;
  if (process.platform === 'win32') {
    launcher = join(scratch, 'stub.cmd');
    await writeFile(launcher, '@node "%~dp0\\stub.cjs" %*\r\n');
  } else {
    launcher = join(scratch, 'stub.sh');
    await writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    await chmod(launcher, 0o755);
  }
  process.env['TERUM_SKILLS_AGENT_CMD'] = launcher;
  return {
    argv: async () => JSON.parse(await readFile(join(scratch, 'argv.json'), 'utf8')) as string[],
    stdin: () => readFile(join(scratch, 'stdin.txt'), 'utf8'),
  };
}

describe('a prompt past ARGV_PROMPT_LIMIT goes to claude -p on stdin (Windows spawn ENAMETOOLONG)', () => {
  // Quotes, newlines and a non-ASCII letter: the stdin path must carry the prompt byte for byte.
  const long = 'Skill text with "quotes", ünïcode and\nnewlines. '.repeat(Math.ceil((ARGV_PROMPT_LIMIT + 1) / 45));

  it('askJson sends a long prompt on stdin and leaves it off argv', async () => {
    const seen = await recorder();
    expect(await systemAgent.askJson(long)).toEqual({ ok: true });
    const argv = await seen.argv();
    expect(argv.slice(0, 2)).toEqual(['-p', '--output-format']);
    expect(argv).not.toContain(long);
    expect(await seen.stdin()).toBe(long);
  });

  it('askJson keeps a short prompt on argv, with nothing on stdin', async () => {
    const seen = await recorder();
    expect(await systemAgent.askJson('classify')).toEqual({ ok: true });
    expect((await seen.argv()).slice(0, 2)).toEqual(['-p', 'classify']);
    expect(await seen.stdin()).toBe('');
  });

  it('runAgent sends a long task on stdin', async () => {
    const seen = await recorder();
    await systemAgent.runAgent(long, scratch);
    expect((await seen.argv()).slice(0, 2)).toEqual(['-p', '--output-format']);
    expect(await seen.stdin()).toBe(long);
  });
});

// B9: assert the actual spawn argv, including an explicit empty argument.
it.skipIf(!POSIX).each([undefined, '', 'user'])('askJson settingSources %j reaches the binary (default project)', async settingSources => {
  const captured = join(scratch, 'argv.txt');
  await stub(`printf '%s\\n' "$@" > '${captured}'; printf '%s' '{"category":"review"}'`);
  await systemAgent.askJson('classify', { settingSources });
  const argv = (await readFile(captured, 'utf8')).split('\n');
  expect(argv[argv.indexOf('--setting-sources') + 1]).toBe(settingSources ?? 'project');
});
