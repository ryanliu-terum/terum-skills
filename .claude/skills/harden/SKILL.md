---
name: harden
description: Review → fix → re-review loop. Runs /hybrid-review (code) or /codex-spec (spec) for up to N FULL rounds, applies the triage-approved fixes between rounds — every mechanical patch and every clear fix, critical/high (code) or BLOCKER/DRIFT (spec) only — gated by lint/typecheck/test with one commit per round, and returns a converged end state (convergence table, round commits, and the lists that still need a human). Never resolves forks, never applies mediums, contested or unverified findings, never pushes. Args: <target> [--rounds N] [--confirm] [--base <ref>] plus anything /hybrid-review or /codex-spec accepts, passed through. <target> is a spec path (.md → spec lane), a PR number, --working, or nothing (current branch → code lane).
---

Run the cross-model reviewer on a target, apply what its triage cleared, review the whole target
again, and repeat — then hand back where things ended up, not a transcript.

## Why this exists

The loop already existed by hand. The phase-1 build spec went through three `/codex-spec` rounds
on 2026-09-03 (`.planning/specs/reviews/2026-09-02-phase-1-build.codex-spec.r1..r3.review.md`),
each closed by a spec revision: 13 confirmed / 7 blockers → 8 / 4 → 6 / 3. Round 3 was still not
clean, so the cap below is a cap, not a promise. The M1 code tree got the same treatment on
2026-09-04 (`hybrid-working-2026-09-04-pass1`). This skill runs that cadence unattended.

Locked by Ryan 2026-09-04 (decision walk, this repo):

- **Full rounds, cap 3.** Every round re-reviews the WHOLE target — original work plus every
  round's fixes — not just the last fix diff. This overrides the same-day two-pass rule ("full
  pass, fix, fix-scoped confirmation"); a fix-scoped pass cannot catch what the first pass missed
  elsewhere, and single-pass recall is measurably incomplete (two panels on the same M1 tree
  confirmed overlapping but different sets). Want a fourth full pass? Run `/harden` again.
- **Apply set = mechanical + ALL clear**, critical/high (code) or BLOCKER/DRIFT (spec) only.
  The Triage stage's buckets are the boundary (`.claude/workflows/ultrareview.js`,
  `codex-spec-verify.js`): `mechanical` ships with a patch, `clear` has one resolution that
  clearly wins and code or text to author. Forks are never resolved here — the 2026-09-03 audit
  loop failed precisely by making batch decisions on fork-class findings.
- **Mediums are never applied**, in any mode, even when triage rated one mechanical. That is the
  tier where the two verify panels disagreed most (0 critical / 6 high vs 2 / 16 on one tree).
  They come back as a fix-or-decline checklist.
- **`--confirm`** pauses inside each round: one yes for the mechanical batch, one yes per clear
  fix, before anything is written. Unattended is the default because each round is one commit,
  so one `git revert` undoes a round.

## What it never does

Push. `git add -A`. Apply a contested, unverified, untriaged, medium/low, AMBIGUITY/GAP/NOTE, fork,
or declined finding. Pick a different fix than triage's recommended option. Count an invalid
round. Run on a tree with someone else's uncommitted files. Auto-create bug logs (it forces
`--no-logs`: this repo has no bug-number script, and the loop itself is the fixer — the
per-round reports and the end state are the durable record).

## Step 0 — resolve the target, the lane, and the flags

Loop flags (strip these before passing anything on): `--rounds N` / `--rounds=N` (cap, default
3), `--confirm`, `--base <ref>` / `--base=<ref>`, `--lane code|spec` (override). **Everything
else passes through verbatim** to the underlying skill (presets, `--verify`, `--effort`,
`--tier`, `--dims`, `--fast`, …). Natural-language args → canonical flags per the underlying
skill's Step 0 table; unmappable → STOP and ask one question, never let it fall back silently.

**Lane.** A token ending in `.md` that exists on disk → **spec lane** (`/codex-spec`). Otherwise
**code lane** (`/hybrid-review`): a bare number or `#n` → PR; `--working` → working tree; nothing
→ current branch.

**Slug** (names every artifact; must stay stable across rounds): spec → the file's basename
without `.md`; PR → `pr-<n>`; `--working` → `working-<YYYY-MM-DD>`; branch → the branch name with
`/` → `-`.

**Code lane: make the target stable across rounds.** A round commits its fixes, so `--working`
would be empty by round 2 and `main...HEAD` is empty when the work already sits on `main`. The
engine's `--base=<ref>` (branch mode only) is the stable target: round N reviews `<ref>...HEAD`.

| Target | What the loop does | `--base` |
| --- | --- | --- |
| feature branch | nothing extra | not needed (`main...HEAD` already grows with each round); pass `--base` through if given |
| `--working` | commit the tracked changes as a baseline first: `git add -u && git commit -m "harden(<slug>): baseline"` (in `--confirm` mode, ask before committing; unattended, do it and say so). Untracked files are not reviewed by the engine either way — say so, or `git add -N` them first | `--base=$(git rev-parse HEAD~1)` |
| PR `<n>` | `gh pr checkout <n>` (needs a clean tree), then branch mode; the loop **never pushes** the PR branch | `--base=<baseRefName from gh pr view --json baseRefName>` |
| on `main` (or any target where "since when?" is not implied) | `--base` is **required** — STOP and ask which commit the work starts after | as given |

## Step 1 — preflight (STOP on any failure)

```bash
codex login status                                   # must be logged in — no silent fallback to a same-model panel
git -C . status --porcelain                          # must be EMPTY (except an intended --working target)
npm run lint && npm run typecheck && npm test        # code lane only: the baseline must be green
```

- Not logged in → tell the user to run `! codex login` themselves. Do not run `/ultrareview`
  instead; a same-model panel wearing this name is the false confidence the tool exists to prevent.
- Dirty tree of files that are not the target → STOP. The loop commits per round by explicit
  path, but a review of a tree containing another session's half-edits reviews the wrong thing.
- Red baseline → STOP; `gates: fail` is a stop verdict, not a round.
- Say the cost out loud before starting: a full hybrid round at the standard panel ran **52 min
  for ~700 changed lines** (2026-09-04) plus one triage agent per confirmed finding, so three
  rounds on a real tree is an afternoon; a spec round is ~10–15 min. `--fast` is a measured
  no-op today (`.claude/skills/hybrid-review/SKILL.md`). Read the Codex plan window per
  `/codex-implement` preflight 6 and apply its gate.

Then open the run:

```bash
node .claude/workflows/harden-state.mjs init --slug <slug> --lane <code|spec> --cap <N> --mode <unattended|confirm> [--base <ref>] --args "<passthrough>"
```

It prints `nextRound` (continuing from any `<slug>.<hybrid|codex-spec>.r<N>.review.md` already on
disk — a spec with r1–r3 starts at r4) and `nextReport`. A `resumed: true` means a run is already
in progress for this slug: continue it at `nextRound`; do not start over.

## Step 2 — one round

Repeat until the verdict in Step 2e is not `continue`.

### 2a. Review the whole target

**Code lane** — exactly `/hybrid-review`, forced flags added:

```
Workflow({ scriptPath: ".claude/workflows/ultrareview.js",
           args: "<mode args> --codex-verify --no-logs [--base=<ref>] <passthrough>" })
```

**Spec lane** — exactly `/codex-spec` Steps 1–3. The find phase is 15+ Codex calls: launch it
**detached** (`nohup node .claude/workflows/codex-spec-find.mjs <spec> --out <scratchpad>/harden-<slug>-r<N> <find flags> > run.log 2>&1 &`, write `$!` to a pid file, `disown`) and watch the pid
with Monitor — the harness kills tracked background tasks under memory pressure, and macOS has
no `timeout` binary. Then `Workflow({ scriptPath: ".claude/workflows/codex-spec-verify.js",
args: { …, triage: true } })` with the slim index only — **evidence never crosses `args`**.
Split passthrough into find flags (space-separated: `--dims --tier --effort --drift-cap --batch
--concurrency --timeout`) and verify knobs (`--verify --floor --verify-model`) per that skill.

### 2b. Validity — before reading a single finding

Code: `stats.panelValid === true` and `stats.relayFailures === 0`. Spec: exit 0 and
`finderFailures` empty. Anything else is an **invalid attempt**: record it and re-run **the same
round number** — resume the workflow with `resumeFromRunId` so surviving votes are not re-paid.

```bash
node .claude/workflows/harden-state.mjs round --slug <slug> --file <r.json>   # { round, report, valid:false, invalidReason }
```

An `untriaged` bucket that is not empty is a partial failure: resume once to re-run the dead
triage agents; if still untriaged, carry them to the human list, do not guess their bucket.

### 2c. Save the report under the round's name

Write `reportMarkdown` (the workflow appends `## Triage` itself) to the `nextReport` path from
`init`: `.planning/reviews/<slug>.hybrid.r<N>.review.md` or
`.planning/specs/reviews/<slug>.codex-spec.r<N>.review.md`. Never the underlying skill's
un-numbered name — it would overwrite the previous round.

### 2d. The fix wave — from `triage.buckets`, eligible severities only

Eligible = `critical`/`high` (code), `BLOCKER`/`DRIFT` (spec). Everything else goes straight to
the human lists in 2e, whatever its bucket.

1. **Mechanical, one patch at a time.** Apply the attached diff with the Edit tool using the
   removed lines as the exact `old_string`; if it does not match, the patch's punctuation was
   normalized in transit — re-read the file and apply by hand, never "fix" the file's quotes or
   dashes to make a patch match. Run the gates after each patch (code: lint, typecheck, test;
   spec: grep the spec for the touched rule's key terms and reconcile every other statement of
   it — the twice-stated-rule failure of 2026-09-03). A failing patch is reverted
   (`git checkout -- <files>`) and recorded in `notApplied` with the first failing line.
   `--confirm`: ask ONE question first — "Apply all N mechanical patches?" listing titles; a
   subset is fine.
2. **Clear, one at a time, highest severity first.** Read the finding's triage: root cause,
   the **recommended** option (Depth/Cost/Wins-if), ratings, and `patternDetail` — that list is
   the sweep worklist; every location in it is part of this fix. Author exactly the recommended
   option (tests included when it names them). Gates after each; a failure reverts that item's
   files and records it. If, while authoring, the recommended option turns out not to hold, do
   **not** substitute another — that is a fork in disguise: revert, record it in `notApplied`
   with why, and move on. `--confirm`: show root cause + recommended option + ratings, ask y/N
   per item before writing.
3. **Spec lane extras.** Bump the spec's status/revision line if it carries one, and add an entry
   to the spec's own revision log in its own style ("Added in rev N, closing harden round k:")
   if it has one — never invent a log for a spec without one.
4. **Declining is allowed only with a citation.** You may decline an eligible confirmed finding
   on the standalone test (would this be wrong if it were the only place doing it?) with a cited
   deferral or load-bearing reason — record it as `declinedByLoop`. "That's how the siblings do
   it" is never a reason.
5. **One commit per round**, by explicit path (touched files + the round report), never `-A`:
   `harden(<slug>) r<N>: <m> mechanical + <c> clear` with one line per applied finding title in
   the body and the session's attribution trailer. Nothing applied → no commit, `commit: null`.

### 2e. Ledger, then the round record and its verdict

Park what a later round must not re-verify: forks and declines (triage's and yours) go to the
ledger both engines read (`.planning/debug/**/*.deferred.md`):

```bash
node .claude/workflows/harden-state.mjs defer --slug <slug> --file <items.json>   # [{ title, location, kind: declined|fork, reason, round }]
```

Then write the round record (shape in the helper's header: `counts` = CONFIRMED per severity,
`triage` counts, `applied`, `gates`, `commit`, and the `human` lists — `mediums` (or
AMBIGUITY/GAP for a spec), `forks`, `notApplied`, `contested`, `declinedByTriage`,
`declinedByLoop`, `untriaged`) and record it:

```bash
node .claude/workflows/harden-state.mjs round --slug <slug> --file <r.json>
```

The verdict is computed, never chosen: `continue` · `stop: converged` (no eligible findings
remain — mediums do not block it) · `stop: cap reached` · `stop: no progress` (nothing applied,
so a re-review would find the same list) · `stop: gates failed`. A regression (more top-tier
findings than last round) is flagged, not a stop — the next round is the check on the fixes.
`continue` → back to 2a with `nextRound`.

## Step 3 — end state

```bash
node .claude/workflows/harden-state.mjs render --slug <slug>
```

Commit `.planning/harden/<slug>.state.json`, `.planning/harden/<slug>.md` and the ledger as
`harden(<slug>): end state after r<a>–r<b>`. Then report, in this order:

1. The verdict line, and **which panels ran** — code: `Verify: Codex <model>@<effort>, <n>
   voters, relayFailures 0` per round; spec: "Codex found, Claude verified and triaged" — a
   reader comparing rounds to an `/ultrareview` or `/ultraspec` report must know the panel differs.
2. The convergence table.
3. The round commits (`git revert <sha>` undoes one) and, for a `--working` start, the baseline
   commit. Say that nothing was pushed and that `--no-logs` was forced.
4. The needs-you lists verbatim from the render: mediums to fix or explicitly decline, the
   `/decision-walk <last report>` command for the forks, eligible items not applied with their
   reasons, contested, declined (with the ledger path — delete an entry to re-raise it),
   unverified, untriaged.

A run that stopped at the cap with blockers open, or on no progress, is reported as exactly that —
never as "hardened".

## Resuming after a context reset

`node .claude/workflows/harden-state.mjs show --slug <slug>` gives `status`, `nextRound`, and
`nextReport`. A review workflow that was mid-flight is in `/workflows`; resume it with
`resumeFromRunId` rather than starting the round over.

## Known risks

- **A false positive applied as a clear fix.** The cross-model panel lowers the rate (Codex
  killed 4/5 known-false findings Claude's panel had confirmed), the gates catch the loud ones,
  and the next full round re-reviews the fix — but a quiet wrong fix survives until the end-state
  review. Read the applied-titles list in each round commit; that is what the per-round commit
  boundary is for.
- **Suppressed findings.** Everything in the ledger is invisible to later rounds by design. If a
  declined item was a real defect, delete its ledger entry and run again.
- **Cost.** Three full hybrid rounds on a large tree can exceed three hours and burn a real share
  of the weekly Codex window. Say the estimate before starting; `--rounds 1` is a valid way to run
  one review with the apply wave and end state.
