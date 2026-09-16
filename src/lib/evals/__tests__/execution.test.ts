import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentRunError, AgentTimeoutError, Transcript, type AgentApi } from '../agent.js';
import { casePathViolation, ContaminationError, decide, dryRunCase, loadCase, loadSuite, missingRequirements, runCase, runSuite, seedSandbox, type EvalCase, type EvalSuite } from '../execution.js';

let scratch: string;
beforeEach(async () => { scratch = await mkdtemp(join(tmpdir(), 'exec-')); });

const caseOf = (extra: Partial<EvalCase> = {}): EvalCase => ({ name: 'c', task: 'do the thing', files: {}, checks: [], requires: [], ...extra });

const transcriptWith = (text: string, extras: Record<string, unknown>[] = []): Transcript =>
  Transcript.fromStream([
    ...extras.map((event) => JSON.stringify(event)),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    JSON.stringify({ type: 'result', result: 'done', num_turns: 4, duration_ms: 9400, total_cost_usd: 0.12 }),
  ].join('\n'));

describe('case loading (§5.1)', () => {
  it('requires task, validates bucket, defaults checks and files', () => {
    expect(loadCase('task: do it\n', 'a')).toMatchObject({ ok: true, value: { name: 'a', task: 'do it', checks: [], files: {} } });
    expect(loadCase('', 'a').ok).toBe(false);
    expect(loadCase('task: x\nbucket: adversarial\n', 'a')).toMatchObject({ ok: true, value: { bucket: 'adversarial' } });
    expect(loadCase('task: x\nbucket: sneaky\n', 'a').ok).toBe(false);
    expect(loadCase('task: x\nfiles: [nope]\n', 'a').ok).toBe(false);
    expect(loadCase('task: x\nchecks:\n  - file_exists: out.txt\n', 'a')).toMatchObject({ ok: true, value: { checks: [{ file_exists: 'out.txt' }] } });
  });
});

describe('suite loading (§3.2)', () => {
  const source = `task: review\nfixture: ../fixtures/repo\nfiles:\n  src/a.ts: export const a = 1\nsetup: touch ready\nrequires: [sh]\ntimeout_minutes: 12\nmax_turns: 40\ncases:\n  - name: defect-a\n    checks: [{ transcript_mentions: defectA }]\n  - name: distractor\n    checks: [{ transcript_omits: correctThing }]\n`;

  it('uses case parsing for shared fields and preserves independently run checks', () => {
    expect(loadSuite(source, 'suite')).toMatchObject({ ok: true, value: {
      name: 'suite', task: 'review', fixture: '../fixtures/repo', files: { 'src/a.ts': 'export const a = 1' }, setup: 'touch ready', requires: ['sh'], timeout_minutes: 12, max_turns: 40,
      cases: [{ name: 'defect-a', checks: [{ transcript_mentions: 'defectA' }] }, { name: 'distractor', checks: [{ transcript_omits: 'correctThing' }] }],
    } });
  });

  it('rejects no sub-cases, duplicate names, and forbidden sub-case fields', () => {
    expect(loadSuite('task: x\ncases: []\n', 'suite')).toMatchObject({ ok: false, error: expect.stringContaining("non-empty 'cases'") });
    expect(loadSuite('task: x\ncases:\n  - name: same\n    checks: []\n  - name: same\n    checks: []\n', 'suite')).toMatchObject({ ok: false, error: expect.stringContaining("duplicate sub-case name 'same'") });
    expect(loadSuite('task: x\ncases:\n  - name: bad\n    judge: no\n    checks: []\n', 'suite')).toMatchObject({ ok: false, error: expect.stringContaining("must not carry 'judge'") });
  });

  it('leaves unknown check kinds for run-time failure just as ordinary cases do', () => {
    expect(loadSuite('task: x\ncases:\n  - name: unknown\n    checks: [{ invented_check: no }]\n', 'suite')).toMatchObject({ ok: true });
  });
});

describe('environment requirements (§7.1 rev 8)', () => {
  it('parses requires, probes binaries and python modules', async () => {
    expect(loadCase('task: x\nrequires:\n  - ffmpeg\n  - python3:openpyxl\n', 'a')).toMatchObject({ ok: true, value: { requires: ['ffmpeg', 'python3:openpyxl'] } });
    expect(await missingRequirements(['sh'])).toEqual([]);
    expect(await missingRequirements(['definitely-not-a-real-binary-xq7'])).toEqual(['definitely-not-a-real-binary-xq7']);
    expect(await missingRequirements(['python3:sys'])).toEqual([]);
    expect(await missingRequirements(['python3:definitely_not_a_module_xq7'])).toEqual(['python3:definitely_not_a_module_xq7']);
  });

  it('a case with missing requirements runs nothing and returns skipped — never a false tie', async () => {
    const untouchable: AgentApi = {
      runAgent: () => { throw new Error('must not run'); },
      askJson: () => { throw new Error('must not run'); },
    };
    const { rows, arms, skipped } = await runCase(
      { agent: untouchable, rng: () => 0.9 },
      caseOf({ requires: ['definitely-not-a-real-binary-xq7'] }),
      { k: 2, skillName: 's', caseDir: scratch, arms: { candidate: scratch }, scratch, transcriptDir: scratch },
    );
    expect(rows).toEqual([]);
    expect(arms).toEqual([]);
    expect(skipped).toEqual(['definitely-not-a-real-binary-xq7']);
  });
});

describe('sandbox seeding (§4.3, strictly in order)', () => {
  it('copies fixtures, writes inline files (.sh → 0755), runs setup, stages the skill without evals/fixtures', async () => {
    const caseDir = join(scratch, 'cases');
    await mkdir(join(caseDir, '..', 'fixtures', 'repo'), { recursive: true });
    await writeFile(join(caseDir, '..', 'fixtures', 'repo', 'seed.txt'), 'from fixture');
    const skillDir = join(scratch, 'skill-src');
    for (const dir of ['references', 'evals', 'fixtures']) await mkdir(join(skillDir, dir), { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# skill');
    await writeFile(join(skillDir, 'references', 'notes.md'), 'ref');
    await writeFile(join(skillDir, 'evals', 'answer-key.yaml'), 'secret');
    await mkdir(caseDir, { recursive: true });

    const evalCase = caseOf({
      fixture: '../fixtures/repo',
      files: { 'src/app.ts': 'code', 'scripts/run.sh': 'echo hi' },
      setup: 'test -f seed.txt && touch setup-ran.marker',
    });
    const sandbox = await seedSandbox(evalCase, { caseDir, skillName: 'deploy-preflight', skillDir, scratch });

    expect(existsSync(join(sandbox, 'seed.txt'))).toBe(true);
    expect(existsSync(join(sandbox, 'src', 'app.ts'))).toBe(true);
    expect(((await stat(join(sandbox, 'scripts', 'run.sh'))).mode & 0o755)).toBe(0o755);
    expect(existsSync(join(sandbox, 'setup-ran.marker'))).toBe(true);
    const staged = join(sandbox, '.claude', 'skills', 'deploy-preflight');
    expect(existsSync(join(staged, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(staged, 'references', 'notes.md'))).toBe(true);
    expect(existsSync(join(staged, 'evals'))).toBe(false); // the skill must not see its own answer key
    expect(existsSync(join(staged, 'fixtures'))).toBe(false);
  });

  it('baseline stages nothing; unsafe paths and failing setup abort the case', async () => {
    const sandbox = await seedSandbox(caseOf(), { caseDir: scratch, skillName: 's', skillDir: null, scratch });
    expect(existsSync(join(sandbox, '.claude'))).toBe(false);
    await expect(seedSandbox(caseOf({ files: { '../evil.txt': 'x' } }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('unsafe file path');
    await expect(seedSandbox(caseOf({ files: { '/etc/evil': 'x' } }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('unsafe file path');
    await expect(seedSandbox(caseOf({ setup: 'exit 3' }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('setup failed');
    await expect(seedSandbox(caseOf({ fixture: 'no-such-dir' }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('fixture dir not found');
  });

  it('case files cannot seed project settings: a leading .claude segment is rejected', async () => {
    // --setting-sources project loads sandbox-root .claude/, so a generated case writing there
    // could install model-authored hooks that execute on the host. Only skill staging may.
    await expect(seedSandbox(caseOf({ files: { '.claude/settings.json': '{"hooks":{}}' } }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('unsafe file path');
    await expect(seedSandbox(caseOf({ files: { './.claude/hooks/h.sh': 'x' } }), { caseDir: scratch, skillName: 's', skillDir: null, scratch })).rejects.toThrow('unsafe file path');
    // Non-root .claude directories are ordinary fixture content and stay allowed.
    const sandbox = await seedSandbox(caseOf({ files: { 'docs/.claude/note.md': 'x' } }), { caseDir: scratch, skillName: 's', skillDir: null, scratch });
    expect(existsSync(join(sandbox, 'docs', '.claude', 'note.md'))).toBe(true);
  });

  it('D2: one shared path predicate — the same reasons seedSandbox throws, as data for the generator', () => {
    expect(casePathViolation('/etc/evil')).toBe('unsafe file path in case: /etc/evil');
    expect(casePathViolation('a/../b')).toBe('unsafe file path in case: a/../b');
    expect(casePathViolation('./.claude/settings.json')).toBe('unsafe file path in case (seeds .claude): ./.claude/settings.json');
    expect(casePathViolation('docs/.claude/note.md')).toBeNull();
    expect(casePathViolation('bin/codex')).toBeNull();
  });

  it('D1/D3: a bin/ stub is made executable so a setup that calls it can start', async () => {
    const sandbox = await seedSandbox(caseOf({ files: { 'bin/codex': '#!/bin/sh\necho ok\n' }, setup: './bin/codex > out.txt' }), { caseDir: scratch, skillName: 's', skillDir: null, scratch });
    expect((await stat(join(sandbox, 'bin', 'codex'))).mode & 0o111).toBeTruthy();
    expect(await readFile(join(sandbox, 'out.txt'), 'utf8')).toBe('ok\n');
  });

  it('D3: dryRunCase reports the run-time abort message for a case that cannot start, and leaves nothing behind', async () => {
    expect(await dryRunCase(caseOf({ setup: 'touch ok.txt' }), scratch)).toBeNull();
    expect(await dryRunCase(caseOf({ setup: 'Assume codex is logged in.' }), scratch)).toMatch(/^case 'c': setup failed \(rc=127\): .*Assume.*not found/s);
    expect(await dryRunCase(caseOf({ files: { '/tmp/x': 'x' } }), scratch)).toBe("case 'c': unsafe file path in case: /tmp/x");
    expect((await readdir(scratch)).filter((entry) => entry.startsWith('dry-'))).toEqual([]);
  });
});

describe('cases that never start (eval-gen D4)', () => {
  const untouchable: AgentApi = {
    runAgent: () => { throw new Error('must not run'); },
    askJson: () => { throw new Error('must not run'); },
  };
  const options = () => ({ k: 1, skillName: 's', caseDir: scratch, arms: { candidate: scratch }, scratch, transcriptDir: scratch });

  it('a failing setup drops the case with kind setup and the shell error, scoring nothing', async () => {
    const lines: string[] = [];
    const out = await runCase({ agent: untouchable, rng: () => 0.5, log: (line) => lines.push(line) }, caseOf({ setup: 'No AGENTS.md exists.' }), options());
    expect(out.rows).toEqual([]);
    expect(out.arms).toEqual([]);
    expect(out.dropped).toMatchObject({ kind: 'setup', detail: expect.stringMatching(/^setup failed \(rc=127\)/) });
    expect(lines[0]).toMatch(/^ {2}c: ABORTED \(setup\) — setup failed/);
  });

  it('an unstageable case drops with kind staging instead of killing the eval', async () => {
    const out = await runCase({ agent: untouchable, rng: () => 0.5 }, caseOf({ files: { '/tmp/scratch/findings.json': '{}' } }), options());
    expect(out).toMatchObject({ rows: [], arms: [], dropped: { kind: 'staging', detail: 'unsafe file path in case: /tmp/scratch/findings.json' } });
    const fixture = await runCase({ agent: untouchable, rng: () => 0.5 }, caseOf({ fixture: 'no-such-dir' }), options());
    expect(fixture.dropped).toMatchObject({ kind: 'staging', detail: expect.stringContaining('fixture dir not found') });
  });
});

describe('row verdicts (§7.1, port of _decide)', () => {
  // Rev 7 double-ask: the stub must be order-consistent (A then B alternating maps to the same
  // side both times under rng 0.9); an always-A stub is position-biased and correctly splits.
  let judgeCalls = 0;
  const deps = { agent: { runAgent: () => Promise.reject(new Error('x')), askJson: () => Promise.resolve({ winner: ++judgeCalls % 2 === 1 ? 'A' : 'B', reason: 'better' }) } as AgentApi, rng: () => 0.9 };
  const passed = [{ name: 'c', passed: true, detail: '' }];
  const failed = [{ name: 'c', passed: false, detail: '' }];
  const t = transcriptWith('hello');

  it('failure ladder first, then checks, then tie or judge', async () => {
    expect(await decide(deps, caseOf(), null, null, [], [])).toMatchObject({ result: 'tie', decidedBy: 'both-arms-failed' });
    expect(await decide(deps, caseOf(), null, t, [], [])).toMatchObject({ result: 'tie', decidedBy: 'candidate-run-failed' });
    expect(await decide(deps, caseOf(), t, null, [], [])).toMatchObject({ result: 'tie', decidedBy: 'opponent-run-failed' });
    expect(await decide(deps, caseOf(), t, t, passed, failed)).toMatchObject({ result: 'win', decidedBy: 'checks' });
    expect(await decide(deps, caseOf(), t, t, failed, passed)).toMatchObject({ result: 'loss', decidedBy: 'checks' });
    expect(await decide(deps, caseOf(), t, t, failed, failed)).toMatchObject({ result: 'tie', decidedBy: 'checks-equal-no-judge' });
    expect(await decide(deps, caseOf({ judge: 'cleaner wins' }), t, t, passed, passed)).toMatchObject({ result: 'win', decidedBy: 'judge', reason: 'better' });
  });

  it('a refusing judge yields a tie labeled judge-refused', async () => {
    const refusing = { ...deps, agent: { ...deps.agent, askJson: () => Promise.reject(new AgentRunError('usage policy')) } };
    expect(await decide(refusing, caseOf({ judge: 'r' }), t, t, [], [])).toMatchObject({ result: 'tie', decidedBy: 'judge-refused' });
  });

  it('records the first A/B ordering on judge-decided rows (§17.5)', async () => {
    let calls = 0;
    const judged = await decide({
      agent: { runAgent: () => Promise.reject(new Error('unused')), askJson: () => Promise.resolve({ winner: ++calls % 2 === 1 ? 'A' : 'B', reason: 'better' }) },
      rng: () => 0.1,
    }, caseOf({ judge: 'cleaner wins' }), t, t, [], []);
    expect(judged).toMatchObject({ result: 'loss', decidedBy: 'judge', swapped: true });
  });
});

describe('suite sessions (§3.3 / §7)', () => {
  const suiteOf = (extra: Partial<EvalSuite> = {}): EvalSuite => ({
    name: 'suite', task: 'review the diff', files: {}, requires: [],
    cases: [
      { name: 'first-defect', checks: [{ transcript_mentions: 'FIRST' }] },
      { name: 'second-defect', checks: [{ transcript_mentions: 'SECOND' }] },
    ],
    ...extra,
  });

  const skillDir = async (): Promise<string> => {
    const path = join(scratch, 'skill');
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'SKILL.md'), '# s');
    return path;
  };

  it('runs one arm session per rep, then gives every sub-case its own fraction and copied efficiency', async () => {
    const skill = await skillDir();
    let calls = 0;
    const agent: AgentApi = {
      runAgent: (_task, cwd) => {
        calls += 1;
        const candidate = existsSync(join(cwd, '.claude', 'skills', 's'));
        return Promise.resolve(transcriptWith(candidate ? 'FIRST' : 'SECOND', [{ type: 'system', subtype: 'init', skills: candidate ? ['s'] : [] }]));
      },
      askJson: () => { throw new Error('suite must not judge'); },
    };
    const out = await runSuite({ agent, rng: () => 0.5 }, suiteOf(), { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skill }, scratch, transcriptDir: scratch });
    expect(calls).toBe(2);
    expect((await readdir(scratch)).filter((name) => name.startsWith('arm-'))).toHaveLength(2);
    expect(out.rows).toHaveLength(2);
    expect(out.rows.map((row) => row.case)).toEqual(['first-defect', 'second-defect']);
    expect(out.rows.every((row) => row.decided_by === 'checks')).toBe(true);
    expect(out.arms.filter((sample) => sample.arm === 'candidate')).toMatchObject([
      { case: 'first-defect', fraction: 1, turns: 4, duration_ms: 9400, cost_usd: 0.12 },
      { case: 'second-defect', fraction: 0, turns: 4, duration_ms: 9400, cost_usd: 0.12 },
    ]);
    await expect(stat(join(scratch, 'suite.candidate.0.jsonl'))).rejects.toThrow(); // stub does not write transcripts
  });

  it('makes a dead candidate unscored for every sub-case and repeats failed samples', async () => {
    const skill = await skillDir();
    const agent: AgentApi = {
      runAgent: (_task, cwd) => existsSync(join(cwd, '.claude', 'skills', 's'))
        ? Promise.reject(new AgentTimeoutError('cap'))
        : Promise.resolve(transcriptWith('FIRST SECOND', [{ type: 'system', subtype: 'init', skills: [] }])),
      askJson: () => Promise.resolve({}),
    };
    const out = await runSuite({ agent, rng: () => 0.5 }, suiteOf(), { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skill }, scratch, transcriptDir: scratch });
    expect(out.rows).toHaveLength(2);
    expect(out.rows.every((row) => row.decided_by === 'candidate-run-failed' && row.outcome === 'tie')).toBe(true);
    expect(out.arms.filter((sample) => sample.arm === 'candidate')).toMatchObject([{ failed: true, fraction: 0 }, { failed: true, fraction: 0 }]);
  });

  it('retries a crash using the suite transcript stem and preserves its first attempt', async () => {
    const skill = await skillDir();
    let candidateCalls = 0;
    const agent: AgentApi = {
      runAgent: async (_task, cwd, options) => {
        const candidate = existsSync(join(cwd, '.claude', 'skills', 's'));
        if (candidate && candidateCalls++ === 0) {
          await writeFile(options!.transcriptPath!, 'first attempt');
          throw new AgentRunError('flake');
        }
        await writeFile(options!.transcriptPath!, 'success');
        return transcriptWith('FIRST SECOND', [{ type: 'system', subtype: 'init', skills: candidate ? ['s'] : [] }]);
      },
      askJson: () => Promise.resolve({}),
    };
    const out = await runSuite({ agent, rng: () => 0.5 }, suiteOf(), { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skill }, scratch, transcriptDir: scratch });
    expect(out.arms.filter((sample) => sample.arm === 'candidate').every((sample) => sample.retried)).toBe(true);
    await expect(readFile(join(scratch, 'suite.candidate.0.attempt-1.jsonl'), 'utf8')).resolves.toBe('first attempt');
    await expect(readFile(join(scratch, 'suite.candidate.0.jsonl'), 'utf8')).resolves.toBe('success');
  });

  it('keeps the contamination refusal on suite sessions', async () => {
    const skill = await skillDir();
    const agent: AgentApi = { runAgent: () => Promise.resolve(transcriptWith('FIRST SECOND')), askJson: () => Promise.resolve({}) };
    await expect(runSuite({ agent, rng: () => 0.5 }, suiteOf(), { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skill }, scratch, transcriptDir: scratch })).rejects.toThrow(ContaminationError);
  });

  it('fails an unknown suite check at run time rather than rejecting the suite asset', async () => {
    const skill = await skillDir();
    const agent: AgentApi = {
      runAgent: (_task, cwd) => Promise.resolve(transcriptWith('anything', [{ type: 'system', subtype: 'init', skills: existsSync(join(cwd, '.claude', 'skills', 's')) ? ['s'] : [] }])),
      askJson: () => Promise.resolve({}),
    };
    const out = await runSuite({ agent, rng: () => 0.5 }, suiteOf({ cases: [{ name: 'unknown', checks: [{ invented_check: 'x' }] }] }), { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skill }, scratch, transcriptDir: scratch });
    expect(out.rows[0]).toMatchObject({ decided_by: 'checks-equal-no-judge', outcome: 'tie' });
    expect(out.rows[0]!.checks_candidate[0]).toMatchObject({ passed: false, detail: expect.stringContaining('unknown check kind') });
  });
});

describe('the three-arm matrix (§7.1 / §7.3)', () => {
  const skillFixture = async (): Promise<string> => {
    const skillDir = join(scratch, 'skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# s');
    return skillDir;
  };

  /** The staged skill is visible in the sandbox, so the fake agent behaves per arm like the real one would. */
  const armAwareAgent = (skillName: string): AgentApi => ({
    runAgent: (_task, cwd) => {
      const withSkill = existsSync(join(cwd, '.claude', 'skills', skillName));
      return Promise.resolve(transcriptWith(withSkill ? 'ran PREFLIGHT before deploy' : 'just deployed', [
        { type: 'system', subtype: 'init', skills: withSkill ? [skillName] : [] },
      ]));
    },
    askJson: () => Promise.resolve({}),
  });

  it('produces k rows per opponent, per-arm samples, and check-decided outcomes', async () => {
    const skillDir = await skillFixture();
    const evalCase = caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] });
    const { rows, arms } = await runCase(
      { agent: armAwareAgent('s'), rng: () => 0.9 },
      evalCase,
      { k: 2, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.comparison === 'candidate-vs-baseline' && row.outcome === 'win' && row.decided_by === 'checks')).toBe(true);
    expect(arms).toHaveLength(4);
    expect(arms.filter((sample) => sample.arm === 'candidate').every((sample) => sample.fraction === 1 && sample.turns === 4 && sample.cost_usd === 0.12)).toBe(true);
    expect(arms.filter((sample) => sample.arm === 'baseline').every((sample) => sample.fraction === 0)).toBe(true);
  });

  it('runs the incumbent arm when a tree is provided', async () => {
    const skillDir = await skillFixture();
    const { rows } = await runCase(
      { agent: armAwareAgent('s'), rng: () => 0.9 },
      caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] }),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir, incumbent: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(rows.map((row) => row.comparison).sort()).toEqual(['candidate-vs-baseline', 'candidate-vs-incumbent']);
  });

  it('a twice-failed arm never aborts the matrix; its row scores against the empty transcript (§7.1)', async () => {
    const skillDir = await skillFixture();
    const flaky: AgentApi = {
      runAgent: (_task, cwd) => (existsSync(join(cwd, '.claude', 'skills', 's'))
        ? Promise.resolve(transcriptWith('ran PREFLIGHT', [{ type: 'system', subtype: 'init', skills: ['s'] }]))
        : Promise.reject(new AgentRunError('agent run timed out'))),
      askJson: () => Promise.resolve({}),
    };
    const { rows, arms } = await runCase(
      { agent: flaky, rng: () => 0.9 },
      caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] }),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(rows[0]).toMatchObject({ outcome: 'tie', decided_by: 'opponent-run-failed' });
    expect(arms.find((sample) => sample.arm === 'baseline')).toMatchObject({ failed: true, retried: true, fraction: 0, turns: null });
  });

  it('a single flake is retried in a fresh sandbox and scores normally (§7.1 rev 7)', async () => {
    const skillDir = await skillFixture();
    const failures = new Map<string, number>();
    // Writes the transcript file before resolving or rejecting, like the real agent (§17.8).
    const flakyOnce: AgentApi = {
      runAgent: async (_task, cwd, options) => {
        const arm = existsSync(join(cwd, '.claude', 'skills', 's')) ? 'candidate' : 'baseline';
        const seen = failures.get(arm) ?? 0;
        failures.set(arm, seen + 1);
        const failing = arm === 'baseline' && seen === 0;
        if (options?.transcriptPath) await writeFile(options.transcriptPath, failing ? 'failed-attempt' : 'success', 'utf8');
        if (failing) throw new AgentRunError('transient');
        return transcriptWith(arm === 'candidate' ? 'ran PREFLIGHT' : 'nope', [
          { type: 'system', subtype: 'init', skills: arm === 'candidate' ? ['s'] : [], model: 'claude-sonnet-5-20260115' },
        ]);
      },
      askJson: () => Promise.resolve({}),
    };
    const { rows, arms } = await runCase(
      { agent: flakyOnce, rng: () => 0.9 },
      caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] }),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(rows[0]).toMatchObject({ outcome: 'win', decided_by: 'checks' });
    expect(arms.find((sample) => sample.arm === 'baseline')).toMatchObject({ failed: false, retried: true, model_id: 'claude-sonnet-5-20260115' });
    expect(arms.find((sample) => sample.arm === 'candidate')).toMatchObject({ retried: false, model_id: 'claude-sonnet-5-20260115' });
    // §17.3: the failed attempt survives under the suffix; the retry holds the canonical §4.2 path.
    await expect(readFile(join(scratch, 'c.baseline.0.attempt-1.jsonl'), 'utf8')).resolves.toBe('failed-attempt');
    await expect(readFile(join(scratch, 'c.baseline.0.jsonl'), 'utf8')).resolves.toBe('success');
  });

  it('does not retry a timeout and passes the case session cap to runAgent', async () => {
    const skillDir = await skillFixture();
    const calls: { arm: string; timeoutMs?: number; maxTurns?: number }[] = [];
    const agent: AgentApi = { runAgent: (_task, cwd, options) => {
      const arm = existsSync(join(cwd, '.claude', 'skills', 's')) ? 'candidate' : 'baseline';
      calls.push({ arm, timeoutMs: options?.timeoutMs, maxTurns: options?.maxTurns });
      return arm === 'candidate' ? Promise.reject(new AgentTimeoutError('cap')) : Promise.resolve(transcriptWith('nope', [{ type: 'system', subtype: 'init', skills: [] }]));
    }, askJson: () => Promise.resolve({}) };
    const out = await runCase({ agent, rng: () => 0.9 }, caseOf({ timeout_minutes: 15, max_turns: 77 }), { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch });
    expect(calls).toContainEqual({ arm: 'candidate', timeoutMs: 900_000, maxTurns: 77 });
    expect(calls.filter((call) => call.arm === 'candidate')).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ outcome: 'tie', decided_by: 'candidate-run-failed' });
    await runCase({ agent, rng: () => 0.9 }, caseOf(), { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch });
    expect(calls).toContainEqual({ arm: 'baseline', timeoutMs: 7_200_000, maxTurns: 200 });
  });

  it('a staged arm that fails both attempts is scored empty, not refused as contamination (§17.7 scope)', async () => {
    const skillDir = await skillFixture();
    const candidateDead: AgentApi = {
      runAgent: (_task, cwd) => (existsSync(join(cwd, '.claude', 'skills', 's'))
        ? Promise.reject(new AgentRunError('agent run timed out'))
        : Promise.resolve(transcriptWith('nope', [{ type: 'system', subtype: 'init', skills: [] }]))),
      askJson: () => Promise.resolve({}),
    };
    const { arms } = await runCase(
      { agent: candidateDead, rng: () => 0.9 },
      caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] }),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(arms.find((sample) => sample.arm === 'candidate')).toMatchObject({ failed: true, retried: true, fraction: 0 });
  });

  // §7.3 rev 6: membership of the skill under eval, not list equality — the real CLI's init
  // event always carries its built-in skills (16 of them on CC 2.1.236).
  const BUILTINS = ['deep-research', 'dataviz', 'code-review', 'loop', 'schedule', 'claude-api'];
  const initAgent = (skillsByArm: (withSkill: boolean) => string[], skillName = 's'): AgentApi => ({
    runAgent: (_task, cwd) => {
      const withSkill = existsSync(join(cwd, '.claude', 'skills', skillName));
      return Promise.resolve(transcriptWith('ran PREFLIGHT', [{ type: 'system', subtype: 'init', skills: skillsByArm(withSkill) }]));
    },
    askJson: () => Promise.resolve({}),
  });

  it('ignores CLI built-in skills in every arm (§7.3)', async () => {
    const skillDir = await skillFixture();
    const { rows } = await runCase(
      { agent: initAgent((withSkill) => (withSkill ? [...BUILTINS, 's'] : BUILTINS)), rng: () => 0.9 },
      caseOf({ checks: [{ transcript_mentions: 'PREFLIGHT' }] }),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses the run when the staged skill is missing from a staged arm (§7.3)', async () => {
    const skillDir = await skillFixture();
    await expect(runCase(
      { agent: initAgent(() => BUILTINS), rng: () => 0.9 },
      caseOf(),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    )).rejects.toThrow(ContaminationError);
  });

  it('refuses a staged arm that omits the init skills list (§17.7)', async () => {
    const skillDir = await skillFixture();
    const missingList: AgentApi = { runAgent: () => Promise.resolve(transcriptWith('ok')), askJson: () => Promise.resolve({}) };
    await expect(runCase(
      { agent: missingList, rng: () => 0.9 }, caseOf(),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    )).rejects.toThrow(ContaminationError);
  });

  it('a failing setup hook aborts this case without throwing (§17.9)', async () => {
    const skillDir = await skillFixture();
    const output = await runCase(
      { agent: armAwareAgent('s'), rng: () => 0.9 }, caseOf({ setup: 'exit 3' }),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    );
    // D4: the hole is named on the way out, so the receipt can say why it is partial.
    expect(output).toEqual({ rows: [], arms: [], dropped: { kind: 'setup', detail: 'setup failed (rc=3): ' } });
  });

  it('refuses the run when the skill under eval leaks into the baseline arm (§7.3)', async () => {
    const skillDir = await skillFixture();
    await expect(runCase(
      { agent: initAgent(() => [...BUILTINS, 's']), rng: () => 0.9 },
      caseOf(),
      { k: 1, skillName: 's', caseDir: scratch, arms: { candidate: skillDir }, scratch, transcriptDir: scratch },
    )).rejects.toThrow(ContaminationError);
  });
});
