---
name: parallel-fix
description: Use when fixing multiple bugs across the codebase in parallel, after code review, or when the user wants to fix bugs from existing bug logs in one command
---

Triage-first pipeline: ingest bug logs (or create them from descriptions) →
diagnose ALL bugs in parallel (read-only) → auto-fix only the trivial/safe/isolated
ones → surface everything else to the user with a complete diagnosis.

Operates across three repos (MVP + Dashboard + the terum-capture CLI). Bug logs in
`.planning/debug/` are used if they exist; otherwise the skill creates them from the
user's descriptions.

**In the Terum MVP repo, load the domain knowledge before triaging** (don't rely on
topic auto-invocation — summon these explicitly): `terum-debugging-playbook` for the
known failure signatures, `terum-visibility-and-privacy` before touching any
cross-user/team read, and — for each bug you move to auto-fix — `terum-change-control`
for how it gets gated/committed and `terum-validation-and-qa` for what counts as
passing.

## Philosophy

The user's bug-handling workflow asks four questions before touching code:
1. What is the root cause? What would the fix look like?
2. How hard is this to fix? Is there a clear path?
3. Could the fix introduce new bugs or delete functionality?
4. Is this bug part of a larger pattern?

This skill automates that workflow. **Phase 2 (Triage)** answers all four questions
for every bug in parallel via read-only agents. Bugs that are trivial, low-risk, AND
isolated get auto-fixed. Everything else gets surfaced to the user with a full
diagnosis briefing — saving them the manual diagnosis work.

## Core Rules

1. **State file is the single source of truth.** Path: `.planning/parallel-fix-state.json`.
   Read at every phase start, write after every phase.
2. **BUG-GROUPS.md defines groups, directories, and overlap.** Parse at runtime. Do not
   invent groups. Path: `.planning/debug/BUG-GROUPS.md`.
2b. **CONVENTIONS.md defines bug-log layout/naming/format/status.** Path:
   `.planning/debug/CONVENTIONS.md`. Logs live in a per-group subfolder
   (`.planning/debug/{group}/…`) whose name equals the log's `group`. New logs you create are
   written in its canonical frontmatter format into the matching group folder; the `.resolved.md`
   suffix is the authoritative open/resolved signal. You still *read* legacy formats (Phase 1 Step 2).
3. **Triage before fixing.** Every bug gets diagnosed first. Only bugs classified as
   auto-fix candidates enter the fix pipeline.
4. **One bug per fix agent.** Each fix agent gets exactly one finding, the triage
   diagnosis, and the full 10-minute timeout.
5. **Agent instructions are aspirational; orchestrator validates enforcement.** Phase 5
   cross-checks every agent's git output regardless of self-reported claims.
6. **Bug logs are resolved only after integration tests pass.**
7. **Branch metadata comes from Agent tool return, not agent text output.**
8. **No Co-Authored-By in commit messages.**
9. **Model selection.** Triage agents inherit the session model (no `model` override) —
   triage is the highest-leverage decision and deserves the user's chosen model. Fix
   agents use `model: "sonnet"` — the triage already did the thinking, and the fix is
   a mechanical 1-10 line change well within Sonnet's capability.

## Repos

Parse paths from BUG-GROUPS.md's "Three repos" table at runtime.

| Key | Default path | Groups |
|---|---|---|
| `mvp` | CWD (the repo this skill runs from) | `extension`, `ingest-integrations`, `surfaces-pipeline` |
| `dashboard` | From BUG-GROUPS.md | `dashboard-spa` |
| `capture` | From BUG-GROUPS.md (`C:\dev\Terum\terum-capture`) | `capture-cli` |

Skip a non-MVP repo entirely if it has no findings (no `dashboard-spa` → skip dashboard;
no `capture-cli` → skip terum-capture).

## Group Config

| Group | Repo | Stack | Isolated | Scoped Test | Setup |
|---|---|---|---|---|---|
| `extension` | mvp | js | fully | `npx vitest run __tests__/extension/` | `npm ci --prefer-offline` |
| `ingest-integrations` | mvp | ts | overlap ↔ surfaces | `npx vitest run __tests__/api/ __tests__/lib/` | `npm ci --prefer-offline` |
| `surfaces-pipeline` | mvp | ts | overlap ↔ ingest | `npx vitest run __tests__/api/ __tests__/lib/ && (cd lib/dashboard/contracts && npm test)` | `npm ci --prefer-offline` |
| `dashboard-spa` | dashboard | ts | fully (cross-repo) | below | below |
| `capture-cli` | capture | python | fully (cross-repo) | below | below |

**dashboard-spa:**
```bash
# Setup (from dashboard repo root)
cd Terum-Dashboard && npm ci --prefer-offline
# Test
cd Terum-Dashboard && npx vitest run
```

**capture-cli** (Python 3.10+ via the Windows `py` launcher; pytest is NOT a declared dep; `.venv` is gitignored):
```bash
# Setup (from terum-capture repo root) — build the venv once, reused across rounds/branches
py -3.10 -m venv .venv
.venv\Scripts\python -m pip install -e . pytest
# Test (verified baseline: 28 passed)
.venv\Scripts\python -m pytest -q
```
Do not hardcode a `~/.pyenv/...` interpreter path — use `py -3.10`.

## Runtime Context

Fix agents get group-specific runtime constraints. Fixes that pass tests but violate
these crash in production.

| Group | Runtime | Self-Check |
|---|---|---|
| `extension` | Chrome MV3 — three runtimes in one group. (a) **Module service worker** `src/background.js` (`manifest.json:6-9` `"type":"module"`) and everything it imports under `src/lib/*.js`: ES `import`/`export` REQUIRED; no DOM. (b) **MAIN-world** content scripts `src/injection/{smart-skip,inject-controller}.js` + `src/capture/fetch-intercept.js` (`manifest.json:45-52`). (c) **ISOLATED-world** content scripts `src/content-announce.js`, `src/content-bridge.js`, `src/injection/badge-renderer.js`. For (b) and (c): **NO** `import`/`export` — Chrome throws SyntaxError and kills the script. NO Node.js APIs (`Buffer`, `process`, `fs`) anywhere. `chrome.*`, `window`, DOM available in content scripts. Tests run in Vitest with mocks; production runs in Chrome. | `for f in $(node -e "const m=require('./extension/manifest.json');console.log(m.content_scripts.flatMap(c=>c.js).join(' '))"); do grep -n '^\(export\|import \)' "extension/$f" && echo "FAIL: extension/$f is a content script and cannot use ES module syntax" && exit 1; done; echo PASS` |
| `ingest-integrations` | Next.js App Router API routes (serverless Node.js). Auth: `requireAuthFromBearer(req)` from `lib/supabase/auth-guard.ts` — splits `trm_`-prefixed API keys to `resolveApiKey` and Supabase JWTs to the cached `resolveJwtUser`. Never call `createAdminClient().auth.getUser(token)` directly: the shared sha256(token) cache is what keeps a backfill burst from saturating GoTrue's ~10-conn pool (bug-155). Returns the service-role `adminClient`, so every query MUST carry `.eq("user_id", user.id)`. No shared state between requests. Supabase client created per-request. | `npm run typecheck --silent 2>&1 \| head -30` |
| `surfaces-pipeline` | Next.js App Router — Server Components (default) + Client Components (`"use client"`) + API routes. No `window`/`document`/`localStorage` in server components. BFF auth: `resolveSurfaceAuth()` (dual cookie/Bearer). | `npm run typecheck --silent 2>&1 \| head -30` |
| `dashboard-spa` | Vite + React 18 browser SPA. TanStack Query for data fetching. Bearer token auth to api.terum.ai. d3-force for map canvas. Google-only Supabase localStorage login (NOT MVP cookie auth). | `cd Terum-Dashboard && npm run typecheck --silent 2>&1 \| head -30` (fall back to `npx tsc --noEmit` only if that repo declares no `typecheck` script) |
| `capture-cli` | Python 3.10+ CLI (no server, no browser). The `upload` command reads Claude Code Stop-hook JSON from **stdin**, parses the transcript with an incremental offset sidecar (`~/.terum/sent_<session_id>`), and uploads via `httpx` to `{api_url}/ingest/llm-history` with `Authorization: Bearer`. Stdlib + `httpx` only (sole runtime dep). NO Node/`npm`, no `chrome.*`. | `.venv\Scripts\python -m py_compile src/terum_capture/*.py` |

Never substitute bare `npx tsc --noEmit` for the MVP self-checks above — `tsconfig.json` pulls stale
`.next/` generated types (bug-452) and omits the `--max-old-space-size=4096` OOM guard baked into
`npm run typecheck` (`package.json`); both produce false HARD BLOCKs in Phase 5.4.

## Group History Mapping

All logs on `main` now carry a live group slug (verified: zero numeric or `standalone` tags
remain). If a log arrives from an old branch with a numeric group, map it via BUG-GROUPS.md
"Group history (old → new)" — do not re-derive the mapping here. Old Group 4 routes per-log:
MVP-side files (`app/`, `lib/`, `middleware.ts`) → `surfaces-pipeline`; `Terum-Dashboard/` paths
→ `dashboard-spa`; both → split into two findings.

Legacy logs may carry metadata as bold inline headers (`**Group:** \`surfaces-pipeline\``)
instead of YAML frontmatter — 84 logs still do; parse them per Phase 1 Step 2.
Taxonomy-disclaimer blockquotes and `_(was: N)_` group suffixes are retired by
CONVENTIONS.md and effectively extinct; never write either.

## State File Schema

`.planning/parallel-fix-state.json`

```jsonc
{
  "phase": "preconditions|ingest|triage|confirm|fix|validate|merge|done",
  "repos": {
    "mvp":       { "path": "...", "branch": "...", "rollback_sha": "..." },
    "dashboard": { "path": "...", "branch": "...", "rollback_sha": "..." },
    "capture":   { "path": "...", "branch": "...", "rollback_sha": "..." }
  },
  "active_repos": ["mvp"],
  "groups": {
    "extension": { "repo": "mvp", "stack": "js", "isolated": true, "directories": ["extension/", ...] }
  },
  "overlap": {
    "lib/phase1.ts": { "owner": "ingest-integrations" }
  },
  "findings": [{
    "id": "bug-096",
    "severity": "high",
    "group": "surfaces-pipeline",
    "files": ["app/api/surfaces/team/audit/route.ts"],
    "description": "Audit buttons send conversationId instead of briefingItemId",
    "bug_log_path": "/absolute/path/to/bug-096.md",
    "status": "pending",
    "triage": {                            // populated by Phase 2
      "root_cause": "...",
      "root_cause_location": "file:line",
      "proposed_fix": "...",
      "difficulty": "trivial|moderate|hard",
      "difficulty_reasoning": "...",
      "risk": "low|medium|high",
      "risk_reasoning": "...",
      "pattern": "isolated|pattern",
      "pattern_detail": null,
      "auto_fix": true,
      "not_a_bug": false,
      "escalation_reasons": []
    },
    "briefing": "..."                     // populated by Phase 2 (escalated bugs only)
  }],
  "rounds": { "total": 0, "current": 0 },
  "agents": {
    "surfaces-pipeline-r1": {
      "group": "surfaces-pipeline",
      "round": 1,
      "finding_id": "bug-096",
      "branch": null,
      "worktree_path": null,
      "validation": {
        "scope_ok": null, "runtime_ok": null, "not_log_only": null,
        "no_deletions": null, "test_evidence": null,
        "hard_blocked": false, "rejected": false
      }
    }
  },
  "merge": {
    "mvp":       { "order": [], "merged": [], "save_points": {}, "test_result": null },
    "dashboard": { "order": [], "merged": [], "save_points": {}, "test_result": null },
    "capture":   { "order": [], "merged": [], "save_points": {}, "test_result": null }
  }
}
```

---

## Phase 0: Preconditions

### Step 1 — Clean working tree

```bash
git status --porcelain --untracked-files=no
```

Run in MVP. Dashboard + terum-capture repo checks deferred to after ingest (Phase 1 Step 4). Stop if dirty.

### Step 2 — Parse BUG-GROUPS.md

Read `.planning/debug/BUG-GROUPS.md`. Extract:
- Repo paths from the "Three repos" table
- Group definitions (name, directories from file tables)
- Isolation status from group headers
- Overlap matrix from the "Overlap matrix" section (file, owner, risk)

### Step 3 — Baseline tests

Run `npm test` in MVP. Stop if any test fails — agents can't distinguish their
regressions from pre-existing failures.

Defer dashboard + terum-capture tests to after ingest (run each only if its group has findings).

### Step 4 — State file

If `.planning/parallel-fix-state.json` exists:
- `phase: "done"` → delete silently, start fresh.
- Other → show phase and progress, ask: resume or fresh start?

### Step 5 — Initialize state

Write state file with `phase: "preconditions"`, repo paths, branches, rollback SHAs,
parsed groups, and overlap matrix.

---

## Phase 1: Ingest Bugs

Update state: `phase: "ingest"`.

Two input modes — the skill handles both, and they can be mixed.

### Step 1 — Determine input source

Check for bugs in this priority order:

1. **Conversation context** — look for findings from a prior review pass in the
   current session (security audit, `/code-review`, hardening scan, or any
   analysis that produced a list of issues). Also check for bug descriptions
   the user provided inline with the `/parallel-fix` invocation.
2. **Existing bug logs** — scan `.planning/debug/` for unresolved logs:
   ```bash
   find .planning/debug -name "*.md" ! -name "*.resolved.md" ! -name "*.deferred.md" ! -name "BUG-GROUPS.md" \
     ! -name "CONVENTIONS.md" ! -name "injection-merge-benchmarks.md" ! -name "RENUMBER-*.md"
   ```
   Any `.md` directly under `.planning/debug/` (not in a group folder) is documentation, not a log —
   skip it.

   `.deferred.md` logs are consciously-deferred tracked debt, excluded from the active-fix queue
   the same way `.resolved.md` is (CONVENTIONS.md) — never auto-triage them.
   **Duplicate-pair guard:** if an open `X.md` has a sibling `X.resolved.md` (resolved) or
   `X.deferred.md` (deferred), SKIP the open `.md` (do not triage it). The suffixed sibling wins
   regardless of what the `.md`'s body or frontmatter says.

If the conversation has findings from a prior review, use those — they're why
the user invoked the skill. Existing bug logs are the fallback when there's
nothing actionable in the conversation context.

Both sources can contribute in the same run: if the conversation has 3 review
findings and `.planning/debug/` has 2 unresolved logs, process all 5.

**For conversation-context findings (no log exists yet):** create a bug log for
each. For each finding that does NOT already have a bug log:

1. **Next bug number**: claim it atomically — never hand-scan (a `find` misses numbers that reached
   a sibling branch through a merge; that is bug-494):
   ```bash
   git fetch origin && NNN=$(bash scripts/next-bug-number.sh)
   ```
   The script already zero-pads-safe, takes the max over all refs + trees + working tree, and
   serializes concurrent claims.
2. **Identify files**: from the description, read candidate source files to confirm.
3. **Assign group**: match files to groups per BUG-GROUPS.md (same table as
   `/single-fix` Phase 0 Step 3).
4. **Write bug log** to `.planning/debug/{group}/bug-{NNN}-{slug}.md` (in the matching group
   folder) in the canonical format (`.planning/debug/CONVENTIONS.md`):

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

{What the user reported}

## Root cause

Under investigation

## Files

- `{file1}`
- `{file2}`
```

### Step 2 — Parse each bug log

New logs follow `.planning/debug/CONVENTIONS.md` (canonical YAML frontmatter). For *reading*,
two legacy formats also exist in the wild and must still be parsed:

**YAML frontmatter** (newer logs):
```yaml
---
bug: slug
group: surfaces-pipeline
severity: high
status: open
---
```

**Informal headers** (older logs):
```markdown
**Group:** `surfaces-pipeline`
**Severity**: High
**Status**: Fixed
```

Extract: group (map old→new via Group History Mapping), severity (normalize to
critical/high/medium/low), status (skip if Fixed/resolved), files (from ## Files,
## Root cause, or inline backtick paths), description, id (from filename slug),
bug_log_path (absolute).

### Step 3 — Validate and filter

Skip files missing severity, files, or parseable group. Mark unrecognized groups as
`"unassigned"`. If >50% unassigned, warn and offer to exit for BUG-GROUPS.md updates.

### Step 4 — Post-ingest repo checks

Set `active_repos` based on findings. For each non-MVP repo whose group has findings, verify the
repo exists, is clean, baseline tests pass, and record branch + rollback SHA:
- `dashboard-spa` findings → dashboard repo (`cd Terum-Dashboard && npx vitest run`).
- `capture-cli` findings → terum-capture repo. Build the venv if absent
  (`py -3.10 -m venv .venv && .venv\Scripts\python -m pip install -e . pytest`),
  then baseline `.venv\Scripts\python -m pytest -q` (verified clean: 28 passed). It's a **public** repo —
  commit locally but leave pushing to the user.

Show summary and write findings to state.

---

## Phase 2: Triage

Update state: `phase: "triage"`.

This is the core decision phase. For each group that has findings, launch one
**read-only triage agent** — no worktree isolation needed (agents only read code).
Launch ALL triage agents in a **single message** so they run concurrently.

### Triage agent prompt

One agent per group. Each triages ALL bugs in its group:

```
You are triaging bugs in the {GROUP} area. Do NOT write any code or propose
diffs. Your job is diagnosis and risk assessment ONLY.

Read CLAUDE.md for project architecture and conventions.

{For dashboard-spa agents:
  Dashboard repo: {DASHBOARD_PATH}
  SPA source:     {DASHBOARD_PATH}/Terum-Dashboard/
  Use absolute paths for all Read calls.}

BUGS TO TRIAGE:

---
ID: {id}
Severity: {severity}
Files: {files}
Description: {description}
Bug log: {bug_log_path}
---
(repeat for each bug in this group)

For EACH bug, read the bug log and the relevant source files, then answer
these four questions:

1. ROOT CAUSE
   What exactly causes this bug? Name the file, function, and line.
   Explain WHY the current code produces the buggy behavior.
   If the bug log already has a root cause section, verify it against the
   current code (it may be stale).

2. FIX DIFFICULTY
   - "trivial": ~1-10 line change with an obvious, mechanical fix.
     Examples: wrong variable/field name, missing null check, incorrect
     boolean condition, wrong enum value, off-by-one, missing await,
     swapped arguments, typo in string key.
   - "moderate": 10-50 line change requiring design thought, or touches
     multiple functions/files in a coordinated way.
   - "hard": Requires architectural changes, unclear fix boundary,
     needs new abstractions, or the "right fix" is debatable.
   Describe the proposed fix and why you chose this difficulty level.

3. RISK
   Could this fix introduce a NEW bug or delete working functionality?
   - "low": Changes a single expression or adds a missing check.
     No callers affected. No behavior change for non-buggy inputs.
   - "medium": Few callers but they need verification. Fix is additive
     but touches shared code.
   - "high": Multiple callers, shared state, removes/restructures
     existing code paths, or subtle ordering/timing invariants.
   Describe what could go wrong.

4. PATTERN
   Is this bug a one-off, or does the same root cause exist elsewhere?
   - "isolated": This specific code path has this specific bug. Fixing
     it here is complete.
   - "pattern": The same mistake/omission exists in other places, OR
     fixing this one reveals a deeper architectural issue that should be
     addressed as a group rather than patched individually.
   If pattern, name the other affected locations and describe the
   larger pattern.

For each bug, output a result block in this exact format:

TRIAGE_{BUG_ID}:
{
  "id": "{bug_id}",
  "root_cause": "specific explanation",
  "root_cause_location": "file.ts:lineNumber",
  "proposed_fix": "what to change and where",
  "difficulty": "trivial|moderate|hard",
  "difficulty_reasoning": "why this difficulty level",
  "risk": "low|medium|high",
  "risk_reasoning": "what could go wrong (or why nothing can)",
  "pattern": "isolated|pattern",
  "pattern_detail": "null, or description of the larger pattern",
  "auto_fix": true or false,
  "escalation_reasons": [],
  "not_a_bug": false
}

Set auto_fix to true ONLY when ALL THREE conditions hold:
  difficulty == "trivial"  AND  risk == "low"  AND  pattern == "isolated"
Otherwise set auto_fix to false and list reasons in escalation_reasons.
When in doubt, set auto_fix to false — false negatives (escalating a
fixable bug) are cheap, false positives (auto-fixing a risky bug) are not.

If diagnosis reveals the code is actually correct — the reported symptom
is expected behavior, a misunderstanding, or already fixed — set
not_a_bug to true, auto_fix to false, and explain in root_cause.

For each bug where auto_fix is FALSE and not_a_bug is FALSE, also output
an ESCALATION BRIEFING directly below the triage block. You have the code
context right now — the orchestrator does not. Write the briefing as if
explaining to a Harvard freshman studying CS — someone with Python
experience but no familiarity with this codebase or its web stack.

BRIEFING_{BUG_ID}:

## Bug {id}: {title}

### What's broken

{Plain-English: "When you do X, Y happens instead of Z." If security,
explain what an attacker could do.}

### Why it's broken

{Walk through the code path. Name file and function, but explain what
the code DOES in plain terms before explaining what's wrong. Use
analogies if they help.}

### Why this wasn't auto-fixed

- Difficulty: {rating} — {reason}
- Risk: {rating} — {reason}
- Scope: {rating} — {reason}

### How confident I am in the diagnosis

- Confidence the root cause is correct: {high|medium|low}
- What would falsify it: {one specific checkable observation. "Nothing" is not an
  acceptable answer — if you can't name one, confidence is low, not high.}

### What I don't know that would change the answer

| # | Uncertain fact | P(true) |
|---|---|---|
| U1 | {a fact you can't establish from the diagnosis that different options depend on} | {0.0-1.0} |

Cheapest resolving observation: {the one query/test/log that would most collapse the
uncertainty, and which U it resolves}

### Options for fixing

Rate every option on TWO numbers and **never combine them into one** — they are different
currencies, and a single total lets them cancel — near-tied totals hand the verdict to the
tiebreak, i.e. to position noise. Measured: 44-run trial 2026-07-30 over bugs
303 / 302-team-owned-compacted-upsert-conflict-key / 369 / 157 / 375 graded against what
shipped — unsummed 9/10, sum-with-cost 8/10,
merit-only 7/10, **no numbers at all 6/10**. Scoring beats not-scoring by a real margin;
which rule you use is within noise. The holistic judge went 0/4 on the hard bugs, always
picking the most defensible option, because nothing made it ask whether the fix removes the
cause — that question is what the Depth axis exists to force. Caution: it also wrote the
BEST prose in the study while making the worst calls; fluency is not a quality signal.

- **Depth (0-4)**: 0 masks the symptom · 1 buys headroom (bigger cap/timeout/retries),
  same bug recurs · 2 removes the coupling here · 3 removes it here + sweeps siblings ·
  4 makes the class unrepresentable (lint rule, gate, type, schema constraint, wrapper)
- **Cost (0-4, higher = more expensive)**: 0 minutes, code-only, plain revert · 1 an hour,
  few callers · 2 needs a migration or prod apply · 3 migration + backfill, or many
  writers newly throwable · 4 multi-repo, or only confirmable against real prod data

Do not pad to three options: if an option is Depth 0 and you can't state its "Wins if",
delete it.

| Option | Depth | Cost | Hinges on |
|---|---|---|---|
| 1. {name} | {0-4} | {0-4} | {U1 — or "nothing; right in every world"} |

**Option 1: {name} — Depth {d}/4 · Cost {c}/4**
- What it does (plain English): {what the fix does and how that removes the symptom —
  the mechanism and resulting behavior, not just the files}
- What to change: {files and changes}
- Effort: {estimate}
- Risk: {what could go wrong}
- **Wins if**: {the specific condition under which this beats the recommended option — a
  fact about the world, tied to a numbered uncertainty where possible, not "you want
  something simpler". For the recommended option, state what would make it lose instead.}

{1-3 options total. End with the trade sentence — "paying {cost} to buy {depth}, worth it
here because ___" — then a one-line Recommendation naming the option + its Depth·Cost pair
+ the single deciding reason. If a cheap observation would flip the recommendation, say
that INSTEAD of picking.}
```

### After triage agents complete

Parse each agent's output for `TRIAGE_{id}` and `BRIEFING_{id}` blocks:

1. Match each triage result to a finding by ID.
2. Store the full triage object in `finding.triage`.
3. Store the briefing text in `finding.briefing` (null for auto-fix and not-a-bug).
4. If a triage result is missing or unparseable for a finding, set
   `triage.auto_fix: false` with `escalation_reasons: ["triage agent did not assess"]`.
5. For `not_a_bug: true` findings: update the bug log with "Not a bug: {root_cause}",
   rename to `.resolved.md`, and remove from findings.

Update state with triage results.

---

## Phase 3: Confirm

Update state: `phase: "confirm"`.

### Show triage results in two buckets

**AUTO-FIX candidates** (trivial + low risk + isolated):

```
AUTO-FIX (N bugs — trivial, safe, isolated):

  [{id}] {group} | {severity} | {one-line description}
    Root cause: {root_cause} ({root_cause_location})
    Fix: {proposed_fix}

  [{id}] ...
```

**ESCALATED** (everything else — full briefing per bug):

Display the `BRIEFING_{id}` text produced by the triage agent for each
escalated bug. The triage agent wrote these with full code context — do
NOT rewrite or summarize them. Present them verbatim.

### Pattern search for escalated bugs

After presenting the escalation briefings, check all escalated bugs where
`pattern == "pattern"`. For each, launch one Agent (subagent_type: "Explore")
per search angle to find all instances of the pattern in the codebase.

Search angles depend on the pattern description — common ones:
- Grep for the specific anti-pattern
- Grep for similar code structures in sibling files
- Check files that import the same module as the buggy file

After agents return, present pattern instances in each bug's briefing:

```markdown
### Other instances of this pattern

| File | Line | Description | Confidence |
|---|---|---|---|
| `path/to/file.ts` | 42 | Same issue | high |
```

### Auto-create bug logs for pattern instances

For each **high-confidence** pattern instance, auto-create a draft bug log so
it's tracked and discoverable by future `/parallel-fix` or `/single-fix` runs.

Claim each number with `git fetch origin && NNN=$(bash scripts/next-bug-number.sh)` (never a
hand-scan — see Phase 1 Step 1). Assign each to its correct group based on file location.

Write to `.planning/debug/{group}/bug-{NNN}-{slug}.md` (in the matching group folder) in the
canonical format (`.planning/debug/CONVENTIONS.md`):

```markdown
---
bug: {NNN}
slug: {slug}
title: {short title describing this specific instance}
group: {group}
severity: {inherit from parent bug, or downgrade if less impactful}
status: open
found: {YYYY-MM-DD}
found-via: pattern search from bug {parent_id} ({parent title})
files:
  - {file}
---

# Bug {NNN}: {short title describing this specific instance}

## Symptom

{What would go wrong for a user at THIS specific location}

## Root cause

{Same pattern as bug {parent_id}: {one-line pattern description}.
In this instance: {specific file}:{line} — {what's wrong here specifically}.}

## Files

- `{file}:{line}`
```

Skip instances where:
- A bug log already exists for that file + issue (grep existing logs)
- Confidence is medium or lower (mention in the table but don't create logs)

Report created logs:

```
Created {N} bug logs for pattern instances:
  bug-{NNN}: {title} ({group})
  ...
These are ready for /parallel-fix or individual /single-fix.
```

### ROI gate

If 0 auto-fix candidates: show the escalation briefings and exit. The user
has a full diagnosis and fix options for every bug — that's the deliverable.

```
No bugs qualified for auto-fix. All N bugs are escalated.
Full briefings with fix options are shown above.
{If pattern logs created: "Created {N} bug logs for pattern instances."}
```

If all findings in one group are auto-fix and no other group has auto-fix candidates:
skip parallel machinery and fix sequentially (no worktree overhead for one group).

### Overlap locks

For auto-fix findings in `ingest-integrations` or `surfaces-pipeline`, check overlap
matrix. Assign file ownership. Warn if a finding needs a file owned by the other group:
```
[{id}] needs {file} (owned by {other_group}).
  1. Move to {other_group}   2. Escalate instead   3. Drop
```

### User overrides

Accept:
- `auto-fix {id}` — promote an escalated bug to auto-fix (user takes the risk)
- `escalate {id}` — demote an auto-fix candidate (user disagrees with triage)
- `drop {id}` — remove from both buckets
- `move {id} to {group}` — reassign group (validate against overlap locks)

### Finalize

Set merge order per-repo (isolated first, overlapping second, dashboard independent).
Compute `total_rounds` = max auto-fix findings in any single group.
Write final assignments to state.

---

## Phase 4: Fix

Update state: `phase: "fix"`.

**Only auto-fix findings enter this phase.** Escalated findings are untouched.

### Pre-launch validation

Verify HEAD matches `rollback_sha` in each active repo. Warn if HEAD moved.

### Round execution

Order each group's auto-fix findings by severity (HIGH first). For each round:

1. Update `current_round` in state.
2. For each group with a remaining auto-fix finding, launch one agent. **Launch ALL
   agents in a SINGLE message** (parallel). All fix agents use `model: "sonnet"`.
   - **MVP groups**: Agent tool with `isolation: "worktree"`, `model: "sonnet"`,
     `timeout: 600000`.
   - **`dashboard-spa`**: Agent tool **without** isolation, `model: "sonnet"`,
     `timeout: 600000`. Create branch in dashboard repo before launch:
     ```bash
     cd {dashboard_path} && git checkout -b fix-dashboard-r{round}
     ```
   - **`capture-cli`**: Agent tool **without** isolation, `model: "sonnet"`,
     `timeout: 600000`. Create branch in the terum-capture repo before launch:
     ```bash
     cd {capture_path} && git checkout -b fix-capture-r{round}
     ```
3. After all agents complete, capture branch/worktree metadata from Agent tool returns.
4. Run Phase 5 (Validate) for this round's agents.
5. Merge validated fixes (skip integration test — runs once after all rounds).
6. Next round. Round N+1 agents fork from code that includes round N fixes.

After all rounds, run integration test (Phase 6 Step 3).

### Fix agent prompt — MVP TypeScript/JS groups

The fix agent starts from the triage diagnosis. It verifies the diagnosis and
implements the proposed fix — it does NOT re-diagnose from scratch.

```
You are fixing a trivial bug in the {GROUP} area. A triage agent has already
diagnosed this bug and classified it as a safe, isolated, trivial fix.

Read CLAUDE.md in the repo root for architecture rules and coding practices.

TRIAGE DIAGNOSIS (start from this — verify before implementing):
  Root cause: {triage.root_cause} ({triage.root_cause_location})
  Proposed fix: {triage.proposed_fix}
  Difficulty: {triage.difficulty} — {triage.difficulty_reasoning}

RUNTIME ENVIRONMENT (your fix MUST be valid here):
{RUNTIME_CONTEXT from the Runtime Context table}

BUG:
  ID: {BUG_ID}
  Severity: {SEVERITY}
  Files: {FILES}

ALLOWED DIRECTORIES:
{GROUP_DIRECTORIES}

DO NOT TOUCH (parallel agent owns these):
{LOCKED_FILES}

MAIN TREE PATH: {MAIN_TREE_PATH}

SETUP (fresh worktree — run first):
  cp {MAIN_TREE_PATH}/.env .env 2>/dev/null || true
  {SETUP_COMMAND}

SCOPED TEST: {TEST_COMMAND}

RUNTIME SELF-CHECK (run before committing):
  {SELF_CHECK}

{FIX_INSTRUCTIONS — see Condensed Fix Instructions below}
```

### Fix agent prompt — dashboard-spa

```
You are fixing a trivial bug in the Dashboard SPA — a SEPARATE repo.

TRIAGE DIAGNOSIS:
  Root cause: {triage.root_cause} ({triage.root_cause_location})
  Proposed fix: {triage.proposed_fix}

IMPORTANT: Your CWD is the MVP repo, but the bug is in the Dashboard repo.
  Dashboard repo: {DASHBOARD_PATH}
  SPA source:     {DASHBOARD_PATH}/Terum-Dashboard/
Use ABSOLUTE paths for Read/Edit/Write. cd to dashboard for Bash.

RUNTIME: Vite + React 18 browser SPA. TanStack Query. d3-force. MSW mocks.
  No SSR, no server components. Everything runs in the browser.

BUG:
  ID: {BUG_ID}
  Severity: {SEVERITY}
  Files: {FILES}

SETUP: cd {DASHBOARD_PATH}/Terum-Dashboard && npm ci --prefer-offline
SCOPED TEST: cd {DASHBOARD_PATH}/Terum-Dashboard && npx vitest run
RUNTIME SELF-CHECK: cd {DASHBOARD_PATH}/Terum-Dashboard && npm run typecheck --silent 2>&1 | head -30
  (fall back to npx tsc --noEmit only if that repo declares no typecheck script)

{FIX_INSTRUCTIONS}

Branch: fix-dashboard-r{ROUND}
```

### Fix agent prompt — capture-cli (Python)

```
You are fixing a trivial bug in the terum-capture CLI — a SEPARATE public repo (Python).

TRIAGE DIAGNOSIS:
  Root cause: {triage.root_cause} ({triage.root_cause_location})
  Proposed fix: {triage.proposed_fix}

IMPORTANT: Your CWD is the MVP repo, but the bug is in the terum-capture repo.
  terum-capture repo: {CAPTURE_PATH}
Use ABSOLUTE paths for Read/Edit/Write. cd to the repo for Bash.

RUNTIME: Python 3.10+ CLI. No server, no browser. The `upload` command reads Claude Code
  Stop-hook JSON from stdin, parses the transcript with an incremental offset sidecar, and
  uploads via httpx with `Authorization: Bearer`. Match the existing style — stdlib + httpx
  only (httpx is the sole runtime dependency). No new dependencies.

BUG:
  ID: {BUG_ID}
  Severity: {SEVERITY}
  Files: {FILES}

SETUP (venv is gitignored; build once if absent):
  cd {CAPTURE_PATH}
  [ -d .venv ] || py -3.10 -m venv .venv
  .venv\Scripts\python -m pip install -e . pytest
SCOPED TEST: cd {CAPTURE_PATH} && .venv\Scripts\python -m pytest -q
RUNTIME SELF-CHECK: cd {CAPTURE_PATH} && .venv\Scripts\python -m py_compile src/terum_capture/*.py

{FIX_INSTRUCTIONS}

Commit format: fix(capture-cli): {description}. Commit locally — do NOT push (public repo).
Branch: fix-capture-r{ROUND}
```

---

## Condensed Fix Instructions

Include verbatim in every fix agent prompt:

```
WORKFLOW — this bug was triaged as trivial. You have the full 10 minutes
but it should not take that long.

1. VERIFY THE TRIAGE:
   Read the code at the root cause location. Confirm the triage diagnosis
   is correct. If the triage is WRONG (root cause is different, fix is
   harder than "trivial", or there are complications the triage missed):
   output status "failed" with reason "triage inaccurate: {what's wrong}".
   Do NOT attempt a fix you're not confident about.

2. TEST:
   Write ONE failing test reproducing the root cause.
   - Must assert a BEHAVIORAL difference (data, state, errors — not logs).
   - Run BEFORE your fix to confirm it fails.
   - If untestable (UI-only, config, race condition): skip with note.

3. FIX:
   Implement the proposed fix (or a better variant if you found one).
   - Must be valid in the RUNTIME ENVIRONMENT.
   - Must preserve behavior for non-buggy inputs.
   - Run the RUNTIME SELF-CHECK. If it fails, your fix is invalid.

4. VERIFY:
   Run the test after your fix. Must pass. One retry allowed.

5. COMMIT:
   One bug, one commit. Format: fix({group}): {description}
   Body: Root cause: {one sentence}
   No Co-Authored-By.

   Run `git diff --stat` first — if >50 source lines (excluding tests),
   you have scope creep. Remove unrelated changes.

RULES:
- Do NOT edit DO NOT TOUCH files or files outside ALLOWED DIRECTORIES
- Do NOT run the full test suite — only the SCOPED TEST
- Do NOT add features, refactors, or cleanup beyond the fix
- Do NOT use syntax/APIs invalid in the RUNTIME ENVIRONMENT
- Do NOT add only logging as your "fix"
- If the fix turns out to be harder than trivial: output failed, do not push through

OUTPUT — end your response with this exact block:

PARALLEL_FIX_RESULT:
{
  "status": "committed|failed|skipped",
  "root_cause": "one sentence or null",
  "commit_sha": "full SHA or null",
  "test_file": "path to test file or null",
  "failure_reason": "why failed/skipped or null"
}
```

---

## Phase 5: Validate Agent Output

Update state: `phase: "validate"`.

Runs after each round's agents complete, BEFORE merging. For each agent with commits:

### 5.1 — Scope enforcement

```bash
git diff {rollback}..{branch} --stat -- ':!__tests__/' ':!tests/' ':!*test*' | tail -1
```

If >50 source lines changed: scope violation. User decides: reject or accept.

### 5.2 — Deletion impact

Extract deleted function/handler names from diff. Grep codebase for live callers
(excluding modified file and test dirs). Flag if >15 lines deleted from a single file
containing event listeners, route registrations, or exports.

**HARD BLOCK** if deleted symbols have live callers. Entire branch excluded.

### 5.3 — Log-only detection

A fix is log-only if all added lines are logger/console calls with no behavioral
change. **Rejected** — finding stays unresolved.

### 5.4 — Runtime self-check

Orchestrator re-runs the group's self-check against the agent's branch:

```bash
# MVP groups: the branch is still held by the agent's worktree (Phase 4 launched it with
# isolation: "worktree", and the worktree isn't removed until Phase 6 Step 1) — `git checkout`
# on a branch a worktree holds fails with exit 128, so run the check IN that worktree instead.
cd {worktree_path} && {SELF_CHECK_COMMAND}

# dashboard-spa / capture-cli (branch, no worktree): check out in the repo, then restore.
cd {repo_path} && git checkout {branch} && {SELF_CHECK_COMMAND}; git checkout {source_branch}
```

**HARD BLOCK** if self-check fails. For dashboard-spa, run in the dashboard repo.

### 5.5 — Test evidence

Check if diff includes test file changes. If no test changes and no "no test" note:
flag as missing evidence. User decides.

### Validation report

Show per-agent: ACCEPTED / HARD BLOCKED / REJECTED with reasons.

Hard block → entire branch excluded (even valid fixes on same branch are collateral).
Soft rejection → individual finding rejected, branch can still merge if it has other
valid fixes.

---

## Phase 6: Merge + Finalize

### Step 0 — Pre-merge checks

Verify no in-progress merge, correct branch, HEAD matches expected save point.

### Step 1 — Merge MVP groups

Follow merge order from state. Skip groups with 0 accepted commits.

**Isolated** (`extension`): merge, record save point, clean up worktree.
**Overlapping** (`ingest-integrations`, `surfaces-pipeline`): show diff, merge. On
conflict: offer resolve/skip/rollback. After conflict resolution, run scoped smoke test.

### Step 2 — Merge dashboard-spa / capture-cli

Each is independent (own repo). In the dashboard repo:
```bash
cd {dashboard_path} && git merge {branch} --no-ff -m "fix(dashboard-spa): merge parallel fixes"
```
And in the terum-capture repo (commit/merge locally; do NOT push — public repo, leave that to the user):
```bash
cd {capture_path} && git merge {branch} --no-ff -m "fix(capture-cli): merge parallel fixes"
```

### Step 3 — Integration test

Run full suites for repos that had merges:
```bash
npm test                                                    # MVP root
(cd lib/dashboard/contracts && npm ci && npm test)          # MVP contracts (own vitest; required in CI)
cd {dashboard_path}/Terum-Dashboard && npx vitest run       # dashboard (if active)
cd {capture_path} && .venv\Scripts\python -m pytest -q      # terum-capture (if active)
```

On failure: granular rollback per group using save points.

### Step 4 — Finalize

1. **Mark resolved.** For committed+merged+passed findings: update frontmatter
   `status: resolved`, rename `.md` → `.resolved.md`. Skip if `bug_log_path` is null.

2. **Clean up.** Remove worktrees, delete merged branches. Ask before deleting
   unmerged branches with commits. `git worktree prune`.

3. **Delete state file.**

4. **Summary** — three sections:

```
FIXED (N bugs):
  [{id}] {group}: {description}
    Root cause: {triage.root_cause}

Failed/Rejected (K bugs — auto-fix attempted but did not land):
  [{id}] {reason}
```

For escalated bugs, the full Harvard-freshman briefings from Phase 3 are the
deliverable — do not re-summarize them here. Instead, reference them:

```
ESCALATED (M bugs — full briefings shown in Phase 3 above):
  [{id}] {group} | {severity} | {description}
  ...
{If pattern logs were created: "Created {N} bug logs for pattern instances — ready for /parallel-fix or /single-fix."}
```

The escalation briefings + auto-created pattern bug logs are the primary
deliverable for bugs that weren't auto-fixed.

---

## Resumability

If state file exists on startup, show status and offer resume.

| Saved phase | Resume action |
|---|---|
| `preconditions` | Proceed to Phase 1 |
| `ingest` | If findings populated → Phase 2. Otherwise re-run. |
| `triage` | If triage results populated → Phase 3. Otherwise re-run triage for findings without triage. |
| `confirm` | Re-show triage results for confirmation. |
| `fix` | Verify agent branches exist. Re-launch groups with missing branches. Continue from `current_round`. |
| `validate` | Re-run validation for unvalidated agents. |
| `merge` | Verify save points. Continue from last merged group. |
| `done` | Delete state file, start fresh. |

Before resuming, verify user is on the expected branch in each active repo.
