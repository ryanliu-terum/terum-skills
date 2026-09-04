#!/usr/bin/env node
// codex-spec-find.mjs — the FIND half of /codex-spec.
//
// Runs the four spec-audit dimensions on OpenAI Codex and writes a merged findings
// file for the Claude verify panel (`codex-spec-verify.js`) to consume.
//
// WHY THIS IS A SCRIPT AND NOT A WORKFLOW STAGE
// Workflow scripts are sandboxed: no child_process, no filesystem. `/hybrid-review`
// works around that for its verify panel by having a thin Claude agent shell out to
// `codex exec` and copy the JSON back. That relay is fine for a 4-scalar-field verdict
// and NOT fine for findings. Measured 2026-08-01: handed a 10-finding array and told
// explicitly to preserve exact characters, a haiku relay converted 26 of 26 curly
// quotes to ASCII (dashes, ellipses, §, Δ all survived — so it is quote normalization,
// not sloppiness) and reported success. Findings whose `evidence` quotes the spec must
// match the spec byte-for-byte or the evidence is unusable. So: no model in the copy
// path. Codex writes JSON to disk, this script JSON.parse()s it, done.
//
// Usage:
//   node .claude/workflows/codex-spec-find.mjs <spec-path> --out <dir> [options]
//
//   --out <dir>            required; where to write findings.json + per-finder raw output
//   --tier sol|terra|luna  Codex model tier (default sol)
//   --effort <level>       model_reasoning_effort (default high)
//   --dims <list>          comma list of drift,reality,quality,readiness (default all)
//   --drift-cap <n>        max sibling specs to diff against (default 8)
//   --batch <n>            artifacts per reality reviewer (default 8)
//   --concurrency <n>      parallel codex calls (default 6)
//   --timeout <ms>         per-call timeout (default 600000)
//
// Exit codes: 0 = ran (check finderFailures in the output), 1 = fatal (no findings produced).

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CODEX_TIERS = { sol: 'gpt-5.6-sol', terra: 'gpt-5.6-terra', luna: 'gpt-5.6-luna' }
const RULES = '.claude/workflows/codex-spec-find-rules.md'
const FINDINGS_SCHEMA = '.claude/workflows/codex-spec-findings.schema.json'
const MANIFEST_SCHEMA = '.claude/workflows/codex-spec-manifest.schema.json'

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
}
// Positional = the spec path. Skip every --flag AND its value, so `--out dir spec.md`
// and `spec.md --out dir` both resolve the same way.
const VALUE_FLAGS = new Set(['out', 'tier', 'effort', 'dims', 'drift-cap', 'batch', 'concurrency', 'timeout'])
const positionals = []
for (let i = 0; i < argv.length; i++) {
  const t = argv[i]
  if (t.startsWith('--')) { if (VALUE_FLAGS.has(t.slice(2))) i++; continue }
  positionals.push(t)
}
const SPEC = positionals[0]
const OUT = flag('out', null)
const TIER = flag('tier', 'sol')
const EFFORT = flag('effort', 'high')
const DIMS = flag('dims', 'drift,reality,quality,readiness').split(',').map((s) => s.trim()).filter(Boolean)
const DRIFT_CAP = Number(flag('drift-cap', 8))
const BATCH = Number(flag('batch', 8))
const CONCURRENCY = Number(flag('concurrency', 6))
const TIMEOUT = Number(flag('timeout', 600000))

const die = (msg) => { console.error('FATAL: ' + msg); process.exit(1) }

if (!SPEC || SPEC.startsWith('--')) die('no spec path given. Usage: codex-spec-find.mjs <spec-path> --out <dir>')
if (!OUT) die('--out <dir> is required')
if (!CODEX_TIERS[TIER]) die(`unknown tier "${TIER}" (expected ${Object.keys(CODEX_TIERS).join('|')})`)
// Validate dims BEFORE the manifest call. The manifest is a full Codex round-trip
// (minutes); discovering "no reviewers to run" after paying for it is pure waste.
const KNOWN_DIMS = ['drift', 'reality', 'quality', 'readiness']
const badDims = DIMS.filter((d) => !KNOWN_DIMS.includes(d))
if (badDims.length) die(`unknown --dims value(s): ${badDims.join(', ')} (expected ${KNOWN_DIMS.join('|')})`)
if (!DIMS.length) die(`--dims resolved to nothing (expected some of ${KNOWN_DIMS.join('|')})`)
if (!fs.existsSync(SPEC)) die(`spec not found: ${SPEC}`)
for (const f of [RULES, FINDINGS_SCHEMA, MANIFEST_SCHEMA]) if (!fs.existsSync(f)) die(`missing harness file: ${f} (run from the repo root)`)
// Must precede mkdirSync: an --out with shell metacharacters otherwise crashes inside fs
// with a stack trace instead of a readable error. See the `shell: true` note below.
if (/[&|;$><`"'*?\r\n]/.test(OUT)) die(`--out contains shell metacharacters: ${OUT}`)
fs.mkdirSync(OUT, { recursive: true })

const MODEL = CODEX_TIERS[TIER]
const baseName = (p) => path.basename(String(p))
const log = (m) => console.log(m)

// --- codex runner -----------------------------------------------------------
// Every call gets an explicit timeout: a hung codex process would otherwise stall
// the whole audit with no output and no error.
//
// `shell: true` is required on Windows (the `codex` entry point is a .cmd shim that
// bare spawn cannot exec), and it concatenates argv without escaping. The spec path
// never reaches the command line — it travels in the PROMPT over stdin — so the only
// caller-influenced argv is the --out path, guarded above before mkdirSync.
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`

function runCodex({ id, prompt, schema, outFile }) {
  return new Promise((resolve) => {
    const args = [
      'exec', '-', '-C', '.', '-s', 'read-only', '--ephemeral',
      '-m', MODEL,
      '-c', `model_reasoning_effort="${EFFORT}"`,
      '--output-schema', q(schema),
      '-o', q(outFile),
    ]
    const child = spawn('codex', args, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    let done = false
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r) } }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ id, ok: false, reason: `timeout after ${TIMEOUT}ms` })
    }, TIMEOUT)

    child.stdout.on('data', () => {})
    child.stderr.on('data', (d) => { stderr += d.toString().slice(0, 2000) })
    child.on('error', (e) => finish({ id, ok: false, reason: `spawn failed: ${e.message}` }))
    child.on('close', (code) => {
      if (code !== 0) return finish({ id, ok: false, reason: `exit ${code}: ${stderr.trim().slice(0, 400)}` })
      if (!fs.existsSync(outFile)) return finish({ id, ok: false, reason: 'codex wrote no output file' })
      const raw = fs.readFileSync(outFile, 'utf8').trim()
      if (!raw) return finish({ id, ok: false, reason: 'codex output file was empty' })
      try {
        finish({ id, ok: true, data: JSON.parse(raw) })
      } catch (e) {
        finish({ id, ok: false, reason: `unparseable JSON: ${e.message}` })
      }
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

async function pool(tasks, limit) {
  const results = []
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  })
  await Promise.all(workers)
  return results
}

// --- prompts ----------------------------------------------------------------
const preamble = (n, of) =>
  `Follow the rules in ./${RULES} — read that file FIRST, then do what it says.\n\n` +
  `You are reviewer ${n} of ${of} on a spec audit.\n` +
  `Target spec: ${SPEC}\n\n`

const MANIFEST_PROMPT =
  `Read ./AGENTS.md at the repo root first if it exists.\n\n` +
  `## Spec Manifest Builder\n\nTarget spec: ${SPEC}\n\n## Task\n` +
  `1. Read the target spec (it exists — if you truly cannot read it, return targetFound:false).\n` +
  `2. List sibling specs to diff against: the .md files directly under .planning/specs/. EXCLUDE the target itself and everything under .planning/specs/reviews/. Return repo-relative paths in siblingSpecs.\n` +
  `3. Extract every concrete ARTIFACT the spec claims will exist or change, typed as table | migration | route | rpc | file | env | other. Capture the exact name and the spec section it appears in.\n` +
  `4. Extract cross-references: where the spec names or relies on another spec, with the shared concept.\n` +
  `5. Read PRODUCT-CONCERNS.md if present; in summary, note which deferrals are settled so later reviewers do not re-flag them.\n\n` +
  `This is EXTRACTION, not review. Do not evaluate the spec.\n\nStructured output only.`

const DRIFT_PROMPT = (sib, n, of) =>
  preamble(n, of) +
  `## Dimension: cross-spec drift\nSibling spec: ${sib}\n\n## Task\n` +
  `Read BOTH specs (grep for shared terms — related phrasings, not just exact matches). Find real conflicts, in three modes:\n` +
  `1. STALE ECHO — the target changed a concept but this sibling still describes the old version (or vice versa).\n` +
  `2. STALE COPY — this sibling embeds a copy of something the target owns (an RPC signature, a response shape, a message format, a migration number) that no longer matches.\n` +
  `3. MISSING REFERENCE — the target adds or changes something this sibling must account for, but does not.\n\n` +
  `Quote the conflicting text from BOTH specs in evidence, each with its section/line.\n` +
  `Severity BLOCKER if the mismatch will cause an implementation bug, else DRIFT. If the two specs are genuinely consistent, return findings: [].`

const REALITY_PROMPT = (batch, n, of) =>
  preamble(n, of) +
  `## Dimension: spec-vs-code reality\n\n## Artifacts claimed by the spec\n` +
  batch.map((a) => `- [${a.kind}] ${a.name}  (spec section: ${a.specSection || '?'})`).join('\n') + '\n\n' +
  `## Task\nFor EACH artifact, determine whether it exists in the codebase and matches the spec (Grep/Read/Glob):\n` +
  `- table/migration → search supabase/migrations/ and lib/ BY CONTENT, not by filename.\n` +
  `- route → search app/api for the path.   - rpc → search migrations + call sites.\n` +
  `- file → check the path exists and does what the spec says.   - env → search the var name + lib/env.ts.\n\n` +
  `Apply the SPEC-AHEAD-OF-CODE rule from the rules file: not-yet-built is the normal state of a spec and is not a defect. ` +
  `Report CODE-DRIFTED-FROM-SPEC mismatches. Quote the spec claim AND the code reality (path:line) in evidence. If everything matches or is legitimately unbuilt, return findings: [].`

const QUALITY_PROMPT = (n, of) =>
  preamble(n, of) +
  `## Dimension: internal quality\n\n## Task\nRead the full spec. Find internal defects:\n` +
  `- AMBIGUITY: a requirement interpretable two ways, or unfalsifiable.\n` +
  `- CONTRADICTION: two parts of THIS spec that conflict (BLOCKER if it would cause a bug).\n` +
  `- GAP: a TBD/TODO/placeholder, or an open decision that blocks building.\n` +
  `- SCOPE: independent features bundled that should ship separately.\n\n` +
  `Pay attention to premises the spec uses to justify a design choice — a safety argument that is factually wrong is a BLOCKER even when the prose reads confidently. ` +
  `Quote the offending text with section/line. If clean, return findings: [].`

const READINESS_PROMPT = (n, of) =>
  preamble(n, of) +
  `## Dimension: build-readiness\n\n## Task\nRead the full spec as the engineer about to implement it. Flag what would stall or mislead you:\n` +
  `- steps with no file-level specificity (no named file/function/migration)\n` +
  `- missing or hand-wavy test strategy (this repo mandates Vitest + adversarial inputs + collocated __tests__)\n` +
  `- unclear sequencing or unstated dependencies between steps\n` +
  `- steps that assume undocumented behavior\n` +
  `- a security-relevant contract left to implementer discretion: an authorization or ownership check, a privacy predicate, a replay/idempotency rule. If you would have to invent it to build the step, that is a BLOCKER — someone less careful ships it open.\n\n` +
  `Quote the vague step and say exactly what is missing to build it. If build-ready, return findings: [].`

// --- run --------------------------------------------------------------------
const t0 = Date.now()
log(`/codex-spec find — ${SPEC}`)
log(`model=${MODEL} effort=${EFFORT} dims=${DIMS.join(',')} concurrency=${CONCURRENCY}`)

log('\n[1/2] manifest…')
const man = await runCodex({
  id: 'manifest',
  prompt: MANIFEST_PROMPT,
  schema: MANIFEST_SCHEMA,
  outFile: path.join(OUT, 'manifest.json'),
})
if (!man.ok) die(`manifest failed — ${man.reason}`)
if (!man.data?.targetFound) die(`Codex could not read the target spec: ${SPEC}`)

const manifest = man.data
const siblings = (manifest.siblingSpecs || []).filter((s) => s && path.normalize(s) !== path.normalize(SPEC))
const artifacts = manifest.artifacts || []

// Drift scope: prefer siblings the spec actually cross-references; fall back to a cap.
// Same rule as ultraspec.js — an uncapped sweep spends most of its budget on unrelated specs.
const normRef = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
const crossTokens = (manifest.crossRefs || []).map((c) => normRef(c.spec)).filter((t) => t.length >= 3)
const isCrossRef = (sib) => {
  const b = normRef(baseName(sib).replace(/\.md$/i, ''))
  return b.length >= 3 && crossTokens.some((t) => b.includes(t) || t.includes(b))
}
const matched = siblings.filter(isCrossRef)
const driftSiblings = (matched.length ? matched : siblings).slice(0, DRIFT_CAP)
log(`manifest: ${artifacts.length} artifacts, ${siblings.length} siblings → drift scope ${driftSiblings.length}` +
    (matched.length ? ' (cross-referenced)' : ' (no cross-refs detected → capped fallback)'))

const batches = []
for (let i = 0; i < artifacts.length; i += BATCH) batches.push(artifacts.slice(i, i + BATCH))

const jobs = []
if (DIMS.includes('drift')) driftSiblings.forEach((s) => jobs.push({ dimension: 'cross-spec drift', id: `drift:${baseName(s)}`, build: (n, of) => DRIFT_PROMPT(s, n, of) }))
if (DIMS.includes('reality')) batches.forEach((b, i) => jobs.push({ dimension: 'spec-vs-code reality', id: `reality:${i + 1}`, build: (n, of) => REALITY_PROMPT(b, n, of) }))
if (DIMS.includes('quality')) jobs.push({ dimension: 'internal quality', id: 'quality', build: QUALITY_PROMPT })
if (DIMS.includes('readiness')) jobs.push({ dimension: 'build-readiness', id: 'readiness', build: READINESS_PROMPT })

if (!jobs.length) die('no reviewers to run (check --dims; a spec with no artifacts and no siblings yields only quality/readiness)')

log(`\n[2/2] ${jobs.length} reviewers…`)
const safe = (s) => s.replace(/[^a-z0-9._-]+/gi, '_')
const results = await pool(
  jobs.map((j, i) => () =>
    runCodex({
      id: j.id,
      prompt: j.build(i + 1, jobs.length),
      schema: FINDINGS_SCHEMA,
      outFile: path.join(OUT, `find-${safe(j.id)}.json`),
    }).then((r) => {
      log(`  ${r.ok ? String((r.data?.findings || []).length).padStart(3) + ' findings' : '  FAILED   '}  ${j.id}${r.ok ? '' : ' — ' + r.reason}`)
      return { ...r, dimension: j.dimension }
    })
  ),
  CONCURRENCY
)

// No silent degradation: a reviewer that failed removes a whole dimension's coverage,
// and a report that omits it reads as "clean". Failures are recorded and surfaced.
const failures = results.filter((r) => !r.ok).map((r) => ({ id: r.id, dimension: r.dimension, reason: r.reason }))
const findings = results
  .filter((r) => r.ok)
  .flatMap((r) => (r.data.findings || []).map((f) => ({ ...f, dimension: r.dimension, finder: r.id })))

if (!findings.length && failures.length === results.length) die(`every reviewer failed (${failures.length}/${results.length}). Check \`codex login status\`.`)

const payload = {
  specPath: SPEC,
  specTitle: manifest.title || null,
  generatedBy: { model: MODEL, effort: EFFORT, tier: TIER },
  scope: { artifacts: artifacts.length, siblings: siblings.length, driftSiblings: driftSiblings.length, reviewers: jobs.length },
  finderFailures: failures,
  findings,
}
const outFile = path.join(OUT, 'findings.json')
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2))

const bySev = findings.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a }, {})
log(`\n${findings.length} raw findings from ${results.length - failures.length}/${results.length} reviewers in ${Math.round((Date.now() - t0) / 1000)}s`)
log(`severity: ${JSON.stringify(bySev)}`)
if (failures.length) log(`WARNING: ${failures.length} reviewer(s) FAILED — coverage is incomplete, do not read this run as clean:\n` + failures.map((f) => `  - ${f.id} (${f.dimension}): ${f.reason}`).join('\n'))
log(`\nwrote ${outFile}`)
