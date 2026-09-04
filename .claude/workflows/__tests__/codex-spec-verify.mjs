// Harness for .claude/workflows/codex-spec-verify.js — stubs the runtime-injected globals
// (agent/parallel/log/phase/args) and executes the script so the per-dimension verify quota
// is asserted, not eyeballed. Same approach as ultrareview-dedup.mjs: execute the real
// script rather than duplicating its source, so the test cannot drift from the code.
//
// THE load-bearing assertion is `starved dimensions get their floor`. Across 7 real
// ultraspec reports (2026-08-01) confirmed AMBIGUITY = 0 and confirmed GAP = 0 EVERY time:
// drift/reality mint BLOCKER+DRIFT, severity-only ranking hands them every slot, and the
// quality/readiness dimensions never reached verification at all. If that regression comes
// back, this file is what catches it.
//
// Standalone, NOT wired into `npm test` (vitest globs __tests__/**/*.test.ts; this executes
// a .claude harness script, not app code).
//
//   run: node .claude/workflows/__tests__/codex-spec-verify.mjs
import fs from 'node:fs'

const SRC = fs.readFileSync(process.argv[2] || '.claude/workflows/codex-spec-verify.js', 'utf8')

const f = (dimension, severity, title, extra = {}) => ({
  dimension, severity, title,
  specLocation: '§1 line 1', evidence: 'E:' + title, suggestion: 'S:' + title,
  confidence: 'high', finder: dimension, ...extra,
})

// The starvation shape: drift floods the cap with high-severity findings while the
// dimensions that only ever emit AMBIGUITY/GAP sit at the bottom of the severity sort.
const STARVED = [
  ...Array.from({ length: 25 }, (_, i) => f('cross-spec drift', i % 2 ? 'BLOCKER' : 'DRIFT', 'drift-' + i)),
  ...Array.from({ length: 6 }, (_, i) => f('spec-vs-code reality', 'DRIFT', 'reality-' + i)),
  ...Array.from({ length: 5 }, (_, i) => f('internal quality', 'AMBIGUITY', 'quality-' + i)),
  ...Array.from({ length: 5 }, (_, i) => f('build-readiness', 'GAP', 'readiness-' + i)),
]

// The script now takes a findings PATH plus a slim index (evidence stays on disk), so the
// harness writes a real fixture file and derives the index the skill would have built.
import os from 'node:os'
import path from 'node:path'
const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-spec-test-'))
let fixtureN = 0
const writeFixture = (findings) => {
  const p = path.join(FIXTURE_DIR, `findings-${fixtureN++}.json`)
  fs.writeFileSync(p, JSON.stringify({ findings }, null, 2))
  return p
}

async function run(rawArgs, { refuteAll = false } = {}) {
  const { findings = [], ...rest } = rawArgs
  const args = {
    ...rest,
    findingsPath: rawArgs.findingsPath || writeFixture(findings),
    index: findings.map((f, i) => ({ i, dimension: f.dimension, severity: f.severity, title: f.title })),
  }
  const calls = []
  const logs = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label || '', phase: opts.phase, prompt })
    if (opts.label === 'synthesize') {
      return { summary: 'stub', reportMarkdown: '# codex-spec review: stub\n', counts: {}, topFindings: [] }
    }
    return { refuted: refuteAll, reason: 'stub verdict', confidence: 'high' }
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()))
  const body = `return (async () => {\n${SRC.replace(/^export const meta/m, 'const meta')}\n})()`
  // new Function, not import(): the script uses top-level `return` and runtime-injected
  // globals, so it only parses when wrapped in a function body.
  const out = await new Function('agent', 'parallel', 'log', 'phase', 'args', body)(
    agent, parallel, (m) => logs.push(m), () => {}, args)
  return { out, calls, logs }
}

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`) }
}
const verifiedTitles = (calls) => [...new Set(calls.filter((c) => /^v\d+:/.test(c.label)).map((c) => c.label.replace(/^v\d+:/, '')))]
const countDim = (titles, prefix) => titles.filter((t) => t.startsWith(prefix)).length

console.log('\n== quota: starved dimensions get their floor ==')
{
  const { out, calls } = await run({ specPath: '.planning/specs/x.md', findings: STARVED, verify: 'conservative' })
  const t = verifiedTitles(calls)
  const cap = 20, floor = 3
  check('total verified respects the cap', t.length <= cap, `got ${t.length}`)
  check('internal quality reached verification', countDim(t, 'quality-') >= floor, `got ${countDim(t, 'quality-')} of floor ${floor}`)
  check('build-readiness reached verification', countDim(t, 'readiness-') >= floor, `got ${countDim(t, 'readiness-')} of floor ${floor}`)
  check('spec-vs-code reality reached verification', countDim(t, 'reality-') >= floor, `got ${countDim(t, 'reality-')}`)
  // Drift's PASS-2 share is capped at ceil(cap * driftFraction) = 10, but pass 3 then fills
  // any slots the floors did not consume, ranked by severity — so a drift BLOCKER can take a
  // leftover slot ahead of a 4th quality AMBIGUITY. That is deliberate (an unused slot helps
  // nobody, and severity is the right tiebreak once every dimension has its floor). The real
  // invariant is therefore: floors are honored FIRST, and drift gets no more than what's left.
  const floorsGranted = 3 + 3 + 3 // reality/quality/readiness each have >= floor available here
  check('drift takes only what the floors left', countDim(t, 'drift-') <= cap - floorsGranted, `got ${countDim(t, 'drift-')}, max ${cap - floorsGranted}`)
  check('drift cannot take a floor slot', countDim(t, 'drift-') + floorsGranted <= cap)
  check('every finding is accounted for exactly once',
    out.confirmedFindings.length + out.contestedFindings.length + out.droppedFindings.length + out.unverifiedFindings.length === STARVED.length,
    `${out.confirmedFindings.length}+${out.contestedFindings.length}+${out.droppedFindings.length}+${out.unverifiedFindings.length} vs ${STARVED.length}`)
}

console.log('\n== quota: a thin dimension does not waste its floor ==')
{
  const findings = [
    ...Array.from({ length: 30 }, (_, i) => f('cross-spec drift', 'BLOCKER', 'drift-' + i)),
    f('internal quality', 'AMBIGUITY', 'quality-0'),
  ]
  const { calls } = await run({ specPath: '.planning/specs/x.md', findings, verify: 'conservative' })
  const t = verifiedTitles(calls)
  check('the single quality finding is verified', countDim(t, 'quality-') === 1, `got ${countDim(t, 'quality-')}`)
  check('unused floor slots go to other dimensions', t.length === 20, `got ${t.length}`)
}

console.log('\n== unknown dimension does not crash ==')
{
  const findings = [f('something-new', 'BLOCKER', 'weird-0'), ...STARVED.slice(0, 5)]
  const { out, calls } = await run({ specPath: '.planning/specs/x.md', findings, verify: 'conservative' })
  check('run completes', !!out && !out.error, out?.error)
  check('the unknown-dimension finding is still verified', verifiedTitles(calls).includes('weird-0'))
}

console.log('\n== empty findings returns a clean, honest result ==')
{
  const { out, calls } = await run({ specPath: '.planning/specs/x.md', findings: [] })
  check('no agents were spawned', calls.length === 0, `got ${calls.length}`)
  check('reports zero counts', out.counts.blocker === 0)
}

console.log('\n== finder failures are surfaced, never silently clean ==')
{
  const { out } = await run({
    specPath: '.planning/specs/x.md', findings: [],
    finderFailures: [{ id: 'quality', dimension: 'internal quality', reason: 'timeout' }],
  })
  check('failure count reaches the caller', out.finderFailures.length === 1)
  check('the empty report warns instead of claiming clean', /INCOMPLETE|⚠|FAILED/i.test(out.reportMarkdown), out.reportMarkdown.slice(0, 120))
}

console.log('\n== low-confidence and incomplete-coverage banners survive synthesis ==')
{
  const { out } = await run({
    specPath: '.planning/specs/x.md', findings: STARVED.slice(0, 4), verify: 'balanced',
    finderFailures: [{ id: 'readiness', dimension: 'build-readiness', reason: 'exit 1' }],
  })
  // The stub synthesizer returns a report with NO banners, so these must be re-injected.
  check('LOW-CONFIDENCE banner re-injected', /LOW-CONFIDENCE/.test(out.reportMarkdown))
  check('INCOMPLETE COVERAGE banner re-injected', /INCOMPLETE COVERAGE/.test(out.reportMarkdown))
}

console.log('\n== all-refuted findings are dropped, not confirmed ==')
{
  const { out } = await run({ specPath: '.planning/specs/x.md', findings: STARVED.slice(0, 6), verify: 'conservative' }, { refuteAll: true })
  check('nothing confirmed', out.confirmedFindings.length === 0, `got ${out.confirmedFindings.length}`)
  check('they land dropped', out.droppedFindings.length > 0)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
