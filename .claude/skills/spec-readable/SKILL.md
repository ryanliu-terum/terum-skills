---
name: spec-readable
description: Turn a dense spec file into a plain-English companion a HUMAN skims to sanity-check it by eye — what it does, the decisions and their why, what's still to build, what's left after shipping, related specs, and a "look here" block flagging the most questionable / most likely to break / hardest / least-clear parts. Writes the companion to .planning/spec_readable/ and prints only the file path. NOT an LLM audit (that's /ultraspec or /codex-spec) and NOT a session recap (that's /state).
---

Rewrite one spec document into a **human-facing companion** whose entire job is to let a
person sanity-check the spec by eye — "does this all look right?" — without decoding the
dense original. The reader is Ryan, reading the spec cold, deciding whether the plan is
sound before implementation starts.

This is **not** `/ultraspec` or `/codex-spec` — those are heavyweight multi-agent adversarial
spec audits that produce verified findings (`/ultraspec` has Claude find and Claude verify;
`/codex-spec` has Codex find and Claude verify). This is **not** `/state` — that reports on
the current *session*.
This retells one *document* in plain words and points the human's eyes at the spots worth a
second look. The judgment block here is impression-level, lightly code-grounded — it says
"check this," it does not adjudicate. If you catch yourself fanning out agents or writing a
severity-ranked findings table, you're writing the wrong skill.

## Governing principle: write for a reader who has NOT read the spec

Every line must make sense cold, to someone who has not read the original and does not know
the codebase's coined vocabulary:

- **No insider shorthand or spec-coined terms.** If the spec invents a phrase ("the D8 rail",
  "the has_audience rule"), spell the idea out in ordinary words the first time.
- **No compressed `X → Y` fragments** that only parse if you already read the spec.
- **Each line stands alone** — a stranger could read just that line and understand it.
- Plain is not verbose: spend the words needed to be clear, then stop.

## Invocation

- `/spec-readable <path-to-spec>` — the path is required. Resolve it relative to the repo
  root if not absolute.
- `/spec-readable` (no path) — do NOT guess. List the 5 most-recently-modified files in
  `.planning/specs/` and ask which one. Then proceed.

## Process

1. **Read the spec in full.** The whole file, not a skim.

2. **Light code peek — anchor, don't audit.** Pull the concrete things the spec names —
   files, functions, routes, migration numbers, flags — and read/grep a handful, *only* to
   ground the "most likely to break" and "hardest to implement" calls in what the code
   actually looks like today. This is a few Reads/Greps, not a fan-out and not an exhaustive
   trace. If the spec names nothing concrete, skip the peek and say the judgment calls are
   from the spec text alone.

3. **Write the companion file** to `.planning/spec_readable/<same-basename>.md` — the output
   basename is identical to the input spec's basename (input
   `2026-07-16-slack-email-match-verified.md` →
   output `.planning/spec_readable/2026-07-16-slack-email-match-verified.md` — the existing
   pair in the repo). Overwrite if it exists. Create the directory if missing.

4. **Print only the written path** to chat — one line, nothing else. No preamble, no summary
   of the summary. The file IS the deliverable.

## Companion file format

Write these sections in order, in the plain voice above. **Omit any section that would be
empty** except the first two. Scale each to the spec's content — a short spec yields a short
companion. Start the file with a top line naming the source spec (`> readable companion to
.planning/specs/<basename>` ) so the pair is obvious.

### 1. What this is

One or two sentences: what the spec builds and who benefits. The single most important lines
— lead with them.

### 2. What it does

The reworded walkthrough — the spec's mechanism in plain terms, **keeping the real detail**
(this is a readability pass, not a compression pass; don't drop specifics the way a summary
would). Walk the actual flow the spec describes. Name the real files/routes/tables, but say
what each one *does* in ordinary words before naming it. This is the bulk of the companion.

### 3. Decisions made

Bullets, each a plain-English decision plus its one-line why (the reason the spec gives, or
the reason that's implicit). This is what the human is really sanity-checking — "do I agree
with these calls?" — so make each decision legible on its own.

### 4. Still to build

The implementation work the spec calls for — a plain checklist of what has to be coded.
Omit if the spec is pure design with no build list.

### 5. After you ship

The loose ends that remain once the code is written: manual steps (apply a migration, flip a
flag, republish the extension), deferred phase-2 items, and Ryan-gated approvals. Terum specs
almost always end with some of these — surface them so they aren't forgotten. Omit only if
there are genuinely none.

### 6. Related specs

Other specs this one connects to. Find them cheaply: what the spec itself references, plus a
grep of `.planning/specs/` for the same topic/feature/migration. One line each: the spec name
and how it relates. Omit if none found.

### 7. Sanity-check flags — where to look hard

The point of the whole companion for a human reviewer: the few spots most worth a second
look. Four items, each one plain-English line plus its rating where noted:

- **Most questionable decision** — the call most likely to be wrong or contested, with a
  questionability rating **X/10** (10 = very questionable) and a one-line why.
- **Most likely to break** — the part of the implementation most likely to fail or cause a
  bug, grounded in the light code peek where possible (say what in the code makes you think
  so). If not code-grounded, say so.
- **Hardest to implement** — the piece that will take the most work or care, and why.
- **Least clear part** — the most ambiguous or under-specified part of the spec, with an
  unclarity rating **X/10** (10 = very unclear) and a one-line why. This is where the human
  should ask the spec author to clarify before building.

Be honest and specific in this block — a hedged "everything looks fine" defeats the skill's
entire purpose. If a spec genuinely is clean, say which single thing is *nearest* to a
concern rather than inventing one.

## Rules

- **Human-facing prose, always.** Plain English, self-contained lines, no insider shorthand.
- **Readability pass, not a summary.** Keep the spec's real detail; the job is to make it
  legible, not shorter.
- **Chat output is the path and nothing else.** The companion file is the deliverable.
- **Anchor, don't audit.** The code peek is a few reads to ground the judgment block — never
  a fan-out. Deep verified review belongs to the spec auditors — `/ultraspec` (Claude finds,
  Claude verifies) or `/codex-spec` (Codex finds, Claude verifies; better when the spec was
  written by Claude) — route there if the human wants it.
- **Don't invent concerns.** Ground the sanity-check flags in the spec and the code peek; if
  nothing is genuinely questionable, name the nearest thing and rate it low, don't fabricate.
