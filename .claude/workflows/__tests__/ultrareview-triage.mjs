// Harness for .claude/workflows/ultrareview.js — stubs the runtime-injected globals
// (agent/parallel/log/phase/args) and executes the script so the Triage stage's BUCKET
// PARTITION is asserted, not eyeballed. Same approach as ultrareview-dedup.mjs: execute the
// real script, never a copy of its logic, so the test cannot drift from the code.
//
// The load-bearing assertions:
//   1. CONSERVATION — every confirmed finding lands in exactly one bucket, including when the
//      triage agent dies (null) or returns something unusable. Nothing silently dropped.
//   2. THE BUCKET IS DERIVED FROM THE RATINGS IN CODE — a finding the agent calls a fork stays a
//      fork even with a trivial rating and a patch; a "trivial" rating with no patch is NOT
//      mechanical; a decline with no citation is NOT a decline.
//   3. SCOPE + SKIPS — triage runs only on confirmed findings, and is skipped VISIBLY on
//      --no-triage / --no-fix, an un-checked-out PR, and an invalid hybrid panel.
//
// Standalone, NOT wired into `npm test` (vitest globs __tests__/**/*.test.ts; this executes a
// .claude harness script, not app code).
//
//   run: node .claude/workflows/__tests__/ultrareview-triage.mjs
import fs from 'node:fs'

const SRC = fs.readFileSync(process.argv[2] || '.claude/workflows/ultrareview.js', 'utf8')

const F = (title, severity = 'high') => ({ severity, title, file: 'lib/a.ts', line: 10, evidence: 'E:' + title, suggestion: 'S:' + title })
const TITLES = ['mech-one', 'clear-one', 'fork-one', 'declined-one', 'nopatch-one', 'dead-one', 'badidx-one', 'noreason-one', 'contested-one']
const FINDINGS = TITLES.map(t => F(t))

const opt = (name, depth, cost) => ({ name, change: 'change for ' + name, depth, cost, winsIf: 'wins if ' + name })
const base = { rootCause: 'rc', rootCauseLocation: 'lib/a.ts:10', disposition: 'fix', options: [opt('A', 2, 0)], recommended: 0, oneClearlyWins: true, whyOneOrFork: 'only one sensible fix', difficulty: 'trivial', risk: 'low', scope: 'isolated', patch: '' }
const PATCH = '--- a/lib/a.ts\n+++ b/lib/a.ts\n@@ -10 +10 @@\n-x\n+y'
const TRIAGE = {
  'mech-one':     { ...base, patch: PATCH },
  'clear-one':    { ...base, options: [opt('A', 3, 2), opt('B', 1, 0)], difficulty: 'moderate', risk: 'medium' },
  'fork-one':     { ...base, options: [opt('A', 4, 3), opt('B', 2, 0)], oneClearlyWins: false, whyOneOrFork: 'depth vs cost, product call', patch: PATCH },
  'declined-one': { ...base, disposition: 'decline', declineReason: 'settled deferral: .planning/debug/x/bug-1.deferred.md' },
  'nopatch-one':  { ...base },                                                  // trivial/low/isolated, NO patch -> clear
  'dead-one':     null,                                                         // agent died / was skipped
  'badidx-one':   { ...base, options: [] },                                     // unusable -> untriaged
  'noreason-one': { ...base, disposition: 'decline', declineReason: '   ' },    // decline w/o citation -> untriaged
}

async function run({ args = '--in-depth', filesOnDisk = true, findings = FINDINGS, relayFailTitle = null, synthNull = false } = {}) {
  const calls = []
  const logs = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    calls.push({ label, phase: opts.phase, model: opts.model, prompt })
    if (label === 'manifest') return { mode: 'working', target: 'working', baseRef: 'HEAD', diffAvailable: true, filesOnDisk, totalChurn: 10, changedFiles: [{ path: 'lib/a.ts', status: 'M', added: 5, deleted: 1 }] }
    if (label === 'dedup') return { clusters: findings.map((_, i) => ({ members: [i] })) }
    if (label === 'synthesize') return synthNull ? null : { summary: 's', reportMarkdown: '# ultrareview: working\n', counts: {}, topFindings: [] }
    const m = label.match(/^(v|cx|cxR)(\d+):(.*)$/)
    if (m) {
      const [, , voter, t] = m
      if (relayFailTitle && voter === '0' && t.startsWith(relayFailTitle.slice(0, 26))) return { refuted: false, reason: 'RELAY_FAILED: rc=143 killed by timeout', confidence: 'low', correctedSeverity: null }
      if (t.startsWith('contested-one') && voter === '0') return { refuted: true, reason: 'one skeptic' }
      return { refuted: false, reason: 'holds' }
    }
    if (label.startsWith('t:')) {
      const t = label.slice(2)
      return Object.prototype.hasOwnProperty.call(TRIAGE, t) ? TRIAGE[t] : { ...base }
    }
    // reviewers: correctness files everything, the other three dimensions are clean
    return { findings: label.startsWith('correctness:') ? findings : [] }
  }
  const parallel = (thunks) => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null)))
  const body = `return (async () => {\n${SRC.replace(/^export const meta/m, 'const meta')}\n})()`
  const out = await new Function('agent', 'parallel', 'log', 'phase', 'args', body)(
    agent, parallel, (m) => logs.push(m), () => {}, args)
  return { out, calls, logs }
}

let failures = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  PASS  ${name}`) } else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`) }
}
const triageCalls = (calls) => calls.filter(c => c.label.startsWith('t:'))
const titles = (list) => list.map(f => f.title).sort().join(',')
const bucketSum = (t) => Object.values(t.counts).reduce((a, b) => a + b, 0)

// --- T1: the partition.
{
  console.log('T1 — partition of 8 confirmed findings (1 contested stays out)')
  const { out, calls, logs } = await run()
  const t = triageCalls(calls)
  check('triage ran once per CONFIRMED finding (8), not for the contested one', t.length === 8 && !t.some(c => c.label.includes('contested-one')), `got ${t.length}: ${t.map(c => c.label).join(' ')}`)
  check('triage agents are grouped under the Triage phase', t.every(c => c.phase === 'Triage'))
  check('triage runs on REVIEW_MODEL (sonnet at --in-depth), not BASE_MODEL (opus)', t.every(c => c.model === 'sonnet'), t[0] && t[0].model)
  check('the triage prompt carries the evidence + the single-fix definitions', t[0].prompt.includes('E:mech-one') && t[0].prompt.includes('trivial = ~1-10 line'))
  check('triageMode is on, nothing skipped', out.triageMode === true && out.triage.skipped === null, JSON.stringify(out.triage && out.triage.skipped))
  check('CONSERVATION: 8 confirmed -> 8 bucketed', out.confirmedFindings.length === 8 && bucketSum(out.triage) === 8, `confirmed=${out.confirmedFindings.length} bucketed=${bucketSum(out.triage)}`)
  check('mechanical = trivial + low + isolated + patch', titles(out.triage.buckets.mechanical) === 'mech-one', titles(out.triage.buckets.mechanical))
  check('clear = one fix wins but moderate/medium, AND rated-mechanical-with-no-patch', titles(out.triage.buckets.clear) === 'clear-one,nopatch-one', titles(out.triage.buckets.clear))
  check('fork = oneClearlyWins:false, EVEN with a trivial rating and a patch', titles(out.triage.buckets.fork) === 'fork-one', titles(out.triage.buckets.fork))
  check('declined = decline WITH a cited reason', titles(out.triage.buckets.declined) === 'declined-one', titles(out.triage.buckets.declined))
  check('untriaged = null result, unusable options, decline without a reason', titles(out.triage.buckets.untriaged) === 'badidx-one,dead-one,noreason-one', titles(out.triage.buckets.untriaged))
  check('every confirmed finding carries triage.bucket', out.confirmedFindings.every(f => f.triage && typeof f.triage.bucket === 'string'))
  check('the contested finding carries no triage', out.contestedFindings.length === 1 && out.contestedFindings[0].triage === undefined)
  check('counts match the buckets', JSON.stringify(out.triage.counts) === JSON.stringify({ mechanical: 1, clear: 2, fork: 1, declined: 1, untriaged: 3 }), JSON.stringify(out.triage.counts))
  const md = out.reportMarkdown
  check('report gains a Triage section after synthesis', md.includes('## Triage — 8 confirmed'))
  check('the mechanical patch reaches the report inside a diff fence', md.includes('### Mechanical') && md.includes('```diff\n' + PATCH + '\n```'))
  check('the fork section names /decision-walk and lists both options', md.includes('### Forks') && md.includes('/decision-walk') && md.includes('Option 1: A') && md.includes('Option 2: B'))
  check('the declined reason is printed for the human to overrule', md.includes('settled deferral: .planning/debug/x/bug-1.deferred.md'))
  check('untriaged findings are listed, not dropped', md.includes('### Untriaged') && md.includes('dead-one'))
  check('the no-patch demotion is logged', logs.some(l => l.includes('nopatch-one') && l.includes('no patch supplied')))
  check('dead / unusable / uncited results are logged as UNTRIAGED', ['dead-one', 'badidx-one', 'noreason-one'].every(t => logs.some(l => l.includes('UNTRIAGED') && l.includes(t))))
  check('the summary line is logged', logs.some(l => l.startsWith('Triage: 8 confirmed -> 1 mechanical, 2 clear, 1 fork, 1 declined, 3 UNTRIAGED')))
  check('proposedFix is retired (no second patch path)', !('proposedFix' in out) && !calls.some(c => c.label === 'propose-fix'))
}

// --- T2/T3: opt-out flag and its alias.
for (const flag of ['--no-triage', '--no-fix']) {
  console.log(`T2 — ${flag} skips the stage visibly`)
  const { out, calls, logs } = await run({ args: '--in-depth ' + flag })
  check('no triage agents spawned', triageCalls(calls).length === 0)
  check('triageMode false, skipped reason = --no-triage', out.triageMode === false && out.triage.skipped === '--no-triage', JSON.stringify(out.triage && out.triage.skipped))
  check('confirmed findings are still returned', out.confirmedFindings.length === 8)
  check('the report says triage was skipped', out.reportMarkdown.includes('_Skipped: --no-triage._'))
  check('the skip is logged', logs.some(l => l.includes('Triage skipped')))
  if (flag === '--no-fix') check('--no-fix logs that it is an alias', logs.some(l => l.includes('--no-fix is an alias for --no-triage')))
}

// --- T4: un-checked-out PR — code is not on disk, so it cannot be investigated.
{
  console.log('T4 — files not on disk (un-checked-out PR) skips triage')
  const { out, calls } = await run({ args: '109', filesOnDisk: false })
  check('no triage agents spawned', triageCalls(calls).length === 0)
  check('skip reason names the cause', typeof out.triage.skipped === 'string' && out.triage.skipped.includes('not on disk'), out.triage.skipped)
  check('confirmed findings still returned', out.confirmedFindings.length === 8)
}

// --- T5: invalid hybrid panel — nothing from that run is adjudicated, so nothing is triaged.
{
  console.log('T5 — --codex-verify with a relay failure skips triage')
  const { out, calls } = await run({ args: '--codex-verify', relayFailTitle: 'mech-one' })
  check('panel is invalid', out.stats.panelValid === false && out.stats.relayFailures > 0, JSON.stringify({ v: out.stats.panelValid, rf: out.stats.relayFailures }))
  check('no triage agents spawned', triageCalls(calls).length === 0, `got ${triageCalls(calls).length}`)
  check('skip reason says INVALID', typeof out.triage.skipped === 'string' && out.triage.skipped.includes('INVALID'), out.triage.skipped)
}

// --- T6: clean diff — the early return still carries the triage shape.
{
  console.log('T6 — zero findings: clean return carries an empty triage')
  const { out, calls } = await run({ findings: [] })
  check('no triage agents spawned', triageCalls(calls).length === 0)
  check('triage present with skipped = no findings', out.triage && out.triage.skipped === 'no findings' && bucketSum(out.triage) === 0, JSON.stringify(out.triage))
  check('triageMode still reported', out.triageMode === true)
}

// --- T7: synthesis failed — the buckets survive, the skill can still act on them.
{
  console.log('T7 — synthesis failure keeps the triage result')
  const { out } = await run({ synthNull: true })
  check('error is the synthesis-failed path', typeof out.error === 'string' && out.error.includes('Synthesis failed'))
  check('triage buckets still populated', out.triage.counts.mechanical === 1 && bucketSum(out.triage) === 8, JSON.stringify(out.triage.counts))
  check('triageMarkdown returned standalone', typeof out.triageMarkdown === 'string' && out.triageMarkdown.includes('### Mechanical'))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
