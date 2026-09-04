---
name: state
description: Print a plain-English state report for the current session so a human can re-orient — what's different now than when the session started, which files/functions changed and where they live (worktree, branch, committed vs not), what was decided, what's still unresolved, and the categorized next steps. Also carries the trail of how it got here. Use mid-session when you've lost the thread, want to know what state the work is actually in, or need to decide what to do next without scrolling the transcript. NOT for clearing/resuming — that's /handoff.
---

Produce a **human-facing state report** for the current session. The reader is the user,
still in the session, who needs to know two things: **what state is this work actually in**,
and **what should I do next**. The story of how it got there is secondary — real, worth
keeping, but below the fold.

This is **not** `/handoff`. The split is *audience and question*, not level of detail:

- `/handoff` answers **"how does a cold agent resume this?"** — a write-once baton with a
  HEAD-hash baseline, key files annotated with their role, dead ends, a resume protocol.
  Dense reference for a machine that has no memory at all.
- This skill answers **"where do I stand and what do I do?"** — for a human who was here
  the whole time but lost the plot. Plain English, skimmable, no resume machinery.

They overlap on facts (both name files and branches). They differ on framing: handoff says
*"read `lib/foo.ts:88` — the retry loop is half-written"*; this says *"the retry fix is
built but sitting uncommitted in the ghost-a worktree."* If you catch yourself writing
`file.ts:120`, a resume string, or "the next agent should…", you're writing the wrong skill.

## Governing principle: write for a reader who remembers NOTHING

The whole reason this skill exists is that the user forgot what the session was about. So
every line must make sense **cold**, to someone with zero memory of the conversation:

- **No insider shorthand or coined vocab.** Terms the session invented mid-stream ("the
  substance rule", "the reach tag", "grounding", "two prongs") mean nothing to a cold
  reader. Spell the idea out in ordinary words.
- **No compressed `X → Y` fragments** that only parse if you were there ("nested detours →
  slim spine"). Write a plain sentence.
- **Each line is self-contained** — a stranger could read just that line and understand it.

Plain is not the same as verbose: spend the extra words needed to be clear, then stop. If a
line would confuse someone who just walked in, rewrite it.

## Invocation (optional args)

- `/state` — print the report in chat. Nothing is written to disk.
- `/state save` — also write the report to `.claude/summaries/YYYY-MM-DD-<topic>.md`
  (create the dir if missing; `<topic>` = 1–3 kebab-case words naming the North Star).
  Use `date -u +"%Y-%m-%d"` for the date.
- `/state <free text>` — treat the free text as an **emphasis lens**: bias the report
  toward what it names (e.g. `/state focus on what's uncommitted`, `/state what did we
  decide`). It re-weights the content; it does not change the section order or format.
  `save` may be combined with an emphasis lens.

## Grounding: two sources, intersected

Most of this report is synthesized from the conversation. The **file and location facts are
not** — they are checked against git, because a session's memory of what it changed is
reliable but its memory of what state those changes are *in* is not.

The rule that makes this correct:

> **The conversation supplies the file list. Git supplies each file's state.**
> Never the other way around.

This matters because a shared checkout lies in both directions. A raw `git status` includes
files other sessions dirtied (reporting them as yours is actively misleading), and misses
work done in a separate worktree entirely (reporting "nothing changed" when a whole feature
exists on a branch).

### Procedure

1. **Derive the touched-file list from the transcript** — every file this session actually
   created or edited. This list is authoritative for *which* files appear in the report.
2. **If that list is empty, skip git entirely.** A pure discussion, design, or audit session
   has no file state to check; run no commands and say so in WHERE IT LIVES.
3. **Otherwise, run one batched read-only check.** Query only the trees the touched files
   live in — never loop per-file:

   ```bash
   git worktree list
   git -C <tree> status -sb          # branch, upstream, ahead/behind, dirty files
   git -C <tree> log --oneline -8
   ```

   `status -sb` is the workhorse: its first line gives branch + upstream + ahead/behind in
   one shot. Repeat the two `-C` commands per involved tree, all in the same batch.
4. **Check a pull request only if the conversation already named one.** Then, and only then:
   `gh pr view <n> --json state,isDraft,statusCheckRollup`. Never go fishing for PRs.
5. **Never widen beyond the touched list.** Other dirty files in the tree are not yours.
   Count them and emit the one-line warning (see WHERE IT LIVES); never enumerate them.

Everything outside file state — decisions, reasoning, what a change means — is synthesized
from the conversation and gets hedged when uncertain. If you're not sure a bug was logged or
a decision was final, say "we discussed" rather than asserting it as done.

## Scope

The current conversation only. No cross-session history, no resume flow.

## Repo conventions

This skill lives inside the repo it runs in — `.claude/skills/state/SKILL.md`, git-tracked; it
was moved back in-repo on 2026-07-31 (commit `4ed81515`, PR #451) and the user-global
`~/.claude/skills/state/` copy was deleted. Write it repo-agnostically so it survives being
copied into another repo, but read the conventions of the repo you are actually in. Where a
repo has its own conventions — bug-log numbering, a migration ledger, a staging-first merge
flow, gate scripts — read them from that repo's `CLAUDE.md` and reflect them in the report's
status language. Do **not** hardcode one project's conventions into this skill; read them from
the live `CLAUDE.md` each run. When a repo has no such convention, drop the corresponding
detail rather than inventing one.

## Output format

Two halves, separated by a visible divider. **Above the fold is present tense** — how things
are right now. **Below the fold is past tense** — how they got that way. When you're unsure
where a new piece of information belongs, that tense test decides it: a decision already made
is a live constraint (above), a decision being *narrated* is history (below).

The divider is not decoration. It tells the reader where they can stop.

**Omit any section that would be empty**, except NORTH STAR and NEXT STEPS which always
appear. Scale each to its content; a short session yields a short report.

```
━━ WHERE THINGS STAND ━━━━━━━━━━━━━━━━━━━━━━━
1. NORTH STAR
2. WHAT'S DIFFERENT NOW
3. WHERE IT LIVES
4. DECISIONS MADE
5. OPEN QUESTIONS
6. NEXT STEPS

━━ HOW WE GOT HERE ━━━━━━━━━━━━━━━━━━━━━━━━━━
7. THE TRAIL
8. SURPRISES
```

---

### 1. NORTH STAR

One or two punchy sentences: what this session was originally about — the main purpose the
user drifted from. This is the single most important line; it's the thing they forget.
Nothing precedes it.

### 2. WHAT'S DIFFERENT NOW

**The headline.** Not "we edited `briefing-builder.ts`" but what the product or repo *does*
now that it didn't when the session started — in before/after terms a non-engineer could
read. Then a **reach tag** saying how far that change actually got.

```
WHAT'S DIFFERENT NOW
  • a teammate's note used to show to everyone on the team; now it's hidden from
    anyone outside the channel it came from
      reach: built on branch feat/audience-fix — NOT merged, nothing in prod changed

  • the session recap command now reports which files changed and where they live,
    instead of only narrating what happened
      reach: uncommitted in the primary checkout
```

Rules:

- **Every delta carries a reach tag.** Pick the honest one:
  `live in prod` · `merged, not yet deployed` · `on branch <x>, unmerged` ·
  `uncommitted in <tree>` · `written but not applied` · `spec/docs only — no code` ·
  `decided, nothing built yet`.
  Without this tag a reader assumes things shipped. Most of the time they didn't.
- **Authored is not applied.** For anything with a separate activation step — a database
  migration, a feature flag, a deployment, a published extension — say which side of it you
  are on. "The migration is written" and "the migration ran" are different states and only
  one of them changed the product.
- **Behavior, not mechanics.** If you can't state a change as something a user or the repo
  now does differently, it probably belongs in WHERE IT LIVES as plumbing.
- **Honest empty mode.** If nothing changed, say so in one line — *"nothing in the product
  changed; this was a design session"* — rather than omitting the section. The absence is
  information, and it's the most common case for discussion-heavy sessions.

### 3. WHERE IT LIVES

The mechanical backing for section 2, **grouped by location**, because location is the thing
a human genuinely cannot reconstruct from memory.

```
WHERE IT LIVES
  primary checkout — branch chore/harness-paths
    • .claude/skills/state/SKILL.md — rewrote the section set and grounding rules
                                                              [uncommitted]
    • .claude/hooks/pre-write-checks.js — added the worktree guard
                                                              [uncommitted]

  worktree .wt-ghost-a — branch feat/ghost-a-observed-surfaces
    • lib/teamwork/adapters/meetings.ts — new co-presence fold [committed, not pushed]
    • __tests__/teamwork/meetings.test.ts — 6 new cases        [committed, not pushed]
    → PR #296, draft, checks green

  ⚠ the primary checkout has ~50 other dirty files from other sessions — not ours
```

Rules:

- **Only files this session touched.** From the transcript, confirmed against git. Never a
  raw `git status` dump.
- **A per-file clause saying what changed inside it** — the function, the rule, the section.
  A bare path list is the failure mode this section exists to fix.
- **A state tag per file**: `uncommitted` · `staged` · `committed, not pushed` · `pushed` ·
  `in PR #n`.
- **The other-sessions warning line** whenever the tree holds unrelated dirty files —
  counted, never enumerated. This is what stops a later "commit everything" from sweeping in
  another session's work.
- **Optional: where we only looked.** For an audit or investigation session that changed
  nothing, a thin list of what was read, so the next pass doesn't re-explore it.
- **Nothing-changed mode.** One line: *"no files changed — nothing to find on disk."*

### 4. DECISIONS MADE

Bullets, each a plain-English decision plus its one-line why. These are present tense because
a settled decision is a **live constraint** on the next steps, not a historical event.

Include what was *rejected* only when someone might reasonably re-propose it — with the
reason, so it isn't relitigated. Omit the section if nothing was decided.

### 5. OPEN QUESTIONS

What is **still not known**, and the cheapest thing that would settle each one. This is the
section that keeps a returning reader from re-deriving the same uncertainty from scratch, and
it feeds directly into the blocked bucket of NEXT STEPS.

```
OPEN QUESTIONS
  • does the fix also cover notes that came from direct messages?
      cheapest check: run the audience query against a single DM row
  • is migration 151 applied to the non-prod database, or only written?
      cheapest check: read the migration ledger
```

Rules:

- **Unanswered only.** A question you answered is either a decision (section 4) or context
  (section 7). This section is exclusively the open ones.
- **Every question gets a resolving move** — the specific cheap observation, query, file, or
  person that would answer it. A question with no path to an answer is a worry, not an open
  question; either give it a path or drop it.
- **Blocking questions are marked** so section 6 can point at them.
- Omit if nothing is genuinely unresolved.

### 6. NEXT STEPS

Categorized by **what's blocking**, not by topic. Omit any bucket that's empty; keep the
order, since it runs from most-blocked to most-free.

| bucket | means |
|---|---|
| ⛔ **Needs your call** | blocked on the user; nothing downstream moves until answered |
| 📝 **Spec** | needs writing or auditing before any code |
| 🔨 **Implement** | the approach is settled, ready to build |
| ✅ **Verify** | built; needs a gate, test, or real-environment check |
| 📦 **Land** | commit / push / undraft / merge / apply / deploy |
| 🧹 **Loose ends** | logged debt, deferrals, cleanup, things to record |

Each item is **one plain sentence**, plus **where** it happens (which tree or branch), plus
what it's blocked on if anything.

Two of the items get a marker, so the reader can tell the difference between finishing what
they're mid-way through and getting back on track:

- `◀ finishes the tangent you're in` — closes out the side-thread the session is currently
  sitting in. Omit if there is no live tangent.
- `◀ back on the main path` — the next real move toward the North Star.

```
NEXT STEPS
  ⛔ Needs your call
     • whether the audience fix should also cover direct messages — blocks the merge

  🔨 Implement
     • write the DM branch of the audience check, in .wt-ghost-a   ◀ finishes the tangent you're in

  📦 Land
     • commit the skill rewrite in the primary checkout            ◀ back on the main path
     • undraft PR #296 once the DM question is answered
```

---

### 7. THE TRAIL

**Below the fold.** A few slim bullets tracing the path toward the North Star — one short
clause per move. This section carries the *path and its turns*, NOT the outcomes; outcomes
live above the fold, so don't restate them here or the report reads everything twice.

- **One brief clause per step**, naming the move and what turned — never a hollow process
  label ("discussed the shape"). Name what changed your mind, not which slot got filled.
- **Collapse the small stuff.** A handful of bullets for the whole session, not one per
  exchange.
- **Drop past detours entirely.** A rabbit hole that mattered already surfaced above the
  fold; one that didn't is noise. Never build a nested tree of them.
- **Surface only the CURRENT tangent**, as a single sub-bullet `↳ down a side-question: …`.
  If the session is on the main path, there is no tangent line at all.
- **Mark the current position** with `◀ you are here` on the last line.

```
THE TRAIL
  • reproduced the bug: clicking a "relevant" item opens the wrong conversation
  • found the link points at the wrong id — it uses the source's name ("chatgpt")
    instead of the conversation's real identifier, so it lands nowhere
  • confirmed the database query is what builds that wrong id
  • ↳ down a side-question: could private conversations leak into this list?  ◀ you are here
```

### 8. SURPRISES

**Below the fold.** Anything that turned out **not to be how you thought** — a bug, a wrong
assumption, a stale doc, a false note in your own memory, a gate that failed for an unrelated
reason. Broader than "bugs found" on purpose: the narrow version only fires in debugging
sessions, and this one earns its place in design and audit sessions too.

Each item carries a **status tag**, because the status is the part you'd act on:

```
SURPRISES
  • the hook configuration was thought to need a restart to reload — it actually
    reloads on its own                                    [assumption corrected]
  • the briefing showed private notes to people outside the team
                                                          [found, NOT logged yet ← do this]
  • the type-check failure was the machine running out of memory, not a type error
                                                          [logged as bug-551]
```

- **`found, NOT logged yet` is the valuable state** — an unrecorded problem is the thing that
  evaporates when the window closes. Every one of these must also produce a 🧹 item in
  NEXT STEPS. If the repo has a bug-log convention, name it; if not, "write this down
  somewhere" is enough.
- Corrected assumptions count even when nothing was broken — a belief you held that turned
  out false is exactly what you'd otherwise re-derive next session.
- Omit if the session held no surprises.

## Rules

- **Two halves, present tense above.** Never move a history section above the divider or a
  state section below it. When in doubt, apply the tense test.
- **North Star first, every time.** Nothing precedes it.
- **The conversation supplies the file list; git supplies the state.** Never dump raw
  `git status`, never attribute another session's dirty files, never omit a worktree.
- **Every behavior delta carries a reach tag**, and authored is never reported as applied.
- **Don't invent.** Bug numbers, commit hashes, PR states, and "done" states are copied from
  a real command's output or hedged — never recalled. Everything else is synthesis and gets
  hedged when uncertain.
- **Human-facing prose.** No `file.ts:120`, no HEAD hashes, no "the next agent should…", no
  resume strings. If it looks like a handoff, rewrite it.
- **Substance over process, without duplication.** Each line says what actually changed, in a
  plain self-contained sentence, and says it in exactly one section.
- **Chat by default; file only on `save`.** The report is ephemeral re-orientation.
- **Never paste secrets** — no tokens, keys, or credentials, even in a saved file.
