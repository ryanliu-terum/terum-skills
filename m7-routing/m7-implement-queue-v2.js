export const meta = {
  name: 'm7-implement-queue-v2',
  description: 'Implement the M7 batches in priority order: one Codex (gpt-6-astra) run per batch in its own worktree, dependents stacked on unmerged dependency branches, the orchestrator\'s own gates, a branch push and a PR into ryanliu-terum/terum-skills; never a push to main',
  phases: [
    { title: 'Plan', detail: 'priority ready-queue from the batch order and dependsOn; skip DONE/MOOT/DEFERRED and empty batches; GATED batches open draft PRs' },
    { title: 'Implement', detail: 'per batch: spec, worktree (stacked on unmerged deps), codex exec, gates, commit, push, PR' },
    { title: 'Review', detail: 'one reviewer over every opened PR: diffs read against AGENTS.md invariants and the batch spec' },
  ],
}

// args: { batches: [...merged, verified M7 batches in PRIORITY ORDER...], repo, base, maxParallel, dryRun, only: [ids], m7doc }
const REPO = (args && args.repo) || '/home/teniroo/Projects/SSM/terum-skills'
const BASE = (args && args.base) || 'origin/main'
const MAXP = (args && args.maxParallel) || 2
const DRY = !!(args && args.dryRun)
const ONLY = (args && args.only) || null
const LOCK = '/tmp/claude-1000/-home-teniroo-Projects-SSM/7f851f32-e149-4a13-9205-90f176fdcb4a/scratchpad/gate.lock'
const COST = '/home/teniroo/Projects/SSM/terum-skills/.planning/research/2026-09-07-desktop-app-gap-costing.md'
const M7DOC = (args && args.m7doc) || '/home/teniroo/Projects/SSM/terum-skills/.planning/research/2026-09-08-m7-close-the-canvas-gaps.md'
const WT_ROOT = '/home/teniroo/Projects/terum-skills-codex'

const CONTEXT = `
YOU ARE ONE IMPLEMENTER IN THE M7 QUEUE. Settled facts (do not re-litigate):
- Repo: ${REPO} (git remote origin = github.com/ryanliu-terum/terum-skills, public, Apache-2.0). NEVER push to main directly, never pass a flag that skips git hooks, never force-push, never touch another batch's worktree, never edit files under ${REPO} itself (work only in your worktree). You open ONE pull request from ONE branch. Merging (Teddy, final, 2026-09-08: "You can merge"): after your own gates pass and the PR's CI checks are green (poll \`gh pr checks <n> --repo ryanliu-terum/terum-skills --watch\` up to 20 minutes), merge it yourself with \`gh pr merge <n> --repo ryanliu-terum/terum-skills --merge\` (a merge commit, the repo's norm) and return status 'merged'. Never merge a draft (gated) PR, never merge on red or pending checks, never merge when Codex's openQuestions change behaviour (return 'pr-opened' with the questions instead), and if a stacked dependency is still unmerged when you finish, wait for it (poll its PR state up to 30 minutes) before merging yours. main is a public repository Ryan owns; every merge is visible to him.
- Build method (Teddy, final): Codex writes every line of code; you write the spec, run the gates yourself, commit, push the branch, open the PR. Codex runs with: codex exec -C <worktree> -m gpt-6-astra -c model_reasoning_effort="high" --sandbox workspace-write --output-schema /home/teniroo/.claude/skills/codex-implement/report.schema.json -o <run>/codex-report.json - < <run>/codex-prompt.md  (stdin prompt; NO -a flag, NO --full-auto). Codex must not run git, installs, network, or Playwright; it verifies writes by reading back; it reports real gate counts; ambiguity goes to openQuestions and the most conservative reading is implemented.
- The M7 milestone document is ${M7DOC}. Rows with a costing id (RM-, MC-, PF-, TJ-, EV-, IB-, CP-, AC-) have a paste-ready spec delta in ${COST} §2 (lines 258-1219; grep '#### <id> '); its line anchors cite b5c0507/85cc276 and may have drifted, so re-grep at the current main before quoting. Rows with a BM- id (the desktop blank-map asks) have their delta ONLY in the M7 document's "Desktop demand list" and "Routed rows" sections. Rows with an AD- id (adapter and shell halves) have their delta in the M7 document's section 10.8 and, verbatim, in your batch's adapterHalf field. The CLI's loader for Codex is ${REPO}/AGENTS.md (read it; its invariants bind). The desktop app's loader is ${REPO}/desktop/AGENTS.md (eight invariants; the seam rule; generated files; the fidelity oracle needs TERUM_DESIGN_DIR=/home/teniroo/Projects/SSM/design/terum-skills).
- Connected surfaces (Teddy, final, 2026-09-08): a batch ships its CLI half AND its app half in the same PR. The app half means: map the verb's result frame value into the seam DTO in desktop/src/backend/tauri (declare every new key on the closed zod objects, never passthrough; every new field maps with ?? null, never undefined), update desktop/src/backend/mock when the seam changes, and flip the served-surfaces flag (S7af's mechanism) for any read model the batch completes so the sidebar shows it. The real app shows only real data: never a design constant, never a sample value, never a fabricated caption; an undelivered field is null and its slot renders empty; a surface whose read model is still a gap stays hidden. Everything must be pixel-neutral on the mock: the 87 locked boards must not move.
- Frame mode is how the app drives the CLI (docs/frame-protocol.md); the real adapter is desktop/src/backend/tauri/. A CLI result shape change must keep the frame's result.value the verb's own object; every new field is additive (hello.protocol stays 1); a new verb must be added to FRAME_VERBS in src/lib/frames.ts or a shell cannot discover it.
- Gates you run yourself (never trust Codex's numbers), serialised across implementers with flock on ${LOCK} because two batteries thrash this 12-CPU/7.7 GB box:
    ROOT: cd <wt> && NODE_OPTIONS=--dns-result-order=ipv4first npm ci && npm run lint && npm run typecheck && npm test
    RUST (only if desktop/src-tauri changed): cargo check per the recipe in ${REPO}/.planning/research/2026-09-07-desktop-app-tauri-build.md (no packaged app is possible on this box; say so in NOTES.md).
    DESKTOP (every batch that touches desktop/, which is every batch with an app half): cd <wt>/desktop && NODE_OPTIONS=--dns-result-order=ipv4first npm ci && npm run typecheck && npm run lint && npx vitest run && npm run build && npx playwright test e2e/routes --workers=2 --reporter=line; and with TERUM_DESIGN_DIR set: python3 tools/export-design.py --check && npx playwright test e2e/fidelity --workers=2 --reporter=line (87 locked boards must still pass; a pixel change is a FAILURE to report, never a row to unlock).
    REAL-DATA PROOF (every batch with an app half; this is what "the surface shows real data" means): build the CLI in your worktree (npm run build), copy /home/teniroo/Projects/SSM/review/2026-09-08-desktop-blank-map/fixture.sh to <run>/fixture.sh and change its CLI= line to <wt>/dist/index.js, run it with a scratch root <run>/fx, then with HOME=<run>/fx/home run \`node <wt>/dist/index.js --frames <verb> [args]\` for every verb your batch's surfaces read and save each verb's frames to <run>/frames/<verb>.jsonl. Add or extend a vitest under desktop/src/backend/tauri that replays those recorded result frames through the read model your batch serves and asserts the served DTO carries the batch's fields with real values and no design constant (undelivered fields null). Paste the served DTO into verify.log. The fidelity battery proves the mock did not move; this replay proves the real adapter serves the data.
  Record every exit code and the summary lines in <run>/verify.log.
- Known local quirk: Ryan's release-plan test 18 fails on this WSL box even on a clean main (git findable despite the test's PATH trick) while CI is green; if it is the ONLY root failure, note it as pre-existing and continue.
- Worktree and stacking: git -C ${REPO} fetch origin; then git -C ${REPO} worktree add ${WT_ROOT}/<batchId> -b codex/m7-<batchId> ${BASE}. For EACH id in your batch's dependsOn that is in this run: if \`gh pr view codex/m7-<dep> --repo ryanliu-terum/terum-skills --json state -q .state\` prints MERGED, nothing to do (origin/main has it); else if \`git -C <wt> ls-remote --heads origin codex/m7-<dep>\` lists the branch, run \`git -C <wt> merge --no-edit origin/codex/m7-<dep>\` so your branch builds on the dependency's code (say so in the PR body: "stacked on #<n> until it merges"); if that merge conflicts, abort it and STOP the batch as failed (NOTES.md names the conflicting files). If the dependency's branch does not exist yet (its implementer failed), STOP as failed with that reason.
- Run record under <wt>/.planning/codex-runs/m7-<batchId>/ (codex-prompt.md, codex-report.json, verify.log, NOTES.md) committed WITH the code as a second commit. Commit titles: "codex/m7-<batchId>: <title> (gpt-6-astra high; <real counts>)" then "m7-<batchId> run record". Push: git -C <wt> -c credential.helper='!gh auth git-credential' push -u origin codex/m7-<batchId>. PR: gh pr create --repo ryanliu-terum/terum-skills --base main --head codex/m7-<batchId> --title "m7-<batchId>: <title>" --body-file <run>/pr-body.md (body: what/why, rows closed, approver, gate table with real numbers, open questions from the report, the costing line anchors or the M7 document section for BM rows, and the stacking note if any). If the batch is gated, open the PR as --draft and say what approval it waits on in the first line. gh may time out reaching github.com on this box: retry a failing gh call twice with a 20 s pause before treating it as a failure.
- If Codex reports status blocked, or the gates fail structurally after one mechanical fix attempt, STOP that batch: leave the branch unpushed, write NOTES.md with the failure, return status 'failed' with the real output. Never launder a failure.
- Your final structured output is the only thing the orchestrator reads.
`

const RESULT_SCHEMA = { type: 'object', properties: {
  batchId: { type: 'string' }, status: { type: 'string', enum: ['merged', 'pr-opened', 'draft-pr-opened', 'failed', 'skipped'] },
  branch: { type: 'string' }, prUrl: { type: 'string' }, worktree: { type: 'string' },
  stackedOn: { type: 'array', items: { type: 'string' } },
  gates: { type: 'string', maxLength: 3000, description: 'exit codes and summary lines from YOUR run' },
  codexSummary: { type: 'string', maxLength: 2000 }, openQuestions: { type: 'array', items: { type: 'string', maxLength: 600 } },
  filesChanged: { type: 'array', items: { type: 'string' } }, notes: { type: 'string', maxLength: 3000 },
}, required: ['batchId', 'status', 'gates', 'notes'] }

phase('Plan')
const all = (args && args.batches) || []
if (!all.length) throw new Error('args.batches is required (the merged, verified M7 batches in priority order)')
const isSkipped = (b) => /\b(DONE|MOOT|DEFERRED)\b/i.test(b.status || '') || !(b.rows || []).length
const skip = new Set(all.filter(isSkipped).map((b) => b.id))
const wanted = all.filter((b) => !skip.has(b.id) && (!ONLY || ONLY.includes(b.id)))
const wantedIds = new Set(wanted.map((b) => b.id))
const depsInRun = (b) => (b.dependsOn || []).filter((d) => wantedIds.has(d))
// cycle check: Kahn over the in-run graph
{
  const indeg = Object.fromEntries(wanted.map((b) => [b.id, depsInRun(b).length]))
  const ready = wanted.filter((b) => indeg[b.id] === 0).map((b) => b.id)
  let seen = 0
  while (ready.length) { const id = ready.shift(); seen++; for (const b of wanted) if (depsInRun(b).includes(id) && --indeg[b.id] === 0) ready.push(b.id) }
  if (seen !== wanted.length) throw new Error(`dependsOn cycle among: ${wanted.filter((b) => indeg[b.id] > 0).map((b) => b.id).join(', ')}`)
}
const plan = wanted.map((b) => ({ id: b.id, dependsOn: depsInRun(b), rows: b.rows, approver: (b.approver || '').slice(0, 60), gated: /gated/i.test(b.status || '') || /GATED/.test(b.title || '') }))
log(`Plan: ${wanted.length} batches in priority order (skipped ${[...skip].join(', ') || 'none'}); max ${MAXP} concurrent; dryRun=${DRY}`)
if (DRY) return { plan, skipped: [...skip] }

phase('Implement')
const done = new Set()      // finished with a PR
const failed = new Set()    // failed or blocked
const results = []
const pending = wanted.slice()
const running = new Map()
const canStart = (b) => depsInRun(b).every((d) => done.has(d))
const blockedBy = (b) => depsInRun(b).filter((d) => failed.has(d))
const implementPrompt = (b) => `${CONTEXT}\nYOUR BATCH:\n${JSON.stringify(b)}\n\nSteps: (1) read the M7 document section for ${b.id} and, for each row (${b.rows.join(', ')}), the costing §2 delta paragraph or, for BM- rows, the M7 document's routed-row paragraph; (2) write the spec <wt>/.planning/specs/m7-${b.id}.md: self-contained, every fork pre-answered, files to touch, tests to add in the existing layouts (CLI: src/**/__tests__; desktop: *.test.ts(x)), acceptance = the gate lines above with expected counts, constraints (no git, no installs, no network, no Playwright, verify writes by reading back); (3) create the worktree, stack on unmerged dependencies as instructed, and install; (4) build the Codex prompt (AGENTS.md first, the spec verbatim, the standing constraints) and run codex exec in the foreground with a 55-minute timeout; (5) read codex-report.json and the diff; revert any weakened test and any lint-rule suppression comment that lacks a same-line reason; (6) run the gates under flock; (7) commit, push the branch, open the PR (draft if gated), then wait for its CI checks and merge it as instructed above (never a draft); (8) write NOTES.md; (9) return the structured result with status 'merged' when the merge succeeded. Work only inside your worktree and the run record.`
while (pending.length || running.size) {
  // drop batches whose dependency failed
  for (const b of pending.slice()) {
    const bad = blockedBy(b)
    if (bad.length) {
      pending.splice(pending.indexOf(b), 1); failed.add(b.id)
      results.push({ batchId: b.id, status: 'skipped', gates: 'not run', notes: `dependency failed: ${bad.join(', ')}` })
      log(`${b.id} skipped: dependency failed (${bad.join(', ')})`)
    }
  }
  while (running.size < MAXP) {
    const next = pending.find(canStart)
    if (!next) break
    pending.splice(pending.indexOf(next), 1)
    log(`Start ${next.id} (deps: ${depsInRun(next).join(', ') || 'none'}; running: ${[...running.keys()].join(', ') || 'none'})`)
    // A spawn can fail before an agent exists (transient API or permission error); a root batch failing that way
    // would cascade to every dependent, so retry the spawn up to three times with a distinct label each time.
    const runBatch = async (b) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        let r = null
        try { r = await agent(implementPrompt(b), { label: attempt === 1 ? `implement:${b.id}` : `implement:${b.id}#${attempt}`, phase: 'Implement', schema: RESULT_SCHEMA, effort: 'high' }) } catch (e) { r = null }
        if (r) return { b, r }
        log(`${b.id}: implementer spawn/run returned nothing (attempt ${attempt} of 3)`)
      }
      return { b, r: null }
    }
    const p = runBatch(next)
    running.set(next.id, p)
  }
  if (!running.size) {
    if (pending.length) { log(`Unmet dependencies leave ${pending.map((b) => b.id).join(', ')} unstarted`); for (const b of pending) { failed.add(b.id); results.push({ batchId: b.id, status: 'skipped', gates: 'not run', notes: `unmet dependency: ${depsInRun(b).join(', ')}` }) } }
    break
  }
  const { b, r } = await Promise.race(running.values())
  running.delete(b.id)
  const status = r ? r.status : 'failed'
  results.push(r || { batchId: b.id, status: 'failed', gates: 'agent returned nothing', notes: 'the implementer agent died or was skipped' })
  if (status === 'merged' || status === 'pr-opened' || status === 'draft-pr-opened') done.add(b.id); else failed.add(b.id)
  log(`${b.id} finished: ${status}${r && r.prUrl ? ' ' + r.prUrl : ''}`)
}

phase('Review')
const opened = results.filter((r) => r.status === 'merged' || r.status === 'pr-opened' || r.status === 'draft-pr-opened')
const review = opened.length ? await agent(`${CONTEXT}\nYou are the reviewer. For each PR below: gh pr diff <number> --repo ryanliu-terum/terum-skills, read it against ${REPO}/AGENTS.md and ${REPO}/desktop/AGENTS.md, the batch spec and the row deltas. Report per PR: invariants at risk, tests that only exercise what the implementation already handles, any lint-rule suppression comment or weakened test, any file outside the batch's scope, whether a stacked PR's diff includes only its own batch once the base merges, and whether the PR body's gate table matches verify.log in the run record. Do not edit anything. PRs:\n${JSON.stringify(opened.map((r) => ({ batchId: r.batchId, prUrl: r.prUrl, branch: r.branch, stackedOn: r.stackedOn })))}`, { label: 'review', phase: 'Review', schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { batchId: { type: 'string' }, prUrl: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'none'] }, finding: { type: 'string', maxLength: 1500 } }, required: ['batchId', 'severity', 'finding'] } } }, required: ['findings'] }, effort: 'high' }) : { findings: [] }

return { results, review: review.findings, plan, skipped: [...skip] }
