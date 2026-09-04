export const meta = {
  name: 'codex-spec-verify',
  description: 'Verify half of /codex-spec: adversarially verifies Codex-found spec findings on Claude, then synthesizes a severity-ranked report.',
  phases: [
    { title: 'Verify', detail: 'per-dimension quota, then N-vote adversarial verification per finding' },
    { title: 'Synthesize', detail: 'merge, severity-rank, emit a REVIEW report' },
  ],
}

// Invoked by the /codex-spec skill AFTER codex-spec-find.mjs has run:
//   Workflow({ scriptPath: ".claude/workflows/codex-spec-verify.js",
//              args: { specPath, findingsPath, index: [{i, dimension, severity, title}], ... } })
//
// EVIDENCE NEVER PASSES THROUGH A MODEL. args carries only a slim index — position,
// dimension, severity, title — enough to allocate the verify quota. Each verify agent
// then READS `findingsPath` from disk and pulls its own finding by index, so the
// `evidence` string (which quotes the spec and must match it byte-for-byte to be
// checkable) is never retyped by anything.
//
// That constraint is measured, not theoretical: handed a 10-finding array and told
// explicitly to preserve exact characters, a relay agent converted 26 of 26 curly quotes
// to ASCII and reported success (2026-08-01). Dashes, ellipses, § and Δ all survived, so
// it is quote normalization rather than sloppiness — and quotes are exactly what evidence
// is made of. Passing the full findings through `args` would put the skill's own model in
// that same copy path, which is the thing this whole split exists to prevent.
//
// The finders are Codex; the verifiers here are Claude. That cross-lineage split is the
// point — a same-model panel confirms the finder's own misreadings.

// args may arrive JSON-stringified (observed on Windows 2026-08-02): parse-if-string, fail soft.
const A = (() => {
  if (typeof args === 'object' && args) return args
  if (typeof args === 'string') { try { const p = JSON.parse(args); if (p && typeof p === 'object') return p } catch {} }
  return {}
})()
const SPEC_PATH = A.specPath || ''
const FINDINGS_PATH = A.findingsPath || ''
const FINDER_FAILURES = Array.isArray(A.finderFailures) ? A.finderFailures : []
if (!SPEC_PATH) return { error: 'codex-spec-verify: args.specPath is required' }
if (!FINDINGS_PATH) return { error: 'codex-spec-verify: args.findingsPath is required (evidence is read from disk, never passed inline)' }

// The index is the ONLY finding data crossing the args boundary. Anything richer than
// this (evidence, suggestion) must be read from findingsPath by the agent that needs it.
const ALL = (Array.isArray(A.index) ? A.index : [])
  .map((e, n) => ({
    i: Number.isFinite(e?.i) ? e.i : n,
    dimension: e?.dimension || 'unknown',
    severity: e?.severity || 'NOTE',
    title: e?.title || '(untitled)',
  }))

const baseName = (p) => { const parts = String(p).split('/'); return parts[parts.length - 1] || String(p) }

// --- knobs ------------------------------------------------------------------
const VERIFY_PARAMS = {
  full:         { votes: 3, refute: 2, cap: 30, floor: 4, driftFraction: 0.5 },
  conservative: { votes: 2, refute: 2, cap: 20, floor: 3, driftFraction: 0.5 },
  balanced:     { votes: 1, refute: 1, cap: 12, floor: 2, driftFraction: 0.5 },
  aggressive:   { votes: 1, refute: 1, cap: 8,  floor: 1, driftFraction: 0.5 },
}
const LEVEL = VERIFY_PARAMS[A.verify] ? A.verify : 'conservative'
const vp = { ...VERIFY_PARAMS[LEVEL] }
if (Number.isFinite(A.floor)) vp.floor = A.floor
if (Number.isFinite(A.driftFraction)) vp.driftFraction = A.driftFraction
const VERIFY_MODEL = A.verifyModel || undefined
const BASE_MODEL = A.model || undefined
const withModel = (opts, m) => (m ? { ...opts, model: m } : opts)
const LOW_CONFIDENCE = vp.votes < 2

log('codex-spec verify — ' + baseName(SPEC_PATH) + ' | ' + ALL.length + ' raw findings from Codex' +
    ' | verify=' + LEVEL + ' (' + vp.votes + '-vote, cap ' + vp.cap + ', floor ' + vp.floor + ')' +
    (LOW_CONFIDENCE ? ' | LOW-CONFIDENCE (single verifier)' : ''))
if (FINDER_FAILURES.length) log('WARNING: ' + FINDER_FAILURES.length + ' Codex reviewer(s) failed during the find phase — coverage is incomplete: ' + FINDER_FAILURES.map(f => f.id).join(', '))

if (!ALL.length) {
  return {
    specPath: SPEC_PATH, mode: { verify: LEVEL, votes: vp.votes }, finderFailures: FINDER_FAILURES,
    summary: 'Codex raised no findings on ' + baseName(SPEC_PATH) + '.',
    reportMarkdown: '# codex-spec review: ' + baseName(SPEC_PATH) + '\n\n**Verdict:** Codex returned no findings across the requested dimensions.\n' +
      (FINDER_FAILURES.length ? '\n> ⚠ ' + FINDER_FAILURES.length + ' reviewer(s) FAILED — this is not a clean result, it is an incomplete one.\n' : ''),
    counts: { blocker: 0, drift: 0, ambiguity: 0, gap: 0, note: 0 },
    confirmedFindings: [], contestedFindings: [], droppedFindings: [], unverifiedFindings: [],
    stats: { raw: 0, verified: 0, confirmed: 0, contested: 0, dropped: 0, unverified: 0 },
  }
}

// --- per-dimension verify quota ---------------------------------------------
// Severity-only ranking starves the dimensions that emit AMBIGUITY/GAP: drift and
// reality mint BLOCKER/DRIFT, which win every slot. Measured across 7 ultraspec
// reports (2026-08-01): confirmed AMBIGUITY = 0 and confirmed GAP = 0, every time —
// those dimensions could not reach verification at all. Floors fix that.
const NON_DRIFT_DIMS = ['spec-vs-code reality', 'internal quality', 'build-readiness']
const DRIFT_DIM = 'cross-spec drift'
const sevRank = { BLOCKER: 0, DRIFT: 1, AMBIGUITY: 2, GAP: 3, NOTE: 4 }

const allocateVerify = (eligible, cap, { floor, driftFraction }) => {
  const byDim = {}
  for (const f of eligible) (byDim[f.dimension] ||= []).push(f)
  const picked = new Set()
  const take = (arr, n) => { for (const f of arr || []) { if (picked.size >= cap || n <= 0) return; if (!picked.has(f)) { picked.add(f); n-- } } }
  for (const d of NON_DRIFT_DIMS) take(byDim[d], floor)          // 1: guarantee each non-drift dim a floor
  take(byDim[DRIFT_DIM], Math.ceil(cap * driftFraction))          // 2: cap drift's share
  take(eligible.filter((f) => !picked.has(f)), cap)               // 3: fill the rest by severity
  return eligible.filter((f) => picked.has(f)).slice(0, cap)
}

const ranked = [...ALL].sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9))
const toVerify = allocateVerify(ranked, vp.cap, vp)
const verifySet = new Set(toVerify)
const unverified = ranked.filter((f) => !verifySet.has(f))
const dimCount = (list) => list.reduce((a, f) => { a[f.dimension] = (a[f.dimension] || 0) + 1; return a }, {})
log('verifying ' + toVerify.length + '/' + ranked.length + ' — by dimension: ' + JSON.stringify(dimCount(toVerify)))
if (unverified.length) log('NOTE: ' + unverified.length + ' finding(s) listed UNVERIFIED (beyond cap ' + vp.cap + ')')

// --- Phase 1: Verify --------------------------------------------------------
phase('Verify')
const VERDICT_SCHEMA = {
  type: 'object', required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
    correctedSeverity: { enum: ['BLOCKER', 'DRIFT', 'AMBIGUITY', 'GAP', 'NOTE'] },
  },
}

const VERIFY_PROMPT = (f, v) =>
  '## Adversarial Spec-Finding Verifier (voter ' + (v + 1) + '/' + vp.votes + ')\n\n' +
  'Be SKEPTICAL. Try to REFUTE this finding. ' + vp.refute + '/' + vp.votes + ' refutations kill it.\n\n' +
  'Target spec: ' + SPEC_PATH + '\n\n' +
  '## Step 1 — read the finding from disk\n' +
  'Read `' + FINDINGS_PATH + '` and take element **' + f.i + '** of its `findings` array (0-indexed).\n' +
  'Use the `evidence`, `specLocation` and `suggestion` text from THAT object verbatim — it quotes the spec, and the quotation must match the spec exactly for you to check it. Do not work from the summary below.\n' +
  'For orientation only — dimension: ' + f.dimension + ' · severity: ' + f.severity + ' · title: ' + f.title + '\n\n' +
  '## Checklist\n' +
  '1. Re-read the cited spec section (Read). Does it actually say what the finding claims, or is this a misreading?\n' +
  '2. For drift/reality findings, re-grep the sibling spec or the codebase. Is the conflict real and current? An assertion that something does NOT exist must be re-proven — grep by content, and for migrations never by filename alone.\n' +
  '3. **A spec is forward-looking.** "Not built yet" is the normal state of a spec and is NOT a defect. Refute any finding whose substance is merely that planned work is unbuilt — UNLESS another part of this same spec assumes it already exists.\n' +
  '4. Real problem, or a stylistic nitpick?\n' +
  '5. A settled deferral (PRODUCT-CONCERNS.md, .planning/debug/**/*.deferred.md) or a choice the spec already justifies? Read the lines around the citation.\n' +
  '6. Is the severity inflated or deflated? Set correctedSeverity if so.\n\n' +
  'Note: a spec that leaves a security-relevant contract (authorization, ownership, privacy predicate, replay) to implementer discretion IS a real finding — do not refute it on the grounds that a careful implementer would add it.\n\n' +
  'refuted=true if: misread, not actually a conflict, nitpick, settled deferral, already addressed, or merely-unbuilt. refuted=false ONLY if real, specific, and actionable. Default to refuted=true when you cannot verify the evidence. Reason MUST quote what you actually found.\n\nStructured output only.'

// Contested deliberately catches BOTH (refute - 1) and (refute) refutations: landing exactly
// on the kill threshold is the noisiest signal there is, since verifiers are nondeterministic
// and a re-run could land either side. Surfacing for human adjudication beats silently dropping.
const classifyVerdict = (validCount, refutedCount) => {
  if (validCount < vp.refute) return 'contested'
  if (refutedCount === 0) return 'confirmed'
  if (validCount - refutedCount === 0) return 'killed'
  if (vp.votes >= 2 && (refutedCount === vp.refute - 1 || refutedCount === vp.refute)) return 'contested'
  return refutedCount < vp.refute ? 'confirmed' : 'killed'
}

const verified = (await parallel(
  toVerify.map((finding) => () =>
    parallel(
      Array.from({ length: vp.votes }, (_, v) => () =>
        agent(VERIFY_PROMPT(finding, v), withModel({ label: 'v' + v + ':' + String(finding.title).slice(0, 28), phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'Explore' }, VERIFY_MODEL))
      )
    ).then((votes) => {
      const valid = votes.filter(Boolean)
      const refuted = valid.filter((x) => x.refuted).length
      const verdict = classifyVerdict(valid.length, refuted)
      const corrected = valid.map((x) => x.correctedSeverity).filter(Boolean)
      log('"' + String(finding.title).slice(0, 44) + '": ' + (valid.length - refuted) + '-' + refuted + ' ' + verdict)
      return { ...finding, refutedVotes: refuted, validVotes: valid.length, verdict, correctedSeverity: corrected[0] || null }
    })
  )
)).filter(Boolean)

const confirmed = verified.filter((f) => f.verdict === 'confirmed')
const contested = verified.filter((f) => f.verdict === 'contested')
const killed = verified.filter((f) => f.verdict === 'killed')
log('Verify: ' + confirmed.length + ' confirmed, ' + contested.length + ' contested, ' + killed.length + ' dropped')

// --- Phase 2: Synthesize ----------------------------------------------------
phase('Synthesize')
const REPORT_SCHEMA = {
  type: 'object', required: ['summary', 'reportMarkdown', 'counts'],
  properties: {
    summary: { type: 'string' },
    reportMarkdown: { type: 'string' },
    counts: { type: 'object', properties: { blocker: { type: 'number' }, drift: { type: 'number' }, ambiguity: { type: 'number' }, gap: { type: 'number' }, note: { type: 'number' } } },
    topFindings: { type: 'array', items: { type: 'object', required: ['severity', 'title'], properties: { severity: { type: 'string' }, title: { type: 'string' }, specLocation: { type: 'string' } } } },
  },
}

// Findings are referenced by INDEX. The synthesizer reads their evidence from
// findingsPath itself — see the header note: evidence never crosses a model boundary.
const block = (list) => list.map((f) =>
  '- findings[' + f.i + ']  (' + f.severity + ' / ' + f.dimension + ')  vote ' + (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes +
  (f.correctedSeverity ? '  (verifier suggests severity ' + f.correctedSeverity + ')' : '') + '\n  ' + f.title
).join('\n') || '(none)'
const slimList = (list) => list.map((f) => '- findings[' + f.i + ']  (' + f.severity + ' / ' + (f.dimension || '?') + ')  ' + f.title).join('\n') || '(none)'

const banners = []
if (LOW_CONFIDENCE) banners.push('> ⚠ **LOW-CONFIDENCE PASS** (verify=' + LEVEL + '): each finding was checked by a single verifier, with no adversarial cross-check. Treat as a shallow first pass, not a trust gate.')
if (FINDER_FAILURES.length) banners.push('> ⚠ **INCOMPLETE COVERAGE**: ' + FINDER_FAILURES.length + ' Codex reviewer(s) failed during the find phase (' + FINDER_FAILURES.map((f) => f.id + ' — ' + f.reason).join('; ') + '). Dimensions they covered were not reviewed. Do NOT read a low finding count as a clean spec.')

const report = await agent(
  '## Synthesis: cross-model spec review report\n\n' +
  'Target spec: ' + SPEC_PATH + '\nSpec title: ' + (A.specTitle || '(untitled)') + '\n' +
  'Findings were raised by **OpenAI Codex** (' + (A.generatedBy?.model || 'codex') + ') and verified by a ' + vp.votes + '-vote Claude adversarial panel.\n\n' +
  confirmed.length + ' confirmed, ' + contested.length + ' contested, ' + killed.length + ' dropped, ' + unverified.length + ' unverified.\n\n' +
  (banners.length ? '## Banners — include these lines VERBATIM, in order, immediately under the title:\n' + banners.join('\n') + '\n\n' : '') +
  '## Confirmed findings\n' + block(confirmed) + '\n\n' +
  '## Contested (panel split — one vote from flipping)\n' + slimList(contested) + '\n\n' +
  '## Unverified (beyond the verify cap — never adversarially checked)\n' + slimList(unverified) + '\n\n' +
  '## Instructions\n' +
  '0. **Read `' + FINDINGS_PATH + '` first.** The lists above give each finding\'s INDEX into its `findings` array. Pull `specLocation`, `evidence` and `suggestion` for every finding you write up from that file, and reproduce the evidence text VERBATIM — it quotes the spec, and a reader diffs it against the spec. Never paraphrase, re-punctuate, or "tidy" a quotation.\n' +
  '1. Merge findings that say the same thing (combine their evidence; note the merge).\n' +
  '2. Group by dimension (Cross-spec drift / Spec-vs-code reality / Internal quality / Build-readiness); within each, order BLOCKER→DRIFT→AMBIGUITY→GAP→NOTE.\n' +
  '3. reportMarkdown: titled "# codex-spec review: ' + baseName(SPEC_PATH) + '", then any banner lines verbatim, then a one-paragraph verdict, then a severity-count table, then the grouped CONFIRMED findings as checkbox items with location, evidence and suggested fix.\n' +
  '4. counts: CONFIRMED findings per severity only — exclude contested and unverified.\n' +
  '5. topFindings: the confirmed BLOCKER and DRIFT items.\n' +
  '6. Append "## Contested (split verdict — needs human adjudication)" and "## Unverified (not adversarially checked)" sections listing those verbatim. Do NOT fold either into counts or topFindings.\n' +
  '7. State in the verdict paragraph that the finders were Codex and the verifiers were Claude, so a reader comparing this to an /ultraspec run on the same spec knows the panel changed.\n' +
  'Be concise and actionable. Do NOT invent findings beyond those listed above.\n\nStructured output only.',
  withModel({ label: 'synthesize', phase: 'Synthesize', schema: REPORT_SCHEMA, agentType: 'Explore' }, BASE_MODEL)
)

// `index` points back into findingsPath for the full evidence; it is deliberately not
// copied here, so nothing downstream can quietly hand around a mutated quotation.
const slim = (f) => ({ index: f.i, severity: f.severity, dimension: f.dimension, title: f.title, correctedSeverity: f.correctedSeverity || null, vote: (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes })
const stats = {
  raw: ALL.length, verified: verified.length, confirmed: confirmed.length,
  contested: contested.length, dropped: killed.length, unverified: unverified.length,
  byDimensionVerified: dimCount(toVerify), finderFailures: FINDER_FAILURES.length,
}
const out = {
  specPath: SPEC_PATH,
  mode: { verify: LEVEL, votes: vp.votes, floor: vp.floor, driftFraction: vp.driftFraction, finders: 'codex', verifiers: 'claude', codex: A.generatedBy || null },
  finderFailures: FINDER_FAILURES,
  confirmedFindings: confirmed.map(slim),
  contestedFindings: contested.map(slim),
  droppedFindings: killed.map(slim),
  unverifiedFindings: unverified.map((f) => ({ index: f.i, severity: f.severity, dimension: f.dimension, title: f.title })),
  findingsPath: FINDINGS_PATH,
  stats,
}
if (!report) return { ...out, error: 'Synthesis failed — returning verified findings raw.' }

// Belt-and-braces: the banners are the run's honesty markers; never let a synthesizer drop them.
let md = report.reportMarkdown || ''
for (const b of banners) if (md && !md.includes(b.slice(0, 40))) md = md.replace(/^(#[^\n]*\n)/, '$1\n' + b + '\n')
return { ...out, ...report, reportMarkdown: md }
