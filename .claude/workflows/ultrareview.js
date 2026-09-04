export const meta = {
  name: 'ultrareview',
  description: 'In-session multi-agent code-diff reviewer with per-stage model + cost knobs and quick/balanced/in-depth/max presets. Manifest -> Review (4 dims x file-batch) -> Dedup -> adversarial Verify -> Synthesize.',
  phases: [
    { title: 'Manifest', detail: 'acquire the diff -> changed-file list' },
    { title: 'Review', detail: 'parallel reviewers across dimensions x file-batches, reading real files' },
    { title: 'Dedup', detail: 'merge the same defect reported by multiple dimensions, BEFORE paying to verify it' },
    { title: 'Verify', detail: 'adversarial verification per DISTINCT finding (full=3-vote; efficient lowers votes/scope)' },
    { title: 'Synthesize', detail: 'merge, severity-rank, emit a review report' },
  ],
}

// ultrareview + knobs. Invoke: Workflow({ scriptPath, args: '[<PR#>] [--working] [--no-fix] [--no-logs]
//   [--efficient[=level]] [--verify=level] [--preset=quick|balanced|in-depth|max | --quick|--balanced|--in-depth|--max]
//   [--model=<m>] [--review-model=<m>] [--verify-model=<m>] [--fable-review] [--codex-verify]' })
// Cost levels: full|conservative|balanced|aggressive (verify depth). Models: opus|sonnet|haiku|fable per stage.
// --codex-verify (= /hybrid-review): finders stay on Claude, the verify panel runs on OpenAI Codex.
//   In that mode --verify-model selects the CODEX tier (sol|terra|luna) instead of a Claude model.
// No --drift (ultrareview reviews the whole diff; cost dial trims verification only). --in-depth vs --max differ only by review model (sonnet vs opus) here, since costDrift is inert.
// A Dedup stage sits between Review and Verify: it cuts REDUNDANCY, never depth (every distinct finding still gets the full vp.votes panel).

const FILES_PER_BATCH = 6
const DIMENSIONS = [
  { key: 'correctness', label: 'Correctness & tests' },
  { key: 'security', label: 'Security & data-loss' },
  { key: 'invariants', label: 'Terum invariants' },
  { key: 'reuse', label: 'Reuse, simplify, perf' },
]
const sevRank = { critical: 0, high: 1, medium: 2, low: 3 }
const VERIFY_PARAMS = {
  full:         { votes: 3, refute: 2, severities: ['critical', 'high', 'medium', 'low'], cap: 40 },
  conservative: { votes: 2, refute: 2, severities: ['critical', 'high', 'medium', 'low'], cap: 25 },
  balanced:     { votes: 1, refute: 1, severities: ['critical', 'high'], cap: 15 },
  aggressive:   { votes: 1, refute: 1, severities: ['critical'], cap: 8 },
}

// --- Parse args ---
const RAW = (typeof args === 'string' ? args : '').trim()
const TOKENS = RAW.split(/\s+/).filter(Boolean)
// Fix proposal is ON by default; --no-fix opts out. (--fix still accepted, now a no-op.)
// REVERSES the 2026-07-21 decision "ultra-review keeps --fix opt-in because code-review fix
// proposals are more action-oriented and should not run by default" -- reversed deliberately by
// Ryan 2026-07-30, do not silently re-flip. Grounds: every RECORDED run of this tool enabled
// --fix anyway (2026-07-15 all three PRs; 2026-07-21 21:04 Ghost base), so opt-in was a tax, not
// a guard. The action-oriented risk is real but lives at APPLY time, and is already gated twice --
// the workflow only proposes, and the skill forbids applying without explicit user confirmation.
// Matches /ultraspec, which flipped to --no-fix on 2026-07-02 for the same reason.
const FIX = !TOKENS.includes('--no-fix')
const NO_LOGS = TOKENS.includes('--no-logs')
const WORKING = TOKENS.includes('--working')
const PR = TOKENS.map(t => t.match(/^#?(\d+)$/)).filter(Boolean).map(m => m[1])[0] || null
const MODE_KIND = PR ? 'pr' : (WORKING ? 'working' : 'branch')

// --- Shared knob preamble (keep byte-identical with ultraspec; only PARAMS/severities differ) ---
const LEVELS = ['full', 'conservative', 'balanced', 'aggressive']
const MODELS = ['opus', 'sonnet', 'haiku', 'fable']
const PRESETS = {
  // Ordered cheap -> expensive. fable is the BEST and PRICIEST model, so it belongs
  // in the verify slot (the one call where quality matters most), NEVER as a cheap
  // finder. Verify stays strong across presets on purpose: a cheap finder with a
  // strong verifier is the point of `quick`, and a weak verifier is how false
  // positives get through (see reference: PR#109 correlated-verifier misreads).
  // `in-depth` caps the cross-spec drift sweep (conservative) so it can't spawn one
  // reviewer per repo spec (~70% return nothing) and starve the verify cap; it keeps
  // full 3-vote verification. `max` restores the full uncapped sweep for when every
  // sibling truly must be checked. (costDrift is inert in ultrareview, no drift stage.)
  quick:      { costDrift: 'aggressive',   costVerify: 'aggressive',   mBase: 'haiku',  mReview: 'haiku',  mVerify: 'opus'  },
  balanced:   { costDrift: 'conservative', costVerify: 'conservative', mBase: 'sonnet', mReview: 'sonnet', mVerify: 'opus'  },
  'in-depth': { costDrift: 'conservative', costVerify: 'full',         mBase: 'opus',   mReview: 'sonnet', mVerify: 'fable' },
  max:        { costDrift: 'full',         costVerify: 'full',         mBase: 'opus',   mReview: 'opus',   mVerify: 'fable' },
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
if (flagVal('drift') !== undefined) log('NOTE: --drift is ignored by ultrareview (no cross-spec drift stage); use --verify for depth.')

const effRaw = flagVal('efficient')
const effLevel = effRaw === undefined ? undefined : (LEVELS.includes(effRaw) ? effRaw : 'balanced')
const verifyFallback = effLevel ?? (preset ? preset.costVerify : undefined) ?? 'full'
const pickLevel = (raw, fb) => (raw && LEVELS.includes(raw) ? raw : fb)
const VERIFY_LEVEL = pickLevel(flagVal('verify'), verifyFallback)
const vp = VERIFY_PARAMS[VERIFY_LEVEL]

const modelFlag = (name) => {
  const raw = flagVal(name)
  if (raw === undefined || raw === '') return undefined
  if (MODELS.includes(raw)) return raw
  log('WARNING: ignoring unknown model "' + raw + '" for --' + name + ' (expected ' + MODELS.join('/') + '); inheriting session model')
  return undefined
}
// --- Codex verify (hybrid mode) ---------------------------------------------
// `--codex-verify` routes the adversarial verify panel to OpenAI Codex while the
// finders stay on Claude. This is the ENTIRE point of /hybrid-review: a same-lineage
// panel shares the finder's blind spots, so it confirms findings it should refute.
// Measured 2026-07-30 on the 5 known-false PR#109 findings that Claude's own 3-vote
// panel CONFIRMED: Codex killed 4/5 (four unanimous 0-3) and returned the 5th
// contested-not-confirmed. Claude's recorded score on the same 5 was 0/5.
//
// Two axes on Codex (tier x reasoning effort), so the mapping is explicit:
// --verify-model keeps meaning "which model" (sol|terra|luna); effort rides the preset.
// `ultra` is deliberately NOT reachable -- it is "maximum reasoning with automatic task
// delegation", i.e. Codex spawning its own subagents. Nondeterministic sub-fan-out inside
// a deterministic vote panel defeats the purpose of having a vote panel.
const CODEX_VERIFY = TOKENS.includes('--codex-verify')
const CODEX_MODELS = { sol: 'gpt-5.6-sol', terra: 'gpt-5.6-terra', luna: 'gpt-5.6-luna' }
// `balanced` runs at HIGH, same as in-depth (Ryan, 2026-07-30). Deliberate: the verifier is the
// stage where cheapening causes false positives to survive, so the effort dial is NOT the axis
// that separates balanced from in-depth -- vote count (2 vs 3) and base model (sonnet vs opus) are.
const CODEX_EFFORT_BY_PRESET = { quick: 'medium', balanced: 'high', 'in-depth': 'high', max: 'xhigh' }
// Bare invocation (no preset) gets HIGH, not the sol/medium floor: bare already means the
// FULL panel (3 votes, all severities, cap 40), so pairing the deepest vote structure with
// the shallowest reasoning was incoherent once balanced moved to high. There is no
// "inherit session model" analog on the Codex side, so this fallback must be an explicit pick.
const codexModelFlag = () => {
  const raw = flagVal('verify-model')
  if (raw === undefined || raw === '') return undefined
  if (CODEX_MODELS[raw]) return raw
  log('WARNING: ignoring unknown Codex model "' + raw + '" for --verify-model (expected ' + Object.keys(CODEX_MODELS).join('/') + '); using sol')
  return undefined
}
const CODEX_TIER = CODEX_VERIFY ? (codexModelFlag() ?? 'sol') : null
const CODEX_EFFORT = CODEX_VERIFY ? (CODEX_EFFORT_BY_PRESET[presetName] ?? 'high') : null
const CODEX_SLUG = CODEX_VERIFY ? CODEX_MODELS[CODEX_TIER] : null

const pm = (k) => (preset ? preset[k] : undefined)
// Precedence, most specific wins: stage flag > --fable-review (review only) >
// explicit --model > preset stage default > BASE_MODEL > inherit session model.
// EXPLICIT_MODEL must outrank pm(): a flag the user TYPED beats a default they
// did not. Before this, `--quick --model=opus` reviewed with haiku because
// pm('mReview') short-circuited ahead of BASE_MODEL.
const EXPLICIT_MODEL = modelFlag('model')
const BASE_MODEL = EXPLICIT_MODEL ?? pm('mBase')
const REVIEW_MODEL = modelFlag('review-model') ?? (flagVal('fable-review') !== undefined ? 'fable' : undefined) ?? EXPLICIT_MODEL ?? pm('mReview') ?? BASE_MODEL
// In codex mode the Claude verify agent does NO reasoning -- it shells out to
// `codex exec` and relays the JSON that wrote. So it is pinned to haiku regardless
// of --verify-model, which now selects the CODEX tier instead. A Claude model flag
// silently steering a Codex panel would be the worst of both worlds.
const VERIFY_MODEL = CODEX_VERIFY
  ? 'haiku'
  : (modelFlag('verify-model') ?? EXPLICIT_MODEL ?? pm('mVerify') ?? BASE_MODEL)
const withModel = (opts, m) => (m ? { ...opts, model: m } : opts)
const modelLabel = (m) => m || 'inherit'
const LOW_CONFIDENCE = vp.votes < 2
const verifyLabel = CODEX_VERIFY ? ('codex:' + CODEX_SLUG + '@' + CODEX_EFFORT) : modelLabel(VERIFY_MODEL)
const MODE = {
  verify: VERIFY_LEVEL, preset: presetName || null, codexVerify: CODEX_VERIFY,
  codex: CODEX_VERIFY ? { tier: CODEX_TIER, model: CODEX_SLUG, effort: CODEX_EFFORT } : null,
  models: { base: modelLabel(BASE_MODEL), review: modelLabel(REVIEW_MODEL), verify: verifyLabel },
}
log('Mode: ' + (CODEX_VERIFY ? 'HYBRID (claude finds -> codex verifies) | ' : '') + (presetName ? 'preset=' + presetName + ' -> ' : '') + 'verify=' + VERIFY_LEVEL + (FIX ? '' : ', NO-FIX') + (NO_LOGS ? ', no-logs' : '') + ' | models: base=' + modelLabel(BASE_MODEL) + ' review=' + modelLabel(REVIEW_MODEL) + ' verify=' + verifyLabel + (LOW_CONFIDENCE ? ' | LOW-CONFIDENCE (1-vote verify)' : ''))
// The hybrid STANDARD (Ryan, 2026-08-04): gpt-5.6-sol @ high, 3 surviving votes per finding,
// relayFailures 0. Bare `--codex-verify` already resolves to exactly that; a preset can drop
// below it (`--quick` -> medium effort, 1 vote), so say so out loud rather than letting a
// thinner panel wear the same name in the report.
if (CODEX_VERIFY && (vp.votes < 3 || CODEX_EFFORT === 'medium')) log('NOTE: OFF-STANDARD hybrid panel (' + CODEX_SLUG + '@' + CODEX_EFFORT + ', ' + vp.votes + ' vote(s)). The standard is sol@high x3 votes -- drop the preset flags to get it. Say which panel ran when you report the result.')
// --model must never read as if it steered the verifier in hybrid mode.
if (CODEX_VERIFY && EXPLICIT_MODEL) log('NOTE: --model=' + EXPLICIT_MODEL + ' applies to the CLAUDE stages only (manifest/review/dedup/synthesize); the verify panel runs on ' + CODEX_SLUG + '. Use --verify-model=sol|terra|luna to change it.')

// --- Helpers ---
const tally = (arr) => arr.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a }, { critical: 0, high: 0, medium: 0, low: 0 })
const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '...' : t }

// --- Schemas ---
const MANIFEST_SCHEMA = {
  type: 'object',
  required: ['mode', 'target', 'diffAvailable', 'changedFiles'],
  properties: {
    mode: { enum: ['branch', 'pr', 'working'] },
    target: { type: 'string' },
    baseRef: { type: 'string' },
    diffAvailable: { type: 'boolean' },
    filesOnDisk: { type: 'boolean' },
    totalChurn: { type: 'number' },
    note: { type: 'string' },
    changedFiles: { type: 'array', items: {
      type: 'object', required: ['path', 'status'],
      properties: {
        path: { type: 'string' },
        status: { enum: ['A', 'M', 'D', 'R'] },
        added: { type: 'number' },
        deleted: { type: 'number' },
        language: { type: 'string' },
        summary: { type: 'string' },
      },
    }},
  },
}
const FINDINGS_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: { type: 'array', items: {
      type: 'object', required: ['severity', 'title', 'file', 'evidence'],
      properties: {
        severity: { enum: ['critical', 'high', 'medium', 'low'] },
        title: { type: 'string' },
        file: { type: 'string' },
        line: { type: 'number' },
        evidence: { type: 'string' },
        suggestion: { type: 'string' },
        confidence: { enum: ['high', 'medium', 'low'] },
      },
    }},
  },
}
const CLUSTER_SCHEMA = {
  type: 'object', required: ['clusters'],
  properties: {
    clusters: { type: 'array', items: {
      type: 'object', required: ['members'],
      properties: {
        members: { type: 'array', items: { type: 'number' } },
        reason: { type: 'string' },
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
    // bug-751: MUST accept null — codex-verdict.schema.json REQUIRES the field and allows null
    // ("severity stands"), so a relay copying Codex's verdict verbatim could not satisfy a
    // null-less schema and filed RELAY_FAILED with the real verdict inside, invalidating panels.
    correctedSeverity: { enum: ['critical', 'high', 'medium', 'low', null] },
  },
}
const REPORT_SCHEMA = {
  type: 'object', required: ['summary', 'reportMarkdown', 'counts'],
  properties: {
    summary: { type: 'string' },
    reportMarkdown: { type: 'string' },
    counts: { type: 'object', properties: {
      critical: { type: 'number' }, high: { type: 'number' },
      medium: { type: 'number' }, low: { type: 'number' },
    }},
    topFindings: { type: 'array', items: {
      type: 'object', required: ['severity', 'title'],
      properties: { severity: { type: 'string' }, dimension: { type: 'string' }, title: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' } },
    }},
  },
}
const FIX_SCHEMA = {
  type: 'object', required: ['edits'],
  properties: {
    edits: { type: 'array', items: {
      type: 'object', required: ['file', 'change'],
      properties: { file: { type: 'string' }, line: { type: 'number' }, findingTitle: { type: 'string' }, change: { type: 'string' } },
    }},
    patchMarkdown: { type: 'string' },
  },
}

// --- Phase 1: Manifest (diff acquisition) ---
phase('Manifest')
const manifest = await agent(
  '## Diff Manifest Builder (ultrareview)\n\n' +
  'Mode: ' + MODE_KIND + (PR ? ('  PR #' + PR) : '') + '\n\n' +
  '## Task -- acquire the review-target diff and return its file list. Do NOT review anything yet.\n' +
  (MODE_KIND === 'branch'
    ? '1. Run `git rev-parse --is-inside-work-tree`; if not a repo, return diffAvailable:false. baseRef = "main". Run `git diff --numstat main...HEAD` and `git diff --name-status main...HEAD`. target = `git rev-parse --abbrev-ref HEAD`. filesOnDisk = true.\n'
    : MODE_KIND === 'working'
    ? '1. baseRef = "HEAD". Run `git diff --numstat HEAD` and `git diff --name-status HEAD` (covers staged + unstaged TRACKED changes; untracked files are NOT included -- if any exist, mention them in note). target = "working". filesOnDisk = true.\n'
    : '1. Run `gh pr view ' + (PR || '') + ' --json files,headRefName,baseRefName,number`. baseRef = baseRefName. target = "pr-' + (PR || '') + '". Derive changed files + churn from that JSON (and `gh pr diff ' + (PR || '') + ' --name-only` if needed). filesOnDisk = (headRefName === current `git rev-parse --abbrev-ref HEAD`).\n') +
  '2. For each changed file return { path, status (A|M|D|R), added, deleted, language (from extension), summary (one line on what changed -- read the diff hunk) }.\n' +
  '3. totalChurn = sum of added+deleted across files. If there are ZERO changed files, or the git/gh command errors, return diffAvailable:false with a note explaining why.\n\n' +
  'Structured output only.',
  withModel({ label: 'manifest', phase: 'Manifest', schema: MANIFEST_SCHEMA, agentType: 'Explore' }, BASE_MODEL)
)
if (!manifest || !manifest.diffAvailable) {
  return {
    target: manifest && manifest.target ? manifest.target : MODE_KIND,
    mode: MODE_KIND, modeDetail: MODE, diffAvailable: false,
    error: (manifest && manifest.note) ? manifest.note : 'No diff to review (empty diff, not a git repo, or bad PR#).',
  }
}
const changedFiles = manifest.changedFiles || []
const filesOnDisk = manifest.filesOnDisk !== false
log('Manifest: ' + changedFiles.length + ' changed files, churn ' + (manifest.totalChurn || 0) + ', mode ' + MODE_KIND + (filesOnDisk ? '' : ' (files NOT on disk -- diff-text-only review)'))
if (PR && WORKING) log('NOTE: both PR# and --working given; reviewing PR #' + PR + ', ignoring --working.')

// --- Phase 2: Review (parallel fan-out: dimension x file-batch) ---
phase('Review')
const RUBRIC =
  '## Severity rubric (assign exactly one per finding)\n' +
  '- critical: crashes the process, data loss, a security hole (auth bypass, cross-user/team private leak, injection, secret-in-URL), or a confirmed prod-breaking bug.\n' +
  '- high: a real functional bug -- wrong behavior, an unhandled error path, a Terum-invariant violation in a user-facing path, or contract drift that will break the SPA.\n' +
  '- medium: edge-case bug, missing/weak test, reuse-dedup across 3+ sites or a 50+-line duplication, a notable inefficiency.\n' +
  '- low: minor cleanup, small duplication (<3 sites), style/altitude nit.\n'
const fileList = (batch) => batch.map(f => '- [' + f.status + '] ' + f.path + (f.summary ? '  -- ' + f.summary : '')).join('\n')
const DIFF_HOWTO = () =>
  (MODE_KIND === 'pr'
    ? 'Get changed lines via `gh pr diff ' + (PR || '') + ' -- <file>`'
    : 'Get changed lines via `git diff ' + manifest.baseRef + (MODE_KIND === 'branch' ? '... ' : ' ') + '-- <file>`') +
  (filesOnDisk
    ? ', and read the FULL current file (Read tool) for context.'
    : '. Files are NOT on disk (un-checked-out PR) -- review from the diff text alone.')
const CHECKLISTS = {
  correctness: 'logic/control-flow bugs, off-by-one, unhandled throws / process-killing crashes, races, wrong async ordering; AND test gaps: a changed behaviour with no collocated __tests__/{domain}/{name}.test.ts, or weak/non-adversarial test inputs (a regex or keyword lookup that would pass every current test = too weak).',
  security: 'auth-matches-caller (cookie-only requireAuth() on a non-browser/SPA/extension route = bug), a cross-user/team read on the ADMIN/service-role client missing a `private = false` predicate IN THE QUERY, SQL/command injection (incl. unescaped % _ \\\\ in a PostgREST .like()), a secret in a URL query string (CWE-598), path traversal; AND data-loss: silent drops, a missing rollback on a partial multi-write, a sync/backfill that reports complete while skipping items.',
  invariants: 'Terum CLAUDE.md invariants on the CHANGED lines: an unchecked Supabase `error` (EVERY .from()/.rpc()/storage result, incl. Promise.all elements and the extension capture chain), a route catch that returns 200 with an empty/different shape (must be 5xx), fire-and-forget in serverless (a bare fetch().catch() before return -- must be after()/await), persisting progress BEFORE the work succeeds, Zod .optional() where .nullish() is required (or .min(1) on a response array), comparing against magic enum literals instead of the shared contract, placeholder/mock data in shipped UI, a contract change not mirrored in the SPA copy.',
  reuse: 'duplicate logic that should extend existing code (search the repo first -- the "Before implementing" rule), dead or parallel code paths left behind, premature abstraction (<3 uses), oversized files doing too much, needless inefficiency (serial awaits that could parallelize, N+1 queries).',
}
const WIDER = (key) => (key === 'invariants' || key === 'reuse')
  ? ' You MAY grep the WIDER repo (not just the diff): invariants need sibling call-sites + the SPA contract copy; reuse needs existing implementations to compare against.'
  : ''
const REVIEW_PROMPT = (dim, batch, bi) =>
  '## ' + dim.label + ' Reviewer (batch ' + (bi + 1) + ')\n\n' +
  'Review target: ' + manifest.target + ' (mode ' + MODE_KIND + ', base ' + manifest.baseRef + ').\n\n' +
  RUBRIC + '\n' +
  '## Files in this batch\n' + fileList(batch) + '\n\n' +
  '## How to read them\n' + DIFF_HOWTO() + WIDER(dim.key) + '\n\n' +
  '## Hunt for (' + dim.label + ')\n' + CHECKLISTS[dim.key] + '\n\n' +
  '## Rules\nFocus on CHANGED/added code (you may flag a changed line that breaks untouched code). Quote the offending code + file:line in evidence and say why it is a bug. Assign severity per the rubric. **A fragile pattern is not excused by being the house convention** -- if the changed code is wrong or fragile, flag it even when sibling call-sites do the same. When a flaw looks repo-wide, name the sibling call-sites in `suggestion` (the sweep worklist). Only report real, specific, actionable defects -- no stylistic taste. If clean, return findings: [].\n\nStructured output only.'

const batches = []
for (let i = 0; i < changedFiles.length; i += FILES_PER_BATCH) batches.push(changedFiles.slice(i, i + FILES_PER_BATCH))
const reviewThunks = []
for (const dim of DIMENSIONS) {
  batches.forEach((batch, bi) => {
    reviewThunks.push(() =>
      agent(REVIEW_PROMPT(dim, batch, bi), withModel({ label: dim.key + ':' + (bi + 1), phase: 'Review', schema: FINDINGS_SCHEMA, agentType: 'Explore' }, REVIEW_MODEL))
        .then(r => r ? { findings: (r.findings || []).map(f => ({ ...f, dimension: dim.label, dimKey: dim.key })) } : null)
    )
  })
}
const reviewResults = (await parallel(reviewThunks)).filter(Boolean)
const allFindings = reviewResults.flatMap(r => r.findings || [])
log('Review: ' + allFindings.length + ' raw findings from ' + reviewResults.length + ' reviewers')

// --- Phase 2b: Dedup (merge duplicate findings BEFORE paying to verify them) ---
// The 4 dimensions are overlapping lenses on the SAME changed lines, so one defect is
// routinely minted 2-10x (pr-293: one finding merged 10 reports across all four dims;
// pr-253: 9/7/3). Before this stage every copy bought its own full vp.votes panel AND
// consumed a vp.cap slot, pushing DISTINCT findings into the unverified dump. So this
// cuts redundancy, never depth: each distinct finding still gets the full panel, now
// arguing against the UNION of the reviewers' evidence rather than one reviewer's.
// Judging "same defect?" is a semantic call, so an LLM makes it (no keyword/Jaccard
// shortcut); only the partition REPAIR below is mechanical.
let clusters = null
if (allFindings.length >= 2) {
  phase('Dedup')
  const deduped = await agent(
    '## Duplicate-Finding Merger (ultrareview)\n\n' +
    'Review target: ' + manifest.target + '.\n\n' +
    'Four review dimensions (correctness, security, invariants, reuse) read the SAME changed lines, so the SAME defect is often reported 2-10 times in different words. Group the findings below so each real, distinct defect appears exactly once. You do not need to judge whether a finding is CORRECT -- only whether two findings are the SAME defect.\n\n' +
    '## Findings\n' + allFindings.map((f, i) =>
      '[' + i + '] (' + f.severity + ' / ' + f.dimKey + ') ' + f.file + (f.line ? ':' + f.line : '') + '\n' +
      '    title: ' + clip(f.title, 200) + '\n' +
      '    evidence: ' + clip(f.evidence, 400)
    ).join('\n') + '\n\n' +
    '## Rules\n' +
    '- Merge two findings ONLY if they are the SAME underlying defect: the same code location AND the same root cause. Wording, dimension, and severity may differ -- that is the normal case for a true duplicate.\n' +
    '- Do NOT merge: two different defects that merely sit on the same line or in the same file; a systemic observation and one specific instance of it; the same KIND of bug at two different call-sites (those are siblings for the sweep worklist, not duplicates).\n' +
    '- When unsure, DO NOT merge. A wrong merge silently deletes a real finding; a missed merge only costs verification budget. Asymmetric -- stay conservative.\n' +
    '- Every index 0..' + (allFindings.length - 1) + ' MUST appear in exactly one cluster. A finding with no duplicate is a cluster of one.\n' +
    '- reason: one short phrase naming the shared defect (only meaningful for clusters of 2+).\n\n' +
    'Structured output only.',
    withModel({ label: 'dedup', phase: 'Dedup', schema: CLUSTER_SCHEMA, agentType: 'Explore' }, BASE_MODEL)
  )
  clusters = deduped && Array.isArray(deduped.clusters) ? deduped.clusters : null
  if (!clusters) log('WARNING: dedup stage returned nothing -- verifying all ' + allFindings.length + ' raw findings undeduped (no depth lost, only budget).')
}

// Repair the partition so a hallucinating merger can NEVER drop a finding: keep each
// index's FIRST appearance, and give every unmentioned index its own singleton cluster.
const buildGroups = (raw) => {
  const seen = new Set()
  const groups = []
  for (const c of (raw || [])) {
    const members = (c && Array.isArray(c.members) ? c.members : [])
      .filter(i => Number.isInteger(i) && i >= 0 && i < allFindings.length && !seen.has(i))
    for (const i of members) seen.add(i)
    if (members.length) groups.push(members)
  }
  const orphans = allFindings.map((_, i) => i).filter(i => !seen.has(i))
  if (raw && orphans.length) log('NOTE: dedup omitted ' + orphans.length + ' finding(s) from its clusters; kept as singletons (nothing dropped).')
  for (const i of orphans) groups.push([i])
  return groups
}
// Representative = highest severity -> most detailed evidence -> earliest reviewer.
// Deterministic (no Date/random), so a resumed run rebuilds the identical set.
const mergeGroup = (idxs) => {
  const pairs = idxs.map(i => ({ f: allFindings[i], i }))
  pairs.sort((a, b) =>
    (sevRank[a.f.severity] ?? 9) - (sevRank[b.f.severity] ?? 9) ||
    String(b.f.evidence || '').length - String(a.f.evidence || '').length ||
    a.i - b.i)
  const rep = pairs[0].f
  if (pairs.length === 1) return { ...rep, dupCount: 1, dupDimensions: [rep.dimension], dupDimKeys: [rep.dimKey], dupAbsorbed: [] }
  const dims = []
  const dimKeys = []
  for (const p of pairs) {
    if (!dims.includes(p.f.dimension)) dims.push(p.f.dimension)
    // dupDimKeys, not just the rep's dimKey: the skill's auto-bug-log rule keys on
    // dimKey === 'security', and a security report absorbed into a higher-severity
    // correctness rep must not lose its eligibility.
    if (!dimKeys.includes(p.f.dimKey)) dimKeys.push(p.f.dimKey)
  }
  const repHead = clip(rep.evidence, 80)
  const extra = pairs.slice(1).map(p => p.f.evidence)
    .filter(e => e && clip(e, 80) !== repHead)
    .slice(0, 3)
  // suggestion carries the sibling-sweep worklists -- union them, never drop one.
  const suggestions = []
  for (const p of pairs) {
    const s = p.f.suggestion
    if (s && !suggestions.some(x => clip(x, 100) === clip(s, 100))) suggestions.push(String(s))
  }
  return {
    ...rep,
    // Framed as ADDITIONAL EVIDENCE, not as votes: the verifier must still judge the
    // claim against the code. "N dimensions agreed" is not proof and must not read as any.
    evidence: rep.evidence + (extra.length
      ? '\n\nAdditional evidence cited for the same defect (other review dimensions):\n' + extra.map(e => '- ' + clip(e, 500)).join('\n')
      : ''),
    suggestion: suggestions.length ? suggestions.join('\n') : rep.suggestion,
    dupCount: pairs.length,
    dupDimensions: dims,
    dupDimKeys: dimKeys,
    // The non-representative reports, kept ONLY so the run log can name what each merge
    // swallowed. The partition repair above guarantees nothing is dropped by omission,
    // but it cannot catch a semantically WRONG merge (two distinct defects collapsed):
    // there the loser's title disappears into the rep's evidence blob. A count alone
    // ("merged x2") is not auditable -- the titles side by side are.
    dupAbsorbed: pairs.slice(1).map(p => ({ severity: p.f.severity, dimKey: p.f.dimKey, title: p.f.title, file: p.f.file, line: p.f.line })),
  }
}
const findings = buildGroups(clusters).map(mergeGroup)
const mergedAway = allFindings.length - findings.length
if (allFindings.length >= 2) {
  log('Dedup: ' + allFindings.length + ' raw -> ' + findings.length + ' distinct (' + mergedAway + ' merged away)')
  // No silent merges: every collapse names BOTH sides -- the surviving finding and each
  // report folded into it -- so a wrong merge is legible in the run log, not just counted.
  for (const f of findings) {
    if (f.dupCount === 1) continue
    log('  merged x' + f.dupCount + ' across ' + f.dupDimensions.length + ' dim(s) -> kept (' + f.severity + '/' + f.dimKey + ') ' + clip(f.title, 70))
    for (const a of (f.dupAbsorbed || [])) log('      absorbed (' + a.severity + '/' + a.dimKey + ') ' + clip(a.title, 70) + ' @ ' + a.file + (a.line ? ':' + a.line : ''))
  }
}

// --- Rank, then select what to verify per the verify level (barrier: full pool needed to rank) ---
const ranked = [...findings].sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9))
const eligible = ranked.filter(f => vp.severities.includes(f.severity))
const toVerify = eligible.slice(0, vp.cap)
const verifySet = new Set(toVerify)
const unverified = ranked.filter(f => !verifySet.has(f))
if (unverified.length > 0) log('NOTE: ' + unverified.length + ' finding(s) listed UNVERIFIED at verify=' + VERIFY_LEVEL + ' (below severity threshold or beyond cap ' + vp.cap + ')')

const emptyStats = { verify: VERIFY_LEVEL, changedFiles: changedFiles.length, reviewers: reviewResults.length, rawFindings: allFindings.length, distinctFindings: findings.length, mergedAway }
if (findings.length === 0) {
  return {
    target: manifest.target, mode: MODE_KIND, modeDetail: MODE, baseRef: manifest.baseRef, fixMode: FIX, noLogs: NO_LOGS,
    summary: 'Clean: ' + manifest.target + ' raised no findings across ' + reviewResults.length + ' reviewers (' + changedFiles.length + ' files).',
    reportMarkdown: '# ultrareview: ' + manifest.target + '\n\n**Verdict:** clean. No correctness, security, invariant, or reuse findings across ' + changedFiles.length + ' changed files.\n',
    counts: { critical: 0, high: 0, medium: 0, low: 0 },
    topFindings: [], confirmedFindings: [], contestedFindings: [], droppedFindings: [], unverifiedFindings: [],
    stats: { ...emptyStats, verified: 0, confirmed: 0, contested: 0, dropped: 0, unverified: 0 },
  }
}

// --- Phase 3: Verify (adversarial; votes/refute per cost level) ---
phase('Verify')
const VERIFY_PROMPT = (f, v) =>
  '## Adversarial Finding Verifier (voter ' + (v + 1) + '/' + vp.votes + ')\n\n' +
  'Be SKEPTICAL. Try to REFUTE this code-review finding. ' + vp.refute + '/' + vp.votes + ' refutations kill it.\n\n' +
  'Review target: ' + manifest.target + ' (mode ' + MODE_KIND + ').\n\n' +
  '## Finding under review\nDimension: ' + f.dimension + '\nSeverity: ' + f.severity + '\nFile: ' + f.file + (f.line ? ':' + f.line : '') + '\nTitle: ' + f.title + '\nEvidence: ' + f.evidence + '\n\n' +
  '## Checklist -- FIRST re-read the actual file at the cited line (Read; ' + (MODE_KIND === 'pr' ? '`gh pr diff ' + (PR || '') + '`' : '`git diff`') + ' for the changed lines). Refute (refuted=true) if ANY of:\n' +
  '1. the cited line/code does not exist or the finding misquotes it;\n' +
  '2. the concern is already handled nearby (the error IS checked / the value IS awaited a few lines away; the predicate IS present);\n' +
  '3. it is a settled deferral EXPLICITLY recorded in PRODUCT-CONCERNS.md or a `.planning/debug` `.deferred.md` entry (cite which), OR an intentional choice justified by a concrete LOAD-BEARING reason you can CITE such that deviating would itself be a bug;\n' +
  '4. it is a stylistic opinion, not a functional defect.\n' +
  '## Convention is NOT a refutation. "It matches the other call-sites / it is how this repo does it / it is pre-existing" does NOT refute a real fragility. Apply the standalone test: would this code be correct and non-fragile as the ONLY place doing it, given just the invariants it actually relies on? If NO, keep it real (refuted=false), note it is repo-wide, and name the sibling call-sites (the sweep worklist).\n' +
  'refuted=false ONLY if the finding is real, specific, and actionable. Default to refuted=true when you cannot verify the evidence. Set correctedSeverity if the severity is wrong (advisory). Reason MUST quote what you found.\n\nStructured output only.'

// --- Codex relay (hybrid mode) ----------------------------------------------
// Workflow scripts are sandboxed: no filesystem, no child_process. So the script
// cannot invoke `codex exec` itself. Each vote instead runs as a THIN Claude agent
// whose only job is to shell out and relay -- it does no reasoning of its own, which
// is why VERIFY_MODEL is pinned to haiku above.
//
// Fidelity is the risk here: a relay that paraphrases silently replaces the Codex
// verdict with a Claude one, which would defeat the whole design AND be invisible in
// the report. Two guards: (1) the long, stable rules live on disk in
// codex-verify-rules.md so the agent never retypes them -- it only writes the short
// finding block; (2) the verdict is read back from the file `-o` wrote and returned
// verbatim, with an explicit ban on editing it.
//
// THIRD guard, added 2026-08-04: the relay MUST raise the Bash timeout to 10 minutes.
// The Bash tool defaults to 120s; `codex exec` at high effort takes minutes per finding,
// so the default silently SIGKILLs most of the panel -- measured 17/21 votes lost on the
// first real run, which then read as a normal contested/confirmed spread rather than as
// broken plumbing. 600000ms is the Bash tool's documented maximum; do not lower it.
const RELAY_TIMEOUT_MS = 600000
const codexArgs = "-C . -s read-only --ephemeral -m " + CODEX_SLUG +
  " -c model_reasoning_effort=\"" + CODEX_EFFORT + "\"" +
  " --output-schema .claude/workflows/codex-verdict.schema.json"

const CODEX_RELAY_PROMPT = (f, v) =>
  '## Codex verify relay (voter ' + (v + 1) + '/' + vp.votes + ')\n\n' +
  'You are a RELAY, not a reviewer. Do NOT judge this finding yourself. Run the command below, then return what Codex said. Your own opinion about the finding is irrelevant and must not appear in the output.\n\n' +
  '## Step 1 -- write the finding block to a temp file\n' +
  'Run (a QUOTED heredoc, so nothing is expanded; copy the block between the markers BYTE FOR BYTE):\n\n' +
  '```bash\n' +
  'P=$(mktemp) ; V=$(mktemp)\n' +
  "cat > \"$P\" <<'TERUM_EOF'\n" +
  'Follow the rules in ./.claude/workflows/codex-verify-rules.md -- read that file FIRST, then do what it says.\n\n' +
  'Review target: ' + manifest.target + ' (mode ' + MODE_KIND + ').\n' +
  'This panel kills a finding at ' + vp.refute + '/' + vp.votes + ' refutations.\n\n' +
  '## Finding under review\n' +
  'Dimension: ' + f.dimension + '\n' +
  'Severity: ' + f.severity + '\n' +
  'File: ' + f.file + (f.line ? ':' + f.line : '') + '\n' +
  'Title: ' + clip(f.title, 300) + '\n' +
  'Evidence: ' + clip(f.evidence, 2500) + '\n\n' +
  'Changed lines for this target: ' + (MODE_KIND === 'pr' ? 'gh pr diff ' + (PR || '') + ' -- ' + f.file : 'git diff ' + manifest.baseRef + (MODE_KIND === 'branch' ? '... ' : ' ') + '-- ' + f.file) + '\n' +
  'TERUM_EOF\n' +
  'cat "$P" | codex exec - ' + codexArgs + ' -o "$V" >/dev/null 2>&1 ; echo "rc=$?" ; cat "$V"\n' +
  '```\n\n' +
  '## MANDATORY -- pass `timeout: ' + RELAY_TIMEOUT_MS + '` to the Bash tool on that command (' + (RELAY_TIMEOUT_MS / 60000) + ' minutes).\n' +
  'The Bash default is 120000ms and `codex exec` at ' + CODEX_EFFORT + ' effort routinely needs several MINUTES on one finding. Measured 2026-08-05: with the default timeout, 17 of 21 relay votes were SIGTERMed mid-run (exit 143, counted as RELAY_FAILED) and the whole panel was invalid. A timed-out relay is NOT a verdict. Do not shorten it, do not split the command, do not retry with a smaller timeout.\n\n' +
  '## Step 2 -- return the verdict\n' +
  '- The command prints `rc=<n>` then the JSON Codex wrote. Return THAT JSON as your structured output, unchanged: same `refuted`, same `reason` text, same `confidence`, same `correctedSeverity`.\n' +
  '- Do NOT rewrite, summarize, translate, shorten, or "improve" the reason. Copy it.\n' +
  '- Do NOT substitute your own judgment if you disagree with Codex. You are not a voter.\n' +
  '- If `rc` is non-zero, the file is empty, or the JSON will not parse: return `refuted: false`, `confidence: "low"`, `correctedSeverity: null`, and `reason` starting with the exact string `RELAY_FAILED:` followed by whatever the command printed (INCLUDING the `rc=<n>` line). Do NOT invent a verdict -- a failed relay must be visible, not silently counted as a refutation.\n' +
  '- One exception -- the command SUCCEEDED (`rc=0`, parseable JSON) but your structured output keeps being rejected on a schema mismatch: then file the RELAY_FAILED reason ending with EXACTLY this machine-recovered format (bug-751), nothing after it: Codex verdict: refuted=<true|false>, confidence=<high|medium|low>, reason="<the verdict reason verbatim>". Any other phrasing stays a dead vote.\n\n' +
  'Structured output only.'

// Verdict: confirmed / contested (panel split -- needs human) / killed. Contested only engages with vote redundancy.
// INTENTIONAL, do not "fix": the contested branch deliberately catches BOTH
// refutedCount === vp.refute - 1 AND refutedCount === vp.refute. Landing exactly
// ON the kill threshold is the noisiest possible signal, because the verifiers are
// non-deterministic -- the same finding re-run could land one vote either side.
// Surfacing it for human adjudication is safer than silently dropping it, so
// `refutedCount === vp.refute` returning 'contested' rather than 'killed' is the
// design, not an off-by-one. (Flagged as a defect by an external reviewer
// 2026-07-22; adjudicated as load-bearing and kept.)
const classifyVerdict = (validCount, refutedCount) => {
  if (validCount < vp.refute) return 'contested'
  if (refutedCount === 0) return 'confirmed'
  if (validCount - refutedCount === 0) return 'killed'
  if (vp.votes >= 2 && (refutedCount === vp.refute - 1 || refutedCount === vp.refute)) return 'contested'
  return refutedCount < vp.refute ? 'confirmed' : 'killed'
}

// A relay that could not reach Codex is an ABSENT vote, not a vote for the finding.
// The relay returns refuted:false on failure (so the schema is satisfiable), which
// would otherwise read as "a verifier looked and did not refute" -- silently biasing
// every broken vote toward CONFIRMED. Dropping it instead lowers validCount, which
// classifyVerdict already routes to `contested` (human adjudication). Fail visible.
const RELAY_FAILED = 'RELAY_FAILED:'
const isRelayFailure = (x) => CODEX_VERIFY && x && typeof x.reason === 'string' && x.reason.startsWith(RELAY_FAILED)

// bug-751: the two verdict schemas disagree on correctedSeverity:null (codex-verdict.schema.json
// REQUIRES the field and allows null; VERDICT_SCHEMA has no null), so a relay agent that copies
// Codex's null verbatim cannot satisfy StructuredOutput and may file RELAY_FAILED with the real
// verdict embedded in its reason. That is a genuine Codex verdict mangled in transport, not an
// absent vote — recover it at counting time (this also heals journaled runs on resume, since this
// post-processing re-executes over cached results). Anchored to end-of-string so a truncated
// embed still counts as a relay failure (fail visible).
const RELAY_EMBED = /Codex verdict: refuted=(true|false), confidence=(high|medium|low), reason="([\s\S]+)"$/
// bug-759: a wrapper whose captured output shows a NON-ZERO rc is a genuinely failed command — any
// verdict prose inside it is not a verdict Codex returned for this finding, so never recover it into
// a vote (recovery decrements relayFailures, the exact gate panelValid rests on). rc=0 (or no rc
// evidence at all) still recovers; the relay prompt now mandates the embed format for that case.
const RELAY_RC_FAIL = /\brc=(?!0\b)\d+/
const recoverRelayVerdict = (x) => {
  if (!isRelayFailure(x)) return x
  if (RELAY_RC_FAIL.test(x.reason)) return x
  const m = x.reason.match(RELAY_EMBED)
  if (!m) return x
  log('  relay verdict recovered from RELAY_FAILED wrapper (bug-751): refuted=' + m[1] + ' confidence=' + m[2])
  return { refuted: m[1] === 'true', confidence: m[2], reason: m[3] }
}

let relayFailures = 0
const verified = (await parallel(
  toVerify.map((finding) => () =>
    parallel(
      Array.from({ length: vp.votes }, (_, v) => () =>
        agent(
          CODEX_VERIFY ? CODEX_RELAY_PROMPT(finding, v) : VERIFY_PROMPT(finding, v),
          withModel({ label: (CODEX_VERIFY ? 'cx' : 'v') + v + ':' + finding.title.slice(0, 28), phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'Explore' }, VERIFY_MODEL)
        )
      )
    ).then(async votes => {
      // A relay failure with NO embedded verdict (genuine timeout / non-zero rc, e.g. exit 143
      // after the 10-min Bash cap) gets exactly ONE retry with a cache-busted prompt. The retry's
      // prompt differs from the original call's, so on a journaled resume the original replays
      // from cache (still RELAY_FAILED) and only the retry runs live — this is the sanctioned
      // script-edit heal path for an invalid panel (r2 bug-751 precedent). A retry that fails
      // again stays a visible relay failure; never invent a verdict.
      const afterRetry = await Promise.all(votes.map(async (x, v) => {
        const r = recoverRelayVerdict(x)
        if (!isRelayFailure(r)) return r
        log('  relay retry (cache-busted) voter ' + (v + 1) + ' on "' + clip(finding.title, 44) + '": ' + clip(r.reason, 120))
        const retry = await agent(
          CODEX_RELAY_PROMPT(finding, v) +
            '\n\n(Retry attempt 2 of 2 — the previous relay attempt for this voter failed in transport (timeout or non-zero rc) before Codex returned a verdict. Nothing about the finding has changed; run the same command again with the same mandatory timeout.)',
          withModel({ label: 'cxR' + v + ':' + finding.title.slice(0, 26), phase: 'Verify', schema: VERDICT_SCHEMA, agentType: 'Explore' }, VERIFY_MODEL)
        )
        return retry ? recoverRelayVerdict(retry) : r
      }))
      const returned = afterRetry.filter(Boolean)
      const failed = returned.filter(isRelayFailure)
      if (failed.length) {
        relayFailures += failed.length
        log('  RELAY FAILED x' + failed.length + ' on "' + clip(finding.title, 44) + '": ' + clip(failed[0].reason, 160))
      }
      const valid = returned.filter(x => !isRelayFailure(x))
      const refuted = valid.filter(x => x.refuted).length
      const verdict = classifyVerdict(valid.length, refuted)
      log('"' + finding.title.slice(0, 44) + '": ' + (valid.length - refuted) + '-' + refuted + ' ' + verdict + (failed.length ? ' (' + failed.length + ' relay failure(s) dropped)' : ''))
      return { ...finding, refutedVotes: refuted, validVotes: valid.length, relayFailures: failed.length, verdict }
    })
  )
)).filter(Boolean)
if (relayFailures) log('WARNING: ' + relayFailures + ' Codex relay call(s) failed and were dropped as absent votes. Findings with too few surviving votes land CONTESTED, not confirmed. Check `codex login status` and that Bash(codex exec:*) is allowlisted.')
const confirmed = verified.filter(f => f.verdict === 'confirmed')
const contested = verified.filter(f => f.verdict === 'contested')
const killed = verified.filter(f => f.verdict === 'killed')
log('Verify: ' + confirmed.length + ' confirmed, ' + contested.length + ' contested, ' + killed.length + ' dropped')

// --- Phase 4: Synthesize ---
phase('Synthesize')
const dupTag = (f) => (f.dupCount > 1 ? '   Merged: ' + f.dupCount + ' reviewer reports across ' + (f.dupDimensions || []).join(' / ') : '')
const findingsBlock = confirmed.map((f, i) =>
  '### [' + i + '] (' + f.severity + ' / ' + f.dimension + ') ' + f.title + '\n' +
  'File: ' + f.file + (f.line ? ':' + f.line : '') + '   Vote: ' + (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes + dupTag(f) + '\n' +
  'Evidence: ' + f.evidence + '\n' + (f.suggestion ? 'Suggestion: ' + f.suggestion + '\n' : '')
).join('\n')
const contestedBlock = contested.map(f => '- (' + f.severity + ' / ' + (f.dimension || '?') + ') ' + f.title + '  @ ' + f.file + (f.line ? ':' + f.line : '') + '  [vote ' + (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes + ']\n  Evidence: ' + f.evidence).join('\n')
const unverifiedBlock = unverified.map(f => '- (' + f.severity + ' / ' + (f.dimension || '?') + ') ' + f.title + '  @ ' + f.file + (f.line ? ':' + f.line : '')).join('\n')
// Banners are prepended to the report VERBATIM. An invalid panel must be impossible to read
// past: a relay killed by plumbing lowers a finding's vote count, which routes it to
// `contested` -- indistinguishable, in the report, from a real panel split.
const banners = []
if (LOW_CONFIDENCE) banners.push('! LOW-CONFIDENCE PASS (' + (presetName || 'verify=' + VERIFY_LEVEL) + '): findings were checked by a single verifier (no adversarial cross-check). Treat as a shallow first pass, not a trust gate.')
if (relayFailures) banners.push('! INVALID PANEL: ' + relayFailures + ' of ' + (toVerify.length * vp.votes) + ' Codex relay calls failed and were dropped as absent votes. This run does NOT meet the hybrid standard (' + CODEX_SLUG + '@' + CODEX_EFFORT + ', ' + vp.votes + ' surviving votes per finding, relayFailures 0). Every verdict below is unadjudicated -- re-run, do not reason about these results.')
const banner = banners.join('\n')

const report = await agent(
  '## Synthesis: code-review report\n\n' +
  'Review target: ' + manifest.target + ' (mode ' + MODE_KIND + ', base ' + manifest.baseRef + '). Mode: ' + (presetName ? 'preset=' + presetName + ', ' : '') + 'verify=' + VERIFY_LEVEL + '.\n' +
  confirmed.length + ' findings confirmed, ' + contested.length + ' contested, via ' + vp.votes + '-vote adversarial verification.\n' +
  'Reviewers filed ' + allFindings.length + ' raw findings; ' + mergedAway + ' were duplicates of another finding and were merged away BEFORE verification, leaving ' + findings.length + ' distinct.\n\n' +
  (banner ? '## Banner -- include ' + (banners.length > 1 ? 'these lines' : 'this line') + ' VERBATIM as the first line(s) under the title:\n' + banner + '\n\n' : '') +
  '## Confirmed findings\n' + (findingsBlock || '(none)') + '\n\n' +
  '## Contested findings (verify panel split -- one vote from flipping; neither confirmed nor dropped)\n' + (contestedBlock || '(none)') + '\n\n' +
  '## Unverified findings (efficient mode skipped adversarial verification for these)\n' + (unverifiedBlock || '(none)') + '\n\n' +
  '## Instructions\n' +
  '1. Cross-dimension duplicates were ALREADY merged before verification (a "Merged: N reviewer reports" tag shows how many each represents). Merge only RESIDUAL near-duplicates -- same root cause at a different file/line (combine evidence; keep the highest severity). When a finding carries a Merged tag, state it in the finding line (e.g. "merges 4 reports across Correctness/Security") -- independent rediscovery is a signal worth showing the reader.\n' +
  '2. Group by dimension (Correctness & tests / Security & data-loss / Terum invariants / Reuse, simplify, perf); within each, order critical -> high -> medium -> low.\n' +
  '3. reportMarkdown: titled "# ultrareview: ' + manifest.target + '"' + (banner ? ', with the banner as the first line under the title,' : ',') + ' then a one-paragraph verdict and a severity-count table, then grouped CONFIRMED findings (file:line, evidence, suggested fix) as checkbox items.\n' +
  '4. counts: CONFIRMED findings per severity (exclude contested + unverified).\n' +
  '5. topFindings: the confirmed critical and high items (severity, dimension, title, file, line).\n' +
  '6. If any contested findings exist, append a "## Contested (split adversarial verdict -- needs human adjudication)" section listing them verbatim; do NOT fold into counts/topFindings.\n' +
  '7. If any unverified findings exist, append a "## Unverified (not adversarially checked -- efficient mode)" section listing them verbatim; do NOT fold into counts/topFindings.\n' +
  'Be concise and actionable. Do not invent findings beyond those listed above.\n\nStructured output only.',
  withModel({ label: 'synthesize', phase: 'Synthesize', schema: REPORT_SCHEMA, agentType: 'Explore' }, BASE_MODEL)
)

const slimMap = (f) => ({ severity: f.severity, dimension: f.dimension, dimKey: f.dimKey, title: f.title, file: f.file, line: f.line, evidence: f.evidence, suggestion: f.suggestion, vote: (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes, dupCount: f.dupCount, dupDimensions: f.dupDimensions, dupDimKeys: f.dupDimKeys })
const slimConfirmed = confirmed.map(slimMap)
const slimContested = contested.map(slimMap)
const slimKilled = killed.map(slimMap)
const slimUnverified = unverified.map(f => ({ severity: f.severity, dimension: f.dimension, title: f.title, file: f.file, line: f.line, evidence: f.evidence, dupCount: f.dupCount }))
const stats = { ...emptyStats, verified: verified.length, confirmed: confirmed.length, contested: contested.length, dropped: killed.length, unverified: unverified.length, codexVerify: CODEX_VERIFY, relayFailures, expectedVotes: toVerify.length * vp.votes, panelValid: !CODEX_VERIFY || relayFailures === 0 }

if (!report) {
  return {
    target: manifest.target, mode: MODE_KIND, modeDetail: MODE, baseRef: manifest.baseRef, fixMode: FIX, noLogs: NO_LOGS,
    error: 'Synthesis failed -- returning verified findings raw.',
    counts: tally(confirmed), confirmedFindings: slimConfirmed, contestedFindings: slimContested, droppedFindings: slimKilled, unverifiedFindings: slimUnverified, stats,
  }
}
if (banner && report.reportMarkdown) {
  // Per-banner, not all-or-nothing: the synthesizer sometimes echoes one and drops the other.
  const missing = banners.filter(b => !report.reportMarkdown.includes(b.slice(2, 26)))
  if (missing.length) report.reportMarkdown = report.reportMarkdown.replace(/^(#[^\n]*\n)/, '$1\n' + missing.join('\n') + '\n')
}

// --- Fix proposer (ON by default, --no-fix opts out; proposes only, NEVER applies) ---
// Skipped entirely when the files are not on disk: on an un-checked-out PR the reviewers are
// explicitly told "review from the diff text alone", but this stage's prompt says "Read each
// file to get exact surrounding code" -- so it would propose old->new edits against code it
// could not read, at line numbers it could not confirm. A confidently-formatted patch built
// from diff text alone is worse than no patch. Check out the PR branch to get proposals.
let proposedFix = null
if (FIX && !filesOnDisk) {
  log('NOTE: skipping fix proposals -- files are not on disk (un-checked-out PR), so patches could not be verified against real code. Check out the PR branch and re-run to get them.')
  proposedFix = { edits: [], patchMarkdown: '_Fix proposals skipped: the PR head branch is not checked out, so patches could not be built against real file contents. Check out the branch and re-run._' }
} else if (FIX) {
  const fixable = confirmed.filter(f => f.severity === 'critical' || f.severity === 'high')
  if (fixable.length) {
    phase('Synthesize')
    proposedFix = await agent(
      '## Fix Proposer (ultrareview)\n\n' +
      'Review target: ' + manifest.target + '\n\n' +
      'Propose concrete patches to resolve these confirmed critical/high findings. Read each file to get exact surrounding code. Do NOT apply anything -- only propose.\n\n' +
      '## Findings\n' + fixable.map(f => '- (' + f.severity + ') ' + f.title + ' @ ' + f.file + (f.line ? ':' + f.line : '') + ' :: ' + f.evidence).join('\n') + '\n\n' +
      'For each: file, line, findingTitle, and the precise change (old code -> new code). Also a patchMarkdown summarizing all edits.\n\nStructured output only.',
      withModel({ label: 'propose-fix', phase: 'Synthesize', schema: FIX_SCHEMA, agentType: 'Explore' }, BASE_MODEL)
    )
  } else {
    proposedFix = { edits: [], patchMarkdown: '_No confirmed critical/high findings qualified for a patch proposal._' }
  }
}

return {
  target: manifest.target, mode: MODE_KIND, modeDetail: MODE, baseRef: manifest.baseRef, fixMode: FIX, noLogs: NO_LOGS,
  ...report, proposedFix,
  confirmedFindings: slimConfirmed, contestedFindings: slimContested, droppedFindings: slimKilled, unverifiedFindings: slimUnverified, stats,
}
