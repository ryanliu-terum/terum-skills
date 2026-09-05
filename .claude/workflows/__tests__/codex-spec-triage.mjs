// Harness for .claude/workflows/codex-spec-verify.js — stubs the runtime-injected globals and
// executes the script so the Triage stage's bucket partition is asserted, not eyeballed. Same
// approach as codex-spec-verify.mjs (which owns the verify-quota assertions): execute the real
// script rather than duplicating its source, so the test cannot drift from the code.
//
// Load-bearing here, beyond the partition itself: the triage agent must read its finding FROM
// DISK by index — the evidence string must never appear in the prompt, for the same
// quote-normalization reason the verify agents work that way (26/26 curly quotes rewritten in
// transit, 2026-08-01). Standalone, NOT wired into `npm test`.
//
//   run: node .claude/workflows/__tests__/codex-spec-triage.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SRC = fs.readFileSync(process.argv[2] || '.claude/workflows/codex-spec-verify.js', 'utf8')

const f = (dimension, severity, title) => ({
  dimension, severity, title,
  specLocation: '§1 line 1', evidence: 'E:' + title, suggestion: 'S:' + title, confidence: 'high', finder: dimension,
})
const FINDINGS = [
  f('internal quality', 'BLOCKER', 'mech-one'),
  f('internal quality', 'AMBIGUITY', 'clear-one'),
  f('build-readiness', 'BLOCKER', 'fork-one'),
  f('build-readiness', 'GAP', 'declined-one'),
  f('spec-vs-code reality', 'DRIFT', 'dead-one'),
  f('cross-spec drift', 'DRIFT', 'badidx-one'),
]

const opt = (name, depth, cost) => ({ name, change: 'change for ' + name, depth, cost, winsIf: 'wins if ' + name })
const base = { rootCause: 'rc', rootCauseLocation: '§1 line 1', disposition: 'fix', options: [opt('A', 2, 0)], recommended: 0, oneClearlyWins: true, whyOneOrFork: 'one sensible edit', difficulty: 'trivial', risk: 'low', scope: 'isolated', patch: '' }
const PATCH = '--- a/spec.md\n+++ b/spec.md\n@@ -1 +1 @@\n-rev 3\n+rev 4'
const TRIAGE = {
  'mech-one':     { ...base, patch: PATCH },
  'clear-one':    { ...base, options: [opt('A', 3, 2), opt('B', 1, 1)], difficulty: 'moderate', scope: 'pattern', patternDetail: '§5.4, §6' },
  'fork-one':     { ...base, options: [opt('A', 4, 4), opt('B', 2, 1)], oneClearlyWins: false, whyOneOrFork: 'depends on which orphan predicate the product wants' },
  'declined-one': { ...base, disposition: 'decline', declineReason: 'ledger D12 already settles this' },
  'dead-one':     null,
  'badidx-one':   { ...base, recommended: 7 },
}

const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-spec-triage-'))
let n = 0
const writeFixture = (findings) => {
  const p = path.join(FIXTURE_DIR, `findings-${n++}.json`)
  fs.writeFileSync(p, JSON.stringify({ findings }, null, 2))
  return p
}

async function run(rawArgs, { refuteAll = false } = {}) {
  const { findings = [], ...rest } = rawArgs
  const args = { ...rest, findingsPath: writeFixture(findings), index: findings.map((x, i) => ({ i, dimension: x.dimension, severity: x.severity, title: x.title })) }
  const calls = []
  const logs = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    calls.push({ label, phase: opts.phase, model: opts.model, prompt })
    if (label === 'synthesize') return { summary: 'stub', reportMarkdown: '# codex-spec review: stub\n', counts: {}, topFindings: [] }
    if (label.startsWith('t:')) { const t = label.slice(2); return Object.prototype.hasOwnProperty.call(TRIAGE, t) ? TRIAGE[t] : { ...base } }
    return { refuted: refuteAll, reason: 'stub verdict', confidence: 'high' }
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const body = `return (async () => {\n${SRC.replace(/^export const meta/m, 'const meta')}\n})()`
  const out = await new Function('agent', 'parallel', 'log', 'phase', 'args', body)(agent, parallel, (m) => logs.push(m), () => {}, args)
  return { out, calls, logs }
}

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`) }
}
const triageCalls = (calls) => calls.filter((c) => c.label.startsWith('t:'))
const titles = (list) => list.map((x) => x.title).sort().join(',')
const bucketSum = (t) => Object.values(t.counts).reduce((a, b) => a + b, 0)

console.log('\n== triage: partition of 6 confirmed findings ==')
{
  const { out, calls, logs } = await run({ specPath: '.planning/specs/spec.md', findings: FINDINGS, verify: 'conservative', model: 'opus' })
  const t = triageCalls(calls)
  check('one triage agent per confirmed finding', t.length === 6, `got ${t.length}`)
  check('triage agents sit in the Triage phase on BASE_MODEL', t.every((c) => c.phase === 'Triage' && c.model === 'opus'))
  check('the prompt points at findingsPath + index and NEVER inlines the evidence', t.every((c) => c.prompt.includes(out.findingsPath) && /element \*\*\d+\*\*/.test(c.prompt) && !c.prompt.includes('E:')), t[0] && t[0].prompt.slice(0, 200))
  check('CONSERVATION: 6 confirmed -> 6 bucketed', out.confirmedFindings.length === 6 && bucketSum(out.triage) === 6, `confirmed=${out.confirmedFindings.length} bucketed=${bucketSum(out.triage)}`)
  check('mechanical', titles(out.triage.buckets.mechanical) === 'mech-one', titles(out.triage.buckets.mechanical))
  check('clear (moderate + pattern)', titles(out.triage.buckets.clear) === 'clear-one', titles(out.triage.buckets.clear))
  check('fork (product decision)', titles(out.triage.buckets.fork) === 'fork-one', titles(out.triage.buckets.fork))
  check('declined (cited)', titles(out.triage.buckets.declined) === 'declined-one', titles(out.triage.buckets.declined))
  check('untriaged (dead + bad index)', titles(out.triage.buckets.untriaged) === 'badidx-one,dead-one', titles(out.triage.buckets.untriaged))
  check('bucket rides along on confirmedFindings', out.confirmedFindings.every((x) => x.triage && typeof x.triage.bucket === 'string'))
  check('mode says triage ran on claude', out.mode.triage === true && out.mode.triagers === 'claude')
  const md = out.reportMarkdown
  check('report gains the Triage section', md.includes('## Triage — 6 confirmed'))
  check('mechanical diff reaches the report', md.includes('```diff\n' + PATCH + '\n```'))
  check('pattern siblings are listed for the clear item', md.includes('also stated at: §5.4, §6'))
  check('fork section routes to /decision-walk with both options', md.includes('### Forks') && md.includes('/decision-walk') && md.includes('Option 2: B'))
  check('UNTRIAGED is logged, never silent', ['dead-one', 'badidx-one'].every((x) => logs.some((l) => l.includes('UNTRIAGED') && l.includes(x))))
}

console.log('\n== triage: false skips the stage visibly ==')
{
  const { out, calls, logs } = await run({ specPath: '.planning/specs/spec.md', findings: FINDINGS, verify: 'conservative', triage: false })
  check('no triage agents spawned', triageCalls(calls).length === 0)
  check('skipped reason recorded', out.triage.skipped === 'triage: false' && out.mode.triage === false, JSON.stringify(out.triage.skipped))
  check('the report says so', out.reportMarkdown.includes('_Skipped: triage: false._'))
  check('logged', logs.some((l) => l.includes('Triage skipped')))
}

console.log('\n== triage: nothing confirmed -> nothing triaged ==')
{
  const { out, calls } = await run({ specPath: '.planning/specs/spec.md', findings: FINDINGS, verify: 'conservative' }, { refuteAll: true })
  check('no triage agents spawned', triageCalls(calls).length === 0)
  check('skipped reason = no confirmed findings', out.triage.skipped === 'no confirmed findings', out.triage.skipped)
}

console.log('\n== triage: empty run carries the triage shape ==')
{
  const { out } = await run({ specPath: '.planning/specs/spec.md', findings: [] })
  check('triage present on the empty early return', out.triage && out.triage.skipped === 'no findings')
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
