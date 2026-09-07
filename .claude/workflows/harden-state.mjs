#!/usr/bin/env node
// harden-state.mjs — deterministic bookkeeping for /harden, the review → fix → confirm loop.
//
// SHAPE (Ryan, 2026-09-04): the code lane follows the two-pass rule — pass 1 is `full` (the whole
// target), every later pass is `confirm` (only the previous pass's fix diff, via the engine's
// --base=<sha recorded before that fix commit>). The spec lane is `full` every round because the
// codex-spec finder has no diff scope. The expected kind of the next pass is computed here and
// a round.json with the wrong kind is refused.
//
// WHY A SCRIPT AND NOT PROSE
// A /harden run lasts hours and spans several context windows. The two facts a human needs at
// the end — "did it converge?" and "what did it change?" — must not depend on a model's memory
// of earlier rounds. So every round is appended to a JSON state file, the STOP VERDICT is
// computed here from the numbers (never chosen by the agent — the same rule the Triage stage
// applies to its buckets), round numbers continue from the reports already on disk, and the
// end-state report is rendered from the state file, not from the transcript.
//
// Usage (paths relative to --root, default cwd; every command takes --slug):
//   node .claude/workflows/harden-state.mjs init   --slug <s> --lane code|spec [--cap 3] [--mode unattended|confirm] [--base <ref>] [--args "<passthrough>"] [--force]
//   node .claude/workflows/harden-state.mjs round  --slug <s> --file <round.json>
//   node .claude/workflows/harden-state.mjs defer  --slug <s> --file <items.json>
//   node .claude/workflows/harden-state.mjs render --slug <s>
//   node .claude/workflows/harden-state.mjs show   --slug <s>
//
// Files:
//   .planning/harden/<slug>.state.json         the run (one per slug; `init` resumes a running one
//                                              and refuses to clobber a finished one without --force)
//   .planning/harden/<slug>.md                 the rendered end state (written by `render`)
//   .planning/debug/harden/<slug>.deferred.md  the deferrals ledger. Both review engines tell their
//                                              verifiers to treat `.planning/debug/**/*.deferred.md`
//                                              entries as settled, so a round-2 panel does not
//                                              re-verify what round 1 declined or parked as a fork.
//   Reports the loop writes, and `init` scans to pick the next round number:
//     code:  .planning/reviews/<slug>.hybrid.r<N>.review.md
//     spec:  .planning/specs/reviews/<slug>.codex-spec.r<N>.review.md
//
// round.json (written by the skill after each review + fix wave):
//   { "round": 4, "kind": "full|confirm", "report": "<path>", "valid": true, "invalidReason": null,
//     "counts": { "critical": 0, "high": 2, "medium": 5, "low": 0 },      // CONFIRMED only
//     "triage": { "mechanical": 2, "clear": 3, "fork": 1, "declined": 1, "untriaged": 0 },
//     "contested": 1, "unverified": 3,
//     "applied": { "mechanical": 2, "clear": 3 }, "gates": "pass|fail|n/a", "commit": "<sha>|null",
//     "confirmBase": "<sha of HEAD before this pass's fix commit>|null",   // the next confirm pass's --base
//     "human": { "mediums": [{title,location}], "forks": [{title,location,why}],
//                "notApplied": [{title,location,reason}], "contested": [{title,location}],
//                "declinedByTriage": [{title,location,reason}], "declinedByLoop": [{title,location,reason}],
//                "untriaged": [{title,location}] } }
//   A `valid: false` round is recorded as an invalid attempt and NOT counted: the round number
//   does not advance, and the skill re-runs it (resume the workflow). Spec-lane counts use
//   blocker/drift/ambiguity/gap/note.
//
// items.json for `defer`: [{ "title", "location", "kind": "declined|fork", "reason", "round" }]
//
// Exit codes: 0 = ok, 1 = FATAL (bad args, missing state, malformed file).

import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const CMD = argv[0]
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
const has = (name) => argv.includes('--' + name)
const die = (m) => { console.error('FATAL: ' + m); process.exit(1) }
const log_warn = (m) => console.error('WARNING: ' + m)

const ROOT = path.resolve(flag('root', process.cwd()))
const SLUG = flag('slug', null)
const now = () => new Date().toISOString()

const LANES = {
  code: { topTier: ['critical', 'high'], topLabel: 'critical + high', severities: ['critical', 'high', 'medium', 'low'],
          reportDir: '.planning/reviews', infix: 'hybrid', humanTier: 'Mediums', humanKey: 'mediums',
          panel: 'hybrid-review — Claude finds, Codex verifies, Claude triages', shape: 'two-pass' },
  spec: { topTier: ['blocker', 'drift'], topLabel: 'BLOCKER + DRIFT', severities: ['blocker', 'drift', 'ambiguity', 'gap', 'note'],
          reportDir: '.planning/specs/reviews', infix: 'codex-spec', humanTier: 'Ambiguity / gap', humanKey: 'mediums',
          panel: 'codex-spec — Codex finds, Claude verifies and triages', shape: 'full-rounds' },
}

const stateDir = () => path.join(ROOT, '.planning', 'harden')
const statePath = () => path.join(stateDir(), SLUG + '.state.json')
const endStatePath = () => path.join(stateDir(), SLUG + '.md')
const ledgerPath = () => path.join(ROOT, '.planning', 'debug', 'harden', SLUG + '.deferred.md')
const rel = (p) => path.relative(ROOT, p) || '.'
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim()
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const readState = () => {
  if (!fs.existsSync(statePath())) die(`no run for slug "${SLUG}" at ${rel(statePath())}; run \`init\` first`)
  return JSON.parse(fs.readFileSync(statePath(), 'utf8'))
}
const writeState = (st) => { fs.mkdirSync(stateDir(), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(st, null, 2) + '\n') }
const readJsonFile = (p) => {
  if (!p) die('--file <path> is required')
  const f = path.resolve(ROOT, p)
  if (!fs.existsSync(f)) die(`--file not found: ${p}`)
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { die(`--file is not valid JSON: ${e.message}`) }
}
const reportName = (lane, round) => `${SLUG}.${LANES[lane].infix}.r${round}.review.md`
const nextRoundOnDisk = (lane) => {
  const dir = path.join(ROOT, LANES[lane].reportDir)
  if (!fs.existsSync(dir)) return 1
  const re = new RegExp('^' + esc(SLUG) + '\\.' + esc(LANES[lane].infix) + '\\.r(\\d+)\\.review\\.md$')
  const rounds = fs.readdirSync(dir).map((f) => f.match(re)).filter(Boolean).map((m) => Number(m[1]))
  return rounds.length ? Math.max(...rounds) + 1 : 1
}
const nextKindOf = (st) => (LANES[st.lane].shape === 'two-pass' && st.rounds.length > 0 ? 'confirm' : 'full')
const topOf = (lane, counts) => LANES[lane].topTier.reduce((a, k) => a + n(counts[k]), 0)
const totalOf = (counts) => Object.values(counts).reduce((a, v) => a + n(v), 0)
const out = (obj) => console.log(JSON.stringify(obj))

if (!CMD || !['init', 'round', 'defer', 'render', 'show'].includes(CMD)) die('usage: harden-state.mjs <init|round|defer|render|show> --slug <s> [...]')
if (!SLUG) die('--slug <s> is required')
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(SLUG)) die(`slug "${SLUG}" must be a plain filename token (letters, digits, . _ -)`)

// --- init ---------------------------------------------------------------------
if (CMD === 'init') {
  const lane = flag('lane', null)
  if (!LANES[lane]) die('--lane code|spec is required')
  const cap = Number(flag('cap', 3))
  if (!Number.isInteger(cap) || cap < 1) die('--cap must be a positive integer')
  const mode = flag('mode', 'unattended')
  if (!['unattended', 'confirm'].includes(mode)) die('--mode unattended|confirm')
  if (fs.existsSync(statePath())) {
    const st = readState()
    if (st.status === 'running') { out({ resumed: true, slug: SLUG, lane: st.lane, shape: LANES[st.lane].shape, nextRound: st.nextRound, nextKind: nextKindOf(st), confirmBase: st.rounds.length ? st.rounds[st.rounds.length - 1].confirmBase || null : null, rounds: st.rounds.length, cap: st.cap, mode: st.mode, base: st.base, state: rel(statePath()) }); process.exit(0) }
    if (!has('force')) die(`run "${SLUG}" already finished (${st.status}); pass --force to archive it and start over`)
    const archived = statePath().replace(/\.state\.json$/, '.state.' + String(st.startedAt || 'old').replace(/[:.]/g, '-') + '.json')
    fs.renameSync(statePath(), archived)
  }
  const start = nextRoundOnDisk(lane)
  const st = { slug: SLUG, lane, shape: LANES[lane].shape, cap, mode, base: flag('base', null), args: flag('args', ''), startedAt: now(), finishedAt: null,
               status: 'running', verdict: null, startRound: start, nextRound: start, rounds: [], invalidAttempts: [] }
  writeState(st)
  out({ resumed: false, slug: SLUG, lane, shape: st.shape, nextRound: start, nextKind: 'full', cap, mode, base: st.base, state: rel(statePath()),
        nextReport: path.join(LANES[lane].reportDir, reportName(lane, start)), ledger: rel(ledgerPath()) })
}

// --- round --------------------------------------------------------------------
if (CMD === 'round') {
  const st = readState()
  if (st.status !== 'running') die(`run "${SLUG}" already finished (${st.status}) — nothing more to record`)
  const r = readJsonFile(flag('file', null))
  const lane = LANES[st.lane]
  if (!Number.isInteger(r.round)) die('round.json: "round" must be an integer')
  if (r.round !== st.nextRound) die(`round.json: "round" is ${r.round} but the run expects ${st.nextRound}`)
  if (typeof r.report !== 'string' || !r.report) die('round.json: "report" path is required')
  const expectedKind = nextKindOf(st)
  if (r.kind !== expectedKind) die(`round.json: "kind" is ${JSON.stringify(r.kind)} but pass ${r.round} must be "${expectedKind}" (${lane.shape}: ${expectedKind === 'confirm' ? 'a fix-scoped confirmation over the previous pass\'s fixes' : 'a full pass'})`)
  if (typeof r.valid !== 'boolean') die('round.json: "valid" must be true or false')
  if (!r.valid) {
    st.invalidAttempts.push({ round: r.round, report: r.report, reason: r.invalidReason || 'unspecified', at: now() })
    writeState(st)
    out({ verdict: `invalid: not counted — re-run round ${r.round} (resume the workflow; do not read this attempt's verdicts)`, status: 'running', round: r.round, nextRound: st.nextRound, invalidAttempts: st.invalidAttempts.length })
    process.exit(0)
  }
  if (!r.counts || typeof r.counts !== 'object') die('round.json: "counts" object is required (CONFIRMED findings per severity)')
  const counts = Object.fromEntries(lane.severities.map((k) => [k, n(r.counts[k] ?? r.counts[k.toUpperCase()])]))
  if (!['pass', 'fail', 'n/a'].includes(r.gates)) die('round.json: "gates" must be pass, fail, or n/a')
  const top = topOf(st.lane, counts)
  const prev = st.rounds[st.rounds.length - 1] || null
  const regression = prev ? top > prev.top : false
  const applied = { mechanical: n(r.applied && r.applied.mechanical), clear: n(r.applied && r.applied.clear) }
  const entry = { round: r.round, kind: r.kind, report: r.report, at: now(), counts, confirmed: totalOf(counts), top, regression,
                  triage: r.triage || {}, contested: n(r.contested), unverified: n(r.unverified), applied, gates: r.gates,
                  commit: r.commit || null, confirmBase: r.confirmBase || null, human: r.human || {} }
  st.rounds.push(entry)
  st.nextRound = r.round + 1
  let status = 'running', verdict = 'continue'
  if (r.gates === 'fail') { status = 'gates'; verdict = 'stop: gates failed — the baseline is red, so nothing from this round was kept; fix the baseline and start a new run' }
  else if (top === 0) { status = 'converged'; verdict = `stop: converged — the ${r.kind} pass confirmed no ${lane.topLabel} findings` }
  else if (st.rounds.length >= st.cap) { status = 'cap'; verdict = `stop: cap reached (${st.cap} passes) with ${top} ${lane.topLabel} finding(s) still open` }
  else if (applied.mechanical + applied.clear === 0) { status = 'no-progress'; verdict = `stop: no progress — nothing was applied this pass, so the next pass would find the same ${top} finding(s); everything left needs a human` }
  if (status === 'running' && lane.shape === 'two-pass' && !entry.confirmBase) log_warn(`round ${r.round}: no confirmBase recorded — the next confirmation pass has no --base; record \`git rev-parse HEAD\` before committing a pass`)
  if (status !== 'running') { st.status = status; st.verdict = verdict; st.finishedAt = now() }
  writeState(st)
  out({ verdict, status, round: r.round, kind: r.kind, top, regression, applied, nextRound: st.status === 'running' ? st.nextRound : null,
        nextKind: st.status === 'running' ? nextKindOf(st) : null, confirmBase: st.status === 'running' && nextKindOf(st) === 'confirm' ? entry.confirmBase : null,
        nextReport: st.status === 'running' ? path.join(lane.reportDir, reportName(st.lane, st.nextRound)) : null })
}

// --- defer --------------------------------------------------------------------
if (CMD === 'defer') {
  readState()
  const items = readJsonFile(flag('file', null))
  if (!Array.isArray(items)) die('items.json must be an array')
  for (const it of items) {
    if (!it || !norm(it.title)) die('every item needs a title')
    if (!['declined', 'fork'].includes(it.kind)) die(`item "${it.title}": kind must be declined or fork`)
  }
  const lp = ledgerPath()
  let existing = ''
  if (fs.existsSync(lp)) existing = fs.readFileSync(lp, 'utf8')
  else {
    fs.mkdirSync(path.dirname(lp), { recursive: true })
    existing =
      `# harden deferrals — ${SLUG}\n\n` +
      'Findings the /harden loop settled WITHOUT a fix. The review engines tell their verify and triage\n' +
      'agents to treat entries in `.planning/debug/**/*.deferred.md` as settled deferrals, so a later\n' +
      'round does not spend verify budget re-confirming them. `declined` = a cited reason it is not a\n' +
      'defect; `fork` = parked for `/decision-walk`, NOT resolved. Overrule by deleting the entry.\n\n'
  }
  const seen = new Set([...existing.matchAll(/^- \[(?:declined|fork)\] \*\*(.+?)\*\* — /gm)].map((m) => norm(m[1])))
  const added = [], skipped = []
  let body = ''
  for (const it of items) {
    const key = norm(it.title)
    if (seen.has(key)) { skipped.push(it.title); continue }
    seen.add(key); added.push(it.title)
    body += `- [${it.kind}] **${String(it.title).trim()}** — ${it.location || '(no location)'} (round ${n(it.round) || '?'})` +
            (it.kind === 'fork' ? ' — pending /decision-walk; do not re-raise' : '') + '\n' +
            `  reason: ${String(it.reason || '(none given)').trim().replace(/\s*\n\s*/g, ' ')}\n`
  }
  fs.writeFileSync(lp, existing + body)
  out({ ledger: rel(lp), added: added.length, skipped: skipped.length, skippedTitles: skipped })
}

// --- render / show ------------------------------------------------------------
const unionBy = (rounds, key) => {
  const seen = new Set(); const acc = []
  for (const r of rounds) for (const it of (r.human && r.human[key]) || []) {
    const k = norm(it.title); if (!k || seen.has(k)) continue
    seen.add(k); acc.push({ ...it, round: r.round })
  }
  return acc
}
const list = (items, fmt) => (items.length ? items.map(fmt).join('\n') + '\n' : '_none_\n')
const loc = (it) => (it.location ? ` — ${it.location}` : '')

const render = (st) => {
  const lane = LANES[st.lane]
  const last = st.rounds[st.rounds.length - 1] || null
  const cur = (key) => (last && last.human && last.human[key]) || []
  const forks = unionBy(st.rounds, 'forks'), notApplied = unionBy(st.rounds, 'notApplied')
  const declined = [...unionBy(st.rounds, 'declinedByTriage').map((d) => ({ ...d, by: 'triage' })), ...unionBy(st.rounds, 'declinedByLoop').map((d) => ({ ...d, by: 'loop' }))]
  const commits = st.rounds.filter((r) => r.commit)
  const rows = st.rounds.map((r) =>
    `| ${r.round} | ${r.kind} | \`${r.report}\` | ${r.confirmed} | ${r.top}${r.regression ? ' ⚠ up from ' + st.rounds[st.rounds.indexOf(r) - 1].top : ''} | ${r.applied.mechanical} / ${r.applied.clear} | ${r.gates} | ${r.commit ? '`' + r.commit + '`' : '—'} |`)
  const invalid = st.invalidAttempts.map((a) => `- round ${a.round} attempt at ${a.at}: ${a.reason} (${a.report})`)
  return (
    `# harden: ${SLUG}\n\n` +
    `**Lane:** ${st.lane} (${lane.panel}) · **shape:** ${lane.shape === 'two-pass' ? 'two-pass — one full pass, then fix-scoped confirmation passes' : 'full rounds — the whole spec every round'} · **mode:** ${st.mode} · **cap:** ${st.cap} passes` + (st.base ? ` · **base:** \`${st.base}\`` : '') + (st.args ? ` · **passthrough:** \`${st.args}\`` : '') + '\n' +
    `**Started:** ${st.startedAt}` + (st.finishedAt ? ` · **finished:** ${st.finishedAt}` : '') + '\n\n' +
    `**Verdict:** ${st.status === 'running' ? `still running — pass ${st.nextRound} (${nextKindOf(st)}) is next` : st.verdict}\n\n` +
    `## Convergence\n\n| Pass | Kind | Report | Confirmed | Top tier (${lane.topLabel}) | Applied (mechanical / clear) | Gates | Commit |\n|---|---|---|---|---|---|---|---|\n` +
    (rows.length ? rows.join('\n') + '\n' : '| — | | no counted passes yet | | | | | |\n') +
    (invalid.length ? `\n${invalid.length} invalid attempt(s), not counted:\n${invalid.join('\n')}\n` : '') +
    `\n## What the loop changed\n\nOne commit per pass; \`git revert <sha>\` undoes a pass. Nothing was pushed.\n\n` +
    (commits.length ? commits.map((r) => `- pass ${r.round} (${r.kind}) — \`${r.commit}\` — ${r.applied.mechanical} mechanical + ${r.applied.clear} clear`).join('\n') + '\n' : '_nothing was applied._\n') +
    `\n## Needs you\n\n` +
    `### ${lane.humanTier} — fix or explicitly decline (${cur('mediums').length})\n\nNever applied by the loop; the two-pass rule's own done-condition is that every one of these is fixed or explicitly declined by you. From the last counted pass.\n\n` + list(cur('mediums'), (it) => `- **${it.title}**${loc(it)}`) +
    `\n### Forks — run \`/decision-walk ${last ? last.report : '<report>'}\` (${forks.length})\n\nParked in the ledger, never resolved by the loop.\n\n` + list(forks, (it) => `- **${it.title}**${loc(it)} (round ${it.round})${it.why ? ' — ' + it.why : ''}`) +
    `\n### Eligible items not applied — mechanical or clear, with the reason (${notApplied.length})\n\n` + list(notApplied, (it) => `- **${it.title}**${loc(it)} (round ${it.round})${it.reason ? ' — ' + it.reason : ''}`) +
    `\n### Contested — panel split, needs your adjudication (${cur('contested').length})\n\n` + list(cur('contested'), (it) => `- **${it.title}**${loc(it)}`) +
    `\n### Declined (${declined.length}) — in \`${rel(ledgerPath())}\`; delete an entry to re-raise it\n\n` + list(declined, (it) => `- [${it.by}] **${it.title}**${loc(it)}${it.reason ? ' — ' + it.reason : ''}`) +
    `\n### Unverified — beyond the verify cap (${cur('unverified').length})\n\n` + list(cur('unverified'), (it) => `- **${it.title}**${loc(it)}`) +
    `\n### Untriaged (${cur('untriaged').length})\n\n` + list(cur('untriaged'), (it) => `- **${it.title}**${loc(it)}`)
  )
}

if (CMD === 'render') {
  const st = readState()
  const md = render(st)
  fs.writeFileSync(endStatePath(), md)
  process.stdout.write(md)
  console.error(`\nwrote ${rel(endStatePath())}`)
}
if (CMD === 'show') {
  const st = readState()
  out({ slug: SLUG, lane: st.lane, status: st.status, verdict: st.verdict, mode: st.mode, cap: st.cap, base: st.base, args: st.args,
        shape: LANES[st.lane].shape, startRound: st.startRound, nextRound: st.status === 'running' ? st.nextRound : null, nextKind: st.status === 'running' ? nextKindOf(st) : null,
        confirmBase: st.status === 'running' && st.rounds.length ? st.rounds[st.rounds.length - 1].confirmBase || null : null, roundsCounted: st.rounds.length,
        invalidAttempts: st.invalidAttempts.length, lastTop: st.rounds.length ? st.rounds[st.rounds.length - 1].top : null,
        nextReport: st.status === 'running' ? path.join(LANES[st.lane].reportDir, reportName(st.lane, st.nextRound)) : null,
        state: rel(statePath()), ledger: rel(ledgerPath()) })
}
