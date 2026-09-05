export const meta = {
  name: 'ultrareview',
  description: 'In-session multi-agent code-diff reviewer with per-stage model + cost knobs and quick/balanced/in-depth/max presets. Manifest -> Review (4 dims x file-batch) -> Dedup -> adversarial Verify -> Triage (mechanical / clear / fork / declined) -> Synthesize.',
  phases: [
    { title: 'Manifest', detail: 'acquire the diff -> changed-file list' },
    { title: 'Review', detail: 'parallel reviewers across dimensions x file-batches, reading real files' },
    { title: 'Dedup', detail: 'merge the same defect reported by multiple dimensions, BEFORE paying to verify it' },
    { title: 'Verify', detail: 'adversarial verification per DISTINCT finding (full=3-vote; efficient lowers votes/scope)' },
    { title: 'Triage', detail: 'investigate each CONFIRMED finding: root cause, fix options, single-fix ratings, a patch when mechanical; the bucket is derived in code' },
    { title: 'Synthesize', detail: 'merge, severity-rank, emit a review report (the triage buckets are appended verbatim)' },
  ],
}

// ultrareview + knobs. Invoke: Workflow({ scriptPath, args: '[<PR#>] [--working] [--no-triage] [--no-logs]
//   [--efficient[=level]] [--verify=level] [--preset=quick|balanced|in-depth|max | --quick|--balanced|--in-depth|--max]
//   [--model=<m>] [--review-model=<m>] [--verify-model=<m>] [--fable-review] [--codex-verify]' })
// Cost levels: full|conservative|balanced|aggressive (verify depth). Models: opus|sonnet|haiku|fable per stage.
// --codex-verify (= /hybrid-review): finders stay on Claude, the verify panel runs on OpenAI Codex.
//   In that mode --verify-model selects the CODEX tier (sol|terra|luna) instead of a Claude model.
// No --drift (ultrareview reviews the whole diff; cost dial trims verification only). --in-depth vs --max differ only by review model (sonnet vs opus) here, since costDrift is inert.
// A Dedup stage sits between Review and Verify: it cuts REDUNDANCY, never depth (every distinct finding still gets the full vp.votes panel).
// A Triage stage sits between Verify and Synthesize: one read-only agent per CONFIRMED finding investigates and RATES the fix;
//   the bucket (mechanical / clear / fork / declined) is derived HERE from the ratings, never chosen by the agent. --no-triage (alias --no-fix) skips it.

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
// Triage is ON by default; --no-triage opts out. --no-fix is kept as an ALIAS: the Triage stage
// replaced the fix proposer on 2026-09-04 (Ryan), and triage is now the only source of patches.
// The on-by-default stance carries over the 2026-07-30 reversal (Ryan) of the 2026-07-21 "fix
// proposals stay opt-in" decision -- do not silently re-flip. Grounds then, still true: every
// RECORDED run enabled proposals anyway (2026-07-15 all three PRs; 2026-07-21 21:04 Ghost base), so
// opt-in was a tax, not a guard; the action-oriented risk lives at APPLY time and is gated twice --
// the workflow only proposes, and the skill forbids applying without explicit user confirmation.
// Triage WIDENS the scope (every confirmed finding, not just critical/high) and adds the
// mechanical / clear / fork / declined split; it does not loosen the apply gate.
const TRIAGE = !(TOKENS.includes('--no-triage') || TOKENS.includes('--no-fix'))
if (TOKENS.includes('--no-fix')) log('NOTE: --no-fix is an alias for --no-triage (the Triage stage replaced the fix proposer, 2026-09-04); skipping triage AND patches.')
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
// --fast: Codex "Fast mode" (config `service_tier = "fast"`, the documented alias for the
// request tier `priority`). Same model, same weights, same effort -- only the inference
// queue changes -- so a fast panel is still ON-STANDARD (sol@high x3) and does not trip the
// OFF-STANDARD note below. Vendor claim: 1.5x token speed at 2.5x plan-credit burn on
// GPT-5.6 (it is NOT 2x). Measured 2026-09-04 (sol, n=2 per arm, same prompt): NO gain --
// ~40 tok/s read-heavy@high and ~53 tok/s generation-heavy@medium in BOTH arms, wall-clock
// within noise. ROOT CAUSE (upstream, unresolved, NOT exec-specific): the client is correct --
// wire captures on CLI 0.144 and 0.149 show `codex exec` sending service_tier=priority plus an
// x-codex-routing-hint tier=priority header. OpenAI's only reply (#14204, 2026-03) is that Fast
// is applied by server-side routing and the response's service_tier field is not a reliable
// signal -- so timing is the only test. Timed 2026-09-04 with a fixed ~3,050-token output on
// sol: exec on CLI 0.147.0 and 0.153.3, and the app-server path the IDE/desktop use (as the
// VS Code client identity and as an unknown one) -- 16 runs, all 57-60 s, fast never >2% ahead.
// Other users' 3-vs-3 A/B: 57.4 vs 57.5 s (openai/codex#32191; also #30413; open since 2026-07,
// no maintainer reply). So --fast is a NO-OP today on every surface we can drive: the run below
// logs a NOTE saying so whenever it is used. Keep the plumbing -- it is what the TUI's /fast
// persists -- and re-time when #32191 closes or the catalog's tier description changes.
// Opt-in per run, never a default: if the backend ever honours it, it spends the weekly Codex
// quota 2.5x faster for the same verdicts. Hybrid-only -- the Claude verify panel has no service
// tier, so outside --codex-verify it is a logged no-op. Verified 2026-09-04 (CLI 0.147.0,
// plan_type pro): accepted on gpt-5.6-sol; terra and luna advertise the same tier in the
// model catalog. A model that does NOT advertise it (gpt-5.4-mini) still exits 0 and runs
// at STANDARD speed; the only signal is `warning: Configured service tier ... will be
// omitted from requests` on stderr (an `error` item in the stream under --json) -- never in
// the `-o` file -- and the relay sends both streams to /dev/null, so such a panel would be
// indistinguishable from a standard one in the report. Only the three CODEX_MODELS are
// reachable here, and all three advertise the tier.
const CODEX_FAST = flagVal('fast') !== undefined
if (CODEX_FAST && !CODEX_VERIFY) log('NOTE: --fast ignored -- it sets the CODEX service tier and this run verifies on Claude. Use /hybrid-review (--codex-verify) to get it.')
if (CODEX_FAST && CODEX_VERIFY) log('NOTE: --fast requests Codex Fast mode (service_tier=priority), but as of 2026-09-04 it produced NO measurable speedup on this account on any surface -- codex exec on CLI 0.147/0.153 and the app-server path the IDE uses (openai/codex#32191, #30413; OpenAI on #14204: routing is server-side, the response tier field is not a signal). Expect standard speed; re-time before relying on it.')

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
const verifyLabel = CODEX_VERIFY ? ('codex:' + CODEX_SLUG + '@' + CODEX_EFFORT + (CODEX_FAST ? '+fast' : '')) : modelLabel(VERIFY_MODEL)
const MODE = {
  verify: VERIFY_LEVEL, preset: presetName || null, codexVerify: CODEX_VERIFY, triage: TRIAGE,
  codex: CODEX_VERIFY ? { tier: CODEX_TIER, model: CODEX_SLUG, effort: CODEX_EFFORT, fast: CODEX_FAST } : null,
  models: { base: modelLabel(BASE_MODEL), review: modelLabel(REVIEW_MODEL), verify: verifyLabel },
}
log('Mode: ' + (CODEX_VERIFY ? 'HYBRID (claude finds -> codex verifies) | ' : '') + (presetName ? 'preset=' + presetName + ' -> ' : '') + 'verify=' + VERIFY_LEVEL + (TRIAGE ? '' : ', NO-TRIAGE') + (NO_LOGS ? ', no-logs' : '') + ' | models: base=' + modelLabel(BASE_MODEL) + ' review=' + modelLabel(REVIEW_MODEL) + ' verify=' + verifyLabel + (LOW_CONFIDENCE ? ' | LOW-CONFIDENCE (1-vote verify)' : ''))
// The hybrid STANDARD (Ryan, 2026-08-04): gpt-5.6-sol @ high, 3 surviving votes per finding,
// relayFailures 0. Bare `--codex-verify` already resolves to exactly that; a preset can drop
// below it (`--quick` -> medium effort, 1 vote), so say so out loud rather than letting a
// thinner panel wear the same name in the report.
if (CODEX_VERIFY && (vp.votes < 3 || CODEX_EFFORT === 'medium')) log('NOTE: OFF-STANDARD hybrid panel (' + CODEX_SLUG + '@' + CODEX_EFFORT + ', ' + vp.votes + ' vote(s)). The standard is sol@high x3 votes -- drop the preset flags to get it. Say which panel ran when you report the result.')
// --model must never read as if it steered the verifier in hybrid mode.
if (CODEX_VERIFY && EXPLICIT_MODEL) log('NOTE: --model=' + EXPLICIT_MODEL + ' applies to the CLAUDE stages only (manifest/review/dedup/triage/synthesize); the verify panel runs on ' + CODEX_SLUG + '. Use --verify-model=sol|terra|luna to change it.')

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
// Triage verdict per CONFIRMED finding. The agent investigates, lists options, and RATES the
// recommended one; it does NOT pick a bucket -- bucketOf() (Triage stage) derives that from the
// ratings, so a rating cannot be bent toward a wanted outcome without the bend showing in the rating.
const TRIAGE_SCHEMA = {
  type: 'object',
  required: ['rootCause', 'rootCauseLocation', 'disposition', 'options', 'recommended', 'oneClearlyWins', 'whyOneOrFork', 'difficulty', 'risk', 'scope'],
  properties: {
    rootCause: { type: 'string' },
    rootCauseLocation: { type: 'string' },
    disposition: { enum: ['fix', 'decline'] },
    declineReason: { type: 'string' },
    options: { type: 'array', items: {
      type: 'object', required: ['name', 'change', 'depth', 'cost', 'winsIf'],
      properties: { name: { type: 'string' }, change: { type: 'string' }, depth: { type: 'number' }, cost: { type: 'number' }, winsIf: { type: 'string' } },
    }},
    recommended: { type: 'number' },
    oneClearlyWins: { type: 'boolean' },
    whyOneOrFork: { type: 'string' },
    difficulty: { enum: ['trivial', 'moderate', 'hard'] },
    risk: { enum: ['low', 'medium', 'high'] },
    scope: { enum: ['isolated', 'pattern'] },
    patternDetail: { type: 'string' },
    patch: { type: 'string' },
  },
}
const BUCKETS = ['mechanical', 'clear', 'fork', 'declined', 'untriaged']
const emptyTriage = (skipped) => ({
  enabled: TRIAGE, skipped,
  counts: Object.fromEntries(BUCKETS.map(b => [b, 0])),
  buckets: Object.fromEntries(BUCKETS.map(b => [b, []])),
})

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
    target: manifest.target, mode: MODE_KIND, modeDetail: MODE, baseRef: manifest.baseRef, triageMode: TRIAGE, noLogs: NO_LOGS,
    summary: 'Clean: ' + manifest.target + ' raised no findings across ' + reviewResults.length + ' reviewers (' + changedFiles.length + ' files).',
    triage: emptyTriage('no findings'),
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
  (CODEX_FAST ? " -c service_tier=\"fast\"" : "") +
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
  'The Bash default is 120000ms and `codex exec` at ' + CODEX_EFFORT + ' effort routinely needs several MINUTES on one finding.' + (CODEX_FAST ? ' `--fast` (Codex priority tier, ~1.5x) trims that; it does not remove it -- keep the full timeout.' : '') + ' Measured 2026-08-05: with the default timeout, 17 of 21 relay votes were SIGTERMed mid-run (exit 143, counted as RELAY_FAILED) and the whole panel was invalid. A timed-out relay is NOT a verdict. Do not shorten it, do not split the command, do not retry with a smaller timeout.\n\n' +
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

// --- Phase 4: Triage (investigate each CONFIRMED finding; sort into mechanical / clear / fork / declined) ---
// Replaced the fix proposer 2026-09-04 (Ryan). The proposer patched only critical/high and left
// every other confirmed finding for the human to investigate by hand -- and after every recorded
// run (2026-08-20, 2026-08-22, 2026-09-04) Ryan did the same split by hand: "these are mechanical,
// apply them; these are clear, do them; these need a product decision". This stage does the
// per-finding investigation and the SPLIT, in code. The agent RATES; the bucket is DERIVED here
// from the ratings (single-fix Phase 2: commit to the ratings, THEN evaluate the gate -- never
// rate toward a wanted bucket, and never let the agent pick its own bucket).
//
//   declined    the agent, applying the skill's step-4 adjudication rules, says do not fix: a
//               settled deferral (cited), a load-bearing convention (cited), or not a defect on
//               inspection. Surfaced WITH the citation; the human can overrule. A decline with
//               no reason is not a decline -- it lands untriaged. Convention alone ("matches the
//               siblings / pre-existing") is never a reason: the standalone test applies.
//   fork        no single fix clearly wins: a real depth-vs-cost trade-off, or it hinges on a
//               product/design decision the code cannot settle. Goes to /decision-walk with its
//               options; never decided here (2026-09-03 lesson: autonomous batch decisions in
//               place of the human walk was the failure pattern). A fork stays a fork even when
//               the recommended option happens to be trivial and comes with a patch.
//   mechanical  one fix clearly wins AND trivial + low risk + isolated (the single-fix auto-fix
//               gate, verbatim) AND a concrete patch was supplied. Batch-appliable on one confirm.
//   clear       one fix clearly wins but it is not mechanical: moderate/hard, shared code, a
//               pattern with siblings to sweep -- or rated mechanical with no patch supplied.
//   untriaged   the triage agent died, returned nothing, or returned something unusable. Fail
//               visible; never silently dropped -- conservation is by index, see below.
//
// Skipped, with a NOTE, when: --no-triage; the files are not on disk (an un-checked-out PR cannot
// be investigated, and a confident patch built from diff text alone is worse than none); or the
// hybrid panel is invalid (relayFailures > 0 -- nothing from an invalid run is adjudicated, so
// triaging it would only produce output the skill must then ignore). CONFIRMED findings only:
// contested/unverified are not real yet, and a same-model triage of a cross-model split would
// quietly re-adjudicate the very thing the panel exists to decide.
//
// Runs on REVIEW_MODEL, not BASE_MODEL: triage reads code and reasons about fixes the way a finder
// does, and the cross-model value lives in *verification* -- triage on Claude is the recorded
// preference (2026-08-01: point Codex at conclusions, not at discovery or bug triage).
const AUTO_FIX_GATE = (t) => t.difficulty === 'trivial' && t.risk === 'low' && t.scope === 'isolated'
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0
const bucketOf = (t) => {
  if (!t) return 'untriaged'
  if (t.disposition === 'decline') return nonEmpty(t.declineReason) ? 'declined' : 'untriaged'
  const opts = Array.isArray(t.options) ? t.options : []
  if (!opts.length || !Number.isInteger(t.recommended) || t.recommended < 0 || t.recommended >= opts.length) return 'untriaged'
  if (!t.oneClearlyWins) return 'fork'
  return AUTO_FIX_GATE(t) && nonEmpty(t.patch) ? 'mechanical' : 'clear'
}
const TRIAGE_PROMPT = (f) =>
  '## Finding Triage (ultrareview)\n\n' +
  'Review target: ' + manifest.target + ' (mode ' + MODE_KIND + ', base ' + manifest.baseRef + ').\n' +
  'This finding SURVIVED ' + vp.votes + '-vote adversarial verification (' + (CODEX_VERIFY ? 'Codex' : 'Claude') + ' panel, vote ' + (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes + '). Do not re-litigate whether it is real. Investigate HOW to fix it and whether one fix clearly wins. Read-only: do NOT edit anything.\n\n' +
  '## Finding\nDimension: ' + f.dimension + '\nSeverity: ' + f.severity + '\nFile: ' + f.file + (f.line ? ':' + f.line : '') + '\nTitle: ' + f.title + '\nEvidence: ' + f.evidence + '\n' + (f.suggestion ? 'Reviewer suggestion (a hypothesis, not the answer): ' + f.suggestion + '\n' : '') + '\n' +
  '## Step 1 -- investigate\n' + DIFF_HOWTO() + ' Read the cited file at the cited line plus enough context (callers, callees, the collocated test) to name the root cause as file:line and say WHY the code produces the defect. Grep for sibling call-sites that share the pattern.\n\n' +
  '## Step 2 -- disposition\n' +
  'Default `fix`. Set `decline` ONLY for: (a) a settled deferral explicitly recorded in PRODUCT-CONCERNS.md or a `.planning/debug/**/*.deferred.md` entry -- cite which; (b) an intentional choice with a concrete LOAD-BEARING reason you can cite, such that deviating would itself be a bug (a code comment explaining why counts -- read above and below the line); (c) on inspection it is not a defect -- quote exactly what you found. "It matches the other call-sites / it is pre-existing" is NOT a reason: apply the standalone test (would this be wrong or fragile as the ONLY place doing it?) -- if yes, it is a fix with scope=pattern, not a decline. Put the citation in declineReason; a decline without one is discarded.\n\n' +
  '## Step 3 -- options (1-3, best first; do NOT manufacture alternatives -- one sensible fix means one option)\n' +
  'Each option: name; change (what and where, concretely); depth 0-4 = how much of the problem it removes (0 hides the symptom, 2 fixes this site, 4 removes the cause everywhere); cost 0-4 (0 minutes, code-only, plain revert; 1 an hour, few callers, revert-safe; 2 shared code, a migration, or a prod apply; 3 migration plus backfill, or many callers newly able to throw; 4 multi-repo, or only confirmable against prod data); winsIf = the specific condition under which THIS option beats the recommended one (for the recommended option itself: the condition under which it wins, one line). Never add or average depth and cost.\n' +
  '`recommended` = 0-based index into options. `oneClearlyWins` = true when the recommended option dominates: no alternative beats it on an axis that matters here, or every alternative is strictly worse. false when a real trade-off remains (more depth only at real cost, with no obvious answer) OR the right choice hinges on a product/design decision the code cannot settle. Say which in whyOneOrFork, in plain English a non-engineer could decide from.\n\n' +
  '## Step 4 -- rate the RECOMMENDED option (definitions mirror .claude/skills/single-fix/SKILL.md Phase 1 Q2-Q4; keep them in sync)\n' +
  'difficulty: trivial = ~1-10 line mechanical change (wrong field name, missing null check, wrong boolean/enum, off-by-one, missing await, swapped args, typo in a string key); moderate = 10-50 lines, needs design thought, or coordinated changes across functions/files; hard = architectural, unclear fix boundary, new abstraction, or the right fix is debatable.\n' +
  'risk: low = one expression changed or a check added, no callers affected, no behavior change for non-buggy inputs; medium = few callers that need verification, additive but touches shared code; high = many callers, shared state, removes/restructures paths, or ordering/timing invariants.\n' +
  'scope: isolated = this code path only, fixing here is complete; pattern = the same mistake likely exists elsewhere -- name every location you found in patternDetail (that list is the sweep worklist).\n' +
  'Commit to the ratings on their merits. Do NOT adjust them to land the finding in a bucket -- the bucket is computed from them afterwards, and a mis-rated "trivial" gets applied without a human reading it.\n\n' +
  '## Step 5 -- patch (ONLY when trivial + low + isolated; otherwise leave patch empty)\n' +
  'A unified diff for the recommended option: `--- a/<file>` / `+++ b/<file>` header, @@ hunks, removed lines copied EXACTLY from the file as read. Include the collocated test change when one is needed. This is a proposal -- nothing is applied here.\n\n' +
  'Structured output only.'

const triageSkip = !TRIAGE ? '--no-triage'
  : !filesOnDisk ? 'files not on disk (un-checked-out PR) -- check out the branch and re-run to get triage + patches'
  : (CODEX_VERIFY && relayFailures > 0) ? 'INVALID hybrid panel (relayFailures ' + relayFailures + ') -- nothing from this run is adjudicated'
  : !confirmed.length ? 'no confirmed findings'
  : null
const buckets = Object.fromEntries(BUCKETS.map(b => [b, []]))
if (triageSkip) {
  log('NOTE: Triage skipped -- ' + triageSkip + '.')
} else {
  phase('Triage')
  const results = await parallel(confirmed.map((f) => () =>
    agent(TRIAGE_PROMPT(f), withModel({ label: 't:' + f.title.slice(0, 30), phase: 'Triage', schema: TRIAGE_SCHEMA, agentType: 'Explore' }, REVIEW_MODEL))
  ))
  // Conservation by INDEX: parallel() resolves a dead thunk to null IN PLACE, so results[i] is
  // always confirmed[i]'s verdict-or-nothing. Every confirmed finding lands in exactly one bucket.
  confirmed.forEach((f, i) => {
    const t = results[i] || null
    const bucket = bucketOf(t)
    if (!t) log('  UNTRIAGED "' + clip(f.title, 44) + '": triage agent returned nothing')
    else if (bucket === 'untriaged') log('  UNTRIAGED "' + clip(f.title, 44) + '": ' + (t.disposition === 'decline' ? 'decline with no cited reason' : 'no usable options / recommended index'))
    else if (bucket === 'clear' && AUTO_FIX_GATE(t)) log('  NOTE "' + clip(f.title, 44) + '": rated trivial/low/isolated but no patch supplied -> clear, not mechanical')
    f.triage = { ...(t || {}), bucket }
    buckets[bucket].push(f)
  })
  log('Triage: ' + confirmed.length + ' confirmed -> ' + buckets.mechanical.length + ' mechanical, ' + buckets.clear.length + ' clear, ' + buckets.fork.length + ' fork, ' + buckets.declined.length + ' declined' + (buckets.untriaged.length ? ', ' + buckets.untriaged.length + ' UNTRIAGED' : ''))
}

// --- Phase 5: Synthesize ---
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

const slimMap = (f) => ({ severity: f.severity, dimension: f.dimension, dimKey: f.dimKey, title: f.title, file: f.file, line: f.line, evidence: f.evidence, suggestion: f.suggestion, vote: (f.validVotes - f.refutedVotes) + '-' + f.refutedVotes, dupCount: f.dupCount, dupDimensions: f.dupDimensions, dupDimKeys: f.dupDimKeys, triage: f.triage })
const slimConfirmed = confirmed.map(slimMap)
const slimContested = contested.map(slimMap)
const slimKilled = killed.map(slimMap)
const slimUnverified = unverified.map(f => ({ severity: f.severity, dimension: f.dimension, title: f.title, file: f.file, line: f.line, evidence: f.evidence, dupCount: f.dupCount }))
const stats = { ...emptyStats, verified: verified.length, confirmed: confirmed.length, contested: contested.length, dropped: killed.length, unverified: unverified.length, codexVerify: CODEX_VERIFY, relayFailures, expectedVotes: toVerify.length * vp.votes, panelValid: !CODEX_VERIFY || relayFailures === 0 }

// --- Triage section: built HERE, deterministically, and appended AFTER synthesis ---
// Never handed to the synthesizer: it is known to drop lines it was told to echo (see the banner
// re-insertion above), and a dropped patch or a dropped fork is exactly the kind of silent loss
// this stage exists to prevent. The Forks section is written in /decision-walk's input shape.
const loc = (f) => '`' + f.file + (f.line ? ':' + f.line : '') + '`'
const optLine = (o, i, rec) => '  - ' + (i === rec ? '**' : '') + 'Option ' + (i + 1) + ': ' + o.name + (i === rec ? ' (recommended)**' : '') + ' — Depth ' + o.depth + '/4 · Cost ' + o.cost + '/4. ' + o.change + ' *Wins if:* ' + o.winsIf
const item = (f) => '- **' + f.severity + ' — ' + f.title + '** — ' + loc(f) + '\n  - Root cause: ' + (f.triage.rootCause || '?') + ' (' + (f.triage.rootCauseLocation || '?') + ')'
const ratings = (t) => t.difficulty + ' / ' + t.risk + ' risk / ' + t.scope + (t.scope === 'pattern' && nonEmpty(t.patternDetail) ? ' — siblings: ' + t.patternDetail : '')
const section = (title, list, body) => '\n### ' + title + ' (' + list.length + ')\n\n' + (list.length ? list.map(body).join('\n') + '\n' : '_none_\n')
const triageMarkdown = triageSkip
  ? '\n## Triage\n\n_Skipped: ' + triageSkip + '._\n'
  : '\n## Triage — ' + confirmed.length + ' confirmed → ' + buckets.mechanical.length + ' mechanical · ' + buckets.clear.length + ' clear · ' + buckets.fork.length + ' fork · ' + buckets.declined.length + ' declined' + (buckets.untriaged.length ? ' · ' + buckets.untriaged.length + ' UNTRIAGED' : '') + '\n\n' +
    'Buckets are derived in code from each finding\'s ratings (single-fix gate: trivial + low risk + isolated + patch = mechanical). NOTHING here has been applied.\n' +
    section('Mechanical — one fix, trivial / low-risk / isolated, patch supplied; batch-apply on ONE confirmation', buckets.mechanical,
      (f) => item(f) + '\n  - Fix: ' + f.triage.options[f.triage.recommended].change + '\n\n```diff\n' + f.triage.patch.trim() + '\n```\n') +
    section('Clear — one fix clearly wins, but not mechanical; confirm each, or hand to /parallel-fix', buckets.clear,
      (f) => item(f) + '\n  - Rated: ' + ratings(f.triage) + '\n  - Why one fix: ' + f.triage.whyOneOrFork + '\n' + f.triage.options.map((o, i) => optLine(o, i, f.triage.recommended)).join('\n')) +
    section('Forks — no single fix clearly wins; run `/decision-walk <this report>`', buckets.fork,
      (f) => item(f) + '\n  - Why it is a fork: ' + f.triage.whyOneOrFork + '\n' + f.triage.options.map((o, i) => optLine(o, i, f.triage.recommended)).join('\n')) +
    section('Declined by triage — overrule if you disagree (the standalone test applies)', buckets.declined,
      (f) => item(f) + '\n  - Reason: ' + f.triage.declineReason) +
    section('Untriaged — the triage agent returned nothing usable; investigate by hand or resume the run', buckets.untriaged,
      (f) => '- **' + f.severity + ' — ' + f.title + '** — ' + loc(f))
const slimTriage = (f) => ({ ...slimMap(f) })
const triage = {
  enabled: TRIAGE, skipped: triageSkip,
  counts: Object.fromEntries(BUCKETS.map(b => [b, buckets[b].length])),
  buckets: Object.fromEntries(BUCKETS.map(b => [b, buckets[b].map(slimTriage)])),
}

if (!report) {
  return {
    target: manifest.target, mode: MODE_KIND, modeDetail: MODE, baseRef: manifest.baseRef, triageMode: TRIAGE, noLogs: NO_LOGS,
    error: 'Synthesis failed -- returning verified findings raw.',
    counts: tally(confirmed), triage, triageMarkdown,
    confirmedFindings: slimConfirmed, contestedFindings: slimContested, droppedFindings: slimKilled, unverifiedFindings: slimUnverified, stats,
  }
}
if (banner && report.reportMarkdown) {
  // Per-banner, not all-or-nothing: the synthesizer sometimes echoes one and drops the other.
  const missing = banners.filter(b => !report.reportMarkdown.includes(b.slice(2, 26)))
  if (missing.length) report.reportMarkdown = report.reportMarkdown.replace(/^(#[^\n]*\n)/, '$1\n' + missing.join('\n') + '\n')
}
if (report.reportMarkdown) report.reportMarkdown = report.reportMarkdown.replace(/\s*$/, '\n') + triageMarkdown

return {
  target: manifest.target, mode: MODE_KIND, modeDetail: MODE, baseRef: manifest.baseRef, triageMode: TRIAGE, noLogs: NO_LOGS,
  ...report, triage, triageMarkdown,
  confirmedFindings: slimConfirmed, contestedFindings: slimContested, droppedFindings: slimKilled, unverifiedFindings: slimUnverified, stats,
}
