import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRunError, Transcript, preflight, systemAgent } from '../agent.js';

let scratch: string;
const saved = process.env['TERUM_SKILLS_AGENT_CMD'];

beforeEach(async () => { scratch = await mkdtemp(join(tmpdir(), 'agent-')); });
afterEach(() => {
  if (saved === undefined) delete process.env['TERUM_SKILLS_AGENT_CMD'];
  else process.env['TERUM_SKILLS_AGENT_CMD'] = saved;
});

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

describe('runAgent through a stub binary (§7.1)', () => {
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
});

describe('askJson through a stub binary (§7.2 / §7.5)', () => {
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

  it('records the CLI version and runs one smoke task', async () => {
    await stub(`case "$1" in --version) echo "2.34.0 (stub)";; *) printf '%s' '{"type":"result","result":"ok"}';; esac`);
    const outcome = await preflight();
    expect(outcome).toMatchObject({ ok: true, value: { ccVersion: '2.34.0 (stub)' } });
  });

  it('reports a failing smoke task as a login/model problem, before paid work', async () => {
    await stub(`case "$1" in --version) echo "2.34.0";; *) echo "Not logged in" >&2; exit 1;; esac`);
    const outcome = await preflight();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('logged in');
  });
});
