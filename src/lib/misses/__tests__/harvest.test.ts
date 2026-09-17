import { describe, expect, it } from 'vitest';
import { CONTEXT_CHAR_CAP, CONTEXT_EXCHANGES, harvestTranscript } from '../harvest.js';

const user = (text: string, ts: string, entrypoint = 'cli'): string => JSON.stringify({
  type: 'user', entrypoint, timestamp: ts, message: { content: text },
});
const typed = (skill: string, ts: string): string => JSON.stringify({
  type: 'user', entrypoint: 'cli', timestamp: ts, message: { content: `<command-name>/${skill}</command-name>` },
});
const fired = (skill: string, ts: string): string => JSON.stringify({
  type: 'assistant', entrypoint: 'cli', timestamp: ts, message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] },
});
const says = (text: string, ts: string): string => JSON.stringify({
  type: 'assistant', entrypoint: 'cli', timestamp: ts, message: { content: [{ type: 'text', text }] },
});
const toolResult = (ts: string): string => JSON.stringify({
  type: 'user', entrypoint: 'cli', timestamp: ts, message: { content: [{ type: 'tool_result', content: 'ok' }] },
});
const at = (n: number): string => `2026-09-0${n}T00:00:00.000Z`;

describe('harvest — what is a judgeable prompt', () => {
  it('harvests a plain user message', () => {
    const [prompt] = harvestTranscript(user('help me settle these forks', at(1)));
    expect(prompt!.text).toBe('help me settle these forks');
    expect(prompt!.ts).toBe(at(1));
  });

  it('does not harvest a command-name envelope as a prompt, but DOES keep it as a D2 observation', () => {
    // The whole reason this module exists: parent §2.3 — an explicit firing writes no Skill record,
    // so the envelope is the only evidence it happened.
    const out = harvestTranscript([user('settle the forks', at(1)), typed('decision-walk', at(2))].join('\n'));
    expect(out).toHaveLength(1);
    expect(out[0]!.observations).toEqual([{ skill: 'decision-walk', kind: 'D2' }]);
  });

  it('drops a builtin slash command — it is neither a prompt nor a firing', () => {
    const out = harvestTranscript([user('go on', at(1)), typed('clear', at(2))].join('\n'));
    expect(out[0]!.observations).toEqual([]);
  });

  it('does NOT harvest an injected skill body as a prompt — the self-referential false positive', () => {
    // When a slash command runs, the skill's own body is injected as a type:'user' record. Harvested,
    // /codex-spec becomes the prompt "Base directory for this skill: .../codex-spec" and the screener
    // reports codex-spec never fired, about the text of codex-spec firing. Measured on real data.
    const injected = JSON.stringify({
      type: 'user', entrypoint: 'cli', isMeta: true, timestamp: at(2),
      message: { content: 'Base directory for this skill: /Users/me/.claude/skills/codex-spec\n\nAudit a spec.' },
    });
    const out = harvestTranscript([user('real question', at(1)), injected].join('\n'));
    expect(out.map((p) => p.text)).toEqual(['real question']);
  });

  it('does not harvest a harness task-notification, which carries promptSource like a real prompt', () => {
    const notif = JSON.stringify({
      type: 'user', entrypoint: 'cli', promptSource: 'user', timestamp: at(2),
      message: { content: '<task-notification>\n<task-id>abc</task-id>\n</task-notification>' },
    });
    const out = harvestTranscript([user('real question', at(1)), notif].join('\n'));
    expect(out.map((p) => p.text)).toEqual(['real question']);
  });

  it('strips a system-reminder from the judged text without dropping the prompt', () => {
    const line = JSON.stringify({
      type: 'user', entrypoint: 'cli', timestamp: at(1),
      message: { content: 'what should I do<system-reminder>secret harness context</system-reminder>' },
    });
    const [prompt] = harvestTranscript(line);
    expect(prompt!.text).toBe('what should I do');
    expect(prompt!.text).not.toContain('secret harness context');
  });

  it('drops a record that is nothing but a system-reminder', () => {
    const line = JSON.stringify({
      type: 'user', entrypoint: 'cli', timestamp: at(1),
      message: { content: '<system-reminder>just context</system-reminder>' },
    });
    expect(harvestTranscript(line)).toEqual([]);
  });

  it('excludes sdk-cli — every eval sandbox, every subagent, and this feature own judge calls', () => {
    expect(harvestTranscript(user('judge this', at(1), 'sdk-cli'))).toEqual([]);
  });

  it('excludes a sidechain record even when it claims cli', () => {
    const line = JSON.stringify({ type: 'user', entrypoint: 'cli', isSidechain: true, timestamp: at(1), message: { content: 'x' } });
    expect(harvestTranscript(line)).toEqual([]);
  });

  it('does not let a tool_result record open a turn', () => {
    const out = harvestTranscript([user('do the thing', at(1)), toolResult(at(2))].join('\n'));
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('do the thing');
  });

  it('ignores a record with no timestamp rather than inventing one', () => {
    const line = JSON.stringify({ type: 'user', entrypoint: 'cli', message: { content: 'x' } });
    expect(harvestTranscript(line)).toEqual([]);
  });

  it('skips a malformed line without losing the records around it', () => {
    const out = harvestTranscript([user('first', at(1)), '{not json', user('second', at(2))].join('\n'));
    expect(out.map((p) => p.text)).toEqual(['first', 'second']);
  });

  it('skips a truncated final line, the expected shape of a transcript being appended to', () => {
    const out = harvestTranscript([user('first', at(1)), '{"type":"user","entry'].join('\n'));
    expect(out.map((p) => p.text)).toEqual(['first']);
  });
});

describe('harvest — the association window', () => {
  it('attaches a Skill call in the prompt own turn', () => {
    const out = harvestTranscript([user('audit the spec', at(1)), fired('codex-spec', at(2))].join('\n'));
    expect(out[0]!.observations).toEqual([{ skill: 'codex-spec', kind: 'D1' }]);
  });

  it('does NOT attach a Skill call from the next turn — the rule the spec exists to pin', () => {
    const out = harvestTranscript([
      user('first ask', at(1)),
      user('second ask', at(2)),
      fired('codex-spec', at(3)),
    ].join('\n'));
    expect(out[0]!.observations).toEqual([]);
    expect(out[1]!.observations).toEqual([{ skill: 'codex-spec', kind: 'D1' }]);
  });

  it('keeps two prompts interleaved with tool_result records in distinct windows', () => {
    const out = harvestTranscript([
      user('one', at(1)), toolResult(at(1)), fired('alpha', at(1)),
      user('two', at(2)), toolResult(at(2)), fired('beta', at(2)),
    ].join('\n'));
    expect(out[0]!.observations).toEqual([{ skill: 'alpha', kind: 'D1' }]);
    expect(out[1]!.observations).toEqual([{ skill: 'beta', kind: 'D1' }]);
  });

  it('drops an orphan envelope with no open turn — a real firing with no prompt to judge', () => {
    expect(harvestTranscript(typed('handoff', at(1)))).toEqual([]);
  });
});

describe('harvest — the context window', () => {
  it(`carries exactly ${CONTEXT_EXCHANGES} preceding turns when more exist`, () => {
    const lines = [1, 2, 3, 4, 5].map((n) => user(`ask ${n}`, at(n)));
    const out = harvestTranscript(lines.join('\n'));
    expect(out[4]!.context).toHaveLength(CONTEXT_EXCHANGES);
    expect(out[4]!.context.join(' ')).toContain('ask 4');
    expect(out[4]!.context.join(' ')).not.toContain('ask 1');
  });

  it('carries fewer than three without an error, and that is not the no-prior-context case', () => {
    const out = harvestTranscript([user('one', at(1)), user('two', at(2))].join('\n'));
    expect(out[1]!.context).toHaveLength(1);
    expect(out[1]!.noPriorContext).toBe(false);
  });

  it('marks the first message in a session as no prior context', () => {
    expect(harvestTranscript(user('opening line', at(1)))[0]!.noPriorContext).toBe(true);
  });

  it('truncates an over-long turn from the HEAD, keeping the tail the prompt refers back to', () => {
    const long = `${'x'.repeat(CONTEXT_CHAR_CAP * 2)}THE-REFERENT`;
    const out = harvestTranscript([user(long, at(1)), user('ok do that', at(2))].join('\n'));
    const context = out[1]!.context[0]!;
    expect(context).toContain('THE-REFERENT');
    expect(context.startsWith('…')).toBe(true);
    expect(context.length).toBeLessThanOrEqual(CONTEXT_CHAR_CAP + 1);
  });

  it('includes assistant prose in the window but never tool_use inputs', () => {
    const out = harvestTranscript([
      user('what should I do', at(1)), says('I suggest the walk', at(1)), fired('decision-walk', at(1)),
      user('ok do that', at(2)),
    ].join('\n'));
    expect(out[1]!.context[0]).toContain('I suggest the walk');
    expect(out[1]!.context[0]).not.toContain('decision-walk');
  });
});
