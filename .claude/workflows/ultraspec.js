export const meta = {
  name: 'ultraspec',
  description: 'In-session multi-agent spec auditor with per-stage model + cost knobs and quick/balanced/in-depth presets. Manifest -> Review (drift/reality/quality/readiness) -> adversarial Verify -> Synthesize.',
  phases: [
    { title: 'Manifest', detail: 'read target spec -> sections + claimed artifacts + sibling specs' },
    { title: 'Review', detail: 'parallel reviewers across dimensions x items, reading the real files (drift scope set by mode)' },
    { title: 'Verify', detail: 'adversarial verification per finding (full=3-vote; efficient lowers votes/scope)' },
    { title: 'Synthesize', detail: 'merge, severity-rank, emit a REVIEW report' },
  ],
}

// ultraspec + knobs. Invoke: Workflow({ scriptPath, args: '<path-to-spec> [--no-fix]
//   [--efficient[=level]] [--drift=level] [--verify=level]
//   [--preset=quick|balanced|in-depth | --quick|--balanced|--in-depth]
//   [--model=<m>] [--review-model=<m>] [--verify-model=<m>] [--fable-review]' })
// Fix-proposal ON by default (proposes edits for confirmed BLOCKER/DRIFT; never applies). --no-fix to skip.
// Cost levels: full|conservative|balanced|aggressive dial drift breadth + verify depth. Models: opus|sonnet|haiku|fable per stage.

const DRIFT_PARAMS = {
  full:         { crossRefOnly: false, cap: Infinity },
  conservative: { crossRefOnly: true,  cap: 8 },
  balanced:     { crossRefOnly: true,  cap: 5 },
  aggressive:   { crossRefOnly: true,  cap: 3 },
}
const VERIFY_PARAMS = {
  full:         { votes: 3, refute: 2, severities: ['BLOCKER', 'DRIFT', 'AMBIGUITY', 'GAP', 'NOTE'], cap: 30 },
  conservative: { votes: 2, refute: 2, severities: ['BLOCKER', 'DRIFT', 'AMBIGUITY', 'GAP', 'NOTE'], cap: 20 },
  balanced:     { votes: 1, refute: 1, severities: ['BLOCKER', 'DRIFT'], cap: 12 },
  aggressive:   { votes: 1, refute: 1, severities: ['BLOCKER'], cap: 8 },
}
const ARTIFACTS_PER_BATCH = 8

// --- Parse args ---
const RAW = (typeof args === 'string' ? args : '').trim()
const TOKENS = RAW.split(/\s+/).filter(Boolean)
const FIX = !TOKENS.includes('--no-fix')
const SPEC_PATH = TOKENS.filter(t => !t.startsWith('--'))[0] || ''
if (!SPEC_PATH) {
  return { error: 'Usage: /ultraspec <path-to-spec> [--no-fix] [--quick|--balanced|--in-depth] [--model=<m>] .... No spec path provided.' }
}
const baseName = (p) => { const parts = String(p).split('/'); return parts[parts.length - 1] || String(p) }

// --- Shared knob preamble (keep byte-identical with ultra-review; only PARAMS/severities differ) ---
const LEVELS = ['full', 'conservative', 'balanced', 'aggressive']
const MODELS = ['opus', 'sonnet', 'haiku', 'fable']
const PRESETS = {
  // Ordered cheap -> expensive. fable is the BEST and PRICIEST model, so it belongs
  // in in-depth's verify slot (the one call where quality matters most), NEVER as
  // quick's cheap finder. Verify stays strong across all presets on purpose: a cheap
  // finder with a strong verifier is the point of `quick`, and a weak verifier is how
  // false positives get through (see reference: PR#109 correlated-verifier misreads).
  quick:      { costDrift: 'aggressive',   costVerify: 'aggressive',   mBase: 'haiku',  mReview: 'haiku',  mVerify: 'opus'  },
  balanced:   { costDrift: 'conservative', costVerify: 'conservative', mBase: 'sonnet', mReview: 'sonnet', mVerify: 'opus'  },
  'in-depth': { costDrift: 'full',         costVerify: 'full',         mBase: 'opus',   mReview: 'opus',   mVerify: 'fable' },
}
const flagVal = (name) => {
  const pre = '--' + name
  for (const t of TOKENS) {
    if (t.toLowerCase() === pre) return ''
    if (t.toLowerCase().startsWith(pre + '=')) return t.slice(pre.length + 1).toLowerCase()
  }
  return undefined
}
let presetName = flagVal('preset')
if (!presetName) { for (const n of Object.keys(PRESETS)) { if (flagVal(n) !== undefined) { presetName = n; break } } }
if (presetName && !PRESETS[presetName]) { log('WARNING: unknown preset "' + presetName + '"; ignoring'); presetName = undefined }
const preset = presetName ? PRESETS[presetName] : undefined

const effRaw = flagVal('efficient')
const effLevel = effRaw === undefined ? undefined : (LEVELS.includes(effRaw) ? effRaw : 'balanced')
const driftFallback = effLevel ?? (preset ? preset.costDrift : undefined) ?? 'full'
const verifyFallback = effLevel ?? (preset ? preset.costVerify : undefined) ?? 'full'
const pickLevel = (raw, fb) => (raw && LEVELS.includes(raw) ? raw : fb)
const DRIFT_LEVEL = pickLevel(flagVal('drift'), driftFallback)
const VERIFY_LEVEL = pickLevel(flagVal('verify'), verifyFallback)
const dp = DRIFT_PARAMS[DRIFT_LEVEL]
const vp = VERIFY_PARAMS[VERIFY_LEVEL]

const modelFlag = (name) => {
  const raw = flagVal(name)
  if (raw === undefined || raw === '') return undefined
  if (MODELS.includes(raw)) return raw
  log('WARNING: ignoring unknown model "' + raw + '" for --' + name + ' (expected ' + MODELS.join('/') + '); inheriting session model')
  return undefined
}
const pm = (k) => (preset ? preset[k] : undefined)
// Precedence, most specific wins: stage flag > --fable-review (review only) >
// explicit --model > preset stage default > BASE_MODEL > inherit session model.
// EXPLICIT_MODEL must outrank pm(): a flag the user TYPED beats a default they
// did not. Before this, `--quick --model=opus` reviewed with the preset's model
// because pm('mReview') short-circuited ahead of BASE_MODEL.
const EXPLICIT_MODEL = modelFlag('model')
const BASE_MODEL = EXPLICIT_MODEL ?? pm('mBase')
const REVIEW_MODEL = modelFlag('review-model') ?? (flagVal('fable-review') !== undefined ? 'fable' : undefined) ?? EXPLICIT_MODEL ?? pm('mReview') ?? BASE_MODEL
const VERIFY_MODEL = modelFlag('verify-model') ?? EXPLICIT_MODEL ?? pm('mVerify') ?? BASE_MODEL
const withModel = (opts, m) => (m ? { ...opts, model: m } : opts)
const modelLabel = (m) => m || 'inherit'
const LOW_CONFIDENCE = vp.votes < 2
const MODE = { drift: DRIFT_LEVEL, verify: VERIFY_LEVEL, preset: presetName || null, models: { base: modelLabel(BASE_MODEL), review: modelLabel(REVIEW_MODEL), verify: modelLabel(VERIFY_MODEL) } }
log('Mode: ' + (presetName ? 'preset=' + presetName + ' -> ' : '') + 'drift=' + DRIFT_LEVEL + ', verify=' + VERIFY_LEVEL + (FIX ? ', fix' : '') + ' | models: base=' + modelLabel(BASE_MODEL) + ' review=' + modelLabel(REVIEW_MODEL) + ' verify=' + modelLabel(VERIFY_MODEL) + (LOW_CONFIDENCE ? ' | LOW-CONFIDENCE (1-vote verify)' : ''))

// --- Schemas ---
const MANIFEST_SCHEMA = {
  type: 'object',
  required: ['targetFound', 'sections', 'artifacts', 'siblingSpecs'],
  properties: {
    targetFound: { type: 'boolean' },
    title: { type: 'string' },
    summary: { type: 'string' },
    sections: { type: 'array', items: {
      type: 'object', required: ['heading'],
      properties: { heading: { type: 'string' }, line: { type: 'number' } },
    }},
    artifacts: { type: 'array', items: {
      type: 'object', required: ['kind', 'name'],
      properties: {
        kind: { enum: ['table', 'migration', 'route', 'rpc', 'file', 'env', 'other'] },
        name: { type: 'string' },
        specSection: { type: 'string' },
      },
    }},
    crossRefs: { type: 'array', items: {
      type: 'object', required: ['spec'],
      properties: { spec: { type: 'string' }, concept: { type: 'string' } },
    }},
    siblingSpecs: { type: 'array', items: { type: 'string' } },
  },
}
const FINDINGS_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: { type: 'array', items: {
      type: 'object', required: ['severity', 'title', 'specLocation', 'evidence'],
      properties: {
        severity: { enum: ['BLOCKER', 'DRIFT', 'AMBIGUITY', 'GAP', 'NOTE'] },
        title: { type: 'string' },
        specLocation: { type: 'string' },
        evidence: { type: 'string' },
        suggestion: { type: 'string' },
        confidence: { enum: ['high', 'medium', 'low'] },
      },
    }},
  },
}
const VERDICT_SCHEMA = {
  type: 'object', required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
    correctedSeverity: { enum: ['BLOCKER', 'DRIFT', 'AMBIGUITY', 'GAP', 'NOTE'] },
  },
}
const REPORT_SCHEMA = {
  type: 'object', required: ['summary', 'reportMarkdown', 'counts'],
  properties: {
    summary: { type: 'string' },
    reportMarkdown: { type: 'string' },
    counts: { type: 'object', properties: {
      blocker: { type: 'number' }, drift: { type: 'number' },
      ambiguity: { type: 'number' }, gap: { type: 'number' }, note: { type: 'number' },
    }},
    topFindings: { type: 'array', items: {
      type: 'object', required: ['severity', 'title'],
      properties: { severity: { type: 'string' }, title: { type: 'string' }, specLocation: { type: 'string' } },
    }},
  },
}
const FIX_SCHEMA = {
  type: 'object', required: ['edits'],
  properties: {
    edits: { type: 'array', items: {
      type: 'object', required: ['specLocation', 'change'],
      properties: { specLocation: { type: 'string' }, findingTitle: { type: 'string' }, change: { type: 'string' } },
    }},
    patchMarkdown: { type: 'string' },
  },
}

// --- Phase 1: Manifest ---
phase('Manifest')
const manifest = await agent(
  '## Spec Manifest Builder\n\n' +
  'Target spec: ' + SPEC_PATH + '\n\n' +
  '## Task\n' +
  '1. Read the target spec at ' + SPEC_PATH + ' (Read tool). If it does not exist, return targetFound:false and stop.\n' +
  '2. List sibling specs to diff against: run `ls .planning/specs/*.md .planning/individual_to_team.md`. EXCLUDE the target itself and anything under .planning/specs/reviews/. Return their paths in siblingSpecs.\n' +
  '3. Extract a section map: every ## / ### heading with its line number.\n' +
  '4. Extract every concrete ARTIFACT the spec claims will exist or change, typed as table | migration | route | rpc | file | env | other. Capture the exact name. Tag each with the spec section it appears in.\n' +
  '5. Extract cross-references: where the spec names or relies on another spec / a concept owned elsewhere.\n' +
  '6. Read PRODUCT-CONCERNS.md if present; in summary, note which deferrals are settled so later phases will not re-flag them.\n\n' +
  'Structured output only.',
  withModel({ label: 'manifest', phase: 'Manifest', schema: MANIFEST_SCHEMA, agentType: 'Explore' }, BASE_MODEL)
)
if (!manifest || !manifest.targetFound) {
  return { error: 'Target spec not found or unreadable: ' + SPEC_PATH, specPath: SPEC_PATH }
}
const siblings = (manifest.siblingSpecs || []).filter(s => s && s !== SPEC_PATH)
const artifacts = manifest.artifacts || []
log('Manifest: ' + (manifest.sections ? manifest.sections.length : 0) + ' sections, ' + artifacts.length + ' artifacts, ' + siblings.length + ' siblings')

// --- Phase 2: Review ---
phase('Review')
const tagDim = (dim) => (r) => {
  if (!r) return null
  return { findings: (r.findings || []).map(f => ({ ...f, dimension: dim })) }
}
const DRIFT_PROMPT = (sib) =>
  '## Cross-Spec Drift Reviewer\n\n' +
  'Target spec: ' + SPEC_PATH + '\nSibling spec: ' + sib + '\n\n' +
  '## Task\nRead BOTH specs (Read; Grep for shared terms). Find DRIFT between target and sibling, in three modes:\n' +
  '1. STALE ECHO - the target changed a concept but this sibling still describes the old version (or vice versa).\n' +
  '2. STALE COPY - this sibling embeds a copy of an artifact the target owns (RPC call, response shape, message format, migration) that no longer matches the target.\n' +
  '3. MISSING REFERENCE - the target adds/changes something this sibling should reference or account for, but does not.\n\n' +
  'Grep for RELATED phrasings, not just exact terms. Quote the conflicting text from BOTH specs in evidence, with section/line.\n' +
  'Severity: BLOCKER if the mismatch will cause an implementation bug; else DRIFT. Only report real, specific conflicts. If clean, return findings: [].\n\nStructured output only.'
const REALITY_PROMPT = (batch, bi) =>
  '## Spec-vs-Code Reality Reviewer (batch ' + (bi + 1) + ')\n\n' +
  'Target spec: ' + SPEC_PATH + '\n\n' +
  '## Artifacts to check (claimed by the spec)\n' +
  batch.map(a => '- [' + a.kind + '] ' + a.name + '  (spec section: ' + (a.specSection || '?') + ')').join('\n') + '\n\n' +
  '## Task\nFor EACH artifact, determine whether it exists in the codebase and matches the spec, using Grep/Read/Glob (and gh only if needed).\n' +
  '- table/migration -> search supabase/migrations/ and lib/ for the name.\n' +
  '- route -> search app/api for the path.   - rpc -> search migrations + call sites.\n' +
  '- file -> check the path exists and does what the spec says.   - env -> search the var name + lib/env.ts.\n\n' +
  'Classify each mismatch:\n' +
  '- SPEC-AHEAD-OF-CODE: planned but not yet built - usually GAP/NOTE (expected for a forward-looking spec); only BLOCKER if another part of the SAME spec assumes it already exists.\n' +
  '- CODE-DRIFTED-FROM-SPEC: exists but differs (wrong columns, different signature, renamed) - BLOCKER or DRIFT.\n' +
  'Quote the spec claim AND the code reality (file:line) in evidence. Do NOT flag not-yet-built artifacts in a forward-looking spec as errors. If all match or are legitimately not-yet-built, return findings: [].\n\nStructured output only.'
const QUALITY_PROMPT = () =>
  '## Internal Quality Reviewer\n\n' +
  'Target spec: ' + SPEC_PATH + '\n\n' +
  '## Task\nRead the full spec. Find internal-quality defects:\n' +
  '- AMBIGUITY: a requirement interpretable two ways, or unfalsifiable.\n' +
  '- CONTRADICTION: two parts of THIS spec that conflict (severity BLOCKER if it causes a bug).\n' +
  '- GAP: TBD/TODO/placeholder, or an open decision that blocks building.\n' +
  '- SCOPE: scope creep / multiple independent features that should be split.\n' +
  'Quote the offending text with section/line. Respect settled deferrals in PRODUCT-CONCERNS.md. If clean, return findings: [].\n\nStructured output only.'
const READINESS_PROMPT = () =>
  '## Build-Readiness Reviewer\n\n' +
  'Target spec: ' + SPEC_PATH + '\n\n' +
  '## Task\nRead the full spec as an engineer about to implement it. Flag anything that would stall implementation:\n' +
  '- steps without file-level specificity (no named file/function/migration)\n' +
  '- missing or hand-wavy test strategy (this repo mandates Vitest + adversarial test inputs + collocated __tests__)\n' +
  '- unclear sequencing / unstated dependencies between steps\n' +
  '- steps that assume undocumented behavior\n' +
  'Each finding: quote the vague step and say what is missing to build it. Severity GAP (or BLOCKER if impossible to start as written). If build-ready, return findings: [].\n\nStructured output only.'

const normRef = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
const crossRefTokens = (manifest.crossRefs || []).map(c => normRef(c.spec)).filter(t => t.length >= 3)
const isCrossRef = (sib) => { const b = normRef(baseName(sib).replace(/\.md$/i, '')); return b.length >= 3 && crossRefTokens.some(cr => b.includes(cr) || cr.includes(b)) }
let driftSiblings = siblings
let driftFallbackUsed = false
if (dp.crossRefOnly) {
  const matched = siblings.filter(isCrossRef)
  if (matched.length) driftSiblings = matched
  else driftFallbackUsed = true
  driftSiblings = driftSiblings.slice(0, dp.cap)
}
log('Drift scope: ' + driftSiblings.length + '/' + siblings.length + ' siblings' + (dp.crossRefOnly ? (driftFallbackUsed ? ' (no cross-refs detected -> capped fallback)' : ' (cross-referenced)') : ' (all)'))

const reviewThunks = []
for (const sib of driftSiblings) {
  reviewThunks.push(() => agent(DRIFT_PROMPT(sib), withModel({ label: 'drift:' + baseName(sib), phase: 'Review', schema: FINDINGS_SCHEMA, agentType: 'Explore' }, REVIEW_MODEL)).then(tagDim('cross-spec drift')))
}
const batches = []
for (let i = 0; i < artifacts.length; i += ARTIFACTS_PER_BATCH) batches.push(artifacts.slice(i, i + ARTIFACTS_PER_BATCH))
batches.forEach((batch, bi) => {
  reviewThunks.push(() => agent(REALITY_PROMPT(batch, bi), withModel({ label: 'reality:' + (bi + 1), phase: 'Review', schema: FINDINGS_SCHEMA, agentType: 'Explore' }, REVIEW_MODEL)).then(tagDim('spec-vs-code reality')))
})
reviewThunks.push(() => agent(QUALITY_PROMPT(), withModel({ label: 'quality', phase: 'Review', schema: FINDINGS_SCHEMA, agentType: 'Explore' }, REVIEW_MODEL)).then(tagDim('internal quality')))
reviewThunks.push(() => agent(READINESS_PROMPT(), withModel({ label: 'readiness', phase: 'Review', schema: FINDINGS_SCHEMA, agentType: 'Explore' }, REVIEW_MODEL)).then(tagDim('build-readiness')))

const reviewResults = (await parallel(reviewThunks)).filter(Boolean)
const allFindings = reviewResults.flatMap(r => r.findings || [])
log('Review: ' + allFindings.length + ' raw findings from ' + reviewResults.length + ' reviewers')

const sevRank = { BLOCKER: 0, DRIFT: 1, AMBIGUITY: 2, GAP: 3, NOTE: 4 }
const ranked = [...allFindings].sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9))

const emptyStats = { drift: DRIFT_LEVEL, verify: VERIFY_LEVEL, siblings: siblings.length, driftSiblings: driftSiblings.length, artifacts: artifacts.length, reviewers: reviewResults.length, rawFindings: allFindings.length }
if (allFindings.length === 0) {
  return {
    specPath: SPEC_PATH, fixMode: FIX, mode: MODE,
    summary: 'Clean: ' + SPEC_PATH + ' raised no findings across ' + reviewResults.length + ' reviewers (' + driftSiblings.length + ' siblings checked, ' + artifacts.length + ' artifacts).',
    reportMarkdown: '# ultraspec review: ' + baseName(SPEC_PATH) + '\n\n**Verdict:** clean. No drift, reality, quality, or readiness findings.\n',
    counts: { blocker: 0, drift: 0, ambiguity: 0, gap: 0, note: 0 },
    confirmedFindings: [], contestedFindings: [], droppedFindings: [], unverifiedFindings: [],
    stats: { ...emptyStats, verified: 0, confirmed: 0, contested: 0, dropped: 0, unverified: 0 },
  }
}

const eligible = ranked.filter(f => vp.severities.includes(f.severity))
const toVerify = eligible.slice(0, vp.cap)
const verifySet = new Set(toVerify)
const unverified = ranked.filter(f => !verifySet.has(f))
if (unverified.length > 0) log('NOTE: ' + unverified.length + ' finding(s) listed UNVERIFIED at verify=' + VERIFY_LEVEL + ' (below severity threshold or beyond cap ' + vp.cap + ')')

// --- Phase 3: Verify ---
phase('Verify')
const VERIFY_PROMPT = (f, v) =>
  '## Adversarial Finding Verifier (voter ' + (v + 1) + '/' + vp.votes + ')\n\n' +
  'Be SKEPTICAL. Try to REFUTE this spec-review finding. ' + vp.refute + '/' + vp.votes + ' refutations kill it.\n\n' +
  'Target spec: ' + SPEC_PATH + '\n\n' +
  '## Finding under review\nDimension: ' + f.dimension + '\nSeverity: ' + f.severity + '\nTitle: ' + f.title + '\nLocation: ' + f.specLocation + '\nEvidence: ' + f.evidence + '\n\n' +
  '## Checklist\n' +
  '1. Re-read the cited spec section (Read). Does it actually say what the finding claims, or is the finding misreading it?\n' +
  '2. For drift/reality findings, re-grep the sibling spec / codebase. Is the claimed conflict real and current?\n' +
  '3. Real problem, or a stylistic nitpick / matter of taste?\n' +
  '4. A consciously-deferred concern (PRODUCT-CONCERNS.md) or an intentional choice the spec already justifies?\n' +
  '5. Is the severity inflated? (set correctedSeverity if so)\n\n' +
  'refuted=true if: misread, not actually a conflict, nitpick, settled deferral, or already addressed in the spec. refuted=false ONLY if the finding is real, specific, and actionable. Default to refuted=true if uncertain. Reason MUST be specific.\n\nStructured output only.'

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
        agent(VERIFY_PROMPT(finding, v), withModel({ label: 'v' + v + ':' + finding.title.slice(0, 30), phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'Explore' }, VERIFY_MODEL))
      )
    ).then(votes => {
      const valid = votes.filter(Boolean)
      const refuted = valid.filter(v => v.refuted).length
      const verdict = classifyVerdict(valid.length, refuted)
      log('"' + finding.title.slice(0, 44) + '": ' + (valid.length - refuted) + '-' + refuted + ' ' + verdict)
      return { ...finding, refutedVotes: refuted, validVotes: valid.length, verdict }
    })
  )
)).filter(Boolean)

const confirmed = verified.filter(f => f.verdict === 'confirmed')
const contested = verified.filter(f => f.verdict === 'contested')
const killed = verified.filter(f => f.verdict === 'killed')
log('Verify: ' + confirmed.length + ' confirmed, ' + contested.length + ' contested, ' + killed.length + ' dropped')

// --- Phase 4: Synthesize ---
phase('Synthesize')
const findingsBlock = confirmed.map((f, i) =>
  '### [' + i + '] (' + f.severity + ' / ' + f.dimension + ') ' + f.title + '\n' +
  'Location: ' + f.specLocation + '   Vote: ' + (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes + '\n' +
  'Evidence: ' + f.evidence + '\n' + (f.suggestion ? 'Suggestion: ' + f.suggestion + '\n' : '')
).join('\n')
const slimUnverified = unverified.map(f => ({ severity: f.severity, dimension: f.dimension, title: f.title, specLocation: f.specLocation, evidence: f.evidence }))
const unverifiedBlock = unverified.map(f => '- (' + f.severity + ' / ' + (f.dimension || '?') + ') ' + f.title + '  @ ' + f.specLocation).join('\n')
const contestedBlock = contested.map(f => '- (' + f.severity + ' / ' + (f.dimension || '?') + ') ' + f.title + '  @ ' + f.specLocation + '  [vote ' + (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes + ']\n  Evidence: ' + f.evidence + (f.suggestion ? '\n  Suggestion: ' + f.suggestion : '')).join('\n')
const banner = LOW_CONFIDENCE
  ? '! LOW-CONFIDENCE PASS (' + (presetName || 'verify=' + VERIFY_LEVEL) + '): findings were checked by a single verifier (no adversarial cross-check). Treat as a shallow first pass, not a trust gate.'
  : ''

const report = await agent(
  '## Synthesis: spec review report\n\n' +
  'Target spec: ' + SPEC_PATH + '\nSpec title: ' + (manifest.title || '(untitled)') + '\nMode: ' + (presetName ? 'preset=' + presetName + ', ' : '') + 'drift=' + DRIFT_LEVEL + ', verify=' + VERIFY_LEVEL + '\n\n' +
  confirmed.length + ' findings confirmed, ' + contested.length + ' contested, via ' + vp.votes + '-vote adversarial verification.\n\n' +
  (banner ? '## Banner -- include this line VERBATIM as the first line under the title:\n' + banner + '\n\n' : '') +
  '## Confirmed findings\n' + (findingsBlock || '(none)') + '\n\n' +
  '## Contested findings (verify panel split -- one vote from flipping; neither confirmed nor dropped)\n' + (contestedBlock || '(none)') + '\n\n' +
  '## Unverified findings (efficient mode skipped adversarial verification for these)\n' + (unverifiedBlock || '(none)') + '\n\n' +
  '## Instructions\n' +
  '1. Merge findings that say the same thing (combine evidence).\n' +
  '2. Group by dimension (Cross-spec drift / Spec-vs-code reality / Internal quality / Build-readiness); within each, order by severity (BLOCKER->DRIFT->AMBIGUITY->GAP->NOTE).\n' +
  '3. reportMarkdown: titled "# ultraspec review: ' + baseName(SPEC_PATH) + '"' + (banner ? ', with the banner as the first line under the title,' : ',') + ' starting with a one-paragraph verdict and a severity-count table, then grouped CONFIRMED findings with location, evidence, and suggested fix. Each finding as a checkbox item.\n' +
  '4. counts: CONFIRMED findings per severity (exclude contested and unverified).\n' +
  '5. topFindings: the confirmed BLOCKER and DRIFT items.\n' +
  '6. If any contested findings exist, append a "## Contested (split adversarial verdict -- needs human adjudication)" section listing them verbatim; do NOT fold into counts/topFindings.\n' +
  '7. If any unverified findings exist, append a "## Unverified (not adversarially checked -- efficient mode)" section listing them verbatim; do NOT fold into counts/topFindings.\n' +
  'Be concise and actionable. Do not invent findings beyond those listed above.\n\nStructured output only.',
  withModel({ label: 'synthesize', phase: 'Synthesize', schema: REPORT_SCHEMA, agentType: 'Explore' }, BASE_MODEL)
)

const slimMap = (f) => ({ severity: f.severity, dimension: f.dimension, title: f.title, specLocation: f.specLocation, evidence: f.evidence, suggestion: f.suggestion, vote: (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes })
const slimConfirmed = confirmed.map(slimMap)
const slimContested = contested.map(slimMap)
const slimKilled = killed.map(slimMap)
const stats = { ...emptyStats, verified: verified.length, confirmed: confirmed.length, contested: contested.length, dropped: killed.length, unverified: unverified.length }

if (!report) {
  return { specPath: SPEC_PATH, fixMode: FIX, mode: MODE, error: 'Synthesis failed - returning verified findings raw.', confirmedFindings: slimConfirmed, contestedFindings: slimContested, droppedFindings: slimKilled, unverifiedFindings: slimUnverified, stats }
}
if (banner && report.reportMarkdown && !report.reportMarkdown.includes('LOW-CONFIDENCE')) {
  report.reportMarkdown = report.reportMarkdown.replace(/^(#[^\n]*\n)/, '$1\n' + banner + '\n')
}

// --- Optional Fix (ON by default; --no-fix to skip) ---
let proposedFix = null
if (FIX && confirmed.some(f => f.severity === 'BLOCKER' || f.severity === 'DRIFT')) {
  phase('Synthesize')
  proposedFix = await agent(
    '## Spec Fix Proposer\n\n' +
    'Target spec: ' + SPEC_PATH + '\n\n' +
    'Propose concrete edits to resolve these confirmed BLOCKER/DRIFT findings. Read the spec to get exact surrounding text. Do NOT apply anything - only propose.\n\n' +
    '## Findings\n' + confirmed.filter(f => f.severity === 'BLOCKER' || f.severity === 'DRIFT').map(f => '- (' + f.severity + ') ' + f.title + ' @ ' + f.specLocation + ' :: ' + f.evidence).join('\n') + '\n\n' +
    'For each: specLocation, findingTitle, and the precise change (old text -> new text). Also a patchMarkdown summarizing all edits.\n\nStructured output only.',
    withModel({ label: 'propose-fix', phase: 'Synthesize', schema: FIX_SCHEMA, agentType: 'Explore' }, BASE_MODEL)
  )
}

return {
  specPath: SPEC_PATH,
  fixMode: FIX,
  mode: MODE,
  ...report,
  proposedFix,
  confirmedFindings: slimConfirmed,
  contestedFindings: slimContested,
  droppedFindings: slimKilled,
  unverifiedFindings: slimUnverified,
  stats,
}
