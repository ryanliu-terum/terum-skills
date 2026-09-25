import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRunError, Transcript, type AgentApi } from '../agent.js';
import { posixShell } from '../agent-command.js';
import { loadCase, loadSuite } from '../execution.js';
import { BRIEF_MAX, GENERATION_TIMEOUT_MS, casePrompt, checkBriefNeutrality, deriveBrief, generate } from '../generate.js';
import { parseTriggers } from '../triggers.js';

const skill = '---\nname: deploy\ndescription: deploy safely\nlicense: UNLICENSED\nmetadata:\n  id: 11111111-1111-4111-8111-111111111111\n  author: Seed <seed@example.com>\n  terum-category: testing\n---\nDeploy only after checks.';
const validCases = {
  cases: [
    { name: 'happy-path', task: 'Deploy the service safely.', checks: [{ transcript_mentions: 'deployed' }], bucket: 'explicit' },
    { name: 'missing-config', task: 'Inspect configuration before deploying.', checks: [{ no_command_matching: 'deploy --force' }], bucket: 'negative' },
    { name: 'unsafe-request', task: 'Handle an unsafe deployment request.', checks: [{ file_absent: '.env.leaked' }], bucket: 'adversarial' },
  ],
};
const validTriggers = { should_trigger: ['deploy 1', 'deploy 2', 'deploy 3', 'deploy 4', 'deploy 5'], should_not_trigger: ['other 1', 'other 2', 'other 3', 'other 4', 'other 5'] };
const validSuite = {
  suite: {
    task: 'Review the uncommitted diff.',
    files: { 'src/a.js': 'const alpha = 1;\n', 'src/b.js': 'const beta = 2;\n', 'src/c.js': 'const safeThing = 3\n' },
    plants_diff: 'diff --git a/src/a.js b/src/a.js\nindex 4d2f306..420571d 100644\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-const alpha = 1;\n+const alpha = -1;\ndiff --git a/src/b.js b/src/b.js\nindex 1b6f5ad..c29348b 100644\n--- a/src/b.js\n+++ b/src/b.js\n@@ -1 +1 @@\n-const beta = 2;\n+const beta = -2;\ndiff --git a/src/c.js b/src/c.js\nindex 4711eef..4f1de12 100644\n--- a/src/c.js\n+++ b/src/c.js\n@@ -1 +1 @@\n-const safeThing = 3\n+const safeThing = 3;\n',
    probes: {
      alpha: "node -e \"process.exit(require('fs').readFileSync('src/a.js','utf8').includes('alpha = 1') ? 0 : 1)\"",
      beta: "node -e \"process.exit(require('fs').readFileSync('src/b.js','utf8').includes('beta = 2') ? 0 : 1)\"",
    },
    cases: [
      { name: 'wrong-alpha', kind: 'defect', probe: 'alpha', checks: [{ transcript_mentions: 'alpha' }] },
      { name: 'wrong-beta', kind: 'defect', probe: 'beta', checks: [{ transcript_mentions: 'beta' }] },
      { name: 'distractor-safe', kind: 'distractor', checks: [{ transcript_omits: 'safeThing' }] },
    ],
  },
};

function agent(responses: (Record<string, unknown> | Error)[], prompts: string[] = [], options: Record<string, unknown>[] = []): AgentApi {
  return {
    runAgent: async () => new Transcript([], ''),
    askJson: async (prompt, opts) => {
      prompts.push(prompt); options.push({ ...opts });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next as Record<string, unknown>;
    },
  };
}
const at = (now = '2026-09-14T00:00:00Z') => ({ skill, files: ['SKILL.md'], catalog: '', model: 'sonnet', engineVersion: 'test', now: new Date(now), cases: true as const });
const withCase = (extra: Record<string, unknown>) => ({ cases: [{ ...validCases.cases[0]!, ...extra }, validCases.cases[1], validCases.cases[2]] });

// Generation dry-runs every case's setup under the POSIX shell (SETUP_RULE): `/bin/sh`, or Git for
// Windows' `sh.exe` (posixShell). Only a Windows host with neither refuses every case before the code runs.
const POSIX_SHELL = process.platform !== 'win32' || posixShell().file !== '/bin/sh';

describe('eval generation (IE5)', () => {
  it.skipIf(!POSIX_SHELL)('materializes, loads, and dry-runs a valid ground-truth suite with probes and a patch', async () => {
    const result = await generate({ ...at(), agent: agent([validSuite]) });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.suite?.file).toContain('timeout_minutes: 120');
    expect(result.value.suite?.file).toContain('.probes/alpha.sh');
    expect(result.value.suite?.file).toContain('.plants.diff');
    expect(result.value.suite?.file).toContain("git init -q && git add -A -- . ':!.probes' ':!.plants.diff'");
    expect(loadSuite(result.value.suite!.file, 'suite')).toMatchObject({ ok: true, value: { cases: [{ name: 'wrong-alpha' }, { name: 'wrong-beta' }, { name: 'distractor-safe' }] } });
  });

  it.each([
    ['one defect', { ...validSuite, suite: { ...validSuite.suite, cases: [validSuite.suite.cases[0], validSuite.suite.cases[2]] } }, 'between 2 and 6 defect'],
    ['seven defects', { ...validSuite, suite: { ...validSuite.suite, cases: [...Array.from({ length: 7 }, (_v, i) => ({ name: `bad-${i}`, kind: 'defect', probe: 'alpha', checks: [{ transcript_mentions: 'alpha' }] })), validSuite.suite.cases[2]] } }, 'between 2 and 6 defect'],
    ['zero distractors', { ...validSuite, suite: { ...validSuite.suite, cases: validSuite.suite.cases.slice(0, 2) } }, 'exactly 1 distractor'],
    ['two distractors', { ...validSuite, suite: { ...validSuite.suite, cases: [...validSuite.suite.cases, { name: 'another-distractor', kind: 'distractor', checks: [{ transcript_omits: 'beta' }] }] } }, 'exactly 1 distractor'],
    ['unknown probe', { ...validSuite, suite: { ...validSuite.suite, cases: [{ ...validSuite.suite.cases[0], probe: 'missing' }, ...validSuite.suite.cases.slice(1)] } }, 'unknown probe'],
    ['forbidden judge', { ...validSuite, suite: { ...validSuite.suite, judge: 'no' } }, "may not carry 'judge'"],
    ['forbidden setup', { ...validSuite, suite: { ...validSuite.suite, setup: 'true' } }, "may not carry 'setup'"],
    ['forbidden fixture', { ...validSuite, suite: { ...validSuite.suite, fixture: 'elsewhere' } }, "may not carry 'fixture'"],
    ['non-suite check', { ...validSuite, suite: { ...validSuite.suite, cases: [{ ...validSuite.suite.cases[0], checks: [{ command_matching: 'git diff' }] }, ...validSuite.suite.cases.slice(1)] } }, 'outside the suite whitelist'],
    ['empty anchor', { ...validSuite, suite: { ...validSuite.suite, cases: [{ ...validSuite.suite.cases[0], checks: [{ transcript_mentions: '' }] }, ...validSuite.suite.cases.slice(1)] } }, 'non-empty check anchor'],
    ['bad patch', { ...validSuite, suite: { ...validSuite.suite, plants_diff: 'diff --git a/nope b/nope\n--- a/nope\n+++ b/nope\n@@ -1 +1 @@\n-x\n+y\n' } }, 'plants_diff does not apply'],
  ])('corrects suite validation failures: %s', async (_label, reply, message) => {
    const prompts: string[] = [];
    const result = await generate({ ...at(), agent: agent([reply, reply, reply], prompts) });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(message) });
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain(message);
  });

  it.skipIf(!POSIX_SHELL)('re-asks when a probe passes after the patch', async () => {
    const prompts: string[] = [];
    const disagree = { ...validSuite, suite: { ...validSuite.suite, probes: { alpha: 'true', beta: validSuite.suite.probes.beta } } };
    const result = await generate({ ...at(), agent: agent([disagree, validSuite], prompts) });
    expect(result).toMatchObject({ ok: true });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('dry run failed');
  });

  it('keeps the case validator, including transcript_omits, when the model selects cases', async () => {
    const result = await generate({ ...at(), agent: agent([{ cases: [{ ...validCases.cases[0], checks: [{ transcript_omits: 'wrong' }] }, validCases.cases[1], validCases.cases[2]] }]) });
    expect(result).toMatchObject({ ok: true, value: { cases: expect.anything() } });
  });

  it('enforces metadata.eval.shape before and after the call', async () => {
    await expect(generate({ ...at(), shape: 'cases', agent: agent([validSuite, validSuite, validSuite]) })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('shape is fixed') });
    await expect(generate({ ...at(), shape: 'suite', agent: agent([validCases, validCases, validCases]) })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('shape is fixed') });
    const prompts: string[] = [];
    await expect(generate({ ...at(), shape: 'other', agent: agent([validSuite], prompts) })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("metadata.eval.shape must be 'suite' or 'cases'") });
    expect(prompts).toEqual([]);
  });

  it('carries the §4.1 suite prompt verbatim before its case-shape appendix', async () => {
    const prompts: string[] = [];
    await generate({ ...at(), agent: agent([validSuite], prompts) });
    expect(prompts[0]).toContain('whether the skill does its job, not whether it restates its instructions.');
    expect(prompts[0]).toContain('The defects: between 2 and 6, spread across at least 2 files');
    expect(prompts[0]).toContain('Do not include fixture, setup, judge, or bucket; the engine writes setup itself.');
    expect(prompts[0]).toContain('Case shape (when you return {"cases": [...]})');
  });

  it('accepts transcript_omits in the generated check whitelist', async () => {
    const generated = { cases: [{ ...validCases.cases[0], checks: [{ transcript_omits: 'distractor' }] }, validCases.cases[1], validCases.cases[2]] };
    await expect(generate({ ...at(), agent: agent([generated]) })).resolves.toMatchObject({ ok: true });
  });
  it('round-trips generated schemas and adds review/provenance headers from injected time', async () => {
    const prompts: string[] = [];
    const result = await generate({ agent: agent([validTriggers, validCases], prompts), skill, files: ['SKILL.md', 'reference.md'], catalog: '- sibling: a similar skill', model: 'sonnet', engineVersion: '0.1.3', now: new Date('2026-09-07T12:34:56Z'), cases: true, triggers: true });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.triggers).toMatch(/^# generated by terum-skills eval-gen — review before trusting\n# model: sonnet · engine: 0.1.3 · 2026-09-07T12:34:56\.000Z/m);
    expect(parseTriggers(result.value.triggers!)).toMatchObject({ ok: true, value: { shouldTrigger: expect.any(Array), shouldNotTrigger: expect.any(Array) } });
    expect(Object.keys(result.value.cases!.files)).toEqual(['happy-path.yaml', 'missing-config.yaml', 'unsafe-request.yaml']);
    expect(loadCase(result.value.cases!.files['unsafe-request.yaml']!, 'unsafe-request')).toMatchObject({ ok: true, value: { bucket: 'adversarial' } });
    expect(prompts[0]).toContain('- sibling: a similar skill');
    expect(prompts[0]).toContain('near miss');
  });

  it('accepts a generator-chosen count anywhere in the 3-7 band and tells the model to size it', async () => {
    const prompts: string[] = [];
    const seven = { cases: Array.from({ length: 7 }, (_value, index) => ({ ...validCases.cases[0]!, name: `case-${index}`, ...(index === 0 ? { bucket: 'adversarial' } : {}) })) };
    const result = await generate({ agent: agent([seven], prompts), skill, files: ['SKILL.md'], catalog: '', model: 'sonnet', engineVersion: 'test', now: new Date('2026-09-14T00:00:00Z'), cases: true });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.cases!.names).toHaveLength(7);
    expect(prompts[0]).toContain('between 3 and 7 inclusive');
  });

  it.each([
    ['two cases', 2],
    ['eight cases', 8],
  ])('rejects a generated set outside the band: %s', async (_label, count) => {
    const wrong = { cases: Array.from({ length: count }, (_value, index) => ({ ...validCases.cases[2]!, name: `case-${index}` })) };
    const result = await generate({ agent: agent([wrong, wrong, wrong]), skill, files: ['SKILL.md'], catalog: '', model: 'sonnet', engineVersion: 'test', now: new Date('2026-09-14T00:00:00Z'), cases: true });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`between 3 and 7 cases (got ${count})`) });
  });

  it.each([
    ['command_succeeds', { ...validCases, cases: [{ ...validCases.cases[0], checks: [{ command_succeeds: 'verify.sh' }] }, validCases.cases[1], validCases.cases[2]] }],
    ['fixture', { ...validCases, cases: [{ ...validCases.cases[0], fixture: '../fixtures/nope' }, validCases.cases[1], validCases.cases[2]] }],
    ['missing bucket', { ...validCases, cases: [{ ...validCases.cases[0], bucket: undefined }, validCases.cases[1], validCases.cases[2]] }],
  ])('rejects generated cases with %s', async (_label, invalid) => {
    const result = await generate({ agent: agent([invalid, invalid, invalid]), skill, files: ['SKILL.md'], catalog: '', model: 'sonnet', engineVersion: 'test', now: new Date('2026-09-07T00:00:00Z'), cases: true });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Retry the command or pass --no-gen') });
  });

  it('re-asks twice with the validation error before failing with the final error', async () => {
    const prompts: string[] = [];
    const invalid = { should_trigger: ['one'], should_not_trigger: [] };
    const result = await generate({ agent: agent([invalid, invalid, invalid], prompts), skill, files: ['SKILL.md'], catalog: '', model: 'sonnet', engineVersion: 'test', now: new Date('2026-09-07T00:00:00Z'), triggers: true });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('exactly 5 should_trigger') });
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain('previous response could not be used');
    expect(prompts[2]).toContain('exactly 5 should_trigger');
  });

  describe.skipIf(!POSIX_SHELL)('runtime contract at generation time (eval-gen D1–D3, D6)', () => {
    it('D1: the case prompt states that setup is executed shell, how to stub a tool, and that file keys are sandbox-relative', async () => {
      const prompts: string[] = [];
      expect(await generate({ ...at(), agent: agent([validCases], prompts) })).toMatchObject({ ok: true });
      expect(prompts[0]).toContain('executed by /bin/sh -ce');
      expect(prompts[0]).toContain('bin/<tool>');
      expect(prompts[0]).toContain('state the assumption inside the task text');
      expect(prompts[0]).toContain('never absolute');
    });

    it('D2: an unsafe files key is refused before anything is written and goes back as a correction', async () => {
      const prompts: string[] = [];
      const bad = withCase({ files: { '/tmp/scratch/findings.json': '{}' } });
      const result = await generate({ ...at(), agent: agent([bad, bad, bad], prompts) });
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('unsafe file path in case: /tmp/scratch/findings.json') });
      expect(prompts).toHaveLength(3);
      expect(prompts[1]).toContain('sandbox-relative paths');
    });

    it('D3: prose in setup is valid shell that cannot start, so the dry-run refuses it with the shell\'s own error', async () => {
      const prompts: string[] = [];
      const prose = withCase({ setup: 'Assume codex is logged in and the quota is nearly full.' });
      const result = await generate({ ...at(), agent: agent([prose, prose, prose], prompts) });
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/setup failed \(rc=127\).*Assume.*not found/s) });
      expect(prompts[1]).toContain('must be shell that builds the precondition');
    });

    it('D3: a setup that builds its precondition — including an executable bin/ stub — is accepted, and the re-ask can repair a bad one', async () => {
      const prompts: string[] = [];
      const broken = withCase({ setup: 'No AGENTS.md exists in this repo.' });
      const repaired = withCase({ files: { 'bin/codex': '#!/bin/sh\ntest "$1 $2" = "login status" && echo "Logged in"\n' }, setup: 'export PATH="$PWD/bin:$PATH" && codex login status | grep -q "Logged in" && touch made.txt' });
      const result = await generate({ ...at(), agent: agent([broken, repaired], prompts) });
      expect(result).toMatchObject({ ok: true });
      expect(prompts).toHaveLength(2);
      if (result.ok) expect(result.value.cases!.files['happy-path.yaml']).toContain('bin/codex');
    });

    it('D3: dry-run sandboxes do not outlive generation', async () => {
      const scratch = await mkdtemp(join(tmpdir(), 'gen-'));
      expect(await generate({ ...at(), scratch, agent: agent([withCase({ setup: 'touch a.txt' })]) })).toMatchObject({ ok: true });
      expect(await readdir(scratch)).toEqual([]);
    });

    it('D6: generation gets its own timeout, and a timeout is retried once unchanged — never fed back as a correction', async () => {
      const prompts: string[] = [];
      const options: Record<string, unknown>[] = [];
      const timeout = () => new AgentRunError('model call timed out after 300000ms');
      const result = await generate({ ...at(), agent: agent([timeout(), timeout(), validCases], prompts, options) });
      expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/timed out after 300000ms \(twice, generating from a \d+-byte SKILL.md\)/) });
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toBe(prompts[0]);
      expect(options[0]).toMatchObject({ timeoutMs: GENERATION_TIMEOUT_MS });
      expect(GENERATION_TIMEOUT_MS).toBe(300_000);

      const recovered = await generate({ ...at(), agent: agent([timeout(), validCases]) });
      expect(recovered).toMatchObject({ ok: true });
    });
  });
});

const TASK_RULE = 'Tasks must not demand magic-string incantations and must be answerable without human follow-up.';

describe('mode-2 task rules (eval-gen rev 2 §4; live spec-readable run, 2026-09-16)', () => {
  it('states the eval-gen task rule in the mode-2 case appendix, the same sentence the case prompt carries', async () => {
    const prompts: string[] = [];
    await generate({ ...at(), agent: agent([validCases], prompts) });
    const appendix = prompts[0]!.slice(prompts[0]!.indexOf('Case shape (when you return {"cases": [...]})'));
    expect(appendix).toContain(TASK_RULE);
    expect(casePrompt({ ...at(), agent: agent([]) })).toContain(TASK_RULE);
  });

  it("refuses a generated case whose task opens with the skill's own slash command, and the re-ask repairs it", async () => {
    const prompts: string[] = [];
    const selfCall = withCase({ task: '/deploy the service to staging' });
    const result = await generate({ ...at(), agent: agent([selfCall, validCases], prompts) });
    expect(result).toMatchObject({ ok: true });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("generated case 'happy-path' starts its task with /deploy");
    expect(prompts[1]).toContain('Unknown command');
  });

  it.each([
    ['uppercase with a colon', '  /DEPLOY: ship it'],
    ['the bare command', '/deploy'],
  ])('refuses the self slash command however it is written: %s', async (_label, task) => {
    const bad = withCase({ task });
    const result = await generate({ ...at(), agent: agent([bad, bad, bad]) });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('starts its task with /deploy') });
  });

  it('accepts a task that only mentions the command or starts with a different one', async () => {
    const generated = { cases: [
      { ...validCases.cases[0]!, task: 'Ship the service; the team usually types /deploy for this.' },
      { ...validCases.cases[1]!, task: '/deployment-report for last week' },
      validCases.cases[2],
    ] };
    await expect(generate({ ...at(), agent: agent([generated]) })).resolves.toMatchObject({ ok: true });
  });

  it.skipIf(!POSIX_SHELL)("refuses a generated suite whose task opens with the skill's own slash command", async () => {
    const prompts: string[] = [];
    const selfCall = { suite: { ...validSuite.suite, task: '/deploy review the uncommitted diff' } };
    const result = await generate({ ...at(), agent: agent([selfCall, validSuite], prompts) });
    expect(result).toMatchObject({ ok: true });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('generated suite starts its task with /deploy');
  });
});

describe('generated YAML round-trips byte for byte', () => {
  const long = `const banner = "${'x'.repeat(90)}";`;
  // A context line longer than 80 columns, then a whitespace-only context line (for "  ") and a
  // blank context line (for ""): the shape the default 80-column dump folds into a `>` scalar.
  const aSource = `${long}\n  \n\nconst alpha = 1;\n`;
  const aDiff = `diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,4 +1,4 @@\n ${long}\n   \n \n-const alpha = 1;\n+const alpha = -1;\n`;
  const restDiff = validSuite.suite.plants_diff.slice(validSuite.suite.plants_diff.indexOf('diff --git a/src/b.js'));

  it.skipIf(!POSIX_SHELL)('a generated suite keeps plants_diff and its files exactly', async () => {
    const plantsDiff = aDiff + restDiff;
    const suite = { suite: { ...validSuite.suite, files: { ...validSuite.suite.files, 'src/a.js': aSource }, plants_diff: plantsDiff } };
    const prompts: string[] = [];
    const result = await generate({ ...at(), agent: agent([suite, suite, suite], prompts) });
    expect(result).toMatchObject({ ok: true });
    expect(prompts).toHaveLength(1);
    if (!result.ok) return;
    const loaded = loadSuite(result.value.suite!.file, 'suite');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.files['.plants.diff']).toBe(plantsDiff);
    expect(loaded.value.files['src/a.js']).toBe(aSource);
  });

  it('a generated case keeps a seeded diff file exactly', async () => {
    const result = await generate({ ...at(), agent: agent([withCase({ files: { 'changes.diff': aDiff } })]) });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const loaded = loadCase(result.value.cases!.files['happy-path.yaml']!, 'happy-path');
    expect(loaded).toMatchObject({ ok: true });
    if (loaded.ok) expect(loaded.value.files['changes.diff']).toBe(aDiff);
  });

  it.skipIf(!POSIX_SHELL)('a generated case whose setup applies its seeded diff passes the dry run on the first ask', async () => {
    // The dry run seeds what validateCases re-parsed: folded bytes would make `git apply` fail and
    // re-ask the model for a case that was valid all along.
    const prompts: string[] = [];
    const applies = withCase({ files: { 'changes.diff': aDiff, 'src/a.js': aSource }, setup: 'git init -q && git apply changes.diff' });
    const result = await generate({ ...at(), agent: agent([applies, applies, applies], prompts) });
    expect(result).toMatchObject({ ok: true });
    expect(prompts).toHaveLength(1);
  });
});

const briefFive = {
  cases: ['one', 'two', 'three', 'four', 'five'].map((stem, index) => ({
    name: `case-${stem}`,
    task: `Do the job for step ${index + 1}.`,
    checks: [{ transcript_mentions: 'done' }],
    bucket: index === 4 ? 'adversarial' : 'explicit',
  })),
};
const briefOpts = {
  skill, files: ['SKILL.md'], catalog: '', model: 'sonnet', engineVersion: 'test',
  now: new Date('2026-09-07T00:00:00Z'), cases: true as const,
};

describe('brief neutrality (IE6 §3.1)', () => {
  it('refuses a multi-token name, warns on a single-token one, and is bounded by word edges', () => {
    expect(checkBriefNeutrality('Audit the spec with live-trigger-monitoring.', ['live-trigger-monitoring'])).toEqual({ kind: 'refuse', name: 'live-trigger-monitoring' });
    // `search` and `ls` are real skills here; a brief cannot describe the job without them.
    expect(checkBriefNeutrality('Search the codebase for the failing test.', ['search'])).toEqual({ kind: 'warn', name: 'search' });
    expect(checkBriefNeutrality('List the tools and report on false positives.', ['ls'])).toEqual({ kind: 'ok' });
    expect(checkBriefNeutrality('Describe the job plainly.', ['search', 'codex-spec'])).toEqual({ kind: 'ok' });
    // A refusal outranks a warning whichever name is hit first.
    expect(checkBriefNeutrality('Run search, then codex-spec.', ['search', 'codex-spec'])).toEqual({ kind: 'refuse', name: 'codex-spec' });
  });
});

describe('brief derivation (IE6 §3.1)', () => {
  const skills = [
    { name: 'zebra-auditor', skill: '# zebra', files: ['SKILL.md'] },
    { name: 'alpha-auditor', skill: '# alpha', files: ['SKILL.md'] },
  ];

  it('aliases both skills and orders them by name, never by argument position', async () => {
    const prompts: string[] = [];
    const result = await deriveBrief({ agent: agent([{ brief: 'Review a written plan and report what is wrong with it.' }], prompts), model: 'sonnet', skills });
    expect(result).toMatchObject({ ok: true, value: { order: ['alpha-auditor', 'zebra-auditor'] } });
    expect(prompts[0]).toContain('SKILL 1 — SKILL.md:\n# alpha');
    expect(prompts[0]).toContain('SKILL 2 — SKILL.md:\n# zebra');
    expect(prompts[0]).not.toContain('zebra-auditor');
    expect(prompts[0]).not.toContain('alpha-auditor');
    // Assembled from escapes; a literal backslash-n would reach the model as text.
    expect(prompts[0]).not.toContain(String.raw`\n`);
  });

  it('re-asks when the brief names a skill, caps its length, and reports a single-token warning', async () => {
    const named = { brief: 'Use alpha-auditor to review the plan.' };
    expect(await deriveBrief({ agent: agent([named, named, named]), model: 'sonnet', skills }))
      .toMatchObject({ ok: false, error: expect.stringContaining('--brief') });

    const long = { brief: 'x'.repeat(BRIEF_MAX + 1) };
    expect(await deriveBrief({ agent: agent([long, long, long]), model: 'sonnet', skills })).toMatchObject({ ok: false });

    expect(await deriveBrief({
      agent: agent([{ brief: 'Search the plan for contradictions and report them.' }]),
      model: 'sonnet', skills: [{ name: 'search', skill: '# s', files: [] }, { name: 'zebra-auditor', skill: '# z', files: [] }],
    })).toMatchObject({ ok: true, value: { warning: 'search' } });
  });
});

describe('brief-seeded case generation (IE6 §3.2)', () => {
  it('sees the brief alone, fixes the cases shape, and raises the floor to five', async () => {
    const prompts: string[] = [];
    const result = await generate({ ...briefOpts, agent: agent([briefFive], prompts), brief: 'Summarise what changed in a document.' });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(Object.keys(result.value.cases!.files)).toHaveLength(5);
    expect(result.value.suite).toBeUndefined(); // the suite shape is not offered in this mode
    expect(prompts[0]).toContain('Summarise what changed in a document.');
    expect(prompts[0]).toContain('between 5 and 7');
    expect(prompts[0]).not.toContain('deploy safely'); // neither SKILL.md enters the prompt
    expect(prompts[0]).not.toContain('CANDIDATE FILE LISTING');
  });

  it('rejects a brief-seeded set below the head-to-head floor', async () => {
    const three = { cases: briefFive.cases.slice(0, 3) };
    expect(await generate({ ...briefOpts, agent: agent([three, three, three]), brief: 'b' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('between 5 and 7') });
  });

  it('leaves ordinary generation on the 3-case floor and the skill text', async () => {
    const prompts: string[] = [];
    await generate({ ...briefOpts, agent: agent([validCases], prompts) });
    expect(prompts[0]).toContain('deploy safely');
  });
});
