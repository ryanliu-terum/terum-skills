Run the cross-model spec auditor on a target planning spec: **findings from OpenAI Codex, adversarial verification on Claude, then a Claude triage of every confirmed finding into mechanical / clear / fork / declined**.

Follow `.claude/skills/codex-spec/SKILL.md` — it owns the full procedure (preflight, the two-phase find→verify split, the evidence-stays-on-disk rule, the triage buckets, and the report + act-on-the-buckets steps). Do not re-derive those steps here.

This is the mirror image of `/hybrid-review`: there Claude finds and Codex verifies a code diff; here Codex finds and Claude verifies a spec. Reach for it when the spec was written by Claude and you want a reviewer that does not share the author's blind spots — especially before handing the spec to `/codex-implement`.

`$ARGUMENTS` is `<path-to-spec>` plus optional knobs:

- **Find phase** (`codex-spec-find.mjs`): `--dims drift,reality,quality,readiness` (default all) · `--tier sol|terra|luna` (default `sol`) · `--effort <level>` (default `high`) · `--drift-cap N` (default 8) · `--batch N` (artifacts per reality reviewer, default 8) · `--concurrency N` (default 6). **Space-separated values only** — the find script matches a flag by exact token, so `--effort=high` is silently ignored and the default is used.
- **Verify + triage phase** (`codex-spec-verify.js`): `--verify full|conservative|balanced|aggressive` (default `conservative` = 2-vote) · `--floor N` (per-dimension guaranteed verify slots) · `--verify-model <m>` · `--no-triage` (skip the default triage stage; passes `triage: false` in the workflow args).

Example: `.planning/specs/foo.md` · `.planning/specs/foo.md --verify full --effort xhigh` · `.planning/specs/foo.md --dims quality,readiness` · `.planning/specs/foo.md --no-triage`

Three things that are easy to get wrong and matter:

1. **Run the find phase in the background.** It is 15+ Codex calls and routinely exceeds the foreground Bash timeout.
2. **Never pass finding `evidence` through the Workflow `args`.** Pass `findingsPath` plus a slim index; the verify and triage agents read evidence from disk. A model asked to copy findings verbatim rewrites them (measured: 26/26 curly quotes normalized despite explicit instruction), and evidence that no longer matches the spec it quotes is unusable.
3. **Triage decides nothing.** The default flow is find → verify → triage → *you* act on the buckets: MECHANICAL diffs are applied only on one explicit confirmation, CLEAR items one by one, and FORKS go to `/decision-walk` — never resolved autonomously (the 2026-09-03 audit loop failed by doing exactly that).

Write the report to `.planning/specs/reviews/<basename>.codex-spec.review.md` — the `.codex-spec.` infix keeps it from overwriting an `/ultraspec` report on the same spec, and comparing the two is much of the point. The Triage section is part of the report, so `/decision-walk <that path>` can read the forks from it.

If the find phase reports any `finderFailures`, the run is **incomplete, not clean** — say so and re-run.
