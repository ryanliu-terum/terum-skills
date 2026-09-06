# Eval engine: skilldeck's harness, adapted — with SkillEvaluator's best practices

**Date:** 2026-09-04. **Owner:** Ajay (delegated the eval-engine choice).
**Decision:** the terum-skills phase-3 eval engine is **skilldeck's `claude`-CLI harness**
(`github.com/ajayw36/skilldeck`, `tools/skilldeck/evals/`), adapted for terum-skills —
**superseding walk Decision 5** (NVIDIA SkillEvaluator as engine). SkillEvaluator remains
the reference for evaluation *practices*, and its Tier-1 validation ideas are adopted.
**Companion evidence:** `2026-09-03-phase-3-eval-share-research.md` (esp. §1–§5c) and
`~/skill-eval-comparison/results/skillevaluator/tier3-apikey/SUMMARY.md`.

## Why this engine

- **No Docker, no raw API key.** SkillEvaluator's Tier 3 requires both — a real
  onboarding tax (measured firsthand: Docker install friction, VM warm-up flakes, and
  the runner injects a raw `ANTHROPIC_API_KEY`; subscription OAuth is unusable). The
  skilldeck harness drives the member's own logged-in Claude Code CLI headlessly —
  proven end-to-end by the §5c probe (skill discovered, invoked, executed in 4 turns /
  9.4s on subscription auth).
- **Execution fidelity without containers.** The 14-skill rerun proved environments that
  can't execute skills produce wrong-signed results (shim mean −0.08 → real +0.24).
  `claude -p` executes for real; the trade (no sandbox) is mitigated below.
- **The harness already embodies the measured lessons:** deterministic checks before LLM
  judging, verdict-shaped reporting (net lift W/L/T + sign test), per-run model
  provenance, three-arm design.
- **Skill-lift rankings are noise** (ρ = −0.11 vs SkillsBench even under real execution;
  ±0.1 single-run band) — so the engine's job is trustworthy *binary verdicts with
  attribution*, which this design delivers at laptop cost.

## What carries over from skilldeck unchanged

1. **Three-arm execution evals**: baseline / candidate (working tree) / incumbent (last
   committed). The incumbent arm gives regression gating for `publish` PRs — neither
   SkillEvaluator nor any surveyed framework has it.
2. **Programmatic checks decide first; pairwise LLM judge breaks ties only.**
3. **Trigger evals** (catalog-wide recall/precision with near-miss negatives) — the
   routing measurement SkillEvaluator lacks; productizes the Jul-5 probe rig.
4. **Net lift as W/L/T + sign test, model stamped per run**, k-tiers for depth
   (`--triggers-only` cheap → k=3 PR-level → k=10 promotion-level).
5. **Local runs on subscription auth; CI runs on a repo-secret key.**

## Adaptations for terum-skills

1. **Identity/keying:** results keyed by `metadata.id` (UUID) + tree-hash version →
   `evals/<skill-id>/<version>.json`, surviving renames and pinning to exact content
   (skilldeck keys by name).
2. **Committed receipts:** D26 says the commit is the receipt. Committed JSON carries:
   verdict band, W/L/T + sign-test p, per-dimension deltas, full provenance (engine
   version+commit, CC version, model, k, dataset digest, timestamp), `execution_status`,
   scored/expected counts. Raw run trees stay local, referenced by run id (skilldeck's
   `evidence/` stamping is most of the bridge).
3. **Trigger-eval catalog scope:** recall/precision against the team's endorsed set from
   `team.json` — the catalog actually competing for attention on a teammate's machine.
4. **Lifecycle mapping:** `share` → no eval requirement; `publish` PR → k=3
   candidate-vs-incumbent + trigger evals (CI); `verified` badge → skilldeck's bar
   (≥3 cases incl. one adversarial, near-miss negatives, k=10 pairwise win).
5. **Display rules (evidence-mandated; resolves D29, decided 2026-09-04):** verdict band
   (PASS/NEUTRAL/FAIL) remains the frame, with a one-line attribution. The card's
   **displayed numbers** are the two that reproduce:
   - **Per-arm scores, side by side** ("0.82 with · 0.61 without" — plus incumbent where
     applicable). Arm-level scores are stable across identical runs (r = 0.97, §4 of the
     dossier); the *difference* between them is not (r = 0.35), so the gap is shown, never
     printed as a number.
   - **Trigger-eval counts with denominators** ("routes 9/10 · 0 false fires") — fully
     deterministic, no LLM judge, no noise band; may display regardless of execution-eval
     k since determinism, not repetition, supplies their precision.

   Raw lift is **never the headline**: it lives one click deeper in the full
   decomposition, always stamped with k, model, and config (interval display only at the
   k=10 verified tier, where Wilson/McNemar machinery applies). **Never rank or sort
   skills by lift or by any of these numbers** — denominators are too small for
   cross-skill comparison even when each number is individually honest. No
   execution-eval number displayed below k=3; Security/hygiene surfaced only on failure.

## Best practices adopted from SkillEvaluator (docs.nvidia.com/skills/skillevaluator)

*Hygiene gates:*
1. **Deep deterministic validation tier** folded into `skill validate` / `share` /
   `publish` CI: schema, PII scan, security scan of bundled scripts, unicode-trickery
   detection, license reconciliation (fail-closed on frontmatter-vs-LICENSE conflict),
   quality score with threshold. Free, no LLM, exit-code gated.
2. **Secret redaction** of configured credential values in any shared transcript or
   evidence file — mandatory once eval evidence is committed/shared.

*Measurement design:*
3. **Four-bucket case taxonomy** (explicit / implicit / contextual / negative) as the
   `gen-evals` authoring structure.
4. **Efficiency dimension**: turns/duration/cost deltas from the `claude -p` JSON — a
   skill that wins but triples token burn should say so.
5. **Verdict banding with a neutral dead-zone** (their PASS ≥ +0.05 / FAIL ≤ −0.10
   pattern) applied to net lift, so coin-flip results are announced as NEUTRAL.
6. **Contamination control**: with-arm contains exactly the skill under test; engine
   must detect the skill-under-test in `~/.claude/skills` and warn/refuse (a global copy
   silently zeroes lift). Full synthetic-HOME isolation is rejected — it breaks
   subscription OAuth on macOS (measured in the phase-2 study); global skills are
   held constant across arms instead, and recorded in provenance.

*Operational robustness:*
7. **Runtime preflight**: one tiny real agent task before a full matrix (their preflight
   caught an infra failure in seconds vs. six paid trials).
8. **Attempt policy + dataset digest recorded in every result** (their
   `attempt_policy.json` / `dataset_digest` pattern).
9. **`execution_status` + no-coercion partials**: unscored holes are labeled, never
   silently averaged (the suricata lesson).
10. **Judge escalation chain**: format-tolerant parsing → retry → escalate to a stronger
    judge model on parse failure. Grounded: `gpt-5.4-mini` failed *deterministically* on
    one lean4 case; cheap-tie-judge with escalation is the sane default. Add network
    retry-with-backoff around all judge calls (our eval.py patch, upstreamed into ours).

## Deliberately not taken from SkillEvaluator

Harbor and containerized execution; agent-agnosticism (we target Claude Code; Codex via
the placer is a later question); Tier-2 embeddings dedup; cloud sandbox backends; the
0–1 five-dimension rubric as the headline score (W/L/T + sign test is more honest at our
sample sizes given the measured ±0.1 noise).

## Known risks / open items (spec-walk material when the phase-3 gate lifts)

- **Trust model**: `--permission-mode acceptEdits` (or looser) with no container means
  teammates' skill code runs on the host. First line of defense stays `share`'s
  privilege-rejection gate; revisit sandbox-exec/bubblewrap hardening later.
- **Usage-policy refusals** return for subscription-side judge calls on security-domain
  content (suricata lesson) — deterministic checks first reduces exposure; document the
  failure mode.
- **CC version variance** across laptops: recorded in provenance; only same-version
  numbers compared, same rule as models.
- skilldeck is currently a personal repo (`ajayw36/skilldeck`); ownership/venue (fold
  `tools/skilldeck/evals/` into terum-skills vs. depend on it) is a phase-3 spec item.
