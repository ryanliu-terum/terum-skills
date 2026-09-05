---
name: ultrareview
description: In-session multi-agent code-diff reviewer. Review a branch / PR / working-tree diff across 4 dimensions (correctness & tests, security & data-loss, Terum CLAUDE.md invariants, reuse/simplify/perf) with 3-vote adversarial verification, emit a severity-ranked report, and auto-create bug logs for the worst findings. Use when the user wants to code-review a diff locally — the Max-included, in-session replacement for cloud /code-review ultra. Args: [<PR#>] [--working] [--no-fix] [--no-logs] + optional knobs/presets (--quick|--balanced|--in-depth|--max; --model/--review-model/--verify-model; --efficient/--verify).
---

Run the `ultrareview` multi-agent code-diff reviewer on the current branch, a PR, or your working tree, then turn its findings into a report and (optionally) bug logs.

The workflow's canonical target/behavior args are `[<PR#>] [--working] [--no-fix] [--no-logs]`, plus the knob/preset flags below:
- (no args) → review the current branch vs `main`
- `<PR#>` → review that GitHub PR (e.g. `123` or `#123`; needs `gh` authenticated)
- `--working` → review staged + unstaged changes to **TRACKED** files (`git diff HEAD`). **Untracked/new files are NOT reviewed**, and the workflow's own warning about them never reaches the return value (it's built into the diff-acquisition prompt but dropped before the final return). If the user's phrasing implies new files ("everything I changed", "the files I added"), either tell them plainly that untracked files are excluded, or have them run `git add -N <paths>` first so the diff picks the files up.
- `--no-fix` → skip the patch-proposal stage. Proposals run by **DEFAULT**; they are never applied automatically. Skipped automatically when reviewing an un-checked-out PR (patches can't be built from diff text alone).
- `--no-logs` → skip auto bug-log creation
- **Knobs / presets** (additive to any mode; opt-in — omit everything for today's full-depth, inherit-model behavior):
  - `--quick` / `--balanced` / `--in-depth` / `--max` (or `--preset=<name>`) — one word sets model + verification depth. In ultrareview `--in-depth` and `--max` differ only by review model (sonnet vs opus) — there is no drift stage for the drift cap to affect.
  - `--efficient[=level]` / `--verify=level` — verification depth (`full|conservative|balanced|aggressive`). `--drift` is accepted-but-ignored (ultrareview has no cross-spec drift stage).
  - `--model=<m>` / `--review-model=<m>` / `--verify-model=<m>` / `--fable-review` — pin a model per stage (`opus|sonnet|haiku|fable`); omit → inherit the session `/model`.
  - `--codex-verify` is also parsed here, but it belongs to **`/hybrid-review`** (Claude finds, Codex verifies) — do not pass it from `/ultrareview`; route the user there instead. Note it also makes `--in-depth`/`--max` differ by Codex reasoning effort, not only by review model. See `.claude/skills/hybrid-review/SKILL.md`. `--fast` is the same story — parsed here, meaningful only with `--codex-verify` (it sets the Codex service tier); on its own the script logs `NOTE: --fast ignored` and runs unchanged.

## Step 0 — resolve the review target (do this BEFORE invoking the workflow)

`$ARGUMENTS` is whatever the user typed — it may already be canonical flags, OR natural language ("review PR 109 off the remote", "just my uncommitted edits", "everything I changed this session"). The workflow's own **target** parser is deliberately dumb: the review target comes from a bare PR number or `--working` and nothing else, and **any token it does not recognize is silently ignored, leaving the target at branch-vs-`main`**. (It *does* parse the knob/preset flags listed above — plus `--drift`, which it accepts and ignores with a logged NOTE, and `--codex-verify`, which is `/hybrid-review`'s entry point — and it WARNs on an unknown preset or model name. None of those change the target.) So YOU translate intent → canonical args here; never pass free text straight through and rely on that fallback.

Map the user's phrasing to one mode + optional flags:

| User intent (any phrasing) | Canonical arg |
| --- | --- |
| a specific GitHub PR ("PR 109", "pull request #109", "review 109 from the remote") | the bare number, e.g. `109` |
| uncommitted/staged work ("my working tree", "uncommitted edits", "what I haven't committed yet") | `--working` (tracked files only — see caveat above; flag if the user has new/untracked files) |
| this branch's full diff ("branch vs main", "everything since main", "all my work this session") | (no positional arg) |
| + skip patch proposals ("just the report", "no fixes") | add `--no-fix` |
| + skip bug logs ("don't write bug logs") | add `--no-logs` |

Translation rules:
- A PR target needs an actual digit token (`109` / `#109`). If the user spells the number out or it's unclear which PR they mean, ASK for the number — do not guess.
- `--no-fix` and `--no-logs` are additive to any mode. Fix proposals are ON by default.
- Empty `$ARGUMENTS` → no args (branch vs `main`). This is the ONLY case where the bare default is the intended target.
- **If `$ARGUMENTS` is non-empty but you cannot confidently map it to a row above, STOP and ask one clarifying question** (PR# / working tree / whole branch?). Do NOT let it slide into the silent branch-vs-`main` fallback — that reviews the wrong diff and the result looks clean, which is a no-silent-degradation violation.
- If the user names BOTH a PR and the working tree, the PR wins; tell them `Ignoring working-tree; reviewing PR #<n>`.

Then invoke the workflow with the **canonical** args you resolved (NOT the raw text), passing through any knob/preset flags the user gave:
`Workflow({ scriptPath: ".claude/workflows/ultrareview.js", args: "<resolved canonical args + knob/preset flags>" })`

> Use **scriptPath, not `name`**: by-name invocation shows the script content in the approval dialog and trips the Windows control-char/CRLF guard (see `.planning/specs/2026-07-21-reviewer-model-knobs.md`, R1). The relative path resolves from the repo-root cwd.

When the workflow returns:

1. If it returns `diffAvailable: false` (empty diff, not a git repo, bad PR#), surface the `error` message and STOP.

   An `error` field **without** `diffAvailable: false` is the *synthesis-failed* path (`Synthesis failed -- returning verified findings raw.`). The review and verify panel already ran: `counts`, `confirmedFindings`, `contestedFindings`, `unverifiedFindings` and `stats` are all populated — only `reportMarkdown` is missing. Do NOT stop. Say synthesis failed, then either skip step 2 or write the report markdown yourself from `confirmedFindings`, and continue with steps 3-7 normally.

2. Write the returned `reportMarkdown` to `.planning/reviews/<target>.review.md`, where `<target>` is the returned `target` field **slugified — replace `/` with `-`** (branch-mode `target` is the raw branch name, e.g. `feat/github-cheap-model`, which would otherwise create a `.planning/reviews/feat/` subdirectory; the directory is flat — every existing report there is `<slug>.review.md`). In `--working` mode `target` is the constant `"working"`, so date-suffix it (`working-YYYY-MM-DD.review.md`) rather than overwriting the previous run. Create `.planning/reviews/` if it does not exist.

3. Post an inline summary: the severity-count table (`counts` — CONFIRMED only) and `topFindings` (the critical/high items) with their `file:line`. Quote `stats.rawFindings → stats.distinctFindings` (the Dedup stage merges the same defect reported by several dimensions BEFORE verification, so each distinct finding is verified once against the union of the reviewers' evidence); a finding with `dupCount > 1` was independently rediscovered by the dimensions in `dupDimensions` — mention that, it is a confidence signal. If this was a low-confidence run (`modeDetail.preset === "quick"`, or a 1-vote verify level), say so plainly — those findings were single-verifier checked, not a trust gate. Then surface, but do NOT treat as confirmed and never fold into `counts`: any `contestedFindings` (verify panel split — need human adjudication) and `unverifiedFindings` (efficient mode skipped adversarial verification for them).

4. **Adjudicate each finding — convention is NEVER a sufficient reason to decline.** This is the step that decides fix-vs-decline, and it is where mediocre code calcifies into permanent "convention" if you let it. Before declining any finding on a "that's how we do it everywhere / it matches the siblings / it's pre-existing" basis, apply the **standalone test**: *would this code be wrong or fragile if it were the ONLY place in the codebase doing it?*
   - **No → load-bearing convention** (deviating would itself be a bug, e.g. "all disconnect routes preserve state flags"). The decline is valid — say *why* the consistency is load-bearing.
   - **Yes → calcified mistake** (the pattern is consistent only because the flaw propagated). Convention does not absolve it. Pick the **correct** fix here, AND produce the **sibling-sweep worklist** — every call-site sharing the flaw (from the finding's `suggestion` + your own grep). Fix the siblings in the same change when the sweep is small (root CLAUDE.md:39 — "**grep for every sibling call-site sharing the pattern and fix them in the same commit**"); when it is too big for this change, file a **`.deferred` bug log** (`.planning/debug/CONVENTIONS.md` — `status: deferred`, with `why_deferred` + `sweep_scope`) so it is tracked debt, not silently re-calcified.
   - **First check the existing `.deferred` register** (`find .planning/debug -name '*.deferred.md'`, or `grep -rl 'status: deferred' .planning/debug`): a finding already adjudicated-and-deferred there is a known decision — annotate it as deferred (cite the log) and move on, don't re-litigate it.
   - "Pre-existing / out-of-scope for this diff" is a legitimate decline, but a fragile pre-existing pattern still earns a `.deferred` log — that is how out-of-scope flaws stop being invisible across review rounds.

   Record the disposition of every critical/high finding (fixed | swept | deferred-with-log | declined-load-bearing) in your summary so the next round/agent inherits the decision instead of re-deriving it.

5. **Auto bug-logs** — SKIP this entire step if the returned `noLogs` is true. Otherwise, for each finding in `confirmedFindings` whose `severity` is `critical` **or `high`** OR whose `dimKey` is `security` **or whose `dupDimKeys` contains `security`** (a merged finding keeps only its representative's `dimKey`, so a security report absorbed into a higher-severity correctness one is still security-eligible) (**only** `confirmedFindings` are eligible — NEVER auto-log `contestedFindings` or `unverifiedFindings`; those are surfaced for human adjudication, not treated as real defects):

   > **Threshold rationale** (Ryan, 2026-07-30): `high` was added so a confirmed high-severity correctness bug leaves a durable record and so `/parallel-fix` — which consumes *existing* bug logs — can run straight off a review instead of needing one `/single-fix` turn per finding. `medium`/`low` stay OUT on purpose: the bug corpus is an analytical asset (the invariant meta-audit read ~243 logs), and filling it with style nits degrades that. Note `/single-fix` writes its own log for anything you hand it, and dedups against existing logs — so a finding below this threshold is not lost, it just gets logged on demand rather than up front.
   a. Read `.planning/debug/CONVENTIONS.md` (canonical frontmatter + body shape) and `.planning/debug/BUG-GROUPS.md` (the current group set + overlap rules). Do NOT hardcode the schema or the group list — they drift.
   b. Classify the finding's `file` into one group per `BUG-GROUPS.md`.
   c. Get a number — run `git fetch origin` **once** first, then run the script **once per finding**: `NNN=$(bash scripts/next-bug-number.sh)`. This is the mutex-locked counter; NEVER choose a number by grepping or `ls`-ing existing logs. The fetch is not optional: the script derives its ceiling from `git log --all` + `git ls-tree` over local **and remote-tracking** refs, so a number already live on an unfetched sibling branch gets reissued — a collision that fails the required `npm run check:bug-log-status` check (`.planning/debug/CONVENTIONS.md` § Numbering).
   d. Write `.planning/debug/{group}/bug-NNN-<slug>.md` (slug = kebab of the finding title). Frontmatter per CONVENTIONS.md: `bug: NNN`, `slug`, `title` (the finding title), `group` (MUST equal the folder), `severity` (the finding's `severity` verbatim — already `critical|high|medium|low`), `status: open`, `found:` (today's ISO date), `files:` (the finding's `file`). Body sections exactly `## Symptom`, `## Root cause`, `## Fix`, `## Files`, filled from the finding's title/evidence/suggestion.
   e. Treat each write as best-effort: if one bug log fails, continue with the rest and the report still stands.
   f. List the created bug-log paths so they can flow into `/single-fix` or `/parallel-fix`.

6. If `proposedFix` is present (fix proposal runs by default; `--no-fix` skips it): print `proposedFix.patchMarkdown` under an explicit **"Proposed patches — NOT YET ADJUDICATED"** heading, and DO NOT apply any edit unless the user explicitly confirms.

   Keep this AFTER step 4, always. A finished patch under a "confirmed critical" heading reads as a settled conclusion, but findings are hypotheses (root CLAUDE.md: *"Agent findings are hypotheses"*) and the verify panel is known to pass false positives when its voters share a misreading. The patch is an input to the step-4 adjudication, never a substitute for it — say so in one line when you print it. If `patchMarkdown` reports that proposals were skipped because the PR head branch is not checked out, surface that plainly rather than treating it as "no fixes needed".

7. Report the saved report path and any created bug-log paths.
