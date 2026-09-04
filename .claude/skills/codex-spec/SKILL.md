---
name: codex-spec
description: Cross-model spec auditor. Same four dimensions as /ultraspec (cross-spec drift, spec-vs-code reality, internal quality, build-readiness), but the FINDERS run on OpenAI Codex and the adversarial verify panel runs on Claude — the mirror image of /hybrid-review. Use when a spec was written by Claude and you want it reviewed by something that does not share the author's blind spots, especially before handing it to /codex-implement. Args: <path-to-spec> [--dims <list>] [--tier sol|terra|luna] [--effort <level>] [--verify full|conservative|balanced|aggressive] [--drift-cap N] [--batch N] [--concurrency N] [--timeout <ms>].
---

Audit a planning spec with **Codex finding and Claude verifying**.

## Why this exists

`/ultraspec` has Claude write the findings and Claude verify them. The specs it reviews were
*also* written by Claude. That is one lineage doing all three jobs, and it leaks on the axis that
fails silently: a reviewer sharing the author's blind spots does not raise a bad finding, it raises
**no** finding, and an empty result is indistinguishable from a clean spec.

Measured 2026-08-01 on `2026-06-24-layer0-identity-spine-buildout.md`, blind (pinned worktree, the
existing review file absent), one agent per dimension on each side. Codex surfaced four substantive
defects Claude's run had never raised in *any* bucket — confirmed, contested, or unverified:

- the identity-claim route had **no authorization or replay contract** specified;
- the delivery trust bar's "a wrong match … never a content leak" premise is **false**, and that
  false premise is what licensed dropping the `verified` filter;
- "no migration to gate" contradicted a staged-not-applied migration;
- the source-isolation rule contradicted the Path A implementation it prescribes.

The first one was confirmed load-bearing by the code: `app/api/surfaces/identity-claim/route.ts`
contains every guard the spec omitted — notification-ownership (`:43`), payload match (`:50`),
`terum_user_id` rejection (`:80`), dismiss-after-merge (`:115`). An independent implementer read
the same spec and concluded the contract was necessary. **It was a real requirement the spec left
to discretion**, which is exactly the class a same-lineage reviewer cannot see.

Also measured: across **7** `/ultraspec` reports carrying a counts table, confirmed AMBIGUITY = 0
and confirmed GAP = 0, every time. Those dimensions could not reach verification at all — severity
ranking plus a shared cap meant drift and reality took every slot. This tool applies a
per-dimension floor so that cannot happen.

## When to use which

| | `/ultraspec` | `/codex-spec` |
| --- | --- | --- |
| Finders | Claude | **Codex** (`gpt-5.6-sol`) |
| Verifiers | Claude | Claude |
| Best for | everyday spec audits; drift-heavy specs with many siblings | a Claude-written spec before build, anything heading to `/codex-implement`, security-shaped specs where an unstated contract is the risk |
| Requires | nothing | `codex login status` authenticated |

They are complements, not replacements. Run both on a spec that matters — the finding sets overlap
only partially.

## Step 0 — preflight

```bash
codex login status
```

Not logged in → **STOP** and tell the user to run `! codex login` themselves. Do not silently fall
back to `/ultraspec`: the user asked for a cross-model audit, and a same-model run wearing this
name is the exact false confidence this tool exists to prevent.

Resolve `$ARGUMENTS` to a spec path. If no `.md` path is given, ASK — do not guess which spec.

## Step 1 — find (Codex)

```bash
node .claude/workflows/codex-spec-find.mjs <spec-path> --out <scratchpad>/codex-spec-<basename> [flags]
```

Run it from the repo root. **Run it in the background** (`run_in_background: true`) — a full run is
15+ Codex calls and routinely exceeds the foreground Bash timeout. A bounded default run on a
158-line spec took ~9 minutes at `--effort high`.

Flags: `--dims drift,reality,quality,readiness` · `--tier sol|terra|luna` · `--effort <level>` ·
`--drift-cap N` (default 8) · `--batch N` artifacts per reality reviewer (default 8) ·
`--concurrency N` (default 6) · `--timeout <ms>` per call.

All values are **space-separated** — the parser matches a flag by exact token
(`argv.indexOf('--effort')`), so `--effort=high` is silently ignored and the default is used.
(`.claude/commands/codex-spec.md`'s example currently uses the `=` form and should be fixed.)

It writes `findings.json` plus each reviewer's raw output. **Read the run's summary, not the
findings file** — you do not need the findings in context, and keeping them out is the point.

## Step 2 — check coverage BEFORE reading results

Look at `finderFailures` in the summary. A failed reviewer removes an entire dimension, and a
report missing a dimension reads as a clean spec. If any reviewer failed, say so explicitly in your
summary and treat the run as **incomplete, not clean**. Re-run rather than reason about it.

Separately, check the exit. A non-zero exit (`FATAL:` in the output) means **no `findings.json`
was written at all** — the manifest call failed, Codex could not read the spec, or every reviewer
failed (that last one usually means `codex login status`). Fix the cause and re-run; do NOT proceed
to Step 3, which would hand the verify agents a `findingsPath` that does not exist — the workflow
only checks the arg is non-empty, not that the file is there.

## Step 3 — verify (Claude)

```
Workflow({ scriptPath: ".claude/workflows/codex-spec-verify.js",
           args: { specPath, findingsPath, specTitle, generatedBy, finderFailures,
                   index: [{ i, dimension, severity, title }, …],
                   verify: "conservative" } })
```

Build `index` from `findings.json` — one entry per finding, in order, carrying **only** `i`,
`dimension`, `severity`, `title`.

> **Never put `evidence` or `suggestion` in `args`.** The verify agents read them from
> `findingsPath` themselves. Evidence quotes the spec and must match it byte-for-byte to be
> checkable, and a model asked to copy a finding array verbatim rewrites it — measured 2026-08-01:
> 26 of 26 curly quotes converted to ASCII despite an explicit instruction to preserve them, while
> dashes, ellipses, `§` and `Δ` survived. That is quote normalization, and quotes are what evidence
> is made of. Passing the findings inline would put *you* in that copy path.

Knobs: `verify` (`full` 3-vote / `conservative` 2-vote / `balanced` and `aggressive` 1-vote — the
cap and the per-dimension floor move with it: 30/4, 20/3, 12/2, 8/1), `floor` (verify slots
guaranteed to each of the three non-drift dimensions), `driftFraction` (drift's max share of the
cap, default 0.5), `verifyModel`, `model`.

## Step 4 — report

1. Write `reportMarkdown` to `.planning/specs/reviews/<basename>.codex-spec.review.md`. The
   `.codex-spec.` infix matters — it must not overwrite an `/ultraspec` report on the same spec;
   comparing the two is a large part of the value.
2. Inline summary: the severity-count table (CONFIRMED only) and `topFindings`.
3. **State that the finders were Codex and the verifiers were Claude.** A reader comparing this to
   an `/ultraspec` report on the same spec must know the panel changed, or they will read a
   difference in confirmed counts as a change in the spec.
4. Surface `contestedFindings` (panel split — needs human adjudication) and `unverifiedFindings`
   (beyond the cap). Never fold either into the counts.
5. If `mode.votes < 2`, say plainly that findings were single-verifier checked and are not a trust
   gate.
6. Report the saved path.

Do not apply any suggested fix without explicit confirmation.

## Known risks to watch

- **Absence claims.** Codex asserting "this table/route/migration doesn't exist" is the most common
  way a spec finding is wrong. The rules file tells it to grep by content first, and the verify
  prompt tells the panel to re-prove absence. If a confirmed finding rests on an unproven absence,
  it survived two guards that were meant to catch it — check it by hand before acting.
- **Forward-looking specs.** "Not built yet" is a spec's normal state, not a defect. Both the
  finder rules and the verify checklist say so. A report full of GAPs whose substance is "unbuilt"
  means that rule is not landing, and the prompts need tightening rather than the spec.
- **Codex does not auto-load `CLAUDE.md`.** Every reviewer prompt points it at
  `.claude/workflows/codex-spec-find-rules.md`, whose MANDATORY FIRST STEP routes it to
  `AGENTS.md` (repo root) *and* to the per-directory `CLAUDE.md` that owns any file it cites
  (`app/`, `app/api/surfaces/`, `lib/`, `lib/teamwork/`, `extension/`, `supabase/migrations/`);
  `AGENTS.md` adds root `CLAUDE.md` on top. So a `CLAUDE.md` invariant is reachable — but only via
  an instruction the model has to follow, not via the harness. If a whole class of finding is
  missing, check whether its rule is reachable from that routing table before concluding Codex is
  blind to it.
