# terum-skills eval engine — build spec

**Status:** DRAFT (rev 16, 2026-09-07; rev 2–3 = §12 card slots reshuffled: efficiency promoted to the card, attribution moved one click deeper; rev 4 = verified badge tier scrapped entirely; rev 5 = receipts append-only, one immutable file per committed run — all Ajay; rev 6 = §7.3 contamination check asserts membership not equality + VE1 closed + §5.1 authoring rule, from the 2026-09-04 determinism probe; rev 7 = variance reducers, same probe: §7.5 judge double-asked in both orderings with disagreement → `judge-split` tie, §7.1 headless note appended to every arm + one arm retry in a fresh sandbox + `model_id` snapshot recorded per arm; rev 8 = `requires` host-tool declarations with environment-skip semantics (option 1, Ajay 2026-09-06): missing tools skip the case as visible unscored holes + `environment_skips` receipt field, CI runner canonical for gating; rev 9 = sixth check kind `command_succeeds` for deterministic script verifiers, SkillsBench-style; rev 10 = §11 rewritten (Ryan, 2026-09-06 walk D2): CI never runs a model or holds an API key — the eval job and its `ANTHROPIC_API_KEY` repo secret are removed, the publish gate becomes a deterministic receipt check, and rev 8's "CI runner canonical for gating" clause is superseded — gating receipts are produced locally, with `environment_skips` greying verdicts as before; rev 11 = code-vs-spec reconciliation against the built library (Ryan, 2026-09-06): §9 caller list gains `sync`'s reconcile path and the malformed-`allowed-tools` check — finding 6 upheld, register §B absorbed — §5.1/§7.1 absorb shipped semantics (case-insensitive `transcript_mentions`, sandbox-escape containment, `command_succeeds` shell/timeout, all-checks-passed comparison wording, `decided_by` vocabulary, `execution_status` conditions, attribution derivation, 30s probe cap), ME4 gains the orchestrator's open-ends contract, and the new §17 registers nine code defects + hardening notes from the audit — the spec stays normative, the code gets fixed at IE time; rev 12 = §9 predicates frozen (audit finding 19, applied on Ryan's continue): pure `inspectHygiene` API, scanned-input rule (share's `sourceFiles` map, UTF-8/no-NUL text test), and the HYG1–HYG6 table with exact code points, the mixed-script token algorithm, the extension allowlist, SPDX-normalized license compare, and the 20,000-char cap — the [provisional cap] marker resolved as a veto-cheap default; rev 13 = round-3 audit fixes + 2026-09-07 walk (Ryan): §9's frozen input gains `executable: ReadonlySet<string>` — HYG4's exec-bit clause was unimplementable against a bare `Map<string, Buffer>` — HYG2 becomes single-script-per-token (walk D1, superseding the self-contradicting wording), HYG3's email matcher/normalization/author-extraction/RFC-2606 exemption written out, §6.1+§11's publish receipt predicate fixed to require not-FAIL and permit first publication with a deterministic incumbent rule (walk D2), and §8 redaction re-worded off the retired `teams.<team>.token` field; rev 14 = HYG4 consent waiver (walk D5, Ryan 2026-09-07): `--allow-privileged` consent — or a repo copy already carrying the consented form — waives exec-bit/shebang findings via the `allowExecutable` input flag, restoring phase-1's privileged-consent flow that rev 12's unconditional wording had silently closed; the extension allowlist and all other checks still apply, and `validate` (v0.1.x: team-required, per Ryan's same-day ruling) never sets the flag; rev 15 = IE2 vocabulary absorption (Ajay, 2026-09-07): §7.1/§7.5 gain `decided_by: "judge-network-error"` — the §17.4 fix requires a distinguishable label the vocabulary never named; a tie whose every chain attempt died to a transient network failure carries it, the chain's backoff sleeps standing in for a separate network retry budget **[provisional]**; rev 16 = HYG6 size cap demoted to a non-blocking warning (Ryan, 2026-09-07): inspectHygiene returns { errors, warnings }; the 20,000-code-unit SKILL.md check is the only warning-tier finding — printed by validate, share, sync's reconcile, publish, eval, and CI, gating none of them (validate exits 0) — while description-empty HYG6 and HYG1–HYG5 remain fail-closed; safeWrite's mutation may return a value for the completed attempt; rev 17 = §12 permitted-display-derivations enumeration + §5.4 twin (Ajay, 2026-09-08, for M7 batch S7v): four permitted derivations — `net_lift` at card altitude and per-version receipt lists (EV-01/EV-16), terminal hand-off run trigger (EV-02, D27's second branch), single-receipt per-machine forecast suppressed on `provenance.model` mismatch (EV-09), coverage/verdict tally with provenance stamp (EV-19); everything unlisted stays forbidden.) — written under a partial lift of the phase-3 spec
gate (Ajay, in-session 2026-09-04: "we're on a time crunch … just do as much as you can";
the override did not record in Terum — receipt rejected — so the shared ledger still
shows the gate standing). Items that genuinely need published-skill experience are marked
**[provisional — revisit with experience]**; everything else is written to the phase-1
standard: implement as written, defaults are veto-cheap.

**Parents:** `2026-09-02-phase-1-build.md` (rev 9, BUILD-READY — authoritative for
everything it covers; this spec never contradicts it, only extends), ledger
`2026-09-01-team-skill-sharing.md` (D22, D26, D28–D30), decision walk Decision 5
**as superseded** by the engine decision (Ajay, 2026-09-04, recorded in Terum:
engine = skilldeck's `claude`-CLI harness adapted for terum-skills), research dossiers
`2026-09-03-phase-3-eval-share-research.md` and
`2026-09-04-eval-engine-adaptation.md` (incl. the D29 display resolution, commit
`25ff226`), and the skilldeck harness at `github.com/ajayw36/skilldeck` commit `42084dc`
(`tools/skilldeck/evals/`), which this spec ports. Where this spec and any parent
disagree, the phase-1 build spec wins for phase-1 surfaces; this spec wins for eval
surfaces.

## 1. Context

Phase 3's eval engine, specced early because Ryan (CLI) and Teddy (UI) need stable
interfaces now. The engine is skilldeck's `claude -p` harness — three-arm execution
evals plus catalog-wide trigger evals on the member's own logged-in Claude Code —
**ported from Python to TypeScript inside this repo** (E1). The measured record backing
every design rule here: real execution is mandatory (shim mean −0.08 → real +0.24),
single-run lift is a ±0.1 noise band, arm scores reproduce (r = 0.97) while their
difference doesn't (r = 0.35), verdict-band agreement was 13/14 across identical runs,
and lift-based ranking is uncorrelated with an independent benchmark (ρ = −0.11).

**North Star check:** a teammate runs one command against a shared skill and gets a
verdict they can trust and commit; the committed receipt is the product (D26: "that
commit is the receipt"), and the UI renders receipts, never re-runs anything.

## 2. Scope

**In:** the `eval` verb and engine library (`src/lib/evals/`); execution cases and
trigger files as authored artifacts inside skill folders; the committed receipt schema
at `evals/<skill-id>/<tree-hash>/<run-id>.json`; the guard row and `GuardAction` for receipt
writes; the hygiene (deep deterministic validation) tier wired into every
skill-content mutation (§9's authoritative caller list: `validate`, `share`,
`publish`, `sync`'s reconcile path, CI);
secret redaction; the publish-PR CI receipt check (rev 10 — CI runs no evals); the
UI data contract (what Teddy renders, from where).

**Out (gated/deferred):** share-card rasterization (D30 stays OPEN; candidate survey in
research §6 — `@resvg/resvg-js` recommended, decide at build time), `eval-gen`
model-authored case generation (ME5, after the engine runs), Codex/agent-agnostic arms,
containerized/sandboxed execution (trust hardening tracked as an open item, not built),
Tier-2 embeddings dedup, any leaderboard or cross-skill comparison surface (banned by
the D29 resolution, not merely deferred).

## 3. Stack and engine layout

TypeScript, same repo, same rules as phase-1 §3: library-first, `Result<T>`, Prompter
boundary, injected runners, no new npm deps (`yaml`, `zod`, `commander`,
`proper-lockfile` suffice; hashing via `node:crypto`, spawning via `node:child_process`).

```
src/
  commands/eval.ts            `eval` verb — flag parsing, orchestration, report printing
  lib/evals/
    agent.ts                  spawn `claude` (the ONLY module that spawns it); Transcript
    execution.ts              three-arm case loop, sandbox seeding, verdict per comparison
    triggers.ts               catalog-wide selection eval over the endorsed set
    checks.ts                 the six deterministic check kinds (rev 9 added command_succeeds)
    judge.ts                  pairwise judge + position swap + retry/escalation chain
    stats.ts                  net_lift, exact two-sided sign test
    results.ts                local run trees, run meta, report rendering
    receipt.ts                committed-receipt build + zod schema + redaction
    hygiene.ts                deep deterministic validation tier (no LLM, exit-code gated)
```

Named rules:

- **Port, don't wrap.** The Python harness (~800 lines) is ported module-for-module; the
  skilldeck repo becomes reference material, never a runtime or build dependency (E1).
- **`agent.ts` is the trust boundary.** Everything that executes teammate skill content
  goes through `runAgent`/`askJson` there; nothing else spawns `claude`. The binary name
  comes from `TERUM_SKILLS_AGENT_CMD` (default `claude`) for tests.
- **Determinism first.** `checks.ts` + `stats.ts` + `receipt.ts` + `hygiene.ts` are pure
  (no subprocess, no network) and land first (ME1) with full unit coverage.

## 4. File trees

### 4.1 Team repo additions

```
team-skills/
├── skills/<name>/
│   ├── SKILL.md
│   ├── references/…
│   └── evals/                      ← NEW: eval assets travel INSIDE the skill folder
│       ├── triggers.yaml           should_trigger / should_not_trigger prompt lists
│       ├── cases/<case>.yaml       one execution case per file; stem = case name
│       └── fixtures/<fixture>/…    sandbox seed trees, referenced by cases
└── evals/<skill-id>/<tree-hash>/<run-id>.json   committed receipts (D26), one per committed run
```

Rules the tree encodes:
- **Eval assets version with the skill.** Because cases live inside `skills/<name>/`,
  the phase-1 tree-hash version *is* the dataset digest — a receipt keyed by tree hash
  pins skill text AND the cases that judged it. No separate `dataset_digest` bookkeeping.
- **Receipts are keyed by identity, not name:** `evals/<metadata.id UUID>/<full 40-char
  tree hash>/<run-id>.json`. Renames don't orphan receipts; content pinning is exact;
  the run-id filename (UTC timestamp) makes lexicographic order chronological.
- The `evals/` root dir already exists in every scaffold (`team create`, phase-1 M1).
- Raw run trees (transcripts, sandboxes) are **never** committed; receipts reference
  them by `run_id` (D26 + adaptation §2).

### 4.2 Local state additions (`~/.terum/skills/`)

```
evals/<team>/<skill-id>/<YYYYMMDDTHHMMSSZ>/
  run.jsonl                 meta line + one row per comparison / trigger block
  transcripts/<case>.<arm>.<rep>.jsonl
```

Pruning of old run trees is manual for now **[provisional — revisit with experience]**.

### 4.3 Arm sandboxes

Per (arm × rep): fresh `mkdtemp` under the run's scratch dir. Seeded strictly in order:
fixture copy → inline `files` (reject absolute/`..`; `.sh` → 0755) → `setup` shell hook
(`/bin/sh -ce`, 60 s cap, nonzero rc aborts the case) → skill staging at
`<sandbox>/.claude/skills/<name>/` **excluding `evals/` and `fixtures/`** (the skill
must not see its own answer key). Baseline stages nothing. Sandboxes persist for
post-hoc inspection under the run tree.

## 5. Data schemas

### 5.1 Execution case (`skills/<name>/evals/cases/<case>.yaml`)

Verbatim skilldeck format plus one optional field:

```jsonc
{
  "task": "…",              // required — the -p prompt, must be answerable headlessly
                            // (a headless agent that asks a question dies silently)
  "fixture": "../fixtures/payments-repo",   // optional, dir relative to the case file
  "files": { "src/app.ts": "…" },           // optional inline seeds; .sh → 0755
  "setup": "git init -q && …",              // optional shell hook, 60s cap
  "checks": [                               // optional; single-key dicts, six kinds:
    { "transcript_mentions": "STRIPE_KEY" },//   case-insensitive substring, full transcript
    { "no_command_matching": "deploy\\.sh" },// regex over Bash commands, pass = no hit
    { "command_matching": "npm test" },     //   regex over Bash commands, pass = hit
    { "file_exists": "deployed.marker" },   //   path relative to sandbox
    { "file_absent": ".env.leaked" },
    { "command_succeeds": "python3 -m pytest -q verify.py" }  // rev 9: /bin/sh -ce in sandbox, pass = rc 0, 120s cap (killed → fails with rc=killed)
  ],
  "judge": "2–4 sentence rubric",           // optional; judge runs ONLY on check ties
  "bucket": "adversarial"                   // optional; explicit|implicit|contextual|
                                            //   negative|adversarial (SkillEvaluator
                                            //   four-bucket taxonomy + our adversarial)
}
```

`requires` (rev 8, option 1 — Ajay 2026-09-06): optional list of host tools the case
needs — a binary name (PATH probe) or `python3:<module>` (import probe). Probed BEFORE
any agent run; a case with missing requirements is **skipped as
`environment_skips[case]`**, its rows counted as unscored holes that grey the verdict
— never run to a both-arms-flail tie, because a false NEUTRAL from a missing
toolchain is indistinguishable from "skill doesn't help." Receipts carry
`environment_skips` (optional field, rev 8). The requirement probe carries a 30s
per-probe timeout (measured: a 10s cap falsely reported pandas missing under
14-process contention). *(Rev 10 supersedes the earlier "CI runner canonical for
gating" clause here: CI runs no evals — gating receipts are produced locally, and
`environment_skips` greys verdicts as before.)*

Authoring rule (from the 2026-09-04 determinism probe): skill conventions and case
tasks must not pattern-match to prompt injection — an unconditional magic-string
mandate ("every report MUST start with the literal line X") makes a wary agent stop
and ask instead of complying, and a headless agent that asks a question dies silently,
scoring as skill failure. Phrase conventions as natural practice, not incantation.

Unknown check kinds **fail** (they never error the run), as do malformed check specs.
`file_exists`/`file_absent` paths are resolved against the sandbox and a path that
escapes it **fails the check** with `path escapes the sandbox` — including
`file_absent`, where an escaping path fails even though the file is trivially absent
from the sandbox (containment beats literal semantics; rev 11, documenting shipped
behavior). Checks are all-or-nothing per arm; there is no partial credit inside a
case — and §7.1's round decision compares the two arms' all-checks-passed booleans,
never per-check pass-sets (rev 11 wording fix: two arms passing disjoint subsets tie
on checks and fall through to the judge).

### 5.2 Trigger file (`skills/<name>/evals/triggers.yaml`)

```yaml
should_trigger:      ["<prompt that must select this skill>", …]
should_not_trigger:  ["<NEAR-MISS prompt — unrelated prompts are worthless>", …]
```

### 5.3 The committed receipt (`evals/<id>/<tree-hash>/<run-id>.json`)

`receiptSchema` in `receipt.ts`; zod, `.passthrough()` at every level (phase-1
forward-compat convention). Annotated shape:

```jsonc
{
  "schema_version": 1,
  "skill_id": "5f0e…-uuid",             // metadata.id
  "skill_name": "deploy-preflight",     // display convenience; id is authoritative
  "version": "<40-char tree hash>",     // = git rev-parse <commit>:skills/<name>
  "run_id": "20260904T221500Z",         // pointer into the runner's local run tree
  "verdict": "PASS",                    // PASS | NEUTRAL | FAIL — the headline (§6.2)
  "attribution": "wins on execution checks; judge ties on style cases",  // one line
  "execution_status": "complete",       // complete | partial | failed — NO coercion:
  "expected_rows": 9, "scored_rows": 9, //   unscored holes stay visible, never averaged
  "comparisons": {
    "candidate-vs-baseline":  { "win": 5, "loss": 1, "tie": 3,
                                "net_lift": 0.44, "sign_p": 0.219 },
    "candidate-vs-incumbent": { "win": 2, "loss": 1, "tie": 6,
                                "net_lift": 0.11, "sign_p": 1.0 }   // absent for new skills
  },
  "arm_scores": {                       // D29 display numbers: per-arm check pass-rate,
    "candidate": 0.82,                  //   mean over (case×rep) of fraction-of-checks-
    "baseline": 0.61,                   //   passed; judge-only cases excluded; null when
    "incumbent": 0.79                   //   no case has checks
  },
  "triggers": { "recall": 1.0, "precision": 0.83,
                "tp": 5, "fn": 0, "fp": 1, "tn": 5 },   // null if triggers.yaml absent
  "efficiency": {                       // means from claude -p result events, per arm
    "candidate": { "turns": 6.2, "duration_ms": 41200, "cost_usd": 0.38 },
    "baseline":  { "turns": 7.8, "duration_ms": 52900, "cost_usd": 0.51 }
  },
  "provenance": {
    "engine_version": "0.1.0",          // package.json version
    "engine_commit": "<12 hex>",        // terum-skills commit of the running CLI
    "cc_version": "2.34.0",             // `claude --version` — receipts are only
    "model": "sonnet",                  //   comparable within same model AND cc_version
    "judge_model": "sonnet",
    "k": 3,
    "cases": ["missing-env", "happy-path", "rollback-unknown"],
    "arm_skill_lists": { "baseline": [], "candidate": ["deploy-preflight"] },  // §7.3
    "timestamp": "2026-09-04T22:15:00Z",
    "runner_handle": "ajay"             // who ran it (people/ handle)
  }
}
```

All free-text fields (`attribution`, any judge `reason` surfaced later) pass through
redaction (§8) before the receipt is built.

### 5.4 Receipt keying and comparability contracts

- One immutable receipt file per committed run: `evals/<id>/<tree-hash>/<run-id>.json`.
  Re-running the same version **appends** a new file beside the old — receipts are never
  overwritten or deleted (rev 5, Ajay 2026-09-04). The run-id filename is the UTC
  timestamp, so lexicographic order is chronological. Display surfaces default to the
  latest receipt per version; a surface may list a version's committed receipts
  individually per §12(a) — each beside its own provenance, opened one at a time, never
  two side by side in one number (rev 17) — and older receipts otherwise stay in the
  tree as history.
- Numbers from receipts with different `model` or `cc_version` are never merged or
  compared by any surface. The UI shows provenance beside any number.
- A receipt with `execution_status: "partial"` displays its verdict greyed with
  "partial (7/9 scored)" — never silently promoted to a full verdict.

## 6. Command behavior

### 6.0 Invariant — evals never mutate anything but their own surfaces

`eval` reads the team clone and the store; it writes only (a) its local run tree and
(b), with `--commit`, one new receipt file through `safeWrite` under the new guard
row (append-only — an existing receipt path is never rewritten). It never touches `skills/`, `people/`, `team.json`, or the member's placed skills.

- **`eval <name|id> [--k N] [--triggers-only|--execution-only] [--case <stem>]
  [--model <m>] [--judge-model <m>] [--commit] [--team <t>]`** — resolve the skill in
  the team clone (fetch first; evaluate the *store* copy, not the member's placed copy);
  hygiene tier runs first and hard-stops on any error finding; the HYG6 size warning is printed and the run proceeds (rev 16); then preflight (§7.4); then
  triggers (§7.2) unless `--execution-only`; then execution (§7.1) unless
  `--triggers-only`; write the run tree; print the report (verdict, W/L/T + net lift +
  sign p per comparison, arm scores, trigger MISS/FALSE-FIRE lines, efficiency deltas);
  with `--commit`, build + redact the receipt and `safeWrite` it (action `eval`).
  Defaults: `--k 3` (`--k 10` for depth when it matters), `--model sonnet`
  **[provisional — cost/quality balance unmeasured at team scale]**.
- **Evaluating the working tree** (author loop): if the skill resolves to a local
  authored source registered in `config.shared`, `--working` evaluates that directory
  as candidate instead of the store copy; `--commit` is refused for `--working` runs
  (receipts pin committed trees only).
- **`validate <path|name>`** gains the hygiene tier (§9) — free, no LLM, exit-code
  gated; `share` and `publish` invoke it by construction.

### 6.1 Lifecycle gates

| Stage | Requirement |
|---|---|
| `connect` | No eval requirement. Hygiene tier must pass (no error finding; the HYG6 size warning prints before the confirmation card and does not block). |
| `sync` (reconcile of edited shared sources) | No eval requirement. Hygiene must have no error finding per changed skill before the first team-repo write (§9) — a secret pasted into an already-shared skill never reaches the repo; the size warning prints when the edit is mirrored and does not block or defer. |
| `publish` PR | The PR must carry a current, schema-valid **locally-produced committed receipt** at the skill's exact tree-hash version. If the receipt carries a candidate-vs-**incumbent** comparison, it must be **not FAIL** (regression gate). If it carries none, CI verifies **no prior version of the skill exists** (no earlier receipted tree-hash for its id, and no prior `skills/<name>/` tree on `origin/main`) and the first publish proceeds (rev 13, walk D2 — the earlier wording blocked every first publish and never tested FAIL). CI verifies the receipt deterministically (§11) and runs no evals of its own. Incumbent rule **[default — veto cheap]**: incumbent = the most recent receipted tree-hash for the skill id, by run-id order, excluding the candidate's own hash; none → the first-publish path. |

There is no tier above `publish` — the verified badge was scrapped (rev 4, Ajay). The
sign test is decoration at k=3 (a 3/3 sweep is p = 0.25 two-sided — it cannot gate);
the verdict band alone gates at PR level. The p-value becomes meaningful at k=10,
available to anyone who wants a deeper receipt, but nothing in the lifecycle demands it.

## 7. Engine mechanics

### 7.1 Three-arm execution

Arms: **baseline** (no skill staged), **candidate** (store copy at the fetched head, or
`--working` source), **incumbent** (the skill's tree at the last version having a
committed receipt, else at `origin/main`'s prior state; materialized via
`git archive <tree> | tar -x` — the **full** tree, improving on skilldeck's
SKILL.md-only swap so incumbent supporting files are period-correct). Incumbent is
skipped when identical to candidate or when no prior version exists.

Per rep per arm: seed sandbox (§4.3) → `runAgent(task, sandbox)`:

```
claude -p <task> --output-format stream-json --verbose --max-turns 25
       --permission-mode acceptEdits --allowedTools "Bash Read Write Edit Glob Grep"
       --setting-sources project --strict-mcp-config
       --append-system-prompt <HEADLESS_NOTE> --model <m>
       (cwd = sandbox, env += CLAUDE_PROJECT_DIR=<sandbox>, timeout 600 s)
```

`HEADLESS_NOTE` (rev 7) tells the agent it is unattended and must act rather than stop
to ask — applied to every arm identically so the comparison stays fair (measured: the
balk-and-ask death was the dominant noise source in the 2026-09-04 probe). Each arm
sample also records `model_id`, the **resolved model snapshot from the init event**
(rev 7) — the request alias (`sonnet`) floats day to day, and only the snapshot makes
the §16.9 same-model comparability rule checkable.

→ run checks → emit one row per (rep × opponent). Verdict per row, in order: both arms
failed → tie; one failed → other wins; all-checks-passed booleans differ → decided by
checks (rev 11 wording fix — arms passing disjoint check subsets are checks-equal and
fall through, per §5.1's all-or-nothing rule); equal + no rubric → tie; equal +
rubric → judge (§7.5). An `AgentRunError` or timeout is **retried once in a fresh
sandbox** (rev 7 — an infra flake scored against the empty transcript is a spurious
loss; `retried` is recorded on the arm sample); a second failure never aborts the
matrix — the arm's row is scored against an empty transcript and `execution_status`
reflects any unscored holes.

Row bookkeeping (rev 11, documenting shipped behavior): `decided_by` ranges over
`checks`, `checks-equal-no-judge`, `both-arms-failed`, `candidate-run-failed`,
`opponent-run-failed`, and §7.5's judge outcomes (`judge`, `judge-split`,
`judge-unparseable`, `judge-refused`, `judge-network-error` — rev 15). **`both-arms-failed` rows are the sole
unscored-hole class** — a one-arm failure is a scored win/loss per the rule above.
`execution_status` is `failed` when zero rows scored against a nonzero expectation,
`complete` when the expectation is zero (so a triggers-only run is `complete` with a
NEUTRAL verdict, not greyed). The receipt's `attribution` one-liner is derived
deterministically: wins/losses are attributed to "execution checks" when at least
half their rows were checks-decided, else to "judge calls"; all-ties renders
"all comparisons tied".

### 7.2 Trigger evals

Catalog = the **endorsed set**: `team.json` `global` plus the current project's list if
run inside a registered project, resolved to `- name: description` lines from the store
— the catalog actually competing for attention on a teammate's machine — with the skill
under eval always included even if not yet endorsed. One tool-free `claude -p
--output-format json --max-turns 1 --disallowedTools "*"` call per prompt asking for
`{"selected": [names]}`; scored per skilldeck (membership per prompt; errored rows count
in neither tn nor fp; recall/precision null-safe). Report prints `MISS` / `FALSE-FIRE`
lines per failing prompt.

### 7.3 Contamination control

`--setting-sources project` + `CLAUDE_PROJECT_DIR=<sandbox>` means user-level
(`~/.claude`) skills are not loaded — the sandbox is the entire project scope, so the
global-copy contamination SkillEvaluator worries about is excluded **by construction**,
not by warning (VE1 closed 2026-09-04, see §13). Each arm's resolved skill list is
captured from the init event into `provenance.arm_skill_lists`; the engine asserts
**membership of the skill under eval** — present in candidate/incumbent, absent in
baseline — and refuses the run on mismatch (rev 6). List *equality* is not asserted:
the CLI's init event always carries its built-in skills (16 on CC 2.1.236), so the
original baseline = [] assertion refused every real run. A planted skill with a name
other than the one under eval is indistinguishable from a built-in by name alone;
`--setting-sources project` remains the mechanism that excludes it, and
`arm_skill_lists` in the receipt keeps the full lists auditable.

### 7.4 Preflight

Before any matrix: `claude --version` (recorded), then one 1-turn agent smoke task in a
throwaway dir. Failure aborts before paid/slow work (SkillEvaluator's measured lesson:
seconds instead of six wasted trials). Preflight also fails with a clear message when
`claude` is absent or logged out.

### 7.5 Judge chain

Pairwise, rubric-anchored, last-6000-chars per transcript. **Double-asked (rev 7):**
the judge is asked twice, once in each A/B ordering (first ordering randomized by the
seeded RNG, seed 0 — reproducible; recorded in the row). Agreement across orderings is
the verdict; disagreement is a tie, `decided_by: "judge-split"` — a position-biased
verdict is discarded instead of surviving as a coin flip (measured motivation: judge
flips were a top-two noise source in the 2026-09-04 determinism probe; judge calls are
the cheap half of a comparison). Each ask runs the escalation chain (adopted practice;
skilldeck has none): parse failure → one retry → re-ask on
`--judge-escalation-model` (default `opus`) **[provisional]** → final failure = tie,
`decided_by: "judge-unparseable"` — unless every attempt in the chain died to a
transient network failure, in which case the tie is labeled
`decided_by: "judge-network-error"` so the receipt distinguishes an infra flake from
an unparseable model (rev 15, closing §17.4's label half; the chain's backoff sleeps
stand in for a separate network retry budget for now **[provisional]**). All judge
calls wrapped in retry-with-backoff for
transient network failures. Usage-policy refusals on subscription-side judging (the
suricata lesson) are a documented failure mode: the row becomes a tie with
`decided_by: "judge-refused"`, surfaced in the report, never coerced.

## 8. Secret redaction

Before any content leaves the machine (receipt fields today; any future shared evidence)
it passes `redact()`: every caller-supplied secret string passed to
`redact(text, secrets)` (phase-1 rev 9 retired `teams.<team>.token`, Decision 2 —
there is no configured team token, so the array is empty today and exists for
values the caller already holds), plus standard credential patterns (`ghp_…`, `github_pat_…`, `sk-ant-…`, `AKIA…`, PEM blocks,
`Bearer <jwt>`), replaced with `[redacted]`. Transcripts and run trees stay local and
un-redacted for debugging; the boundary is *sharing*, not recording.

## 9. Hygiene tier (deep deterministic validation)

`hygiene.ts`, run by `validate`, `connect`, `publish`, **`sync`'s reconcile path**, `eval`, and
CI — this list is **authoritative** (rev 11; the integration plan points here rather
than restating it): hygiene runs before *every* skill-content mutation of the team
repo. On the sync path that means before the FIRST team-repo write for each changed
skill — before `reconcileShared`'s managed-field `safeWrite` as well as the content
mirror — and on any error finding that skill is skipped with no commit of any kind, the stored
baseline not advanced, and the failure reported per skill. Free, no LLM; exit-code gated on error findings, warning findings print and pass.

**API (rev 16 — pure, per §3 and ME1):**
`inspectHygiene(input: { name, frontmatter, files: Map<string, Buffer>, executable: ReadonlySet<string>, policy: { skill_license }, allowExecutable? }): HygieneAssessment`
where `HygieneAssessment = { errors: HygieneFinding[], warnings: HygieneFinding[] }` and
`HygieneFinding = { code, path, line?, message }`. No I/O, no subprocess; empty
`errors` is a pass, any error finding is a fail (fail-closed), and callers gate on
`errors.length` — never on a combined count. `warnings` are printed by every caller
before the gate (so a refusal still shows them) and never block (rev 16). **Scanned input:** the caller supplies both structures — hygiene
never walks the disk itself (rev 13). `share`/`sync` build the map from
`sourceFiles` and the `executable` set from a `stat` of each entry at read time
(`executable` holds the subset of `files` keys whose source mode has any of
`0o111` set); `validate`/`publish`/CI build them from an `lstat` of the resolved
skill directory or the clone-resident `skills/<name>/` tree (Git entry mode
`100755` → in the set, `100644` → not). A caller that cannot observe modes (none
today) passes an empty set — a pass, not a skip. Symlinks cannot occur in the map
(`assertSkillDirectory` refuses them tree-wide before any share); hygiene asserts
that invariant rather than re-implementing it. A file is **text** iff its content
decodes as UTF-8 with no NUL byte in the first 8 KiB; non-text files are subject
only to HYG4. Every finding carries a stable code:

| Code | Predicate (exact) |
|---|---|
| HYG1 | Frontmatter fails the strict zod parse, or folder name ≠ `name`, or `allowedTools(frontmatter['allowed-tools'])` returns `grants.ok === false` (the zod parse alone cannot catch it — `'allowed-tools': z.unknown().optional()`); emits the same line-numbered message `share` uses today (rev 11, absorbing register §B — closed 2026-09-06 — into hygiene as the single live path). |
| HYG2 | Any text file contains a bidi control (U+202A–U+202E, U+2066–U+2069) or zero-width character (U+200B–U+200D, U+2060, U+FEFF); or any whitespace-delimited token mixes scripts — per token, using the Unicode Script property, **all letters must share one script** (Common/Inherited — digits, punctuation, symbols — always permitted). Whole-word alternation between scripts is fine; a single token mixing two scripts (the Cyrillic-in-Latin homoglyph shape) fails. (Rev 13, walk D1 2026-09-07 — supersedes the self-contradicting "ASCII plus one non-Latin script" wording.) |
| HYG3 | Any text file matches a §8 `CREDENTIAL_PATTERNS` regex (exported from `receipt.ts` as a named API — the single definition), or contains an email address that is not the author's own. Email matcher (rev 13): `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g`, with leading/trailing punctuation (`.` `,` `>` `)` etc.) not consumed by the token boundary; ASCII-only — non-ASCII local parts and Unicode/punycode domains are out of scope **[default — veto cheap]**. Comparison: domain ASCII-lowercased on both sides, local part compared case-sensitively. The exempt value is the text inside `metadata.author`'s angle brackets (`"Name <email>"`, phase-1 §5.4); an author field with no angle brackets exempts nothing. RFC-2606 placeholder domains (`example.com`, `example.org`, `example.net`, `*.invalid`, `*.test`) are also exempt **[default — veto cheap]**. |
| HYG4 | Any file whose path is in `executable` (the caller-supplied mode set — rev 13; the exec-bit clause was unimplementable against a bare `Map<string, Buffer>`), or that opens with `#!` — **both waived under explicit `--allow-privileged` consent, or for content whose repository copy already carries the consented privileged form** (`allowExecutable` input flag; rev 14, walk D5, Ryan 2026-09-07 — hygiene never overrides an informed human's review; `publish` sets it because its content entered through share's consent gate; `validate` never does) — or has an extension outside the allowlist — `.md .txt .json .yaml .yml .csv .toml .xml .html .css .js .ts .py .sh .sql .svg .png .jpg .jpeg .gif .webp .pdf` **[default — veto cheap]** — with `.sh`/`.js`/`.ts`/`.py` allowed as *content* but still failing on exec bit or shebang (executable form is the signal, not the language). Pairs with (does not replace) `share`'s `hasPrivilegedContent` gate for `.claude-plugin/` and hooks. |
| HYG5 | After normalization (trim, case-fold, SPDX identifier compare), frontmatter `license`, `policy.skill_license`, and any bundled `LICENSE*` file's detected identifier are not all equal — any pairwise conflict fails. |
| HYG6 | **error:** `description` is empty/whitespace. **warning (rev 16):** SKILL.md exceeds **20,000 UTF-16 code units** (`String.prototype.length`; ~5k tokens at 4 chars/token — the counting method; a supplementary-plane character counts 2; resolved from [provisional cap] as a veto-cheap default in rev 12). Message states the measured length, the overage, and that size alone does not block. |

## 10. Guard and write path

- New `GuardAction: 'eval'`. New row **g**: path matches
  `^evals/<uuid>/<40-hex>/<run-id>\.json$` (run-id = `YYYYMMDDTHHMMSSZ`) where the UUID
  equals some `skills/*/SKILL.md` `metadata.id` in the **post-image**, and the path does
  **not** exist in the pre-image (receipts are append-only, rev 5) — allowed for action
  `eval` by any member. No
  ownership requirement: anyone may evaluate anyone's skill (evals are testimony, not
  authorship); the receipt records `runner_handle`.
- The mutation validates the receipt against `receiptSchema` before `safeWrite`; the
  guard row stays structural (path shape + id existence) per guard house style.

## 11. CI (publish PRs)

**CI never runs a model and never holds an API key** (rev 10 — walk D2, Ryan
2026-09-06, `.planning/decisions/2026-09-06-workflow-migration-decision-walk.md`,
superseding the rev-6 eval job and its provisional skip policy). Every eval token
spent anywhere is a member's own `claude -p` subscription. The workflow carries two
deterministic jobs:

- **Hygiene** — blocking on error findings, key-free: on PRs touching `skills/**`, `terum-skills
  validate` per changed skill (§9); the HYG6 size warning is printed in the job log and does not fail it.
- **Receipt check [default — veto cheap]** — on `publish/`-prefixed PRs, the §6.1
  publish-PR predicate, verified deterministically (rev 13): a schema-valid
  committed receipt at the skill's exact tree-hash version; an incumbent comparison,
  when present, must be not-FAIL; when absent, CI verifies no prior version exists
  and allows the first publish. Missing, stale, or FAIL-carrying receipt blocks. The
  receipt is produced locally by the publisher; CI validates evidence, it never
  generates it.

## 12. UI contract (Teddy)

The receipt JSON is the API. The UI never runs evals and never derives new statistics.
For a given version the UI renders the **latest** receipt (max `run_id`); older receipts
are history — kept, never displayed side by side or merged.
Card (per the D29 resolution, commit `25ff226`):

| Card slot | Source |
|---|---|
| Verdict chip (PASS/NEUTRAL/FAIL frame) | `verdict` (+ greyed style when `execution_status != "complete"`) |
| Arm scores, side by side | `arm_scores.candidate` vs `.baseline` ("0.82 with · 0.61 without") |
| Trigger counts | `triggers`: "routes {tp}/{tp+fn} · {fp} false fires" |
| Efficiency line | `efficiency.candidate` vs `.baseline`, side by side, same with/without style as arm scores ("$0.38 · 41s with — $0.51 · 53s without"). Cost + duration on the card; turns and incumbent arm one click deeper. (Added rev 2, Ajay 2026-09-04.) |
| Version | first 12 chars of `version` |
| Provenance line (small) | `provenance.model`, `.k`, `.cc_version`, `.timestamp`, `.runner_handle` |
| One click deeper | `attribution` (one-line why), `comparisons` (W/L/T, net lift, sign p), full `efficiency` breakdown, full provenance |

Hard rules: no skill list is ever sorted or ranked by any receipt number; no lift-style
decimal appears at card level; a skill without a receipt shows "—" (phase-1 D22
behavior); numbers from different `model`/`cc_version` never appear in one comparison
surface.

**Permitted display derivations** (rev 17, Ajay 2026-09-08 — an enumeration, not a
relaxation: "the UI never runs evals and never derives new statistics" stands, and
anything not listed here remains forbidden). A display surface may do exactly four
things beyond printing a receipt's fields verbatim, at the receipt's own precision,
with that receipt's provenance beside every number. (a) It may render a receipt's own
`comparisons[*].net_lift` at card altitude, and it may list a version's committed
receipts individually — each receipt's numbers beside its own provenance, opened one
at a time, never two receipts side by side in one figure, never merged into one. For
`net_lift` only this supersedes the "no lift-style decimal at card level" hard rule
above; the latest-receipt-per-version sentence here and in §5.4 (amended together in
this rev) becomes the default view, not an exclusivity rule. (b) It may offer to start
a run by handing the user off to a terminal — composing and displaying the eval
command for the user to run themselves, never spawning an agent in-process (D27's
second branch). (c) It may forecast this machine's cost and duration by arithmetic
over ONE receipt's own per-arm means, labelled as a forecast from that receipt's
pricing-arm runs; the forecast is suppressed entirely — absent, not greyed — whenever
the configured arm model differs from `receipt.provenance.model`, and nothing is
rendered in the no-receipt state. (d) It may tally coverage and verdicts across
skills — for each skill, the newest schema-valid receipt at the skill's current tree,
counted, never averaged — with a provenance stamp on the tally. Every other hard rule
stands: no skill list is ever sorted or ranked by any receipt number, no numbers from
different `model`/`cc_version` in one comparison surface, and no statistic beyond (c)
and (d) is ever derived.

## 13. Verification tasks (before/during ME1–ME4)

- **VE1 (CLOSED 2026-09-04, CC 2.1.236):** measured live via a determinism probe
  (`.planning/research/2026-09-04-eval-determinism-probe.md`). Confirmed:
  `--setting-sources project` + `CLAUDE_PROJECT_DIR` excludes `~/.claude/skills`, the
  init event exposes the resolved skill list, and that list **always includes the
  CLI's 16 built-in skills** — which is why §7.3 asserts membership, not equality
  (rev 6).
- **VE2 (new):** confirm `stream-json` result events carry `num_turns`, duration, and
  cost fields on current CC; record actual field names for `efficiency`.
- **VE3 (new):** guard row g adversarial suite: non-UUID dir, 39/41-char hash, receipt
  for a nonexistent id, receipt write under action `share`, path traversal inside
  `evals/`, malformed run-id filename, overwrite of an existing receipt path.
- **VE4 (new):** redaction: plant `ghp_` + a PEM block + a `/`-bearing secret-like value passed through `secrets` in a judge reason; assert
  the committed receipt carries none.
- **VE5 (new):** stats property tests: `sign_test(0,0)=1`, symmetry, known values
  (5W/1L → 0.219); net-lift tie handling.
- **VE6 (new):** incumbent materialization via `git archive` matches
  `git show HEAD:skills/<n>/…` file-for-file, including `references/`.
- **VE7 (new):** preflight fails fast (and clearly) with `claude` missing, logged out,
  and with a usage-policy refusal.
- **VE8 (new):** an older-CLI config round-trips a receipt-bearing config untouched
  (passthrough contract).

## 14. Build order

- **ME1 — pure core.** `stats.ts`, `checks.ts`, `receipt.ts` (+ schema), `hygiene.ts`,
  guard row g + action. No subprocess anywhere. *Exit:* unit suites green (`stats`,
  `checks`, `receipt schema`, `hygiene`, `guard row g` incl. VE3–VE5).
- **ME2 — agent + triggers.** `agent.ts` (runAgent/askJson/Transcript), preflight,
  `triggers.ts`. *Exit:* VE1/VE2/VE7 closed; a real trigger run against a real team
  clone on one laptop, run tree written.
- **ME3 — execution.** `execution.ts`, `judge.ts`, `results.ts`, arm scores,
  efficiency capture. *Exit:* a two-arm run on a real shared skill reproduces the §5c
  probe result shape; VE6 closed.
- **ME4 — product surface.** `commands/eval.ts`, `--commit` receipts through
  `safeWrite`, CI job, UI contract frozen (§12 published to Teddy). The orchestrator
  owns the library's open ends (rev 11): it derives `expected_rows` from the FULL
  case list — skipped cases included, so environment skips actually grey the verdict
  — plumbs `runCase().skipped` into `environment_skips`, populates
  `arm_skill_lists`, wires the seeded RNG (seed 0) into `deps.rng`, and materializes
  the incumbent tree (last receipted version, else `origin/main`'s prior state) —
  none of which the library does on its own.
  *Exit:* one publish PR on a real team repo carrying a green receipt end-to-end.
- **ME5 (deferred) — `eval-gen`**: model-authored cases/triggers with the four-bucket
  taxonomy, `# generated — review before trusting` header, check-kind whitelist.
  Superseded by `.planning/specs/2026-09-07-eval-gen.md`.

## 15. Acceptance

A member shares a skill; hygiene passes by construction. They author two cases and a
trigger file in the skill folder, run `terum-skills eval deploy-preflight`, read
"PASS — +44% net lift (5W/1L/3T), routes 6/6 · 0 false fires, 0.82 with · 0.61
without", and re-run with `--commit`; the receipt lands as one commit touching exactly
`evals/<id>/<hash>/<run-id>.json`; a later re-run lands a second file beside it. A publish PR for a regression shows candidate-vs-incumbent
FAIL and blocks. Teddy's UI renders the card from the receipt alone, offline.

Adversarial cases per suite: **guard-eval** (VE3 list), **redaction** (VE4),
**contamination** (a skill planted in the runner's own `~/.claude/skills` must not
appear in any arm; arm_skill_lists mismatch refuses the run), **partial** (kill an arm
mid-matrix; verdict greys, holes labeled, nothing averaged), **judge** (unparseable
verdict → retry → escalate → tie, refusal → tie with `judge-refused`), **incumbent**
(new skill: no incumbent comparison, receipt says so; unchanged skill: incumbent arm
skipped), **triggers** (errored selection call counts in neither tn nor fp),
**working-tree** (`--working --commit` refused).

## 16. Defaults chosen here (veto cheap)

1. Engine is a TypeScript port living in `src/lib/evals/`; skilldeck becomes reference
   only. (Checked against Terum: consistent with the recorded engine decision.)
2. Eval assets live inside `skills/<name>/evals/` and version with the tree hash;
   dataset digest = version, no separate digest field.
3. Receipts keyed `evals/<uuid>/<40-hex-tree-hash>/<run-id>.json`, one immutable file
   per committed run, append-only (rev 5); surfaces display the latest per version,
   older receipts stay in the tree.
4. Arm score = mean over (case × rep) of fraction-of-checks-passed; judge-only cases
   excluded; `null` when no checks exist. This is the D29 "arm scores" number.
5. Verdict bands on candidate-vs-baseline net lift: PASS ≥ +1/3, FAIL ≤ −1/3, else
   NEUTRAL **[provisional — the dead-zone width needs team-scale data]**.
6. At k=3 the band alone gates; sign p is reported but never gates below k=10.
   Measured caveat (2026-09-04 probe): two identical k=3 runs flipped PASS↔NEUTRAL
   with a net lift sitting on the +1/3 boundary — band-edge verdicts at k=3 are one
   wobbly rep from flipping. Append-only receipts (rev 5) are the designed answer:
   re-runs accumulate rather than overwrite.
7. Regression gate for publish is candidate-vs-**incumbent** not-FAIL; baseline
   comparison is informational at PR time.
8. Superseded (rev 10): CI runs no evals of any kind — trigger or execution; the
   deterministic receipt check is the only publish gate.
9. Default model `sonnet` for arms and judge; escalation judge `opus`
   **[provisional]**. Only same-model, same-cc-version numbers ever share a surface.
10. Anyone may evaluate any skill (`eval` guard row has no ownership check);
    `runner_handle` records who.
11. Incumbent arm materializes the full prior tree via `git archive` (not a SKILL.md
    swap).
12. Contamination handled by construction (`--setting-sources project`) + recorded
    arm skill lists + hard refusal on mismatch; no synthetic-HOME isolation (breaks
    subscription OAuth on macOS — measured).
13. `--working` evaluates authored sources but can never `--commit`.
14. Redaction applies at the sharing boundary only; local run trees stay raw.
15. Skill staging into arms excludes `evals/` and `fixtures/`. (Whether the phase-1
    Placer should also exclude `evals/` from placements is flagged to Ryan as a
    phase-1 question, not decided here.)
16. *(Removed rev 4 — the verified badge tier is scrapped entirely: no badge, no
    `publish --verified`, no team.json marking, no nightly verified refresh. Ajay,
    2026-09-04.)*
17. D30 (rasterizer library) stays OPEN; `@resvg/resvg-js` is the researched
    recommendation to confirm at ME4+.

## 17. Code-vs-spec divergence register (rev 11 — 2026-09-06 audit of the built library)

A section-by-section comparison of this spec against the shipped `src/lib/evals/`
modules (two independent read-only agents, spot-verified). The library matches the
spec on every load-bearing semantic: §7.1 decide ordering, §7.3 contamination
membership, the rev-7 fresh-sandbox retry, §7.5 double-ask/judge-split/escalation/
refusal, the headless note, `model_id` capture, all six §5.1 check kinds, the §16.5
sign test and verdict bands (0.219 VE5 value reproduces), arm-score aggregation,
every §5.3 receipt field including `environment_skips`, and the §8 redaction list
(`redact`/`buildReceipt` retain the optional `secrets` parameter with no configured
source — a hook for caller-held values, not a defect; do not re-open it).
The divergences below are **code defects or gaps — the spec stays normative**; fix
them in the IE milestones rather than blessing them:

1. **Malformed regex check arg crashes the run** — `checks.ts` builds
   `new RegExp(arg)` unguarded for `command_matching`/`no_command_matching`, so a
   case authored with a bad pattern throws out of `runChecks` and aborts the whole
   case, violating §5.1's fail-never-error rule (unknown kinds and malformed specs
   are guarded; regex args are not). Fix: wrap per-check execution, fail the check.
2. **Trigger scoring is asymmetric on errored calls** — an errored selection call on
   a should-trigger prompt counts as a routing miss (`fired !== true` → fn), while
   errored near-misses count in neither fp nor tn (§7.2's intent is symmetric
   exemption). Fix: exclude errored rows from fn as well, or retry once like arms.
3. **The retry clobbers the failed attempt's transcript** — both attempts write the
   same transcript path, so the flake recorded as `retried` leaves no inspectable
   artifact (contradicts §4.2's post-hoc-inspection promise). Fix: suffix the failed
   attempt's transcript.
4. **Judge network failures mislabel as `judge-unparseable`** — infra errors share
   the 3-attempt parse-escalation budget with no retry-with-backoff (§7.5 treats
   them separately); the receipt cannot distinguish flake from unparseable model.
5. **The judge's A/B ordering (`swapped`) is not recorded in the row** — §7.5 says
   "recorded in the row"; `decide()` discards it and `ComparisonRow` has no field.
6. **A non-A/B judge winner value becomes a `judge`-decided tie** — a malformed
   `winner` (e.g. `"C"`) should take the §7.5 escalation path, not silently tie
   with `decided_by: 'judge'`.
7. **Contamination check silently skipped when the init event lacks `skills`** —
   `skillList()` null disables the §7.3 assert and the run proceeds ungreyed with
   `arm_skill_lists: null`. Fix: treat a null list on a staged arm as a preflight
   failure (or grey the receipt).
8. **A crashed agent with partial stdout is scored as a real arm** — nonzero exit
   with non-empty stream-json parses and scores instead of raising `AgentRunError`,
   so it never triggers the §7.1 retry.
9. **A failing `setup` hook aborts the whole run, not the case** — the rejection
   escapes `runCase` uncaught, contradicting §5.1's "nonzero rc aborts the case"
   (and the code's own doc comment).

Hardening notes (spec-silent behavior to revisit at ME4, not defects): `askJson`
(judge + trigger calls) runs in the invoking process's cwd with
`--setting-sources project`, so a `.claude/` in the runner's cwd is in scope for
those calls — pin their cwd at ME4; sandboxes are anonymous `arm-*` temp dirs with
no case/arm/rep mapping, and orphaned sandboxes accumulate on retry; `transcriptName()`
is dead code disagreeing with the live path; a non-`AgentRunError` exception in the
trigger sweep discards all prior rows.
