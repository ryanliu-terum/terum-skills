---
name: single-fix
description: Triage a single bug through the 4-question diagnosis workflow. Auto-fixes trivial/safe/isolated bugs inline with commit. Escalates everything else with a detailed explanation and pattern search.
---

Single-bug triage and (conditionally) fix pipeline. The user has already found the
bug and describes it when invoking this skill. You diagnose, assess, and either fix
inline or brief the user.

**In the Terum MVP repo, load the domain knowledge before triaging** (don't rely on
topic auto-invocation — summon these explicitly): `terum-debugging-playbook` for the
known failure signatures, `terum-visibility-and-privacy` before touching any
cross-user/team read, and — once you land on a fix — `terum-change-control` for how it
gets gated/committed and `terum-validation-and-qa` for what counts as passing. If the
bug is in the relevance/scorer path add `terum-domain-reference`. When the symptom is a
runtime/data state (a stale chip, a wrong count, a frozen table, works-locally-fails-in-prod)
rather than a visible code defect, also load `terum-diagnostics-and-tooling` to MEASURE it
(read-only prod query, `job_failures`, a JWT for curl) before asserting a root cause — see
Phase 1 Question 0.

**Bug-log format is governed by `.planning/debug/CONVENTIONS.md`** — logs live in a per-group
subfolder (`.planning/debug/{group}/bug-NNN-slug.md`, where `{group}` is a current `BUG-GROUPS.md`
slug), require YAML frontmatter whose `group:` matches the folder, and use the filename suffix as
the single authoritative status signal (bare `.md` = open, `.deferred.md` = consciously-deferred
tracked debt, `.resolved.md` = resolved). Read it before writing or resolving any log; the
templates below conform to it.

## Entry

The bug is already identified — you are NOT discovering it. Check for the bug
in this order:

1. **Conversation context** (default) — the bug was described or surfaced in a
   prior message in this session. A code review finding, a symptom the user
   reported, an error they pasted, or a discussion that identified an issue.
2. **Inline description** — the user included a bug description with the
   `/single-fix` invocation.
3. **Existing bug log** — the user references a bug number (e.g., `/single-fix
   bug-068`). Read the log from `.planning/debug/` instead of creating a new one
   (skip Phase 0 Steps 1-4, go straight to Phase 1). If the referenced log is a
   `.deferred.md` (consciously-deferred debt), don't silently re-triage it — confirm
   the user means to un-defer it (rename `.deferred.md` → `.md`) before fixing.

---

## Phase 0: Bug Log

Create the bug log IMMEDIATELY, before any diagnosis. This is non-negotiable.

### Step 0 — Check for an existing log (dedup)

The Entry check only catches a bug number the user typed — not a symptom handed to
you in prose. Before minting a new number, grep existing logs for the same
root-cause area (search by the likely source files from your read of the
description, plus 2-3 distinctive symptom keywords):

```bash
grep -rli "<symptom keyword>" .planning/debug --include='*.md'
grep -rl  "<likely/source/file.ts>" .planning/debug --include='*.md'
```

Scan across `.md`, `.deferred.md`, and `.resolved.md`. If an **open** or
**deferred** log plausibly matches the same bug, STOP — do not create a duplicate.
Switch to Entry mode #3: read that log, confirm with the user it is the same issue
(for a `.deferred.md`, confirm the un-defer), and go straight to Phase 1 against it.
Only continue to Step 1 if nothing matches.

### Step 1 — Next bug number

```bash
git fetch origin && NNN=$(bash scripts/next-bug-number.sh)
```

**NEVER hand-scan with `find`/`grep`/`ls`** — a local scan sees only this worktree and reissues a
number already live on another ref (root `CLAUDE.md`, `.planning/debug/CONVENTIONS.md`
§Numbering; this is the 2026-06-18 41-number renumber and bug-494). The script maxes over
`git log --all` + every ref's tree (`ls-tree`) + the working tree + a local mutex, then +1,
zero-padded to 3 digits. It **MUTATES** `.bug-counter` — run it only when actually claiming a
number, never "to check".

**Before committing the log, re-check the shared refs** (CONVENTIONS.md §Filename) — matching on
the slug as well as the number is what catches a split bug:

```bash
git fetch origin && git for-each-ref --format='%(refname)' refs/remotes/origin \
  | xargs -I{} git ls-tree -r --name-only {} -- .planning/debug/ | grep -E "bug-$NNN-|<your-slug>"
```

### Step 2 — Identify files

From the user's description, identify the most likely source files. Read them to
confirm. These become the bug's `files` list.

### Step 3 — Assign group

Read `.planning/debug/BUG-GROUPS.md` and match the bug's files to the appropriate
group. Parse the group definitions from the file's tables — do not hardcode group
names or file mappings. BUG-GROUPS.md is the single source of truth for which
files belong to which group.

**Group names.** BUG-GROUPS.md's live groups are named slugs only — `extension`,
`ingest-integrations`, `surfaces-pipeline`, `capture-cli`, `dashboard-spa`. Use one of those five
verbatim in `group:` and as the folder; the numbered scheme (Group 1/2/3/4) is retired and
survives only in BUG-GROUPS.md "Group history" for reading OLD logs. When reading a legacy log,
note that old Group 4 was **split per-log**, not renamed: BFF / auth / memory-route / contract
bugs → `surfaces-pipeline`; SPA-rendering / map-physics / progress-bar / sign-in-flash bugs →
`dashboard-spa`. Old `standalone` → `capture-cli`. Old Group 2 (FastAPI memory service) was
deleted — it has no live owner.

If ambiguous, pick the group that owns the root-cause file (not the symptom file).
If a file appears in the overlap section, assign to the group listed as owner.

### Step 4 — Write bug log

Write to `.planning/debug/{group}/bug-{NNN}-{slug}.md` (in the matching group folder) in the
canonical format (`.planning/debug/CONVENTIONS.md`):

```markdown
---
bug: {NNN}
slug: {slug}
title: {one-line plain-English description}
group: {group}
severity: {critical|high|medium|low}
status: open
found: {YYYY-MM-DD}
files:
  - {file1}
  - {file2}
---

# Bug {NNN}: {short title}

## Symptom

{What the user reported or what you observed}

## Root cause

{Populated after Phase 1 diagnosis — leave as "Under investigation" for now}

## Fix

{Populated when the fix lands — leave as "Pending" for now}

## Files

- `{file1}`
- `{file2}`
```

`group` must be a current `BUG-GROUPS.md` slug (never a number) AND the file must live in the
matching `{group}/` folder. Do NOT add a taxonomy-disclaimer blockquote or a body `**Status**:` line.

---

## Phase 1: Diagnosis (no code changes)

Read the relevant source files. Do NOT write any code. First classify the symptom
(Question 0), then answer the four diagnosis questions.

### Question 0 — Code defect or runtime state?

Is the symptom something you can see in the code/diff (a code-review finding), or a
runtime/data state you can only confirm by looking at real data (stale source, wrong
count, frozen derived table, prod-only failure)?

- **Code defect** → proceed; reading the source is enough to answer Questions 1-4.
- **Runtime/data state** → gather evidence FIRST (the DB/integration row, `job_failures`,
  logs, whether the account is still connected, prod vs local) via
  `terum-diagnostics-and-tooling`. Do NOT assert a root cause from code alone. If the
  symptom is account/env-specific and that is unstated, ASK which account and prod-or-local
  before diagnosing. Only then answer Questions 1-4 — and note this is where a "Not a bug?"
  often resolves (e.g. stale simply because there is no new activity or the account
  disconnected).

### Question 1 — Root Cause

What exactly causes this bug? Identify:
- The specific file, function, and line
- WHY the current code produces the wrong behavior
- What the correct behavior should be
- A potential fix (describe, don't implement)

### Question 2 — Difficulty

How hard is this to fix?

- **trivial**: ~1-10 line change, mechanical fix. Examples: wrong field name,
  missing null check, incorrect boolean, wrong enum, off-by-one, missing await,
  swapped args, typo in string key.
- **moderate**: 10-50 lines, needs design thought, or touches multiple
  functions/files in a coordinated way.
- **hard**: Architectural change, unclear fix boundary, needs new abstractions,
  or the "right fix" is debatable.

State the proposed fix and why you chose this difficulty level.

### Question 3 — Risk

Could this fix introduce a NEW bug or delete working functionality?

- **low**: Changes a single expression or adds a missing check. No callers
  affected. No behavior change for non-buggy inputs.
- **medium**: Few callers but they need verification. Fix is additive but
  touches shared code.
- **high**: Multiple callers, shared state, removes/restructures existing code
  paths, or subtle ordering/timing invariants.

State specifically what could go wrong.

### Question 4 — Pattern Scope

Is this a one-off or does the same root cause exist elsewhere?

- **isolated**: This specific code path, this specific bug. Fixing here is complete.
- **pattern**: The same mistake/omission likely exists in other places, OR this
  reveals a deeper issue that should be addressed as a group.

If pattern: name what the pattern is and where else it might appear.

### Not a bug?

If diagnosis reveals the code is actually correct — the reported symptom is
expected behavior, a misunderstanding, or already fixed — exit cleanly:

1. Update the bug log with the finding: "Not a bug: {explanation}"
2. Set frontmatter `status: resolved` and add `resolved: {YYYY-MM-DD}`, then rename
   `bug-{NNN}-{slug}.md` → `bug-{NNN}-{slug}.resolved.md` (filename + frontmatter must agree)
3. Report to the user: "Investigated bug {NNN}: not a bug. {one-line reason}"
4. Stop. Do not proceed to Phase 2.

### Update bug log

After answering all 4 questions, update the bug log's Root cause section with
the diagnosis from Question 1.

---

## Phase 2: Gate Decision

Evaluate the auto-fix gate. The three conditions must ALL be true:

```
auto_fix = (difficulty == "trivial") AND (risk == "low") AND (scope == "isolated")
```

Commit to the ratings from Phase 1 BEFORE evaluating the gate. Do not adjust
ratings to hit a desired outcome.

### If gate PASSES → proceed to Phase 3A immediately. No checkpoint needed.

### If gate FAILS → checkpoint

Present the assessment and ask the user how to proceed:

```
Bug {NNN}: {title}

  Difficulty: {rating} — {one-line reason}
  Risk:       {rating} — {one-line reason}
  Scope:      {rating} — {one-line reason}

  Gate: FAIL — {which conditions failed}
  Recommended: escalate with full briefing
```

Options:
- **escalate** (default) — produce the Harvard-freshman briefing + pattern search
- **fix anyway** — user accepts the risk, proceed to auto-fix
- **stop** — halt, keep the bug log, user will handle manually
- **defer** — the finding is real but consciously not fixed now (typically a calcified
  convention whose correct fix is a sweep out of scope here). Rename `bug-{NNN}-{slug}.md` →
  `bug-{NNN}-{slug}.deferred.md`, set `status: deferred`, and add the two REQUIRED frontmatter
  fields: `why_deferred:` (one line, including the standalone-test verdict — "would this be
  wrong as the only occurrence?") and `sweep_scope:` (the sibling call-sites the sweep must
  fix). See CONVENTIONS.md §Deferred.

Wait for the user's response before entering Phase 3A or 3B.

---

## Phase 3A: Auto-Fix (gate passed, or user override)

Auto-fix conditions met (or user chose "fix anyway"). Fix the bug inline.

### Step 0 — Baseline test

Run the group's scoped test BEFORE making any changes. If tests are already
failing, the fix's test results are ambiguous — warn the user and ask whether
to proceed.

### Step 1 — Verify

Re-read the root cause location. Confirm the diagnosis is still accurate against
the current code.

### Step 2 — Test

Write ONE failing test that reproduces the bug. Run it to confirm it fails.
If untestable (UI-only, config, race condition): note why and skip.

### Step 3 — Fix

Implement the fix. Keep it minimal — no refactors, no cleanup, no features.

### Step 4 — Verify fix

Run the test. Must pass. Then run the group's scoped test from the table below —
BUG-GROUPS.md carries test-file **ownership** lists (which tests belong to which group), not
test commands; this table is the source for the commands:

| Group | Test command |
|---|---|
| `extension` | `npx vitest run __tests__/extension/` |
| `ingest-integrations` | `npx vitest run __tests__/api/ __tests__/lib/` |
| `surfaces-pipeline` | `npx vitest run __tests__/api/ __tests__/lib/` — **plus, if the fix touches `lib/dashboard/contracts/**`, `cd lib/dashboard/contracts && npm test`** (its own vitest; the root suite and the path filter above both miss it) |
| `dashboard-spa` | `cd {dashboard_path}/Terum-Dashboard && npx vitest run` |
| `capture-cli` | `cd C:/dev/Terum/terum-capture && .venv/Scripts/python -m pytest -q` |

For `capture-cli`, build the venv once first (it's gitignored) — see BUG-GROUPS.md "Worktree setup":
`py -3.10 -m venv .venv && .venv/Scripts/python -m pip install -e . pytest`
(Python 3.10+ via the Windows `py` launcher; system `python3` is too old. pytest is NOT a declared
dependency.) Verified baseline: 28 passed.

### Step 5 — Self-Validation

Before committing, independently verify the fix. Re-read your own diff and check:

```bash
git diff --stat
git diff
```

**Scope check**: >50 source lines changed (excluding tests) = scope creep.
Remove unrelated changes before proceeding.

**Deletion check**: If you deleted any exported functions, event listeners, or
route registrations, grep the codebase for live callers (excluding test dirs
and the modified file). If callers exist, STOP — revert the deletion and
reconsider the fix.

**Log-only check**: If ALL your added lines are `console.log`/`console.error`
calls with no behavioral change, this is not a fix. Revert and escalate.

**Runtime check**: Verify your changes are valid for the group's runtime:
- `extension`: content + popup scripts (`src/capture/*.js`, `src/content-bridge.js`,
  `src/content-announce.js`, `src/popup/*.js`) are CLASSIC scripts — no `import`/`export`. The
  service worker `src/background.js` and everything it pulls from `src/lib/*.js` ARE ES modules
  (`manifest.json` → `"type": "module"`) — imports there are correct; do not strip them. Also
  confirm you edited the `.js`, never a `.ts` sibling (invariant 8).
- `surfaces-pipeline`/`ingest-integrations`: `npm run typecheck 2>&1 | head -30` (=
  `tsc -p tsconfig.typecheck.json`, the same config CI and `.githooks/pre-push` use). Never bare
  `npx tsc --noEmit` — it pulls stale `.next/` generated types and invents phantom errors that
  get wrongly dismissed as pre-existing (bug-452).
- `dashboard-spa`: `cd {dashboard_path}/Terum-Dashboard && npx tsc --noEmit 2>&1 | head -30`
- `capture-cli`: `cd C:/dev/Terum/terum-capture && .venv/Scripts/python -m py_compile src/terum_capture/*.py` (Python 3.10+; build `.venv` first if absent)

If any check fails, fix the issue or escalate if the fix is no longer trivial.

### Step 6 — Commit

One bug, one commit. Scope is the bug group when the fix is group-shaped, otherwise the domain
scope the surrounding history already uses (`briefing`, `security`, `jobs`, `ci`, `eval`, …) —
match `git log --oneline -30`:

```
fix({scope}): {description} (bug-{NNN})

Root cause: {one sentence}
```

Put the bug number in the subject so it's greppable against the log. No Co-Authored-By (note:
the harness adds one by default; strip it).

### Step 7 — Resolve bug log

Update the bug log: add the fix details, flip frontmatter `status: open` → `status: resolved`
and add `resolved: {YYYY-MM-DD}`, then rename (filename + frontmatter must agree — never one
without the other):

```bash
mv .planning/debug/{group}/bug-{NNN}-{slug}.md .planning/debug/{group}/bug-{NNN}-{slug}.resolved.md
```

### Step 8 — Report

Brief summary to the user:

```
Fixed bug {NNN}: {title}
  Root cause: {one sentence}
  Fix: {what changed}
  Commit: {sha}
  Test: {test file or "skipped: {reason}"}
```

---

## Phase 3B: Escalation (gate failed)

One or more conditions failed. Do NOT write any code. Instead, produce a detailed
briefing for the user.

### Escalation Briefing Format

Write this as if explaining to a Harvard freshman studying CS — someone with Python
experience and basic programming concepts, but no familiarity with this specific
codebase, its architecture, or the web stack (Next.js, Supabase, Chrome extensions).

**Structure:**

```markdown
## Bug {NNN}: {title}

### What's broken

{Plain-English explanation of what a user would experience. No jargon.
"When you do X, Y happens instead of Z." If it's a security issue, explain
what an attacker could do and how.}

### Why it's broken

{Walk through the code path that causes the bug. Name the file and function,
but explain what that code DOES in plain terms before explaining what's wrong
with it. Use analogies if they help.

Example: "Think of `conversation-linker.ts` as the part of the system that
figures out which of your conversations are related to each other. It does
this by comparing embeddings (numerical fingerprints of each conversation's
content). The bug is that these fingerprints arrive as text strings instead
of number arrays, so the comparison function gets confused and says nothing
is related to anything."}

### Why this wasn't auto-fixed

{Which of the three conditions failed and why:}
- Difficulty: {rating} — {reason}
- Risk: {rating} — {reason}
- Scope: {rating} — {reason}

### How confident I am in the diagnosis

{This is a SEPARATE judgment from which fix is better. "Recommended" has historically
fused "this is the better fix" with "I understand this bug" — when a recommendation is
wrong, it is more often the second. Split them:}

- **Confidence the root cause is correct**: {high | medium | low}
- **What would falsify it**: {one specific, checkable observation that would prove the
  diagnosis wrong — a log line, a query result, a test that should fail but doesn't.
  "Nothing" is not an acceptable answer; if you genuinely cannot name one, the confidence
  is low, not high.}
- {If medium or low — **Check this first**: the one thing to verify before choosing an
  option. A wrong root cause makes the entire options section worthless, so this
  outranks the fix decision.}

**What I don't know that would change the answer.** List 2-4 facts you cannot establish
from the diagnosis but that different options depend on, each with an honest probability.
These are not hedges — each one must be a claim Ryan can contradict from knowledge you
don't have. Number them; the options section references them by number.

| # | Uncertain fact | P(true) |
|---|---|---|
| U1 | {e.g. "a person legitimately holds two same-source ids (own old account) rather than this only arising from a wrong merge"} | {0.0-1.0} |
| U2 | … | … |

**Cheapest resolving observation**: {the single query, test, log line, or one-off script
that would most collapse the uncertainty above — concrete enough to run. Name which U it
resolves. If one cheap observation would settle the whole decision, say so plainly and
recommend running it BEFORE choosing.}

### Options for fixing

**Score every option BEFORE writing any prose and BEFORE picking a recommendation.**
The recommendation is the arithmetic winner, not a prior conclusion the scores are fitted
to. Ordering options "by recommendation" and then attaching numbers produces scores that
only re-encode the order you already chose — they carry no information and make a wrong
call look measured.

#### Two numbers. NEVER summed.

**Depth (0-4)** — how much of the problem the fix actually removes:
- `0` — masks the symptom; the broken mechanism is untouched
- `1` — buys headroom (bigger cap, longer timeout, more retries); the same bug recurs later
- `2` — removes the coupling at this call-site
- `3` — removes the coupling here AND sweeps the known sibling call-sites
- `4` — makes the class of bug unrepresentable (lint rule, CI gate, type, schema constraint, shared wrapper)

**Cost (0-4, higher = more expensive)** — `0` minutes, code-only, plain `git revert` · `1` an hour, few callers, revert-safe · `2` needs a migration or a prod apply, or touches shared code · `3` migration plus backfill, or many writers newly able to throw · `4` multi-repo coordination, or only confirmable against real prod data

**Do NOT add, average, subtract, or otherwise combine Depth and Cost.** They are different
currencies and a single figure cannot carry both. Report them as a pair.

*Why score at all, and why unsummed. A 44-run trial (2026-07-30) scored fixed option sets from
five bugs — `surfaces-pipeline/bug-303`, `surfaces-pipeline/bug-302` (bare "302" is ambiguous —
a second, unrelated `bug-302` lives in `ingest-integrations/`), `surfaces-pipeline/bug-369`,
`surfaces-pipeline/bug-157` (still open), `surfaces-pipeline/bug-375` — under four schemes in
both presentation orders, graded against what shipped:*

    unsummed Depth·Cost pair  9/10
    Depth+Cost summed to /10  8/10
    merit-only sum (no cost)  7/10
    NO NUMBERS, judged holistically  6/10

*Two separate findings, at different confidence. **Scoring beats not scoring, and that gap
is real (6 -> 9).** The holistic judge was 0/4 on the two hard bugs and failed the same way
both times: it reliably picks whichever option is easiest to defend — smallest, safest,
most reversible — because nothing in "is this a good fix?" forces it to ask whether the fix
removes the cause. **That question is the entire job of the Depth axis.** It is not there to
be precise; it is there to force a judgment the model otherwise skips.*

***Which scoring rule you use barely matters (7/8/9 are within noise).** Keep the unsummed
pair because it is marginally best and blocks one specific failure — a sum lets cost cancel
merit, clusters options into a narrow band, and hands the verdict to a tiebreak, i.e. to
position noise (observed twice). Two numbers cannot tie. Don't reintroduce a total, but
don't agonize over the anchors either; the axis existing matters more than its calibration.*

*Three cautions, all measured. (1) The pair is not immune to order-sensitivity — on bug-157
the unsummed scheme produced identical ratings in both orders and flipped its recommendation
anyway. (2) **Prose quality and decision quality came apart.** The holistic judge wrote the
best reasoning in the study and made the worst calls; do not trust fluency as a signal, in
this skill's output or your own. (3) **Longer briefings drift toward the middle option.**
On bug-157, six runs across three prose-heavy variants unanimously picked the moderate
compromise; the only variant that ever picked the correct heavier option was the tersest.
More elaboration surfaces more considerations, more considerations produce more hedges, and
hedging lands on the middle. Keep the briefing SHORT — length is not thoroughness.*

***The uncertainty list and Wins-if line do NOT improve the recommendation.** A 14-run
placebo-controlled trial (2026-07-30) compared the pair alone, the pair plus these devices,
and the pair plus equal-length filler prose (lay explanations + analogies). Devices and
placebo returned the **identical recommendation on all 7 matched comparisons**, and both
scored 5/7 against the terse control's 6/7. Keep them anyway, for one narrow reason that
survived: they are the only variant that produced a **named, runnable check** ("one ripgrep
for `readiness`; zero hits means the envelope never shipped"). They change what is on the
page for YOU to act on — they do not make the model choose better. Do not add further
sections hoping to improve the pick; that was tested and it made things worse.*

*Scope: schemes only diverge when the depth spread is narrow or depth and cost point
maximally opposite. Three of the five bugs were lopsided (one option was "leave as-is") and
every scheme agreed.*

**The trade sentence (required).** Because there is no total, you must state the exchange
rate yourself, in this form: **"paying {cost} to buy {depth}, worth it here because ___"**
(or "not worth it here because ___"). This sentence is where the actual judgment lives —
a rubric that sums is making this same trade silently at a rate someone guessed in advance.

**Anti-strawman floor.** Every listed option must be one a competent engineer might
actually pick. If an option is Depth `0` AND you cannot state its **Wins if** line, delete
it — do not pad the list to three. One option is a legitimate answer.

#### Output — the pair table first, then detail

| Option | Depth | Cost | Hinges on |
|---|---|---|---|
| 1. {name} | {0-4} | {0-4} | {U1, U3 — or "nothing; right in every world"} |
| 2. {name} | … | … | … |

{Then, for each option:}

**Option {N}: {name} — Depth {d}/4 · Cost {c}/4**
- What it does (plain English): {what the fix actually does and how that removes the symptom — same register as "What's broken" above, naming the mechanism and the resulting behavior, NOT just the files. e.g. "saves the new assignment before erasing the old one, so a crash can never leave the conversation with no project."}
- What to change: {specific files and what changes}
- Effort: {estimate}
- Risk: {what could go wrong}
- **Wins if**: {the specific condition under which THIS option beats the one you're
  recommending — a fact about the world, not a restatement of its trade-off. Wherever
  possible tie it to a numbered uncertainty: "Wins if U1 is true." Good: "the SPA deploy
  can't be coordinated in the same window." "doc counts stay under ~50/user." Bad: "you
  want something simpler." REQUIRED on every option — for the recommended one, state
  instead what would make it LOSE. If you cannot name a world where an option wins, it is
  a strawman: delete it per the floor rule.}

End with the **trade sentence** and a one-line **Recommendation** naming the option, its
Depth·Cost pair, and the single deciding reason.

**If a cheap observation would resolve an uncertainty that flips the recommendation, say
that INSTEAD of picking.** "Run this query first; if U1 is false the answer is Option 3,
if true it's Option 1" is a better briefing than a confident wrong pick — and in the
recorded corpus (bug-303) the pivotal fact was settleable by one read-only query that
nobody ran.

### {If pattern scope: "Other instances of this pattern"}

{If the bug is part of a pattern, this section lists other places the same
issue likely exists. Populated by pattern search subagents (see below).}
```

### Pattern Search (if scope == "pattern")

When Question 4 identified a pattern, spawn subagents to find all instances.

Launch one Agent (subagent_type: "Explore") per search angle. The pattern
description from Question 4 tells you what to search for. Common angles:

- Grep for the specific anti-pattern (e.g., missing `.nullish()`, unchecked
  error, raw string comparison)
- Grep for similar code structures in sibling files (e.g., all other surface
  routes, all other adapters)
- Check files that import the same module as the buggy file

Each agent should return: file path, line number, whether it's the same bug or
just similar code, and confidence level.

After agents return, deduplicate and present in the "Other instances" section:

```markdown
### Other instances of this pattern

Found {N} other locations with the same issue:

| File | Line | Description | Confidence |
|---|---|---|---|
| `path/to/file.ts` | 42 | Same missing null check on `data.field` | high |
| `path/to/other.ts` | 118 | Similar pattern but different field | medium |

{If N > 5: "Consider fixing these as a batch — /parallel-fix can handle
multiple bugs in the same group simultaneously."}
```

### Auto-Create Bug Logs for Pattern Instances

For each **high-confidence** pattern instance found by the search agents, auto-create
a draft bug log so it's tracked and discoverable by `/parallel-fix`.

Use the same numbering logic as Phase 0 Step 1 — scan for the current highest bug
number, then assign sequential numbers to each new instance. Assign each to its
correct group based on file location.

Write to `.planning/debug/{group}/bug-{NNN}-{slug}.md` (in the matching group folder) in the
canonical format (`.planning/debug/CONVENTIONS.md`):

```markdown
---
bug: {NNN}
slug: {slug}
title: {short title describing this specific instance}
group: {group}
severity: {inherit from parent bug, or downgrade if the instance is less impactful}
status: open
found: {YYYY-MM-DD}
found-via: pattern search from bug {parent_NNN} ({parent title})
files:
  - {file}
---

# Bug {NNN}: {short title describing this specific instance}

## Symptom

{What would go wrong for a user at THIS specific location}

## Root cause

{Same pattern as bug {parent_NNN}: {one-line pattern description}.
In this instance: {specific file}:{line} — {what's wrong here specifically}.}

## Fix

{Pending — inherits the parent bug's fix shape}

## Files

- `{file}:{line}`
```

Skip instances where:
- A bug log already exists for that file + issue (grep existing logs)
- Confidence is medium or lower (mention these in the briefing table but
  don't create logs — they need manual verification first)

After creating logs, report what was created:

```
Created {N} bug logs for pattern instances:
  bug-{NNN}: {title} ({group})
  bug-{NNN}: {title} ({group})
  ...
These are ready for /parallel-fix or individual /single-fix.
```

### Update bug log

Add the full escalation briefing to the bug log file (keep the log, don't
rename to .resolved).

---

## Edge Cases

**Bug spans two groups**: Pick the group that owns the root-cause file. Mention
the other group's files in the briefing.

**Bug spans more than one repo** (MVP, Dashboard, terum-capture): Escalate. Cross-repo
fixes are never trivial — note every repo involved in the briefing. A bug contained
*entirely* within one repo is fixable normally; that includes a pure `capture-cli`
(terum-capture) fix — apply it in that repo, commit locally with `fix(capture-cli): …`,
and leave the push to Ryan (it's a public repo). Only cross-repo coupling forces escalation.

**Root cause is in a "Do Not Touch" area** (overlap matrix file owned by another
group): Escalate. Note the ownership constraint.

**Can't reproduce or root cause is unclear**: Escalate with what you DO know.
Explain what you checked and what's uncertain. Don't guess at a fix.

**Bug log number collision**: Do NOT hand-pick or "increment until free" — re-run
`git fetch origin && bash scripts/next-bug-number.sh`; it already maxes over every ref, not just
this worktree. If a collision has already LANDED (two different slugs on one number),
`npm run check:bug-log-status` fails: renumber the **later-landing** log — prefer whichever has
fewer inbound references — update its inbound refs, and note the renumber in the log body. Never
renumber a log another branch is also renumbering: that produces a *split bug* (one slug, two
numbers), which has no baseline and fails the same gate. Full remedy:
`.planning/debug/CONVENTIONS.md` §Filename.
