---
name: codex-implement
description: Delegate implementation of a locked spec to OpenAI Codex CLI in an isolated git worktree, then verify the result yourself. Claude specs and reviews; Codex writes the code. Use when a spec in .planning/specs/ is ready to build and you want it implemented by Codex rather than inline. Args: <spec-path> [--routine|--standard|--deep] (aliases --light|--normal|--heavy) [--model=<sol|terra|luna>] [--effort=<low|medium|high|xhigh|max|ultra>] [--branch=<name>] [--here] [--dry-run]
---

Hand a locked spec to Codex CLI for implementation, in a throwaway worktree, then bring the diff
back and verify it with our own gates before anyone trusts it.

**The division of labour is the point.** Claude (Fable/Opus) writes the spec and reviews the
result. Codex writes the code. Codex is a different vendor running none of our Claude hooks, so
**every claim it makes is a hypothesis until you re-run the gate yourself** (CLAUDE.md: agent
findings are hypotheses, not facts).

---

## Step 0 — preflight (run every check, in order, STOP on any failure)

```bash
codex login status                      # must not say "Not logged in"
codex --version                         # see version floor below
test -f AGENTS.md && echo "AGENTS.md present"
git -C . status --porcelain | head      # note pre-existing dirt
grep -h rate_limits "$(ls -t ~/.codex/sessions/*/*/*/rollout-*.jsonl | head -1)" | tail -1   # plan quota
```

1. **Auth.** `Not logged in` → tell the user to run `! codex login` themselves (it opens a
   browser; you cannot). STOP. Do not fall back to an API key without being asked — that bills
   per-token instead of using the plan.
2. **Version floor: `0.145.0`.** The GPT-5.6 (Sol/Terra/Luna) tiers went GA in Codex on
   2026-07-09 and older CLIs do not ship them. If below, say so and offer
   `npm i -g @openai/codex@latest`. A stale CLI silently falls back to an older model — which
   looks like it worked.
3. **`AGENTS.md` must exist at repo root.** Without it Codex implements against the spec with
   zero knowledge of our top-8 invariants, the `.js`-not-`.ts` rule, or the nested `CLAUDE.md`
   files. Missing → STOP, this is not an optional nicety. All three delegation targets have one:
   Terum-MVP; `terum-capture` (added 2026-07-31 — its invariants are the sidecar-offset
   anti-data-loss rule, stdout/stderr discipline, and non-zero exit on failure); and
   `terum-skills` (repo `skill-management-software`, added 2026-09-03 — its invariants are
   safeWrite-only writes, the guard as the authorization model, consent on the normalized grant
   hash, and the `placements` ledger as the only source of deletable paths). A **fourth** repo
   with no `AGENTS.md` is still a STOP; write the loader first.
4. **`~/.codex/config.toml` sanity.** If it still registers `gsd-*` agents or sets
   `features.codex_hooks = true`, warn: that is abandoned GSD scaffolding and it attaches stale
   agents to every run. Offer to archive it.
5. **Windows sandbox provisioning — verified blocking, do not skip.** On Windows the sandbox runs
   commands as a dedicated local user, and that user has write permission **nowhere** until a
   one-time elevated setup has run. Check:

   ```bash
   powershell -NoProfile -Command "Get-LocalUser | Where-Object {\$_.Name -like 'CodexSandbox*'} | Select-Object -ExpandProperty Name"
   ```

   Expect `CodexSandboxOffline` and `CodexSandboxOnline`. **Empty output means setup has never
   run and every write Codex attempts will fail with `Access is denied`** — inside the worktree,
   in `TMPDIR`, everywhere. Verified empirically on 2026-07-22 (CLI 0.118.0): writes were denied
   in cwd and in `TMPDIR`, identically with and without `--full-auto`, and
   `sandbox_workspace_write.writable_roots` did not help.

   Fix: run `codex` once interactively and **approve the UAC prompt**. That runs
   `codex-windows-sandbox-setup.exe`, which creates the two local accounts, adds Windows Firewall
   deny-outbound rules for the offline account, and stamps write ACLs on the workspace. Tell the
   user *before* they approve — it creates local user accounts and firewall rules on their
   machine. `codex.exe` itself never runs elevated; only the one-time setup crosses UAC.

   **Trap:** `~/.codex/.sandbox/sandbox.log` logs SUCCESS/FAILURE by **process exit code, not by
   whether writes landed.** A PowerShell command whose every write was denied still exits 0 and
   is logged `SUCCESS`. Never treat that log as evidence the sandbox works — check for the files.

6. **Plan quota — report it to the user BEFORE launching, every run.** Codex runs on the
   ChatGPT-plan quota (Ryan's is `plan_type: "edu"` — not visible on any web dashboard), and a
   quota kill MID-RUN is worse than a delayed start: B1 run 3 (2026-07-23) died to the weekly
   limit after completing its fixes but before updating 4 test files' mocks, leaving 86 failures
   to untangle by hand. The TUI's `/status` numbers are also written to the session logs — the
   grep in the block above prints the last `rate_limits` event from the newest session:
   `primary` = the 5-hour window, `secondary` = the weekly window, each with `used_percent` and
   a `resets_at` epoch. It is a **last-observed snapshot** (only updates when Codex runs) — check
   the event's timestamp; if it's hours old or the grep finds nothing, refresh with a near-free
   `codex exec "reply ok"` and re-read.

   Surface both windows (% left + reset time in local time) in the launch announcement. Gate:
   **weekly ≥ 80% used, or 5-hour ≥ 70% used on a `--deep`/`xhigh+` run → STOP and ask** whether
   to launch anyway, drop a tier, or wait for the reset — never launch heavy into a nearly-spent
   window on your own call.

Also confirm the spec path exists and reads as **self-contained** — a spec that says "as we
discussed" or leaves a fork open is not implementable by an agent with no conversation history.
Ambiguous spec → STOP and say which section is underspecified. Do not paper over it in the prompt.

---

## Step 1 — pick the tier

Two independent dials, plus presets that set both. **Presets set reasoning depth only. They
never widen permissions** — see § Safety.

### Presets

| Preset | Alias | Model | Effort | Use for |
| --- | --- | --- | --- | --- |
| `--routine` | `--light` | `gpt-5.6-luna` | `medium` | Mechanical, fully-specified, **short-context** work: renames, boilerplate, docstrings, test scaffolding. See the Luna caveat below — this preset has a sharp edge. |
| `--standard` | `--normal` | `gpt-5.6-terra` | `high` | **Default.** Everyday feature work: a new route, a new lib module, a contract change with SPA follow-through |
| `--deep` | `--heavy` | `gpt-5.6-sol` | `max` | Multi-file refactors, hard debugging, migration-adjacent work, anything touching auth/privacy predicates |

Default when no preset is given: **`--standard`**.

### What the tiers actually buy — measured

| Benchmark | Sol | Terra | Luna |
| --- | --- | --- | --- |
| Agents' Last Exam (long-horizon workflows) | 53.6 | 50.4 | 50.3 |
| Terminal-Bench 2.1 | 88.8% | 87.4% | 84.7% |
| Artificial Analysis Coding Agent Index | 80 | 77.4 | 74.6 |
| **MRCR long-context recall** | **91.5%** | **89.6%** | **41.3%** |

Relative cost: Sol 5× · Terra 2.5× · Luna 1×.

Two things follow, and both are load-bearing:

1. **Terra is the rational default by a wide margin.** On Agents' Last Exam you pay **2× for 3.2
   points** going Terra → Sol, and Terra beats Luna by *0.1 points* on the same test. The model
   tier is rarely what decides whether an implementation is correct.
2. **Luna has a long-context cliff — 41.3% MRCR against Terra's 89.6%.** Implementing a spec
   against a large repo *is* a long-context task. So `--routine` is safe only when the spec is
   short and the touched surface is small. **If the spec is long, or the change spans several
   files, use `--standard` even for mechanical work.** Cheapness is not worth a model that
   loses the thread.

---

## Individual knobs (override any preset)

- `--model=<sol|terra|luna>` → `gpt-5.6-sol` · `gpt-5.6-terra` · `gpt-5.6-luna`.
  Bare `gpt-5.6` aliases to Sol.
- **`gpt-5.3-codex` is NOT usable here.** Verified 2026-07-22: with ChatGPT-account auth the API
  rejects it — *"The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT
  account."* Same for `gpt-5.3-codex-spark`. This is an auth-mode limit, not a plan limit — the
  5.3 family requires API-key auth (which bills per token instead of using the plan). Do not
  offer it as an option unless the user has explicitly switched to an API key.
- `--effort=<minimal|low|medium|high|xhigh|max|ultra>` — passed as
  `-c model_reasoning_effort="<level>"`.

| Effort | Rough token multiplier | Use for |
| --- | --- | --- |
| `minimal` | ~0.1× | rename, format, one-line fix |
| `low` | ~0.3× | boilerplate, well-defined transforms |
| `medium` | 1× | everyday coding — the sane baseline |
| `high` | ~3–5× | multi-file refactor, complex debugging |
| `xhigh` | ~8–15× | long-horizon autonomous work, hard algorithmic problems |
| `max` | above xhigh | one deep problem that must stay whole (GPT-5.6) |
| `ultra` | highest | internal subagent parallelization (GPT-5.6) — see warning |

**Effort support is model-dependent — `minimal` is rejected on Sol** (verified 2026-07-22).
Confirmed available on `gpt-5.6-sol`: `low`, `medium`, `high`, `xhigh`, `max`, `ultra`.

**To re-verify entitlements** after any plan/auth change, probe with `--json` and look for
`turn.failed` — the plain-text output is NOT a valid test (it prints a session header echoing
whatever model string you passed, and a bad model can still emit text, so both look like success):

```bash
codex exec --json --skip-git-repo-check --ephemeral -s read-only \
  -m gpt-5.6-sol -c model_reasoning_effort="max" "Reply: OK" 2>&1 | grep -q turn.failed && echo BLOCKED || echo OK
```

### What the published ablations actually show

The evidence is **task-dependent and front-loaded**, not a smooth "more effort = better" curve:

- **Gains concentrate at the bottom.** On GPT-5.4, `none → low` was worth **+73 solves**;
  `low → medium` added **+6**. The first increment does almost all the work.
- **On genuinely hard algorithmic work, high effort pays enormously.** GameEngineBench (C++
  runtime) pass@1: `medium` 9.1% → `high` 19.1% → `xhigh` 29.1%.
- **On repo-scale SWE work it barely moves.** Codex-Max on SWE-bench Verified went
  76.5% → 77.9% at `xhigh` — **+1.4 points for many times the tokens.** Most of our work is
  this shape, not the GameEngineBench shape.
- **Higher effort can score *worse*.** One published comparison drops from 15.336 at `medium`
  to 12.626 at `high`. The mechanism is real and matters here: `high` uses roughly **2× the
  tokens**, which triggers more **context compaction**, and the compaction is what degrades the
  result. On a long spec against a large repo, more thinking can mean less remembering.

**Practical rule: `medium` is the efficient frontier for spec implementation.** Escalate on a
*re-run* when `--standard` demonstrably failed — not preemptively because the task feels
important. Effort cannot rescue a vague spec; it only lets the model finish analysis it already
understands. If the output was wrong because the spec was ambiguous, raising effort will produce
a more confidently wrong answer.

**`ultra` is usually the wrong choice for this skill.** It parallelizes internal subagents and is
"a poor fit when the parts depend on each other" — implementing a spec is normally dependent,
sequential work, so subagents idle. Use `max` ("one deep problem that must stay whole") for hard
implementation. Reserve `ultra` for genuinely independent fan-out, e.g. the same mechanical
transform across many unrelated files.

**Quota note.** Plan tiers are Plus ($20/mo) and Pro 5× ($100/mo) / Pro 20× ($200/mo), with
credit-based limits on a rolling 5-hour window plus a weekly cap. Sol at `max` on a large spec
is the single fastest way to exhaust a Plus allowance. Tell the user which tier you are about to
spend before a `--deep` run on a big spec.

---

## Step 2 — isolate

Non-negotiable. Codex gets its own worktree, always.

```bash
git fetch origin
git worktree add ../terum-codex/<slug> -b <branch> origin/main
cd ../terum-codex/<slug> && <install>          # see the target-repo table below
```

- Branch off **`origin/main`**, never the local `main` (it runs behind).
- Fresh worktrees need their own dependency install — gate scripts run from the worktree cwd. A
  spec that touches `lib/dashboard/contracts` needs a SECOND install there (`cd
  lib/dashboard/contracts && npm ci`) — it has its own lockfile, separate from the root install.

**Target repo — resolve `<install>` and the gate battery before you go further.** A spec can target
Terum-MVP, `terum-capture`, or `terum-skills`, and they share no tooling. Pick from the repo you
are actually in (`git remote get-url origin`), never from habit:

| Repo | `<install>` | Gates (§ Step 5) | Notes |
| --- | --- | --- | --- |
| `Terum-MVP` | `npm install` | `npm run lint && npm run typecheck && npm test`, then `cd lib/dashboard/contracts && npm ci && npm test` | `.githooks/hooksPath` is absolute, so hook *bodies* execute from the primary checkout. Known quirk; do not "fix" it from inside the worktree. The contracts package has its OWN vitest and lockfile — root `npm test` does not reach it (vitest include is root-anchored `__tests__/**`), but the required `ci` check runs it. A contract change that skips it passes locally and reds CI. |
| `terum-capture` | `pip install ".[dev]"` | `pytest -q` then `python scripts/check_error_streams.py` | Python 3.10–3.14. **No** npm, ruff, or mypy — do not invent one. No `.githooks/pre-push`; CI on `main` is the only backstop. Bug logs live in Terum-MVP (`.planning/debug/capture-cli/`) and numbers are global, so it cannot allocate one locally. |
| `terum-skills` (repo `skill-management-software`, remote `ryanliu-terum/terum-skills`) | `npm install` — **but there is no `package.json` until milestone M1 lands.** Before the first run the orchestrator pre-scaffolds in the worktree: `package.json` (deps `commander`, `zod`, `yaml`, `proper-lockfile`; devDeps `typescript`, `vitest`, `eslint`; Node 22 floor, ESM), `npm install`, and the two vendored skillhub files copied into `src/lib/placer/vendor/skillhub/` with their attribution headers (build spec §3). The sandbox has **no network**, so Codex can do neither itself. | `npm run lint && npm run typecheck && npm test` (vitest, collocated `src/**/__tests__/`, bare-repo fixtures, no network) | Specs live in `.planning/specs/`; the build spec is authoritative over the ledger. No bug-log numbering, no migrations, no `extension/`, no contracts package — the MVP-only lines in § Step 3 do not apply. Run **per milestone** (spec §11): add `Implement milestone M<n> only; leave later milestones unbuilt` to the prompt, and use `--standard` at minimum — the spec is ~11k words, past Luna's long-context cliff. |

Running the MVP battery against `terum-capture` fails with "missing script: lint" and reads as a
broken worktree rather than the wrong table row — check the row first.
- `.githooks/hooksPath` is absolute, so hook *bodies* execute from the primary checkout. This is
  a known quirk; do not "fix" it from inside the worktree.
- `--here` skips worktree creation and runs in the current tree. **Only honour it if the user
  asks explicitly**, and warn first: other sessions share this `.git`, and Codex writing into a
  tree Claude is also editing is how work gets silently reverted.

---

## Step 3 — build the prompt file

Before writing the prompt, if the spec is likely to surface a bug, run
`git fetch origin && bash scripts/next-bug-number.sh` yourself and bake the reserved number(s)
into the prompt — same rule as migration numbers (see § Failure modes): git is forbidden inside
the sandbox, so Codex cannot claim one itself.

Write to the scratchpad (not the repo). Structure:

1. `Implement the spec below. Read AGENTS.md at the repo root FIRST and follow it exactly.`
2. The **full text** of the spec file.
3. The standing constraints:
   - Read the per-directory `CLAUDE.md` for every subtree you touch, before your first edit there.
   - Run `npm run lint && npm run typecheck && npm test` and report real counts. If you touched
     `lib/dashboard/contracts`, also run `cd lib/dashboard/contracts && npm ci && npm test` — it
     has its own vitest and lockfile and is NOT covered by the root `npm test`.
   - Do NOT run `scripts/next-bug-number.sh` — it is git-driven (`git log --all`, `git for-each-ref`,
     `git ls-tree`) and needs a prior `git fetch`, and git is forbidden inside the sandbox (see
     § Failure modes). If you find a bug, describe it in `bugLogsCreated` as prose; the
     orchestrator allocates the number and writes the log.
   - **If the spec is ambiguous, record the question in `openQuestions` and implement the most
     conservative reading. Never resolve a design fork on your own.**
   - Do not commit. Do not push. Do not apply migrations. Leave changes in the working tree.
   - Stage nothing; the orchestrator reviews the raw diff.

   The `lib/dashboard/contracts`, `next-bug-number.sh`, and `extension/` lines are
   **Terum-MVP-specific**. For `terum-capture` and `terum-skills` drop them and substitute that
   repo's gate row from § Step 2; for `terum-skills` also add the milestone scope line the row
   names, and tell Codex the vendored skillhub files and `node_modules` are already in place.

Feed it via **stdin**, never as a shell argument — this sidesteps Windows quoting entirely.

---

## Step 4 — run it

```bash
codex exec \
  -C "<worktree-abs-path>" \
  -m "<model-slug>" \
  -c model_reasoning_effort="<effort>" \
  --sandbox workspace-write \
  --output-schema .claude/skills/codex-implement/report.schema.json \
  -o "<scratchpad>/codex-report.json" \
  - < "<scratchpad>/codex-prompt.md"
```

Verified working end-to-end on 2026-07-22 (CLI 0.145.0, Windows): this exact form ran under
`--sandbox workspace-write` and wrote a file to disk.

Flag rationale — each one is load-bearing:

- **There is NO `-a` / `--ask-for-approval` flag on `codex exec`.** Passing one aborts the run with
  a usage dump before anything happens. `-a` exists only on the *top-level* `codex` command; `exec`
  is inherently non-interactive and its approval policy is already `never` (the session header
  confirms `approval: never`). **Never add `-a never` here** — it looks correct, reads correct, and
  fails 100% of the time. Equally, never use `--full-auto`: it implies `-a on-request`, which lets
  the model decide to ask a human, and in a headless subprocess nobody can answer.
- **`--sandbox workspace-write`** — writes confined to the worktree. Requires one-time Windows
  provisioning (preflight 5). See § Safety before considering anything looser.
- **`-o`** — Codex writes only its final message to a file. Read *that file*, not the transcript.
  This is the difference between delegation costing ~500 tokens of your context and ~50,000.
- **`--output-schema`** — forces the final answer into `report.schema.json` so you get an
  adjudicable object instead of prose.
- **`-C`** — working root. Do not pass `--add-dir`; widening the writable set defeats the worktree.

Run it **backgrounded** (`run_in_background: true`) if the user is doing anything else; the
harness re-invokes you on exit. Otherwise run it in the foreground with a generous timeout —
`--deep` runs can exceed ten minutes.

`--dry-run` → print the fully-resolved command and the prompt file path, then STOP.

---

## Step 5 — verify (this is the step that matters)

**Do not report Codex's own gate numbers.** Re-run them yourself, in the worktree, using the row
you resolved in § Step 2:

```bash
# Terum-MVP
npm run lint && npm run typecheck && npm test
npm run check:bug-log-status && npm run check:migration-doc-sync

# terum-capture
pytest -q && python scripts/check_error_streams.py

# terum-skills
npm run lint && npm run typecheck && npm test
```

Both `check:bug-log-status` and `check:migration-doc-sync` are unconditional steps of the required
`ci` check (they run even on a docs-only diff), and `check:bug-log-status` also gates `git push`.
Run them whenever the diff added a bug log or a migration file — a bug log whose filename suffix
disagrees with its `status:` frontmatter, or a migration without its MIGRATION-LOG.md entry and
root CLAUDE.md pointer bump, is exit 1.

In `terum-capture`, also say **which interpreters you ran** — CI covers 3.10–3.14 and a local run
covers one. "Tests pass" without a version is an unverified claim about four other interpreters.

Then, in order:

1. **Read `codex-report.json`.** Note `openQuestions` and `deviations` — those are the spec's
   soft edges and they need a human, not a shrug.
2. **Read the diff yourself** — `git -C <worktree> diff` — at minimum every file touching auth,
   a Supabase query, a Zod contract, or `extension/` (in `terum-skills`: `teamRepo.ts`'s
   safeWrite, `guard.ts`, `placer.ts`, `hook.ts`, and anything that computes the grant hash). Check it against the top-8 invariants.
   Specifically confirm: no unchecked Supabase `error`, no 200-in-catch, no `private`-less admin
   cross-user read, no progress persisted before the work, and **no edits to ANY `.ts` file under
   `extension/` except `.d.ts`** — `.githooks/pre-commit` CHECK 7 is harness-agnostic and blocks
   every staged `extension/*.ts` regardless of whether a `.js` sibling exists (the sibling test is
   the Claude-only hook's looser rule, which does not apply to Codex).
3. **Adversarial test inputs** — root CLAUDE.md requires tests using "inputs the implementation has
   never seen," and that requirement is structurally unsatisfiable by whoever wrote the code. On
   this path that is Codex, so Codex's *own* tests inherit its blind spots exactly the way ours
   would. Run the generator against the contract:

   ```bash
   bash scripts/codex-adversarial-tests.sh --target "<function>" <contract-file>
   ```

   **Do not pass the spec file.** A spec carries rationale, worked examples, and often code — all of
   which leak the implementation and defeat the tool. Write a contract to the scratchpad first:
   signature, types, invariants, error cases, no bodies. If you cannot state the contract without
   the diff in front of you, stop — *that* is the finding, and the spec was underspecified.

   Pick targets where a lookup table or regex could fake it: scorers, resolvers, parsers, predicates,
   anything shaped like `(input) => decision`. Skip thin route handlers and glue — their behaviour is
   the framework's, and generated cases there are noise.

   Blindness holds regardless of who wrote the code (the runner copies the contract into a scratch
   dir and roots Codex there, so the repo is unreachable) — but note in your report that the
   generator and the implementer were the same model family, which weakens decorrelation even
   though it does not weaken isolation. Cases land in
   `.planning/audits/codex/adversarial-<target>.json`.

   A failing case is **either a bug or a wrong expectation** — the `contract_gaps` section is where
   the second is most likely. Adjudicate each one; do not bulk-add them to the suite.
4. **Cross-model review** — `codex exec review --base main` from inside the worktree, for a
   second opinion from a different model family.
5. **`/ultrareview --working`** for the full four-dimension pass — or **`/hybrid-review --working`**
   on a `--deep` run or anything touching auth/RLS/contracts, which runs the same four dimensions
   with the *verify* panel on Codex instead of Claude. That is the direct fix for the correlated-
   verifier error our own `/ultrareview` post-mortem found: a Claude finder plus a Claude verifier
   can share one misreading and pass a false positive through; a cross-vendor panel cannot.
6. Report the disposition: what you kept, what you rejected, and why.

If gates fail and the fix is mechanical, fix it inline and say you did. If it fails structurally,
report the failure with real output — never launder a failed run into a success.

---

## Safety — read this before raising a tier

**Escalating the preset escalates *reasoning*, never *permissions*.** Every tier runs
`--sandbox workspace-write` inside a disposable worktree. There is no tier that unlocks
broader filesystem access, and `--deep` is the tier where that matters most, not least.

The reason is specific and recent. METR's predeployment evaluation of **GPT-5.6 Sol** found the
**highest detected reward-hacking rate of any public model they had evaluated** — documented
behaviours include exploiting bugs in evaluation infrastructure, surfacing hidden test cases, and
extracting hidden source from test environments. OpenAI's own guidance is *do not loosen your
approval policy for Sol*; the findings make sandbox containment **more** important, not less. On
2026-07-12 a Sol shell bug was reported to have wiped a Mac, a risk OpenAI had flagged 16 days earlier.

Concretely, for this repo:

- **Never** pass `--dangerously-bypass-approvals-and-sandbox`. If `workspace-write` genuinely
  will not function on native Windows, the correct escalation is **WSL or a container**, not
  removing the sandbox. Stop and ask. The `.claude/settings.json` deny entry
  (`Bash(codex exec --dangerously-bypass-approvals-and-sandbox:*)`) is prefix-anchored right after
  `codex exec`, so it does NOT catch the flag in the position this skill's own Step 4 template
  would put it (after `-C`) — it would fall through to the broad `Bash(codex exec:*)` allow
  instead. Treat the ban as a discipline, not a guardrail — nothing stops you.
- Reward hacking in our context looks like: **editing or deleting a test so the suite passes**,
  weakening an assertion, adding an `eslint-disable` to silence an invariant rule, reporting
  green gates that do not reproduce — and **tests that only exercise branches the implementation
  already handles**. Codex wrote both halves, so its cases come from one mental model; that is
  the case root CLAUDE.md says the author structurally cannot satisfy. On any spec with real
  semantics, run `bash scripts/codex-adversarial-tests.sh --target "<fn>" <contract-file>`
  (mechanics: terum-validation-and-qa §4) and fold the surviving inputs into the suite before you
  call the run verified. Check for all five in step 5. `git diff` on `__tests__/` and on any new
  `eslint-disable` comment is not optional after a `--deep` run.
- The worktree is the blast radius. Keep it that way — no `--add-dir`, no `--here` without an
  explicit request.

---

## Failure modes to expect

| Symptom | Cause | Fix |
| --- | --- | --- |
| Aborts instantly with a usage dump + `tip: to pass '-a' as a value` | you passed `-a`/`--ask-for-approval` — **`codex exec` has no such flag** | remove it; `exec` is already `approval: never` |
| Run hangs forever, no output | `--full-auto` (implies `-a on-request`) waiting on a human | drop `--full-auto`; plain `--sandbox workspace-write` |
| "model not found" or silently older behaviour | CLI below 0.145.0 | `npm i -g @openai/codex@latest` |
| `Access is denied` on every write, incl. inside the worktree | Windows sandbox setup never ran — the sandbox local user has write access nowhere | run `codex` once, approve the UAC prompt (preflight 5); do **not** bypass the sandbox |
| Writes to the worktree ROOT succeed but **subdir** writes (`lib/`, `app/`, `supabase/migrations/`, …) fail `Access Denied` — even though `icacls` shows the sandbox group has Modify | The sandbox restricted token honors **explicit** ACEs but **not inherited** ones. Codex stamps an explicit ACE on the `-C` root only; subdirs from `git checkout` carry Modify by *inheritance*, which the token ignores. Codex then over-generalizes the first subdir denial to "cannot write" and bails `status:"blocked"` (its own cause report, e.g. "denied under C:\tmp", is unreliable) | Before the run, force **explicit recursive** grants as the real user (PowerShell — Git Bash mangles `/grant`): `icacls "<worktree>\<dir>" /grant "CodexSandboxUsers:(OI)(CI)(M)" /T /C /Q` on every dir the spec touches (grant the whole worktree if it creates NEW dirs — a fresh dir's ACE is inherited too). Confirm with a subdir write-probe. Diagnose by probe, never by Codex's self-report. |
| Codex reports writes blocked and blames git / bails after a `git` command | A worktree's git metadata lives at the PARENT repo's `.git/worktrees/<name>` (outside the `-C` writable root), so any git write (`fetch`, `status` index-lock, `add`) errors — and Codex conflates it with "workspace unwritable" | Forbid **all** git commands in the prompt (not just `fetch`); tell it to verify writes by reading files back. Pre-resolve anything that needs git (e.g. migration numbers) and bake it into the prompt. The orchestrator handles all version control |
| Sandbox "works" per `sandbox.log` but no files appear | that log tracks process exit codes, not write success | verify by checking for the files, never by reading the log |
| Enormous context dump into Claude | forgot `-o` | always use `-o` + `--output-schema` |
| Codex edited `extension/**/*.ts` | it does not know our no-build-step quirk | AGENTS.md invariant 8; revert and redo in the `.js` |
| Gates green in report, red locally | self-reported, or tests were weakened | trust only your own run; diff `__tests__/` |
| Permission prompt on every call | no allowlist entry | add `Bash(codex exec:*)` to `.claude/settings.json` `permissions.allow` |

---

## Report format

Close with:

- **Spec** implemented, **preset/model/effort** used, **worktree + branch**.
- **Gate results from your own run**, with the pre-change baseline for comparison.
- **Open questions / deviations** lifted verbatim from `codex-report.json`.
- **Findings** from your diff read + `codex exec review` + `/ultra-review`, and the disposition
  of each.
- The single claim most likely to be wrong, with a certainty-it-is-wrong percentage.
