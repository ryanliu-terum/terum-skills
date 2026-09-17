// Regenerates queue-args-ryan.json from Teddy's queue-args-final.json with the 2026-09-08 M7 takeover ledger applied.
// Run: node apply-takeover-ledger.mjs   (writes queue-args-ryan.json beside this file; idempotent)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = JSON.parse(readFileSync(join(here, 'queue-args-final.json'), 'utf8'))
const byId = Object.fromEntries(src.batches.map((b) => [b.id, b]))

const OUT = {
  S7t: 'OUT (Ryan D2, 2026-09-08): favorites and follow hidden on the real adapter; the committed fields wait on Ryan\'s written ruling',
  S7ab: 'OUT (Ryan D3, 2026-09-08): admin = GitHub repo admin, read-only, via ls --host (S7h); no team.json role field, no verb',
  S7y: 'OUT (Ryan D5, 2026-09-08): deferred until the first project key is hand-written into a team.json; the app shows keys as spelled',
  S7aa: 'OUT (Ryan D8, 2026-09-08): moot, cli_spawn already sets the child cwd (lib.rs:44-45); no --cwd flag',
}
for (const [id, status] of Object.entries(OUT)) byId[id].status = status

const addDeps = (id, deps) => { const b = byId[id]; for (const d of deps) if (!b.dependsOn.includes(d)) b.dependsOn.push(d) }
const note = (id, text) => { const b = byId[id]; b.decisionNotes = (b.decisionNotes ? b.decisionNotes + ' ' : '') + text }

// D13: frames.ts edit order S7d -> S7b -> S7ae -> S7l. D6: S7q before every un-grey (S7b memberRole, S7ae progress, S7u perCase).
addDeps('S7b', ['S7d', 'S7q'])
addDeps('S7ae', ['S7b', 'S7q'])
addDeps('S7l', ['S7ae'])
addDeps('S7u', ['S7q'])
note('S7d', 'Ledger D13: S7d edits src/lib/frames.ts FIRST and rewrites the all-false invariant in src/lib/__tests__/frames.test.ts (:31 at f8557c4) into a snapshot of the whole FRAME_FEATURES map; S7b, S7ae and S7l then stack on the previous editor\'s branch and each change one line.')
note('S7b', 'Ledger D1: `roles` keeps meaning the Admin/Member permission chip and stays false; add a NEW key `memberRole:true` to FRAME_FEATURES for the roster job label (additive, protocol stays 1) and map it app-side through S7q\'s features record. Ledger D2: no favorites/follow fields; S7t is out. Stacks on S7d (frames.ts) and S7q (features mapping).')
note('S7q', 'Ledger D6 (LOCK): app-side mapping only, no CLI key rename. run.ts keeps the hello frame instead of returning at `case \'hello\'`; index.ts stops hard-coding Capabilities; keep the eight-key Capabilities (disablePerMachine straight across, perCase -> perCaseEvalTables; inboxEventLog, offtargetKind, machineRegistry stay false) and add a `features` record carrying the CLI\'s twelve keys plus memberRole (default false when the CLI omits it). The mock declares every key so the locked boards hold. On the real adapter a false feature hides or greys the drawn control (favorites, follow, roles, lastSeen, installScope, inviteScoping, progress, liftOnCards, runEvalInApp, perCase, projectMembers, disablePerMachine). Runs third: every later un-grey depends on it.')
note('S7k', 'Ledger D7 (LOCK): categories are READ ONLY, served from the parsed team.json onto TeamStatus; no guard change; TJ-12\'s write route stays refused. Ledger D3: nothing here keys off roles.')
note('S7h', 'Ledger D3 (LOCK): admin means GitHub repo admin, read-only, from ls --host; the chip must not key off FRAME_FEATURES.roles (D1); the role menu loses its settable items, "Remove from team" stays; an explicit unknown state (offline, no gh, generic git, empty github) and no chevron; rewrite desktop/GAPS.md:38 accordingly.')
note('S7ad', 'Ledger D4 (LOCK): recorded launch PATH (BM-11) written by `app` and `setup` on every launch beside `target` (BM-12); bridge.ts accepts both; cli_spawn sets command.env("PATH", ...) in lib.rs; a missing key falls back to the process PATH. Ryan\'s fork is decided: no login-shell probe.')
note('S7ae', 'Ledger D13: stacks on S7b\'s frames.ts edit (one-line change flipping progress:true) and on S7q for the app-side features mapping.')
note('S7l', 'Ledger D13: stacks on S7ae\'s frames.ts edit; one-line FRAME_VERBS/feature change.')
note('S7v', 'Ledger D11 (LOCK): Ryan amends the eval-engine §12 rule himself; the overseer drafted the paragraph in .planning/specs/2026-09-04-eval-engine.md (the sentence near :480, the paired §5.4 display rule :251-252 and §12 :481-482, amended together) and it ships INSIDE this PR, commit labelled "drafted under Ryan\'s D11 ruling, for his read"; Ajay is named in the PR body. Rules: a display surface may render lift, verdicts and a pre-run cost estimate from one committed receipt\'s own numbers, may hand off a run to the CLI through the Prompter, never derives a new statistic across receipts, never ranks by receipt numbers; suppress when the arm model differs from receipt.provenance.model; render nothing on no-receipt; label the estimate as arm-run pricing.')
note('S7m', 'Ledger D11: proceeds on the same footing as S7v; Ajay named in the PR body.')
note('S7n', 'Ledger D11: proceeds on the same footing as S7v; Ajay named in the PR body.')
note('S7u', 'Ledger D11: proceeds on the same footing as S7v; Ajay named in the PR body. Stacks on S7q (perCase -> perCaseEvalTables mapping).')
note('S7x', 'Ledger D10 (LOCK + DEFER): the window minimum stays 960x600 (tauri.conf.json unchanged); the shell\'s main panel content gets min-width 1200px with overflow-x auto on the panel (Shell.tsx), pixel-neutral at 1440x900; one Playwright assertion at 960 that nothing overflows its container. The sixteen reflow rules and the second baseline stay deferred (canvas arrived; queue order last).')

// D9 + handoff: S7w shrinks to RM-23 as the focus-refresh policy; RM-24 (driving setup) pairs into S7r so onboarding lights in tranche 1.
byId['S7w'].rows = ['RM-23']
byId['S7w'].title = 'App-only seam mechanics: refresh after own actions and on window focus, plus a Sync now action (no native file check, no timer)'
note('S7w', 'Ledger D9 (GATE): own-action + focus refresh via the query client\'s focus policy (AD-02) and the AD-05 subscribe consumer, plus a Sync now action; NO sixth Tauri command, NO timer, NEVER a polling sync; lib.rs stays at five commands. RM-24 moved to S7r. The native mtime check is deferred behind the e2e walk showing a focused board going stale.')
if (!byId['S7r'].rows.includes('RM-24')) byId['S7r'].rows.push('RM-24')
byId['S7r'].title = 'App-only: chrome, the preference store, the adapter rules the mock already carries, the Inbox feed, onboarding routing, driving setup (RM-24), and the RM-17 consumer'
note('S7r', 'Handoff 2026-09-08: RM-24 (driving `setup` through the Prompter from the onboarding screen) is paired into this batch so a joiner\'s first run works in tranche 1; consume app.json\'s target once per writtenAt (BM-12, S7ad). Ledger D10: the AC-04 "min 1200x720" clause is superseded; minimum stays 960x600 with the 1200-wide content scrolling sideways (S7x carries the CSS rule). Ledger D2: the Follow control and the favorite heart stay hidden on the real adapter.')

// Order: tranche 1, then 2, then 3 (handoff §Step 3). OUT/MOOT/DONE batches trail and are skipped by the queue.
const ORDER = ['S7af', 'S7ag', 'S7q', 'S7f', 'S7g', 'S7k', 'S7ad', 'S7d', 'S7e', 'S7b', 'S7c', 'S7r',
  'S7m', 'S7n', 'S7u', 'S7v',
  'S7h', 'S7i', 'S7j', 'S7ae', 'S7l', 'S7o', 'S7p', 'S7s', 'S7w', 'S7x',
  'S7t', 'S7ab', 'S7y', 'S7aa', 'S7z', 'S7a', 'S7ac']
const missing = src.batches.map((b) => b.id).filter((id) => !ORDER.includes(id))
if (missing.length) throw new Error('batches not placed in ORDER: ' + missing.join(', '))
const out = { ...src, batches: ORDER.map((id) => byId[id]), tranches: { t1: ORDER.slice(0, 12), t2: ORDER.slice(12, 16), t3: ORDER.slice(16, 26) } }
writeFileSync(join(here, 'queue-args-ryan.json'), JSON.stringify(out, null, 1) + '\n')
console.log('wrote queue-args-ryan.json:', out.batches.length, 'batches; tranche 1 =', out.tranches.t1.join(' '))
