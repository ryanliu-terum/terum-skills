# Eval engine × phase-1 CLI — integration plan

**Status:** PLAN (rev 4, 2026-09-07). Rev 4 applies the round-3 codex-spec audit
(9 clear findings) and the 2026-09-07 decision walk
(`.planning/decisions/2026-09-07-hygiene-publish-gate-decision-walk.md`): the engine
pin moves to rev 13, the §17 library defects are scheduled into IE2/IE3 with
regression-test exits, publish's hygiene call moves inside the replayed `safeWrite`
mutation (walk D4), the receipt gate gains the not-FAIL + first-publish predicate
(walk D2), `setup` step 4 gains the eval one-liner, and the workflow-staging test is
scoped to exempt `team create`'s bootstrap scaffold. Rev 3 rebases the plan on finalized phase-1
**rev 9** (BUILD-READY) and the 2026-09-06 build state: `publish` LANDED (PR #2
`765032c`, register §E closed), M4 landed (PRs #8/#9) with only the npm 0.1.0 publish
itself outstanding (D7, Ryan's), and the rev-9 token-field retirement ratified —
applying the staleness findings from the second codex-spec audit (same report path)
and the 2026-09-06 decision walk (D1: existing repos migrate by hand, no CLI write
verb; D2: CI never runs a model or holds a key —
`.planning/decisions/2026-09-06-workflow-migration-decision-walk.md`).
Rev 2 applied all six confirmed findings from the first codex-spec audit
(`reviews/2026-09-04-eval-integration.codex-spec.review.md`) and resolved its fork per
Ajay: **the eval side builds `validate`** (finding 13, Option 1 — full call-site
hygiene parity). Milestones renumbered: hygiene now leads.
Sequences the wiring between the landed phase-1 CLI (current main, `765032c`+) and the
landed eval engine library (`src/lib/evals/` — all unit-tested, gates green).
Authoritative designs stay in `2026-09-04-eval-engine.md` (**rev 13**) and
`2026-09-02-phase-1-build.md` (**rev 9**, BUILD-READY); this document only orders the
work and names the seams. Deferred-issues register:
`.planning/reviews/DEFERRED-2026-09-04-phase1-landing.md`.

## 0. The gap, precisely

Both sides exist; **zero wiring exists.** The gap covers both unbuilt wiring and
built-but-defective library code, in dependency order:

| # | Missing piece | Spec home | Depends on |
|---|---|---|---|
| 1 | `lib/evals/hygiene.ts` (the one unbuilt engine module) | eval spec §9 | nothing — pure |
| 2 | **`validate <path\|name>` verb — eval spec §6 assumes it; never built** (no `commands/validate.ts`, not in `cli.ts`) | eval spec §6/§9 | 1 |
| 3 | Hygiene wired into **`validate`, `share`, `publish`, `sync`'s reconcile path, CI** — every skill-content mutation, not just the front door (`publish` LANDED, `src/commands/publish.ts`, registered in `cli.ts` — it is a present call site, not a later one) | eval spec §9 | 1, 2 |
| 4 | `commands/eval.ts` + `cli.ts` registration + the step-4 `eval` one-liner in `commands/setup.ts` | eval spec §6, phase-1 §6.1 | 3 (hygiene hard-stops first); store/catalog resolution exists (`lib/skills.ts`, `lib/version.ts`) |
| 4b | Engine §17 code defects (nine) — the shipped library diverges from the normative spec | eval spec §17 (rev 11) | nothing new — fixes land inside IE2/IE3 per the assignments there |
| 5 | `GuardAction 'eval'` + row g (append-only) | eval spec §10 | nothing — pure |
| 6 | `--commit` receipt flow through `safeWrite` + README eval column | eval spec §6.0, phase-1 §9 | 4, 5 |
| 7 | CI: blocking key-free hygiene job + deterministic receipt check on publish PRs — **no model, no key in CI** (walk D2; the scaffolded workflow placeholder still requires published npm artifacts; M4 landed 2026-09-06, only the npm 0.1.0 publish itself is outstanding — D7, Ryan's; existing team repos migrate by hand, walk D1) | eval spec §11 | 3, 6; npm 0.1.0 publish (D7) |
| 8 | VE2 closure (stream-json field names on the pinned CC version) | eval spec §13 | a laptop, not code. **VE1 is closed** (eval spec rev 6; pinned CC 2.1.236, membership check in `execution.ts` — the §7.3 contamination assert inside `runCase`, at `execution.ts:251-258` as of `57c3b78`) |

## 1. Sequencing — four PRs on our side; the one remaining dependency on Ryan is the M4 npm 0.1.0 publish

### IE1 — hygiene tier + `validate` (pure, lands first)

`lib/evals/hygiene.ts` (pure, exit-code gated, no LLM, no network). **The check
table (HYG1–HYG6), the `inspectHygiene` API, and the caller list are eval spec
§9's — authoritative as of its rev 13; this plan orders the work and does not
restate the contract. On any divergence, §9 wins.**
(One implementation note that is sequencing, not contract: the secret/PII scan
shares `receipt.ts`'s credential patterns — export them as a named API rather than
copying.) Wired into all of §9's call sites, because `share` is a one-time act —
after it, edits flow automatically. Build-order notes per site:

- **`validate <path|name>`** — new verb, `commands/validate.ts`, registered in
  `cli.ts` like every other verb; runs hygiene alone, non-zero exit on any finding.
  Built by the **eval side** (Ajay's call, 2026-09-04, resolving the audit fork).
- **`connect`** — calls `inspectHygiene` on the **post-injection candidate assembled
  in memory** (frontmatter after `injectManagedFields`), **before** both the source
  write-back and `safeWrite` — so a first share is never rejected for the managed
  fields the tool is about to add, and a refusal leaves the author's SKILL.md
  byte-identical. Extends the existing privilege-rejection gate. The
  divergence-resolution writes (`resolveDivergence`, reached via
  `connect --keep-source`/`--keep-repo`, `action: 'sync'`) are part of the covered
  set: they too run hygiene before any team-repo write.
- **`sync`'s reconcile path** — the automatic mirror of edited shared sources
  (`reconcileShared` in `src/commands/share.ts`, every `safeWrite` it issues with
  `action: 'sync'`; entered from `sync.ts`) runs hygiene on each changed skill
  **before the first team-repo write for that skill** — before `refreshRepo()`'s
  managed-field `safeWrite` as well as before the content-mirror `safeWrite`, and
  before the `shared[id].baseline` update. On failure that skill is skipped: no
  commit of any kind (a managed-field refresh included) is made, `baseline` is not
  advanced, the failure is reported per skill, and the rest of the sync proceeds.
  As at `share`, the scan input is the post-injection content (the reconcile path's
  `injectManagedFields` source repair), so managed fields never trip the gate.
  This closes the audit's sharpest hole: a secret pasted into a skill *after*
  initial sharing must never reach the repo.
- **`publish`** — LANDED (PR #2 `765032c`). Its `safeWrite` writes only `team.json`,
  but publish endorses content that may have changed since `share`, so it is a call
  site regardless. **The check runs inside the mutation `safeWrite` replays** (rev 4,
  walk D4 2026-09-07): `safeWrite` fetches and hard-resets to the latest `origin/main`
  before each attempt, so a same-skill edit landing mid-publish would otherwise be
  endorsed uninspected — `inspectHygiene` therefore runs against that attempt's fresh
  clone-resident `skills/<name>/` tree, within the replayed mutation, before any
  staging; one gate covers both `policy.publish === 'pr'` and `'push'` and no
  endorsement branch is minted for a skill that fails. Hygiene's fail-closed refusal wins over the softer
  `allowed-tools: MALFORMED` display the m3 spec gives the publish card — the card
  is never reached.

**Deferred-register interaction:** register §B is CLOSED (2026-09-06, PRs #4/#7) —
`share` already refuses a malformed `allowed-tools` and names the SKILL.md line
(`src/commands/share.ts:230-235`). Hygiene **absorbs** that check rather than
re-closing it — the contract now lives in eval spec §9 check 1 (rev 11). Build
notes: `share`'s inspection delegates to the single hygiene function rather than
keeping a second live path, and the existing share tests for the malformed message
move/extend to the hygiene suite.

*Exit:* hygiene suite green; `validate` returns non-zero on a deliberately-tricky
skill (bidi chars + planted secret + license conflict + malformed `allowed-tools`)
with all four findings named; `share` refuses the same skill through the same code
path; regression tests: a secret introduced into an already-shared source is blocked
at `sync` with repo and baseline byte-identical afterward — a managed-field refresh
commit also counts as a violation; hygiene refusal at `publish` under `push` policy
leaves `team.json` byte-identical and prints no confirmation card, and under `pr`
policy mints no `publish/` branch and opens no PR; **race test (walk D4)**: a
skill that gains a planted secret between publish's preflight and `safeWrite`'s
replay is refused — the replayed mutation's own hygiene call catches it.
Per-code boundary fixtures
(§9 rev 12): bidi / zero-width / confusable token (HYG2 hit) vs plain multilingual
prose (no hit); allowlisted vs denied extension, and a shebang file with an
allowlisted extension (HYG4 hit); `metadata.author` email (no hit) vs third-party
email (HYG3 hit); license triple equal-after-normalization (no hit) vs pairwise
conflict (HYG5 hit); SKILL.md at the HYG6 cap boundary (±1 char); one binary file
(HYG4-only scope); an allowlisted-extension, non-shebang file whose `executable`
flag alone trips HYG4 (rev 4 — proves the mode set is consulted); and one
"hygiene fails → author's SKILL.md byte-identical" case.

### IE2 — `eval` runs locally (no team-repo writes)

`commands/eval.ts` orchestrates: resolve skill in the fetched team clone by name or id
(`lib/skills.ts`) → **hygiene first, hard-stop on failure** (fail-closed per eval spec
§6.0/§9; IE1 is a prerequisite, there is no skip state) → preflight (`agent.preflight`,
records `cc_version`) → trigger evals over the endorsed catalog (`team.json global` +
current project list, resolved to name+description lines) → three-arm execution
(`runCase` per case; incumbent tree materialized via `lib/version.ts`'s archive path,
selected by eval spec §6.1's incumbent rule) →
run tree under `~/.terum/skills/evals/` → printed report. Registered in `cli.ts`
exactly like `share` (injectable verb, `Result<T>`, options object). `--working`
evaluates a `config.shared` source; refuses `--commit`. The orchestrator owns the
library's open ends per eval spec §14 ME4 (rev 11): `expected_rows` derived from the
FULL case list including skips, `environment_skips` plumbed to receipts,
`arm_skill_lists` populated, the seeded RNG (seed 0) wired into `deps.rng`.

**Library defects fixed here (eval spec §17, rev 11 — pointer form, §17 wins on any
divergence): defects 1, 2, 3, 4, 6, 7, 8, 9.** Also here (finding 5): the sixth
one-liner in `setup`'s "Next, from any terminal:" block —
`terum-skills eval <skill>` printed for both roles — which **supersedes**
m3-setup-hook §1.3 step 4's "no `eval` in wizard output" rule and its §1.4 test 9
for the `eval` half only; `ui` stays forbidden until phase 2.

*Seams to respect:* `eval` fetches but never mutates the clone (§6.0 invariant); arm
staging excludes `evals/`+`fixtures/`; `ContaminationError` (already implemented)
aborts the run. *Exit:* a real two-arm + triggers run against a real shared skill on
one laptop, run tree inspectable; test that **no preflight or agent process starts
after a hygiene failure**; §17 regression assertions — a malformed `command_matching`
pattern fails that check and the run completes (§17.1); a failing `setup` hook aborts
only its case (§17.9); nonzero agent exit with partial stream-json raises
`AgentRunError` and takes the fresh-sandbox retry (§17.8); a null `skills` init list
on a staged arm fails preflight rather than silently skipping the contamination
assert (§17.7); an errored should-trigger selection call counts in neither fn nor fp
(§17.2); a judge network error is not recorded as `judge-unparseable` (§17.4); a
non-A/B judge `winner` escalates instead of tying (§17.6); the retried attempt's
transcript survives under a distinct path (§17.3); setup-wizard tests become
`ui`-only on the forbidden-strings assertion and gain a positive eval-line check.

### IE3 — committed receipts + README eval column

Add `'eval'` to `GuardAction`; row g: path matches
`^evals/<uuid>/<40-hex>/<runid>\.json$`, uuid exists in post-image `skills/*/SKILL.md`,
and the path is **added, never modified or deleted** (rev 5+: receipts are append-only,
one immutable file per committed run — the guard enforces immutability, not just
shape). `--commit` builds the receipt, validates against `receiptSchema`, `safeWrite`s.

Redaction inputs: the exported credential patterns alone. Phase-1 rev 9 is ratified
and the schema drops `teams.<team>.token` (`src/lib/schema.ts` migrates it away on
load — Decision 2, gh is the only credential), so there is no locally-configured team
token to feed in and no Ryan resolution pending.

**README eval column** (audit finding 5): the README generator learns receipt lookup —
newest receipt = lexicographically last filename under `evals/<id>/<hash>/` for the
skill's current version — and renders the eval column (verdict) instead of the
permanent `—`. Tests: no receipt → `—`; multiple receipts → newest selected.

**Library defect fixed here (eval spec §17.5):** the judge's A/B ordering
(`swapped`) is recorded in `ComparisonRow` — an additive optional field, so the
`receiptSchema` freeze Teddy builds against is not broken.

*Exit:* §17.5's swapped-recorded assertion; VE3 + VE4 adversarial suites green (non-UUID dir, wrong-length hash, receipt
for absent id, **modify-existing-receipt refused**, planted `ghp_`/PEM/`/`-bearing
token absent from committed JSON); README column tests green.

### IE4 — CI, gated on the npm 0.1.0 publish

**CI never runs a model and never holds an API key** (walk D2, Ryan 2026-09-06 —
`.planning/decisions/2026-09-06-workflow-migration-decision-walk.md`: the report-only
eval job is removed; it reintroduced the raw-key path the engine decision exists to
avoid, and its verdicts would not be provenance-comparable to locally-committed
receipts in any case). Every eval token spent anywhere is a member's own `claude -p`
subscription. Two deterministic jobs:

- **Hygiene job — blocking, key-free, ships now.** On PRs touching `skills/**`, run
  `validate` per changed skill. Deterministic, no LLM, no secrets — it always runs
  and always blocks, on forks and unconfigured repos alike.
- **Receipt check on publish PRs [default — veto cheap].** On `publish/`-prefixed
  branches — the live shape is `publish/<name>-<handle>-<id8>` (`publish.ts`, R2),
  so the trigger matches the `publish/` prefix, not a literal `publish/<name>` —
  CI enforces eval spec §6.1's publish-PR predicate (rev 4, walk D2 2026-09-07):
  a schema-valid committed receipt at the skill's exact tree-hash version; an
  incumbent comparison, when present, must be **not FAIL**; when absent, CI
  verifies **no prior version of the skill exists** and allows the first publish.
  Missing, stale, or FAIL-carrying receipt blocks. (The earlier wording only
  checked presence — it blocked every first publish and admitted a FAIL.) The
  receipt is produced locally by the publisher on their own subscription auth
  (IE2/IE3) — CI validates evidence, it never generates it. This replaces the
  former key-gated blocking eval gate.

**Executable path (audit findings 19+26 — the previous "checkout + `npm ci` +
`node dist/index.js`" could not work):** until npm publish (M4), the workflow performs
a **second checkout of the terum-skills product repo at a pinned revision** into a
sibling path, runs `npm ci && npm run build` there (`dist/` is not tracked; `npm ci`
alone never creates it), and invokes that checkout's `dist/index.js` against the team
checkout. When M4 publishes the package, the job switches to `npx terum-skills@<ver>`.

**Migration for existing team repos (walk D1, GATE):** migrated **by hand** — the
CLI gains no write verb and no new write path. `team workflow-update --print` (or a
documented snippet) prints the current workflow YAML byte-identical to what
`team create` scaffolds, plus the instruction to commit it via an ordinary PR by
someone with push access. No CLI verb writes or stages `.github/workflows/**`
**after bootstrap** — the only writer is `team create`'s scaffold commit into an
empty remote, phase-1 §6.0's single documented `safeWrite` exception, unchanged by
this plan (rev 4, absorbing the round-3 reality finding); the guard's
refusal and the `guard-push` hook remain absolute — no new `GuardAction`, no guard
row, and phase-1 §6.0's single `safeWrite` exception is unchanged. The guarded verb
(walk Option 1 shape — through `safeWrite`, byte-exact template row, GitHub-admin
predicate) is gated: build it only if the template needs a second team-wide bump or
the repo count outgrows hand-migration (~>10). Newly scaffolded teams get the new
workflow directly at `team create`. *Exit:* printed YAML byte-identical to the
scaffold; a test asserts no verb other than `team create`'s bootstrap scaffold
stages a `.github/workflows/**` path — `create.test.ts`'s existing scaffold
assertion stays as the positive case, and `guard.test.ts:98`'s blanket refusal of
that path for guarded actions stays untouched.

**Dependency to flag to Ryan:** nothing in IE1–IE3 blocks on him; IE4 waits only on
the M4 npm 0.1.0 publish (register §E, D7) for its executable path. Both jobs are
deterministic and key-free.

## 2. Verification debts carried in

- **VE1 is closed** (eval spec rev 6: pinned CC 2.1.236; the skill-membership
  contamination assert lives inside `runCase`, `src/lib/evals/execution.ts:251-258`
  as of `57c3b78`). **VE2** (stream-json field names for `efficiency` on the pinned
  CC version) is the only one still open — close and stamp in the eval spec before
  calling IE2 done.
- Register §A's HIGH `redact()` `/`-crossing bug is in `lib/remote.ts`'s error path,
  **not** `receipt.redact` (separate implementation) — no eval exposure, but IE3's VE4
  suite includes a `/`-bearing token to prove it.
- Register §G is CLOSED — phase-1 rev 9 is the spec (BUILD-READY, 2026-09-05). IE
  plans now cite rev 9 sections; the formerly-contested token-field collision is
  resolved in IE3 (redaction inputs are the exported credential patterns alone).
- Engine §17 (rev 11) registers nine code defects in the shipped library; §17 stays
  normative and each is fixed across IE2/IE3 per the assignments above, with a
  regression test before that milestone's exit. §17's ME4 hardening notes (judge/
  trigger cwd pinning, sandbox naming, dead `transcriptName`) are explicitly NOT in
  IE scope — revisit at ME4 proper.

## 3. Who

- **Eval side (this plan, IE1→IE3 + IE4's hygiene job):** sequential PRs, each
  `lint`+`typecheck`+`test` green, review per house convention before merge. Includes
  the new `validate` verb (Ajay's fork resolution) and the hygiene wiring into the
  landed `publish`.
- **Ryan:** the M4 npm 0.1.0 publish (D7) → gives IE4 its executable path. Also owns
  register §E/§F hardening; nothing here conflicts with it. (`publish` and the rev-9
  token ratification are landed and no longer his pending column.)
- **Teddy (UI):** unblocked **today** — the receipt schema (`receiptSchema`,
  `receipt.ts:49`) and the §12 card contract (eval spec rev 6: efficiency on the card,
  attribution one click deep) are frozen; receipts are plain JSON files in the team
  repo at `evals/<id>/<hash>/<run>.json`, newest = lexicographically last filename.
  The UI renders receipts and never re-runs anything.
