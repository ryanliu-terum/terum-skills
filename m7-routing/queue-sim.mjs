import { readFileSync } from 'node:fs'
const body = readFileSync(process.argv[2], 'utf8').replace(/^export const meta = \{[\s\S]*?\n\}\n/, '')
const batches = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const mode = process.argv[4] || 'dry'
const started = [], finished = []
let t = 0
const fakeAgent = async (prompt, opts) => {
  const id = (opts.label || '').split(':')[1]
  if (opts.label === 'review') return { findings: [] }
  started.push(`${id}@${t}`)
  await new Promise((r) => setTimeout(r, id === 'S7f' ? 30 : id === 'S7c' ? 5 : 10))
  t++; finished.push(id)
  if (mode === 'fail' && id === 'S7f') return { batchId: id, status: 'failed', gates: 'x', notes: 'simulated failure' }
  return { batchId: id, status: opts.label.includes('S7ab') ? 'draft-pr-opened' : 'pr-opened', gates: 'ok', notes: 'sim', prUrl: 'https://example/' + id }
}
const run = new Function('args', 'agent', 'parallel', 'pipeline', 'log', 'phase', `return (async () => { ${body} })()`)
const logs = []
const out = await run({ batches, dryRun: mode === 'dry', maxParallel: 2 }, fakeAgent, async (ts) => Promise.all(ts.map((f) => f())), async () => [], (m) => logs.push(m), () => {})
if (mode === 'dry') { console.log('DRY plan order:', out.plan.map((p) => p.id + (p.dependsOn.length ? '(' + p.dependsOn.join(',') + ')' : '')).join(' ')); console.log('skipped:', out.skipped) }
else {
  console.log('started order:', started.join(' '))
  console.log('statuses:', out.results.map((r) => r.batchId + '=' + r.status).join(' '))
  console.log('logs:', logs.slice(-6).join(' | '))
  // invariants: every batch started only after its in-run deps finished
  const finishedAt = Object.fromEntries(finished.map((id, i) => [id, i]))
  const startedAt = Object.fromEntries(started.map((s) => { const [id, at] = s.split('@'); return [id, Number(at)] }))
  const wanted = out.plan
  let bad = 0
  for (const p of wanted) for (const d of p.dependsOn) if (startedAt[p.id] !== undefined && !(finishedAt[d] < startedAt[p.id] + 0.5 || finishedAt[d] === undefined)) { bad++; console.log('VIOLATION', p.id, 'started before', d, 'finished') }
  console.log('dependency violations:', bad, '| total results:', out.results.length, '| plan size:', out.plan.length)
}
