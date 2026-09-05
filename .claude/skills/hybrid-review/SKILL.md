---
name: hybrid-review
description: Cross-model code-diff reviewer. Same 4-dimension review as /ultrareview, but the adversarial verify panel runs on OpenAI Codex instead of Claude, so the verifiers do not share the finders' blind spots. Use when a diff matters enough that a false positive surviving verification would cost real time — live auth/RLS/contract changes, pre-merge gates, or any batch where /ultrareview's findings felt over-confident. Args: same as /ultrareview — [<PR#>] [--working] [--no-fix] [--no-logs] + knobs/presets (--quick|--balanced|--in-depth|--max; --model/--review-model; --efficient/--verify) — except --verify-model, which here selects the Codex tier (sol|terra|luna) rather than a Claude model. Plus --fast (hybrid-only) for Codex Fast mode — a no-op as of 2026-09-04 (no measured speedup on exec or on the interactive app-server path; openai/codex#32191); same model, effort, and panel.
---

Run the multi-agent code-diff reviewer with a **cross-model verify panel**: Claude finds, Codex verifies.

## Why this exists

`/ultrareview`'s verify panel is 3 Claude voters checking findings raised by Claude reviewers.
When all three share a misreading they confirm a false positive — recorded on PR #109, where a
3-vote panel passed five findings that were later shown false. Measured 2026-07-30 on that exact
set: a Codex panel killed **4/5** (four unanimous 0-3) and returned the 5th *contested*, not
confirmed. Claude's recorded score on the same five was **0/5**.

Everything else is identical to `/ultrareview` — same finders, same dimensions, same dedup, same
severity rubric, same report. Only the voters change.

## When to use which

| | `/ultrareview` | `/hybrid-review` |
| --- | --- | --- |
| Verify panel | 3× Claude | 3× Codex (`gpt-5.6-sol` @ `high`) |
| Best for | most diffs; fast iteration | diffs where a surviving FP costs real time — live RLS/auth/contract changes, pre-merge gates, big unreviewed batches |
| Requires | nothing | `codex login status` authenticated |

Reach for `/hybrid-review` when a surviving false positive would cost real time — live
auth/RLS/contract changes, pre-merge gates, or a batch big enough that you would otherwise run
`/ultrareview --in-depth`.

## The standard panel (do not run a thinner one without saying so)

**`gpt-5.6-sol` @ `high` effort · 3 voters · `relayFailures: 0`.** Locked by Ryan 2026-08-04.
A bare `--codex-verify` already resolves to exactly this (tier `sol`, effort fallback `high`,
verify level `full` = 3 votes / 2-to-kill / cap 40) — so **the standard is what you get by NOT
passing preset flags.** `--quick` drops to `medium` and a single voter; `--balanced` to 2 voters;
`--efficient` / `--verify=<level>` to 1-2. The workflow logs `NOTE: OFF-STANDARD hybrid panel` for
any of them (votes < 3, or effort `medium`), and you must repeat it in your summary.

`relayFailures: 0` is part of the standard, not a nice-to-have: a dropped relay is an *absent*
vote, which lowers a finding's vote count and routes it to **contested** — visually identical, in
the report, to a genuine panel split. **Any run with `relayFailures > 0` is an INVALID run, not a
weak one.** Do not adjudicate it, do not summarize its verdicts, do not write its report to
`.planning/reviews/`. Re-run it (see below), then report.

Expect it to be slow. `codex exec` at `high` needs **minutes per vote**, so a full panel over ~15
findings is 45 relay calls and can run well over an hour of wall-clock. That is the cost of the
tool; it is not a hang.

### `--fast` — the one speed lever that stays on-standard

`--fast` appends `-c service_tier="fast"` to every relay's `codex exec`: Codex **Fast mode**, the
priority inference queue (`fast` is the documented alias for the request tier `priority`). Same
model, same effort, same 3 votes — only the queue changes — so the panel keeps its name, the
OFF-STANDARD note does not fire, and the report label becomes `codex:gpt-5.6-sol@high+fast`
(`modeDetail.codex.fast: true`).

What it costs and buys, per OpenAI: **2.5× plan credits** on GPT-5.6 for a claimed **~1.5× token
speed** — not 2×. **Measured 2026-09-04 it bought nothing:** Sol at `high` on a read-heavy
analysis (the shape of a verify vote) ran 263 s / 250 s standard vs 256 s / 305 s fast, and a
generation-heavy task at `medium` 114 s / 97 s vs 108 s / 104 s — identical output throughput
(~40 and ~53 tok/s) in both arms, n=2 each, CLI 0.147.0, plan `pro`.

**Root cause — upstream, not ours, and not `exec`-specific.** The flag is spelled right:
`service_tier = "fast"` is the documented key, it is what the TUI's `/fast on` persists, and the
CLI maps it to the request tier `priority` and validates it against the model catalog (a model
without the tier gets the `not advertised as supported` warning). Wire captures by two other users
(CLI 0.144.x and 0.149.0, ChatGPT auth) show `codex exec` sending `service_tier: priority` plus an
`x-codex-routing-hint … tier=priority` header, every request HTTP 200, and
`response.completed.response.service_tier` coming back `default`. OpenAI's only on-record reply
(pash-openai on [#14204](https://github.com/openai/codex/issues/14204), 2026-03) is that Fast "is
handled by Codex routing logic server-side", so that `default` "does not mean Fast was ignored" —
which makes **timing the only test that counts**. Timed 2026-09-04 on this account (Pro) with a
fixed ~3,050-token output on Sol: `codex exec` on CLI 0.147.0 and 0.153.3, and the app-server path
the desktop app and IDE use (once identifying as the VS Code extension, once as an unknown client)
— 16 runs, every one 57–60 s, fast never more than 2% ahead of standard. Other users' 3-vs-3 A/B:
57.4 s vs 57.5 s. So the missing speedup is not a headless quirk; on this account Fast mode
delivers nothing on any surface we can drive. Tracked as
[openai/codex#32191](https://github.com/openai/codex/issues/32191) and
[#30413](https://github.com/openai/codex/issues/30413), open since 2026-07 with no maintainer
reply; the [speed docs](https://learn.chatgpt.com/docs/agent-configuration/speed) list the desktop
app, CLI, and IDE extension and never mention `exec`. (The "2x speed" figure in the catalog belongs
to GPT-6 Astra's Fast tier, not GPT-5.6's, which says 1.5x.) Whether a Fast request that runs at
standard speed still bills 2.5× is unverified. So today `--fast` is a **no-op**: the workflow logs
`NOTE: --fast requests Codex Fast mode … Expect standard speed` whenever it is used. Keep it off;
re-time when #32191 closes or the catalog's tier description changes.
Fast mode needs ChatGPT Plus/Pro auth (Ryan's plan is `pro`; accepted on `gpt-5.6-sol`
2026-09-04, CLI 0.147.0, no warning). Reach for it when someone is waiting on the gate; leave it
off by default — a 45-relay panel at 2.5× is a real bite out of the weekly Codex window, so with
`--fast` read the plan window first (the `rate_limits` grep in `/codex-implement` preflight 6)
and apply its gate: weekly ≥ 80% used → say so and let the user pick standard speed.

Two things do NOT change under `--fast`: the **10-minute relay timeout** (fast trims a vote, it
does not bound it — a shorter timeout is the 2026-08-05 regression again) and the
`relayFailures: 0` rule. And one silent failure to know: on a model that does not advertise the
tier, Codex prints `warning: Configured service tier … is not advertised as supported … and will
be omitted from requests` on stderr and runs at **standard** speed with exit 0. The relay sends
stderr to `/dev/null`, so such a panel is indistinguishable from a standard one in the report.
All three selectable tiers (`sol|terra|luna`) advertise it today, so this only matters if
`CODEX_MODELS` ever changes.

### The relay timeout (the failure this standard exists to prevent)

Each Codex vote is shelled out by a thin Claude relay agent via the Bash tool, whose default
timeout is **120 s**. At `high` effort `codex exec` blows straight through that, and the relay
reports `RELAY_FAILED`. Measured on the first real run (2026-08-05): **17 of 21 votes killed**,
producing a report that read like a normal contested/confirmed spread.

Fixed in `ultrareview.js` — `RELAY_TIMEOUT_MS = 600000` (10 min, the Bash tool's documented
maximum) is now interpolated into the relay prompt as a MANDATORY instruction. If you ever see
`RELAY FAILED` in the log again, check that the relay agent actually passed `timeout: 600000` to
Bash before blaming Codex; a relay that quietly used the default is the regression to look for.

## Step 0 — resolve the review target

**Identical to `/ultrareview`.** `$ARGUMENTS` may be canonical flags or natural language; the
workflow parser is deliberately dumb and silently falls back to branch-vs-`main` for anything it
does not recognize, so translate intent → canonical args here rather than passing free text.

| User intent (any phrasing) | Canonical arg |
| --- | --- |
| a specific GitHub PR ("PR 109", "review 109 from the remote") | the bare number, e.g. `109` |
| uncommitted/staged work ("my working tree", "uncommitted edits") | `--working` |
| this branch's full diff ("branch vs main", "everything since main") | (no positional arg) |
| + skip patch proposals ("just the report") | add `--no-fix` |
| + skip bug logs | add `--no-logs` |

- A PR target needs an actual digit token. If unclear which PR, ASK — do not guess.
- Empty `$ARGUMENTS` → no args (branch vs `main`).
- **Non-empty but unmappable → STOP and ask one clarifying question.** Do not let it slide into
  the branch-vs-`main` fallback; that reviews the wrong diff and the result looks clean.

## Step 0b — preflight Codex (do this BEFORE invoking the workflow)

```bash
codex login status
```

If it does not report a logged-in account, **STOP** and tell the user to run `! codex login`
themselves. Do not fall back to `/ultrareview` silently — the user asked for a cross-model panel,
and a same-model panel wearing its name is exactly the false-confidence this tool exists to
prevent. Offer the fallback, let them choose.

## Step 1 — invoke

```
Workflow({ scriptPath: ".claude/workflows/ultrareview.js",
           args: "<resolved canonical args + knob/preset flags> --codex-verify" })
```

There is no separate `hybrid-review.js`: this is `/ultrareview` plus `--codex-verify`. One script,
two entry points — a forked copy of the 130-line knob preamble would drift within a week (the team
decision to keep that preamble byte-identical across reviewer scripts is why).

> Use **scriptPath, not `name`** — by-name invocation shows the script in the approval dialog and
> trips the Windows control-char/CRLF guard.

### Model flags in hybrid mode

- `--verify-model=<sol|terra|luna>` → the **Codex** tier (`gpt-5.6-sol` / `-terra` / `-luna`).
  Default `sol`. It no longer takes `opus|sonnet|haiku|fable` — the verifier is not a Claude model.
- Reasoning effort rides the preset: `quick` → `medium`, `balanced`/`--in-depth` → `high`,
  `--max` → `xhigh`. **Bare invocation → `sol` at `high` with 3 votes — the standard.** Anything
  that lowers the vote count lands below it: `--quick` (1 vote @ `medium`), `--balanced` (2 votes
  @ `high`), `--efficient[=level]` (1-2), and `--verify=conservative|balanced|aggressive` (2/1/1).
  `--in-depth` (3 @ `high`) IS the standard; `--max` (3 @ `xhigh`) is above it. The workflow logs
  `NOTE: OFF-STANDARD hybrid panel` whenever votes < 3 or effort is `medium`, and at 1 vote the
  report also carries a `! LOW-CONFIDENCE PASS` banner — repeat both when you report.
  `ultra` is deliberately unreachable — it delegates to Codex's own subagents, and nondeterministic
  sub-fan-out inside a deterministic vote panel defeats the point of a vote panel.
- `--model` / `--review-model` / `--fable-review` still take Claude models and apply to the Claude
  stages (manifest / review / dedup / synthesize). The workflow prints a NOTE if `--model` is set,
  so it never silently reads as if it steered the verifier.
- `--fast` → Codex Fast mode on every relay (§ `--fast` above). Hybrid-only: from `/ultrareview`
  the script logs `NOTE: --fast ignored` and runs unchanged.

## Step 2 — handle the result

**Identical to `/ultrareview` steps 1-7** (report to `.planning/reviews/<target>.review.md`,
inline summary, adjudicate with the standalone test, auto bug-logs for confirmed
**critical/high/security** findings, print `proposedFix` under a "NOT YET ADJUDICATED" heading
without applying). Follow `.claude/skills/ultrareview/SKILL.md` for those steps verbatim — do not
re-derive them; the auto-log threshold and the fix-proposal defaults live there and must not drift.

Defaults worth stating because they are opt-OUT, not opt-in: **fix proposals run by default**
(`--no-fix` skips; they are never applied without your explicit confirmation, and are skipped
automatically on an un-checked-out PR), and **auto bug-logs run by default** for confirmed
critical/high/security findings (`--no-logs` skips). Confirmed medium/low findings are
deliberately not logged — hand one to `/single-fix` and it writes its own log on demand.

Two additions specific to this mode:

1. **Check `stats.relayFailures` FIRST — before reading a single finding.** `relayFailures` must
   be `0` and `stats.panelValid` must be `true`. Anything else is an invalid run: the report
   carries an `! INVALID PANEL` banner, and you report **that**, not its verdicts.

   To re-run without re-paying for the votes that DID survive, resume from the same run rather
   than starting over:

   ```
   Workflow({ scriptPath: ".claude/workflows/ultrareview.js", args: "<same args>",
              resumeFromRunId: "<runId from the failed run>" })
   ```

   Every unchanged agent call before the first failure returns from cache instantly; only the
   killed relays re-execute. If you edited the script between runs (e.g. the timeout), the cache
   invalidates from that call onward — which is correct, that is the call you wanted re-run.

2. **Say which panel ran.** State `Verify: Codex <model>@<effort>[+fast], <n> voters, relayFailures <n>`
   in the summary — all four numbers, plus `+fast` whenever `--fast` was passed, every time. A reader
   comparing this report to an older `/ultrareview` run on the same diff needs to know the
   verifiers changed, or they will read a difference in confirmed-count as a change in the code.

## Known risk to watch

The relay agent is instructed to return Codex's JSON verbatim and never substitute its own
judgment. If you ever see a `reason` that reads like Claude prose rather than a quote from the
code — or a verdict that contradicts what `codex exec` printed — the relay is editorializing and
the panel is no longer cross-model. That is the one failure mode that would make this tool lie
about what it is, so it is worth a spot-check on the first real run.
