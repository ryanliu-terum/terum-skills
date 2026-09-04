// Harness for .claude/workflows/ultrareview.js — stubs the runtime-injected globals
// (agent/parallel/log/phase/args) and executes the script so the Dedup stage can be
// asserted, not eyeballed. Nothing else in the repo tests these workflow scripts, and
// dedup has a data-loss failure mode (a wrong merge deletes a real finding), so the
// CONSERVATION check below — every raw reviewer report accounted for exactly once — is
// the load-bearing assertion. Standalone, NOT wired into `npm test` (vitest globs
// __tests__/**/*.test.ts; this executes a .claude harness script, not app code).
//
//   run: node .claude/workflows/__tests__/ultrareview-dedup.mjs
import fs from 'node:fs'

const SRC = fs.readFileSync(process.argv[2] || '.claude/workflows/ultrareview.js', 'utf8')

// The pr-293 shape: ONE defect reported by all four dimensions in different words,
// plus two genuinely distinct defects. Findings are filed by the dimension reviewer that
// would really have filed them, so the cross-dimension merge is actually exercised.
const BY_DIM = {
  correctness: [
    { severity: 'medium', title: 'Unpaginated persons read', file: 'lib/a.ts', line: 80, evidence: 'E-correctness (short)', suggestion: 'sweep: lib/b.ts' },
    { severity: 'critical', title: 'auth bypass on PUT', file: 'lib/a.ts', line: 200, evidence: 'E-auth', suggestion: 'add requireAuth' },
    { severity: 'low', title: 'dead export', file: 'lib/z.ts', line: 4, evidence: 'E-dead', suggestion: undefined },
  ],
  security: [
    { severity: 'high', title: 'persons read truncates at 1000', file: 'lib/a.ts', line: 80, evidence: 'E-security, the longest evidence of the group by far', suggestion: 'sweep: lib/c.ts' },
  ],
  invariants: [
    { severity: 'low', title: 'no .order() on persons', file: 'lib/a.ts', line: 81, evidence: 'E-invariants', suggestion: 'sweep: lib/b.ts' },
  ],
  reuse: [
    { severity: 'medium', title: 'persons query dup', file: 'lib/a.ts', line: 80, evidence: 'E-reuse', suggestion: undefined },
  ],
}
// The script flattens reviewer results in thunk order: all of dim 1, then dim 2, ...
const DIM_ORDER = ['correctness', 'security', 'invariants', 'reuse']
const FLAT = DIM_ORDER.flatMap(d => BY_DIM[d])
const idxOf = (title) => FLAT.findIndex(f => f.title === title)
const PERSONS_GROUP = ['Unpaginated persons read', 'persons read truncates at 1000', 'no .order() on persons', 'persons query dup'].map(idxOf)

const run = async ({ clusterReply, args = '--in-depth', byDim = BY_DIM, findings = null }) => {
  const calls = []
  const logs = []
  const agent = async (prompt, opts) => {
    const label = opts.label
    calls.push({ label, phase: opts.phase, model: opts.model, prompt })
    if (label === 'manifest') {
      return { mode: 'branch', target: 'test-branch', baseRef: 'main', diffAvailable: true, filesOnDisk: true, totalChurn: 10,
        changedFiles: [{ path: 'lib/a.ts', status: 'M', added: 5, deleted: 1 }, { path: 'lib/z.ts', status: 'M', added: 1, deleted: 0 }] }
    }
    if (label === 'dedup') return clusterReply
    if (label === 'synthesize') return { summary: 's', reportMarkdown: '# ultrareview: test-branch\n', counts: {}, topFindings: [] }
    if (/^v\d+:/.test(label)) return { refuted: false, reason: 'holds' }
    // one reviewer per (dimension x batch); `findings` overrides the per-dimension split
    const dim = String(label).split(':')[0]
    if (findings) return dim === 'correctness' ? { findings } : { findings: [] }
    return { findings: byDim[dim] || [] }
  }
  const parallel = (thunks) => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null)))
  const body = `return (async () => {\n${SRC.replace(/^export const meta/m, 'const meta')}\n})()`
  // new Function, not import(): the script relies on runtime-injected globals and uses
  // top-level `return`, so it only parses when wrapped in a function body.
  const out = await new Function('agent', 'parallel', 'log', 'phase', 'args', body)(
    agent, parallel, (m) => logs.push(m), () => {}, args)
  return { out, calls, logs }
}

let failures = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  PASS  ${name}`) } else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`) }
}
const verifyAgents = (calls) => calls.filter(c => /^v\d+:/.test(c.label))
// THE invariant: every raw reviewer report is accounted for exactly once in the output —
// no finding silently dropped by a merge, no phantom minted by a bogus index.
const conserved = (out) => [...(out.confirmedFindings || []), ...(out.contestedFindings || []),
  ...(out.droppedFindings || []), ...(out.unverifiedFindings || [])]
  .reduce((n, f) => n + (f.dupCount || 1), 0)

// --- T1: happy path. Merger collapses the 4 cross-dimension copies; the other 2 stay.
{
  console.log('T1 — clean 4-into-1 merge across all four dimensions')
  const { out, calls, logs } = await run({ clusterReply: { clusters: [
    { members: PERSONS_GROUP, reason: 'same unpaginated persons read' }, { members: [idxOf('auth bypass on PUT')] }, { members: [idxOf('dead export')] } ] } })
  const v = verifyAgents(calls)
  check('CONSERVATION: all 6 raw reports accounted for exactly once', conserved(out) === 6, `got ${conserved(out)}`)
  check('verify agents = 3 distinct x 3 votes = 9 (was 6 x 3 = 18)', v.length === 9, `got ${v.length}`)
  check('dedup agent ran exactly once', calls.filter(c => c.label === 'dedup').length === 1)
  check('dedup ran on BASE_MODEL (opus at --in-depth)', calls.find(c => c.label === 'dedup').model === 'opus')
  check('verify agents ran on fable at --in-depth', v.every(c => c.model === 'fable'))
  check('stats: 6 raw -> 3 distinct, 3 merged away',
    out.stats.rawFindings === 6 && out.stats.distinctFindings === 3 && out.stats.mergedAway === 3, JSON.stringify(out.stats))
  const merged = out.confirmedFindings.find(f => f.dupCount === 4)
  check('merged finding takes the HIGHEST severity in its group (high, not medium/low)', merged && merged.severity === 'high', merged && merged.severity)
  check('merged finding takes the most-detailed evidence as its base', merged && merged.evidence.startsWith('E-security, the longest'))
  check('merged finding absorbs the other dimensions\' evidence', merged && merged.evidence.includes('E-correctness') && merged.evidence.includes('E-invariants'))
  check('merged finding unions distinct sibling-sweep suggestions', merged && merged.suggestion.includes('lib/b.ts') && merged.suggestion.includes('lib/c.ts'))
  check('duplicate suggestions are not repeated', merged && merged.suggestion.split('lib/b.ts').length - 1 === 1)
  check('all 4 dimensions recorded on the merged finding', merged && merged.dupDimensions.length === 4, JSON.stringify(merged && merged.dupDimensions))
  check('critical stays separate from the merged cluster', out.confirmedFindings.some(f => f.severity === 'critical' && f.dupCount === 1))
  check('every merge is logged (no silent collapse)', logs.some(l => l.includes('merged x4')))
  // A count alone is not auditable: the repair guarantees nothing is dropped by omission,
  // but only the titles side by side let a human spot a semantically WRONG merge.
  check('the merge log names the SURVIVING finding',
    logs.some(l => l.includes('merged x4') && l.includes('kept') && l.includes('persons read truncates at 1000')),
    logs.find(l => l.includes('merged x4')))
  check('the merge log names each report it SWALLOWED',
    ['Unpaginated persons read', 'no .order() on persons', 'persons query dup']
      .every(t => logs.some(l => l.includes('absorbed') && l.includes(t))),
    logs.filter(l => l.includes('absorbed')).join(' | ') || '(no absorbed lines logged)')
  check('a singleton logs no absorbed line', logs.filter(l => l.includes('absorbed')).length === 3)
  check('merge tag reaches the synthesis prompt', calls.find(c => c.label === 'synthesize').prompt.includes('Merged: 4 reviewer reports'))
  // The rep here is the `security` report, so dimKey alone would look right by luck.
  // dupDimKeys is what keeps auto-bug-log eligibility when the rep is NOT security.
  check('dupDimKeys preserves security eligibility through a merge',
    merged && merged.dupDimKeys.includes('security'), JSON.stringify(merged && merged.dupDimKeys))
}

// --- T1b: the actual loss path — a security report absorbed into a critical correctness rep.
{
  console.log('T1b — security report merged into a higher-severity correctness rep')
  const byDim = {
    correctness: [{ severity: 'critical', title: 'crash on null user', file: 'lib/a.ts', line: 9, evidence: 'E-crash' }],
    security: [{ severity: 'high', title: 'same line leaks other teams rows', file: 'lib/a.ts', line: 9, evidence: 'E-leak' }],
    invariants: [], reuse: [],
  }
  const { out } = await run({ byDim, clusterReply: { clusters: [{ members: [0, 1] }] } })
  const f = out.confirmedFindings[0]
  check('rep is the critical correctness finding', f.severity === 'critical' && f.dimKey === 'correctness')
  check('security dimension survives in dupDimKeys (auto-bug-log stays eligible)',
    f.dupDimKeys.includes('security'), JSON.stringify(f.dupDimKeys))
  check('the security report\'s evidence survives in the merged finding', f.evidence.includes('E-leak'))
}

// --- T2: adversarial — merger omits indices entirely (hallucination / truncation).
{
  console.log('T2 — merger omits 3 of the 6 findings from its clusters')
  const { out, calls, logs } = await run({ clusterReply: { clusters: [{ members: [0, 3] }, { members: [1] }] } })
  check('CONSERVATION: nothing dropped despite the omission', conserved(out) === 6, `got ${conserved(out)}`)
  check('omitted findings survive as singletons',
    out.stats.distinctFindings === 5, `distinct=${out.stats.distinctFindings} (expected merged{0,3} + 1 + 2 + 4 + 5)`)
  check('repair is logged', logs.some(l => l.includes('dedup omitted 3 finding(s)')))
  check('verify fan-out matches the repaired set', verifyAgents(calls).length === 15)
}

// --- T3: adversarial — merger repeats an index across clusters, and invents bogus ones.
{
  console.log('T3 — merger repeats an index and invents 99 / -1 / "x"')
  const { out } = await run({ clusterReply: { clusters: [
    { members: [0, 3] }, { members: [3, 4, 99] }, { members: [-1, 5] }, { members: ['x', 1] }, { members: [2] } ] } })
  check('CONSERVATION: repeats ignored, bogus indices mint nothing', conserved(out) === 6, `got ${conserved(out)}`)
  check('repeated index does not double-count', out.confirmedFindings.filter(f => f.dupCount === 2).length === 1)
  check('groups = [0,3] [4] [5] [1] [2]', out.stats.distinctFindings === 5, `distinct=${out.stats.distinctFindings}`)
}

// --- T4: fail-safe — dedup agent dies. Must fall back to today's behavior, losing nothing.
{
  console.log('T4 — dedup agent returns null')
  const { out, calls, logs } = await run({ clusterReply: null })
  check('CONSERVATION holds on the fallback path', conserved(out) === 6, `got ${conserved(out)}`)
  check('falls back to all-singletons (no merge, no loss)', out.stats.distinctFindings === 6 && out.stats.mergedAway === 0)
  check('degradation is surfaced, not silent', logs.some(l => l.includes('WARNING: dedup stage returned nothing')))
  check('verify fan-out = undeduped 6 x 3 = 18 (pre-change behavior)', verifyAgents(calls).length === 18)
}

// --- T5: dedup must not fire when there is nothing to dedup.
{
  console.log('T5 — 1 finding / 0 findings')
  const one = await run({ clusterReply: { clusters: [] }, findings: [BY_DIM.correctness[1]] })
  check('single finding: dedup agent is skipped entirely', one.calls.filter(c => c.label === 'dedup').length === 0)
  check('single finding still verified', verifyAgents(one.calls).length === 3)
  const none = await run({ clusterReply: { clusters: [] }, findings: [] })
  check('zero findings: clean early-return, no dedup agent', none.calls.filter(c => c.label === 'dedup').length === 0 && none.out.stats.confirmed === 0)
  check('zero findings: stats carry the new fields', none.out.stats.distinctFindings === 0 && none.out.stats.mergedAway === 0, JSON.stringify(none.out.stats))
}

// --- T6: the cap is now spent on DISTINCT findings (the coverage win, not just the cost win).
{
  console.log('T6 — cap 40 spent on distinct findings')
  // 44 raw: 40 are copies of one defect, 4 are distinct. Pre-change: 40 slots eaten by copies.
  const many = Array.from({ length: 40 }, (_, i) => ({ severity: 'medium', title: 'dup ' + i, file: 'lib/a.ts', line: 80, evidence: 'E' + i }))
    .concat([1, 2, 3, 4].map(i => ({ severity: 'medium', title: 'distinct ' + i, file: 'lib/d' + i + '.ts', line: i, evidence: 'D' + i })))
  const { out, calls } = await run({
    findings: many,
    clusterReply: { clusters: [{ members: Array.from({ length: 40 }, (_, i) => i) }, { members: [40] }, { members: [41] }, { members: [42] }, { members: [43] }] },
  })
  check('44 raw -> 5 distinct', out.stats.distinctFindings === 5, `distinct=${out.stats.distinctFindings}`)
  check('all 5 distinct findings verified, none pushed past the cap', out.stats.unverified === 0 && verifyAgents(calls).length === 15, `unverified=${out.stats.unverified} verifyAgents=${verifyAgents(calls).length}`)
  check('pre-change this run would have spent 40x3=120 verify agents; now 15', verifyAgents(calls).length === 15)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
