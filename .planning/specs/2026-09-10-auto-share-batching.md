# Auto-share batching — one push, per-skill commits, inline classification

**Status:** rev 1 (Claude Opus 5, 2026-09-10). LOCKED by
`.planning/decisions/2026-09-10-auto-share-batching-decision-walk.md` (D1–D5). Ready to build.

**North Star (ratified by Ryan, 2026-09-10):** it finishes, unattended — every skill on a
machine reaches the team completely and promptly without anyone babysitting it.

**The problem, measured.** Auto-share shares local skills to the team with no prompt, from
the session-start hook. On this machine: 88 global skill folders, 87 of them candidates.
Each skill costs its own two fetches and one push — measured against the live remote at
**0.85s per fetch and 1.1s per push** — so `connectOne` is ~3s per skill and the pass needs
**~4.3 minutes**. The hook entry this product writes carries `timeout: 60`. **The first mass
upload has therefore never completed.** It uploads ~20 skills, is killed, and retries next
session (correctly — a pass that left work undone does not stamp the team as synced).

**Governing contracts (preserved, not renegotiated):**
- **Ajay's auto-share spec** (`.planning/specs/2026-09-10-library-mirror-id-sync.md`, ratified
  2026-09-10): blanket consent at setup, the ID check, hygiene as an auto-sync filter,
  privileged folders excluded, global root plus registered checkouts only, the cwd-detected
  repo deliberately excluded. **Every one of these is unchanged by this spec.**
- **Ajay's open sub-question 4** (a first-run review screen) is **closed as unnecessary** by
  walk D3 — the batched push makes the pass finish unattended. Walk D4: build first, tell
  ajay, let him object. **Telling him is required, not optional.**
- **Guard rows unchanged.** Row a authorises each changed path by author; N folders by one
  author pass exactly as one does.
- **CLAUDE.md:** no attacker model. Findings concern a well-meaning user losing work,
  hitting a crash, or getting behaviour the spec does not describe.

**Team-record check:** `check_decision` timed out twice during the walk. Nothing here was
verified against the shared record — unchecked, not cleared.

---

## 1. Behavior

Today, on a machine with a large global skills folder, the session-start pass uploads about
twenty skills and dies. Next session it uploads twenty more. Over several days it converges.
Every skill it does upload is stamped `misc`.

After this spec, the same pass takes about **40 seconds**, uploads everything in one push,
and every skill arrives with a real category. The team's history still shows one entry per
skill, saying who brought it and when — that does not change.

Nothing a person sees changes: no new prompt, no new screen, no new flag. The pass is silent
on success exactly as it is today, and prints the same one-line summary.

---

## 2. `safeWriteBatch` — a sibling of `safeWrite`, not a replacement

`safeWrite` welds commit and push together: lock → fetch → reset → **one** mutation → guard →
commit → push, inside a retry loop. The push costs a second; the commit costs milliseconds.
Keeping per-skill history while paying for one push means separating them — which is why this
is a **new function in `src/lib/teamRepo.ts`, built alongside the existing one.**

**`safeWrite` itself is not modified, not refactored, and not re-expressed as a one-element
call of the new function.** The interactive path must be incapable of regressing from this
change; that is the entire reason for the duplication, and the duplication is accepted.

```ts
export interface BatchItem<R = void> { mutate: Mutate<R>; message: string; }
export interface BatchOutcome<R = void> {
  committed: { index: number; returned: R }[];
  skipped: { index: number; reason: string }[];
  changed: boolean;
  pushedTo: string;
}
safeWriteBatch<R = void>(items: readonly BatchItem<R>[], options: SafeWriteOptions): Promise<BatchOutcome<R>>
```

Loop shape, mirroring `safeWrite`:

1. Acquire the clone lock **once** (same `acquireCloneLock`, same compromise handling).
2. While inside the deadline:
   a. `fetch origin`, `reset --hard origin/main`.
   b. **Rebuild `committed` and `skipped` as empty.** This is the single most important
      invariant in the function: a retry re-runs every mutation against the fresh tree, so
      results accumulated from a previous attempt would double-count silently.
   c. For each item, in order: read the index, build the tree, run `item.mutate(tree)`.
      - The mutation **throwing** skips that item and continues (see §6) — this is the
        behavioural difference from `safeWrite`, where a throw aborts everything.
      - No changed paths → skipped as a no-op.
      - Otherwise `guard(tree, options)` **per item**, then apply, `git add -A -- <changed>`,
        assert the staged diff equals the mutation's changed paths, then `git commit` with
        `item.message`.
   d. If nothing committed, return `{ changed: false }` without pushing.
   e. **README regeneration runs once here**, after the last commit, in its own commit — not
      per item. The existing rule holds: only for non-GitHub remotes and only when
      `options.action !== 'eval'` (Actions own README commits on GitHub).
   f. **One push.** On success return; on a retryable rejection back off and loop, which
      re-runs from (a) including every commit.

The guard running per item is deliberate: it preserves today's authorisation granularity and
keeps refusal messages naming the offending path rather than a union of 87.

---

## 3. Split `connectOne` into prepare and commit

`prepareConnect` does every local step and touches the network not at all:

```ts
interface PreparedConnect {
  id: string; name: string; source: string;
  /** Exact bytes to mirror; SKILL.md already carries the injected managed fields. */
  files: Map<string, Buffer>;
  /** The SKILL.md text to write back to the user's own file. */
  updated: string;
  warnings: readonly HygieneFinding[];
}
type PrepareOutcome = { ok: true; prepared: PreparedConnect } | { ok: false; reason: string };

async function prepareConnect(
  source: string,
  ctx: ConnectContext,
  shared: { teamDoc: Team; records: SkillRecord[]; category?: string },
): Promise<PrepareOutcome>;
```

It takes `teamDoc` and `records` as **inputs** rather than reading them itself — that is what
turns 87 reads into one. It never prompts and never throws for an ordinary refusal; a
refusal is `{ ok: false, reason }`.

`connectOne` keeps its exact current behaviour: refresh, read `teamDoc` and `records`, call
`prepareConnect`, print the "Will add" block and take the y/N, write the source, one
`safeWrite`, update the ledger. Its tests must not need editing.

---

## 4. The new `autoShareRoots`

1. Read the config, resolve the roots, and gather candidates exactly as today — **no change
   to which roots are scanned or to the ID check.**
2. **One** `refreshClone`, **one** `team.json` read, **one** `skillRecords` read for the pass.
3. Read each candidate's SKILL.md once into a map (reused by both §5 and `prepareConnect`).
4. Classify (§5).
5. `prepareConnect` per candidate, with its resolved category. Refusals go straight to
   `outcome.skipped` with the root-qualified label they carry today.
6. Write each prepared `updated` back to the user's SKILL.md — **before the push, keeping
   today's order** (walk D2). An interrupted run then leaves a file whose id the team does
   not know, which the next pass re-mints and uploads. That self-heals; the inverse order
   wedges.
7. **One `safeWriteBatch`**, one `BatchItem` per prepared candidate, each mirroring its
   folder with the message `${handle}: connect ${name}` — byte-identical to today's messages,
   so per-skill provenance is unchanged.
8. **One `store.update`** recording every shared entry, instead of 87.

---

## 5. Classification inside the pass

Measured: **88 skills, 77,053 prompt characters, one call, 36.8s, $0.0963, 88/88 answered,
zero out-of-list answers**, all eight categories used. Classification plus a ~3s push is
about 40 seconds, inside the existing 60-second budget. No hook-timeout change (walk D5).

- Candidates that already declare a category are excluded from the call.
- **One** `suggestCategories` call for the rest, capped at **150** candidates; overflow is
  stamped `misc` rather than risking the budget. Your 88 fit; a 300-skill machine degrades
  instead of failing.
- **Classify before acquiring the writer lock.** The 37 seconds needs no lock; sequenced this
  way the lock is held only for the push. Non-interactive callers abandon the lock after 4
  seconds (`LOCK_WAIT_MS`), and parallel sessions on one machine are normal here — holding it
  for 40 seconds would make every concurrent terum-skills command fail.
- Failure is `misc` for the whole batch, silently. The pass is unattended; there is nobody to
  tell, and it must never block the upload.

---

## 6. Failure isolation — the property that must survive

Today a bad folder fails alone. One push must not change that. Refusals move from *throwing
during the write* to *filtering before it*:

**At prepare time** (never reaches the batch): no SKILL.md, an illegal folder name, a
privileged folder, unparseable frontmatter, a hygiene refusal, a known id (the ratified
no-op), or a name already present in `records`.

**At mutation time** (inside `safeWriteBatch`): the repo-wide name invariant. It must be
checked against the **freshly reset tree**, because the preflight clone can be stale — that
is why it lives inside the mutation today. Batched, a collision **skips that item and lets
the rest commit**, rather than throwing the batch away.

Every skip lands in `outcome.skipped` with its reason and is reported and deferred exactly as
today, so the team is not stamped fully synced while work remains.

---

## 7. What this spec deliberately does not do

- **No review screen** (walk D3). No new prompt, no new surface, no deferral of the first run.
- **No change to `safeWrite`**, and no refactor of it into the new function.
- **No change to `connect`'s interactive behaviour** or its tests.
- **No change to the hook timeout**, the roots scanned, the ID check, hygiene-as-filter,
  privileged exclusion, blanket consent, or any guard row.
- **No fix for the id churn** when a push fails repeatedly (ids are re-minted per attempt, so
  each failed attempt rewrites the id line in every candidate file). Noisy, not lossy;
  declared as a deferral in the walk.
- **No bulk re-label command.** The earlier walk gated it and D5 does not open that gate: the
  pass now categorises what it shares, leaving only the five skills already in the team repo,
  which that walk resolved as a manual pass.

---

## 8. Build order and exit

1. `safeWriteBatch` in `src/lib/teamRepo.ts` + tests against the bare-repo fixtures: N commits
   and exactly one push; a mutation that throws skips only its own item; a retryable rejection
   re-runs every commit and does not double-count; README regenerated once, not per item; the
   staged-diff assertion still fires per item; `safeWrite`'s own tests unchanged and green.
2. `prepareConnect` extracted; `connectOne` rebuilt on it with **no behavioural change** —
   `connect.test.ts` must pass untouched.
3. `autoShareRoots` rebuilt on `prepareConnect` + `safeWriteBatch`, with the single refresh,
   single `team.json` read, single `skillRecords` read and single `store.update`.
4. Classification wired in ahead of the lock, with the cap.
5. Tests for the pass: many skills land in one push with one commit each; a hygiene-refused
   folder is skipped while the rest land; a mutation-time name collision is skipped while the
   rest land; a classification failure stamps `misc` and still uploads.

**Exit criteria.** `npm run lint`, `npm run typecheck` and `npm test` from the repo root.
**Baseline, stated correctly this time:** at base commit `e23bce0` the suite is **1694 tests
across 90 files, of which 8 already fail** — `setup.test.ts` and `checkout.test.ts`, a macOS
`/var` versus `/private/var` temp-path spelling issue, reproduced on a pristine worktree at
that commit with no changes applied. The exit criterion is **no new failures and those 8 still
exactly 8**; the total must rise by the new tests. `runner.test.ts` is a known load-sensitive
flake under full-suite parallelism and passes in isolation.

**Verification note for the orchestrator:** every gate a delegated implementer reports is a
hypothesis. Re-run lint, typecheck and the full suite yourself, and capture the pre-change
baseline rather than trusting a claim that a failure is pre-existing.

---

## 9. Defaults chosen here (veto cheap)

- Classification cap: **150** candidates per pass.
- Per-skill commit messages stay exactly `${handle}: connect ${name}`.
- README regenerated once per batch, in its own commit, after the last item.
- `safeWriteBatch` returns committed and skipped by index rather than by name, so the caller
  owns all labelling.
- Classification sits in `autoShareRoots`, not inside `prepareConnect` — prepare stays pure
  and network-free, which is what makes it testable without a stub agent.
