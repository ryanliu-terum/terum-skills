---
title: adding skills to a team project decision walk
date: 2026-09-10
north_star: Adding a skill you already trust to your own team's project should just work — and when it genuinely can't, the app should say why in one plain sentence and point at the one place that can fix it.
status: complete
deferred:
  - what: One silent rebase-and-retry on a genuine merge conflict before surfacing anything, since the endorsement branch is fast-forwardable by construction (D3)
    gate: a real race actually shows up in use — two people endorsing into one project within the same seconds
  - what: Setting branch protection or a ruleset at `team create` so hygiene and receipt-check gate everyone, not only people going through the app (D2)
    gate: someone lands a failing skill via git directly, or a team asks why the checks do not block
  - what: Whether an endorsement PR left open by an org-required check should be reused or superseded on the next add (D5)
    gate: first org-governed team repo hits a permanently blocked endorsement
  - what: Recording the formal override of ajay's 2026-09-03 PR-gating decision (D1)
    gate: Ryan's explicit in-session go-ahead; not yet given, so no override call was made
---

# Adding skills to a team project — Decision Walk

**North Star:** Adding a skill you already trust to your own team's project should just work — and when it genuinely can't, the app should say why in one plain sentence and point at the one place that can fix it.

Context: symptom 3 of the three Ryan reported against the shipped desktop app
(`.claude/handoff-card-project-bugs.md`). His description, verbatim in intent:
**"Adding skills to a team project takes forever"**, and the failure mode is wrong —
*if there are no merge conflicts, it should just add the skill; if there are merge
conflicts, the app should say so and direct the user to GitHub to fix them.*
Symptoms 1 and 2 were fixed in this same session and are not part of this walk.
Walked 2026-09-10 against `origin/main` 6e12369; code read from the `-wt-rel12`
worktree because the primary checkout has no `desktop/`.

## What was actually wrong

Grounding found four things that reshaped the batch before any option was drawn:

- **PR-gating is the default, not a defect.** `src/commands/team.ts:527` — every team
  is born `policy: { publish: 'pr' }`. A `'push'` policy already exists in the schema.
- **The cost is per-skill, four network round trips each.** `refreshClone` (fetch +
  `reset --hard`, under an exclusive clone lock), `git ls-remote --heads`
  (`publish.ts:198`), a branch push, and `gh pr create` — all serialized by
  `useWorkflow`'s single-action lock in `AddSkillsDialog.tsx`, against the same clone
  it re-fetches every time.
- **Switching the policy would not have helped.** Under `push`, `publish.ts:88` asks
  `io.confirm("Publish X to team?")`, and `AddSkillsDialog` passes no answers map, so
  `drive.ts:11` routes it to a modal. `'push'` would produce a dialog per skill.
- **Batching was already authorized.** Guard row c (`guard.ts:196`) confines a publish
  write to `global` and `projects[].skills` but does not cap how many skills move in
  one write. Row a (`guard.ts:53`) iterates per path, so several skills may be shared
  in one commit provided the actor authors all of them.

**No merge-conflict detection exists anywhere.** `publish.ts:74` explicitly punts to
GitHub. The only conflict-flavoured text a user can hit is the `publish.ts:80` confirm
— *"An endorsement of X is already open … Open another pull request? If both merge,
GitHub will flag the second as conflicting"* — which reaches the app as an unexpected
modal. That is the most likely source of "the failure mode is wrong": add a skill, a
PR opens, the project count does not move, try again, and the second attempt asks
about pull requests instead of adding the skill.

## Decision Ledger

| # | Decision | Verdict | Rationale (plain) | Trigger / Pointer |
|---|---|---|---|---|
| 1 | What "just add the skill" means when the merge is clean | LOCK | One batch, one PR, auto-merged when clean — the PR stays as receipt, CI surface and revert point, but the skill actually lands | override of ajay 2026-09-03 still to be recorded |
| 2 | What auto-merge waits for | LOCK | Wait only for our own `hygiene` and `receipt-check`; a GitHub refusal is a hand-off, never a retry | bounded wait; `publish/` prefix must survive batching |
| 3 | What the app says when it cannot land the skill | LOCK | Three messages, because the place that can fix it differs — GitHub for two causes, the user's own SKILL.md for the third | retry-on-conflict deferred |
| 4 | Whether never-shared skills batch too | LOCK | Batch both, behind one confirmation naming every folder published under the user's name; sequencing and boundary unchanged | non-authored folders stay non-batchable |
| 5 | The "endorsement already open" modal | LOCK | Suppress it; the batch answers internally and reports a linked outcome instead of asking mid-flow | reuse-vs-supersede deferred |

---

## Decision 1 — What "just add the skill" means when the merge is clean

**Verdict: LOCK** — one batch, one pull request, auto-merged when clean.

### Plain English
- **What's at stake:** whether adding ten skills is one action or ten, and whether the
  skill is actually in the project when the dialog closes.
- **Why it's a fork:** the slowness and the wrong failure mode share one root cause
  (per-skill round trips that can each stop to ask a question), but fixing it has two
  honest shapes that differ in whether teammates see the addition before it lands.
- **Options:**
  - **A — one batch, one PR, left open.** *(the difference: the skill sits in limbo
    until a human merges, which is the confusing state Ryan hit.)*
  - **B — one batch, straight to main, no PR.** *(the difference: nothing records that
    the endorsement happened and there is no revert point.)*
  - **C — one batch, one PR, auto-merged when clean.** *(the difference: keeps the PR
    as an artifact while the skill still lands immediately.)*
- **Recommendation:** A was recommended and was wrong. Ryan picked C.
- **Zoom-out:** C serves the North Star better than A. A leaves the skill unlanded,
  which fails the first half of the goal outright; the recommendation had been
  optimising to avoid spending a standing team decision rather than to serve the
  objective.
- **The call:** Ryan — "one PR, but the PR gets auto merged if clean."

### Decision cost, stated fairly
ajay's 2026-09-03 ruling says *"`publish` is the manual **PR-gated** action that makes a
skill team-endorsed."* Two honest readings: the word "gated" means a human sees it
before it lands, and auto-merge removes that; or ajay's stated purpose was separating
routine personal updates (`share`) from deliberate standardization (`publish`), in
which case the deliberateness is the actor's and survives intact. The first reading is
the more literal one. **Recorded here as an override to be made, not made silently** —
`record_override` needs Ryan's explicit in-session go-ahead and did not get it in this
walk.

### Technical
- **Files / code paths:** `desktop/src/screens/marketplace/AddSkillsDialog.tsx` (`add()`,
  the `useWorkflow` serialization), `src/commands/publish.ts` (one `ref` per call today),
  `src/lib/teamRepo.ts` (`refreshClone`, `safeWrite`).
- **Migration / schema:** none. Guard row c already permits a multi-skill write; no new
  authorization row.
- **Effort / risk / blast radius:** `publish` currently takes a single ref, so batching
  needs either a multi-ref path or one shared clone-refresh around a loop. `sync` and
  the CLI's own `publish` share `refreshClone`, so a change there has siblings.
- **Grounding findings:** because `refreshClone` does `reset --hard origin/main` and the
  endorsement commits on top, the branch is **fast-forwardable by construction** — a
  conflict only arises from a race in the seconds between fetch and merge. Clean is the
  overwhelmingly common case.

---

## Decision 2 — What auto-merge waits for

**Verdict: LOCK** — wait only for our own workflow's checks; a GitHub refusal is a hand-off.

### Plain English
- **What's at stake:** whether "clean" means "no conflicts" or "no conflicts and the
  checks passed" — i.e. what replaces the human review D1 removes.
- **Why it's a fork:** merging the instant there is no conflict can land a skill a check
  was about to reject, faster than anyone could notice.
- **The call:** Ryan asked whether the app could merge on our checks and ignore the
  organization's, on the reasoning that an org's CI is about code, not about a skills
  repo. Answer: **yes for advisory org checks, no for required ones** — GitHub refuses
  the merge server-side and no flag overrides it; the only bypass is an admin override,
  which would be routing around a control the org deliberately set. So: decide on our
  checks, and treat a refusal as a hand-off rather than a retry.

### What our CI actually is
`team create` scaffolds `.github/workflows/terum-skills.yml` into every team repo
(`team.ts:538`). Four jobs:

| Job | Fires on | Does |
|---|---|---|
| `hygiene` | any PR | `terum-skills validate` on every changed skill under `skills/` |
| `receipt-check` | PR whose branch starts with `publish/` | `receipt-check --base origin/main` |
| `readme` | push to `main` | regenerates and commits `README.md` |
| `publish-comment` | PR whose branch starts with `publish/` | posts a summary comment |

Two of the four exist **specifically for endorsement PRs**, keyed off the `publish/`
prefix that `publish.ts:75` generates.

### Technical
- `team create` sets **no branch protection and no ruleset** (grepped; nothing). So
  these jobs run and report but do not block — a failing check leaves the PR `UNSTABLE`
  rather than `BLOCKED`. Deciding on our checks by name therefore makes them
  effectively gating without branch protection.
- Organization **rulesets** can require status checks across every repo in an org, so
  the app must never enumerate checks from the workflow file and assume that is the
  whole list.
- GitHub computes mergeability **lazily** — this team hit it on PR #131, which read
  `CLEAN` moments before flipping to `CONFLICTING`. The first value cannot be trusted.
- `gh` may be absent or logged out; `publish.ts:132` already branches on that and prints
  a compare URL. Auto-merge needs the same fallback.
- **Spec trap:** if batching changes the branch name away from `publish/`,
  `receipt-check` and `publish-comment` silently stop firing — no error, they just never
  run. The prefix must survive.
- **Bounded wait required:** an org-wide check that never runs on a skills repo would
  otherwise block the endorsement forever, which is itself a candidate explanation for
  "takes forever" in its most literal sense.

---

## Decision 3 — What the app says when it cannot land the skill

**Verdict: LOCK** — three distinct messages.

### Plain English
- **What's at stake:** Ryan's third claim, and the part with no code behind it today.
- **Options:** distinguish the three causes; collapse them into one message; or
  distinguish and auto-retry the conflict case once.
- **The call:** Ryan picked distinguishing.
- **Zoom-out:** this is the pick that most directly serves the North Star, because
  *"the one place that can fix it"* is genuinely different per cause. Conflict and
  org-blocked both mean GitHub; a failed `hygiene` check means the user's own
  `SKILL.md` on this machine. Collapsing them would send someone to GitHub to fix a
  file open in their editor.

### The three messages
| Cause | Message shape | Where to point |
|---|---|---|
| Merge conflict (`DIRTY`) | someone changed the project first | the PR on GitHub |
| Org-required check / protection / permissions | your organization requires checks this app cannot complete | the PR on GitHub |
| Our own `hygiene` / `receipt-check` failed | name the skill and the failing check | the user's `SKILL.md`, locally |

### Technical
- No conflict detection exists today; `publish.ts:74` punts. Mergeability comes from
  GitHub, polled until it settles (see D2 on laziness).
- **Deferred sub-fork:** one silent rebase-and-retry before surfacing a conflict. Since
  the branch is fast-forwardable by construction, a retry would absorb nearly every
  genuine race. Worth building only if races actually appear.

---

## Decision 4 — Do the never-shared skills batch too?

**Verdict: LOCK** — batch both, behind one explicit share confirmation.

### Plain English
- **What's at stake:** the picker has two row kinds. Endorsing a skill the team already
  has is small. A skill only on your laptop must be put into the team repo first, which
  publishes the whole folder's contents under your name.
- **Why it's a fork:** Ryan ruled **the same day** that *"an unshared skill must be
  explicitly shared with `connect` before it can be endorsed"*, because *"one generic
  Add button would hide an important permission boundary."*
- **The call:** batch both, with one confirmation naming every folder that will be
  published.
- **Zoom-out:** this does **not** conflict with that ruling. The sequencing is
  unchanged, the boundary keeps its own dialog, and the generic Add button the ruling
  rejected stays rejected. Batched, not bypassed.

### Technical
- Guard row a (`guard.ts:53`) iterates per changed path, so one commit may carry several
  skill folders **provided the actor authors all of them**. A folder authored by someone
  else is refused — the picker must surface those as non-batchable rather than failing
  the whole batch.
- `connect` edits the local `SKILL.md` (metadata id) — a real side effect on the user's
  own files, which the confirmation should name.

---

## Decision 5 — The "endorsement already open" modal

**Verdict: LOCK** — suppress it; report a linked outcome instead.

### Plain English
Not a real fork, so no options were manufactured. Under D1–D3 endorsement PRs no longer
linger, so `openEndorsements` will rarely find one. When it does — an org-blocked PR
left open — the `publish.ts:80` confirm fires again as a surprise modal, because
`AddSkillsDialog` passes no answers map. The batch should answer it internally and
report "an endorsement for X is already open" as a linked outcome.

### Technical
- `publish.ts:197` `openEndorsements` runs `git ls-remote --heads origin
  refs/heads/publish/<name> refs/heads/publish/<name>-*`; one extra network round trip
  per skill that batching should also collapse.
- **Deferred:** whether a still-open blocked endorsement should be reused or superseded
  on the next add. Ryan's 2026-09-05 ruling kept `publish/<skill>` branch reuse to the
  exact-same-endorsement case; auto-merge changes the context enough that it wants a
  fresh look when a real org-governed team first hits it.

---

## What is ready to build

D1–D5 are all LOCK. Together they specify: one batched endorsement per Add action, on a
branch that keeps the `publish/` prefix, opened as a single PR, auto-merged once
`hygiene` and `receipt-check` pass, with a bounded wait, three distinct failure
messages, unshared rows batched behind their own naming confirmation, and no mid-flow
modal. No authorization row changes; no schema changes.

**Not resolved and deliberately out of this walk:** the formal override of ajay's
PR-gating decision, which needs Ryan's explicit go-ahead before `record_override` is
called.
