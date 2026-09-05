# Eval engine × phase-1 CLI — integration plan

**Status:** PLAN (rev 2, 2026-09-04). Rev 2 applies all six confirmed findings from the
codex-spec audit (`reviews/2026-09-04-eval-integration.codex-spec.review.md`) and
resolves its fork per Ajay: **the eval side builds `validate`** (finding 13, Option 1 —
full four-call-site hygiene parity). Milestones renumbered: hygiene now leads.
Sequences the wiring between the landed phase-1 CLI (`d046c5c`) and the landed eval
engine library (`a1380d1`: `src/lib/evals/` — all unit-tested, gates green at 284
tests). Authoritative designs stay in `2026-09-04-eval-engine.md` (**rev 6**) and
`2026-09-02-phase-1-build.md` (rev 8 + rev 9 draft); this document only orders the work
and names the seams. Deferred-issues register:
`.planning/reviews/DEFERRED-2026-09-04-phase1-landing.md`.

## 0. The gap, precisely

Both sides exist; **zero wiring exists.** Missing, in dependency order:

| # | Missing piece | Spec home | Depends on |
|---|---|---|---|
| 1 | `lib/evals/hygiene.ts` (the one unbuilt engine module) | eval spec §9 | nothing — pure |
| 2 | **`validate <path\|name>` verb — eval spec §6 assumes it; never built** (no `commands/validate.ts`, not in `cli.ts`) | eval spec §6/§9 | 1 |
| 3 | Hygiene wired into **`validate`, `share`, `sync`'s reconcile path, CI (and later `publish`)** — every skill-content mutation, not just the front door | eval spec §9 | 1, 2 |
| 4 | `commands/eval.ts` + `cli.ts` registration | eval spec §6 | 3 (hygiene hard-stops first); store/catalog resolution exists (`lib/skills.ts`, `lib/version.ts`) |
| 5 | `GuardAction 'eval'` + row g (append-only) | eval spec §10 | nothing — pure |
| 6 | `--commit` receipt flow through `safeWrite` + README eval column | eval spec §6.0, phase-1 §9 | 4, 5 |
| 7 | **`publish` verb — phase-1 scope, never built** (register §E) | phase-1 §6 | Ryan's M3 remainder |
| 8 | CI: blocking key-free hygiene job + report-only eval job (workflow is an M4-gated placeholder; migration needed for existing team repos) | eval spec §11 | 3, 6; npm publish (register §E, M4) |
| 9 | VE2 closure (stream-json field names on the pinned CC version) | eval spec §13 | a laptop, not code. **VE1 is closed** (eval spec rev 6; pinned CC 2.1.236, membership check in `execution.ts:214-221`) |

## 1. Sequencing — four PRs on our side, one dependency on Ryan's

### IE1 — hygiene tier + `validate` (pure, lands first)

`lib/evals/hygiene.ts` (pure, exit-code gated, no LLM, no network): frontmatter+name
match, unicode trickery, secret/PII scan (sharing `receipt.ts`'s credential patterns —
export them as a named API rather than copying), bundled-script scan, license
reconciliation vs `team.json policy.skill_license`, size cap. Wired into **all** the
call sites eval spec §9 names, because `share` is a one-time act — after it, edits flow
automatically:

- **`validate <path|name>`** — new verb, `commands/validate.ts`, registered in
  `cli.ts` like every other verb; runs hygiene alone, non-zero exit on any finding.
  Built by the **eval side** (Ajay's call, 2026-09-04, resolving the audit fork).
- **`share`** — calls the same function before `safeWrite` (extends the existing
  privilege-rejection gate).
- **`sync`'s reconcile path** — the automatic mirror of edited shared sources
  (`share.ts:119-120`, action `sync`) runs hygiene on each changed skill **before**
  staging; on failure the team repo and the stored baseline are both left unchanged
  and the failure is reported per skill. This closes the audit's sharpest hole: a
  secret pasted into a skill *after* initial sharing must never reach the repo.
- **`publish`** — when Ryan lands it, it invokes the same path by construction.

**Deferred-register interaction:** register §B says `share` doesn't yet reject
malformed `allowed-tools` with a line number — hygiene closes that item here.

*Exit:* hygiene suite green; `validate` returns non-zero on a deliberately-tricky
skill (bidi chars + planted secret + license conflict) with all three findings named;
`share` refuses the same skill through the same code path; regression test: a secret
introduced into an already-shared source is blocked at `sync` with repo and baseline
byte-identical afterward.

### IE2 — `eval` runs locally (no team-repo writes)

`commands/eval.ts` orchestrates: resolve skill in the fetched team clone by name or id
(`lib/skills.ts`) → **hygiene first, hard-stop on failure** (fail-closed per eval spec
§6.0/§9; IE1 is a prerequisite, there is no skip state) → preflight (`agent.preflight`,
records `cc_version`) → trigger evals over the endorsed catalog (`team.json global` +
current project list, resolved to name+description lines) → three-arm execution
(`runCase` per case; incumbent tree materialized via `lib/version.ts`'s archive path) →
run tree under `~/.terum/skills/evals/` → printed report. Registered in `cli.ts`
exactly like `share` (injectable verb, `Result<T>`, options object). `--working`
evaluates a `config.shared` source; refuses `--commit`.

*Seams to respect:* `eval` fetches but never mutates the clone (§6.0 invariant); arm
staging excludes `evals/`+`fixtures/`; `ContaminationError` (already implemented)
aborts the run. *Exit:* a real two-arm + triggers run against a real shared skill on
one laptop, run tree inspectable; test that **no preflight or agent process starts
after a hygiene failure**.

### IE3 — committed receipts + README eval column

Add `'eval'` to `GuardAction`; row g: path matches
`^evals/<uuid>/<40-hex>/<runid>\.json$`, uuid exists in post-image `skills/*/SKILL.md`,
and the path is **added, never modified or deleted** (rev 5+: receipts are append-only,
one immutable file per committed run — the guard enforces immutability, not just
shape). `--commit` builds the receipt, validates against `receiptSchema`, `safeWrite`s.

Redaction inputs: the exported credential patterns plus any locally-configured team
token. **Caveat (contested audit finding 7, unadjudicated):** phase-1 rev 9 draft
deletes `teams.<team>.token` from the schema; if Ryan ratifies rev 9, the token input
drops out and redaction relies on pattern matching alone — resolve with him before
this PR merges.

**README eval column** (audit finding 5): the README generator learns receipt lookup —
newest receipt = lexicographically last filename under `evals/<id>/<hash>/` for the
skill's current version — and renders the eval column (verdict) instead of the
permanent `—`. Tests: no receipt → `—`; multiple receipts → newest selected.

*Exit:* VE3 + VE4 adversarial suites green (non-UUID dir, wrong-length hash, receipt
for absent id, **modify-existing-receipt refused**, planted `ghp_`/PEM/`/`-bearing
token absent from committed JSON); README column tests green.

### IE4 — CI, gated on Ryan's `publish` + M4 npm

Two separate jobs, because they have different failure semantics:

- **Hygiene job — blocking, key-free, ships now.** On PRs touching `skills/**`, run
  `validate` per changed skill. Deterministic, no LLM, no `ANTHROPIC_API_KEY` — it
  always runs and always blocks, on forks and unconfigured repos alike.
- **Eval job — report-only, key-gated.** `eval --k 3` per changed skill, posting
  alongside the existing `readme --pr-comment` publish preview. Requires the
  `ANTHROPIC_API_KEY` repo secret; absent secret → neutral skip (degrades only the
  LLM tier — the hygiene job above is unaffected).

**Executable path (audit findings 19+26 — the previous "checkout + `npm ci` +
`node dist/index.js`" could not work):** until npm publish (M4), the workflow performs
a **second checkout of the terum-skills product repo at a pinned revision** into a
sibling path, runs `npm ci && npm run build` there (`dist/` is not tracked; `npm ci`
alone never creates it), and invokes that checkout's `dist/index.js` against the team
checkout. When M4 publishes the package, the job switches to `npx terum-skills@<ver>`.

**Migration for existing team repos:** already-scaffolded teams carry the placeholder
workflow, and the guard refuses `.github/workflows/**` writes by design. Default
[veto cheap]: workflow updates ship as a `team workflow-update` admin operation that
opens a PR via `gh` against the team repo (mirroring `team create`'s scaffold path,
**outside** `safeWrite` — the guard stays untouched); newly scaffolded teams get the
new workflow directly.

- **Final (when Ryan lands `publish`):** the eval job becomes blocking on
  `publish/<name>` branches (branch plumbing in `safeWrite` already exists) —
  incumbent regression gate per eval spec §6.1.

**Dependency to flag to Ryan:** nothing in IE1–IE3 blocks on him; IE4's blocking eval
gate does. His M3-remainder `publish` and that gate should land as one coordinated
pair so the gate is never armed against a verb that doesn't exist. The blocking
hygiene job has no such dependency and ships with IE4 regardless.

## 2. Verification debts carried in

- **VE1 is closed** (eval spec rev 6: pinned CC 2.1.236, skill-membership check landed
  in `src/lib/evals/execution.ts:214-221`). **VE2** (stream-json field names for
  `efficiency` on the pinned CC version) is the only one still open — close and stamp
  in the eval spec before calling IE2 done.
- Register §A's HIGH `redact()` `/`-crossing bug is in `lib/remote.ts`'s error path,
  **not** `receipt.redact` (separate implementation) — no eval exposure, but IE3's VE4
  suite includes a `/`-bearing token to prove it.
- Rev 9 draft of the phase-1 spec is unreviewed (register §G); IE plans reference rev 8
  sections, with the one rev-9 collision (the retired token field) called out in IE3.

## 3. Who

- **Eval side (this plan, IE1→IE3 + IE4's hygiene job):** sequential PRs, each
  `lint`+`typecheck`+`test` green, review per house convention before merge. Includes
  the new `validate` verb (Ajay's fork resolution — not Ryan's M3 remainder).
- **Ryan:** `publish` (M3 remainder) + M4 npm publish → arms IE4's blocking eval gate.
  Also owns register §E/§F hardening and the rev-9 token-field ratification that IE3's
  redaction inputs depend on; nothing here conflicts with it.
- **Teddy (UI):** unblocked **today** — the receipt schema (`receiptSchema`,
  `receipt.ts:49`) and the §12 card contract (eval spec rev 6: efficiency on the card,
  attribution one click deep) are frozen; receipts are plain JSON files in the team
  repo at `evals/<id>/<hash>/<run>.json`, newest = lexicographically last filename.
  The UI renders receipts and never re-runs anything.
