# Adding skills to a team project — batched endorsement with auto-merge

**Status:** LOCKED rev 1 (Ryan, 2026-09-10 — "build symptom 3 with codex-implement").
The five product decisions are LOCKED
(`.planning/decisions/2026-09-10-add-skills-to-project-decision-walk.md`, commit
`b7e6c9e`); the implementation detail below is derived from them.

**§9 open risk cleared 2026-09-11:** re-verified against `origin/main` after #156/#157
merged. `team.ts:527` still defaults `policy: { publish: 'pr' }`, and the `publish/`
prefix gates at `:583` and `:609` are unchanged. The concurrent edit was in the
`feat/frame-mode` working tree and never reached main, so §3.1 stands as written.

Fixes symptom 3 of the three Ryan reported against the shipped desktop app. His
description, verbatim in intent: **"Adding skills to a team project takes forever"**,
and the failure mode is wrong — *if there are no merge conflicts, it should just add
the skill; if there are merge conflicts, the app should say so and direct the user to
GitHub to fix them.*

**North Star for this work:** adding a skill you already trust to your own team's
project should just work — and when it genuinely can't, the app should say why in one
plain sentence and point at the one place that can fix it.

**Standing decision overridden.** ajay's 2026-09-03 ruling (Terum `abfb15ea`) makes
`publish` the manual **PR-gated** action that endorses a skill. Ryan overrode the gate
for in-app project endorsements on 2026-09-10: the pull request is still opened and is
still the audit trail, CI surface and revert point, but it **auto-merges when clean**,
so the skill lands instead of sitting unmerged while the project count does not move.
Third-party review before landing is what is dropped; the team repo's own `hygiene`
and `receipt-check` jobs replace it as the gate. ajay's underlying purpose —
separating routine personal updates (`share`) from deliberate standardization
(`publish`) — is preserved, because the act stays deliberate and distinct from `share`.

> `record_override` could not be used: it requires a `receipt_id` that
> `check_decision` does not return (it returns `decision_id`, which the endpoint
> rejects as "receipt is missing, not yours, or expired"). The same failure is recorded
> in `2026-09-09-eval-head-to-head.md`. **Someone should reconcile this with Terum** —
> two specs now carry an override that the override API could not accept.

## 0. What is wrong today

Grounded against `origin/main` 6e12369, read from the `-wt-rel12` worktree.

- **PR-gating is the default, not a defect.** `src/commands/team.ts:527` — every team is
  born `policy: { publish: 'pr' }`. A `'push'` policy already exists in
  `src/lib/schema.ts:60`.
- **Four network round trips per skill.** `refreshClone` (`teamRepo.ts:471` — `git fetch`
  + `reset --hard`, under an exclusive clone lock), `git ls-remote --heads`
  (`publish.ts:198`), the branch push, and `gh pr create` (`publish.ts:134`). All
  serialized by `useWorkflow`'s `if (action.busy) return` in `AddSkillsDialog.tsx`,
  against the same clone it re-fetches every time.
- **Switching the policy would not have helped.** Under `push`, `publish.ts:88` asks
  `io.confirm("Publish X to team?")`; `AddSkillsDialog` passes no answers map, so
  `drive.ts:11` routes it to `onUnexpected` — a modal per skill.
- **No merge-conflict detection exists.** `publish.ts:74` explicitly punts to GitHub. The
  only conflict-flavoured text reachable is the `publish.ts:80` confirm, which becomes a
  surprise modal. That is the most likely source of "the failure mode is wrong."
- **Batching is already authorized.** Guard row c (`guard.ts:196`) confines a publish
  write to `global` and `projects[].skills` and does **not** cap how many skills move in
  one write. Row a (`guard.ts:53`) iterates per changed path, so several skill folders
  may be shared in one commit **provided the actor authors all of them**.

## 1. Behaviour

One Add action endorses every selected skill in **one** batch:

1. One `refreshClone` for the whole batch.
2. One `ls-remote` for the whole batch (replacing N).
3. One `safeWrite` commit adding every selected name to `projects[<key>].skills`.
4. One branch, one push, one pull request.
5. Poll until our own checks settle, then merge.
6. Report one outcome per skill, and a single failure message when it could not land.

No question is asked mid-flow. The only dialog is the share confirmation in §5.

## 2. CLI — `publish` takes multiple refs

`publish` currently takes a single `ref` (`publish.ts:39`). Make the ref variadic:

```
terum-skills publish <ref...> --project <key>
```

- One `refreshClone`, one `readTeam`, one `findSkill` per ref, **one** `safeWrite` whose
  mutation appends every resolved id to `projects[<key>].skills` (the existing
  `target.push(id)` at `publish.ts:183`, looped).
- A ref that fails to resolve does **not** fail the batch: it is reported per-skill and
  the rest proceed. A batch where *every* ref fails is a failure.
- **`PublishResult` becomes per-batch.** Keep the existing single-ref shape working (the
  CLI is public API and `SkillScreen.tsx` calls `publish` for the single-skill case);
  add a batch result carrying `{ name, outcome }[]` plus the one `prUrl` / `compareUrl`.
- Preserve the `push`-policy confirm for single-ref CLI use. For a batch, ask **once**
  naming the count and the project, never once per skill.

### 2.1 Branch name must keep the `publish/` prefix

`publish.ts:75` generates `publish/<skill>-<handle>-<uuid8>`. A batch cannot use a
single skill's name. Use:

```
publish/batch-<handle>-<uuid8>
```

**This is load-bearing.** `receipt-check` and `publish-comment` in the scaffolded
workflow are gated on `startsWith(github.head_ref, 'publish/')`. A branch name that
drops the prefix makes both jobs **silently stop running** — no error, they simply never
fire. Any rename must keep it.

### 2.2 One `ls-remote` instead of N

Replace the per-skill `openEndorsements` call (`publish.ts:197`) with a single
`git ls-remote --heads origin 'refs/heads/publish/*'`, filtered locally for the batch's
names **and** for `publish/batch-*`. Report any hit as a linked outcome (§5); never as a
question (decision D5).

## 3. The auto-merge gate

After `gh pr create` succeeds, the batch waits for **our own checks only** and merges.

### 3.1 Which checks

Read the PR's check rollup and consider **only** check runs belonging to the
`terum-skills` workflow — jobs `hygiene` and `receipt-check`
(`.github/workflows/terum-skills.yml`, scaffolded by `team.ts:538`). Every other check
is ignored when deciding, per decision D2: an organization's CI is about code, not about
a skills repo.

- All of our present checks concluded **success** → merge.
- Any concluded **failure** → do not merge; §4 "our check failed".
- Still running → keep polling until the deadline.
- **None of our checks present** → do not wait. A team that deleted the workflow has no
  checks of ours, and must still merge instantly. Distinguish "not present" from "not
  started yet" by allowing a short grace period (suggested 20 s) for a run to appear
  before concluding there is none.

Do **not** use `mergeStateStatus` to decide, because it blends org checks into the same
field. Use `mergeable` for conflict detection and the rollup for check state.

### 3.2 Mergeability is computed lazily

GitHub returns `mergeable: UNKNOWN` until it has computed the merge. This team hit the
consequence on PR #131, which read `CLEAN` moments before flipping to `CONFLICTING`.
**Never act on the first value.** Poll until `mergeable` is `MERGEABLE` or `CONFLICTING`;
treat `UNKNOWN` as "keep waiting".

### 3.3 Merge

`gh pr merge --squash`. One squashed commit per batch keeps the team repo's history one
entry per Add action, and the PR body already lists the skills. The `readme` job fires on
the resulting push to `main` and regenerates `README.md` as it does today.

### 3.4 Bounded wait

The whole wait is bounded (suggested 3 minutes, one constant, no per-call flag). On
timeout the batch does **not** fail and does **not** retry: it reports the "blocked"
message of §4 with the PR link. This matters because an org-wide required check that
never runs on a skills repo would otherwise block the endorsement forever — itself a
candidate explanation for "takes forever" in its most literal sense.

### 3.5 `gh` absent or logged out

`publish.ts:132` already branches on `isGitHubRemote && ghState().authenticated` and
prints a compare URL when it cannot open a PR. Auto-merge needs the same fallback:
without `gh`, push the branch, print the compare URL, and report that the endorsement
needs finishing on GitHub. Never treat a missing `gh` as an error.

## 4. The three failure messages

Decision D3: distinct messages, because the one place that can fix it differs.

| Cause | Detection | Message | Points at |
|---|---|---|---|
| Merge conflict | `mergeable: CONFLICTING` | "Someone changed <project> first, so these could not be added automatically. Resolve it on GitHub." | the PR |
| Blocked | merge refused by GitHub, or the §3.4 deadline passed with our checks green | "Your organization requires checks this app can't complete. Finish the endorsement on GitHub." | the PR |
| Our check failed | a `hygiene` / `receipt-check` run concluded `failure` | "<skill> did not pass <check>." — name the skill and the check | the user's own `SKILL.md`, locally |

The third must **not** send the user to GitHub. The fix is a file on their machine, and
sending them to a PR page to fix it is the wrong-failure-mode bug in a new costume.

## 5. Desktop — `AddSkillsDialog`

`desktop/src/screens/marketplace/AddSkillsDialog.tsx` today renders a per-row `Add`
button and calls `add(row)` one row at a time. Replace with a selection model:

- A checkbox per row; a footer button reading **Add N skills**.
- One `backend.publish({ refs, project })` call for the whole selection, through
  `useWorkflow` exactly once — the existing single-action lock then does the right thing
  instead of serializing N actions.
- Pass an **answers map** so no CLI question can become a surprise modal (decision D5).
- Per-row outcome after the batch returns, reusing the existing `Outcome` shape; one
  shared error line for a batch-level failure.
- `in-project` rows stay unselectable, as today.

### 5.1 Unshared rows (decision D4)

Rows in state `share` are batched **too**, but behind their own confirmation:

- Selecting any `share` row and pressing Add first opens **one** dialog naming **every**
  folder whose contents will be published under the user's name, and stating that
  `connect` edits the local `SKILL.md` to add a metadata id.
- On confirm: one batched `connect` for those folders, then the single batched
  `publish`. Sequencing is unchanged — share still strictly precedes endorse — so
  Ryan's 2026-09-10 ruling that an unshared skill must be explicitly shared is
  preserved. The generic one-button Add that ruling rejected is still rejected.
- A declined confirmation leaves every skill untouched and the dialog open.

### 5.2 Folders the user does not author

Guard row a refuses a write to a skill folder whose committed `SKILL.md` names another
author. Such a row **cannot** be batch-shared. Surface it disabled with the reason
rather than letting it fail the batch.

## 6. What must not change

- **The `publish/` branch prefix** (§2.1). Two CI jobs depend on it.
- **Guard rows a, c and i.** This spec needs no new authorization row, and must not add
  one.
- **`share` / `connect` remains a separate act from endorsement.** Batched, not merged
  into one button.
- **Org-required checks are not bypassed.** GitHub refuses those server-side; the app
  hands off. Never use an admin override to merge past a control an org set.
- **`SkillScreen.tsx`'s single-skill publish path.** It calls `publish` for one ref and
  must keep working.
- Branch protection is **not** set by this spec — that is a declared deferral.

## 7. Tests

1. A batch of N skills issues **one** `refreshClone`, **one** `ls-remote`, **one**
   `safeWrite`, **one** push and **one** `gh pr create` — assert the call counts against
   a fake runner. This is the test that would have caught the original defect.
2. Guard acceptance: one write appending N names to `projects[<key>].skills` passes row
   c; one commit sharing N folders the actor authors passes row a; a folder authored by
   someone else is refused.
3. The generated branch name starts with `publish/`.
4. Auto-merge decides on `hygiene`/`receipt-check` only: an unrelated failing check does
   not prevent the merge; a failing `hygiene` does.
5. `mergeable: UNKNOWN` then `CONFLICTING` produces the conflict message and **no**
   merge attempt — the laziness case from PR #131.
6. No checks from our workflow present → merges without waiting.
7. Deadline passes with our checks green → the blocked message, not a failure, not a
   retry.
8. A `push`-policy batch asks **one** confirm, not N.
9. A partially-resolving batch endorses the resolvable refs and reports the rest.
10. `AddSkillsDialog` passes an answers map such that the `publish.ts:80` "endorsement
    already open" confirm never reaches `onUnexpected`.
11. Declining the share confirmation leaves every skill untouched.

**Gate note.** The desktop suite requires `NODE_OPTIONS=--no-experimental-webstorage` on
this machine (Node 25); without it ~731 tests fail spuriously on `localStorage.clear()`.
`src/screens/library/library-skill.test.tsx` is **independently flaky** here — 2 failures
in 5 runs on unmodified `origin/main` content — and is not a signal about this change.

## 8. Out of scope — declared deferrals

Carried in the ledger's `deferred:` frontmatter:

- One silent rebase-and-retry on a genuine conflict before surfacing anything. The branch
  is fast-forwardable by construction (`refreshClone` resets to `origin/main` and the
  endorsement commits on top), so a conflict is only ever a race, and a retry would
  absorb nearly all of them. Build only if races actually appear.
- Setting branch protection or a ruleset at `team create`, so `hygiene` and
  `receipt-check` gate everyone rather than only people going through the app.
- Whether an endorsement PR left open by an org-required check should be reused or
  superseded on the next add. Ryan's 2026-09-05 ruling kept `publish/<skill>` reuse to
  the exact-same-endorsement case; auto-merge changes the context enough to want a fresh
  look.

## 9. Open risk

`src/commands/team.ts` was modified in the primary working tree by a concurrent session
while this spec was written. This spec depends on two things in that file — the
`WORKFLOW` constant (§3.1) and the `policy: { publish: 'pr' }` default (§0). Both were
read from `-wt-rel12` at `origin/main` 6e12369. **Re-verify §3.1 against `main` before
implementing** if that session changed the scaffolded CI.
