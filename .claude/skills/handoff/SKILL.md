---
name: handoff
description: Snapshot current working context into a structured handoff document for mid-task context resets. Use when context is getting long, before /clear, or when you need a fresh window without losing the thread. Accepts optional inline args — notes to emphasize in the document and/or the explicit next steps for the next session.
---

Create a structured handoff document that a cold agent can read to resume work
exactly where this session left off. The default location is `.claude/handoff.md`; in a
shared/concurrent workspace it may be a slug-named file instead (see Step 0).

## Inline directives (optional args)

The user may pass free-form text after `/handoff` — e.g.
`/handoff capture that the race lives in the queue worker — next: have the agent write
the regression test before touching the worker`. When present, treat that text as
**authoritative input** and split it by meaning into up to two directives:

- **Capture directive** — what the user wants emphasized or recorded in the handoff
  *body*. Fold it into whichever sections it belongs to (Objective / Approach / Progress /
  Gotchas / Dead Ends) and let it **override your own inference where they conflict**. If
  the user says something matters, it goes in even if you'd otherwise have cut it.
- **Next-step directive** — what the next session should DO. Usually signaled by
  `next:`, `next steps:`, `then…`, `afterwards…`, or imperative phrasing aimed at the
  future agent. It populates the **Next Step** section authoritatively, which means the
  Step 3 question is already answered — skip it.

Split by intent, not a rigid pattern — the user's parentheses, dashes, or "and" are
hints, not syntax. A single blob with no next-step signal is a capture directive (draft
Next Step from context as usual). If you genuinely can't tell which bucket a phrase
belongs to, ask rather than guess it into the wrong section. With no args at all, the
flow below is unchanged.

**A next-step directive is also a lens on the whole draft.** When next steps are given,
bias the *entire* handoff toward what executing them requires. Give the most room to the
**decisions already made this session** — which approach was chosen, what was ruled out
and why, the constraints those steps must respect; settled decisions are usually the
highest-value content because they stop the next agent relitigating or silently undoing
them. Foreground the exact file/tree state the steps act on. Compress detail that doesn't
serve the next steps — but the no-cut floor holds: a **Dead End** or **Gotcha** that would
cause wasted work or an error if the agent deviates stays in regardless of the lens.

## Flow

### Step 0 — Choose the handoff path

Concurrent sessions share one working tree, so a single fixed filename can clobber
another session's handoff. A handoff is a **write-once / read-once baton**: one session
writes it, and a later session consumes it by resuming — the Resume Flow stamps a
`> RESUMED …` marker when it does. So "owned by another session" means **written but not
yet resumed**, NOT "recently written". Decide the path ONCE and use it everywhere below
as HANDOFF_PATH:

- `.claude/handoff.md` doesn't exist → use `.claude/handoff.md`.
- It exists → check its top few lines for a `> RESUMED …` marker — use the **Grep** tool
  (or Bash `head`/`grep`), NOT the Read tool (only the Read tool fires the consume hook —
  the hook exits immediately unless `tool_name === "Read"`):
  - Marker present → already consumed → free → overwrite `.claude/handoff.md`.
  - No marker, but YOU wrote it earlier this session (or its `## Objective` is this same
    task) → it's yours → overwrite `.claude/handoff.md`.
  - No marker and a DIFFERENT objective → another live session's pending handoff → do
    NOT touch it. Use `.claude/handoff-<slug>.md`, where `<slug>` is 1–3 kebab-case words
    naming this objective (e.g. `handoff-uat-merge.md`). Kebab-case is a hard requirement,
  not a style preference: the consume hook only recognizes `.claude/handoff[-a-z0-9]*.md`
  (`.claude/hooks/handoff-resume-marker.js:16`), so a slug containing an underscore or a
  dot (`handoff_uat_merge.md`, `handoff.uat.md`) is never stamped `> RESUMED` and can
  never be consumed — even though `.gitignore` and the Step R1 glob still treat it as a
  handoff.

Every confirmation and resume string you print later must name the actual HANDOFF_PATH,
never a hardcoded `handoff.md`.

### Step 1 — Gather mechanical state

Run these in parallel:

```bash
git branch --show-current
git status --short
git diff --stat HEAD
git log --oneline -5
git rev-parse --short HEAD
date -u +"%Y-%m-%d %H:%M UTC"
```

Keep the HEAD hash and timestamp — they become the **Baseline** line in Current State so
a resuming agent can detect that the tree moved since the snapshot (the HEAD hash is the
real drift signal).

**Re-probe, don't recall.** Run these immediately before drafting, and copy Current State
facts from THIS probe's output — never from checks made earlier in the session. If the
handoff will mention any PR, probe it now too:
`gh pr view <n> --json state,isDraft,mergeable,mergedAt`. Audited handoff cycles showed
the difference: the one whose facts came from a probe two minutes before the Write was
exact on every claim; one that reused a PR check from 20 minutes earlier shipped "PR open"
for a PR that had already merged.

### Step 1.5 — Tacit sweep (before drafting)

Before writing anything, run a quick private reflection — the un-emitted state you're
holding is exactly what `/clear` destroys and what a cold agent cannot re-derive from the
surviving files/transcript. Ask four questions and hold the answers for the draft:

1. **Is there a decision I'm still mid-weighing — not yet concluded?** If yes, this is a
   mid-decision handoff (the highest-loss moment to reset); it populates **Open Decision**.
2. **What do I currently believe that I have NOT written to any file or message this
   session?** The current hypothesis, a suspected-but-unconfirmed cause, a sense of where
   the real complexity actually sits — the tacit state worth capturing.
3. **What in the current state would look like a bug or oversight to a fresh agent but is
   actually intentional — AND that they would break or waste work on if they "fixed" it?**
   This goes in **Gotchas**. Skip choices too trivial to matter (section order, naming): a
   fresh agent won't touch them, so a line about them is just bloat.
4. **Am I executing a known plan, or exploring?** Known-plan → the answers to 1–3 are
   usually empty and the baton stays lean. Exploring / mid-decision → they carry real
   content.

The sweep does not add fixed sections — it decides what's worth adding. Every field it
feeds is **omit-if-empty** (same rule as Dead Ends / Gotchas): a question that comes back
empty adds nothing, so a routine known-plan handoff looks exactly like it does today and
only a genuinely loaded reset grows the extra fields. Apply a **materiality bar** to every
answer: include something only if omitting it would cost the next agent real work or a real
error — being merely true is not enough. Nothing the sweep surfaces is ground
truth — it is your best self-report at the write moment, shown to the user in Step 3 and
verified by the next agent, not trusted blindly.

### Step 2 — Draft the handoff

Using your full conversation context plus the git state from Step 1 and the tacit sweep
from Step 1.5, write a complete draft of the handoff document covering ALL sections below. If the user passed
inline directives (see *Inline directives* above), the capture directive is authoritative
— weave it into the right sections and let it override your inference; the next-step
directive becomes the **Next Step** section verbatim-in-intent (tidied, not invented) AND
acts as a lens on the rest of the draft — judge "everything a cold agent needs" (below)
against executing those steps, and lead with the decisions already made.

**Writing rule: complete and dense.** Each section should contain everything a
cold agent needs to resume without asking questions. No artificial length limits —
if the objective is a complex multi-step task, describe the full task. If there
were three dead ends, describe all three with their failure reasons. But no filler,
no hedging, no "as discussed earlier". Every sentence carries information.

**Copy the byte-exact fields; synthesize only the whys.** Git hashes, file paths, exact
error strings, identifiers, and command invocations are copied VERBATIM from git / the
transcript / tool output — never re-narrated from memory, because the cold agent reading
this has no activation memory to catch a mis-remembered hash or path. Only the reasoning
fields (Approach, Dead Ends, Gotchas, Open Decision) are freely synthesized; when a
synthesized claim is uncertain, anchor it to a verbatim artifact (the real error text, the
failing test name) so the next agent can verify it rather than trust it.

**State the negative space of every verification claim.** Whenever the draft says
something was reviewed / validated / tested / green, name in the same breath what was NOT
covered — the sub-suite not run, the lane not measured, the item with no report, the CI
check never looked at. When the underlying work was per-item, enumerate coverage
item-by-item, never as a range or "all". Audited cycles bled exactly where partial
verification was compressed into a green summary: "review reports pr-477…484" hid one PR
with no review at all, and "zero risk, validated" had been measured on only one of the
lanes the change touched.

**External state expires — stamp it and re-verify it.** The Baseline hash catches local
tree drift, but nothing plays that role for the world outside the tree. Any claim about PR
state, CI status, or deployed/applied state carries the time it was checked ("open as of
20:21 UTC"), and when a Next Step action depends on such a claim, the step's first action
is to re-verify it (`gh pr view` / `gh pr checks`) before acting on it.

**Never
paste secrets** (JWTs, tokens, API keys, signing secrets) — say where to obtain them
instead.

**Template:**

```markdown
# Handoff

## Objective
The goal and requirements — WHAT the user wants built/fixed/changed. Include scope,
constraints, and acceptance criteria. Do NOT include implementation decisions here —
those belong in Approach.

## Approach
HOW the work is being implemented and WHY this strategy was chosen over alternatives.
Cover the technical shape of the solution: architecture, patterns, key abstractions.
Only mention rejected alternatives when the next agent might reasonably re-propose
them — explain why they were rejected so the decision isn't relitigated.

## Progress
What's been done so far. Be specific — name the files changed, functions written,
routes added, tests passing. Distinguish between DONE (committed/working) and
IN-FLIGHT (started but incomplete).

## Dead Ends
What was tried and didn't work, and WHY it failed. This is the most important
section for preventing wasted work. Each dead end should explain:
- What was attempted
- What went wrong
- Why it can't/shouldn't be retried

Omit this section if nothing has failed.

## Key Files
The files the next agent needs to read or modify to continue the work. Not every
file touched — the ones that matter. For each file, annotate its role and what
the next agent needs to know about it (current state, what's left to do in it,
important context for editing it).

## Current State
**Baseline:** branch `<name>` @ HEAD `<short-hash>`, snapshot `<timestamp>`. (A resuming
agent compares this to live `git rev-parse --short HEAD`; a mismatch means the tree moved.)

Branch, uncommitted changes, failing tests, error messages. Include anything about
the working tree that would surprise an agent running `git status` cold — e.g.
unrelated changes on the same branch, files that look dirty but shouldn't be touched.

## Gotchas
Non-obvious things discovered during the work that aren't captured in the code.
Runtime behaviors, API quirks, things that look wrong but are intentional,
constraints the next agent might trip over. Include a deliberate choice in the CURRENT
work only if a fresh agent would actually break it or waste work by "fixing" it (a block
left un-refactored on purpose, a shortcut taken knowingly) — with the reason. Skip choices
too trivial to be worth a line (section ordering, naming); they are not traps.

Omit this section if nothing non-obvious was discovered.

## Open Decision
A decision still being actively weighed at handoff time — the un-concluded sibling of
Approach (which is only for decisions already MADE). Capture: what's undecided, the
options still live, which way you're currently leaning AND why (even a half-formed
reason), and the specific evidence or test that would settle it. The next agent inherits
the live deliberation and continues it, instead of re-deriving it from scratch and maybe
landing somewhere different. Omit this section if nothing is unresolved.

## Next Step
Draft the concrete, ordered next actions yourself — the exact files/commands/sequence
the next agent should run, and which steps are safe to proceed with vs. which need the
user's call. This is your best inference; Step 3 refines it with the user's answer.
```

### Step 3 — Show draft; ask only what's still open

Write the full draft (including your Next Step) to HANDOFF_PATH and show it to the user.
Confirm with:

```
Draft saved to <HANDOFF_PATH>
```

Then, depending on whether the args already settled the Next Step:

- **No next-step directive in the args** → ask the ONE question that captures intent you
  can't infer: **"What should the next session do first?"** Your drafted Next Step is your
  best guess; this lets the user correct or re-prioritize it.
- **A next-step directive WAS provided** → it's already answered; don't ask it. Instead
  invite a light correction — **"Next Step is set from what you gave me — tweak
  anything?"** — and proceed to finalize without blocking on a reply.

### Step 4 — Finalize and write

Fold the user's answer — or the next-step directive already taken from the args — into the
**Next Step** section, and apply any corrections they gave on the draft. Write the final
document to HANDOFF_PATH. Confirm with:

```
Handoff saved to <HANDOFF_PATH>
To resume after /clear: "Read <HANDOFF_PATH> and continue"
```

## Resume Flow

When the user says "Read <a handoff file> and continue" (or equivalent), the agent must
NOT immediately begin work. Instead:

### Step R1 — Read the handoff

Read the named handoff file in full (with the Read tool). If the user didn't name one
and multiple `.claude/handoff*.md` exist, list them and ask which. Reading it fires the
`handoff-resume-marker` PostToolUse hook, which auto-stamps the `> RESUMED` marker
**into the file you just read** — so consuming is enforced, not left to you. It frees the
*default* slot only when the file you read IS `.claude/handoff.md`; resuming a
slug-named handoff marks that file consumed and leaves `.claude/handoff.md` exactly as it
was. (The hook's stdout line says "default slot freed" either way — it's a generic
message, not a statement about which file.)

### Step R2 — Check for drift

Run `git rev-parse --short HEAD` and `git status --short`. Compare HEAD to the handoff's
**Baseline**. If they differ, the working tree moved since the handoff was written (often
a concurrent session) — flag it in your restatement and re-read anything the drift affects
before trusting the handoff's file/line references. The Baseline only covers the local
tree — also re-run `gh pr view` / `gh pr checks` on any PR or CI state the handoff's Next
Step relies on; PR-state claims go stale in minutes.

### Step R3 — Restate objectives and plan

Present a restatement to the user — compact on the stable parts, detailed where it helps
you both confirm the resume is on track:

```
## Resuming handoff

**Objective:** [one or two sentence summary of what's being built/fixed]

**Where we left off:** [~4 sentences: what's DONE and committed vs. what's IN-FLIGHT,
the branch/worktree the work lives on, the gate/test state, and — if R2 found drift —
how the live tree differs from the handoff's Baseline]

**Next step:** [~4 sentences: the exact ordered actions from the handoff's Next Step,
which ones are safe to proceed with vs. which need your call, any sequencing constraint
between them, and the single thing most likely to have gone stale since the snapshot]

Ready to proceed?
```

### Step R4 — Wait for confirmation

Do not touch any files, run any commands, or make any decisions until the user explicitly
confirms (e.g. "yes", "go ahead", "proceed"). If the user corrects the objective or next
step, update your understanding before starting.

### Step R5 — Execute

Begin work exactly as specified in the **Next Step** section.

> The `> RESUMED` marker is stamped automatically by the `handoff-resume-marker`
> PostToolUse hook when you read the file in R1 (see Rules) — you do NOT mark it manually.
> **Fallback only** — if that hook isn't installed (e.g. running this skill outside this
> repo), insert the marker yourself beneath the `# Handoff` heading, using
> `date -u +"%Y-%m-%d %H:%M UTC"` for the timestamp:
> `> RESUMED <timestamp> — picked up by an active session; safe to overwrite.`

---

## Rules

- **No git commit.** This is a working scratch file, not a versioned artifact. Keep
  `.claude/handoff*.md` gitignored so a concurrent session's `git add -A` can't sweep it
  into a commit.
- **Never include secrets** — no JWTs, tokens, API keys, or signing secrets. Reference
  where to obtain them ("JWT from the SPA localStorage session") instead.
- **Don't clobber another session's handoff** (Step 0). Overwrite `.claude/handoff.md`
  only when it's consumed (`> RESUMED` marker) or it's your own; otherwise write a
  slug-named file. A pending handoff from an abandoned session keeps the default slot
  "owned" — if you know it's dead, delete `.claude/handoff.md` to free it.
- **Consume on resume.** The `handoff-resume-marker` PostToolUse hook stamps the
  `> RESUMED` marker automatically when a handoff is read (R1); that's what lets the next
  writer reuse `.claude/handoff.md`. The Step-0 ownership peek therefore uses the Grep
  tool (or Bash `head`/`grep`), not the Read tool, so it doesn't self-consume a pending
  handoff.
- **Overwrite, don't append.** Only the latest snapshot per task matters.
- **Draft first, ask second.** The agent synthesizes everything it knows before asking
  the user anything. The user's job is correction, not generation — and when the user
  supplies a next-step directive inline (see *Inline directives*), even the one question
  is skipped.
- **Resume requires confirmation.** Never begin executing a resumed handoff without
  explicit user sign-off — the user may have changed priorities since the handoff was
  written.
