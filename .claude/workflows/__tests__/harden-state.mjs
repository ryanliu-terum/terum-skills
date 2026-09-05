// Harness for .claude/workflows/harden-state.mjs — runs the real CLI against a throwaway repo
// root so the loop's bookkeeping is asserted, not eyeballed. The load-bearing assertions:
//   1. THE STOP VERDICT IS COMPUTED, NOT CHOSEN — converged / cap / no-progress / gates come from
//      the numbers in round.json, and an invalid round is never counted.
//   2. ROUND NUMBERS CONTINUE FROM DISK — a run on a spec that already has r1..r3 starts at r4.
//   3. THE LEDGER NEVER DUPLICATES — a title deferred twice appears once.
//   4. THE END STATE IS RENDERED FROM STATE — last-round lists for mediums, unions for forks.
// Standalone, NOT wired into `npm test`.
//
//   run: node .claude/workflows/__tests__/harden-state.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(process.argv[2] || '.claude/workflows/harden-state.mjs')
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'harden-state-test-'))
const run = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--root', ROOT], { encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(r.stdout.trim().split('\n').pop()) } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json }
}
const writeJson = (name, obj) => { const p = path.join(ROOT, name); fs.writeFileSync(p, JSON.stringify(obj)); return name }
let failures = 0
const check = (name, cond, detail) => { if (cond) console.log(`  PASS  ${name}`); else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`) } }

// --- T1: round numbers continue from the reports already on disk (spec lane)
{
  console.log('T1 — init starts after the last report on disk')
  fs.mkdirSync(path.join(ROOT, '.planning/specs/reviews'), { recursive: true })
  for (const n of [1, 2, 3]) fs.writeFileSync(path.join(ROOT, `.planning/specs/reviews/phase-1.codex-spec.r${n}.review.md`), '# r' + n)
  fs.writeFileSync(path.join(ROOT, '.planning/specs/reviews/phase-1.codex-spec.review.md'), '# unnumbered, must be ignored')
  const r = run('init', '--slug', 'phase-1', '--lane', 'spec', '--cap', '3', '--base', 'main')
  check('exit 0', r.code === 0, r.err)
  check('next round is 4', r.json && r.json.nextRound === 4, JSON.stringify(r.json))
  check('names the next report', r.json && r.json.nextReport === '.planning/specs/reviews/phase-1.codex-spec.r4.review.md', r.json && r.json.nextReport)
  const again = run('init', '--slug', 'phase-1', '--lane', 'spec')
  check('re-init of a running run RESUMES rather than clobbering', again.code === 0 && again.json.resumed === true && again.json.nextRound === 4)
  const fresh = run('init', '--slug', 'never-reviewed', '--lane', 'code')
  check('a slug with no reports starts at 1', fresh.json && fresh.json.nextRound === 1)
  check('bad slug is refused', run('init', '--slug', '../x', '--lane', 'code').code === 1)
  check('bad lane is refused', run('init', '--slug', 'ok', '--lane', 'docs').code === 1)
}

// --- T2: verdicts on the spec lane: invalid not counted, continue, then cap
{
  console.log('T2 — invalid attempts do not count; cap stops with open blockers')
  const bad = run('round', '--slug', 'phase-1', '--file', writeJson('r4-bad.json', { round: 4, report: 'x.r4', valid: false, invalidReason: 'finderFailures=2' }))
  check('invalid round: verdict says not counted', bad.json && bad.json.verdict.startsWith('invalid: not counted'), bad.json && bad.json.verdict)
  check('invalid round: next round unchanged', bad.json && bad.json.nextRound === 4)
  const wrongNo = run('round', '--slug', 'phase-1', '--file', writeJson('r5-early.json', { round: 5, report: 'x', valid: true, counts: {}, gates: 'n/a' }))
  check('a round out of sequence is refused', wrongNo.code === 1 && /expects 4/.test(wrongNo.err))
  const r4 = run('round', '--slug', 'phase-1', '--file', writeJson('r4.json', {
    round: 4, report: '.planning/specs/reviews/phase-1.codex-spec.r4.review.md', valid: true,
    counts: { BLOCKER: 3, DRIFT: 1, AMBIGUITY: 1, GAP: 2, NOTE: 0 }, triage: { mechanical: 2, clear: 2, fork: 1, declined: 1 },
    contested: 1, unverified: 0, applied: { mechanical: 2, clear: 2 }, gates: 'n/a', commit: 'aaa1111',
    human: { mediums: [{ title: 'ambig A', location: '§5' }], forks: [{ title: 'Fork One', location: '§6', why: 'product call' }],
             declinedByTriage: [{ title: 'Declined X', location: '§2', reason: 'settled in ledger D4' }] } }))
  check('r4: continue (4 top-tier open, 4 applied)', r4.json && r4.json.verdict === 'continue' && r4.json.top === 4, JSON.stringify(r4.json))
  check('r4: uppercase severities accepted', r4.json && r4.json.top === 4)
  const r5 = run('round', '--slug', 'phase-1', '--file', writeJson('r5.json', {
    round: 5, report: '.planning/specs/reviews/phase-1.codex-spec.r5.review.md', valid: true,
    counts: { blocker: 5, drift: 0, ambiguity: 0, gap: 1 }, applied: { mechanical: 1, clear: 0 }, gates: 'n/a', commit: 'bbb2222',
    human: { mediums: [{ title: 'gap B', location: '§9' }], forks: [{ title: 'fork one', location: '§6' }, { title: 'Fork Two', location: '§7' }], notApplied: [{ title: 'Clear C', location: '§3', reason: 'gates failed: 1 test' }] } }))
  check('r5: continue, regression flagged (5 > 4)', r5.json && r5.json.verdict === 'continue' && r5.json.regression === true, JSON.stringify(r5.json))
  const r6 = run('round', '--slug', 'phase-1', '--file', writeJson('r6.json', {
    round: 6, report: '.planning/specs/reviews/phase-1.codex-spec.r6.review.md', valid: true,
    counts: { blocker: 2 }, applied: { mechanical: 1, clear: 1 }, gates: 'n/a', commit: 'ccc3333', human: { mediums: [] } }))
  check('r6: cap reached with blockers open', r6.json && r6.json.status === 'cap' && /cap reached \(3 rounds\) with 2/.test(r6.json.verdict), r6.json && r6.json.verdict)
  const after = run('round', '--slug', 'phase-1', '--file', writeJson('r7.json', { round: 7, report: 'x', valid: true, counts: {}, gates: 'n/a' }))
  check('a finished run refuses more rounds', after.code === 1)
  const show = run('show', '--slug', 'phase-1')
  check('show: 3 counted, 1 invalid, status cap', show.json && show.json.roundsCounted === 3 && show.json.invalidAttempts === 1 && show.json.status === 'cap', JSON.stringify(show.json))
}

// --- T3: converged and no-progress on the code lane; gates fail
{
  console.log('T3 — converged, no-progress and gates-fail verdicts (code lane)')
  run('init', '--slug', 'feat-x', '--lane', 'code', '--cap', '3')
  const a = run('round', '--slug', 'feat-x', '--file', writeJson('a1.json', { round: 1, report: 'r1', valid: true, counts: { critical: 1, high: 1, medium: 4 }, applied: { mechanical: 1, clear: 1 }, gates: 'pass', commit: 'd1' }))
  const b = run('round', '--slug', 'feat-x', '--file', writeJson('a2.json', { round: 2, report: 'r2', valid: true, counts: { critical: 0, high: 0, medium: 3 }, applied: { mechanical: 0, clear: 0 }, gates: 'pass', commit: null }))
  check('critical+high > 0 with fixes applied: continue', a.json && a.json.verdict === 'continue' && a.json.top === 2)
  check('top tier 0: converged even with mediums open', b.json && b.json.status === 'converged', b.json && b.json.verdict)
  run('init', '--slug', 'feat-y', '--lane', 'code')
  const c = run('round', '--slug', 'feat-y', '--file', writeJson('b1.json', { round: 1, report: 'r1', valid: true, counts: { high: 2 }, applied: { mechanical: 0, clear: 0 }, gates: 'pass' }))
  check('top tier open, nothing applied: no-progress stop', c.json && c.json.status === 'no-progress', c.json && c.json.verdict)
  run('init', '--slug', 'feat-z', '--lane', 'code')
  const d = run('round', '--slug', 'feat-z', '--file', writeJson('c1.json', { round: 1, report: 'r1', valid: true, counts: { high: 1 }, applied: { mechanical: 1, clear: 0 }, gates: 'fail' }))
  check('gates fail: stop, nothing kept', d.json && d.json.status === 'gates', d.json && d.json.verdict)
  check('finished run: init without --force is refused', run('init', '--slug', 'feat-z', '--lane', 'code').code === 1)
  const forced = run('init', '--slug', 'feat-z', '--lane', 'code', '--force')
  check('finished run: --force archives and restarts at the disk round', forced.code === 0 && forced.json.resumed === false && fs.readdirSync(path.join(ROOT, '.planning/harden')).some((f) => /^feat-z\.state\..+\.json$/.test(f)))
}

// --- T4: the deferrals ledger never duplicates a title
{
  console.log('T4 — ledger dedups by normalized title and tags forks as pending')
  const one = run('defer', '--slug', 'phase-1', '--file', writeJson('d1.json', [
    { title: 'Declined X', location: '§2', kind: 'declined', reason: 'settled in ledger D4', round: 4 },
    { title: 'Fork One', location: '§6', kind: 'fork', reason: 'product call\n  spans lines', round: 4 } ]))
  const two = run('defer', '--slug', 'phase-1', '--file', writeJson('d2.json', [
    { title: 'declined   x', location: '§2', kind: 'declined', reason: 'again', round: 5 },
    { title: 'Fork Two', location: '§7', kind: 'fork', reason: 'ux call', round: 5 } ]))
  const ledger = fs.readFileSync(path.join(ROOT, '.planning/debug/harden/phase-1.deferred.md'), 'utf8')
  check('first call adds 2', one.json && one.json.added === 2)
  check('second call adds 1, skips the case/space variant', two.json && two.json.added === 1 && two.json.skipped === 1, JSON.stringify(two.json))
  check('ledger lives under .planning/debug/**/*.deferred.md (the glob the engines read)', /\.planning\/debug\/harden\/phase-1\.deferred\.md$/.test(path.join(ROOT, one.json.ledger)))
  check('ledger has exactly one Declined X entry', ledger.split('**Declined X**').length === 2)
  check('forks are tagged pending /decision-walk', /\[fork\] \*\*Fork One\*\* — §6 \(round 4\) — pending \/decision-walk/.test(ledger))
  check('multi-line reasons are flattened', /reason: product call spans lines/.test(ledger))
  check('bad kind is refused', run('defer', '--slug', 'phase-1', '--file', writeJson('d3.json', [{ title: 'q', kind: 'maybe' }])).code === 1)
}

// --- T5: end state renders from state — last round's mediums, union of forks, commits
{
  console.log('T5 — render: convergence table, commits, and the needs-you lists')
  const r = run('render', '--slug', 'phase-1')
  const md = r.out
  check('exit 0 and file written', r.code === 0 && fs.existsSync(path.join(ROOT, '.planning/harden/phase-1.md')))
  check('verdict line carries the cap verdict', /\*\*Verdict:\*\* stop: cap reached/.test(md))
  check('three table rows, in order', (md.match(/^\| [456] \| /gm) || []).length === 3)
  check('regression is marked on round 5', /\| 5 \| .* \| 5 ⚠ up from 4 \|/.test(md))
  check('invalid attempt listed, not counted', /1 invalid attempt\(s\), not counted:/.test(md) && /finderFailures=2/.test(md))
  check('commits listed with revert guidance', /git revert <sha>/.test(md) && /`aaa1111`/.test(md) && /`ccc3333`/.test(md))
  check('mediums come from the LAST round only (empty)', /### Ambiguity \/ gap — fix or explicitly decline \(0\)/.test(md))
  check('forks are the union across rounds (2, dedup by title)', /### Forks — run `\/decision-walk .*r6\.review\.md` \(2\)/.test(md) && /Fork Two/.test(md))
  check('not-applied items are listed with their reason', /### Eligible items not applied[^\n]*\(1\)/.test(md) && /Clear C.*gates failed: 1 test/.test(md))
  check('declined names the ledger path', /### Declined \(1\) — in `\.planning\/debug\/harden\/phase-1\.deferred\.md`/.test(md))
  check('nothing pushed is stated', /Nothing was pushed/.test(md))
  const running = run('render', '--slug', 'never-reviewed')
  check('a running run renders "still running — round N is next"', /still running — round 1 is next/.test(running.out))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
fs.rmSync(ROOT, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
