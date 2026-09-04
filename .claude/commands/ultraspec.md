Run the `ultraspec` multi-agent spec auditor on a target planning spec.

Invoke the workflow: `Workflow({ scriptPath: ".claude/workflows/ultraspec.js", args: "$ARGUMENTS" })`

> Use **scriptPath, not `name`**: by-name invocation shows the script content in the approval dialog and trips the Windows control-char/CRLF guard (see `.planning/specs/2026-07-21-reviewer-model-knobs.md`, R1). The relative path resolves from the repo-root cwd.

`$ARGUMENTS` is `<path-to-spec>` plus optional knobs (all opt-in; omit everything for the full-depth, inherit-model default):

- **Presets** (one word = model + depth): `--quick` (cheap/shallow first pass), `--balanced` (everyday), `--in-depth` (max). Also `--preset=<name>`.
- **Cost levels** (`full|conservative|balanced|aggressive`): `--efficient[=level]` sets both safeguards; `--drift=level` (sibling-sweep breadth) and `--verify=level` (verification depth) override individually.
- **Per-stage models** (`opus|sonnet|haiku|fable`): `--model=<m>` (all stages), `--review-model=<m>`, `--verify-model=<m>`, `--fable-review` (= `--review-model=fable`). Omit → inherit the session `/model`.
- **Fix proposal is ON by default** (proposes edits for confirmed BLOCKER/DRIFT; never applies them). Pass `--no-fix` to skip.

Example: `.planning/specs/foo.md --balanced` · `.planning/specs/foo.md --verify=conservative --review-model=fable`.

When the workflow returns:
1. Write the returned `reportMarkdown` to `.planning/specs/reviews/<basename>.review.md` (`<basename>` = target filename without `.md`). Create `.planning/specs/reviews/` if it doesn't exist.
2. Post an inline summary: the severity-count table (`counts` — CONFIRMED only) and `topFindings` (BLOCKER/DRIFT) with locations. If this was a low-confidence run (`mode.preset === "quick"`, or a 1-vote verify level), say so plainly — those findings were single-verifier checked, not a trust gate.
3. Surface (but do NOT treat as confirmed) any `contestedFindings` (verify panel split — need human adjudication) and `unverifiedFindings` (efficient mode skipped adversarial verification). Never fold these into the counts.
4. If `proposedFix` is present, show the proposed edits but do NOT apply them unless I explicitly confirm.
5. Report the saved report path.

If the workflow returns an `error` field (e.g. spec not found), surface it and stop.
