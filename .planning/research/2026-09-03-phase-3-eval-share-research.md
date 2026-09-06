# Phase-3 research dossier: evaluations + share

**Date:** 2026-09-03. **Author:** Ajay, with Claude.
**Status:** Research inputs only — deliberately NOT a spec. The phase-3 spec gate stands
(decided 2026-09-03: build phase 1 before speccing phases 2–3; eval design needs experience
with published skills). Everything here is grounded in surfaces that do NOT drift with this
repo: the pinned SkillEvaluator checkout and measured runs in `~/skill-eval-comparison`
(Ajay's machine, 2026-09-01), the npm registry, and upstream GitHub.

## 1. SkillEvaluator: the verified contract (v0.2.1, commit `b882b16a`)

Source of truth: `~/skill-eval-comparison/results/skillevaluator/SETUP.md` (CLI verified
against `--help`, not guessed) and two full measured runs.

- **Tier 1 — free, deterministic, no LLM:**
  `skillevaluator validate <skill-dir> --checks schema,pii,license,quality,unicode,lint --no-dedup -c -r cli,json -o <outdir>`
  This is the gate `share`'s frontmatter injection must pass by construction (V5 in the
  phase-1 spec). Checks available: schema, version, security, pii, license, code-integrity,
  unicode, quality, lint (+opt-in dependency). Observed on the pinned v0.2.1 checkout:
  missing `metadata.author` fails schema; `Proprietary` fails the license gate; SKILL.md
  > 5k tokens fails quality. **Discrepancy vs current main:** upstream docs/source now make
  `metadata.author` and `license` *optional* in the default profile (author format enforced
  only when present, two-stage: shape `Name <email>` then a policy `author_email_regex`;
  domain pinning only in the `internal` profile) — the requiredness we observed is either
  version churn or profile-dependent. V5 must be verified against whatever commit gets
  pinned, not assumed. Tier-1 failures do NOT block Tier 3.
- **Tier 3 — paid, the real eval:**
  `skillevaluator tier3 evaluate <skill> --agents claude-code --env-mode docker [--n-attempts N] [--agent-model claude-code=<model>] [--results-dir D]`
  Runs every eval case in two arms (with-skill / without-skill baseline) in identical Harbor
  sandboxes. Grading: 3 LLM judges + deterministic trajectory metrics. `--skip-baseline`
  halves cost but kills Skill Lift.
- **Eval datasets:** `skillevaluator create-eval-dataset <skill> [--full] [--no-llm]` —
  `--no-llm` is template-based, fully offline, free; LLM-backed ≈ 4–8 evaluator calls.
  `--full` = 4-bucket dataset (explicit/implicit/contextual/negative).
- **Readiness probe:** `skillevaluator doctor --agents claude-code --env-mode docker` (free).
- **Runtime floor:** Python >=3.12,<3.14; Harbor 0.13.2 pinned; agent CLIs are user-supplied.
- **Env-mode matters enormously — with a corrected attribution.** Our runs measured
  Discoverability and Efficiency at 0.00 in every arm of every skill (both runs), but
  upstream source has NO rule zeroing them in local mode — the zeroing came from the
  degraded execution path (the subscription shim flattened tool-calling, so
  `skill_execution`/`skill_efficiency` never registered; dimensions drop only when their
  source metrics are absent, `_build_dimensions`). The ledger's condition "Docker env-mode
  with a raw API key" remains the right default — Docker is the supported, fully-executing
  path, and local mode is experimental ("trusted skills only", Seatbelt/bubblewrap,
  **unsupported natively on Windows**) — but the reason is execution fidelity, not a
  local-mode scoring rule.

### Credentials — a product-shaping constraint

**Claude Code OAuth is NOT reusable.** The Tier-3 runner injects a raw `ANTHROPIC_API_KEY`
into each sandboxed trial (`src/skillevaluator/tier3/harbor/runner.py:480`); Docker trials
are fresh containers without `~/.claude`. So D26 ("evals run locally on the member's own API
budget") literally means every eval-running member needs a raw Anthropic key — a Claude
subscription alone does not suffice. Zero-Anthropic-key alternative: `SKILL_EVAL_LLM_PROVIDER=nv_build`
with a free NVIDIA Build key drives all agents through built-in bridges. Two credential
roles (evaluator/judge vs agent runtime); with `SKILL_EVAL_LLM_PROVIDER=anthropic` one key
serves both. Tier-2 dedup additionally needs an embeddings provider (Anthropic has none).

## 2. Result JSON shapes → what `evals/<skill-id>/<version>.json` must hold

Verified from actual run artifacts (machine-readable, stable across both runs):

- **Tier 1 report** (`skillevaluator-output-<ts>.json`): `overall_status`,
  `total_validators/errors/warnings`, `severity_counts{critical,high,medium,low}`,
  `results[]` per validator (`validator`, `status`, `summary{files_scanned, checks_performed, errors, warnings}`),
  plus per-skill and per-contributor rollups.
- **Tier 3 per-skill result** (from `tier3_summary.json` paths): `status`, `n_cases`,
  `expected_attempts/scored_attempts`,
  `metrics_with{security, skill_execution, skill_efficiency, accuracy, goal_accuracy, behavior_check}`,
  `metrics_without{...}` (same six),
  `dimensions{correctness, effectiveness, discoverability, efficiency, security}` each with
  `{with, without, lift}` on a 0–1 scale, and `overall_with/overall_without`.
- **Dimension formulas** (for rendering, not recomputation): Correctness←accuracy,
  Effectiveness←0.5·goal_accuracy+0.5·behavior_check, Discoverability←skill_execution,
  Efficiency←skill_efficiency, Security←security. Bands: PASS ≥0.50, NEUTRAL 0.40–0.50,
  FAIL <0.40. **Skill Lift** = overall(with) − overall(without); PASS ≥ +0.05, FAIL ≤ −0.10.
- **Current upstream shape (main, `schema_version: "2.0"`)** — richer than our pinned run:
  on-disk tree `evals/results/<ts_pid_hash>/` with `result.json`, `run_config.json`,
  `attempt_policy.json`, `comparison.json`, per-agent dirs with `lift.json`,
  `pass_at_k_lift.json`, and `with-skill/`/`without-skill/` `summary.json` + `trials/`, plus
  a `latest/` symlink. `result.json` carries a `summary` block (`verdict`, `overall_score`,
  `overall_lift`, `evaluator_version`, `dataset_digest`, `verdict_policy`,
  `execution_status`, `expected/scored_attempts`), per-agent objects, per-dimension entries
  with `explanation`/`reasoning_bullets`, and (since 0.2.1) `pass_at_k` with per-arm 95%
  Wilson intervals and McNemar paired diagnostics. This matches the three-layer reading
  already on record (Ajay, 2026-09-02): timestamped run metadata / per-trial results /
  arm-comparison lift — a good organizing principle for what `evals/<id>/<version>.json`
  keeps vs links.
- **Mapping implication for the future spec:** the committed eval JSON should carry the
  run config (agent, agent model, judge model, env-mode, n-attempts, framework version and
  commit, dataset digest) alongside the dimensions — the comparison study proves numbers
  are meaningless without the config that produced them (see §5), and upstream's
  `dataset_digest`/`evaluator_version` fields exist precisely for this.

## 3. Cost model (measured, not estimated from docs)

Per skill with a 3-case dataset, both arms, 1 attempt: 7 agent runs (6 trials + 1 preflight
smoke; each ~5–20 model requests, ~30–100K in / 3–10K out tokens) + ~18–24 judge calls +
1–2 report calls ≈ **90–170 API calls, 0.3–0.8M tokens**. Dollars: **~$1.5–4/skill** with
Sonnet-class agent+judge (`--agent-model claude-code=<sonnet>`, `SKILL_EVAL_LLM_MODEL`
override); **~$4–10/skill** on the pinned Opus-class defaults. `n_attempts=2` roughly
doubles trial cost (judge cost scales with trials). There is a documented free tier via
NVIDIA Build (`nv_build`) for the evaluator role, and upstream's documented cheap judge
knob is `gpt-5.4-mini` via `SKILL_EVAL_LLM_MODEL` (CHANGELOG 0.2.1). Note the CLI flag is
`--n-attempts` (with `--pass-threshold`, default 0.50, and `--stop-on-pass` for pass@k).

## 4. Reliability — the n_attempts>1 rule, quantified

Test–retest (two identical full runs, 14 skills, `n_attempts=1`,
`~/skill-eval-comparison/results/skillevaluator/CONSISTENCY_ANALYSIS.md`):

- Per-skill lift moves ±0.05–0.19 between identical runs (median |Δ| 0.051, max 0.222);
  Pearson r on lift only 0.35. **A single-run lift is a ±0.1 noise band; ranking skills by
  one run is unsupported.**
- But: PASS-verdict agreement (lift ≥ +0.05) was 13/14, and arm-level scores are far more
  stable than their difference (without-skill arm r = 0.97).
- Structural outputs perfectly stable (a good pin-check signal).

This turns the ledger's bound-in condition ("any number that reaches a share card uses
`n_attempts > 1`") from a rule of thumb into a measured requirement, and suggests the share
card should lead with the PASS/NEUTRAL/FAIL verdict (reproducible) rather than the raw lift
number (noisy).

## 5. What the framework comparison means for product claims

From `~/skill-eval-comparison/SYNTHESIS.md` (14 SkillsBench skills, 4 frameworks): the four
measurements of "how much does this skill help" are nearly uncorrelated per-skill (Spearman
ρ vs SkillsBench −0.58…+0.38) and disagree in sign at the corpus level (+14pp / −20pp /
+33pp / −0.12pts). A vendor could truthfully claim anywhere from +33pp to −20pp for the
same skills by choosing the framework. Consequences for phase 3:

- Never present a lift number without naming the framework, config, and n_attempts.
- SkillEvaluator's Effectiveness dimension was the best rank-correlate with SkillsBench
  even in a degraded environment (ρ +0.38) — the architecture choice (walk Decision 5)
  holds up.
- The honest framing for share cards is SkillEvaluator's own verdict bands, not
  cross-framework "X% better" claims.

## 5b. UPDATE — the real-key rerun (2026-09-03, same day)

The 14-skill corpus was rerun with a real `OPENAI_API_KEY`, Docker env-mode, and real
multi-turn execution (agent `codex` on `gpt-5.4-mini`; judge mini, bumped to `gpt-5.6-sol`
for 3 skills). Full write-up:
`~/skill-eval-comparison/results/skillevaluator/tier3-apikey/SUMMARY.md`. What it changes:

- **§5's "lower bounds contaminated by the harness" hypothesis is confirmed.** Mean lift
  went from −0.08 (shim) to **+0.238**; 14/14 skills PASS ≥ +0.05; the
  Discoverability/Efficiency metrics discriminate instead of flatlining at 0. suricata got
  its first fully-scored run anywhere (no usage-policy layer on the OpenAI judge path).
- **New, sharper caveat: even with real execution, per-skill ranking does not track
  SkillsBench** — Spearman ρ = −0.11 (n=14). All lifts compress into +0.07..+0.45, inside
  which the ±0.1 single-run noise band (§4) scrambles order. Sign agreement 10/14.
  **Product rule: a Tier-3 verdict is trustworthy as a binary with attribution of *why*
  (execution vs knowledge dimensions); never rank or leaderboard skills by lift.** This
  supersedes any idea of sorting the marketplace UI by lift.
- **Judge model guidance:** `gpt-5.4-mini` as judge deterministically failed to emit
  parseable `behavior_check` output on one lean4 case (and once transiently on xlsx).
  Cheap config that works: **mini agent + `gpt-5.6-sol` judge**. Judge cost is ~20 small
  calls/skill — cents.
- **Ops lesson for the phase-3 spec:** per-trial network installs are the dominant failure
  mode on imperfect networks. The rig needed four local patches (bake Node+Codex into task
  images, skip-if-present installer, judge-call retry, pre-pulled base image) — an
  upstream-worthy issue, and a reason the spec's eval flow should pin a patched fork or
  upstream these fixes first.

## 5c. Feasibility probe — a `claude -p`-driven custom evaluator (2026-09-04)

Context: the team is considering (NOT decided — walk Decision 5 still stands on record)
building a custom eval framework instead of SkillEvaluator, motivated by its Docker + raw
API-key requirements. The candidate architecture: drive the member's own logged-in Claude
Code CLI headlessly, two-arm, in temp workspaces — subscription auth, no Docker.

Probe (synthetic `area-reporter` skill with a checkable file-write convention, staged in
one temp workspace's `.claude/skills/`, absent in the other; identical prompt via
`claude -p --output-format json --max-turns 8`):

- **Discovery + invocation + execution all work headlessly.** With-arm followed the
  skill's convention end-to-end (exact file, exact JSON shape, exact reply format) in 4
  turns / 9.4s; baseline arm computed generically. Two-arm discrimination is real.
- **Permission mode is a required design decision:** default `claude -p` blocks writes
  with nobody to approve (first with-arm attempt failed to save). `--permission-mode
  acceptEdits` fixed it; the framework must pick a policy, and looser modes re-raise the
  unsandboxed-trust question that Docker was solving.
- **Deterministic verification works:** the probe graded itself by checking the artifact
  file — SkillsBench-style verifiers are available for any case with checkable outputs,
  reducing LLM-judge dependence (and the usage-policy-refusal exposure that comes with
  subscription-side judging — the suricata lesson).
- `--output-format json` returns `num_turns`, duration, and an API-equivalent cost
  estimate (~$0.42 for the 4-turn run) — provenance and budget fields come free.

Open design items if pursued: permission/trust policy, judge path (subscription `claude
-p` judges vs deterministic verifiers vs optional API key), controlling global-skill
contamination across arms (constant within a machine, varies across machines), and
recording the member's Claude Code version in provenance. Artifacts:
`<scratchpad>/claude-p-probe/`.

## 6. Share-card rasterization (D30 — the OPEN library choice)

Researched 2026-09-03 (npm registry + GitHub; agent report on file). Recommendation:

- **Pick: `@resvg/resvg-js`.** Prebuilt N-API binaries for macOS x64/arm64, Linux
  gnu+musl x64/arm64, Windows x64/ia32/arm64 — no node-gyp, no postinstall, ~3.5–4.5 MB for
  the one platform package npm actually installs. The decisive feature for a text-heavy
  card: first-class `fontFiles`/`fontDirs`/`loadSystemFonts:false`, so shipping one .ttf
  beside the SVG template yields pixel-identical text on a bare CI runner, a dev laptop,
  and Windows — no fontconfig. Ecosystem-standard OG-image rasterizer (Satori/Vercel OG
  pair with it; svg2png-wasm deprecated in its favor). Stable 2.6.2 (2024-03); 2.7.0
  alphas Jan 2026; underlying resvg crate now stewarded by Linebender.
- **Fallback: `@resvg/resvg-wasm`** — same engine, zero native code, fonts via
  `fontBuffers`, ~2× slower; immune to any prebuild-missing edge.
- **Rejected:** `sharp` (~19 MB/platform; librsvg→fontconfig text = system-fonts-only, a
  documented tofu/mis-substitution tail on bare environments — wrong trade for text
  cards). Shell-outs all fail the Windows out-of-box constraint: `rsvg-convert` is
  preinstalled nowhere, ImageMagick's SVG quality depends on whether the user's build has
  the librsvg delegate, headless Chromium is a ~150 MB assumption the CLI path excludes.
- **Note on the deps rule:** the phase-1 "shell out over native deps" preference is
  justified to break here — resvg-js has none of the failure modes the rule guards against
  (no toolchain, no postinstall), while every shell-out has a real absent-binary mode.
  Adding it remains a phase-3 decision to confirm at spec time.
- **Wildcard if the SVG-template premise reopens:** Takumi (`@takumi-rs/core`, very
  active) renders JSX/CSS directly — only relevant if D28–D30's SVG template is abandoned.

## 7. Jul-5 routing-probe rig (demoted reference)

Terum records: "terum-* skill efficacy validation" (ryanliu, 2026-07-05) — cold Sonnet
agents probed for whether skills load, route, and are obeyed, with measurable behavioral
impact where CLAUDE.md doesn't already cover the ground; companion record on verifying
factual accuracy vs trigger/behavioral invocation. Per the ledger it is a reference for
routing-probe design only (possible supplement to trigger-accuracy measurement — an open
sub-question delegated to the eval-integration spec). Search Terum by that title when the
spec gets written; not summarized further here.

## 8. Upstream status & pinning (researched 2026-09-03)

- **Identity confirmed:** github.com/NVIDIA/SkillEvaluator, Apache-2.0, docs at
  docs.nvidia.com/skills/skillevaluator; part of the NVIDIA Verified Skills pipeline
  (with NVIDIA/skills and NVIDIA/SkillSpector). README: "Experimental,
  community-supported." ~400 stars, repo created 2026-06-24, pushed as recently as
  2026-09-03.
- **NOT on PyPI.** Install is git-based
  (`uv tool install --python 3.13 "skillevaluator[all] @ git+https://github.com/NVIDIA/SkillEvaluator.git@<ref>"`).
- **Only one git tag exists: v0.1.0 (2026-08-05)** — yet CHANGELOG records 0.2.0
  (2026-08-18) and 0.2.1 (2026-08-24) and pyproject on main says 0.2.1 with an active
  Unreleased section. **Pin a commit SHA, not a tag or branch.** Our measured baseline is
  commit `b882b16a` (the checkout in `~/skill-eval-comparison/frameworks/skillevaluator/`).
- **Churn that already happened and would bite an unpinned integration:** the v1→v2 metric
  set (security metric added; Tier-3 scoring unified around the canonical five dimensions
  in 0.2.1), new gating flags (`--block-on-dedup`, `--block-on-agent-eval`, 0.2.0),
  default-model swaps (current pins: `gpt-5.6-sol` / `claude-opus-5` /
  `us.anthropic.claude-opus-5`; NVIDIA Build `nemotron-3-super-120b`), a SARIF reporter
  (unreleased), and stricter license/PII fail-closed behavior (unreleased, issues #85–#88)
  that can flip previously-passing skills to failing.
- **Platform constraints for the product:** Python 3.12/3.13 and (for the supported
  Docker env-mode) a running Docker daemon; local mode is experimental and natively
  unsupported on Windows (WSL2/docker only). So "member runs evals" implies member has
  Python 3.12/3.13 + Docker — a real onboarding cost phase 3 must own, or route around via
  the deferred CI path.
- Bedrock evaluator doesn't support local mode; nor does Anthropic evaluator + opencode.

## 9. Open questions this research does NOT settle (they're gated on phase-1 experience)

- The committed eval JSON schema itself (field naming, which raw metrics to keep) — needs
  the real `publish` flow and at least one real team skill through V5.
- ~~Share-card score summary (D29)~~ — RESOLVED 2026-09-04: verdict band frames the card;
  displayed numbers are per-arm scores side by side + trigger-eval counts; lift one click
  deeper with provenance. See display rules in `2026-09-04-eval-engine-adaptation.md`.
- CI-on-publish-PRs (secrets, cost policy) and cheap-tier policy for teams.
- Whether routing probes supplement Tier 3 (needs the Jul-5 rig re-read at spec time).
