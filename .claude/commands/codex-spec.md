Run the cross-model spec auditor on a target planning spec: **findings from OpenAI Codex, adversarial verification on Claude**.

Follow `.claude/skills/codex-spec/SKILL.md` — it owns the full procedure (preflight, the two-phase find→verify split, the evidence-stays-on-disk rule, and the reporting steps). Do not re-derive those steps here.

This is the mirror image of `/hybrid-review`: there Claude finds and Codex verifies a code diff; here Codex finds and Claude verifies a spec. Reach for it when the spec was written by Claude and you want a reviewer that does not share the author's blind spots — especially before handing the spec to `/codex-implement`.

`$ARGUMENTS` is `<path-to-spec>` plus optional knobs:

- **Find phase** (`codex-spec-find.mjs`): `--dims drift,reality,quality,readiness` (default all) · `--tier sol|terra|luna` (default `sol`) · `--effort <level>` (default `high`) · `--drift-cap N` (default 8) · `--batch N` (artifacts per reality reviewer, default 8) · `--concurrency N` (default 6).
- **Verify phase** (`codex-spec-verify.js`): `--verify full|conservative|balanced|aggressive` (default `conservative` = 2-vote) · `--floor N` (per-dimension guaranteed verify slots) · `--verify-model <m>`.

Example: `.planning/specs/foo.md` · `.planning/specs/foo.md --verify=full --effort=xhigh` · `.planning/specs/foo.md --dims quality,readiness`

Two things that are easy to get wrong and matter:

1. **Run the find phase in the background.** It is 15+ Codex calls and routinely exceeds the foreground Bash timeout.
2. **Never pass finding `evidence` through the Workflow `args`.** Pass `findingsPath` plus a slim index; the verify agents read evidence from disk. A model asked to copy findings verbatim rewrites them (measured: 26/26 curly quotes normalized despite explicit instruction), and evidence that no longer matches the spec it quotes is unusable.

Write the report to `.planning/specs/reviews/<basename>.codex-spec.review.md` — the `.codex-spec.` infix keeps it from overwriting an `/ultraspec` report on the same spec, and comparing the two is much of the point.

If the find phase reports any `finderFailures`, the run is **incomplete, not clean** — say so and re-run.
