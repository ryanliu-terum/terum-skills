# Eval engine × phase-1 CLI — integration plan

**Status:** PLAN (2026-09-04, post-landing). Sequences the wiring between the landed
phase-1 CLI (`d046c5c`: M1 + carve-out, M2 loop, M3 team layer) and the landed eval
engine library (`a1380d1`: `src/lib/evals/` — agent, checks, execution, judge,
triggers, stats, results, receipt; all unit-tested, gates green at 284 tests).
Authoritative designs stay in `2026-09-04-eval-engine.md` (rev 5) and
`2026-09-02-phase-1-build.md` (rev 8 + rev 9 draft); this document only orders the work
and names the seams. Deferred-issues register:
`.planning/reviews/DEFERRED-2026-09-04-phase1-landing.md`.

## 0. The gap, precisely

Both sides exist; **zero wiring exists.** Missing, in dependency order:

| # | Missing piece | Spec home | Depends on |
|---|---|---|---|
| 1 | `commands/eval.ts` + `cli.ts` registration | eval spec §6 | store/catalog resolution (exists: `lib/skills.ts`, `lib/version.ts`) |
| 2 | `GuardAction 'eval'` + row g (append-only) | eval spec §10 | nothing — pure |
| 3 | `--commit` receipt flow through `safeWrite` | eval spec §6.0 | 1, 2 |
| 4 | `lib/evals/hygiene.ts` (the one unbuilt engine module) | eval spec §9 | nothing — pure |
| 5 | Hygiene wired into `share` (and later `publish`) | eval spec §9 | 4 |
| 6 | **`publish` verb — phase-1 scope, never built** (register §E) | phase-1 §6 | Ryan's M3 remainder |
| 7 | CI eval job (workflow is still an M4-gated placeholder needing npm artifacts) | eval spec §11 | 1, 3; npm publish (register §E, M4) |
| 8 | VE1/VE2 closure on the pinned CC version (contamination + stream-json fields) | eval spec §13 | a laptop, not code |

## 1. Sequencing — three PRs on our side, one dependency on Ryan's

### IE1 — `eval` runs locally (no team-repo writes)

`commands/eval.ts` orchestrates: resolve skill in the fetched team clone by name or id
(`lib/skills.ts`) → hygiene (once IE3 lands; skip-with-notice before that) → preflight
(`agent.preflight`, records `cc_version`) → trigger evals over the endorsed catalog
(`team.json global` + current project list, resolved to name+description lines) →
three-arm execution (`runCase` per case; incumbent tree materialized via
`lib/version.ts`'s archive path) → run tree under `~/.terum/skills/evals/` → printed
report. Registered in `cli.ts` exactly like `share` (injectable verb, `Result<T>`,
options object). `--working` evaluates a `config.shared` source; refuses `--commit`.

*Seams to respect:* `eval` fetches but never mutates the clone (§6.0 invariant);
arm staging excludes `evals/`+`fixtures/`; `ContaminationError` (already implemented)
aborts the run. *Exit:* a real two-arm + triggers run against a real shared skill on
one laptop, run tree inspectable.

### IE2 — committed receipts

Add `'eval'` to `GuardAction`; row g: path matches
`^evals/<uuid>/<40-hex>/<runid>\.json$`, uuid exists in post-image `skills/*/SKILL.md`,
and the path is **added, never modified or deleted** (rev 5: receipts are append-only,
one immutable file per committed run — the guard enforces immutability, not just
shape). `--commit` builds the receipt (`buildReceipt` with `config.teams[*].token`
secrets), validates, `safeWrite`s. *Exit:* VE3 + VE4 adversarial suites green
(non-UUID dir, wrong-length hash, receipt for absent id, modify-existing-receipt,
planted `ghp_`/PEM/team token absent from committed JSON).

### IE3 — hygiene tier

`lib/evals/hygiene.ts` (pure, exit-code gated): frontmatter+name match, unicode
trickery, secret/PII scan (share patterns with `receipt.redact`'s list), bundled-script
scan, license reconciliation vs `team.json policy.skill_license`, size cap. Wire into
`share` before `safeWrite` (extends the existing privilege-rejection gate). **Note the
deferred-register interaction:** register §B says `share` doesn't yet reject malformed
`allowed-tools` with a line number — hygiene is the natural place to close that
deferred item; do it here rather than as a separate fix. *Exit:* hygiene suite green;
one deliberately-tricky skill (bidi chars + planted secret + license conflict) rejected
with all three findings named.

### IE4 — CI, gated on Ryan's `publish` + M4 npm

The eval spec's PR gate (`candidate-vs-incumbent not-FAIL` on publish PRs) assumed a
`publish` verb; register §E says it was never built, and the committed workflow is a
placeholder that needs published npm artifacts (M4). So:

- **Interim (now):** CI job on PRs touching `skills/**` runs `eval --k 3` per changed
  skill **report-only**, posting alongside the existing `readme --pr-comment` publish
  preview. Requires `ANTHROPIC_API_KEY` repo secret; absent secret → neutral skip.
  Runs via checkout + `npm ci` + `node dist/index.js` until npm publish lands.
- **Final (when Ryan lands `publish`):** the same job becomes blocking on
  `publish/<name>` branches (branch plumbing in `safeWrite` already exists) —
  incumbent regression gate per eval spec §6.1.

**Dependency to flag to Ryan:** nothing in IE1–IE3 blocks on him; IE4's blocking gate
does. His M3-remainder `publish` and the eval CI gate should land as one coordinated
pair so the gate is never armed against a verb that doesn't exist.

## 2. Verification debts carried in

- **VE1/VE2** (contamination isolation + stream-json field names on the pinned CC
  version): determinism measurement started but closure not recorded — close and stamp
  in the eval spec before calling IE1 done.
- Register §A's HIGH `redact()` `/`-crossing bug is in `lib/remote.ts`'s error path,
  **not** `receipt.redact` (separate implementation) — no eval exposure, but IE2's VE4
  suite should include a `/`-bearing token to prove it.
- Rev 9 draft of the phase-1 spec is unreviewed (register §G); IE plans reference rev 8
  sections only.

## 3. Who

- **Eval side (this plan, IE1→IE3):** sequential PRs, each `lint`+`typecheck`+`test`
  green, review per house convention before merge.
- **Ryan:** `publish` (M3 remainder) + M4 npm publish → arms IE4's blocking gate.
  Also owns register §E/§F hardening; nothing here conflicts with it.
- **Teddy (UI):** unblocked **today** — the receipt schema (`receiptSchema`,
  `receipt.ts:49`) and the §12 card contract (eval spec rev 5: efficiency on the card,
  attribution one click deep) are frozen; receipts are plain JSON files in the team
  repo at `evals/<id>/<hash>/<run>.json`, newest = lexicographically last filename.
  The UI renders receipts and never re-runs anything.
